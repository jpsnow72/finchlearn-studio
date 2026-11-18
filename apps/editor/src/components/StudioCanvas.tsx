/**
 * StudioCanvas — the scene stage.
 *
 * Renders the current scene's objects at the preview clock time.
 * Click selects; in path-edit mode, clicks drop waypoints for the selected
 * character (coordinates in scene pixels).
 */
import { useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import type { CharacterObject } from "@finch-studio/core";
import { useStudioStore, useCurrentScene, useSelectedObject } from "../store";
import { StudioObjectRenderer } from "./StudioObjectRenderer";
import {
  mergeAnimatedStyle,
  SceneTimeContext,
  timelineStyleFor,
} from "@finch-studio/animation";

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
  const selectObject = useStudioStore((s) => s.selectObject);
  const addWaypoint = useStudioStore((s) => s.addWaypoint);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);

  // Fit the fixed 1280×720 stage into the available width.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth;
      if (w > 0) setScale(Math.min(1, w / SCENE_W));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
    width: SCENE_W,
    height: SCENE_H,
    transform: `scale(${scale})`,
    transformOrigin: "top left",
    background: scene.background ?? "#ffffff",
  };
  const animatedStageStyle =
    tMs === null ? stageStyle : mergeAnimatedStyle(stageStyle, timelineStyleFor(scene.animations, tMs));

  return (
    <div className="studio-canvas-wrap" ref={wrapRef}>
      <div
        style={{ width: SCENE_W * scale, height: SCENE_H * scale, overflow: "hidden" }}
      >
        <div
          className={`studio-stage${pathEdit ? " path-edit" : ""}`}
          style={animatedStageStyle}
          onClick={onStageClick}
        >
          <SceneTimeContext.Provider value={tMs}>
            {scene.objects
              .filter((o) => o.visible !== false)
              .map((o) => {
                const pos = o.position ?? {};
                const isSel = o.id === selected?.id;
                const objectStyle = {
                  left: pos.x ?? 0,
                  top: pos.y ?? 0,
                  width: pos.w ?? 200,
                  height: pos.h ?? 100,
                };
                return (
                  <div
                    key={o.id}
                    className={`studio-obj${isSel ? " selected" : ""}`}
                    style={mergeAnimatedStyle(
                      objectStyle,
                      tMs === null ? {} : timelineStyleFor(o.animations, tMs),
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!pathEdit) selectObject(o.id);
                    }}
                  >
                    <StudioObjectRenderer object={o} />
                    {isSel && <div className="studio-sel-ring" />}
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
        </div>
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
