/**
 * Whiteboard draw-on engine (issue #52).
 *
 * A whiteboard presentation style for scene objects: an object with a
 * draw-on treatment appears as if drawn progressively. Vector shapes
 * reveal stroke by stroke along their outline; text and images reveal
 * with a wipe that matches the same progress value. Erase and replace
 * is the same treatment run in reverse: after a hold, progress falls
 * back to zero and the object is gone, so a replacement object whose
 * timeline placement starts at that point draws in its place.
 *
 * Everything here is a pure, deterministic function of time and the
 * authored treatment. The stage, the client export paths, and the
 * server render (which runs the client export path headlessly) all
 * resolve the same progress at any timestamp, so scrubbing, playback,
 * and exports never diverge. Objects without a treatment never call
 * into this module and behave exactly as before.
 *
 * The look is data, not chrome: the board surface is the scene's own
 * background data and the marker colour is the object's own fill or
 * text colour. Hand styles only change stroke weight and line joins.
 */
import { easeValue, type EasingName } from "./motion.js";

/** Drawing hand styles: same drawing, different marker feel. */
export type WhiteboardHandStyle = "marker" | "chalk" | "pen";

export const WHITEBOARD_HAND_STYLES: ReadonlyArray<{
  name: WhiteboardHandStyle;
  label: string;
  hint: string;
  /** Stroke width multiplier against the base width for the object. */
  strokeScale: number;
}> = [
  { name: "marker", label: "Marker", hint: "Standard whiteboard marker", strokeScale: 1 },
  { name: "chalk", label: "Chalk", hint: "Wider, softer stroke", strokeScale: 1.7 },
  { name: "pen", label: "Pen", hint: "Thin, precise stroke", strokeScale: 0.55 },
];

export function handStyleStrokeScale(handStyle: WhiteboardHandStyle | undefined): number {
  return WHITEBOARD_HAND_STYLES.find((s) => s.name === handStyle)?.strokeScale ?? 1;
}

/** Stroke width for a hand style at a base width (never below 1). */
export function handStrokeWidth(
  handStyle: WhiteboardHandStyle | undefined,
  baseWidth: number,
): number {
  return Math.max(1, baseWidth * handStyleStrokeScale(handStyle));
}

/**
 * The authored draw-on treatment on one object. All fields optional:
 * an empty treatment draws over the object's full timeline placement.
 */
export interface DrawOnTreatment {
  /** Draw duration in ms. Defaults to the object's clip duration. */
  durationMs?: number;
  handStyle?: WhiteboardHandStyle;
  /** Easing for draw and erase progress. Defaults to linear. */
  easing?: EasingName;
  /** Hold in ms at full draw before erasing starts. */
  eraseDelayMs?: number;
  /** Erase duration in ms. Unset or 0 means the object never erases. */
  eraseDurationMs?: number;
}

export type DrawOnPhase = "before" | "drawing" | "holding" | "erasing" | "erased";

export interface DrawOnSample {
  /** Visible fraction of the object, 0 to 1. */
  progress: number;
  phase: DrawOnPhase;
  /** False before the draw starts and after an erase completes. */
  visible: boolean;
}

/** Effective draw duration: the authored value clamped to the clip. */
export function resolveDrawDurationMs(
  treatment: DrawOnTreatment,
  clipDurationMs: number,
): number {
  const clip = Math.max(1, clipDurationMs);
  const authored = treatment.durationMs;
  if (authored === undefined || !Number.isFinite(authored) || authored <= 0) return clip;
  return Math.min(clip, Math.max(1, authored));
}

/**
 * Sample the draw-on treatment at scene time `tMs`, where the object's
 * clip starts at `startMs` and runs `clipDurationMs`. Pure: the same
 * inputs always give the same sample, at any timestamp, in any engine.
 *
 * Bounds: at or before the start, progress is 0 (phase "before" ahead
 * of the start, "drawing" at it). After the draw completes the object
 * holds at 1 unless an erase is authored, in which case progress
 * returns to 0 and the phase ends at "erased".
 */
export function sampleDrawOn(
  treatment: DrawOnTreatment,
  startMs: number,
  clipDurationMs: number,
  tMs: number,
): DrawOnSample {
  const local = tMs - startMs;
  if (local < 0) return { progress: 0, phase: "before", visible: false };
  const easing = treatment.easing ?? "linear";
  const drawMs = resolveDrawDurationMs(treatment, clipDurationMs);
  if (local < drawMs) {
    return {
      progress: easeValue(easing, local / drawMs),
      phase: "drawing",
      visible: local > 0,
    };
  }
  const eraseMs = treatment.eraseDurationMs ?? 0;
  if (eraseMs > 0) {
    const eraseStart = drawMs + Math.max(0, treatment.eraseDelayMs ?? 0);
    if (local >= eraseStart + eraseMs) {
      return { progress: 0, phase: "erased", visible: false };
    }
    if (local >= eraseStart) {
      return {
        progress: 1 - easeValue(easing, (local - eraseStart) / eraseMs),
        phase: "erasing",
        visible: true,
      };
    }
  }
  return { progress: 1, phase: "holding", visible: true };
}

/** Just the progress value at a timestamp (the sample's progress). */
export function drawProgressAt(
  treatment: DrawOnTreatment,
  startMs: number,
  clipDurationMs: number,
  tMs: number,
): number {
  return sampleDrawOn(treatment, startMs, clipDurationMs, tMs).progress;
}

// ---------------------------------------------------------------------------
// Stroke reveal math for vector shapes. A shape outline is a list of
// strokes; progress is allocated across strokes in order, proportional
// to each stroke's length, so a shape draws stroke by stroke and the
// drawing tip always sits at the end of the visible portion.
// ---------------------------------------------------------------------------

