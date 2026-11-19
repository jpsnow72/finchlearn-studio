/**
 * ASR pipeline core (issue #43): automatic speech recognition with word
 * level timestamps for voice clips and speech footage at ingest.
 *
 * This module is the data contract the rest of Phase 2 builds on:
 * - #44 (caption editor) renders caption cues from a ClipTranscript.
 * - #45 (text based rough cut) edits by selecting word ranges from a
 *   ClipTranscript; it finds a clip's transcript with
 *   `findTranscriptForClip` / `getAssetTranscript` and never re-runs ASR.
 *
 * Design notes:
 * - Browser side decode is not the place for ASR. This package only
 *   plans jobs, carries the transcript data, and defines the engine
 *   port. The actual recognition runs in the finch-asr service
 *   (services/asr in this repo, deployed to the VPS alongside
 *   finch-render, which already runs FFmpeg there).
 * - A transcript is clip scoped and stored with the asset metadata in
 *   the established extension style: under
 *   extensions["x-finch-studio"].transcript on the asset or editor
 *   object that carries the clip. It is plain JSON, so it round trips
 *   through project save and load unchanged.
 * - Re-runs are keyed by content hash: a clip whose bytes have not
 *   changed never re-runs (see planTranscription).
 */

export const TRANSCRIPT_VERSION = 1 as const;
export const TRANSCRIPT_EXTENSION = "x-finch-studio" as const;

/** Lifecycle of one clip's transcript. */
export type TranscriptStatus =
  | "none"
  | "queued"
  | "transcribing"
  | "ready"
  | "failed";

/** One recognized word. Times are milliseconds into the SOURCE clip
 * (before any timeline trim), so consumers offset by the clip's
 * sourceInMs when they map words onto a scene timeline. */
export interface TranscriptWord {
  word: string;
  startMs: number;
  endMs: number;
  /** Engine confidence for this word, 0..1, only when the engine
   * provides one. Never fabricated: absent means not reported. */
  confidence?: number;
}

/** A group of consecutive words, usually one utterance or sentence. */
export interface TranscriptSegment {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
  /** Speaker label when the engine diarizes; absent otherwise. */
  speaker?: string;
  /** Mean confidence for the segment when the engine provides one. */
  confidence?: number;
  wordStartIndex: number;
  wordEndIndex: number;
}

/**
 * The canonical transcript for one clip. This exact shape is mirrored
 * in @finch-studio/schema (packages/schema/src/schema.ts, ClipTranscript
 * there) so a transcript can be stored on a StudioProject AssetRef
 * without either package depending on the other; the two declarations
 * are structurally identical and assignment compatible.
 */
export interface ClipTranscript {
  version: typeof TRANSCRIPT_VERSION;
  status: TranscriptStatus;
  /** Id of the clip this transcript belongs to: the MediaAsset id in
   * the library, or the editor object id / asset r2Key in a project.
   * Consumers match on clipId first, then contentHash, then r2Key. */
  clipId: string;
  /** R2 key of the source asset, when the clip is library backed. */
  r2Key?: string;
  /** Content hash of the exact bytes that were transcribed. This is
   * the re-run key: a ready transcript with this hash is current. */
  contentHash: string;
  /** Engine id that produced the words, for example "whisper-api". */
  engine: string;
  /** BCP-47 language the engine detected or was asked for. */
  language?: string;
  /** Duration of the source audio the words index into. */
  durationMs?: number;
  words: TranscriptWord[];
  segments: TranscriptSegment[];
  /** Full plain text, words joined in order. Derived, but stored so
   * text consumers (search, #45) never have to rebuild it. */
  text: string;
  /** ISO timestamps for the last status change / completion. */
  updatedAt: string;
  createdAt?: string;
  /** Human readable failure, present only when status is "failed". */
  error?: string;
  /** Number of recognition attempts for this content hash. */
  attempts?: number;
}

// ---------------------------------------------------------------------------
// Storage: the x-finch-studio extension slot
// ---------------------------------------------------------------------------

/** Anything that carries extension metadata in the established style:
 * MediaAsset, a Studio AssetRef, or an editor CourseObject. */
export interface ExtensionCarrier {
  extensions?: Record<string, Record<string, unknown>>;
}

