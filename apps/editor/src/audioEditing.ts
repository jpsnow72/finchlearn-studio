import { newVideoId } from "@finch-studio/animation";
import type { AudioObject, CourseObject, Extensions } from "@finch-studio/core";

export interface AudioVolumeKeyframe {
  timeMs: number;
  decibels: number;
}

export interface AudioClipMetadata {
  waveformPeaks?: number[];
  fadeInMs?: number;
  fadeOutMs?: number;
  volumeKeyframes?: AudioVolumeKeyframe[];
  sourceOffsetMs?: number;
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
  extensions[AUDIO_EXTENSION] = {
    ...getAudioClipMetadata(object),
    ...patch,
  };
  return { ...object, extensions };
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
  if (peakFrom > 0) {
    patch.sourceOffsetMs = (metadata.sourceOffsetMs ?? 0) + startMs;
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
    if (object.type !== "audio") return [object];
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
          true,
          false,
        ),
      ];
    }
    return [];
  });
}
