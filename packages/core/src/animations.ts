/**
 * Timeline animation engine (SPEC §7.7, rev 24) — pure TypeScript, no DOM.
 *
 * Keyframe-lite model: each object may carry `animations.timeline`, an
 * array of tracks. A track animates one property over [start, start+duration]
 * ms from the scene start. `x`/`y` are pixel *offsets* applied on top of the
 * authored position; `scale` is a multiplier (1 = resting); `rotation` is
 * degrees; `opacity` is 0–1 absolute.
 *
 * Sampling semantics (documented in SPEC §7.7):
 *   t < start               → `from`
 *   start ≤ t ≤ start+dur   → eased interpolation from→to
 *   t > start+duration      → `to`
 * When tracks overlap on the same property, the later array entry wins.
 */
import type {
  AnimatableProperty,
  AnimationPresetName,
  AnimationTrack,
  CharacterAnimationName,
  CharacterId,
  CharacterWaypoint,
  EasingName,
} from "./types.js";

/** Default track duration (ms) when `duration` is omitted. */
export const DEFAULT_TRACK_DURATION_MS = 600;
/** Default scene duration (ms) when a page has tracks but no durationMs. */
export const DEFAULT_SCENE_DURATION_MS = 5000;

export const EASING_NAMES: readonly EasingName[] = [
  "linear",
  "easeIn",
  "easeOut",
  "easeInOut",
  "bounce",
] as const;

export const ANIMATABLE_PROPERTIES: readonly AnimatableProperty[] = [
  "x",
  "y",
  "opacity",
  "scale",
  "rotation",
] as const;

export const ANIMATION_PRESETS: ReadonlyArray<{
  name: AnimationPresetName;
  label: string;
  hint: string;
}> = [
  { name: "fadeIn", label: "Fade in", hint: "Opacity 0 → 1" },
  { name: "fadeOut", label: "Fade out", hint: "Opacity 1 → 0" },
  { name: "slideInLeft", label: "Slide in from left", hint: "Moves in from the left" },
  { name: "slideInRight", label: "Slide in from right", hint: "Moves in from the right" },
  { name: "slideInUp", label: "Slide in from bottom", hint: "Moves up into place" },
  { name: "slideInDown", label: "Slide in from top", hint: "Moves down into place" },
  { name: "zoomIn", label: "Zoom in", hint: "Scales up into place" },
  { name: "bounce", label: "Bounce in", hint: "Drops in with a bounce" },
];

