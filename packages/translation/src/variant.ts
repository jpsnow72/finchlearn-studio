/**
 * variant.ts — build a translated project variant (issue #54).
 *
 * A variant is a full copy of the source project with its own identity
 * (new project, scene, object, and line ids), linked back to its
 * source through project metadata in the established extension style:
 * `extensions["x-finch-studio"]` carries kind, sourceProjectId,
 * sourceLanguage, language, direction, provider, and creation time.
 * The source project object is never mutated: the builder reads it,
 * translates through the provider port, and writes only into a deep
 * clone.
 *
 * What gets translated (see collectTranslatableStrings):
 *  - the project title and every scene title,
 *  - text objects (RichText: markup preserved, words translated),
 *  - button labels and popup titles,
 *  - character speech lines, which are both the on-screen speech
 *    bubbles and the dialogue that gets re-voiced.
 *
 * Re-voicing: each character's voice is mapped to the target language
 * by the rule in voices.ts (or a per-character override), stored on the
 * variant character in the same extension slot the editor's voice
 * picker uses. When the caller supplies `measureLineMs` (the editor
 * passes its production TTS generator), every line with a voice is
 * re-narrated and its duration is set to the measured audio length,
 * exactly like the Dialogue panel's Generate narration flow. Lines
 * whose character has no voice for the language keep their source
 * timing as a placeholder and are counted as pending in the report;
 * they are never narrated in a wrong-language voice.
 *
 * Captions: the variant's caption track rides the existing caption
 * model. Cues derive from the translated speech lines with the same
 * timing the editor's caption export uses, the track is a standard
 * CaptionTrack in the target language, and SRT/VTT formatting matches
 * the editor's caption presets.
 *
 * Support levels (G-8, #123): every variant records the language's
 * computed support level (support.ts) in its metadata and report. A
 * partial language (translation and captions, no narration voice)
 * builds exactly the unvoiced shape described above: text and captions
 * translated, characters flagged for voice assignment, no lip sync
 * regenerated. The level is data on the variant, never a silent
 * degradation.
 */
import type {
  CharacterObject,
  CourseObject,
  VideoProject,
} from "@finch-studio/core";
import { newVideoId, projectTimeline, sceneContentDurationMs } from "@finch-studio/animation";
import type { CaptionTrack } from "@finch-studio/schema";
import {
  languageByCode,
  SOURCE_LANGUAGE,
  type TextDirection,
  type TranslationLanguage,
} from "./languages.js";
import {
  isTranslatableText,
  splitRichText,
  TranslationNotConfiguredError,
  NOT_CONFIGURED_MESSAGE,
  type TranslationProvider,
} from "./provider.js";
import { languageSupport, type LanguageSupport } from "./support.js";
import { mapVoiceForLanguage, type VoiceMapping } from "./voices.js";

export const STUDIO_EXTENSION = "x-finch-studio";

export interface TranslationVariantMeta {
  kind: "translation-variant";
  sourceProjectId: string;
  sourceLanguage: string;
  language: string;
  direction: TextDirection;
  createdAt: string;
  providerId: string;
  /** Full-chain or partial support, computed in support.ts (G-8). */
  support: LanguageSupport;
}

type ExtBag = Record<string, Record<string, unknown>>;

function extOf(holder: { extensions?: ExtBag }): Record<string, unknown> {
  return holder.extensions?.[STUDIO_EXTENSION] ?? {};
}

export function translationMetaOf(
  project: VideoProject,
): TranslationVariantMeta | undefined {
  const meta = extOf(project as { extensions?: ExtBag });
  return meta["kind"] === "translation-variant"
    ? (meta as unknown as TranslationVariantMeta)
    : undefined;
}

/** Text direction stamped on a rendered object, when a variant set one. */
export function textDirectionOf(object: CourseObject): TextDirection | undefined {
  const dir = extOf(object)["dir"];
  return dir === "rtl" || dir === "ltr" ? dir : undefined;
}

