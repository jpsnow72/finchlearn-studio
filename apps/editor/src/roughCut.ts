/**
 * roughCut.ts — text based rough cut (issue #45).
 *
 * With a clip's ASR transcript available, the user edits the video by
 * editing text: the transcript is shown as sentences and words synced
 * to the clip, and deleting a sentence (or a word range) ripple deletes
 * the corresponding media segment from the clip's timeline. The
 * remaining media closes the gap. The edit lands on the same clip model
 * as every other timeline edit: ordinary clips carrying a timing plus a
 * source offset (sourceOffsetMs for audio, sourceInMs for video), so
 * preview and export schedule the result exactly like any other split.
 * Source media is never rewritten, and the store commits each text edit
 * once, so one deletion is one step on the shared undo stack.
 *
 * TRANSCRIPT SEAM (resolved when #43 landed): the transcript types
 * are imported from "@finch-studio/media" (the canonical #43 contract,
 * packages/media/src/transcript.ts) and the object read/write helpers
 * are re-exported from apps/editor/src/transcription.ts (the #43
 * editor bridge), reading the same extensions["x-finch-studio"]
 * transcript slot with the same validation. The transcript lives on
 * the clip object, word and segment times are milliseconds into the
 * SOURCE clip before any trim, and only a transcript with status
 * "ready" is trusted for editing. Everything below only depends on
 * the contract shapes.
 */
import { newVideoId } from "@finch-studio/animation";
import type { AudioObject, CourseObject, VideoObject } from "@finch-studio/core";
import {
  getAudioClipMetadata,
  rippleDeleteAudioRegion,
} from "./audioEditing";
import type {
  ClipTranscript,
  TranscriptSegment,
  TranscriptStatus,
  TranscriptWord,
} from "@finch-studio/media";

export type {
  ClipTranscript,
  TranscriptSegment,
  TranscriptStatus,
  TranscriptWord,
};
export { getObjectTranscript, withObjectTranscript } from "./transcription";

// ---------------------------------------------------------------------------
// Transcript contract: types from @finch-studio/media, object helpers
// re-exported from ./transcription (the #43 editor bridge)
// ---------------------------------------------------------------------------

const TRANSCRIPT_EXTENSION = "x-finch-studio";

/** Clips that can carry speech and therefore a rough cut: audio clips
 * and video footage. Mirrors isTranscribableObject in the #43 bridge. */
export function isRoughCutClip(object: CourseObject): boolean {
  return object.type === "audio" || object.type === "video";
}

// ---------------------------------------------------------------------------
// Availability: no transcript means unavailable with an explanation,
// never an error
// ---------------------------------------------------------------------------

export type RoughCutAvailability =
  | { available: true; transcript: ClipTranscript }
  | { available: false; status: TranscriptStatus; message: string };

/** Whether the rough cut surface can run for this clip, and if not, a
 * plain explanation to show instead. Transcription state comes from
 * the #43 contract: only a ready transcript with words can be edited. */
export function roughCutAvailability(object: CourseObject): RoughCutAvailability {
  if (!isRoughCutClip(object)) {
    return {
      available: false,
      status: "none",
      message: "Rough cut works on audio and video clips.",
    };
  }
  const transcript = getObjectTranscript(object);
  const status: TranscriptStatus = transcript?.status ?? "none";
  if (!transcript || status === "none") {
    return {
      available: false,
      status,
      message:
        "Rough cut needs a transcript. This clip has not been transcribed yet, so there is no text to edit.",
    };
  }
  if (status === "queued") {
    return {
      available: false,
      status,
      message:
        "Transcription is queued for this clip. Rough cut will be available when the transcript is ready.",
    };
  }
  if (status === "transcribing") {
    return {
      available: false,
      status,
      message:
        "This clip is being transcribed. Rough cut will be available when the transcript is ready.",
    };
  }
  if (status === "failed") {
    return {
      available: false,
      status,
      message: transcript.error
        ? `Transcription failed for this clip, so rough cut is not available. ${transcript.error}`
        : "Transcription failed for this clip, so rough cut is not available.",
    };
  }
  if (transcript.words.length === 0) {
    return {
      available: false,
      status,
      message: "The transcript for this clip has no words yet, so rough cut is not available.",
    };
  }
  return { available: true, transcript };
}

// ---------------------------------------------------------------------------
// Sentence segmentation (from the contract's words)
// ---------------------------------------------------------------------------

