/**
 * Unified keyframe and path interpolation engine (issues #22 and #39,
 * merged into ONE engine per the Nov 18, 2026 roadmap amendment).
 *
 * One interpolation core serves preset motion paths and enter/exit presets
 * (the #22 surface) and full keyframe timeline handles (the #39 surface).
 * Easings: linear and cubic-bezier. Paths: polyline waypoints sampled with
 * Catmull-Rom spline smoothing. No DOM, no React: pure math, fully tested.
 */

export type EasingName = "linear" | "ease" | "ease-in" | "ease-out" | "ease-in-out";

export interface CubicBezier {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export const EASING_BEZIERS: Record<Exclude<EasingName, "linear">, CubicBezier> = {
  ease: { x1: 0.25, y1: 0.1, x2: 0.25, y2: 1 },
  "ease-in": { x1: 0.42, y1: 0, x2: 1, y2: 1 },
  "ease-out": { x1: 0, y1: 0, x2: 0.58, y2: 1 },
  "ease-in-out": { x1: 0.42, y1: 0, x2: 0.58, y2: 1 },
};

/** Solve a cubic bezier easing: given x in [0,1], return eased y. */
export function cubicBezierAt(b: CubicBezier, x: number): number {
  const cx = Math.min(1, Math.max(0, x));
  if (cx === 0 || cx === 1) return cx;
  // Newton iterations on the x curve, then evaluate y.
  let t = cx;
  for (let i = 0; i < 8; i++) {
    const xAt = bez(b.x1, b.x2, t);
    const dx = xAt - cx;
    if (Math.abs(dx) < 1e-6) break;
    const slope = bezSlope(b.x1, b.x2, t);
    if (Math.abs(slope) < 1e-6) break;
    t -= dx / slope;
  }
  return bez(b.y1, b.y2, t);
}

function bez(p1: number, p2: number, t: number): number {
  const u = 1 - t;
  return 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t;
}
function bezSlope(p1: number, p2: number, t: number): number {
  const u = 1 - t;
  return 3 * u * u * p1 + 6 * u * t * (p2 - p1) + 3 * t * t * (1 - p2);
}

export function easeValue(easing: EasingName | CubicBezier, t: number): number {
  if (easing === "linear") return Math.min(1, Math.max(0, t));
  const b = typeof easing === "string" ? EASING_BEZIERS[easing] : easing;
  return cubicBezierAt(b, t);
}

// ---------------------------------------------------------------------------
// Keyframe tracks (#39 surface)
// ---------------------------------------------------------------------------

export interface Keyframe {
  atMs: number;
  value: number;
  easing?: EasingName | CubicBezier;
}

export interface KeyframeTrack {
  property: "x" | "y" | "scale" | "rotation" | "opacity" | "volume";
  keyframes: Keyframe[];
}

/** Sample a keyframe track at tMs. Holds the edge values outside the range. */
export function sampleTrack(track: KeyframeTrack, tMs: number): number {
  const kfs = [...track.keyframes].sort((a, b) => a.atMs - b.atMs);
  if (kfs.length === 0) return 0;
  if (tMs <= kfs[0].atMs) return kfs[0].value;
  const last = kfs[kfs.length - 1];
  if (tMs >= last.atMs) return last.value;
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i];
    const b = kfs[i + 1];
    if (tMs >= a.atMs && tMs <= b.atMs) {
      const span = b.atMs - a.atMs;
      const local = span === 0 ? 1 : (tMs - a.atMs) / span;
      const eased = easeValue(b.easing ?? a.easing ?? "linear", local);
      return a.value + (b.value - a.value) * eased;
    }
  }
  return last.value;
}

// ---------------------------------------------------------------------------
// Motion paths (#22 surface): waypoints with per-segment easing, sampled
// along a Catmull-Rom spline through the waypoints.
// ---------------------------------------------------------------------------

export interface PathWaypoint {
  x: number;
  y: number;
  atMs: number;
  easing?: EasingName | CubicBezier;
}

export interface MotionPath {
  waypoints: PathWaypoint[];
  /** Spline smoothing through waypoints (true) or straight lines (false). */
  smooth: boolean;
}

