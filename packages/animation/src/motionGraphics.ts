/**
 * Motion graphics toolkit (issues #98 and #99, built-in pack half).
 *
 * Parameterized motion graphics as ordinary timeline objects:
 * - Animated title cards and lower thirds: styled text blocks over a
 *   background bar, with coordinated enter and exit motion.
 * - Callouts: an arrow plus label that draw on, pulse, and fade as one
 *   grouped object.
 * - Ken Burns: a slow pan and zoom across an image or video, with the
 *   start and end framing authored as parameters.
 * - Kinetic text: typewriter, word by word, and line by line reveals
 *   for ordinary text blocks, optionally paced against narration.
 *
 * Everything rides the shared preset engine and the keyframe timeline:
 * group members carry named presets from @finch-studio/core, Ken Burns
 * expands through `expandAnimationPreset`, and kinetic reveals expand
 * to a deterministic per-unit schedule. Parameters live on each object
 * under extensions["x-finch-studio"].motion (the established extension
 * bag), so no schema field was needed. The stage renderer and the
 * export renderer sample the same functions here, so stage and export
 * stay frame-identical.
 */
import {
  expandAnimationPreset,
  sampleTimeline,
  type AnimationPreset,
  type AnimationTrack,
  type Animations,
  type CourseObject,
  type KenBurnsFrame,
  type Theme,
} from "@finch-studio/core";
import { newVideoId } from "./videoProject.js";

export const MOTION_EXTENSION_KEY = "x-finch-studio";

/** Colors a title, lower third, or callout is built with. */
export interface MotionGraphicColors {
  textColor: string;
  accentColor: string;
  backgroundColor: string;
}

/** Built-in palette when no theme is available (matches editor defaults). */
export const DEFAULT_MOTION_COLORS: MotionGraphicColors = {
  textColor: "#ffffff",
  accentColor: "#3b82f6",
  backgroundColor: "#1f2937",
};

/**
 * Theme colors applied automatically: an explicit theme palette wins,
 * anything missing falls back to the built-in palette.
 */
export function motionGraphicColorsFromTheme(theme?: Theme | null): MotionGraphicColors {
  const palette = theme?.palette ?? {};
  return {
    textColor: palette.text ?? DEFAULT_MOTION_COLORS.textColor,
    accentColor: palette.accent ?? palette.primary ?? DEFAULT_MOTION_COLORS.accentColor,
    backgroundColor: palette.background ?? DEFAULT_MOTION_COLORS.backgroundColor,
  };
}

/** Parameters shared by every motion graphic template. */
export interface MotionGraphicParams extends MotionGraphicColors {
  /** Title text, lower-third name, or callout label. */
  text: string;
  /** Subtitle (title card) or role line (lower third). Unused by callouts. */
  subtext?: string;
  /** Ms from the scene start when the graphic appears. */
  startMs: number;
  /** Ms the graphic stays on the timeline. */
  durationMs: number;
  /** Ms for the coordinated enter motion. */
  enterMs: number;
  /** Ms for the coordinated exit motion. */
  exitMs: number;
}

export type MotionGraphicKind = "title" | "lowerThird" | "callout";
export type MotionGraphicRole = "background" | "accent" | "text" | "subtext" | "arrow" | "label";

/** Per-object metadata for one member of a motion graphic group. */
export interface MotionGraphicMeta {
  kind: MotionGraphicKind;
  groupId: string;
  role: MotionGraphicRole;
  params: MotionGraphicParams;
}

/** Per-object metadata for a Ken Burns move (framing only; the window lives on the preset entry). */
export interface KenBurnsMeta {
  kind: "kenBurns";
  from: KenBurnsFrame;
  to: KenBurnsFrame;
}

export type KineticPresetName = "typewriterReveal" | "wordReveal" | "lineReveal";

/** One word's narration timing (mirrors the schema's reserved WordTiming). */
export interface KineticWordTiming {
  word: string;
  startMs: number;
  endMs: number;
}

/** Per-object metadata for a kinetic text reveal. */
export interface KineticTextMeta {
  kind: "kineticText";
  preset: KineticPresetName;
  paceToNarration: boolean;
  /** Real per-word timings, when narration provided them. */
  wordTimings?: KineticWordTiming[];
  /** Narration window to pace against when no word timings exist. */
  narrationWindowMs?: { startMs: number; endMs: number };
}

export type MotionMeta = MotionGraphicMeta | KenBurnsMeta | KineticTextMeta;

