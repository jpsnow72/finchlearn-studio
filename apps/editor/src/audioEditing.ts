import { newVideoId } from "@finch-studio/animation";
import type { AudioObject, CourseObject, Extensions, VideoProject } from "@finch-studio/core";
import {
  planSilenceTightening,
  type SilenceOptions,
  type SilenceTighteningPlan,
  DEFAULT_CLEAN_VOICE,
  DEFAULT_DUCKING_LEVEL,
  DUCKING_LEVELS,
  normalizeCleanVoiceSettings,
  type CleanVoiceSettings,
  type DuckingLevel,
} from "@finch-studio/audio";

export type { CleanVoiceSettings, DuckingLevel };

export interface AudioVolumeKeyframe {
  timeMs: number;
  decibels: number;
}

/** Track role in the audio engine (@finch-studio/audio AudioRole). */
export type AudioClipRole = "voice" | "music" | "sfx" | "description";

export interface AudioClipMetadata {
  waveformPeaks?: number[];
  fadeInMs?: number;
  fadeOutMs?: number;
  volumeKeyframes?: AudioVolumeKeyframe[];
  sourceOffsetMs?: number;
  /**
   * Dedicated Audio Description role (issue #63). Absent means the clip
   * follows its timeline lane (music lane = music, anything else voice).
   */
  role?: AudioClipRole;
  /** AD script text for a description clip; becomes its VTT cue text. */
  descriptionText?: string;
  /** Clean Voice (#29). Absent means OFF: the clip renders exactly as before. */
  cleanVoice?: CleanVoiceSettings;
  /** True when this clip is the scene's chosen recorded voiceover (#31). */
  voiceover?: boolean;
  /** Id of the voiceover take this clip was chosen from (#31). */
  voiceoverTakeId?: string;
}

const AUDIO_ROLES: readonly AudioClipRole[] = ["voice", "music", "sfx", "description"];

/** The engine role of an editor audio object: explicit metadata wins,
 * then the timeline lane convention the export already uses. */
export function audioRoleForObject(
  object: AudioObject,
  lane?: string,
): AudioClipRole {
  const role = getAudioClipMetadata(object).role;
  if (role) return role;
  return lane === "music" ? "music" : "voice";
}

export function isDescriptionObject(object: AudioObject, lane?: string): boolean {
  return audioRoleForObject(object, lane) === "description";
}

/** The clip's Clean Voice setting, defaulting to OFF when never set. */
export function getCleanVoiceSettings(object: AudioObject): CleanVoiceSettings {
  return getAudioClipMetadata(object).cleanVoice ?? { ...DEFAULT_CLEAN_VOICE };
}

const AUDIO_EXTENSION = "x-finch-studio";
const MIN_DECIBELS = -60;
const MAX_DECIBELS = 6;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getAudioClipMetadata(object: AudioObject): AudioClipMetadata {
  const raw = object.extensions?.[AUDIO_EXTENSION];
  if (!isRecord(raw)) return {};

  const peaks = Array.isArray(raw.waveformPeaks)
    ? raw.waveformPeaks.filter(
        (peak): peak is number => typeof peak === "number" && Number.isFinite(peak),
      )
    : undefined;
  const keyframes = Array.isArray(raw.volumeKeyframes)
    ? raw.volumeKeyframes.filter(
        (keyframe): keyframe is AudioVolumeKeyframe =>
          isRecord(keyframe) &&
          typeof keyframe.timeMs === "number" &&
          Number.isFinite(keyframe.timeMs) &&
          typeof keyframe.decibels === "number" &&
          Number.isFinite(keyframe.decibels),
      )
    : undefined;

  return {
    waveformPeaks: peaks,
    fadeInMs: finiteNonNegative(raw.fadeInMs),
    fadeOutMs: finiteNonNegative(raw.fadeOutMs),
    volumeKeyframes: keyframes,
    sourceOffsetMs: finiteNonNegative(raw.sourceOffsetMs),
    role: AUDIO_ROLES.includes(raw.role as AudioClipRole)
      ? (raw.role as AudioClipRole)
      : undefined,
    descriptionText: typeof raw.descriptionText === "string" ? raw.descriptionText : undefined,
    cleanVoice:
      raw.cleanVoice === undefined
        ? undefined
        : normalizeCleanVoiceSettings(raw.cleanVoice),
    voiceover: raw.voiceover === true ? true : undefined,
    voiceoverTakeId:
      typeof raw.voiceoverTakeId === "string" && raw.voiceoverTakeId
        ? raw.voiceoverTakeId
        : undefined,
  };
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value)
    : undefined;
}

