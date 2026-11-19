/**
 * FinchLearn Studio project schema v1 (issue #4).
 *
 * One versioned JSON document per project. Scenes hold timed elements;
 * global music and captions span scenes. Assets are referenced by R2 key
 * only: never bytes, never viewer identity (media resolution keys off the
 * project's own entitlements, the FinchLearn media identity rule).
 */

import type { AnimationPreset } from "@finch-studio/core";

export const STUDIO_SCHEMA_VERSION = 1 as const;

export interface AssetRef {
  /** Object key in R2, for example u/{owner}/{project}/{asset}. */
  r2Key: string;
  kind: "video" | "audio" | "image";
  sha256?: string;
  width?: number;
  height?: number;
  durationMs?: number;
}

export interface WordTiming {
  word: string;
  startMs: number;
  endMs: number;
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

export interface CueMarker {
  atMs: number;
  type: "knowledge-check" | "branch" | "modal" | "chapter";
  label?: string;
  /** OCF side payload reference, carried losslessly through the mapping. */
  ocfRef?: string;
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
}

export interface FootageElement extends ElementBase {
  kind: "footage";
  asset: AssetRef;
  sourceInMs: number;
  sourceOutMs: number;
  speed: number;
  volume: number;
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
  elements: SceneElement[];
  dialogue: DialogueLine[];
  markers?: CueMarker[];
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
      }
      if (el.kind === "character" && !el.characterRef) problems.push(`Character element "${el.id}" needs a characterRef.`);
    }
    for (const line of s.dialogue ?? []) {
      if (!line.id) problems.push(`Scene "${s.name || i + 1}" has a dialogue line without an id.`);
      for (const w of line.wordTimings ?? []) {
        if (w.endMs < w.startMs) problems.push(`Dialogue line "${line.id}" has a word timing ending before it starts.`);
      }
    }
    for (const m of s.markers ?? []) {
      if (m.atMs < 0 || m.atMs > s.durationMs) problems.push(`Scene "${s.name || i + 1}" has a marker outside the scene.`);
    }
  });
  return problems;
}