/** Alias used by consumers that hold library assets rather than carriers. */
export type MediaAssetLike = ExtensionCarrier;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWord(value: unknown): value is TranscriptWord {
  return (
    isRecord(value) &&
    typeof value.word === "string" &&
    typeof value.startMs === "number" &&
    Number.isFinite(value.startMs) &&
    typeof value.endMs === "number" &&
    Number.isFinite(value.endMs)
  );
}

function isSegment(value: unknown): value is TranscriptSegment {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.startMs === "number" &&
    typeof value.endMs === "number" &&
    typeof value.text === "string" &&
    typeof value.wordStartIndex === "number" &&
    typeof value.wordEndIndex === "number"
  );
}

const STATUSES: readonly string[] = ["none", "queued", "transcribing", "ready", "failed"];

/** Read and validate a transcript out of raw extension metadata.
 * Returns null when there is no usable transcript stored. */
export function parseTranscript(raw: unknown): ClipTranscript | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.clipId !== "string" || typeof raw.contentHash !== "string") return null;
  if (typeof raw.status !== "string" || !STATUSES.includes(raw.status)) return null;
  const words = Array.isArray(raw.words) ? raw.words.filter(isWord) : [];
  const segments = Array.isArray(raw.segments) ? raw.segments.filter(isSegment) : [];
  return {
    version: TRANSCRIPT_VERSION,
    status: raw.status as TranscriptStatus,
    clipId: raw.clipId,
    r2Key: typeof raw.r2Key === "string" ? raw.r2Key : undefined,
    contentHash: raw.contentHash,
    engine: typeof raw.engine === "string" ? raw.engine : "unknown",
    language: typeof raw.language === "string" ? raw.language : undefined,
    durationMs:
      typeof raw.durationMs === "number" && Number.isFinite(raw.durationMs)
        ? raw.durationMs
        : undefined,
    words,
    segments,
    text: typeof raw.text === "string" ? raw.text : words.map((w) => w.word).join(" "),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "",
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : undefined,
    error: typeof raw.error === "string" ? raw.error : undefined,
    attempts: typeof raw.attempts === "number" ? raw.attempts : undefined,
  };
}

/** The transcript stored on a carrier, or null. */
export function getAssetTranscript(carrier: ExtensionCarrier): ClipTranscript | null {
  return parseTranscript(carrier.extensions?.[TRANSCRIPT_EXTENSION]?.transcript);
}

/** Return a copy of the carrier with the transcript stored under
 * extensions["x-finch-studio"].transcript, other metadata preserved. */
export function withAssetTranscript<T extends ExtensionCarrier>(
  carrier: T,
  transcript: ClipTranscript | null,
): T {
  const meta: Record<string, unknown> = { ...(carrier.extensions?.[TRANSCRIPT_EXTENSION] ?? {}) };
  if (transcript === null) delete meta.transcript;
  else meta.transcript = transcript;
  return {
    ...carrier,
    extensions: { ...(carrier.extensions ?? {}), [TRANSCRIPT_EXTENSION]: meta },
  };
}

/** Find the transcript for a clip among a set of carriers (assets or
 * project elements). Matches clipId first, then r2Key. This is the
 * lookup #44 and #45 use: pass every asset / element that could carry
 * the clip, get its transcript or null. */
export function findTranscriptForClip(
  carriers: readonly ExtensionCarrier[],
  clip: { clipId?: string; r2Key?: string },
): ClipTranscript | null {
  let byKey: ClipTranscript | null = null;
  for (const carrier of carriers) {
    const t = getAssetTranscript(carrier);
    if (!t) continue;
    if (clip.clipId && t.clipId === clip.clipId) return t;
    if (clip.r2Key && t.r2Key === clip.r2Key) byKey = byKey ?? t;
  }
  return byKey;
}

// ---------------------------------------------------------------------------
// Ingest planning: queue once per content hash
// ---------------------------------------------------------------------------

export interface AsrJobRequest {
  clipId: string;
  r2Key?: string;
  contentHash: string;
  kind: "audio" | "video";
  /** Preferred language (BCP-47); the engine may still detect. */
  language?: string;
  /** Why this job exists: first ingest, content changed, or retry. */
  reason: "new" | "changed" | "retry";
}

