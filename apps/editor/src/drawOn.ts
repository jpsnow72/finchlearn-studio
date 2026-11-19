/**
 * Whiteboard draw-on data access (issue #52).
 *
 * The treatment is scene/object DATA under the object's existing
 * x-finch-studio extension (the same channel as timeline lane and
 * voice metadata), and the whiteboard scene style lives under the
 * scene's x-finch-studio extension. The timing and stroke math lives
 * in @finch-studio/motion (sampleDrawOn and friends); this module only
 * reads, writes, and samples that data for editor objects, so the
 * stage and both export paths resolve identical progress values.
 */
import type { CourseObject, VideoScene } from "@finch-studio/core";
import {
  sampleDrawOn,
  type DrawOnSample,
  type DrawOnTreatment,
} from "@finch-studio/motion";

const STUDIO_EXTENSION = "x-finch-studio";

/** Object kinds the whiteboard style supports. */
export const DRAW_ON_OBJECT_TYPES: readonly string[] = ["shape", "text", "image"];

export interface WhiteboardSceneData {
  /** Board surface colour (scene data). Unset uses the scene background. */
  surface?: string;
}

/** The authored draw-on treatment on an object, or undefined. */
export function drawOnForObject(object: CourseObject): DrawOnTreatment | undefined {
  const raw = object.extensions?.[STUDIO_EXTENSION]?.drawOn;
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const out: DrawOnTreatment = {};
  if (typeof r.durationMs === "number" && Number.isFinite(r.durationMs)) out.durationMs = r.durationMs;
  if (r.handStyle === "marker" || r.handStyle === "chalk" || r.handStyle === "pen") out.handStyle = r.handStyle;
  if (r.easing === "linear" || r.easing === "ease" || r.easing === "ease-in" || r.easing === "ease-out" || r.easing === "ease-in-out") {
    out.easing = r.easing;
  }
  if (typeof r.eraseDelayMs === "number" && Number.isFinite(r.eraseDelayMs)) out.eraseDelayMs = r.eraseDelayMs;
  if (typeof r.eraseDurationMs === "number" && Number.isFinite(r.eraseDurationMs)) out.eraseDurationMs = r.eraseDurationMs;
  return out;
}

/** A copy of the object with its draw-on treatment set or removed. */
export function withDrawOn(
  object: CourseObject,
  treatment: DrawOnTreatment | undefined,
): CourseObject {
  const meta: Record<string, unknown> = { ...(object.extensions?.[STUDIO_EXTENSION] ?? {}) };
  if (treatment === undefined) delete meta.drawOn;
  else meta.drawOn = { ...treatment };
  return {
    ...object,
    extensions: { ...object.extensions, [STUDIO_EXTENSION]: meta },
  } as CourseObject;
}

/** The whiteboard scene style on a scene, or undefined. */
export function whiteboardForScene(scene: VideoScene): WhiteboardSceneData | undefined {
  const raw = scene.extensions?.[STUDIO_EXTENSION]?.whiteboard;
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  return typeof r.surface === "string" ? { surface: r.surface } : {};
}

/** A copy of the scene with its whiteboard style set or removed. */
export function withSceneWhiteboard(
  scene: VideoScene,
  whiteboard: WhiteboardSceneData | undefined,
): VideoScene {
  const meta: Record<string, unknown> = { ...(scene.extensions?.[STUDIO_EXTENSION] ?? {}) };
  if (whiteboard === undefined) delete meta.whiteboard;
  else meta.whiteboard = { ...whiteboard };
  return {
    ...scene,
    extensions: { ...scene.extensions, [STUDIO_EXTENSION]: meta },
  };
}

/**
 * The board surface a scene renders on: the whiteboard surface when
 * the scene carries the whiteboard style, else undefined (callers fall
 * back to the scene background, then the existing white default).
 */
export function whiteboardSurfaceForScene(scene: VideoScene): string | undefined {
  const whiteboard = whiteboardForScene(scene);
  if (!whiteboard) return undefined;
  return whiteboard.surface ?? scene.background ?? "#ffffff";
}

/**
 * Sample an object's draw-on treatment at scene time `tMs` for the
 * clip range the stage and exports already computed for it. Returns
 * null for objects without a treatment (they behave exactly as
 * before) and for kinds the whiteboard style does not support.
 */
export function sampleDrawOnForObject(
  object: CourseObject,
  range: { startMs: number; durationMs: number },
  tMs: number,
): DrawOnSample | null {
  if (!DRAW_ON_OBJECT_TYPES.includes(object.type)) return null;
  const treatment = drawOnForObject(object);
  if (!treatment) return null;
  return sampleDrawOn(treatment, range.startMs, range.durationMs, tMs);
}
