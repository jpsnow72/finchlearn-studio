/**
 * Ingest proxy job contract (issue #7): the service-side pipeline that
 * runs when media is ingested (upload or recording) and produces the
 * three artefacts the editor needs:
 *   1. a lightweight 720p proxy video for smooth editor scrubbing,
 *   2. waveform peaks for audio display and the silence / ASR consumers,
 *   3. a thumbnail strip for timeline and scrubber display.
 *
 * This module is the contract only: job identity, lifecycle, output
 * manifest, storage keys, and source selection. The FFmpeg work itself
 * lives in services/ingest (deployed to the VPS alongside finch-render,
 * which already runs FFmpeg there), following the finch-render job
 * pattern. The editor client is apps/editor/src/ingestClient.ts.
 *
 * Peaks contract (shared with the #43 ASR lane and the #30 silence
 * work): the canonical peaks shape is the one that already exists in
 * this package, the { min, max } pairs returned by computePeaks in
 * media.ts, normalized to 0..1. This module produces and carries that
 * exact shape and never invents a second one. Consumers that hold the
 * editor's number[] amplitude slot (extensions["x-finch-studio"]
 * .waveformPeaks, read by audioEditing.ts) get it through
 * peaksToAmplitudes, a pure derivation from the canonical pairs.
 *
 * Identity: a job is keyed by the content hash of the source bytes.
 * Re-ingesting unchanged media never re-runs: the job id, the derived
 * storage keys, and the dedupe decision all derive from that hash.
 *
 * Source selection rule (hard product rule): preview and scrubbing
 * prefer the proxy once it exists; exports resolve the ORIGINAL only.
 * resolveExportSource throws rather than ever returning a proxy, so an
 * export can never silently use proxy media.
 */

import { computePeaks, planIngest, type MediaAsset } from "./media.js";

// ---------------------------------------------------------------------------
// Peaks: the canonical shape from media.ts, named for ingest consumers.
// ---------------------------------------------------------------------------

/** One waveform bucket: the computePeaks output element, verbatim. */
export type WaveformPeak = ReturnType<typeof computePeaks>[number];

export const PEAKS_VERSION = 1 as const;

/** Default bucket target: roughly one bucket per 100 ms of media. */
export function peaksBucketCount(durationMs?: number): number {
  if (!durationMs || durationMs <= 0) return 100;
  return Math.max(20, Math.min(2000, Math.round(durationMs / 100)));
}

/** Derive the editor's number[] amplitudes from canonical peak pairs. */
export function peaksToAmplitudes(peaks: readonly WaveformPeak[]): number[] {
  return peaks.map((p) => Math.max(Math.abs(p.min), Math.abs(p.max)));
}

export interface WaveformPeaksOutput {
  version: typeof PEAKS_VERSION;
  /** Buckets across the whole source clip. */
  buckets: number;
  /** Milliseconds of source media per bucket, when duration is known. */
  bucketMs?: number;
  peaks: WaveformPeak[];
}

// ---------------------------------------------------------------------------
// Job model
// ---------------------------------------------------------------------------

export type IngestJobStatus = "queued" | "running" | "done" | "failed";

export const INGEST_EXTENSION = "x-finch-studio" as const;
export const MAX_INGEST_ATTEMPTS = 3;

export interface IngestInput {
  /** Library asset id, when the source is already a library asset. */
  assetId?: string;
  /** R2 key of the ORIGINAL source bytes. Originals are always kept. */
  sourceR2Key: string;
  /** SHA-256 (hex) of the source bytes. The job identity key. */
  contentHash: string;
  kind: MediaAsset["kind"];
  width?: number;
  height?: number;
  durationMs?: number;
}

export interface IngestProxyOutput {
  r2Key: string;
  label: "720p";
  width: number;
  height?: number;
  codec: "h264";
  container: "mp4";
}

export interface ThumbnailStripOutput {
  /** One sprite image holding every frame, frames laid out in a row. */
  stripR2Key: string;
  frameWidth: number;
  /** Source timestamp (ms) of each frame, in strip order. */
  frameAtMs: number[];
}

export interface IngestOutputs {
  /** Present for video only. Audio and image jobs carry no proxy video. */
  proxy?: IngestProxyOutput;
  /** Present when the source has audio (video with audio, or audio). */
  peaks?: WaveformPeaksOutput;
  /** Present for video (multi-frame) and image (single frame) sources. */
  thumbnails?: ThumbnailStripOutput;
  /** Probed source facts the worker measured, when they differ from the
   * ingest-time claims or fill gaps in them. */
  probed?: { width?: number; height?: number; durationMs?: number };
}

export interface IngestJob {
  /** Deterministic: derived from the content hash (see ingestJobId). */
  id: string;
  status: IngestJobStatus;
  input: IngestInput;
  /** The ingest plan (from planIngest) this job executes. */
  plan: ReturnType<typeof planIngest>;
  /** Attempts started so far. Incremented on each start and retry. */
  attempts: number;
  createdAt: string;
  updatedAt: string;
  /** Present only when status is "done". */
  outputs?: IngestOutputs;
  /** Human readable failure, present only when status is "failed". */
  error?: string;
}