export function withAudioClipMetadata(
  object: AudioObject,
  patch: Partial<AudioClipMetadata>,
): AudioObject {
  const extensions: Extensions = { ...(object.extensions ?? {}) };
  // Preserve unrelated x-finch-studio metadata (for example the clip's
  // transcript, #43/#45) alongside the audio fields: a trim or split
  // rebuilds this record, and dropping the rest would silently strip
  // the transcript from the resulting pieces.
  const existing = isRecord(object.extensions?.[AUDIO_EXTENSION])
    ? object.extensions[AUDIO_EXTENSION]
    : {};
  extensions[AUDIO_EXTENSION] = {
    ...existing,
    ...getAudioClipMetadata(object),
    ...patch,
    ...(patch.cleanVoice !== undefined
      ? { cleanVoice: normalizeCleanVoiceSettings(patch.cleanVoice) }
      : {}),
  };
  return { ...object, extensions };
}

/**
 * Apply one Clean Voice setting to every audio clip in a scene (the
 * "apply to all voice clips" path, #29). The editor's audio clips all
 * sit on the voice lane by default; clips are plain audio objects, so
 * every audio object in the scene is a candidate. Non-audio objects
 * pass through untouched and inputs are never mutated.
 */
export function withCleanVoiceOnAllAudioClips(
  objects: CourseObject[],
  settings: CleanVoiceSettings,
): CourseObject[] {
  const normalized = normalizeCleanVoiceSettings(settings);
  return objects.map((object) =>
    object.type === "audio"
      ? withAudioClipMetadata(object as AudioObject, { cleanVoice: normalized })
      : object,
  );
}

export function decibelsToVolume(decibels: number): number {
  const bounded = Math.min(MAX_DECIBELS, Math.max(MIN_DECIBELS, decibels));
  return 10 ** (bounded / 20);
}

export function volumeToDecibels(volume: number): number {
  if (!Number.isFinite(volume) || volume <= 0) return MIN_DECIBELS;
  return Math.min(MAX_DECIBELS, Math.max(MIN_DECIBELS, 20 * Math.log10(volume)));
}

export function addAudioVolumeKeyframe(
  object: AudioObject,
  timeMs: number,
  decibels: number,
  durationMs: number,
): AudioObject {
  const time = Math.min(Math.max(0, timeMs), Math.max(0, durationMs));
  const boundedDb = Math.min(MAX_DECIBELS, Math.max(MIN_DECIBELS, decibels));
  const keyframes = getAudioClipMetadata(object).volumeKeyframes ?? [];
  const next = [
    ...keyframes.filter((keyframe) => keyframe.timeMs !== time),
    { timeMs: time, decibels: boundedDb },
  ].sort((a, b) => a.timeMs - b.timeMs);
  return withAudioClipMetadata(object, { volumeKeyframes: next });
}