export type AsrPlan =
  | { action: "queue"; job: AsrJobRequest }
  | {
      action: "skip";
      reason: "not-speech" | "missing-content-hash" | "unchanged" | "in-flight";
    };

export interface SpeechClipHint {
  id: string;
  kind: "audio" | "video" | "image";
  r2Key?: string;
  /** Content hash of the clip bytes (AssetRef.sha256 / ingest hash). */
  contentHash?: string;
  /** Audio role for audio clips: only voice carries speech by default. */
  role?: "voice" | "music" | "sfx" | "description";
  /** Explicit override when the caller knows better than the defaults:
   * true forces transcription, false suppresses it. */
  hasSpeech?: boolean;
}

/** Does this clip carry speech worth transcribing? Audio defaults to
 * yes unless its role is music or sfx; footage (video) defaults to yes
 * because speech footage is a named #43 input; images never do. */
export function isSpeechClip(clip: SpeechClipHint): boolean {
  if (clip.hasSpeech !== undefined) return clip.hasSpeech;
  if (clip.kind === "image") return false;
  if (clip.kind === "audio") return clip.role !== "music" && clip.role !== "sfx";
  return true;
}

/**
 * The ingest hook decision. Call this when a voice clip or speech
 * footage lands (upload, recording, voiceover take) with the clip's
 * content hash and whatever transcript is already stored for it.
 * Unchanged clips (same hash, transcript ready) never re-run; a clip
 * that is already queued or transcribing is not double queued; a
 * failed transcript may be re-queued (that is the retry path).
 */
export function planTranscription(
  clip: SpeechClipHint,
  existing: ClipTranscript | null,
): AsrPlan {
  if (!isSpeechClip(clip) || clip.kind === "image") return { action: "skip", reason: "not-speech" };
  const kind: "audio" | "video" = clip.kind;
  if (!clip.contentHash) return { action: "skip", reason: "missing-content-hash" };
  if (existing && existing.contentHash === clip.contentHash) {
    if (existing.status === "ready") return { action: "skip", reason: "unchanged" };
    if (existing.status === "queued" || existing.status === "transcribing") {
      return { action: "skip", reason: "in-flight" };
    }
    if (existing.status === "failed") {
      return {
        action: "queue",
        job: { clipId: clip.id, r2Key: clip.r2Key, contentHash: clip.contentHash, kind, reason: "retry" },
      };
    }
  }
  return {
    action: "queue",
    job: {
      clipId: clip.id,
      r2Key: clip.r2Key,
      contentHash: clip.contentHash,
      kind,
      reason: existing ? "changed" : "new",
    },
  };
}

/** A fresh queued transcript record to store at job plan time, so the
 * editor can surface "queued / transcribing" before words exist. */
export function makeQueuedTranscript(job: AsrJobRequest, engine: string, now: string): ClipTranscript {
  return {
    version: TRANSCRIPT_VERSION,
    status: "queued",
    clipId: job.clipId,
    r2Key: job.r2Key,
    contentHash: job.contentHash,
    engine,
    words: [],
    segments: [],
    text: "",
    createdAt: now,
    updatedAt: now,
    attempts: job.reason === "retry" ? 2 : 1,
  };
}

/** Pure status transition. Illegal transitions return the input
 * unchanged (for example a ready transcript cannot go back to queued;
 * a changed clip gets a NEW record via makeQueuedTranscript instead). */
export function transitionTranscript(
  transcript: ClipTranscript,
  next: TranscriptStatus,
  patch: Partial<ClipTranscript> = {},
  now: string,
): ClipTranscript {
  const allowed: Record<TranscriptStatus, TranscriptStatus[]> = {
    none: ["queued"],
    queued: ["transcribing", "failed"],
    transcribing: ["ready", "failed"],
    ready: [],
    failed: ["queued"],
  };
  if (!allowed[transcript.status].includes(next)) return transcript;
  return {
    ...transcript,
    ...patch,
    status: next,
    error: next === "failed" ? (patch.error ?? transcript.error) : undefined,
    updatedAt: now,
  };
}

// ---------------------------------------------------------------------------
// Derived views for downstream consumers (#44 captions, #45 rough cut)
// ---------------------------------------------------------------------------

export function transcriptPlainText(transcript: ClipTranscript): string {
  return transcript.text || transcript.words.map((w) => w.word).join(" ");
}