/** The production voice assigned on an object, in the editor's slot. */
function objectVoiceId(object: CourseObject): string | undefined {
  const v = extOf(object)["voiceId"];
  return typeof v === "string" && v ? v : undefined;
}

// ---------------------------------------------------------------------------
// Translatable string collection
// ---------------------------------------------------------------------------

export type TranslatableKind =
  | "project-title"
  | "scene-title"
  | "text"
  | "button-label"
  | "popup-title"
  | "speech";

export interface TranslatableString {
  kind: TranslatableKind;
  sceneId?: string;
  objectId?: string;
  lineId?: string;
  /** The full source string (RichText HTML for rich kinds). */
  text: string;
  rich: boolean;
}

interface ObjectTextSlot {
  kind: TranslatableKind;
  get: () => string | undefined;
}

function textSlotsOf(object: CourseObject): ObjectTextSlot[] {
  const slots: ObjectTextSlot[] = [];
  const anyObj = object as unknown as Record<string, unknown>;
  if (object.type === "text") {
    slots.push({ kind: "text", get: () => anyObj["content"] as string | undefined });
  }
  if (object.type === "button") {
    slots.push({ kind: "button-label", get: () => anyObj["label"] as string | undefined });
  }
  if (object.type === "popup") {
    slots.push({ kind: "popup-title", get: () => anyObj["title"] as string | undefined });
  }
  return slots;
}

function childObjectsOf(object: CourseObject): CourseObject[] {
  const anyObj = object as unknown as Record<string, unknown>;
  const out: CourseObject[] = [];
  if (Array.isArray(anyObj["objects"])) out.push(...(anyObj["objects"] as CourseObject[]));
  if (Array.isArray(anyObj["panels"])) {
    for (const p of anyObj["panels"] as { content?: CourseObject[] }[]) {
      if (Array.isArray(p.content)) out.push(...p.content);
    }
  }
  if (Array.isArray(anyObj["tabs"])) {
    for (const t of anyObj["tabs"] as { content?: CourseObject[] }[]) {
      if (Array.isArray(t.content)) out.push(...t.content);
    }
  }
  return out;
}

function walkObjects(
  objects: CourseObject[],
  fn: (object: CourseObject) => void,
): void {
  for (const object of objects) {
    fn(object);
    walkObjects(childObjectsOf(object), fn);
  }
}

const RICH_KINDS: ReadonlySet<TranslatableKind> = new Set(["text", "button-label"]);