function withTrimmedAudio(
  object: AudioObject,
  startMs: number,
  durationMs: number,
  peakFrom: number,
  peakTo: number,
  sourceOffsetDeltaMs: number,
  keyframeFromMs: number,
  clearFadeIn: boolean,
  clearFadeOut: boolean,
): AudioObject {
  const metadata = getAudioClipMetadata(object);
  const peaks = metadata.waveformPeaks;
  const patch: Partial<AudioClipMetadata> = {};
  if (peaks?.length) {
    const from = Math.floor(peaks.length * peakFrom);
    const to = Math.max(from + 1, Math.ceil(peaks.length * peakTo));
    patch.waveformPeaks = peaks.slice(from, to);
  }
  if (clearFadeIn) patch.fadeInMs = 0;
  if (clearFadeOut) patch.fadeOutMs = 0;
  if (sourceOffsetDeltaMs > 0) {
    patch.sourceOffsetMs = (metadata.sourceOffsetMs ?? 0) + sourceOffsetDeltaMs;
  }
  if (metadata.volumeKeyframes) {
    patch.volumeKeyframes = metadata.volumeKeyframes
      .filter(
        (keyframe) =>
          keyframe.timeMs >= keyframeFromMs &&
          keyframe.timeMs <= keyframeFromMs + durationMs,
      )
      .map((keyframe) => ({
        ...keyframe,
        timeMs: keyframe.timeMs - keyframeFromMs,
      }));
  }
  return {
    ...withAudioClipMetadata(object, patch),
    timing: {
      ...object.timing,
      start: startMs / 1000,
      duration: durationMs / 1000,
    },
  };
}

export interface ClipSilenceAnalysis {
  /** False when the clip carries no ingest peaks to detect from. */
  hasPeaks: boolean;
  durationMs: number;
  plan: SilenceTighteningPlan;
}

/**
 * Silence analysis for one clip (issue #30), from the waveform peaks
 * stored at ingest. Detection lives in @finch-studio/audio so the panel,
 * the preview timing, and the export mix all read the same plan.
 */
export function analyzeClipSilence(
  object: AudioObject,
  sceneDurationMs: number,
  options?: Partial<SilenceOptions>,
): ClipSilenceAnalysis {
  const metadata = getAudioClipMetadata(object);
  const peaks = metadata.waveformPeaks ?? [];
  const durationMs = Math.max(
    0,
    Math.round((object.timing?.duration ?? sceneDurationMs / 1000) * 1000),
  );
  return {
    hasPeaks: peaks.length > 0,
    durationMs,
    plan: planSilenceTightening(peaks, durationMs, options),
  };
}

/**
 * Apply a tightening plan to a scene's objects as ripple trims: each cut
 * goes through the same ripple delete the timeline region tool uses, so
 * the target clip splits with correct source offsets and peaks, later
 * objects shift earlier, and the result is ordinary clips the export mix
 * schedules exactly like the preview. Cuts run last to first so earlier
 * cut positions stay valid while later ones are removed. The source
 * media is never rewritten. Callers commit the result once, which makes
 * the whole tightening a single step on the shared undo stack.
 */
export function tightenClipSilence(
  objects: CourseObject[],
  clipId: string,
  plan: SilenceTighteningPlan,
  sceneDurationMs: number,
): CourseObject[] {
  if (plan.cuts.length === 0) return objects;
  const target = objects.find(
    (object): object is AudioObject => object.type === "audio" && object.id === clipId,
  );
  if (!target) return objects;
  const clipStartMs = Math.max(0, Math.round((target.timing?.start ?? 0) * 1000));
  let next = objects;
  const descending = [...plan.cuts].sort((a, b) => b.startMs - a.startMs);
  for (const cut of descending) {
    next = rippleDeleteAudioRegion(
      next,
      clipStartMs + cut.startMs,
      clipStartMs + cut.endMs,
      sceneDurationMs,
    );
  }
  return next;
}