export interface CaptionCue {
  startMs: number;
  endMs: number;
  text: string;
  wordStartIndex: number;
  wordEndIndex: number;
}

/** Group words into caption cues of at most maxWords words, breaking
 * early on sentence ending punctuation. Times are source clip times. */
export function captionCuesFromTranscript(
  transcript: ClipTranscript,
  maxWords = 8,
): CaptionCue[] {
  const cues: CaptionCue[] = [];
  const words = transcript.words;
  let start = 0;
  for (let i = 0; i < words.length; i++) {
    const count = i - start + 1;
    const sentenceEnd = /[.!?]$/.test(words[i].word);
    if (count >= maxWords || sentenceEnd || i === words.length - 1) {
      cues.push({
        startMs: words[start].startMs,
        endMs: words[i].endMs,
        text: words.slice(start, i + 1).map((w) => w.word).join(" "),
        wordStartIndex: start,
        wordEndIndex: i + 1,
      });
      start = i + 1;
    }
  }
  return cues;
}

export interface SilenceRange {
  startMs: number;
  endMs: number;
  durationMs: number;
}

/** Gaps between words at least minMs long, plus leading and trailing
 * silence when the clip duration is known. The raw material for the
 * silence detection #45 builds on; no ranges are removed here. */
export function silencesFromTranscript(
  transcript: ClipTranscript,
  minMs = 700,
): SilenceRange[] {
  const out: SilenceRange[] = [];
  const words = transcript.words;
  const push = (startMs: number, endMs: number) => {
    if (endMs - startMs >= minMs) out.push({ startMs, endMs, durationMs: endMs - startMs });
  };
  if (words.length === 0) return out;
  push(0, words[0].startMs);
  for (let i = 1; i < words.length; i++) push(words[i - 1].endMs, words[i].startMs);
  if (transcript.durationMs !== undefined) push(words[words.length - 1].endMs, transcript.durationMs);
  return out;
}

const FILLER_WORDS = new Set(["um", "uh", "erm", "uhm", "hmm", "mm"]);

/** Indices of filler words (um, uh, and friends). Exact word matches
 * only, punctuation stripped; "like" and "you know" are deliberately
 * NOT fillers here because they also carry real meaning. */
