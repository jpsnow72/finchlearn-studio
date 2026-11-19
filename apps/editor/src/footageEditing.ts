/**
 * footageEditing: per-clip footage edits for editor video objects
 * (issue #25): trim, speed, freeze frame, volume, picture-in-picture
 * layout, and crop.
 *
 * Like audio clip metadata, the edits live under the object's
 * x-finch-studio extension so they persist with the project JSON and
 * share the store's one undo stack. All math goes through
 * @finch-studio/schema's footage resolver, the same resolver the
 * Studio schema elements use, so stage preview, browser exports, and
 * the server render (the same export code in headless Chrome) resolve
 * a clip identically.
 *
 * Legacy video objects carry no footage metadata beyond the timeline's
 * sourceInMs: they resolve to the full timeline clip at speed 1 and
 * full volume, exactly as before.
 */
import type { Extensions, VideoObject } from "@finch-studio/core";
import {
  clampFootageSpeed,
  resolveFootageEdit,
  type FootageCrop,
  type FootageFreeze,
  type FootagePipLayout,
  type ResolvedFootage,
} from "@finch-studio/schema";

export interface FootageClipMetadata {
  sourceInMs?: number;
  sourceOutMs?: number;
  /** Full source length when known; used to clamp trims in the panel. */
  sourceDurationMs?: number;
  speed?: number;
  volume?: number;
  freeze?: FootageFreeze;
  crop?: FootageCrop;
  pipLayout?: FootagePipLayout;
}

/** A footage patch; null freeze, crop, or pipLayout clears that edit. */
export type FootageClipPatch = Partial<
  Omit<FootageClipMetadata, "freeze" | "crop" | "pipLayout">
> & {
  freeze?: FootageFreeze | null;
  crop?: FootageCrop | null;
  pipLayout?: FootagePipLayout | null;
};

/** Stage frame the PiP presets resolve against (StudioCanvas SCENE_W/H). */
export const FOOTAGE_STAGE_W = 1280;
export const FOOTAGE_STAGE_H = 720;

const FOOTAGE_EXTENSION = "x-finch-studio";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : undefined;
}

function readFreeze(value: unknown): FootageFreeze | undefined {
  if (!isRecord(value)) return undefined;
  const atSourceMs = finiteNonNegative(value.atSourceMs);
  const durationMs = finiteNonNegative(value.durationMs);
  if (atSourceMs === undefined || durationMs === undefined) return undefined;
  return { atSourceMs, durationMs };
}

function readCrop(value: unknown): FootageCrop | undefined {
  if (!isRecord(value)) return undefined;
  const { x, y, w, h } = value;
  if (
    typeof x !== "number" || typeof y !== "number" ||
    typeof w !== "number" || typeof h !== "number" ||
    ![x, y, w, h].every(Number.isFinite)
  ) {
    return undefined;
  }
  return { x, y, w, h };
}

export function getFootageClipMetadata(object: VideoObject): FootageClipMetadata {
  const raw = object.extensions?.[FOOTAGE_EXTENSION];
  if (!isRecord(raw)) return {};
  return {
    sourceInMs: finiteNonNegative(raw.sourceInMs),
    sourceOutMs: finiteNonNegative(raw.sourceOutMs),
    sourceDurationMs: finiteNonNegative(raw.sourceDurationMs),
    speed:
      typeof raw.speed === "number" && Number.isFinite(raw.speed)
        ? raw.speed
        : undefined,
    volume:
      typeof raw.volume === "number" && Number.isFinite(raw.volume)
        ? raw.volume
        : undefined,
    freeze: readFreeze(raw.freeze),
    crop: readCrop(raw.crop),
    pipLayout:
      typeof raw.pipLayout === "string"
        ? (raw.pipLayout as FootagePipLayout)
        : undefined,
  };
}

/**
 * Merge a footage patch into the object's studio extension. Other
 * extension keys (timeline lane, voice, audio metadata) are preserved;
 * a null freeze, crop, or pipLayout clears that edit.
 */
export function withFootageClipMetadata(
  object: VideoObject,
  patch: FootageClipPatch,
): VideoObject {
  const existing: Record<string, unknown> = {
    ...(object.extensions?.[FOOTAGE_EXTENSION] ?? {}),
  };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) delete existing[key];
    else existing[key] = value;
  }
  const extensions: Extensions = { ...(object.extensions ?? {}) };
  extensions[FOOTAGE_EXTENSION] = existing;
  return { ...object, extensions };
}

/**
 * Resolve a video object's footage edit. When no explicit source out
 * point is stored, the out point derives from the object's timeline
 * duration (the legacy shape), so old clips resolve unchanged.
 */
export function resolveFootageObject(object: VideoObject): ResolvedFootage {
  const meta = getFootageClipMetadata(object);
  const sourceInMs = meta.sourceInMs ?? 0;
  const speed = clampFootageSpeed(meta.speed);
  const freezeDurationMs = meta.freeze?.durationMs ?? 0;
  const timelineDurationMs = Math.max(
    100,
    (object.timing?.duration ?? 5) * 1000,
  );
  const sourceOutMs =
    meta.sourceOutMs ??
    sourceInMs + Math.max(1, timelineDurationMs - freezeDurationMs) * speed;
  return resolveFootageEdit({
    sourceInMs,
    sourceOutMs,
    speed,
    volume: meta.volume ?? 1,
    freeze: meta.freeze,
    crop: meta.crop,
    pipLayout: meta.pipLayout,
  });
}

/** Timeline start of a video object within its scene, in ms. */
export function footageClipStartMs(object: VideoObject): number {
  return Math.max(0, (object.timing?.start ?? 0) * 1000);
}