const HASH_RE = /^[a-f0-9]{32,64}$/;

export function isContentHash(value: string): boolean {
  return HASH_RE.test(value);
}

/** The deterministic job id for a content hash. Same bytes, same job. */
export function ingestJobId(contentHash: string): string {
  return `ingest-${contentHash.slice(0, 32)}`;
}

/**
 * Deterministic derived storage keys, sharded by hash prefix so one
 * source's artefacts sit together and never collide with another's:
 *   derived/<hash[0:2]>/<hash>/proxy-720p.mp4
 *   derived/<hash[0:2]>/<hash>/peaks.json
 *   derived/<hash[0:2]>/<hash>/thumbs-strip.jpg
 */
export function derivedIngestKey(contentHash: string, artefact: "proxy-720p.mp4" | "peaks.json" | "thumbs-strip.jpg"): string {
  return `derived/${contentHash.slice(0, 2)}/${contentHash}/${artefact}`;
}

export function createIngestJob(input: IngestInput, now = new Date().toISOString()): IngestJob {
  if (!input.sourceR2Key) throw new Error("ingest job needs the source R2 key");
  if (!isContentHash(input.contentHash)) throw new Error("ingest job needs a hex content hash (32 to 64 chars)");
  return {
    id: ingestJobId(input.contentHash),
    status: "queued",
    input,
    plan: planIngest(input),
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Lifecycle: queued -> running -> done | failed; failed -> queued (retry)
// ---------------------------------------------------------------------------

export type IngestJobEvent =
  | { type: "start" }
  | { type: "complete"; outputs: IngestOutputs }
  | { type: "fail"; error: string }
  | { type: "retry" };

/** Pure transition. Illegal transitions throw, so a bad lifecycle can
 * never be persisted silently. Returns a new job object. */
export function transitionIngestJob(job: IngestJob, event: IngestJobEvent, now = new Date().toISOString()): IngestJob {
  switch (event.type) {
    case "start": {
      if (job.status !== "queued") throw new Error(`cannot start an ingest job that is ${job.status}`);
      return { ...job, status: "running", attempts: job.attempts + 1, updatedAt: now, error: undefined };
    }
    case "complete": {
      if (job.status !== "running") throw new Error(`cannot complete an ingest job that is ${job.status}`);
      validateIngestOutputs(job, event.outputs);
      return { ...job, status: "done", outputs: event.outputs, updatedAt: now, error: undefined };
    }
    case "fail": {
      if (job.status !== "running") throw new Error(`cannot fail an ingest job that is ${job.status}`);
      return { ...job, status: "failed", error: event.error || "ingest failed", updatedAt: now };
    }
    case "retry": {
      if (job.status !== "failed") throw new Error(`cannot retry an ingest job that is ${job.status}`);
      if (job.attempts >= MAX_INGEST_ATTEMPTS) {
        throw new Error(`ingest job has exhausted its ${MAX_INGEST_ATTEMPTS} attempts`);
      }
      return { ...job, status: "queued", updatedAt: now, error: undefined };
    }
    default:
      throw new Error("unknown ingest job event");
  }
}

/** Whether a failed job may still be retried. */
export function canRetryIngestJob(job: IngestJob): boolean {
  return job.status === "failed" && job.attempts < MAX_INGEST_ATTEMPTS;
}

// ---------------------------------------------------------------------------
// Dedupe: re-ingesting unchanged media never re-runs.
// ---------------------------------------------------------------------------

export type IngestDecision =
  | { action: "reuse"; job: IngestJob }
  | { action: "attach"; job: IngestJob }
  | { action: "retry"; job: IngestJob }
  | { action: "create"; job: IngestJob };

/**
 * Decide what an ingest request does given the job already on record
 * for the same content (looked up by ingestJobId). `existing` is the
 * stored job for this content hash, or null when none exists.
 */
export function planIngestRequest(
  existing: IngestJob | null,
  input: IngestInput,
  now = new Date().toISOString(),
): IngestDecision {
  if (existing && existing.input.contentHash === input.contentHash) {
    if (existing.status === "done") return { action: "reuse", job: existing };
    if (existing.status === "queued" || existing.status === "running") return { action: "attach", job: existing };
    if (existing.status === "failed" && canRetryIngestJob(existing)) {
      return { action: "retry", job: transitionIngestJob(existing, { type: "retry" }, now) };
    }
  }
  return { action: "create", job: createIngestJob(input, now) };
}

// ---------------------------------------------------------------------------
// Output manifest validation (the shape the worker must produce)
// ---------------------------------------------------------------------------

/** Throws with a plain reason when a worker's outputs do not satisfy
 * the plan for this job. Used by the client and the service alike. */
export function validateIngestOutputs(job: IngestJob, outputs: IngestOutputs): void {
  const { kind } = job.input;
  if (kind === "video") {
    if (!outputs.proxy) throw new Error("a video ingest job must produce a proxy");
    if (outputs.proxy.label !== "720p") throw new Error("the proxy must be the 720p rendition");
    if (!outputs.thumbnails || outputs.thumbnails.frameAtMs.length === 0) {
      throw new Error("a video ingest job must produce a thumbnail strip");
    }
    if (outputs.thumbnails.frameAtMs.length !== job.plan.thumbnailStrip.count) {
      throw new Error("the thumbnail strip frame count must match the ingest plan");
    }
  }
  if (kind === "image") {
    if (outputs.proxy) throw new Error("an image ingest job must not produce a proxy video");
    if (!outputs.thumbnails || outputs.thumbnails.frameAtMs.length !== 1) {
      throw new Error("an image ingest job must produce a single thumbnail");
    }
  }
  if (kind === "audio" && outputs.proxy) {
    throw new Error("an audio ingest job must not produce a proxy video");
  }
  if (job.plan.waveform && !outputs.peaks) {
    throw new Error("this ingest job must produce waveform peaks");
  }
  if (outputs.peaks) {
    if (outputs.peaks.version !== PEAKS_VERSION) throw new Error("unsupported peaks version");
    if (outputs.peaks.buckets !== outputs.peaks.peaks.length) {
      throw new Error("peaks bucket count must match the peaks array length");
    }
    for (const p of outputs.peaks.peaks) {
      if (!Number.isFinite(p.min) || !Number.isFinite(p.max) || p.min < -1 || p.max > 1 || p.min > p.max) {
        throw new Error("peaks must be normalized { min, max } pairs within -1..1");
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Source selection: proxy for preview, original for export. Always.
// ---------------------------------------------------------------------------

export interface IngestCarryingAsset {
  /** URL or key of the ORIGINAL media. */
  original: string;
  /** Completed ingest outputs for this asset, when the job is done. */
  ingestOutputs?: IngestOutputs | null;
  /** Resolved playback URL for the proxy artefact, when it exists. The
   * caller resolves the proxy r2Key to a URL through the media worker;
   * this module never builds signed URLs itself. */
  proxyUrl?: string | null;
}

export interface PreviewSource {
  url: string;
  isProxy: boolean;
}

/** Preview and scrubbing: the proxy when the job is done and a proxy
 * URL is available, otherwise the original. */
export function resolvePreviewSource(asset: IngestCarryingAsset): PreviewSource {
  if (asset.ingestOutputs?.proxy && asset.proxyUrl) {
    return { url: asset.proxyUrl, isProxy: true };
  }
  return { url: asset.original, isProxy: false };
}

/**
 * Export: the ORIGINAL, always. Throws when no original is available
 * rather than falling back to the proxy, so exports can never silently
 * render from proxy media.
 */
export function resolveExportSource(asset: IngestCarryingAsset): string {
  if (!asset.original) {
    throw new Error("export needs the original media; the proxy is never used for export");
  }
  return asset.original;
}

// ---------------------------------------------------------------------------
// Stamping outputs onto a library asset (x-finch-studio extension slot)
// ---------------------------------------------------------------------------

export interface IngestExtensionCarrier {
  extensions?: Record<string, Record<string, unknown>>;
}

/** The ingest record stored under extensions["x-finch-studio"].ingest. */
export interface StoredIngestRecord {
  jobId: string;
  status: IngestJobStatus;
  contentHash: string;
  outputs?: IngestOutputs;
  error?: string;
}

export function storedIngestFromJob(job: IngestJob): StoredIngestRecord {
  return {
    jobId: job.id,
    status: job.status,
    contentHash: job.input.contentHash,
    ...(job.outputs ? { outputs: job.outputs } : {}),
    ...(job.error ? { error: job.error } : {}),
  };
}

/** Read a stored ingest record back off an asset or editor object. */
export function getStoredIngest(carrier: IngestExtensionCarrier): StoredIngestRecord | null {
  const raw = carrier.extensions?.[INGEST_EXTENSION]?.ingest;
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Partial<StoredIngestRecord>;
  if (typeof rec.jobId !== "string" || typeof rec.contentHash !== "string") return null;
  if (rec.status !== "queued" && rec.status !== "running" && rec.status !== "done" && rec.status !== "failed") return null;
  return rec as StoredIngestRecord;
}

/**
 * Return a copy of the asset with the job record stamped into the
 * established extension slot, preserving any sibling metadata already
 * there (a transcript from #43, peaks, edit metadata). When the job is
 * done with peaks, the editor amplitude slot (waveformPeaks, number[])
 * is refreshed from the canonical pairs so Timeline and audioEditing
 * consumers read current peaks without knowing about ingest.
 */
export function withIngestRecord<T extends IngestExtensionCarrier>(asset: T, job: IngestJob): T {
  const ext: Record<string, unknown> = { ...(asset.extensions?.[INGEST_EXTENSION] ?? {}) };
  ext.ingest = storedIngestFromJob(job);
  if (job.status === "done" && job.outputs?.peaks) {
    ext.waveformPeaks = peaksToAmplitudes(job.outputs.peaks.peaks);
  }
  return {
    ...asset,
    extensions: { ...(asset.extensions ?? {}), [INGEST_EXTENSION]: ext },
  };
}
