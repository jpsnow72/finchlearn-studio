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
  AnimationPreset,
  AnimationPresetName,
  Animations,
  AnimationTrack,
  CharacterAnimationName,
  CharacterId,
  CharacterWaypoint,
  EasingName,
} from "./types.js";
import {
  effectVariantCategory,
  getEffect,
  getEffectVariant,
  listEffectVariants,
  type EffectTrackRecipe,
  type EffectVariantEntry,
} from "./effects.js";

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
  "pulse",
  "shake",
] as const;

export const ANIMATABLE_PROPERTIES: readonly AnimatableProperty[] = [
  "x",
  "y",
  "opacity",
  "scale",
  "rotation",
  "wipeLeft",
  "wipeRight",
  "wipeUp",
  "wipeDown",
] as const;

/**
 * The Studio picker groups, mapped from the Shared Effects Core
 * registry taxonomy (effects.ts, issue #111): registry entrance and
 * text variants sit in Enter, exits in Exit, emphasis in Emphasis,
 * and motion plus continuous variants in Motion (float always lived
 * in the Studio motion package). The EffectsEditor in the editor app
 * filters on exactly these four groups, so every registry variant
 * stays reachable in its historical group.
 */
function pickerCategory(
  entry: EffectVariantEntry,
): "enter" | "exit" | "emphasis" | "motion" {
  const category = effectVariantCategory(entry);
  if (category === "exit") return "exit";
  if (category === "emphasis") return "emphasis";
  if (category === "motion" || category === "continuous") return "motion";
  return "enter";
}

/**
 * The two registry effects no preset engine expands by variant
 * (issue #112): baseline-reveal and block-reveal carry no variants in
 * the shared registry, because renderers key off the effect id. Their
 * Studio preset names live here (the registry body stays untouched),
 * mapped to the registry definitions, so their picker entries,
 * expansions, and timing defaults all stay registry-sourced; only
 * the picker hints are Studio copy.
 */
const REGISTRY_EFFECT_PRESETS: ReadonlyMap<
  AnimationPresetName,
  { effectId: string; hint: string }
> = new Map([
  ["baselineReveal", { effectId: "baseline-reveal", hint: "Rises from behind a baseline mask" }],
  ["blockReveal", { effectId: "block-reveal", hint: "A color block sweeps across to reveal" }],
]);

function registryEffectDefinition(name: AnimationPresetName) {
  const def = REGISTRY_EFFECT_PRESETS.get(name);
  if (!def) return undefined;
  const effect = getEffect(def.effectId);
  if (!effect) {
    throw new Error(`effects registry is missing ${def.effectId}`);
  }
  return { effect, hint: def.hint };
}

/**
 * One-click preset list, derived from the Shared Effects Core registry
 * (effects.ts, issue #111): every registry variant with a preset name,
 * in registry order. The 32 historical Studio presets keep their
 * names, labels, and picker groups; float joins them from the same
 * single source of truth (it was previously only a motion package
 * preset, not a core preset). The two fade hints adopt the registry
 * wording (an arrow in place of the word "to"); no other label or
 * hint changes. Baseline Reveal and Block Reveal (issue #112) append
 * after the variant-derived entries, built from their registry
 * definitions above.
 */
export const ANIMATION_PRESETS: ReadonlyArray<{
  name: AnimationPresetName;
  label: string;
  hint: string;
  category: "enter" | "exit" | "emphasis" | "motion";
}> = [
  ...listEffectVariants().map((entry) => ({
    name: entry.variant.presetName as AnimationPresetName,
    label: entry.variant.label,
    hint: entry.variant.hint,
    category: pickerCategory(entry),
  })),
  ...[...REGISTRY_EFFECT_PRESETS.keys()].map((name) => {
    const { effect, hint } = registryEffectDefinition(name)!;
    return {
      name,
      label: effect.label,
      hint,
      category: "enter" as const,
    };
  }),
];

/**
 * Registry default timing for a preset (issue #112): the parent
 * effect's default delay and duration from the shared registry, so a
 * newly added effect lands at its spec default (Fade 400ms, Slide
 * 500ms, Typewriter 1200ms, Ken Burns 6000ms) instead of the flat
 * 600ms the panel used before. Unknown names fall back to the flat
 * engine default.
 */
export function presetDefaults(name: AnimationPresetName): {
  start: number;
  duration: number;
} {
  const effect =
    getEffectVariant(name)?.effect ??
    registryEffectDefinition(name)?.effect;
  if (!effect) return { start: 0, duration: DEFAULT_TRACK_DURATION_MS };
  return { start: effect.defaultDelayMs, duration: effect.defaultDurationMs };
}