/** Read an object's motion graphics metadata, if any. */
export function getMotionMeta(object: CourseObject): MotionMeta | undefined {
  const bag = object.extensions?.[MOTION_EXTENSION_KEY] as
    | Record<string, unknown>
    | undefined;
  const meta = bag?.motion as MotionMeta | undefined;
  return meta && typeof meta === "object" && "kind" in meta ? meta : undefined;
}

/** Return a copy of the object with its motion metadata set, preserving other extension data. */
export function withMotionMeta<T extends CourseObject>(object: T, meta: MotionMeta): T {
  const bag = (object.extensions?.[MOTION_EXTENSION_KEY] ?? {}) as Record<string, unknown>;
  return {
    ...object,
    extensions: {
      ...(object.extensions ?? {}),
      [MOTION_EXTENSION_KEY]: { ...bag, motion: meta },
    },
  };
}

/** Return a copy of the object with its motion metadata removed. */
export function withoutMotionMeta<T extends CourseObject>(object: T): T {
  const bag = { ...((object.extensions?.[MOTION_EXTENSION_KEY] ?? {}) as Record<string, unknown>) };
  delete bag.motion;
  return {
    ...object,
    extensions: { ...(object.extensions ?? {}), [MOTION_EXTENSION_KEY]: bag },
  };
}

/** True when the object is a member of a motion graphic group. */
export function isMotionGraphicMeta(meta: MotionMeta | undefined): meta is MotionGraphicMeta {
  return !!meta && (meta.kind === "title" || meta.kind === "lowerThird" || meta.kind === "callout");
}

