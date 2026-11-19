/**
 * FinchLearn Studio project schema v1 (issue #4).
 *
 * One versioned JSON document per project. Scenes hold timed elements;
 * global music and captions span scenes. Assets are referenced by R2 key
 * only: never bytes, never viewer identity (media resolution keys off the
 * project's own entitlements, the FinchLearn media identity rule).
 */

import type { AnimationPreset } from "@finch-studio/core";
import {
  FOOTAGE_MAX_SPEED,
  FOOTAGE_MIN_SPEED,
  FOOTAGE_PIP_LAYOUTS,
  type FootageCrop,
  type FootageFreeze,
  type FootagePipLayout,
} from "./footage.js";
  COLOR_CORRECTION_KEYS,
  COLOR_CORRECTION_MAX,
  COLOR_CORRECTION_MIN,
  type ColorCorrection,
} from "./colorCorrection.js";
import { validateMulticamGroup, type MulticamGroup } from "./multicam.js";

export const STUDIO_SCHEMA_VERSION = 1 as const;

export interface AssetRef {
  /** Object key in R2, for example u/{owner}/{project}/{asset}. */
  r2Key: string;
  kind: "video" | "audio" | "image";
  sha256?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  /**
   * Extension metadata in the established style. The clip transcript
   * (ASR, #43) lives at extensions["x-finch-studio"].transcript; use
   * getAssetTranscript / withAssetTranscript below rather than reading
   * the raw slot. Plain JSON, so it round trips through save/load and
   * through the OCF sidecar (which stores full scenes) unchanged.
   */
  extensions?: Record<string, Record<string, unknown>>;
}

export interface WordTiming {
  word: string;
  startMs: number;
  endMs: number;
  /** ASR confidence for this word, 0..1, only when the engine that
   * produced the timing reports one (#43). Absent means not reported. */
  confidence?: number;
}

// ---------------------------------------------------------------------------
// ASR transcripts (#43)
// ---------------------------------------------------------------------------

/** Lifecycle of one clip's transcript. */
export type TranscriptStatus = "none" | "queued" | "transcribing" | "ready" | "failed";

export interface TranscriptSegment {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  speaker?: string;
  confidence?: number;
  wordStartIndex: number;
  wordEndIndex: number;
}

/**
 * The canonical transcript for one clip, stored on the clip's AssetRef
 * under extensions["x-finch-studio"].transcript. Word times are
 * milliseconds into the SOURCE clip (before scene trims); consumers
 * offset by the element's sourceInMs / source offset when mapping
 * onto a scene timeline.
 *
 * This shape is structurally identical to ClipTranscript in
 * @finch-studio/media (packages/media/src/transcript.ts), where the
 * ingest planning and engine adapter live; neither package depends on
 * the other, and values assign across the two declarations freely.
 * That media module is the full contract document for #44 and #45.
 */
export interface ClipTranscript {
  version: 1;
  status: TranscriptStatus;
  /** Clip identity: the library asset id, or the element / object id
   * in a project. Matched first by findProjectTranscript. */
  clipId: string;
  r2Key?: string;
  /** Content hash of the exact bytes transcribed (AssetRef.sha256 or
   * the ingest hash). A ready transcript with this hash is current;
   * a different hash means the clip changed and ASR must re-run. */
  contentHash: string;
  engine: string;
  language?: string;
  durationMs?: number;
  words: WordTiming[];
  segments: TranscriptSegment[];
  text: string;
  updatedAt: string;
  createdAt?: string;
  error?: string;
  attempts?: number;
}

export const TRANSCRIPT_EXTENSION_KEY = "x-finch-studio" as const;

/** The transcript stored on an asset ref, or null. Light structural
 * check only; the media package's parseTranscript is the strict
 * reader for untrusted payloads. */
export function getAssetTranscript(asset: AssetRef): ClipTranscript | null {
  const raw = asset.extensions?.[TRANSCRIPT_EXTENSION_KEY]?.transcript;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const t = raw as Partial<ClipTranscript>;
  if (typeof t.clipId !== "string" || typeof t.contentHash !== "string") return null;
  if (!Array.isArray(t.words)) return null;
  return t as ClipTranscript;
}