export interface StrokePoint {
  x: number;
  y: number;
}

export function polylineLength(points: readonly StrokePoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

export function totalStrokeLength(strokes: readonly (readonly StrokePoint[])[]): number {
  return strokes.reduce((sum, s) => sum + polylineLength(s), 0);
}

/** The visible prefix of one polyline at a visible length in px. */
export function visiblePolyline(
  points: readonly StrokePoint[],
  visibleLength: number,
): StrokePoint[] {
  if (visibleLength <= 0 || points.length === 0) return [];
  const out: StrokePoint[] = [points[0]];
  let remaining = visibleLength;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (seg === 0) continue;
    if (remaining >= seg) {
      out.push(b);
      remaining -= seg;
    } else {
      const f = remaining / seg;
      out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
      return out;
    }
  }
  return out;
}

/**
 * The visible strokes at `progress` (0 to 1): whole strokes whose share
 * of the total length is covered, plus the partial stroke in progress.
 */
export function visibleStrokes(
  strokes: readonly (readonly StrokePoint[])[],
  progress: number,
): StrokePoint[][] {
  const p = Math.min(1, Math.max(0, progress));
  if (p <= 0) return [];
  if (p >= 1) return strokes.map((s) => s.map((pt) => ({ ...pt })));
  let budget = p * totalStrokeLength(strokes);
  const out: StrokePoint[][] = [];
  for (const stroke of strokes) {
    if (budget <= 0) break;
    const len = polylineLength(stroke);
    if (len === 0) continue;
    if (budget >= len) {
      out.push(stroke.map((pt) => ({ ...pt })));
      budget -= len;
    } else {
      const partial = visiblePolyline(stroke, budget);
      if (partial.length > 1) out.push(partial);
      budget = 0;
    }
  }
  return out;
}

/** The drawing tip: the last visible point, or null when nothing shows. */
export function drawTipPoint(
  strokes: readonly (readonly StrokePoint[])[],
  progress: number,
): StrokePoint | null {
  const visible = visibleStrokes(strokes, progress);
  const last = visible[visible.length - 1];
  return last?.[last.length - 1] ?? null;
}

/** SVG stroke dash values that reveal `progress` of a single path. */
export function strokeDashFor(
  totalLength: number,
  progress: number,
): { strokeDasharray: string; strokeDashoffset: number } {
  const len = Math.max(0, totalLength);
  const p = Math.min(1, Math.max(0, progress));
  return { strokeDasharray: `${len}`, strokeDashoffset: len * (1 - p) };
}

/**
 * Outline strokes for the studio shape kinds, in drawing order, in the
 * object's local box (origin top left, `w` by `h` px).
 */
export function shapeOutlineStrokes(
  shape: "rect" | "ellipse" | "line" | "arrow",
  w: number,
  h: number,
): StrokePoint[][] {
  const width = Math.max(0, w);
  const height = Math.max(0, h);
  switch (shape) {
    case "rect":
      // One stroke per edge, drawn clockwise from the top left.
      return [
        [{ x: 0, y: 0 }, { x: width, y: 0 }],
        [{ x: width, y: 0 }, { x: width, y: height }],
        [{ x: width, y: height }, { x: 0, y: height }],
        [{ x: 0, y: height }, { x: 0, y: 0 }],
      ];
    case "ellipse": {
      const points: StrokePoint[] = [];
      const steps = 48;
      for (let i = 0; i <= steps; i++) {
        const a = -Math.PI / 2 + (i / steps) * Math.PI * 2;
        points.push({
          x: width / 2 + (width / 2) * Math.cos(a),
          y: height / 2 + (height / 2) * Math.sin(a),
        });
      }
      return [points];
    }
    case "line":
      return [[{ x: 0, y: height }, { x: width, y: 0 }]];
    case "arrow": {
      const midY = height / 2;
      const head = Math.min(24, Math.max(8, width * 0.2));
      const headDy = Math.min(height / 2, head * 0.7);
      return [
        [{ x: 0, y: midY }, { x: width, y: midY }],
        [{ x: width, y: midY }, { x: width - head, y: midY - headDy }],
        [{ x: width, y: midY }, { x: width - head, y: midY + headDy }],
      ];
    }
  }
}

// ---------------------------------------------------------------------------
// Wipe reveal for text and images. The reveal travels in one direction
// and matches the wipe semantics the timeline engine already uses
// (animatedStyle): revealing from the left clips the right inset.
// ---------------------------------------------------------------------------

export type WipeRevealDirection = "right" | "left" | "down" | "up";

/** CSS clip-path inset string revealing `progress` of a box. */
export function wipeClipPath(progress: number, direction: WipeRevealDirection = "right"): string {
  const hidden = (1 - Math.min(1, Math.max(0, progress))) * 100;
  const pct = Math.round(hidden * 1000) / 1000;
  switch (direction) {
    case "right":
      return `inset(0 ${pct}% 0 0)`;
    case "left":
      return `inset(0 0 0 ${pct}%)`;
    case "down":
      return `inset(0 0 ${pct}% 0)`;
    case "up":
      return `inset(${pct}% 0 0 0)`;
  }
}

/** The visible rectangle fraction for canvas clipping, same reveal. */
export function wipeVisibleRect(
  progress: number,
  w: number,
  h: number,
  direction: WipeRevealDirection = "right",
): { x: number; y: number; w: number; h: number } {
  const p = Math.min(1, Math.max(0, progress));
  switch (direction) {
    case "right":
      return { x: 0, y: 0, w: w * p, h };
    case "left":
      return { x: w * (1 - p), y: 0, w: w * p, h };
    case "down":
      return { x: 0, y: 0, w, h: h * p };
    case "up":
      return { x: 0, y: h * (1 - p), w, h: h * p };
  }
}
