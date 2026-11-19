/**
 * transcription.ts — editor bridge for the ASR pipeline (issue #43).
 *
 * Transcripts live on the clip object itself, under the established
 * extensions["x-finch-studio"].transcript slot, exactly like audio
 * clip metadata (audioEditing.ts). The canonical model, ingest
 * planning, and engine adapter live in @finch-studio/media
 * (transcript.ts); this module is the editor's typed read/write seam
 * over CourseObjects plus the client for the finch-asr service
 * (services/asr), which does the actual recognition server side.
 *
 * Secret handling: the service key is read from the Vite env names
 * VITE_ASR_URL / VITE_ASR_KEY at build time. No values live in code.
 */
import type { CourseObject, Extensions } from "@finch-studio/core";
import type { ClipTranscript, TranscriptStatus } from "@finch-studio/media";

export type { ClipTranscript, TranscriptStatus };

const ASR_EXTENSION = "x-finch-studio";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The transcript stored on a clip object, or null. */
export function getObjectTranscript(object: CourseObject): ClipTranscript | null {
  const raw = object.extensions?.[ASR_EXTENSION]?.transcript;
  if (!isRecord(raw)) return null;
  if (typeof raw.clipId !== "string" || typeof raw.contentHash !== "string") return null;
  if (!Array.isArray(raw.words)) return null;
  return raw as unknown as ClipTranscript;
}

/** Return a copy of the object with its transcript stored (or cleared
 * with null), preserving all other x-finch-studio metadata. */
export function withObjectTranscript(
  object: CourseObject,
  transcript: ClipTranscript | null,
): CourseObject {
  const extensions: Extensions = { ...(object.extensions ?? {}) };
  const meta: Record<string, unknown> = { ...(extensions[ASR_EXTENSION] ?? {}) };
  if (transcript === null) delete meta.transcript;
  else meta.transcript = transcript;
  extensions[ASR_EXTENSION] = meta;
  return { ...object, extensions } as CourseObject;
}

/** Status when a clip carries no transcript record at all. */
export function objectTranscriptStatus(object: CourseObject): TranscriptStatus {
  return getObjectTranscript(object)?.status ?? "none";
}

const STATUS_LABELS: Record<TranscriptStatus, string> = {
  none: "Not transcribed yet",
  queued: "Transcription queued",
  transcribing: "Transcribing",
  ready: "Transcript ready",
  failed: "Transcription failed",
};

/** Short status line for panels. Plain copy, no em dashes. */
export function transcriptStatusLabel(status: TranscriptStatus): string {
  return STATUS_LABELS[status];
}

/** Clips that carry speech: audio objects, and video objects (speech
 * footage). Mirrors isSpeechClip in @finch-studio/media. */
export function isTranscribableObject(object: CourseObject): boolean {
  return object.type === "audio" || object.type === "video";
}

/**
 * The editor side ingest decision for one object, mirroring
 * planTranscription in @finch-studio/media: unchanged clips (same
 * content hash, transcript ready) never re-run; in-flight clips are
 * not double queued; failed clips may be re-queued (the retry path).
 * Returns the transcript record to store when a job should be queued,
 * or null when nothing should happen.
 */
export function planObjectTranscription(
  object: CourseObject,
  contentHash: string,
  now: string,
): ClipTranscript | null {
  if (!isTranscribableObject(object) || !contentHash) return null;
  const existing = getObjectTranscript(object);
  if (existing && existing.contentHash === contentHash) {
    if (existing.status !== "failed") return null;
    return {
      ...existing,
      status: "queued",
      error: undefined,
      words: [],
      segments: [],
      text: "",
      attempts: (existing.attempts ?? 1) + 1,
      updatedAt: now,
    };
  }
  return {
    version: 1,
    status: "queued",
    clipId: object.id,
    contentHash,
    engine: existing?.engine ?? "whisper-api",
    words: [],
    segments: [],
    text: "",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    attempts: existing ? (existing.attempts ?? 1) + 1 : 1,
  };
}

/** Retry a failed transcription: the stored record goes back to
 * queued for the same content hash. Returns null when the clip is
 * not in a failed state (retry is only offered then). */
export function retryObjectTranscription(
  object: CourseObject,
  now: string,
): ClipTranscript | null {
  const existing = getObjectTranscript(object);
  if (!existing || existing.status !== "failed") return null;
  return planObjectTranscription(object, existing.contentHash, now);
}

// ---------------------------------------------------------------------------
// finch-asr service client
// ---------------------------------------------------------------------------

export interface AsrServiceConfig {
  /** Base URL of the finch-asr service (env name VITE_ASR_URL). */
  baseUrl: string;
  /** Shared service key (env name VITE_ASR_KEY). Value comes from the
   * build environment only, never from code. */
  key: string;
  fetchFn?: typeof fetch;
}

export interface AsrJobState {
  jobId: string;
  state: "queued" | "transcribing" | "done" | "error";
  error: string | null;
  transcript: ClipTranscript | null;
}

/** Read the service config from the Vite build env. Returns null when
 * ASR is not configured in this build (panels then show stored status
 * only, and transcription is planned by the media ingest worker). */
export function asrConfigFromEnv(): AsrServiceConfig | null {
  const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {};
  const baseUrl = env.VITE_ASR_URL;
  const key = env.VITE_ASR_KEY;
  if (!baseUrl || !key) return null;
  return { baseUrl: baseUrl.replace(/\/$/, ""), key };
}

/** Queue one clip with the ASR service. The service fetches the clip
 * bytes itself (by r2Key or source URL), extracts audio with FFmpeg
 * for footage, and runs the engine; the editor only polls status. */
export async function requestTranscription(
  config: AsrServiceConfig,
  input: { clipId: string; contentHash: string; r2Key?: string; sourceUrl?: string; language?: string },
): Promise<{ jobId: string }> {
  const fetchFn = config.fetchFn ?? fetch;
  const res = await fetchFn(`${config.baseUrl}/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-asr-key": config.key },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`ASR service returned ${res.status}`);
  return (await res.json()) as { jobId: string };
}

/** Poll a queued job. When state is "done", transcript carries the
 * ready ClipTranscript to store on the object. */
export async function pollTranscription(
  config: AsrServiceConfig,
  jobId: string,
): Promise<AsrJobState> {
  const fetchFn = config.fetchFn ?? fetch;
  const res = await fetchFn(`${config.baseUrl}/jobs/${encodeURIComponent(jobId)}`, {
    headers: { "x-asr-key": config.key },
  });
  if (!res.ok) throw new Error(`ASR service returned ${res.status}`);
  return (await res.json()) as AsrJobState;
}