/** All members of one motion graphic group, in scene order. */
export function motionGraphicGroupOf(objects: CourseObject[], groupId: string): CourseObject[] {
  return objects.filter((object) => {
    const meta = getMotionMeta(object);
    return isMotionGraphicMeta(meta) && meta.groupId === groupId;
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

interface MemberSpec {
  role: MotionGraphicRole;
  type: "text" | "shape";
  name: string;
  position: { x: number; y: number; w: number; h: number };
  content?: string;
  fill?: string;
  shape?: string;
  presets: AnimationPreset[];
}

/**
 * The member layout for one template. Pure function of the parameters:
 * the same parameters always produce the same specs, which is what makes
 * both building and parameter re-editing deterministic.
 */
function memberSpecs(kind: MotionGraphicKind, params: MotionGraphicParams): MemberSpec[] {
  const start = Math.max(0, Math.round(params.startMs));
  const enter = Math.max(1, Math.round(params.enterMs));
  const exit = Math.max(1, Math.round(params.exitMs));
  const exitStart = start + Math.max(0, Math.round(params.durationMs)) - exit;
  const pulseStart = start + Math.max(enter, Math.round(params.durationMs / 2) - 300);
  const at = (name: AnimationPreset["name"], s: number, d: number): AnimationPreset => ({
    name,
    start: s,
    duration: d,
  });

  if (kind === "title") {
    const specs: MemberSpec[] = [
      {
        role: "background",
        type: "shape",
        name: "Title card background",
        position: { x: 240, y: 250, w: 800, h: 220 },
        fill: params.backgroundColor,
        shape: "rect",
        presets: [at("wipeInRight", start, enter), at("fadeOut", exitStart, exit), at("slideOutDown", exitStart, exit)],
      },
      {
        role: "accent",
        type: "shape",
        name: "Title card accent",
        position: { x: 240, y: 250, w: 800, h: 10 },
        fill: params.accentColor,
        shape: "rect",
        presets: [at("wipeInRight", start + 100, enter), at("fadeOut", exitStart, exit)],
      },
      {
        role: "text",
        type: "text",
        name: "Title",
        position: { x: 280, y: 300, w: 720, h: 84 },
        content: `<h1>${escapeHtml(params.text)}</h1>`,
        presets: [at("slideInUp", start + 150, enter), at("fadeOut", exitStart, exit)],
      },
    ];
    if (params.subtext?.trim()) {
      specs.push({
        role: "subtext",
        type: "text",
        name: "Subtitle",
        position: { x: 280, y: 392, w: 720, h: 48 },
        content: `<p>${escapeHtml(params.subtext)}</p>`,
        presets: [at("fadeIn", start + 300, enter), at("fadeOut", exitStart, exit)],
      });
    }
    return specs;
  }

  if (kind === "lowerThird") {
    const specs: MemberSpec[] = [
      {
        role: "background",
        type: "shape",
        name: "Lower third background",
        position: { x: 90, y: 516, w: 580, h: 104 },
        fill: params.backgroundColor,
        shape: "rect",
        presets: [at("slideInLeft", start, enter), at("slideOutLeft", exitStart, exit), at("fadeOut", exitStart, exit)],
      },
      {
        role: "accent",
        type: "shape",
        name: "Lower third accent",
        position: { x: 80, y: 516, w: 10, h: 104 },
        fill: params.accentColor,
        shape: "rect",
        presets: [at("wipeInDown", start, enter), at("fadeOut", exitStart, exit)],
      },
      {
        role: "text",
        type: "text",
        name: "Lower third name",
        position: { x: 118, y: 530, w: 524, h: 46 },
        content: `<p><strong>${escapeHtml(params.text)}</strong></p>`,
        presets: [at("slideInLeft", start + 120, enter), at("fadeOut", exitStart, exit)],
      },
    ];
    if (params.subtext?.trim()) {
      specs.push({
        role: "subtext",
        type: "text",
        name: "Lower third role",
        position: { x: 118, y: 574, w: 524, h: 34 },
        content: `<p>${escapeHtml(params.subtext)}</p>`,
        presets: [at("slideInLeft", start + 220, enter), at("fadeOut", exitStart, exit)],
      });
    }
    return specs;
  }

  // Callout: the arrow draws on, the label follows, both pulse once at
  // the middle of the window, and both fade out together at the end.
  return [
    {
      role: "arrow",
      type: "shape",
      name: "Callout arrow",
      position: { x: 640, y: 300, w: 200, h: 8 },
      fill: params.accentColor,
      shape: "line",
      presets: [
        at("wipeInRight", start, enter),
        at("emphasisPulse", pulseStart, 600),
        at("fadeOut", exitStart, exit),
      ],
    },
    {
      role: "label",
      type: "text",
      name: "Callout label",
      position: { x: 640, y: 252, w: 280, h: 40 },
      content: `<p>${escapeHtml(params.text)}</p>`,
      presets: [
        at("fadeIn", start + 200, enter),
        at("slideInRight", start + 200, enter),
        at("emphasisPulse", pulseStart, 600),
        at("fadeOut", exitStart, exit),
      ],
    },
  ];
}

export type MotionGraphicIdFactory = (role: MotionGraphicRole) => string;

function defaultIdFactory(): MotionGraphicIdFactory {
  return (role) => newVideoId(`mg-${role}`);
}

function memberObject(
  kind: MotionGraphicKind,
  groupId: string,
  params: MotionGraphicParams,
  spec: MemberSpec,
  id: string,
): CourseObject {
  const base = {
    id,
    type: spec.type,
    name: spec.name,
    position: { ...spec.position },
    timing: {
      start: Math.max(0, Math.round(params.startMs)) / 1000,
      duration: Math.max(1, Math.round(params.durationMs)) / 1000,
    },
    animations: { presets: spec.presets.map((preset) => ({ ...preset })) },
    ...(spec.type === "text" ? { content: spec.content ?? "" } : {}),
    ...(spec.type === "shape" ? { shape: spec.shape ?? "rect", fill: spec.fill } : {}),
  } as CourseObject;
  return withMotionMeta(base, { kind, groupId, role: spec.role, params: { ...params } });
}

/** Build a complete motion graphic group from parameters. */
export function buildMotionGraphic(
  kind: MotionGraphicKind,
  params: MotionGraphicParams,
  makeId: MotionGraphicIdFactory = defaultIdFactory(),
  groupId: string = newVideoId("mg-group"),
): CourseObject[] {
  return memberSpecs(kind, params).map((spec) =>
    memberObject(kind, groupId, params, spec, makeId(spec.role)),
  );
}

/** Convenience builder for an animated title card. */
export function buildTitleCard(
  params: MotionGraphicParams,
  makeId?: MotionGraphicIdFactory,
  groupId?: string,
): CourseObject[] {
  return buildMotionGraphic("title", params, makeId, groupId);
}

/** Convenience builder for an animated lower third. */
export function buildLowerThird(
  params: MotionGraphicParams,
  makeId?: MotionGraphicIdFactory,
  groupId?: string,
): CourseObject[] {
  return buildMotionGraphic("lowerThird", params, makeId, groupId);
}

/** Convenience builder for a callout (arrow plus label as one group). */
export function buildCallout(
  params: MotionGraphicParams,
  makeId?: MotionGraphicIdFactory,
  groupId?: string,
): CourseObject[] {
  return buildMotionGraphic("callout", params, makeId, groupId);
}

/**
 * Re-apply edited parameters to an existing group. Only the fields the
 * parameters drive change (text content, fills, timing, preset windows,
 * stored params); ids, names, and positions are preserved, so a user who
 * moved a member does not lose the move. A member whose role appears or
 * disappears with the parameters (the optional subtext line) is created
 * when `makeId` is supplied and dropped when it is no longer in the spec.
 */
export function rebuildMotionGraphic(
  objects: CourseObject[],
  params: MotionGraphicParams,
  makeId?: MotionGraphicIdFactory,
): CourseObject[] {
  const first = objects
    .map((object) => getMotionMeta(object))
    .find(isMotionGraphicMeta);
  if (!first) return objects;
  const specs = memberSpecs(first.kind, params);
  const byRole = new Map<MotionGraphicRole, MemberSpec>(specs.map((spec) => [spec.role, spec]));
  const seen = new Set<MotionGraphicRole>();
  const out: CourseObject[] = [];
  for (const object of objects) {
    const meta = getMotionMeta(object);
    if (!isMotionGraphicMeta(meta) || meta.groupId !== first.groupId) {
      out.push(object);
      continue;
    }
    const spec = byRole.get(meta.role);
    if (!spec) continue; // Role left the spec (subtext cleared): drop the member.
    seen.add(meta.role);
    const patched = {
      ...object,
      timing: {
        start: Math.max(0, Math.round(params.startMs)) / 1000,
        duration: Math.max(1, Math.round(params.durationMs)) / 1000,
      },
      animations: {
        ...(object.animations ?? {}),
        presets: spec.presets.map((preset) => ({ ...preset })),
      },
      ...(spec.type === "text" ? { content: spec.content ?? "" } : {}),
      ...(spec.type === "shape" ? { fill: spec.fill } : {}),
    } as CourseObject;
    out.push(withMotionMeta(patched, { ...meta, params: { ...params } }));
  }
  if (makeId) {
    for (const spec of specs) {
      if (!seen.has(spec.role)) {
        out.push(memberObject(first.kind, first.groupId, params, spec, makeId(spec.role)));
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ken Burns
// ---------------------------------------------------------------------------

export interface KenBurnsFraming {
  from: KenBurnsFrame;
  to: KenBurnsFrame;
}

/** Expand a Ken Burns framing to timeline tracks through the shared preset engine. */
export function kenBurnsTracks(
  framing: KenBurnsFraming,
  startMs: number,
  durationMs: number,
): AnimationTrack[] {
  return expandAnimationPreset("kenBurns", {
    start: Math.max(0, Math.round(startMs)),
    duration: Math.max(1, Math.round(durationMs)),
    kenBurns: framing,
  });
}

/**
 * Sample a Ken Burns move at scene time `tMs`. Goes through the same
 * track sampling the renderer uses, so the sampled framing here is the
 * framing on stage and in export by construction.
 */
export function sampleKenBurns(
  framing: KenBurnsFraming,
  startMs: number,
  durationMs: number,
  tMs: number,
): KenBurnsFrame {
  const values = sampleTimeline(kenBurnsTracks(framing, startMs, durationMs), tMs);
  return {
    scale: values.scale ?? framing.from.scale,
    x: values.x ?? framing.from.x,
    y: values.y ?? framing.from.y,
  };
}

/**
 * Apply a Ken Burns move to an image or video object: a `kenBurns`
 * preset entry carries the window (editable in the effects editor like
 * any preset) and the framing rides the object's extension bag.
 */
export function applyKenBurns<T extends CourseObject>(
  object: T,
  framing: KenBurnsFraming,
  startMs: number,
  durationMs: number,
): T {
  const presets = (object.animations?.presets ?? []).filter((preset) => preset.name !== "kenBurns");
  presets.push({
    name: "kenBurns",
    start: Math.max(0, Math.round(startMs)),
    duration: Math.max(1, Math.round(durationMs)),
  });
  const withPreset = {
    ...object,
    animations: { ...(object.animations ?? {}), presets },
  } as T;
  return withMotionMeta(withPreset, { kind: "kenBurns", from: { ...framing.from }, to: { ...framing.to } });
}

/** Remove a Ken Burns move from an object (preset entry and framing). */
export function clearKenBurns<T extends CourseObject>(object: T): T {
  const meta = getMotionMeta(object);
  if (meta?.kind !== "kenBurns") return object;
  const presets = (object.animations?.presets ?? []).filter((preset) => preset.name !== "kenBurns");
  return withoutMotionMeta({
    ...object,
    animations: { ...(object.animations ?? {}), presets },
  } as T);
}

/**
 * The animations a renderer should sample for an object: the authored
 * animations plus, when the object carries Ken Burns framing, the
 * framing's tracks appended to the timeline. Every render path (stage,
 * player, export) goes through this so they cannot drift.
 */
export function effectiveAnimationsForObject(object: CourseObject): Animations | undefined {
  const meta = getMotionMeta(object);
  if (meta?.kind !== "kenBurns") return object.animations;
  const preset = (object.animations?.presets ?? []).find((entry) => entry.name === "kenBurns");
  const startMs = preset?.start ?? 0;
  const durationMs =
    preset?.duration ??
    (object.timing?.duration ? Math.round(object.timing.duration * 1000) : 6000);
  const tracks = kenBurnsTracks({ from: meta.from, to: meta.to }, startMs, durationMs);
  return {
    ...(object.animations ?? {}),
    timeline: [...(object.animations?.timeline ?? []), ...tracks],
  };
}

// ---------------------------------------------------------------------------
// Kinetic text
// ---------------------------------------------------------------------------

/** One unit of a kinetic reveal: a character, a word, or a line, with its window. */
export interface KineticRevealUnit {
  /** Unit text; concatenating all units reproduces the input text exactly. */
  text: string;
  startMs: number;
  endMs: number;
}

export interface KineticRevealOptions {
  /** Ms from the scene start when the reveal begins. */
  startMs: number;
  /** Ms the reveal spans when it is not paced to narration. */
  durationMs: number;
  /** Ride the narration timing instead of the even reveal window. */
  paceToNarration?: boolean;
  /** Real per-word narration timings, when available. */
  wordTimings?: KineticWordTiming[];
  /** Narration window to pace against when no word timings exist. */
  narrationWindowMs?: { startMs: number; endMs: number };
}

/**
 * Split plain text into reveal units. Word pieces keep their trailing
 * whitespace and line pieces keep their leading newline, so joining the
 * pieces always reproduces the input.
 */
export function splitKineticUnits(text: string, preset: KineticPresetName): string[] {
  if (!text) return [];
  if (preset === "typewriterReveal") return Array.from(text);
  if (preset === "lineReveal") {
    return text
      .split("\n")
      .map((line, index) => (index === 0 ? line : `\n${line}`))
      .filter((piece) => piece.length > 0);
  }
  const pieces = text.match(/\s*\S+\s*/g);
  return pieces && pieces.length > 0 ? pieces : [text];
}

function distribute(
  weights: number[],
  spanStart: number,
  spanEnd: number,
): Array<{ startMs: number; endMs: number }> {
  const total = weights.reduce((sum, w) => sum + w, 0) || 1;
  const span = Math.max(0, spanEnd - spanStart);
  let acc = 0;
  return weights.map((weight) => {
    const startMs = Math.round(spanStart + (span * acc) / total);
    acc += weight;
    const endMs = Math.round(spanStart + (span * acc) / total);
    return { startMs, endMs };
  });
}

function wordPiecesOf(text: string): string[] {
  return splitKineticUnits(text, "wordReveal");
}

/**
 * Expand a kinetic preset into its deterministic reveal schedule.
 *
 * Default pacing spreads units evenly across the reveal window (word
 * and line units are weighted by their length, so longer units hold a
 * little longer). With `paceToNarration`, real word timings win when
 * they are present: word units take their word's window exactly and
 * typewriter characters spread inside their word's window. Without word
 * timings, a narration window paces the units proportionally instead.
 */
export function expandKineticReveal(
  text: string,
  preset: KineticPresetName,
  opts: KineticRevealOptions,
): KineticRevealUnit[] {
  const pieces = splitKineticUnits(text, preset);
  if (pieces.length === 0) return [];
  const startMs = Math.max(0, Math.round(opts.startMs));
  const durationMs = Math.max(1, Math.round(opts.durationMs));
  const timings = opts.paceToNarration ? opts.wordTimings : undefined;
  const narrationSpan =
    opts.paceToNarration && timings && timings.length > 0
      ? { startMs: timings[0].startMs, endMs: timings[timings.length - 1].endMs }
      : opts.paceToNarration && opts.narrationWindowMs
        ? opts.narrationWindowMs
        : null;

  // Exact word timings: word units map one to one, typewriter
  // characters spread evenly inside their word's window.
  if (timings && timings.length > 0 && preset !== "lineReveal") {
    const words = wordPiecesOf(text);
    if (words.length === timings.length) {
      if (preset === "wordReveal") {
        return pieces.map((piece, i) => ({
          text: piece,
          startMs: Math.round(timings[i].startMs),
          endMs: Math.round(timings[i].endMs),
        }));
      }
      const units: KineticRevealUnit[] = [];
      words.forEach((wordPiece, i) => {
        const chars = Array.from(wordPiece);
        const windows = distribute(
          chars.map(() => 1),
          timings[i].startMs,
          timings[i].endMs,
        );
        chars.forEach((ch, j) => units.push({ text: ch, ...windows[j] }));
      });
      return units;
    }
  }

  const weights = pieces.map((piece) =>
    preset === "typewriterReveal" ? 1 : Math.max(1, piece.trim().length),
  );
  const span = narrationSpan ?? { startMs, endMs: startMs + durationMs };
  const windows = distribute(weights, span.startMs, span.endMs);
  return pieces.map((piece, i) => ({ text: piece, ...windows[i] }));
}

/** Per-unit reveal state at scene time `tMs`. */
export function kineticUnitsAt(
  units: KineticRevealUnit[],
  tMs: number,
): Array<{ text: string; visible: boolean; progress: number }> {
  return units.map((unit) => {
    const span = Math.max(1, unit.endMs - unit.startMs);
    const progress = Math.min(1, Math.max(0, (tMs - unit.startMs) / span));
    return { text: unit.text, visible: tMs >= unit.startMs, progress };
  });
}

/** The text visible at scene time `tMs` (units appear at their start). */
export function kineticVisibleText(units: KineticRevealUnit[], tMs: number): string {
  return units.filter((unit) => tMs >= unit.startMs).map((unit) => unit.text).join("");
}

/**
 * Apply a kinetic reveal to a text object: a preset entry carries the
 * reveal window (editable in the effects editor) and the pacing data
 * rides the object's extension bag.
 */
export function applyKineticText<T extends CourseObject>(
  object: T,
  preset: KineticPresetName,
  opts: KineticRevealOptions,
): T {
  const presets = (object.animations?.presets ?? []).filter(
    (entry) => !isKineticPresetName(entry.name),
  );
  presets.push({
    name: preset,
    start: Math.max(0, Math.round(opts.startMs)),
    duration: Math.max(1, Math.round(opts.durationMs)),
  });
  const withPreset = {
    ...object,
    animations: { ...(object.animations ?? {}), presets },
  } as T;
  return withMotionMeta(withPreset, {
    kind: "kineticText",
    preset,
    paceToNarration: !!opts.paceToNarration,
    ...(opts.wordTimings ? { wordTimings: opts.wordTimings.map((w) => ({ ...w })) } : {}),
    ...(opts.narrationWindowMs ? { narrationWindowMs: { ...opts.narrationWindowMs } } : {}),
  });
}

/** Remove a kinetic reveal from a text object. */
export function clearKineticText<T extends CourseObject>(object: T): T {
  const meta = getMotionMeta(object);
  if (meta?.kind !== "kineticText") return object;
  const presets = (object.animations?.presets ?? []).filter(
    (entry) => !isKineticPresetName(entry.name),
  );
  return withoutMotionMeta({
    ...object,
    animations: { ...(object.animations ?? {}), presets },
  } as T);
}

export function isKineticPresetName(name: string): name is KineticPresetName {
  return name === "typewriterReveal" || name === "wordReveal" || name === "lineReveal";
}

/**
 * The reveal schedule for a text object, or null when the object has no
 * live kinetic reveal. Renderers call this with the object's plain text
 * so stage and export expand identically.
 */
export function kineticRevealForObject(
  object: CourseObject,
  plainText: string,
): KineticRevealUnit[] | null {
  const meta = getMotionMeta(object);
  if (meta?.kind !== "kineticText") return null;
  const entry = (object.animations?.presets ?? []).find((preset) => preset.name === meta.preset);
  if (!entry) return null;
  return expandKineticReveal(plainText, meta.preset, {
    startMs: entry.start ?? 0,
    durationMs: entry.duration ?? 2000,
    paceToNarration: meta.paceToNarration,
    wordTimings: meta.wordTimings,
    narrationWindowMs: meta.narrationWindowMs,
  });
}