function catmull(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

export function samplePath(path: MotionPath, tMs: number): { x: number; y: number } {
  const wps = [...path.waypoints].sort((a, b) => a.atMs - b.atMs);
  if (wps.length === 0) return { x: 0, y: 0 };
  if (tMs <= wps[0].atMs) return { x: wps[0].x, y: wps[0].y };
  const last = wps[wps.length - 1];
  if (tMs >= last.atMs) return { x: last.x, y: last.y };
  for (let i = 0; i < wps.length - 1; i++) {
    const a = wps[i];
    const b = wps[i + 1];
    if (tMs >= a.atMs && tMs <= b.atMs) {
      const span = b.atMs - a.atMs;
      const local = span === 0 ? 1 : (tMs - a.atMs) / span;
      const eased = easeValue(b.easing ?? a.easing ?? "linear", local);
      if (!path.smooth || wps.length < 3) {
        return {
          x: a.x + (b.x - a.x) * eased,
          y: a.y + (b.y - a.y) * eased,
        };
      }
      const p0 = wps[Math.max(0, i - 1)];
      const p3 = wps[Math.min(wps.length - 1, i + 2)];
      return {
        x: catmull(p0.x, a.x, b.x, p3.x, eased),
        y: catmull(p0.y, a.y, b.y, p3.y, eased),
      };
    }
  }
  return { x: last.x, y: last.y };
}

// ---------------------------------------------------------------------------
// Presets (#22/#38 surface): enter, exit, and emphasis motions expressed as
// keyframe tracks over an element, so presets and hand keyframed motion run
// through the exact same sampler.
// ---------------------------------------------------------------------------

export type MotionPresetName =
  | "fade-in"
  | "fade-out"
  | "slide-in-left"
  | "slide-in-right"
  | "slide-in-bottom"
  | "pop-in"
  | "pulse"
  | "float";

export function presetTracks(
  preset: MotionPresetName,
  opts: { durationMs: number; distancePx?: number },
): KeyframeTrack[] {
  const d = Math.max(1, opts.durationMs);
  const dist = opts.distancePx ?? 120;
  const two = (property: KeyframeTrack["property"], from: number, to: number, easing: EasingName): KeyframeTrack[] => [
    { property, keyframes: [{ atMs: 0, value: from }, { atMs: d, value: to, easing }] },
  ];
  switch (preset) {
    case "fade-in":
      return two("opacity", 0, 1, "ease-out");
    case "fade-out":
      return two("opacity", 1, 0, "ease-in");
    case "slide-in-left":
      return [...two("x", -dist, 0, "ease-out"), ...two("opacity", 0, 1, "ease-out")];
    case "slide-in-right":
      return [...two("x", dist, 0, "ease-out"), ...two("opacity", 0, 1, "ease-out")];
    case "slide-in-bottom":
      return [...two("y", dist, 0, "ease-out"), ...two("opacity", 0, 1, "ease-out")];
    case "pop-in":
      return [...two("scale", 0.6, 1, "ease-out"), ...two("opacity", 0, 1, "ease-out")];
    case "pulse":
      return [
        {
          property: "scale",
          keyframes: [
            { atMs: 0, value: 1 },
            { atMs: d / 2, value: 1.08, easing: "ease-in-out" },
            { atMs: d, value: 1, easing: "ease-in-out" },
          ],
        },
      ];
    case "float":
      return [
        {
          property: "y",
          keyframes: [
            { atMs: 0, value: 0 },
            { atMs: d / 2, value: -10, easing: "ease-in-out" },
            { atMs: d, value: 0, easing: "ease-in-out" },
          ],
        },
      ];
  }
}

/** Sample every track into a property map at tMs. */
export function sampleTracks(
  tracks: KeyframeTrack[],
  tMs: number,
): Partial<Record<KeyframeTrack["property"], number>> {
  const out: Partial<Record<KeyframeTrack["property"], number>> = {};
  for (const t of tracks) out[t.property] = sampleTrack(t, tMs);
  return out;
}