/** Return a copy of the asset ref with the transcript stored (or
 * cleared, with null) under the x-finch-studio extension slot. */
export function withAssetTranscript(asset: AssetRef, transcript: ClipTranscript | null): AssetRef {
  const meta: Record<string, unknown> = { ...(asset.extensions?.[TRANSCRIPT_EXTENSION_KEY] ?? {}) };
  if (transcript === null) delete meta.transcript;
  else meta.transcript = transcript;
  return { ...asset, extensions: { ...(asset.extensions ?? {}), [TRANSCRIPT_EXTENSION_KEY]: meta } };
}

/** Every AssetRef a project references, in scene order: footage and
 * image element assets, audio element assets, dialogue line audio,
 * scene backgrounds, and global music. */
export function projectAssetRefs(p: StudioProject): AssetRef[] {
  const refs: AssetRef[] = [];
  if (p.globalMusic) refs.push(p.globalMusic.asset);
  for (const scene of p.scenes) {
    if (scene.background && "r2Key" in scene.background) refs.push(scene.background);
    for (const el of scene.elements) {
      if (el.kind === "footage" || el.kind === "image" || el.kind === "audio") refs.push(el.asset);
    }
    for (const line of scene.dialogue) {
      if (line.audio) refs.push(line.audio);
    }
  }
  return refs;
}

/**
 * How a consumer (#44 captions, #45 rough cut) finds the transcript
 * for a clip in a project: match clipId (element id or asset id)
 * first, then the asset r2Key. Returns null when the clip has no
 * transcript stored.
 */
export function findProjectTranscript(
  p: StudioProject,
  clip: { clipId?: string; r2Key?: string },
): ClipTranscript | null {
  let byKey: ClipTranscript | null = null;
  for (const scene of p.scenes) {
    for (const el of scene.elements) {
      if (el.kind !== "footage" && el.kind !== "audio") continue;
      const t = getAssetTranscript(el.asset);
      if (!t) continue;
      if (clip.clipId && (t.clipId === clip.clipId || el.id === clip.clipId)) return t;
      if (clip.r2Key && el.asset.r2Key === clip.r2Key) byKey = byKey ?? t;
    }
    for (const line of scene.dialogue) {
      if (!line.audio) continue;
      const t = getAssetTranscript(line.audio);
      if (!t) continue;
      if (clip.clipId && (t.clipId === clip.clipId || line.id === clip.clipId)) return t;
      if (clip.r2Key && line.audio.r2Key === clip.r2Key) byKey = byKey ?? t;
    }
  }
  return byKey;
}

export interface DialogueLine {
  id: string;
  speakerElementId?: string;
  text: string;
  /** Voice id in the narration stack (Kokoro basic or Google premium). */
  voiceId?: string;
  /** Generated audio for this line, when TTS or recording has run. */
  audio?: AssetRef;
  /** Word timings, filled by TTS or ASR; reserved from v1 (Phase 2 captions). */
  wordTimings?: WordTiming[];
}

export type TransitionKind = "cut" | "fade" | "slide" | "wipe" | "zoom" | "push";

export type CueMarkerType = "knowledge-check" | "branch" | "modal" | "chapter";

export const CUE_MARKER_TYPES: CueMarkerType[] = [
  "knowledge-check",
  "branch",
  "modal",
  "chapter",
];

/** One answer option of an inline knowledge-check question (issue #64). */
export interface CueQuestionChoice {
  id: string;
  label: string;
}

/**
 * Inline knowledge-check payload (issue #64). When present, the OCF
 * mapping embeds it as a native OCF question cue action, so the
 * FinchLearn player can pause and ask it without any Studio side data.
 */
