/**
 * Silence tightening (issue #30): detect low energy gaps in a voice clip
 * from its waveform peaks, report how much time tightening would save,
 * and compute the tightened clip layout.
 *
 * Peaks are the normalized amplitudes computed once at ingest (see
 * packages/media computePeaks and the editor's stored waveformPeaks);
 * nothing here decodes audio. The functions are pure and shared, so the
 * editor preview, the client export mix, and the server render all lay
 * the tightened clips out identically: tightening is expressed as kept
 * source segments with timeline placements, never as an editor only flag.
 *
 * Applying a plan shortens every detected gap to keepPauseMs (the pause
 * is shortened, not deleted outright) and removes the excess as ripple
 * cuts. The source media is never rewritten; the kept segments point
 * into it via source offsets, and the edit is reversed through the
 * editor's shared undo stack.
 *
 * Upgrade path: the ASR lane (#43, word level timestamps) will refine
 * which gaps are true pauses versus quiet speech; it can feed its own
 * gap list into the same cut and segment model defined here.
 */

import type { AudioClip } from "./audio.js";

/** One peak bucket: a plain normalized amplitude, or a min/max pair. */
export type PeakValue = number | { min: number; max: number };

export interface SilenceOptions {
  /** Peaks at or below this normalized amplitude (0..1) count as silent. */
  threshold: number;
  /** Gaps shorter than this are left alone, in milliseconds. */
  minSilenceMs: number;
  /** Pause length each tightened gap is shortened to, in milliseconds. */
  keepPauseMs: number;
}

export const DEFAULT_SILENCE_OPTIONS: SilenceOptions = {
  threshold: 0.08,
  minSilenceMs: 400,
  keepPauseMs: 200,
};

export interface SilenceGap {
  /** Clip local start of the silent run, in milliseconds. */
  startMs: number;
  /** Clip local end of the silent run, in milliseconds. */
  endMs: number;
  durationMs: number;
}

/** A source interval removed by tightening, clip local milliseconds. */
export interface SilenceCut {
  startMs: number;
  endMs: number;
  durationMs: number;
}

/** A kept piece of the source, and where it lands after tightening. */
export interface KeptSegment {
  /** Start inside the source clip, clip local milliseconds. */
  sourceStartMs: number;
  durationMs: number;
  /** Start on the tightened timeline, clip local milliseconds. */
  startMs: number;
}

export interface SilenceTighteningPlan {
  options: SilenceOptions;
  gaps: SilenceGap[];
  cuts: SilenceCut[];
  keptSegments: KeptSegment[];
  originalDurationMs: number;
  tightenedDurationMs: number;
  /** Total time saved by applying the plan, in milliseconds. */
  totalRemovedMs: number;
}

/** Clamp user supplied options into the ranges the detector supports. */
export function normalizeSilenceOptions(
  options?: Partial<SilenceOptions>,
): SilenceOptions {
  const threshold = options?.threshold ?? DEFAULT_SILENCE_OPTIONS.threshold;
  const minSilenceMs = options?.minSilenceMs ?? DEFAULT_SILENCE_OPTIONS.minSilenceMs;
  const keepPauseMs = options?.keepPauseMs ?? DEFAULT_SILENCE_OPTIONS.keepPauseMs;
  return {
    threshold: Number.isFinite(threshold)
      ? Math.min(1, Math.max(0, threshold))
      : DEFAULT_SILENCE_OPTIONS.threshold,
    minSilenceMs: Number.isFinite(minSilenceMs)
      ? Math.max(0, Math.round(minSilenceMs))
      : DEFAULT_SILENCE_OPTIONS.minSilenceMs,
    keepPauseMs: Number.isFinite(keepPauseMs)
      ? Math.max(0, Math.round(keepPauseMs))
      : DEFAULT_SILENCE_OPTIONS.keepPauseMs,
  };
}

/** Peak amplitude for one bucket, whichever shape ingest stored. */
export function peakAmplitude(peak: PeakValue): number {
  if (typeof peak === "number") return Number.isFinite(peak) ? Math.abs(peak) : 0;
  if (peak && typeof peak === "object") {
    const max = Number.isFinite(peak.max) ? Math.abs(peak.max) : 0;
    const min = Number.isFinite(peak.min) ? Math.abs(peak.min) : 0;
    return Math.max(max, min);
  }
  return 0;
}

/**
 * Detect silent gaps: maximal runs of buckets at or below the threshold
 * whose total length reaches minSilenceMs. Buckets divide the clip
 * evenly, so bucket i covers [i * bucketMs, (i + 1) * bucketMs).
 */