/** Easing functions: input and output are both 0–1. */
export const EASINGS: Record<EasingName, (t: number) => number> = {
  linear: (t) => t,
  easeIn: (t) => t * t * t,
  easeOut: (t) => 1 - Math.pow(1 - t, 3),
  easeInOut: (t) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  bounce: (t) => {
    // Standard easeOutBounce.
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};

function normTrack(t: AnimationTrack): Required<AnimationTrack> {
  return {
    property: t.property,
    from: t.from,
    to: t.to,
    start: t.start ?? 0,
    duration: Math.max(1, t.duration ?? DEFAULT_TRACK_DURATION_MS),
    easing: t.easing ?? "easeOut",
  };
}

/**
 * Sample a single track at scene time `tMs`. Returns the property value.
 */
export function sampleTrack(track: AnimationTrack, tMs: number): number {
  const t = normTrack(track);
  if (tMs <= t.start) return t.from;
  if (tMs >= t.start + t.duration) return t.to;
  const p = (tMs - t.start) / t.duration;
  const eased = EASINGS[t.easing](p);
  return t.from + (t.to - t.from) * eased;
}

export type SampledValues = Partial<Record<AnimatableProperty, number>>;

/**
 * Sample a whole timeline at `tMs`. Later tracks win on overlap.
 * Returns only properties that have at least one track.
 */
export function sampleTimeline(
  timeline: AnimationTrack[] | undefined,
  tMs: number,
): SampledValues {
  const out: SampledValues = {};
  if (!timeline) return out;
  for (const track of timeline) {
    if (!ANIMATABLE_PROPERTIES.includes(track.property)) continue;
    out[track.property] = sampleTrack(track, tMs);
  }
  return out;
}

/**
 * Does this timeline contain any tracks?
 */
export function hasTimeline(timeline: AnimationTrack[] | undefined): boolean {
  return !!timeline && timeline.length > 0;
}

/**
 * End time of the timeline (max start+duration), 0 when empty.
 */
export function timelineEndMs(timeline: AnimationTrack[] | undefined): number {
  if (!timeline) return 0;
  let end = 0;
  for (const t of timeline) {
    const s = t.start ?? 0;
    const d = t.duration ?? DEFAULT_TRACK_DURATION_MS;
    if (s + d > end) end = s + d;
  }
  return end;
}

export interface PresetOptions {
  /** Start time in ms. Defaults to 0. */
  start?: number;
  /** Duration in ms. Defaults to 600. */
  duration?: number;
  /** Slide distance in px for slide presets. Defaults to 300. */
  distance?: number;
}

/**
 * Expand a one-click preset into timeline tracks (SPEC §7.7, rev 24).
 * `x`/`y` tracks are offsets from the authored position, so no base
 * geometry is needed.
 */
export function expandAnimationPreset(
  preset: AnimationPresetName,
  opts: PresetOptions = {},
): AnimationTrack[] {
  const start = opts.start ?? 0;
  const duration = opts.duration ?? DEFAULT_TRACK_DURATION_MS;
  const distance = opts.distance ?? 300;
  switch (preset) {
    case "fadeIn":
      return [{ property: "opacity", from: 0, to: 1, start, duration }];
    case "fadeOut":
      return [{ property: "opacity", from: 1, to: 0, start, duration }];
    case "slideInLeft":
      return [
        { property: "x", from: -distance, to: 0, start, duration },
        { property: "opacity", from: 0, to: 1, start, duration },
      ];
    case "slideInRight":
      return [
        { property: "x", from: distance, to: 0, start, duration },
        { property: "opacity", from: 0, to: 1, start, duration },
      ];
    case "slideInUp":
      return [
        { property: "y", from: distance, to: 0, start, duration },
        { property: "opacity", from: 0, to: 1, start, duration },
      ];
    case "slideInDown":
      return [
        { property: "y", from: -distance, to: 0, start, duration },
        { property: "opacity", from: 0, to: 1, start, duration },
      ];
    case "zoomIn":
      return [
        { property: "scale", from: 0.3, to: 1, start, duration },
        { property: "opacity", from: 0, to: 1, start, duration },
      ];
    case "bounce":
      return [
        {
          property: "y",
          from: -Math.max(80, distance / 3),
          to: 0,
          start,
          duration: Math.max(duration, 800),
          easing: "bounce",
        },
        { property: "opacity", from: 0, to: 1, start, duration: 300 },
      ];
  }
}

/**
 * Effective scene duration: explicit page.durationMs, else the timeline end
 * across all given timelines, else the default.
 */
export function sceneDurationMs(
  explicitMs: number | undefined,
  timelines: Array<AnimationTrack[] | undefined>,
): number {
  if (explicitMs !== undefined && explicitMs > 0) return explicitMs;
  let end = 0;
  for (const tl of timelines) {
    const e = timelineEndMs(tl);
    if (e > end) end = e;
  }
  return end > 0 ? end : DEFAULT_SCENE_DURATION_MS;
}

// ---------------------------------------------------------------------------
// Animated characters (SPEC §7.8, rev 25)
// ---------------------------------------------------------------------------

export const CHARACTER_IDS: ReadonlyArray<{
  id: CharacterId;
  label: string;
  hint: string;
}> = [
  { id: "businessman", label: "Business man", hint: "Suit and tie" },
  { id: "businesswoman", label: "Business woman", hint: "Blazer" },
  { id: "casualMan", label: "Casual man", hint: "T-shirt and jeans" },
  { id: "casualWoman", label: "Casual woman", hint: "Blouse" },
  { id: "student", label: "Student", hint: "Young, with backpack" },
  { id: "professor", label: "Professor", hint: "Glasses, cardigan" },
];

export const CHARACTER_ANIMATIONS: ReadonlyArray<{
  name: CharacterAnimationName;
  label: string;
  hint: string;
  /** Whether the animation loops (vs. plays once / holds a pose). */
  loops: boolean;
}> = [
  { name: "idle", label: "Idle", hint: "Subtle breathing sway", loops: true },
  { name: "walk", label: "Walk", hint: "Leg/arm swing cycle", loops: true },
  { name: "talk", label: "Talk", hint: "Mouth + head bob", loops: true },
  { name: "wave", label: "Wave", hint: "Friendly wave", loops: false },
  { name: "point", label: "Point", hint: "Arm extends", loops: false },
  { name: "nod", label: "Nod", hint: "Head nod", loops: false },
  { name: "shake", label: "Shake head", hint: "Head shake", loops: false },
  { name: "sit", label: "Sit", hint: "Seated pose", loops: false },
  { name: "stand", label: "Stand", hint: "Neutral standing", loops: false },
];

export interface PathSample {
  x: number;
  y: number;
  /** True when the character is between waypoints (in motion). */
  moving: boolean;
  /** Movement direction in degrees (0 = right, 180 = left). NaN when still. */
  angleDeg: number;
  /** Speed in px/sec (0 when still). Walk-cycle rate syncs to this. */
  speedPxPerSec: number;
}

/**
 * Catmull-Rom interpolation for one segment. p0..p3 are control points,
 * t is 0–1 within the p1→p2 segment.
 */
function catmullRom(
  p0: CharacterWaypoint,
  p1: CharacterWaypoint,
  p2: CharacterWaypoint,
  p3: CharacterWaypoint,
  t: number,
): { x: number; y: number } {
  const t2 = t * t;
  const t3 = t2 * t;
  const x =
    0.5 *
    (2 * p1.x +
      (-p0.x + p2.x) * t +
      (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
      (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
  const y =
    0.5 *
    (2 * p1.y +
      (-p0.y + p2.y) * t +
      (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
      (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
  return { x, y };
}

/**
 * Position-only path sample (no velocity). Internal.
 * Returns null when tMs is outside all segments.
 */
function samplePathPosition(
  pts: CharacterWaypoint[],
  tMs: number,
): { x: number; y: number; seg: number } | null {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (tMs >= a.t && tMs < b.t) {
      const speed = a.speed && a.speed > 0 ? a.speed : 1;
      const span = (b.t - a.t) / speed;
      const rawP = span > 0 ? (tMs - a.t) / span : 0;
      const p = Math.min(1, Math.max(0, rawP));
      const smooth = a.curve === "smooth" || b.curve === "smooth";
      if (smooth) {
        const p0 = pts[i - 1] ?? a;
        const p3 = pts[i + 2] ?? b;
        const { x, y } = catmullRom(p0, a, b, p3, p);
        return { x, y, seg: i };
      }
      return { x: a.x + (b.x - a.x) * p, y: a.y + (b.y - a.y) * p, seg: i };
    }
  }
  return null;
}

/**
 * Sample a character movement path at `tMs` (SPEC §7.8, rev 25).
 *
 * Waypoints are sorted by `t`. Position interpolates between waypoints:
 * - `curve: "smooth"` on either endpoint → Catmull-Rom spline segment
 *   (curved path); otherwise straight linear interpolation.
 * - `speed` on the starting waypoint scales traversal speed for that
 *   segment (segment duration ÷ speed).
 *
 * Before the first waypoint → first position (not moving); after the last
 * → last position (not moving).
 */
export function samplePath(
  path: CharacterWaypoint[] | undefined,
  tMs: number,
): PathSample {
  const still: PathSample = { x: 0, y: 0, moving: false, angleDeg: NaN, speedPxPerSec: 0 };
  if (!path || path.length === 0) return still;
  const pts = [...path].sort((a, b) => a.t - b.t);
  if (pts.length === 1 || tMs <= pts[0].t) {
    return { x: pts[0].x, y: pts[0].y, moving: false, angleDeg: NaN, speedPxPerSec: 0 };
  }
  const last = pts[pts.length - 1];
  if (tMs >= last.t) {
    return { x: last.x, y: last.y, moving: false, angleDeg: NaN, speedPxPerSec: 0 };
  }
  const pos = samplePathPosition(pts, tMs);
  if (!pos) {
    return { x: last.x, y: last.y, moving: false, angleDeg: NaN, speedPxPerSec: 0 };
  }
  // Velocity via a small forward position sample (handles curves).
  const b = pts[pos.seg + 1];
  const aheadT = Math.min(tMs + 24, b.t - 0.5);
  const ahead = aheadT > tMs ? samplePathPosition(pts, aheadT) : null;
  let speedPxPerSec = 0;
  let angleDeg = NaN;
  if (ahead) {
    const dtSec = Math.max(1, aheadT - tMs) / 1000;
    const vx = (ahead.x - pos.x) / dtSec;
    const vy = (ahead.y - pos.y) / dtSec;
    speedPxPerSec = Math.hypot(vx, vy);
    if (speedPxPerSec >= 1) angleDeg = (Math.atan2(vy, vx) * 180) / Math.PI;
  }
  return { x: pos.x, y: pos.y, moving: true, angleDeg, speedPxPerSec };
}

/**
 * End time of a path (last waypoint's `t`), 0 when empty.
 */
export function pathEndMs(path: CharacterWaypoint[] | undefined): number {
  if (!path || path.length === 0) return 0;
  let end = 0;
  for (const w of path) if (w.t > end) end = w.t;
  return end;
}

/**
 * Facing direction from a movement angle: left when moving leftward
 * (angle between 90° and 270°), right otherwise.
 */
export function facingFromAngle(angleDeg: number): "left" | "right" {
  if (Number.isNaN(angleDeg)) return "right";
  const a = ((angleDeg % 360) + 360) % 360;
  return a > 90 && a < 270 ? "left" : "right";
}