export interface RoughCutSentence {
  /** Position in the full sentence list for this transcript. */
  index: number;
  text: string;
  /** Word index range in transcript.words, end exclusive. */
  wordStartIndex: number;
  wordEndIndex: number;
  /** Source clip times of the first and last word. */
  startMs: number;
  endMs: number;
}

/** Words that end with a period but do not end a sentence. */
const NON_TERMINAL_WORDS = new Set([
  "mr.",
  "mrs.",
  "ms.",
  "dr.",
  "st.",
  "vs.",
  "e.g.",
  "i.e.",
  "etc.",
]);

function endsSentence(word: string): boolean {
  const trimmed = word.trim();
  if (NON_TERMINAL_WORDS.has(trimmed.toLowerCase())) return false;
  return /[.!?]["'”’)\]]*$/.test(trimmed);
}

/**
 * Split a transcript into sentences from its word timings. Sentences
 * close on terminal punctuation (. ! ?), the same rule the #43 caption
 * helper uses; a trailing run of words without punctuation is a final
 * sentence. Segment boundaries from the engine are utterances, not
 * sentences, so they are not used here; the word range is the edit
 * unit either way. Times are source clip times.
 */
export function sentencesFromTranscript(transcript: ClipTranscript): RoughCutSentence[] {
  const words = transcript.words;
  const sentences: RoughCutSentence[] = [];
  let start = 0;
  for (let i = 0; i < words.length; i++) {
    if (endsSentence(words[i].word) || i === words.length - 1) {
      sentences.push({
        index: sentences.length,
        text: words.slice(start, i + 1).map((w) => w.word).join(" "),
        wordStartIndex: start,
        wordEndIndex: i + 1,
        startMs: words[start].startMs,
        endMs: words[i].endMs,
      });
      start = i + 1;
    }
  }
  return sentences;
}

// ---------------------------------------------------------------------------
// Clip window and word range to time range mapping
// ---------------------------------------------------------------------------

export interface ClipSourceWindow {
  /** Scene time the clip starts at. */
  clipStartMs: number;
  clipDurationMs: number;
  /** Source time the clip's first visible frame or sample comes from:
   * sourceOffsetMs for audio, sourceInMs for video, per the #43
   * timing semantics. */
  sourceInMs: number;
  sourceOutMs: number;
}

function finiteNonNegative(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

/** The part of the source clip this timeline clip currently shows. */
export function clipSourceWindow(
  object: CourseObject,
  sceneDurationMs: number,
): ClipSourceWindow {
  const clipStartMs = Math.max(0, Math.round((object.timing?.start ?? 0) * 1000));
  const clipDurationMs = Math.max(
    0,
    Math.round((object.timing?.duration ?? sceneDurationMs / 1000) * 1000),
  );
  const sourceInMs =
    object.type === "audio"
      ? (getAudioClipMetadata(object as AudioObject).sourceOffsetMs ?? 0)
      : finiteNonNegative(object.extensions?.[TRANSCRIPT_EXTENSION]?.sourceInMs);
  return {
    clipStartMs,
    clipDurationMs,
    sourceInMs,
    sourceOutMs: sourceInMs + clipDurationMs,
  };
}

export interface SceneCutRange {
  /** Scene times to ripple delete. */
  startMs: number;
  endMs: number;
  /** The same range in source clip times, after clamping. */
  sourceStartMs: number;
  sourceEndMs: number;
  removedMs: number;
}

/** The source times a word index range covers, or null for an empty
 * or invalid range. Indices are clamped into the word list. */
export function wordRangeToSourceRange(
  transcript: ClipTranscript,
  wordStartIndex: number,
  wordEndIndex: number,
): { sourceStartMs: number; sourceEndMs: number } | null {
  const count = transcript.words.length;
  if (count === 0) return null;
  const start = Math.min(Math.max(0, Math.floor(wordStartIndex)), count);
  const end = Math.min(Math.max(start, Math.floor(wordEndIndex)), count);
  if (end <= start) return null;
  const sourceStartMs = transcript.words[start].startMs;
  const sourceEndMs = transcript.words[end - 1].endMs;
  if (sourceEndMs <= sourceStartMs) return null;
  return { sourceStartMs, sourceEndMs };
}

/**
 * Map a word index range onto scene times for one clip, following the
 * #43 timing semantics: scene time = clip start + (word time minus
 * source in). The range is clamped to the part of the source the clip
 * currently shows, so a range that starts before the clip's trim point
 * or runs past its end cuts only the visible part; a range with no
 * overlap with the visible window returns null (nothing to cut).
 */
export function wordRangeToSceneRange(
  transcript: ClipTranscript,
  object: CourseObject,
  wordStartIndex: number,
  wordEndIndex: number,
  sceneDurationMs: number,
): SceneCutRange | null {
  const source = wordRangeToSourceRange(transcript, wordStartIndex, wordEndIndex);
  if (!source) return null;
  const win = clipSourceWindow(object, sceneDurationMs);
  if (win.clipDurationMs <= 0) return null;
  const clampedSourceStart = Math.max(source.sourceStartMs, win.sourceInMs);
  const clampedSourceEnd = Math.min(source.sourceEndMs, win.sourceOutMs);
  if (clampedSourceEnd <= clampedSourceStart) return null;
  const startMs = Math.min(
    Math.max(0, win.clipStartMs + (clampedSourceStart - win.sourceInMs)),
    sceneDurationMs,
  );
  const endMs = Math.min(
    Math.max(startMs, win.clipStartMs + (clampedSourceEnd - win.sourceInMs)),
    sceneDurationMs,
  );
  if (endMs <= startMs) return null;
  return {
    startMs,
    endMs,
    sourceStartMs: clampedSourceStart,
    sourceEndMs: clampedSourceEnd,
    removedMs: endMs - startMs,
  };
}

// ---------------------------------------------------------------------------
// Sentences as the clip currently shows them
// ---------------------------------------------------------------------------

export interface RoughCutClipSentence {
  /** Position in this clip's visible sentence list. */
  index: number;
  text: string;
  /** Word index range in transcript.words (visible words only), end
   * exclusive. This is the range a deletion cuts. */
  wordStartIndex: number;
  wordEndIndex: number;
  /** Scene times the sentence occupies on this clip. */
  startMs: number;
  endMs: number;
}

/**
 * The sentences a clip currently shows, in scene order: each sentence
 * from the transcript reduced to the words inside the clip's visible
 * source window. After an earlier rough cut, a split piece therefore
 * lists only the sentences it still contains, and deleting one cuts
 * exactly its remaining words.
 */
export function sentencesForClip(
  transcript: ClipTranscript,
  object: CourseObject,
  sceneDurationMs: number,
): RoughCutClipSentence[] {
  const win = clipSourceWindow(object, sceneDurationMs);
  const out: RoughCutClipSentence[] = [];
  for (const sentence of sentencesFromTranscript(transcript)) {
    let first = -1;
    let last = -1;
    for (let i = sentence.wordStartIndex; i < sentence.wordEndIndex; i++) {
      const word = transcript.words[i];
      if (word.endMs > win.sourceInMs && word.startMs < win.sourceOutMs) {
        if (first < 0) first = i;
        last = i;
      }
    }
    if (first < 0) continue;
    const range = wordRangeToSceneRange(transcript, object, first, last + 1, sceneDurationMs);
    if (!range) continue;
    out.push({
      index: out.length,
      text: transcript.words.slice(first, last + 1).map((w) => w.word).join(" "),
      wordStartIndex: first,
      wordEndIndex: last + 1,
      startMs: range.startMs,
      endMs: range.endMs,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cut application: the same clip editing model as the timeline
// ---------------------------------------------------------------------------

function withTrimmedVideo(
  object: VideoObject,
  startMs: number,
  durationMs: number,
  sourceInDeltaMs: number,
): VideoObject {
  const meta: Record<string, unknown> = {
    ...(object.extensions?.[TRANSCRIPT_EXTENSION] ?? {}),
  };
  if (sourceInDeltaMs > 0) {
    meta.sourceInMs = finiteNonNegative(meta.sourceInMs) + sourceInDeltaMs;
  }
  return {
    ...object,
    timing: { ...object.timing, start: startMs / 1000, duration: durationMs / 1000 },
    extensions: { ...(object.extensions ?? {}), [TRANSCRIPT_EXTENSION]: meta },
  } as VideoObject;
}

/**
 * Ripple delete a scene region whose target is one clip. Audio targets
 * go through rippleDeleteAudioRegion, the exact function the timeline
 * region tool and silence tightening (#30) use, so an audio rough cut
 * is indistinguishable from any other audio ripple delete. Video
 * targets mirror that function piece for piece (split at the cut,
 * right piece keeps the tail with an advanced source in, later objects
 * shift earlier, overlapping non-target objects trim), with the
 * video source offset (sourceInMs) in place of the audio one. Other
 * objects get the same shift and trim treatment in both paths.
 */
export function rippleDeleteClipRegion(
  objects: CourseObject[],
  targetId: string,
  startMs: number,
  endMs: number,
  sceneDurationMs: number,
): CourseObject[] {
  const target = objects.find((object) => object.id === targetId);
  if (!target || !isRoughCutClip(target)) return objects;
  if (target.type === "audio") {
    return rippleDeleteAudioRegion(objects, startMs, endMs, sceneDurationMs);
  }
  const start = Math.max(0, Math.min(startMs, endMs));
  const end = Math.min(sceneDurationMs, Math.max(startMs, endMs));
  const removedDuration = end - start;
  if (removedDuration <= 0) return objects;

  return objects.flatMap<CourseObject>((object): CourseObject[] => {
    if (object.id !== targetId) {
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
    const video = object as VideoObject;
    const clipStart = Math.max(0, (video.timing?.start ?? 0) * 1000);
    const clipDuration = Math.max(
      0,
      (video.timing?.duration ?? sceneDurationMs / 1000) * 1000,
    );
    const clipEnd = clipStart + clipDuration;
    if (clipEnd <= start) return [video];
    if (clipStart >= end) {
      return [{
        ...video,
        timing: { ...video.timing, start: (clipStart - removedDuration) / 1000 },
      }];
    }
    const leftDuration = Math.max(0, start - clipStart);
    const rightDuration = Math.max(0, clipEnd - end);
    if (leftDuration > 0 && rightDuration > 0) {
      const left = withTrimmedVideo(video, clipStart, leftDuration, 0);
      const right = withTrimmedVideo(
        { ...video, id: newVideoId("video") },
        start,
        rightDuration,
        end - clipStart,
      );
      return [left, right];
    }
    if (leftDuration > 0) {
      return [withTrimmedVideo(video, clipStart, leftDuration, 0)];
    }
    if (rightDuration > 0) {
      return [withTrimmedVideo(video, start, rightDuration, end - clipStart)];
    }
    return [];
  });
}

export interface RoughCutResult {
  objects: CourseObject[];
  removedMs: number;
}

/**
 * Delete one word range from a clip by its transcript: map the range
 * to scene times and ripple delete it. Returns null when there is
 * nothing to cut (no ready transcript, empty range, or the range lies
 * outside the part of the source the clip shows), so callers can no-op
 * without adding an undo step. The transcript stays on the resulting
 * pieces with its source times unchanged; each piece's source offset
 * advances past the cut, so later deletions on a piece still map
 * correctly through clipSourceWindow.
 */
export function applyTranscriptWordDeletion(
  objects: CourseObject[],
  clipId: string,
  wordStartIndex: number,
  wordEndIndex: number,
  sceneDurationMs: number,
): RoughCutResult | null {
  const target = objects.find((object) => object.id === clipId);
  if (!target) return null;
  const availability = roughCutAvailability(target);
  if (!availability.available) return null;
  const range = wordRangeToSceneRange(
    availability.transcript,
    target,
    wordStartIndex,
    wordEndIndex,
    sceneDurationMs,
  );
  if (!range) return null;
  // Deleting through the transcript's final word deletes to the end of
  // the clip's visible window: the trailing pause after the last word
  // belongs to the deleted passage, not to a surviving tail piece.
  let endMs = range.endMs;
  if (Math.floor(wordEndIndex) >= availability.transcript.words.length) {
    const win = clipSourceWindow(target, sceneDurationMs);
    endMs = Math.min(sceneDurationMs, win.clipStartMs + win.clipDurationMs);
    if (endMs < range.endMs) endMs = range.endMs;
  }
  return {
    objects: rippleDeleteClipRegion(objects, clipId, range.startMs, endMs, sceneDurationMs),
    removedMs: endMs - range.startMs,
  };
}

/** Delete one visible sentence (by its index in sentencesForClip). */
export function applyTranscriptSentenceDeletion(
  objects: CourseObject[],
  clipId: string,
  sentenceIndex: number,
  sceneDurationMs: number,
): RoughCutResult | null {
  const target = objects.find((object) => object.id === clipId);
  if (!target) return null;
  const availability = roughCutAvailability(target);
  if (!availability.available) return null;
  const sentence = sentencesForClip(availability.transcript, target, sceneDurationMs)[sentenceIndex];
  if (!sentence) return null;
  return applyTranscriptWordDeletion(
    objects,
    clipId,
    sentence.wordStartIndex,
    sentence.wordEndIndex,
    sceneDurationMs,
  );
}