/** Every translatable string in a project, in document order. */
export function collectTranslatableStrings(project: VideoProject): TranslatableString[] {
  const out: TranslatableString[] = [];
  if (project.name) {
    out.push({ kind: "project-title", text: project.name, rich: false });
  }
  for (const scene of project.scenes) {
    if (scene.name) {
      out.push({ kind: "scene-title", sceneId: scene.id, text: scene.name, rich: false });
    }
    walkObjects(scene.objects, (object) => {
      for (const slot of textSlotsOf(object)) {
        const text = slot.get();
        if (text) {
          out.push({
            kind: slot.kind,
            sceneId: scene.id,
            objectId: object.id,
            text,
            rich: RICH_KINDS.has(slot.kind),
          });
        }
      }
      if (object.type === "character") {
        for (const line of (object as CharacterObject).speech ?? []) {
          out.push({
            kind: "speech",
            sceneId: scene.id,
            objectId: object.id,
            lineId: line.id,
            text: line.text,
            rich: false,
          });
        }
      }
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Variant construction
// ---------------------------------------------------------------------------

export interface CharacterVoiceReport {
  sourceObjectId: string;
  variantObjectId: string;
  name?: string;
  sourceVoiceId?: string;
  mapping: VoiceMapping;
}

export interface VariantReport {
  targetLanguage: string;
  /** Full-chain or partial support, computed in support.ts (G-8). */
  support: LanguageSupport;
  direction: TextDirection;
  stringsTranslated: number;
  characters: CharacterVoiceReport[];
  /** Lines re-narrated and re-timed from measured audio. */
  linesRevoiced: number;
  /** Lines left unvoiced because no voice exists for the language. */
  linesPendingVoice: number;
  captionTrack: CaptionTrack;
}

export interface CreateVariantOptions {
  provider: TranslationProvider;
  /** Target language code from TRANSLATION_LANGUAGES. */
  targetLanguage: string;
  sourceLanguage?: string;
  /**
   * Per-character voice overrides, keyed by SOURCE character object id.
   * A string forces that voice; null leaves the character unvoiced.
   * Overrides win over the automatic mapping rule.
   */
  voiceOverrides?: Record<string, string | null>;
  /** How the editor resolves a character's current voice. Defaults to
   * the object's extension voice slot. */
  sourceVoiceOf?: (object: CourseObject) => string | undefined;
  /**
   * Re-narration hook: generate (or fetch) the audio for a translated
   * line and return its measured duration in ms. The editor passes its
   * production TTS path; omit it and durations stay as authored.
   */
  measureLineMs?: (
    text: string,
    voiceId: string,
  ) => Promise<number | undefined>;
  now?: () => string;
}

export interface CreatedVariant {
  project: VideoProject;
  report: VariantReport;
}

function cloneProject(project: VideoProject): VideoProject {
  return JSON.parse(JSON.stringify(project)) as VideoProject;
}

function regenerateIds(project: VideoProject): void {
  project.id = newVideoId("vproj");
  for (const scene of project.scenes) {
    scene.id = newVideoId("scene");
    walkObjects(scene.objects, (object) => {
      object.id = newVideoId("obj");
      if (object.type === "character") {
        for (const line of (object as CharacterObject).speech ?? []) {
          line.id = newVideoId("speech");
        }
      }
    });
  }
}

function setExtension(
  holder: { extensions?: ExtBag },
  patch: Record<string, unknown>,
): void {
  holder.extensions = {
    ...holder.extensions,
    [STUDIO_EXTENSION]: { ...extOf(holder), ...patch },
  };
}

export async function createTranslatedVariant(
  source: VideoProject,
  opts: CreateVariantOptions,
): Promise<CreatedVariant> {
  const target: TranslationLanguage | undefined = languageByCode(opts.targetLanguage);
  if (!target) {
    throw new Error(`Unknown target language: ${opts.targetLanguage}`);
  }
  if (!opts.provider.isConfigured) {
    throw new TranslationNotConfiguredError(NOT_CONFIGURED_MESSAGE);
  }
  const sourceLanguage = opts.sourceLanguage ?? SOURCE_LANGUAGE;

  // 1. Collect and translate every unique text segment in one batch.
  const entries = collectTranslatableStrings(source);
  const segments: string[] = [];
  const segmentIndex = new Map<string, number>();
  const addSegment = (text: string) => {
    if (!segmentIndex.has(text)) {
      segmentIndex.set(text, segments.length);
      segments.push(text);
    }
  };
  for (const entry of entries) {
    if (entry.rich) {
      for (const part of splitRichText(entry.text)) {
        if (!part.tag && isTranslatableText(part.text)) addSegment(part.text);
      }
    } else if (isTranslatableText(entry.text)) {
      addSegment(entry.text);
    }
  }
  const translated =
    segments.length > 0
      ? await opts.provider.translateBatch(segments, {
          from: sourceLanguage,
          to: target.translateCode,
        })
      : [];
  const dict = new Map<string, string>();
  segments.forEach((text, i) => dict.set(text, translated[i] ?? text));
  const translatePlain = (text: string): string =>
    isTranslatableText(text) ? (dict.get(text) ?? text) : text;
  const translateRich = (html: string): string =>
    splitRichText(html)
      .map((part) => (part.tag ? part.text : translatePlain(part.text)))
      .join("");

  // 2. Clone, then apply translations by parallel walk (same structure).
  const variant = cloneProject(source);
  const characterReports: Omit<CharacterVoiceReport, "variantObjectId">[] = [];
  const variantCharacters: CourseObject[] = [];
  const revoiceJobs: { line: { duration: number }; text: string; voiceId: string }[] = [];
  let linesPendingVoice = 0;

  const applyObjects = (sourceObjs: CourseObject[], variantObjs: CourseObject[]) => {
    sourceObjs.forEach((srcObj, i) => {
      const varObj = variantObjs[i];
      if (!varObj) return;
      for (const slot of textSlotsOf(varObj)) {
        const srcText = textSlotsOf(srcObj).find((s) => s.kind === slot.kind)?.get();
        if (srcText) {
          const value = RICH_KINDS.has(slot.kind) ? translateRich(srcText) : translatePlain(srcText);
          const key =
            slot.kind === "text" ? "content" : slot.kind === "button-label" ? "label" : "title";
          (varObj as unknown as Record<string, unknown>)[key] = value;
        }
      }
      if (srcObj.type === "character" && varObj.type === "character") {
        const srcChar = srcObj as CharacterObject;
        const varChar = varObj as CharacterObject;
        const sourceVoiceId = opts.sourceVoiceOf
          ? opts.sourceVoiceOf(srcObj)
          : objectVoiceId(srcObj);
        const override = opts.voiceOverrides?.[srcObj.id];
        const mapping: VoiceMapping =
          override !== undefined
            ? {
                voiceId: override,
                reason: override
                  ? `Voice set by the user's per-character override: ${override}.`
                  : "Left unvoiced by the user's per-character override.",
              }
            : mapVoiceForLanguage(sourceVoiceId, target.code);
        if (mapping.voiceId) {
          setExtension(varObj, { voiceId: mapping.voiceId });
        } else {
          const bag = { ...extOf(varObj) };
          delete bag["voiceId"];
          bag["translationVoiceStatus"] = "needs-assignment";
          varObj.extensions = { ...varObj.extensions, [STUDIO_EXTENSION]: bag };
        }
        characterReports.push({
          sourceObjectId: srcObj.id,
          name: srcObj.name,
          sourceVoiceId,
          mapping,
        });
        variantCharacters.push(varObj);
        (srcChar.speech ?? []).forEach((srcLine, li) => {
          const varLine = varChar.speech?.[li];
          if (!varLine) return;
          varLine.text = translatePlain(srcLine.text);
          if (mapping.voiceId && opts.measureLineMs) {
            revoiceJobs.push({ line: varLine, text: varLine.text, voiceId: mapping.voiceId });
          } else if (!mapping.voiceId) {
            linesPendingVoice += 1;
          }
        });
      }
      applyObjects(childObjectsOf(srcObj), childObjectsOf(varObj));
    });
  };

  if (variant.name) variant.name = translatePlain(source.name);
  source.scenes.forEach((srcScene, si) => {
    const varScene = variant.scenes[si];
    if (!varScene) return;
    if (varScene.name) varScene.name = translatePlain(srcScene.name);
    applyObjects(srcScene.objects, varScene.objects);
  });

  // 3. Re-narrate: durations re-derive from the measured audio, exactly
  // like normal TTS lines (600ms floor, as in the Dialogue panel).
  let linesRevoiced = 0;
  for (const job of revoiceJobs) {
    const ms = await opts.measureLineMs!(job.text, job.voiceId);
    if (ms !== undefined && Number.isFinite(ms) && ms > 0) {
      job.line.duration = Math.max(600, Math.round(ms));
      linesRevoiced += 1;
    }
  }
  for (const scene of variant.scenes) {
    scene.durationMs = sceneContentDurationMs(scene);
  }

  // 4. RTL: stamp direction on every rendered text surface.
  if (target.direction === "rtl") {
    for (const scene of variant.scenes) {
      walkObjects(scene.objects, (object) => {
        if (
          object.type === "text" ||
          object.type === "button" ||
          object.type === "popup" ||
          object.type === "character"
        ) {
          setExtension(object, { dir: "rtl" });
        }
      });
    }
  }

  // 5. Fresh identity + source linkage in the extension style.
  regenerateIds(variant);
  const supportInfo = languageSupport(target.code);
  const meta: TranslationVariantMeta = {
    kind: "translation-variant",
    sourceProjectId: source.id,
    sourceLanguage,
    language: target.code,
    direction: target.direction,
    createdAt: (opts.now ?? (() => new Date().toISOString()))(),
    providerId: opts.provider.providerId,
    support: supportInfo?.support ?? "partial",
  };
  const metaRecord: Record<string, unknown> = {
    kind: meta.kind,
    sourceProjectId: meta.sourceProjectId,
    sourceLanguage: meta.sourceLanguage,
    language: meta.language,
    direction: meta.direction,
    createdAt: meta.createdAt,
    providerId: meta.providerId,
    support: meta.support,
  };
  (variant as { extensions?: ExtBag }).extensions = {
    ...(variant as { extensions?: ExtBag }).extensions,
    [STUDIO_EXTENSION]: metaRecord,
  };

  const report: VariantReport = {
    targetLanguage: target.code,
    support: meta.support,
    direction: target.direction,
    stringsTranslated: segments.length,
    characters: characterReports.map((c, i) => ({
      ...c,
      variantObjectId: variantCharacters[i]?.id ?? "",
    })),
    linesRevoiced,
    linesPendingVoice,
    captionTrack: captionTrackForVariant(variant),
  };
  return { project: variant, report };
}

// ---------------------------------------------------------------------------
// Captions: cues and tracks from the variant's translated speech
// ---------------------------------------------------------------------------

export interface CaptionCue {
  sceneId: string;
  startMs: number;
  endMs: number;
  text: string;
}

/** Caption cues for a project, on the project timeline (editor model). */
export function captionCuesForProject(project: VideoProject): CaptionCue[] {
  const { scenes } = projectTimeline(project);
  return scenes
    .flatMap(({ scene, startMs }) =>
      scene.objects.flatMap((object) => {
        if (object.type !== "character") return [];
        return ((object as CharacterObject).speech ?? []).flatMap((line) => {
          const start = Math.max(0, line.start);
          const end = Math.min(scene.durationMs, line.start + line.duration);
          const text = line.text.trim();
          if (!text || end <= start) return [];
          return [{ sceneId: scene.id, startMs: startMs + start, endMs: startMs + end, text }];
        });
      }),
    )
    .sort((a, b) => a.startMs - b.startMs);
}

/**
 * The variant's caption track in the existing schema caption model: one
 * track in the variant's language, its cues derived from the translated
 * dialogue (captionCuesForProject). A rendered sidecar asset is attached
 * later by the normal export path, exactly like source-language tracks.
 */
export function captionTrackForVariant(project: VideoProject): CaptionTrack {
  const meta = translationMetaOf(project);
  return {
    id: newVideoId("caption"),
    lang: meta?.language ?? SOURCE_LANGUAGE,
  };
}

/** SRT/VTT rendering of a project's caption cues (editor preset shape). */
export function formatVariantCaptions(
  project: VideoProject,
  format: "srt" | "vtt",
): string {
  const cues = captionCuesForProject(project);
  const timestamp = (ms: number) => {
    const total = Math.max(0, Math.round(ms));
    const hours = Math.floor(total / 3_600_000);
    const minutes = Math.floor((total % 3_600_000) / 60_000);
    const seconds = Math.floor((total % 60_000) / 1000);
    const millis = total % 1000;
    const separator = format === "srt" ? "," : ".";
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${separator}${String(millis).padStart(3, "0")}`;
  };
  const output = cues.map(
    (cue, index) =>
      `${index + 1}\n${timestamp(cue.startMs)} --> ${timestamp(cue.endMs)}\n${cue.text}`,
  );
  return format === "vtt"
    ? `WEBVTT\n\n${output.join("\n\n")}${output.length ? "\n" : ""}`
    : output.join("\n\n");
}