export function fillerWordIndices(transcript: ClipTranscript): number[] {
  const out: number[] = [];
  transcript.words.forEach((w, i) => {
    const clean = w.word.toLowerCase().replace(/[^a-z']/g, "");
    if (FILLER_WORDS.has(clean)) out.push(i);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Recognition port and the Whisper style binding
// ---------------------------------------------------------------------------

export interface TranscriptionRequest {
  /** Audio (or footage) bytes to transcribe. The service extracts the
   * audio track from footage with FFmpeg before calling the engine. */
  audio: Blob | ArrayBuffer | Uint8Array;
  /** File name hint the engine uses to pick a decoder. */
  fileName: string;
  language?: string;
  contentHash: string;
  clipId: string;
}

export interface TranscriptionResult {
  language?: string;
  durationMs?: number;
  words: TranscriptWord[];
  segments: TranscriptSegment[];
  text: string;
}

/** The clean port every engine binding implements. Swap engines by
 * constructing a different binding; callers never change. */
export interface TranscriptionEngine {
  readonly id: string;
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>;
}

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: unknown },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

/** Raw verbose_json shape returned by OpenAI Whisper style endpoints
 * (POST /v1/audio/transcriptions with response_format=verbose_json and
 * timestamp_granularities[]=word and []=segment). Times are SECONDS. */
export interface WhisperVerboseJson {
  language?: string;
  duration?: number;
  text?: string;
  words?: { word: string; start: number; end: number; probability?: number; confidence?: number }[];
  segments?: {
    id?: number;
    start: number;
    end: number;
    text: string;
    avg_logprob?: number;
    speaker?: string;
  }[];
}

const sToMs = (s: number) => Math.round(s * 1000);

/** Map a Whisper verbose_json response onto the transcript contract.
 * Pure and exported so it is testable without any network. Per word
 * confidence is carried only when the endpoint reports one (the
 * OpenAI endpoint does not; some compatible endpoints send
 * `probability`). Segment confidence maps avg_logprob through
 * exp(), the standard logprob to probability conversion, and is
 * omitted when the segment carries no avg_logprob. */
export function mapWhisperResponse(raw: WhisperVerboseJson): TranscriptionResult {
  const words: TranscriptWord[] = (raw.words ?? []).map((w) => ({
    word: w.word,
    startMs: sToMs(w.start),
    endMs: sToMs(w.end),
    confidence: w.confidence ?? w.probability,
  }));
  const segments: TranscriptSegment[] = (raw.segments ?? []).map((seg, i) => {
    const startMs = sToMs(seg.start);
    const endMs = sToMs(seg.end);
    let wordStartIndex = words.findIndex((w) => w.startMs >= startMs);
    if (wordStartIndex < 0) wordStartIndex = words.length;
    let wordEndIndex = words.length;
    for (let j = wordStartIndex; j < words.length; j++) {
      if (words[j].endMs > endMs) {
        wordEndIndex = j;
        break;
      }
      wordEndIndex = j + 1;
    }
    return {
      id: `seg-${seg.id ?? i}`,
      startMs,
      endMs,
      text: seg.text.trim(),
      speaker: seg.speaker,
      confidence:
        typeof seg.avg_logprob === "number"
          ? Math.min(1, Math.max(0, Math.exp(seg.avg_logprob)))
          : undefined,
      wordStartIndex,
      wordEndIndex,
    };
  });
  if (segments.length === 0 && words.length > 0) {
    segments.push({
      id: "seg-0",
      startMs: words[0].startMs,
      endMs: words[words.length - 1].endMs,
      text: (raw.text ?? words.map((w) => w.word).join(" ")).trim(),
      wordStartIndex: 0,
      wordEndIndex: words.length,
    });
  }
  return {
    language: raw.language,
    durationMs: typeof raw.duration === "number" ? sToMs(raw.duration) : undefined,
    words,
    segments,
    text: (raw.text ?? words.map((w) => w.word).join(" ")).trim(),
  };
}

export interface WhisperEngineOptions {
  /** Endpoint base, for example https://api.openai.com/v1 or a
   * self hosted compatible endpoint. No credentials in this value. */
  baseUrl: string;
  /** API key VALUE, read from the environment by the caller (the
   * service reads the secret named OPENAI_API_KEY). Never hardcode. */
  apiKey: string;
  /** Model name, defaults to whisper-1. */
  model?: string;
  fetchFn?: FetchLike;
}

/**
 * First engine binding: an OpenAI Whisper style transcription
 * endpoint. Chosen first because its verbose_json word timestamps are
 * the documented, widely implemented shape (OpenAI, plus compatible
 * self hosted servers), so the binding also covers a future local
 * engine with no contract change.
 */
export class WhisperTranscriptionEngine implements TranscriptionEngine {
  readonly id = "whisper-api";
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchFn: FetchLike;

  constructor(options: WhisperEngineOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.model = options.model ?? "whisper-1";
    this.fetchFn =
      options.fetchFn ??
      ((url, init) =>
        fetch(url, init as RequestInit) as Promise<{
          ok: boolean;
          status: number;
          json(): Promise<unknown>;
          text(): Promise<string>;
        }>);
  }

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
    const form = new FormData();
    const blob =
      request.audio instanceof Blob
        ? request.audio
        : new Blob([request.audio as BlobPart], { type: "application/octet-stream" });
    form.append("file", blob, request.fileName);
    form.append("model", this.model);
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");
    form.append("timestamp_granularities[]", "segment");
    if (request.language) form.append("language", request.language);
    const res = await this.fetchFn(`${this.baseUrl}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Transcription engine returned ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`);
    }
    return mapWhisperResponse((await res.json()) as WhisperVerboseJson);
  }
}

/** Build a ready ClipTranscript from an engine result. */
export function transcriptFromResult(
  job: AsrJobRequest,
  engineId: string,
  result: TranscriptionResult,
  now: string,
): ClipTranscript {
  return {
    version: TRANSCRIPT_VERSION,
    status: "ready",
    clipId: job.clipId,
    r2Key: job.r2Key,
    contentHash: job.contentHash,
    engine: engineId,
    language: result.language,
    durationMs: result.durationMs,
    words: result.words,
    segments: result.segments,
    text: result.text,
    createdAt: now,
    updatedAt: now,
    attempts: 1,
  };
}
