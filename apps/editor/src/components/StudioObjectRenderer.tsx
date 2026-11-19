/**
 * StudioObjectRenderer — renders scene objects in the video studio canvas.
 *
 * Handles the video-friendly types (character, text, shape, image, and
 * footage video with its issue #25 edits); other types render a
 * placeholder note. Character limb animation + path movement
 * come from @finch-studio/characters' RiggedCharacter (driven by
 * SceneTimeContext), on the standard skeleton and the approved
 * Direction A and B style families.
 */
import { useContext, useEffect, useRef, type CSSProperties } from "react";
import type { CharacterObject, CourseObject, VideoObject } from "@finch-studio/core";
import { footageSourceAt } from "@finch-studio/schema";
import {
  footageClipStartMs,
  resolveFootageObject,
} from "../footageEditing";
import { SceneTimeContext } from "@finch-studio/animation";
import {
  RiggedCharacter,
  characterForLegacyId,
  defWithColors,
  mouthAt,
  visemesFromText,
} from "@finch-studio/characters";
import { studioActionFor } from "../videoExport";
import { textDirectionOf } from "@finch-studio/translation";
import { feColorMatrixValues } from "@finch-studio/schema";
import {
  getObjectColorCorrection,
  isNeutralColorCorrection,
} from "../colorCorrection";