export interface CueQuestionPayload {
  prompt: string;
  choices: CueQuestionChoice[];
  /** Choice ids that count as correct; empty or absent means ungraded. */
  correctChoiceIds?: string[];
  /** When true, the learner must answer correctly to resume playback. */
  requireCorrect?: boolean;
}

/** One choice button of a branch marker (issue #64). */
export interface CueBranchChoice {
  id: string;
  label: string;
  /** Seek target inside the same scene, in milliseconds. */
  jumpToMs?: number;
  /** Or switch playback to another course video resource id. */
  videoRef?: string;
  /** Or navigate to another course page id. */
  pageId?: string;
}

/**
 * A timeline cue marker (issue #64). Markers are authored in the Studio
 * editor on a scene timeline and export through the OCF mapping as
 * structured cue-point metadata: native OCF cue points (with a question
 * or branch cue action where the type carries one, and a cue-point
 * trigger opening the modal for modal markers) on the scene's first
 * footage object, plus a lossless copy under that object's
 * extensions["x-finch-studio"].cueMarkers.
 *
 * Every field beyond atMs and type is optional, so projects written
 * before #64 (markers with only atMs, type, label, and ocfRef) parse
 * exactly as they did before.
 */
export interface CueMarker {
  /** Stable marker id. Absent on pre-#64 markers; the mapping derives one. */
  id?: string;
  atMs: number;
  type: CueMarkerType;
  label?: string;
  /**
   * OCF side payload reference, carried losslessly through the mapping.
   * For a knowledge check this names an existing OCF question object to
   * ask instead of an inline question; for a modal it names the popup
   * object to open when no modalRef is set.
   */
  ocfRef?: string;
  /** Knowledge check only: the inline question to ask at this marker. */
  question?: CueQuestionPayload;
  /** Branch only: the choice buttons presented while playback is paused. */
  branchChoices?: CueBranchChoice[];
  /** Modal only: id of the OCF popup object to open at this marker. */
  modalRef?: string;
}

/** Build a cue marker with a fresh id (issue #64). */
export function makeCueMarker(
  type: CueMarkerType,
  atMs: number,
  patch: Partial<CueMarker> = {},
): CueMarker {
  return { ...patch, id: newStudioId("cue"), type, atMs };
}

/**
 * Whiteboard draw-on treatment on one element (issue #52). Mirrors
 * DrawOnTreatment in @finch-studio/motion, where the timing and stroke
 * math lives; the schema carries the authored data only. An element
 * without this field behaves exactly as before.
 */
export interface DrawOnStyle {
  /** Draw duration in ms. Defaults to the element's own duration. */
  durationMs?: number;
  handStyle?: "marker" | "chalk" | "pen";
  /** Hold in ms at full draw before erasing starts. */
  eraseDelayMs?: number;
  /** Erase duration in ms. Unset or 0 means the element never erases. */
  eraseDurationMs?: number;
}

/**
 * Whiteboard scene style (issue #52): the scene renders on a board
 * surface. `surface` is a background colour carried as scene data, the
 * same mechanism as `background`; unset uses the scene background.
 * Marker colours are each element's own fill or text colour.
 */
export interface WhiteboardSceneStyle {
  surface?: string;
}

interface ElementBase {
  id: string;
  name?: string;
  startMs: number;
  durationMs: number;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  opacity?: number;
  effects?: AnimationPreset[];
  /** Whiteboard draw-on treatment (shapes, text, and images). */
  drawOn?: DrawOnStyle;
  /**
   * Basic colour correction (issue #46), meaningful on elements that
   * carry imagery (footage and image). Absent or all zero is neutral:
   * the element renders exactly as it did before corrections existed.
   * Additive and optional, so older projects stay valid unchanged.
   */
  colorCorrection?: ColorCorrection;
}

