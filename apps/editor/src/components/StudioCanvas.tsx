/**
 * StudioCanvas — the scene stage.
 *
 * Renders the current scene's objects at the preview clock time.
 * Click selects; in path-edit mode, clicks drop waypoints for the selected
 * character (coordinates in scene pixels).
 */
import { useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import type { CharacterObject } from "@finch-studio/core";
import {
  timelineClipRange,
  useStudioStore,
  useCurrentScene,
  useSelectedObject,
} from "../store";
import { StudioObjectRenderer } from "./StudioObjectRenderer";
import { sceneBackgroundCss } from "../content/bundledContent";
import { isMulticamObjectVisibleAt } from "../multicam";
import {
  baselineRevealClipPath,
  blockRevealOverlayStyle,
  effectiveAnimationsForObject,
  mergeAnimatedStyle,
  objectOutsideFrame,
  projectAspect,
  PROJECT_ASPECTS,
  SceneTimeContext,
  stageDimensions,
  timelineStyleFor,
} from "@finch-studio/animation";
import { safeZones } from "@finch-studio/schema";
import { wipeClipPath } from "@finch-studio/motion";
import {
  drawOnForObject,
  sampleDrawOnForObject,
  whiteboardSurfaceForScene,
} from "../drawOn";

/** The 16:9 stage size; other aspects use their own stage frame. */
export const SCENE_W = 1280;
export const SCENE_H = 720;

export function StudioCanvas({
  tMs,
  pathEdit,
}: {
  tMs: number | null;
  pathEdit: boolean;
}) {
  const scene = useCurrentScene();
  const selected = useSelectedObject();
  const project = useStudioStore((s) => s.project);
  const setProjectAspect = useStudioStore((s) => s.setProjectAspect);
  const duplicateAtAspect = useStudioStore((s) => s.duplicateAtAspect);
  const selectObject = useStudioStore((s) => s.selectObject);
  const selectedObjectIds = useStudioStore((s) => s.selectedObjectIds);
  const addWaypoint = useStudioStore((s) => s.addWaypoint);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  // Safe zone overlays and alignment guides (issue #13 ergonomics).
  const [showGuides, setShowGuides] = useState(false);

  // The stage frame follows the project aspect (issue #13): the canvas,
  // the safe-area preview, and exports all use this one frame.
  const aspect = projectAspect(project);
  const stage = stageDimensions(project);
  const stageW = stage.width;
  const stageH = stage.height;
  const zones = safeZones(aspect);

  // Fit the stage into the available width.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      if (w > 0) setScale(Math.min(1, w / stageW));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [stageW]);

  const onStageClick = (e: MouseEvent) => {
    if (!pathEdit) return;
    const sel = selected as CharacterObject | null;
    if (!sel || sel.type !== "character") return;
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const x = Math.round((e.clientX - rect.left) / scale);
    const y = Math.round((e.clientY - rect.top) / scale);
    const existing = sel.path ?? [];
    const t = existing.length > 0 ? Math.max(...existing.map((w) => w.t)) + 2000 : 0;
    addWaypoint(sel.id, { x, y, t });
  };

  if (!scene) return <div className="studio-canvas-empty">No scene</div>;
  const stageStyle = {
    width: stageW,
    height: stageH,
    transform: `scale(${scale})`,
    transformOrigin: "top left",
    background: whiteboardSurfaceForScene(scene) ?? sceneBackgroundCss(scene.background),
  };
  const animatedStageStyle =
    tMs === null ? stageStyle : mergeAnimatedStyle(stageStyle, timelineStyleFor(scene.animations, tMs));

  return (
    <div className="studio-canvas-wrap" ref={wrapRef}>
      <div
        className="studio-stage-frame"
        style={{ width: stageW * scale, height: stageH * scale }}
      >
        <div
          className={`studio-stage${pathEdit ? " path-edit" : ""}`}
          style={animatedStageStyle}
          onClick={onStageClick}
        >
          <SceneTimeContext.Provider value={tMs}>
            {scene.objects
              .filter((o) => {
                if (o.visible === false) return false;
                const range = timelineClipRange(o, scene.durationMs);
                const time = tMs ?? 0;
                if (!(time >= range.startMs && time < range.startMs + range.durationMs)) {
                  return false;
                }
                // Multicam (#47): only the resolved angle is on stage.
                if (!isMulticamObjectVisibleAt(scene, o, time)) return false;
                // Whiteboard draw-on: hidden before the draw and after
                // an erase, resolved by the shared motion sampler.
                if (tMs !== null) {
                  const sample = sampleDrawOnForObject(o, range, tMs);
                  if (sample && !sample.visible) return false;
                }
                return true;
              })
              .map((o) => {
                const pos = o.position ?? {};
                const isSel = selectedObjectIds.includes(o.id);
                // Objects that sit outside the current stage frame stay
                // in the project and are visibly marked, never hidden.
                const outside = objectOutsideFrame(o, stage);
                const objectStyle = {
                  left: pos.x ?? 0,
                  top: pos.y ?? 0,
                  width: pos.w ?? 200,
                  height: pos.h ?? 100,
                };
                const range = timelineClipRange(o, scene.durationMs);
                const drawSample =
                  tMs === null ? null : sampleDrawOnForObject(o, range, tMs);
                const drawTreatment = drawOnForObject(o);
                const effAnims = effectiveAnimationsForObject(o);
                let style = mergeAnimatedStyle(
                  objectStyle,
                  tMs === null ? {} : timelineStyleFor(effAnims, tMs),
                );
                // Baseline Reveal (issue #112): mask the part of the
                // object still below its baseline while it rises. A
                // draw-on wipe below takes precedence when both apply.
                const baselineClip =
                  tMs === null ? undefined : baselineRevealClipPath(effAnims, tMs);
                if (baselineClip && style?.clipPath === undefined) {
                  style = { ...style, clipPath: baselineClip };
                }
                if (drawSample && (o.type === "text" || o.type === "image")) {
                  // Text and images reveal with the wipe that matches
                  // the shape stroke progress at the same timestamp.
                  style = { ...style, clipPath: wipeClipPath(drawSample.progress) };
                }
                // Block Reveal (issue #112): the solid block riding
                // the reveal front, drawn over the object content.
                const blockOverlay =
                  tMs === null ? null : blockRevealOverlayStyle(effAnims, tMs);
                return (
                  <div
                    key={o.id}
                    className={`studio-obj${isSel ? " selected" : ""}${outside ? " out-of-frame" : ""}`}
                    data-out-of-frame={outside || undefined}
                    style={style}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!pathEdit) selectObject(o.id, e.shiftKey);
                    }}
                  >
                    <StudioObjectRenderer
                      object={o}
                      drawOn={
                        drawSample && drawTreatment
                          ? { sample: drawSample, treatment: drawTreatment }
                          : undefined
                      }
                    />
                    {blockOverlay && (
                      <div className="studio-block-reveal" style={blockOverlay} />
                    )}
                    {isSel && <div className="studio-sel-ring" />}
                    {outside && (
                      <div className="studio-oof-badge">Outside frame</div>
                    )}
                  </div>
                );
              })}
            {pathEdit && selected?.type === "character" &&
              (selected as CharacterObject).path?.map((w, i) => (
                <div
                  key={i}
                  className="char-path-dot"
                  style={{ left: w.x, top: w.y }}
                  title={`Waypoint ${i + 1} @ ${w.t}ms`}
                />
              ))}
          </SceneTimeContext.Provider>
          {showGuides && (
            <>
              <div
                className="guide-title-safe"
                title="Title safe area"
                style={{
                  left: `${zones.titleSafe.x * 100}%`,
                  top: `${zones.titleSafe.y * 100}%`,
                  width: `${zones.titleSafe.w * 100}%`,
                  height: `${zones.titleSafe.h * 100}%`,
                }}
              />
              <div
                className="guide-social-safe"
                title="Social safe area"
                style={{
                  left: `${zones.socialSafe.x * 100}%`,
                  top: `${zones.socialSafe.y * 100}%`,
                  width: `${zones.socialSafe.w * 100}%`,
                  height: `${zones.socialSafe.h * 100}%`,
                }}
              />
              <div className="guide-center-v" />
              <div className="guide-center-h" />
            </>
          )}
        </div>
      </div>
      <div className="stage-controls">
        <div className="aspect-switch" role="group" aria-label="Stage aspect">
          <span className="aspect-switch-label">Stage aspect</span>
          {PROJECT_ASPECTS.map((value) => (
            <button
              key={value}
              type="button"
              className={`guide-toggle${value === aspect ? " active" : ""}`}
              aria-pressed={value === aspect}
              onClick={() => setProjectAspect(value)}
            >
              {value}
            </button>
          ))}
        </div>
        <div className="aspect-switch" role="group" aria-label="Duplicate at aspect">
          <span className="aspect-switch-label">Duplicate at</span>
          {PROJECT_ASPECTS.filter((value) => value !== aspect).map((value) => (
            <button
              key={value}
              type="button"
              className="guide-toggle"
              onClick={() => duplicateAtAspect(value)}
            >
              {value}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="guide-toggle"
          aria-pressed={showGuides}
          onClick={() => setShowGuides((v) => !v)}
        >
          {showGuides ? "Hide safe zones" : "Show safe zones"}
        </button>
      </div>
      {pathEdit && (
        <div className="studio-path-hint">
          📍 Click on the stage to drop waypoints for{" "}
          <strong>{selected?.name ?? "the character"}</strong>
        </div>
      )}
    </div>
  );
}