export function rippleDeleteAudioRegion(
  objects: CourseObject[],
  startMs: number,
  endMs: number,
  sceneDurationMs: number,
): CourseObject[] {
  const start = Math.max(0, Math.min(startMs, endMs));
  const end = Math.min(sceneDurationMs, Math.max(startMs, endMs));
  const removedDuration = end - start;
  if (removedDuration <= 0) return objects;

  return objects.flatMap<CourseObject>((object): CourseObject[] => {
    if (object.type !== "audio") {
      const timing = object.timing;
      if (!timing || timing.duration === undefined) return [object];
      const clipStart = Math.max(0, (timing.start ?? 0) * 1000);
      const clipDuration = Math.max(0, timing.duration * 1000);
      const clipEnd = clipStart + clipDuration;
      if (clipEnd <= start) return [object];
      if (clipStart >= end) {
        return [{
          ...object,
          timing: { ...timing, start: (clipStart - removedDuration) / 1000 },
        }];
      }
      const overlap = Math.min(clipEnd, end) - Math.max(clipStart, start);
      const nextDuration = Math.max(0, clipDuration - overlap);
      if (nextDuration === 0) return [];
      return [{
        ...object,
        timing: {
          ...timing,
          start: (clipStart >= start ? start : clipStart) / 1000,
          duration: nextDuration / 1000,
        },
      }];
    }
    const audio = object as AudioObject;
    const clipStart = Math.max(0, (audio.timing?.start ?? 0) * 1000);
    const clipDuration = Math.max(
      0,
      (audio.timing?.duration ?? sceneDurationMs / 1000) * 1000,
    );
    const clipEnd = clipStart + clipDuration;
    if (clipEnd <= start) return [audio];
    if (clipStart >= end) {
      return [{
        ...audio,
        timing: { ...audio.timing, start: (clipStart - removedDuration) / 1000 },
      }];
    }

    const leftDuration = Math.max(0, start - clipStart);
    const rightDuration = Math.max(0, clipEnd - end);
    if (leftDuration > 0 && rightDuration > 0) {
      const left = withTrimmedAudio(
        audio,
        clipStart,
        leftDuration,
        0,
        leftDuration / clipDuration,
        0,
        0,
        false,
        true,
      );
      const right = withTrimmedAudio(
        {
          ...audio,
          id: newVideoId("audio"),
        },
        start,
        rightDuration,
        (end - clipStart) / clipDuration,
        1,
        end - clipStart,
        end - clipStart,
        true,
        false,
      );
      return [left, right];
    }
    if (leftDuration > 0) {
      return [
        withTrimmedAudio(
          audio,
          clipStart,
          leftDuration,
          0,
          leftDuration / clipDuration,
          0,
          0,
          false,
          true,
        ),
      ];
    }
    if (rightDuration > 0) {
      return [
        withTrimmedAudio(
          audio,
          start,
          rightDuration,
          (end - clipStart) / clipDuration,
          1,
          end - clipStart,
          end - clipStart,
          true,
          false,
        ),
      ];
    }
    return [];
  });
}

/**
 * Project-level ducking (issue #28): one setting for the whole project,
 * stored in the x-finch-studio extension like the caption style. The
 * export mix reads it through the shared @finch-studio/audio levels, so
 * the depth the user picks is the depth the render applies.
 */
const STUDIO_EXTENSION = "x-finch-studio";

interface ProjectAudioExtension {
  ducking?: DuckingLevel;
  [key: string]: unknown;
}

function projectAudioExtension(project: VideoProject): ProjectAudioExtension {
  const raw = project.extensions?.[STUDIO_EXTENSION];
  return raw && typeof raw === "object" ? (raw as ProjectAudioExtension) : {};
}

export function getProjectDucking(project: VideoProject): DuckingLevel {
  const level = projectAudioExtension(project).ducking;
  return level && DUCKING_LEVELS.includes(level) ? level : DEFAULT_DUCKING_LEVEL;
}

export function withProjectDucking(
  project: VideoProject,
  level: DuckingLevel,
): VideoProject {
  return {
    ...project,
    extensions: {
      ...project.extensions,
      [STUDIO_EXTENSION]: { ...projectAudioExtension(project), ducking: level },
    },
  };
}