export interface FootageElement extends ElementBase {
  kind: "footage";
  asset: AssetRef;
  sourceInMs: number;
  sourceOutMs: number;
  speed: number;
  volume: number;
  /**
   * Optional footage edits (issue #25), all non-destructive and all
   * resolved through packages/schema footage.ts. Absent means legacy
   * behavior: no freeze hold, no crop, no PiP preset. The element's
   * durationMs is the resolved timeline duration (trim length divided
   * by speed, plus any freeze hold).
   */
  freeze?: FootageFreeze;
  crop?: FootageCrop;
  pipLayout?: FootagePipLayout;
}

export interface CharacterElement extends ElementBase {
  kind: "character";
  /** Character id in the rigged character system (design gated, issue #16). */
  characterRef: string;
  action?: string;
  expression?: string;
  dialogueLineId?: string;
}

export interface ImageElement extends ElementBase {
  kind: "image";
  asset: AssetRef;
}

export interface TextElement extends ElementBase {
  kind: "text";
  text: string;
  styleRef?: string;
}

export interface ChartElement extends ElementBase {
  kind: "chart";
  chartType: "bar" | "line" | "pie";
  /** CSV data, first row is the header. */
  csv: string;
}

export interface ShapeElement extends ElementBase {
  kind: "shape";
  shape: "rect" | "ellipse" | "line" | "arrow";
  fill?: string;
}

export interface AudioElement extends ElementBase {
  kind: "audio";
  asset: AssetRef;
  volume: number;
  role: "voice" | "music" | "sfx" | "description";
}

export type SceneElement =
  | FootageElement
  | CharacterElement
  | ImageElement
  | TextElement
  | ChartElement
  | ShapeElement
  | AudioElement;

export interface StudioScene {
  id: string;
  name: string;
  durationMs: number;
  transition: TransitionKind;
  transitionMs?: number;
  effects?: AnimationPreset[];
  background?: AssetRef | { color: string };
  /** Whiteboard presentation style for this scene (issue #52). */
  whiteboard?: WhiteboardSceneStyle;
  elements: SceneElement[];
  dialogue: DialogueLine[];
  markers?: CueMarker[];
  /**
   * Multicam group (issue #47): up to 3 angles of the same moment,
   * synced by audio, cut between by segments. Absent on ordinary
   * scenes, which behave exactly as before. Angle sourceIds point
   * at footage elements in this scene.
   */
  multicam?: MulticamGroup;
}

export interface CaptionTrack {
  id: string;
  lang: string;
  /** Sidecar file (vtt or srt) in R2 when rendered. */
  asset?: AssetRef;
}

export interface ProjectSnapshot {
  id: string;
  name: string;
  createdAt: string;
  /** Full project JSON at snapshot time (non-destructive versioning, #62). */
  project: StudioProject;
}

export interface StudioProject {
  version: typeof STUDIO_SCHEMA_VERSION;
  id: string;
  name: string;
  scenes: StudioScene[];
  sceneGroupPresetRefs?: string[];
  globalMusic?: { asset: AssetRef; volume: number };
  captions?: CaptionTrack[];
  brandKitRef?: string;
  aspect?: "16:9" | "9:16" | "1:1";
  snapshots?: ProjectSnapshot[];
}

