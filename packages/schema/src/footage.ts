/**
 * Footage editing model (issue #25): trim, speed, freeze frame, volume,
 * picture-in-picture layouts, and crop for footage (video) elements.
 *
 * Every footage edit is non-destructive metadata on the element. This
 * module is the ONE resolver every surface uses: the stage preview, the
 * browser export paths, and the server render (which runs the same
 * editor export code in headless Chrome) all map a timeline offset to a
 * source time, a crop rectangle, and a gain through these functions, so
 * the surfaces cannot drift apart.
 *
 * Backward compatible: a legacy footage element carries only
 * sourceInMs / sourceOutMs / speed / volume. Resolving it yields a
 * single play segment, no freeze, no crop, and no PiP preset, which is
 * exactly how it behaves today.
 */

export interface FootageCrop {
  /** Fractions of the source frame, each in 0..1. */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FootageFreeze {
  /** Source time of the held frame, inside the trim range. */
  atSourceMs: number;
  /** How long the frame is held on the timeline. */
  durationMs: number;
}

export type FootagePipLayout =
  | "full"
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "split-left"
  | "split-right";

export const FOOTAGE_PIP_LAYOUTS: readonly FootagePipLayout[] = [
  "full",
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
  "split-left",
  "split-right",
];

/** The speed menu offered in the editor (issue #25: 0.5x to 2x). */
export const FOOTAGE_SPEEDS: readonly number[] = [0.5, 0.75, 1, 1.25, 1.5, 2];
export const FOOTAGE_MIN_SPEED = 0.5;
export const FOOTAGE_MAX_SPEED = 2;
/** Smallest crop dimension, as a fraction of the source frame. */
export const FOOTAGE_MIN_CROP = 0.05;

export interface FootageEdit {
  sourceInMs: number;
  sourceOutMs: number;
  speed: number;
  /** Linear gain, 0 (silent) to 1 (full). */
  volume: number;
  freeze?: FootageFreeze;
  crop?: FootageCrop;
  pipLayout?: FootagePipLayout;
}

export type FootageSegment =
  | {
      kind: "play";
      timelineStartMs: number;
      durationMs: number;
      sourceStartMs: number;
      sourceEndMs: number;
      speed: number;
    }
  | {
      kind: "freeze";
      timelineStartMs: number;
      durationMs: number;
      sourceStartMs: number;
      sourceEndMs: number;
      speed: number;
    };

export interface ResolvedFootage {
  sourceInMs: number;
  sourceOutMs: number;
  speed: number;
  volume: number;
  freeze: FootageFreeze | null;
  crop: FootageCrop | null;
  pipLayout: FootagePipLayout | null;
  /** Timeline time spent playing source (trim length divided by speed). */
  playingDurationMs: number;
  /** Total timeline duration: playing time plus any freeze hold. */
  timelineDurationMs: number;
  segments: FootageSegment[];
}

function finite(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function clampFootageSpeed(speed: number | undefined): number {
  return Math.min(
    FOOTAGE_MAX_SPEED,
    Math.max(FOOTAGE_MIN_SPEED, finite(speed, 1)),
  );
}

export function clampFootageVolume(volume: number | undefined): number {
  return Math.min(1, Math.max(0, finite(volume, 1)));
}

/** Linear gain for a footage volume (the audio model is linear gain). */
export function footageGain(volume: number | undefined): number {
  return clampFootageVolume(volume);
}

export function footageVolumeToDecibels(volume: number | undefined): number {
  const gain = clampFootageVolume(volume);
  if (gain <= 0) return -60;
  return Math.max(-60, Math.min(0, 20 * Math.log10(gain)));
}

export function decibelsToFootageVolume(decibels: number): number {
  const db = Math.max(-60, Math.min(0, finite(decibels, 0)));
  return clampFootageVolume(10 ** (db / 20));
}

/**
 * Clamp a crop rectangle into the unit square: origin inside the frame,
 * size at least FOOTAGE_MIN_CROP, and never extending past the edges.
 */
export function clampCropRect(crop: FootageCrop): FootageCrop {
  const w = Math.min(1, Math.max(FOOTAGE_MIN_CROP, finite(crop.w, 1)));
  const h = Math.min(1, Math.max(FOOTAGE_MIN_CROP, finite(crop.h, 1)));
  const x = Math.min(1 - w, Math.max(0, finite(crop.x, 0)));
  const y = Math.min(1 - h, Math.max(0, finite(crop.y, 0)));
  return { x, y, w, h };
}

/** Crop rectangle in source pixels for a source of the given size. */
export function cropRectToPixels(
  crop: FootageCrop,
  sourceWidth: number,
  sourceHeight: number,
): { x: number; y: number; w: number; h: number } {
  const c = clampCropRect(crop);
  const w = Math.max(1, Math.min(sourceWidth, Math.round(c.w * sourceWidth)));
  const h = Math.max(1, Math.min(sourceHeight, Math.round(c.h * sourceHeight)));
  const x = Math.max(0, Math.min(sourceWidth - w, Math.round(c.x * sourceWidth)));
  const y = Math.max(0, Math.min(sourceHeight - h, Math.round(c.y * sourceHeight)));
  return { x, y, w, h };
}

/**
 * Stage rectangle (in stage pixels) for a PiP layout preset. Corners are
 * insets at 32 percent of the frame with a margin; splits take one half
 * of the frame; full takes the whole frame.
 */
export function pipLayoutRect(
  layout: FootagePipLayout,
  frameWidth: number,
  frameHeight: number,
): { x: number; y: number; w: number; h: number } {
  const margin = Math.round(Math.min(frameWidth, frameHeight) * 0.033);
  const insetW = Math.round(frameWidth * 0.32);
  const insetH = Math.round(frameHeight * 0.32);
  switch (layout) {
    case "top-left":
      return { x: margin, y: margin, w: insetW, h: insetH };
    case "top-right":
      return { x: frameWidth - margin - insetW, y: margin, w: insetW, h: insetH };
    case "bottom-left":
      return { x: margin, y: frameHeight - margin - insetH, w: insetW, h: insetH };
    case "bottom-right":
      return {
        x: frameWidth - margin - insetW,
        y: frameHeight - margin - insetH,
        w: insetW,
        h: insetH,
      };
    case "split-left":
      return { x: 0, y: 0, w: Math.round(frameWidth / 2), h: frameHeight };
    case "split-right":
      return {
        x: Math.round(frameWidth / 2),
        y: 0,
        w: frameWidth - Math.round(frameWidth / 2),
        h: frameHeight,
      };
    case "full":
    default:
      return { x: 0, y: 0, w: frameWidth, h: frameHeight };
  }
}

/**
 * Resolve a footage edit into clamped values plus its timeline
 * segments. A freeze splits the play range at the frozen source time:
 * play up to it, hold the frame, then play the remainder.
 */
export function resolveFootageEdit(edit: FootageEdit): ResolvedFootage {
  const sourceInMs = Math.max(0, Math.round(finite(edit.sourceInMs, 0)));
  const rawOut = Math.round(finite(edit.sourceOutMs, sourceInMs));
  const sourceOutMs = Math.max(sourceInMs + 1, rawOut);
  const speed = clampFootageSpeed(edit.speed);
  const volume = clampFootageVolume(edit.volume);

  let freeze: FootageFreeze | null = null;
  if (edit.freeze && finite(edit.freeze.durationMs, 0) > 0) {
    freeze = {
      atSourceMs: Math.min(
        sourceOutMs,
        Math.max(sourceInMs, Math.round(finite(edit.freeze.atSourceMs, sourceInMs))),
      ),
      durationMs: Math.round(edit.freeze.durationMs),
    };
  }

  const playingDurationMs = (sourceOutMs - sourceInMs) / speed;
  const timelineDurationMs = playingDurationMs + (freeze?.durationMs ?? 0);

  const segments: FootageSegment[] = [];
  if (freeze && freeze.atSourceMs > sourceInMs) {
    segments.push({
      kind: "play",
      timelineStartMs: 0,
      durationMs: (freeze.atSourceMs - sourceInMs) / speed,
      sourceStartMs: sourceInMs,
      sourceEndMs: freeze.atSourceMs,
      speed,
    });
  }
  if (freeze) {
    segments.push({
      kind: "freeze",
      timelineStartMs: segments.reduce((sum, s) => sum + s.durationMs, 0),
      durationMs: freeze.durationMs,
      sourceStartMs: freeze.atSourceMs,
      sourceEndMs: freeze.atSourceMs,
      speed,
    });
  }
  if (!freeze || freeze.atSourceMs < sourceOutMs) {
    const playedBefore = freeze
      ? Math.max(0, (freeze.atSourceMs - sourceInMs) / speed) + freeze.durationMs
      : 0;
    segments.push({
      kind: "play",
      timelineStartMs: playedBefore,
      durationMs:
        (sourceOutMs - (freeze ? freeze.atSourceMs : sourceInMs)) / speed,
      sourceStartMs: freeze ? freeze.atSourceMs : sourceInMs,
      sourceEndMs: sourceOutMs,
      speed,
    });
  }

  return {
    sourceInMs,
    sourceOutMs,
    speed,
    volume,
    freeze,
    crop: edit.crop ? clampCropRect(edit.crop) : null,
    pipLayout: edit.pipLayout ?? null,
    playingDurationMs,
    timelineDurationMs,
    segments,
  };
}

/** Timeline duration a footage edit occupies, freeze hold included. */
export function footageTimelineDurationMs(edit: FootageEdit): number {
  return resolveFootageEdit(edit).timelineDurationMs;
}

export interface FootageSourceAt {
  sourceMs: number;
  frozen: boolean;
  ended: boolean;
}

/**
 * The source time shown at a timeline offset inside the clip. This is
 * the mapping stage, browser export, and server render all share.
 */
export function footageSourceAt(
  resolved: ResolvedFootage,
  timelineOffsetMs: number,
): FootageSourceAt {
  const offset = finite(timelineOffsetMs, 0);
  if (offset < 0) return { sourceMs: resolved.sourceInMs, frozen: false, ended: false };
  for (const segment of resolved.segments) {
    if (offset < segment.timelineStartMs + segment.durationMs) {
      if (segment.kind === "freeze") {
        return { sourceMs: segment.sourceStartMs, frozen: true, ended: false };
      }
      return {
        sourceMs:
          segment.sourceStartMs +
          (offset - segment.timelineStartMs) * segment.speed,
        frozen: false,
        ended: false,
      };
    }
  }
  return { sourceMs: resolved.sourceOutMs, frozen: false, ended: true };
}