/** Easing functions map normalized progress to an interpolation weight. */
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
  pulse: (t) => Math.sin(Math.PI * t),
  shake: (t) => Math.sin(Math.PI * 6 * t),
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
  if (tMs >= t.start + t.duration) {
    return t.easing === "pulse" || t.easing === "shake" ? t.from : t.to;
  }
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

/**
 * One Ken Burns framing: the scale multiplier and the x/y offsets (px,
 * applied on top of the authored position, same semantics as timeline
 * tracks) the object holds at one end of the move.
 */
export interface KenBurnsFrame {
  scale: number;
  x: number;
  y: number;
}

/**
 * Default Ken Burns move, from the registry's ken-burns entry: a slow
 * push-in with a slight drift up and left. The values are identical
 * to the framing Studio has always shipped.
 */
export const DEFAULT_KEN_BURNS: { from: KenBurnsFrame; to: KenBurnsFrame } = (() => {
  const framing = getEffect("ken-burns")?.framing;
  if (!framing) {
    throw new Error("effects registry is missing the ken-burns framing");
  }
  return {
    from: { ...framing.from },
    to: { ...framing.to },
  };
})();

export interface PresetOptions {
  /** Start time in ms. Defaults to 0. */
  start?: number;
  /** Duration in ms. Defaults to 600. */
  duration?: number;
  /** Slide distance in px for slide presets. Defaults to 300. */
  distance?: number;
  /** Ken Burns start and end framing. Defaults to DEFAULT_KEN_BURNS. */
  kenBurns?: { from: KenBurnsFrame; to: KenBurnsFrame };
}

/** Registry recipe value at the requested slide distance: the recipe
 *  endpoints of magnitude 300 are the default distance, so they scale
 *  to the requested distance; every other value passes through. */
function atDistance(value: number, distance: number): number {
  if (value === 300) return distance;
  if (value === -300) return -distance;
  return value;
}

function expandRecipeTrack(
  recipe: EffectTrackRecipe,
  preset: AnimationPresetName,
  start: number,
  duration: number,
  distance: number,
  kenBurns: { from: KenBurnsFrame; to: KenBurnsFrame },
): AnimationTrack {
  let from = recipe.from;
  let to = recipe.to;
  if (preset === "kenBurns") {
    // The recipe endpoints are the default framing; authored framing
    // replaces them per property (scale, x, y, in recipe order).
    if (recipe.property === "scale") {
      from = kenBurns.from.scale;
      to = kenBurns.to.scale;
    } else if (recipe.property === "x") {
      from = kenBurns.from.x;
      to = kenBurns.to.x;
    } else if (recipe.property === "y") {
      from = kenBurns.from.y;
      to = kenBurns.to.y;
    }
  } else if (recipe.property === "x" || recipe.property === "y") {
    from = atDistance(from, distance);
    to = atDistance(to, distance);
    if (preset === "bounce" && recipe.property === "y") {
      // Historical drop formula, identical in both legacy copies:
      // -max(80, distance / 3), which is -100 at the default 300.
      from = -Math.max(80, distance / 3);
    }
  }
  const track: AnimationTrack = {
    property: recipe.property as AnimatableProperty,
    from,
    to,
    start,
    duration:
      recipe.durationFixedMs ??
      (recipe.durationMinMs !== undefined
        ? Math.max(duration, recipe.durationMinMs)
        : duration),
  };
  if (recipe.easing !== null) {
    track.easing = recipe.easing as EasingName;
  }
  return track;
}

/**
 * Expand a one-click preset into timeline tracks (SPEC §7.7, rev 24),
 * driven by the Shared Effects Core registry (effects.ts, issue #111).
 * `x`/`y` tracks are offsets from the authored position, so no base
 * geometry is needed. Every historical Studio preset expands to
 * exactly the tracks it expanded to before the registry, so saved
 * projects render identically. Kinetic text presets (typewriterReveal,
 * wordReveal, lineReveal) expand to no tracks: no animatable property
 * expresses per-unit text visibility, so the preset entry on the
 * object is the marker and carries the reveal window (start and
 * duration); the motion graphics toolkit expands the preset into a
 * deterministic per-unit reveal schedule that the stage renderer and
 * the export renderer sample identically. Baseline Reveal and Block
 * Reveal (issue #112) have no registry variants; they expand from
 * their registry definitions' canonical tracks, so the stage and the
 * export renderer sample the same values the course renderer will.
 */