/** Stable, attribute-safe SVG filter id for an object's correction. */
export function colorFilterIdFor(objectId: string): string {
  return `cc-${objectId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

import {
  handStrokeWidth,
  shapeOutlineStrokes,
  visibleStrokes,
  type DrawOnSample,
  type DrawOnTreatment,
} from "@finch-studio/motion";

export interface DrawOnRenderState {
  sample: DrawOnSample;
  treatment: DrawOnTreatment;
}

/**
 * A shape mid draw-on: the outline strokes revealed so far, in the
 * object's own fill colour (the marker colour), with the hand style's
 * stroke width. At full progress the caller renders the filled shape.
 */
function ShapeDrawOnView({
  object,
  drawOn,
}: {
  object: CourseObject;
  drawOn: DrawOnRenderState;
}) {
  const pos = object.position ?? {};
  const w = pos.w ?? 200;
  const h = pos.h ?? 100;
  const shape = (object as { shape?: string }).shape;
  const kind =
    shape === "ellipse" ? "ellipse" : shape === "line" ? "line" : "rect";
  const strokes = visibleStrokes(
    shapeOutlineStrokes(kind, w, h),
    drawOn.sample.progress,
  );
  const stroke = (object as { fill?: string }).fill ?? "#3b82f6";
  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {strokes.map((points, i) => (
        <polyline
          key={i}
          points={points.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke={stroke}
          strokeWidth={handStrokeWidth(drawOn.treatment.handStyle, 4)}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

function CharacterView({ object }: { object: CharacterObject }) {
  const tMs = useContext(SceneTimeContext);
  const dir = textDirectionOf(object);
  const def = defWithColors(characterForLegacyId(object.characterId), object.colors);
  const now = tMs ?? 0;
  const line = (object.speech ?? []).find(
    (sp) => now >= sp.start && now < sp.start + sp.duration,
  );
  const mouth = line?.text
    ? mouthAt(visemesFromText(line.text), now - line.start)
    : undefined;
  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <RiggedCharacter
        def={def}
        action={studioActionFor(object.characterAnimation)}
        tMs={now}
        {...(mouth ? { mouthOverride: mouth } : {})}
        style={{ width: "100%", height: "100%" }}
      />
      {line?.text && (
        <div
          className="speech-bubble"
          role="note"
          {...(dir ? { dir } : {})}
          style={dir === "rtl" ? { textAlign: "right" } : undefined}
        >
          {line.text}
        </div>
      )}
    </div>
  );
}

/**
 * Footage (video) object on the stage (issue #25). The shared footage
 * resolver maps the scene clock to a source time; the element plays at
 * the clip's speed and volume, pauses on the frozen frame during a
 * freeze hold, and shows only the crop rectangle when one is set. The
 * browser exports resolve the same mapping onto a canvas.
 */
function FootageView({ object }: { object: VideoObject }) {
  const tMs = useContext(SceneTimeContext);
  const videoRef = useRef<HTMLVideoElement>(null);
  const resolved = resolveFootageObject(object);
  const localMs = (tMs ?? 0) - footageClipStartMs(object);
  const at = footageSourceAt(resolved, localMs);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = resolved.speed;
    video.volume = resolved.volume;
    const targetSec = at.sourceMs / 1000;
    if (tMs === null || at.frozen || at.ended) {
      video.pause();
      if (Math.abs(video.currentTime - targetSec) > 0.05) {
        try {
          video.currentTime = targetSec;
        } catch {
          // Metadata not loaded yet; the next clock tick retries.
        }
      }
      return;
    }
    if (Math.abs(video.currentTime - targetSec) > 0.35) {
      try {
        video.currentTime = targetSec;
      } catch {
        // Metadata not loaded yet; the next clock tick retries.
      }
    }
    if (video.paused) void video.play().catch(() => {});
  }, [at.sourceMs, at.frozen, at.ended, resolved.speed, resolved.volume, tMs]);

  const crop = resolved.crop;
  const videoStyle: CSSProperties = crop
    ? {
        position: "absolute",
        width: `${100 / crop.w}%`,
        height: `${100 / crop.h}%`,
        left: `${(-crop.x / crop.w) * 100}%`,
        top: `${(-crop.y / crop.h) * 100}%`,
        objectFit: "fill",
      }
    : { width: "100%", height: "100%", objectFit: "fill" };
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
      <video
        ref={videoRef}
        src={object.resource}
        style={videoStyle}
        muted={resolved.volume === 0}
        playsInline
        preload="auto"
      />
    </div>
  );
}

function stripHtml(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return (div.textContent ?? "").trim();
}

export function StudioObjectRenderer({
  object,
  drawOn,
}: {
  object: CourseObject;
  drawOn?: DrawOnRenderState;
}) {
  switch (object.type) {
    case "character":
      return <CharacterView object={object} />;
    case "video":
      return <FootageView object={object as VideoObject} />;
    case "text": {
      const style: CSSProperties = {
        width: "100%",
        height: "100%",
        overflow: "hidden",
        fontSize: 22,
        lineHeight: 1.35,
      };
      const dir = textDirectionOf(object);
      return (
        <div
          style={style}
          {...(dir ? { dir } : {})}
          dangerouslySetInnerHTML={{ __html: object.content ?? "" }}
        />
      );
    }
    case "shape": {
      if (drawOn && drawOn.sample.progress < 1) {
        return <ShapeDrawOnView object={object} drawOn={drawOn} />;
      }
      const isEllipse = object.shape === "ellipse";
      return (
        <div
          style={{
            width: "100%",
            height: "100%",
            background: (object.fill as string) ?? "#3b82f6",
            borderRadius: isEllipse ? "50%" : 8,
          }}
        />
      );
    }
    case "image": {
      const src = (object as { resource?: string }).resource;
      if (!src) return <div className="studio-placeholder">🖼 image</div>;
      const correction = getObjectColorCorrection(object);
      if (isNeutralColorCorrection(correction)) {
        return (
          <img
            src={src}
            alt={object.alt ?? ""}
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
            draggable={false}
          />
        );
      }
      // The stage applies the same canonical colour matrix the exports
      // apply per pixel, via an SVG feColorMatrix filter.
      const filterId = colorFilterIdFor(object.id);
      return (
        <>
          <svg aria-hidden="true" style={{ position: "absolute", width: 0, height: 0 }}>
            <defs>
              <filter id={filterId} colorInterpolationFilters="sRGB">
                <feColorMatrix type="matrix" values={feColorMatrixValues(correction)} />
              </filter>
            </defs>
          </svg>
          <img
            src={src}
            alt={object.alt ?? ""}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              filter: `url(#${filterId})`,
            }}
            draggable={false}
          />
        </>
      );
    }
    default:
      return (
        <div className="studio-placeholder" title={`Type "${object.type}" renders in the course player`}>
          {object.type}
        </div>
      );
  }
}

/** Plain-text for export canvas. */
export function studioTextContent(object: CourseObject): string {
  if (object.type === "text") return stripHtml(object.content ?? "");
  return "";
}