let counter = 0;
export function newStudioId(prefix: string): string {
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${counter}-${rand}`;
}

export function makeStudioScene(name = "Scene"): StudioScene {
  return {
    id: newStudioId("scene"),
    name,
    durationMs: 5000,
    transition: "cut",
    transitionMs: 400,
    elements: [],
    dialogue: [],
  };
}

export function makeStudioProject(name = "Untitled video"): StudioProject {
  return {
    version: STUDIO_SCHEMA_VERSION,
    id: newStudioId("proj"),
    name,
    scenes: [makeStudioScene("Scene 1")],
    aspect: "16:9",
  };
}

/** Structural validation; returns human-readable problems (empty = valid). */
export function validateStudioProject(p: StudioProject): string[] {
  const problems: string[] = [];
  if (p.version !== STUDIO_SCHEMA_VERSION) problems.push(`Project version must be ${STUDIO_SCHEMA_VERSION}.`);
  if (!p.id) problems.push("Project is missing an id.");
  if (!p.name) problems.push("Project is missing a name.");
  if (p.aspect !== undefined && p.aspect !== "16:9" && p.aspect !== "9:16" && p.aspect !== "1:1") {
    problems.push(`Project aspect "${String(p.aspect)}" is not supported. Use 16:9, 9:16, or 1:1.`);
  }
  if (!Array.isArray(p.scenes) || p.scenes.length === 0) problems.push("Project has no scenes.");
  const ids = new Set<string>();
  (p.scenes ?? []).forEach((s, i) => {
    if (!s.id) problems.push(`Scene ${i + 1} is missing an id.`);
    if (!(s.durationMs > 0)) problems.push(`Scene "${s.name || i + 1}" needs a positive durationMs.`);
    if (!Array.isArray(s.elements)) problems.push(`Scene "${s.name || i + 1}" elements must be an array.`);
    for (const el of s.elements ?? []) {
      if (ids.has(el.id)) problems.push(`Duplicate element id "${el.id}".`);
      ids.add(el.id);
      if (!(el.durationMs > 0)) problems.push(`Element "${el.id}" needs a positive durationMs.`);
      if (el.kind === "footage") {
        if (!el.asset?.r2Key) problems.push(`Footage element "${el.id}" needs an asset r2Key.`);
        if (el.sourceOutMs <= el.sourceInMs) problems.push(`Footage element "${el.id}" has sourceOutMs before sourceInMs.`);
        if (el.speed !== undefined && (el.speed < FOOTAGE_MIN_SPEED || el.speed > FOOTAGE_MAX_SPEED)) {
          problems.push(`Footage element "${el.id}" has speed outside ${FOOTAGE_MIN_SPEED} to ${FOOTAGE_MAX_SPEED}.`);
        }
        if (el.volume !== undefined && (el.volume < 0 || el.volume > 1)) {
          problems.push(`Footage element "${el.id}" has volume outside 0 to 1.`);
        }
        if (el.freeze) {
          if (!(el.freeze.durationMs > 0)) problems.push(`Footage element "${el.id}" has a freeze frame with no hold duration.`);
          if (el.freeze.atSourceMs < el.sourceInMs || el.freeze.atSourceMs > el.sourceOutMs) {
            problems.push(`Footage element "${el.id}" has a freeze frame outside its trim range.`);
          }
        }
        if (el.crop) {
          const c = el.crop;
          if (c.x < 0 || c.y < 0 || c.w <= 0 || c.h <= 0 || c.x + c.w > 1 || c.y + c.h > 1) {
            problems.push(`Footage element "${el.id}" has a crop rectangle outside the source frame.`);
          }
        }
        if (el.pipLayout && !(FOOTAGE_PIP_LAYOUTS as readonly string[]).includes(el.pipLayout)) {
          problems.push(`Footage element "${el.id}" has an unknown picture-in-picture layout.`);
        }
      }
      if (el.kind === "character" && !el.characterRef) problems.push(`Character element "${el.id}" needs a characterRef.`);
      if (el.drawOn) {
        if (el.drawOn.durationMs !== undefined && !(el.drawOn.durationMs > 0)) {
          problems.push(`Element "${el.id}" drawOn durationMs must be positive.`);
        }
        if (el.drawOn.eraseDurationMs !== undefined && el.drawOn.eraseDurationMs < 0) {
          problems.push(`Element "${el.id}" drawOn eraseDurationMs cannot be negative.`);
        }
        if (el.drawOn.eraseDelayMs !== undefined && el.drawOn.eraseDelayMs < 0) {
          problems.push(`Element "${el.id}" drawOn eraseDelayMs cannot be negative.`);
      if (el.colorCorrection) {
        for (const key of COLOR_CORRECTION_KEYS) {
          const value = el.colorCorrection[key];
          if (
            typeof value !== "number" ||
            !Number.isFinite(value) ||
            value < COLOR_CORRECTION_MIN ||
            value > COLOR_CORRECTION_MAX
          ) {
            problems.push(
              `Element "${el.id}" has a colour correction ${key} outside ${COLOR_CORRECTION_MIN} to ${COLOR_CORRECTION_MAX}.`,
            );
          }
        }
      }
    }
    for (const line of s.dialogue ?? []) {
      if (!line.id) problems.push(`Scene "${s.name || i + 1}" has a dialogue line without an id.`);
      for (const w of line.wordTimings ?? []) {
        if (w.endMs < w.startMs) problems.push(`Dialogue line "${line.id}" has a word timing ending before it starts.`);
      }
    }
    const markerIds = new Set<string>();
    for (const m of s.markers ?? []) {
      if (m.atMs < 0 || m.atMs > s.durationMs) problems.push(`Scene "${s.name || i + 1}" has a marker outside the scene.`);
      if (!CUE_MARKER_TYPES.includes(m.type)) problems.push(`Scene "${s.name || i + 1}" has a marker with an unknown type "${String(m.type)}".`);
      if (m.id) {
        if (markerIds.has(m.id)) problems.push(`Scene "${s.name || i + 1}" has a duplicate marker id "${m.id}".`);
        markerIds.add(m.id);
      }
      // Payloads are validated when present; a marker without a payload
      // is still a valid cue point (the player fires its cue-point event).
      if (m.question !== undefined) {
        if (m.type !== "knowledge-check") problems.push(`Scene "${s.name || i + 1}" has a question payload on a ${m.type} marker.`);
        if (!m.question.prompt?.trim()) problems.push(`Scene "${s.name || i + 1}" has a knowledge check marker with an empty question prompt.`);
        const choiceIds = new Set((m.question.choices ?? []).map((c) => c.id));
        if (choiceIds.size < 2) problems.push(`Scene "${s.name || i + 1}" has a knowledge check marker with fewer than two question choices.`);
        for (const correctId of m.question.correctChoiceIds ?? []) {
          if (!choiceIds.has(correctId)) problems.push(`Scene "${s.name || i + 1}" has a knowledge check marker whose correct choice "${correctId}" is not one of its choices.`);
        }
      }
      if (m.branchChoices !== undefined) {
        if (m.type !== "branch") problems.push(`Scene "${s.name || i + 1}" has branch choices on a ${m.type} marker.`);
        if (m.branchChoices.length < 2) problems.push(`Scene "${s.name || i + 1}" has a branch marker with fewer than two choices.`);
        for (const choice of m.branchChoices) {
          if (!choice.label?.trim()) problems.push(`Scene "${s.name || i + 1}" has a branch marker with an unnamed choice.`);
          if (choice.jumpToMs !== undefined && (choice.jumpToMs < 0 || choice.jumpToMs > s.durationMs)) {
            problems.push(`Scene "${s.name || i + 1}" has a branch choice jumping outside the scene.`);
          }
        }
      }
    }
    if (s.multicam) {
      for (const problem of validateMulticamGroup(s.multicam, s.durationMs)) {
        problems.push(`Scene "${s.name || i + 1}": ${problem}`);
      }
      const elementIds = new Set((s.elements ?? []).map((el) => el.id));
      for (const angle of s.multicam.angles) {
        if (angle.sourceId && !elementIds.has(angle.sourceId)) {
          problems.push(`Scene "${s.name || i + 1}": multicam angle "${angle.id}" points at missing element "${angle.sourceId}".`);
        }
      }
    }
  });
  for (const ref of projectAssetRefs(p)) {
    const t = getAssetTranscript(ref);
    if (!t) continue;
    if (!t.contentHash) problems.push(`Transcript for "${t.clipId}" is missing its content hash.`);
    for (const w of t.words) {
      if (w.endMs < w.startMs) problems.push(`Transcript for "${t.clipId}" has a word ending before it starts.`);
      if (w.confidence !== undefined && (w.confidence < 0 || w.confidence > 1)) {
        problems.push(`Transcript for "${t.clipId}" has a word confidence outside 0..1.`);
      }
    }
  }
  return problems;
}