export function detectSilences(
  peaks: readonly PeakValue[],
  durationMs: number,
  options?: Partial<SilenceOptions>,
): SilenceGap[] {
  const opts = normalizeSilenceOptions(options);
  const duration = Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : 0;
  if (!peaks || peaks.length === 0 || duration <= 0) return [];
  const bucketMs = duration / peaks.length;
  const gaps: SilenceGap[] = [];
  let runStart = -1;
  const flush = (runEndExclusive: number) => {
    if (runStart < 0) return;
    const startMs = Math.round(runStart * bucketMs);
    const endMs = Math.round(runEndExclusive * bucketMs);
    if (endMs - startMs >= opts.minSilenceMs && endMs > startMs) {
      gaps.push({ startMs, endMs, durationMs: endMs - startMs });
    }
    runStart = -1;
  };
  for (let i = 0; i < peaks.length; i++) {
    if (peakAmplitude(peaks[i]) <= opts.threshold) {
      if (runStart < 0) runStart = i;
    } else {
      flush(i);
    }
  }
  flush(peaks.length);
  return gaps;
}

/**
 * Plan a tightening: every gap longer than keepPauseMs keeps its first
 * keepPauseMs and the excess becomes a cut. Gaps at the clip edges follow
 * the same rule, so a tightened clip can still open or close with the
 * configured minimum pause.
 */
export function planSilenceTightening(
  peaks: readonly PeakValue[],
  durationMs: number,
  options?: Partial<SilenceOptions>,
): SilenceTighteningPlan {
  const opts = normalizeSilenceOptions(options);
  const duration = Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : 0;
  const gaps = detectSilences(peaks, duration, opts);
  const cuts: SilenceCut[] = [];
  for (const gap of gaps) {
    if (gap.durationMs > opts.keepPauseMs) {
      const startMs = gap.startMs + opts.keepPauseMs;
      cuts.push({ startMs, endMs: gap.endMs, durationMs: gap.endMs - startMs });
    }
  }
  const keptSegments: KeptSegment[] = [];
  let cursor = 0;
  let tightenedCursor = 0;
  for (const cut of cuts) {
    if (cut.startMs > cursor) {
      const segDuration = cut.startMs - cursor;
      keptSegments.push({
        sourceStartMs: cursor,
        durationMs: segDuration,
        startMs: tightenedCursor,
      });
      tightenedCursor += segDuration;
    }
    cursor = Math.max(cursor, cut.endMs);
  }
  if (cursor < duration) {
    keptSegments.push({
      sourceStartMs: cursor,
      durationMs: duration - cursor,
      startMs: tightenedCursor,
    });
    tightenedCursor += duration - cursor;
  }
  const totalRemovedMs = cuts.reduce((sum, cut) => sum + cut.durationMs, 0);
  return {
    options: opts,
    gaps,
    cuts,
    keptSegments,
    originalDurationMs: duration,
    tightenedDurationMs: duration - totalRemovedMs,
    totalRemovedMs,
  };
}

/** Map a source (pre tightening) timestamp to the tightened timeline. */
export function mapTightenedTime(sourceMs: number, plan: SilenceTighteningPlan): number {
  const t = Math.max(0, sourceMs);
  let removed = 0;
  for (const cut of plan.cuts) {
    if (t <= cut.startMs) break;
    removed += Math.min(t, cut.endMs) - cut.startMs;
  }
  return t - removed;
}

/**
 * Apply a plan to the shared AudioClip model: one clip per kept segment,
 * placed on the tightened timeline and pointing into the same source via
 * sourceInMs. Envelope nodes inside a kept segment move with it; nodes
 * inside a cut are dropped. Only the first segment keeps the fade in and
 * only the last keeps the fade out. Returns the original clip untouched
 * (same reference in a one element array) when there is nothing to cut.
 */
export function tightenAudioClip(
  clip: AudioClip,
  peaks: readonly PeakValue[],
  options?: Partial<SilenceOptions>,
): AudioClip[] {
  const plan = planSilenceTightening(peaks, clip.durationMs, options);
  if (plan.cuts.length === 0 || plan.keptSegments.length === 0) return [clip];
  return plan.keptSegments.map((segment, index) => {
    const envelope = (clip.envelope ?? [])
      .filter(
        (node) =>
          node.atMs >= segment.sourceStartMs &&
          node.atMs < segment.sourceStartMs + segment.durationMs,
      )
      .map((node) => ({ ...node, atMs: node.atMs - segment.sourceStartMs }));
    return {
      ...clip,
      id: index === 0 ? clip.id : `${clip.id}-tight-${index}`,
      startMs: clip.startMs + segment.startMs,
      durationMs: segment.durationMs,
      sourceInMs: clip.sourceInMs + segment.sourceStartMs,
      fadeInMs: index === 0 ? clip.fadeInMs : 0,
      fadeOutMs: index === plan.keptSegments.length - 1 ? clip.fadeOutMs : 0,
      ...(clip.envelope ? { envelope } : {}),
    };
  });
}