export function expandAnimationPreset(
  preset: AnimationPresetName,
  opts: PresetOptions = {},
): AnimationTrack[] {
  const start = opts.start ?? 0;
  const duration = opts.duration ?? DEFAULT_TRACK_DURATION_MS;
  const distance = opts.distance ?? 300;
  const kenBurns = opts.kenBurns ?? DEFAULT_KEN_BURNS;
  const registryEffect = registryEffectDefinition(preset);
  if (registryEffect) {
    return registryEffect.effect.tracks.map((recipe) =>
      expandRecipeTrack(recipe, preset, start, duration, distance, kenBurns),
    );
  }
  const entry = getEffectVariant(preset);
  if (!entry) return [];
  return entry.variant.tracks.map((recipe) =>
    expandRecipeTrack(recipe, preset, start, duration, distance, kenBurns),
  );
}

/** Sample authored presets and optional keyframe tracks through one timeline. */
export function sampleAnimations(
  animations: Pick<Animations, "presets" | "timeline"> | undefined,
  tMs: number,
): SampledValues {
  const presetTracks = (animations?.presets ?? []).flatMap((preset: AnimationPreset) =>
    expandAnimationPreset(preset.name, {
      start: preset.start,
      duration: preset.duration,
    }),
  );
  const presetValues: SampledValues = {};
  const byProperty = new Map<AnimatableProperty, AnimationTrack[]>();
  for (const track of presetTracks) {
    const tracks = byProperty.get(track.property) ?? [];
    tracks.push(track);
    byProperty.set(track.property, tracks);
  }
  for (const [property, tracks] of byProperty) {
    const active = [...tracks].reverse().find((track) => {
      const start = track.start ?? 0;
      return tMs >= start && tMs <= start + (track.duration ?? DEFAULT_TRACK_DURATION_MS);
    });
    const previous = [...tracks].reverse().find((track) => {
      const start = track.start ?? 0;
      return tMs > start + (track.duration ?? DEFAULT_TRACK_DURATION_MS);
    });
    const track = active ?? previous ?? tracks[0];
    presetValues[property] = sampleTrack(track, tMs);
  }
  return { ...presetValues, ...sampleTimeline(animations?.timeline, tMs) };
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

/** Picker groups for character animations (Studio issues #94 and #96). */
export type CharacterAnimationGroup = "basics" | "movement" | "reactions";

export const CHARACTER_ANIMATION_GROUPS: ReadonlyArray<{
  id: CharacterAnimationGroup;
  label: string;
}> = [
  { id: "basics", label: "Basics" },
  { id: "movement", label: "Movement" },
  { id: "reactions", label: "Reactions" },
];

export const CHARACTER_ANIMATIONS: ReadonlyArray<{
  name: CharacterAnimationName;
  label: string;
  hint: string;
  /** Whether the animation loops (vs. plays once / holds a pose). */
  loops: boolean;
  /** Picker group (issues #94 and #96). Two character interactions live in
   * @finch-studio/characters and are applied to a pair, not one character. */
  group: CharacterAnimationGroup;
}> = [
  { name: "idle", label: "Idle", hint: "Subtle breathing sway", loops: true, group: "basics" },
  { name: "walk", label: "Walk", hint: "Leg/arm swing cycle", loops: true, group: "movement" },
  { name: "talk", label: "Talk", hint: "Mouth + head bob", loops: true, group: "basics" },
  { name: "wave", label: "Wave", hint: "Friendly wave", loops: false, group: "basics" },
  { name: "point", label: "Point", hint: "Arm extends", loops: false, group: "basics" },
  { name: "nod", label: "Nod yes", hint: "Head nod", loops: false, group: "reactions" },
  { name: "shake", label: "Shake head no", hint: "Head shake", loops: false, group: "reactions" },
  { name: "sit", label: "Sit", hint: "Seated pose", loops: false, group: "basics" },
  { name: "stand", label: "Stand", hint: "Neutral standing", loops: false, group: "basics" },
  { name: "run", label: "Run", hint: "Fast stride with bent arms and bounce", loops: true, group: "movement" },
  { name: "clap", label: "Clap", hint: "Hands meet in front, twice per cycle", loops: true, group: "reactions" },
  { name: "shrug", label: "Shrug", hint: "Shoulders rise, palms turn up", loops: false, group: "reactions" },
  { name: "thumbs-up", label: "Thumbs up", hint: "Forearm raises in approval", loops: false, group: "reactions" },
  { name: "celebrate", label: "Celebrate", hint: "Both arms up with a bounce", loops: true, group: "reactions" },
  { name: "laugh", label: "Laugh", hint: "Shoulders shake, hands on belly", loops: true, group: "reactions" },
  { name: "bow", label: "Bow", hint: "Dips forward and rises", loops: false, group: "movement" },
  { name: "look-around", label: "Look around", hint: "Head scans left, then right", loops: false, group: "movement" },
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
