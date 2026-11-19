/**
 * Multicam audio sync (issue #47): align two recordings of the same
 * moment by cross-correlating their audio energy series.
 *
 * The inputs are the peak / energy data the ingest pipeline already
 * computes (see computePeaks in media.ts): one energy value per time
 * bucket. Nothing here decodes audio, so the wizard can run this on
 * the editor's main thread over data it already holds.
 *
 * Sign convention: the result's offsetMs is the candidate recording's
 * delay relative to the reference. A candidate event that happens
 * D ms later in the candidate's own timeline than in the reference
 * gives offsetMs = D, and the candidate source time that matches
 * reference (scene) time t is t + offsetMs.
 *
 * Honesty rule: silence, constant energy, too little overlap, or a
 * best match that is barely better than the runner up all report low
 * confidence (quality "low" or "unknown") instead of a confident
 * number the data does not support. Callers must surface the quality
 * and offer a manual nudge when it is not "high".
 */

export type SyncQuality = "high" | "medium" | "low" | "unknown";

export interface AudioAlignmentResult {
  /** Candidate delay relative to the reference, in ms (see header). */
  offsetMs: number;
  /** The winning lag in energy buckets (offsetMs = lag * bucketMs). */
  lagBuckets: number;
  /** Pearson correlation at the winning lag, -1..1. */
  correlation: number;
  /** 0..1, combining correlation strength and match uniqueness. */
  confidence: number;
  quality: SyncQuality;
  /** Buckets compared at the winning lag. */
  overlapBuckets: number;
}

export interface AudioAlignmentOptions {
  /** Duration of one energy bucket in ms. Default 100. */
  bucketMs?: number;
  /** Widest delay to search, in ms. Default: the whole overlap. */
  maxOffsetMs?: number;
  /** Minimum buckets of overlap for a lag to be considered. Default 8. */
  minOverlapBuckets?: number;
}

type PeakLike = number | { min: number; max: number };

/**
 * Reduce ingest peaks to a non-negative energy series: plain numbers
 * pass through as magnitudes, {min, max} peak pairs use the larger
 * magnitude of the pair (the same shape computePeaks returns).
 */
export function peaksToEnergy(peaks: readonly PeakLike[]): number[] {
  return peaks.map((p) => {
    if (typeof p === "number") return Math.abs(p);
    return Math.max(Math.abs(p.min), Math.abs(p.max));
  });
}

function pearson(a: readonly number[], aFrom: number, b: readonly number[], bFrom: number, n: number): number {
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) {
    ma += a[aFrom + i];
    mb += b[bFrom + i];
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const xa = a[aFrom + i] - ma;
    const xb = b[bFrom + i] - mb;
    num += xa * xb;
    da += xa * xa;
    db += xb * xb;
  }
  if (da <= 0 || db <= 0) return 0;
  return num / Math.sqrt(da * db);
}

function hasVariance(series: readonly number[]): boolean {
  if (series.length === 0) return false;
  const mean = series.reduce((s, v) => s + v, 0) / series.length;
  return series.some((v) => Math.abs(v - mean) > 1e-9);
}

function qualityFor(correlation: number, confidence: number): SyncQuality {
  if (confidence >= 0.75 && correlation >= 0.8) return "high";
  if (confidence >= 0.45) return "medium";
  if (confidence > 0) return "low";
  return "unknown";
}

const UNKNOWN: AudioAlignmentResult = {
  offsetMs: 0,
  lagBuckets: 0,
  correlation: 0,
  confidence: 0,
  quality: "unknown",
  overlapBuckets: 0,
};

/**
 * Align a candidate energy series against a reference by searching
 * every lag in range and scoring each with Pearson correlation over
 * the overlapping buckets. Pure and deterministic.
 */
export function alignAudioEnergy(
  reference: readonly number[],
  candidate: readonly number[],
  opts: AudioAlignmentOptions = {},
): AudioAlignmentResult {
  const bucketMs = opts.bucketMs && opts.bucketMs > 0 ? opts.bucketMs : 100;
  const minOverlap = Math.max(2, opts.minOverlapBuckets ?? 8);
  if (
    reference.length < minOverlap ||
    candidate.length < minOverlap ||
    !hasVariance(reference) ||
    !hasVariance(candidate)
  ) {
    return { ...UNKNOWN };
  }
  const maxLagByLength = Math.min(reference.length, candidate.length) - minOverlap;
  const maxLagByOpts =
    opts.maxOffsetMs !== undefined
      ? Math.floor(Math.abs(opts.maxOffsetMs) / bucketMs)
      : maxLagByLength;
  const maxLag = Math.max(0, Math.min(maxLagByLength, maxLagByOpts));

  // Score every lag. Lag L compares reference[i] with candidate[i + L]:
  // a candidate delayed by D buckets wins at L = D.
  const scored: { lag: number; correlation: number; overlap: number }[] = [];
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const refFrom = lag < 0 ? -lag : 0;
    const candFrom = lag < 0 ? 0 : lag;
    const overlap = Math.min(reference.length - refFrom, candidate.length - candFrom);
    if (overlap < minOverlap) continue;
    scored.push({
      lag,
      correlation: pearson(reference, refFrom, candidate, candFrom, overlap),
      overlap,
    });
  }
  if (scored.length === 0) return { ...UNKNOWN };
  scored.sort((x, y) => y.correlation - x.correlation);
  const best = scored[0];
  // Runner up away from the winner's neighbourhood: nearby lags of a
  // real match correlate almost as well and say nothing about
  // uniqueness, so they are excluded from the margin.
  const runnerUp = scored.find((s) => Math.abs(s.lag - best.lag) > 2);
  const bestClamped = Math.max(0, best.correlation);
  const margin = runnerUp ? best.correlation - Math.max(0, runnerUp.correlation) : bestClamped;
  const uniqueness = bestClamped > 0 ? Math.min(1, Math.max(0, margin / bestClamped)) : 0;
  const confidence = Math.min(1, Math.max(0, 0.65 * bestClamped + 0.35 * uniqueness));
  return {
    offsetMs: Math.round(best.lag * bucketMs),
    lagBuckets: best.lag,
    correlation: best.correlation,
    confidence,
    quality: qualityFor(best.correlation, confidence),
    overlapBuckets: best.overlap,
  };
}

/** Align ingest peaks directly (either peak shape computePeaks emits). */
export function alignAudioPeaks(
  referencePeaks: readonly PeakLike[],
  candidatePeaks: readonly PeakLike[],
  opts: AudioAlignmentOptions = {},
): AudioAlignmentResult {
  return alignAudioEnergy(peaksToEnergy(referencePeaks), peaksToEnergy(candidatePeaks), opts);
}

/** Align several candidates against one reference, in input order. */
export function alignManyAudioEnergy(
  reference: readonly number[],
  candidates: readonly (readonly number[])[],
  opts: AudioAlignmentOptions = {},
): AudioAlignmentResult[] {
  return candidates.map((c) => alignAudioEnergy(reference, c, opts));
}
