/**
 * Per-scene voiceover recording core (issue #31): record your own
 * narration for the selected scene from the microphone while the
 * scene script runs as a teleprompter, keep multiple takes, and land
 * the chosen take on the scene voice track with the scene duration
 * set from the take length.
 *
 * This module is the testable core: every browser API is injected
 * through VoiceoverRecorderDeps, so the state machine, countdown,
 * teleprompter cues, and take management run in unit tests with mocked
 * media APIs. Real capture needs a live browser, a microphone, and a
 * user gesture; the editor component wires the real
 * navigator.mediaDevices and MediaRecorder in.
 *
 * Shape note: this recorder deliberately mirrors the StudioRecorder
 * state machine built for screen and webcam recording (issue #26,
 * packages/media recording module): the same state names plus a
 * countdown state, the same injected-deps pattern, the same
 * permission-denied and unsupported states, and cancel discards the
 * take. When the #26 tree lands on main, the two recorders should be
 * deduped onto one shared base in packages/media; see MANIFEST.md.
 */
import type { AudioObject, CharacterObject, VideoScene } from "@finch-studio/core";
import { getAudioClipMetadata } from "./audioEditing";

export type VoiceoverState =
  | "idle"
  | "requesting"
  | "countdown"
  | "recording"
  | "stopping"
  | "done"
  | "cancelled"
  | "permission-denied"
  | "unsupported"
  | "error";

export type VoiceoverErrorKind =
  | "permission-denied"
  | "unsupported"
  | "no-device"
  | "recorder-error"
  | "unknown";

export const DEFAULT_COUNTDOWN_MS = 3000;
/** Shortest take that can land on a scene, matching the scene minimum. */
export const MIN_TAKE_DURATION_MS = 500;

export interface VoiceoverSupportEnv {
  mediaRecorder: boolean;
  getUserMedia: boolean;
}

export interface VoiceoverSupport {
  supported: boolean;
  /** Human readable names of the missing browser APIs, empty when supported. */
  missing: string[];
}

/** Which browser APIs microphone voiceover recording needs. */
export function voiceoverSupport(env: VoiceoverSupportEnv): VoiceoverSupport {
  const missing: string[] = [];
  if (!env.mediaRecorder) missing.push("MediaRecorder");
  if (!env.getUserMedia) missing.push("microphone capture");
  return { supported: missing.length === 0, missing };
}

/** Detect support from a navigator-like scope (the real one in the editor). */
export function detectVoiceoverSupport(scope: {
  mediaDevices?: { getUserMedia?: unknown };
  MediaRecorder?: unknown;
}): VoiceoverSupport {
  return voiceoverSupport({
    mediaRecorder: typeof scope.MediaRecorder === "function",
    getUserMedia: typeof scope.mediaDevices?.getUserMedia === "function",
  });
}

/** getUserMedia constraints for voiceover: microphone only, no camera. */
export function microphoneConstraints(): Record<string, unknown> {
  return { audio: true, video: false };
}

export function classifyVoiceoverError(err: unknown): VoiceoverErrorKind {
  const name =
    err && typeof err === "object" && "name" in err
      ? String((err as { name?: unknown }).name ?? "")
      : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "permission-denied";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "no-device";
  if (name === "NotSupportedError") return "unsupported";
  if (name === "NotReadableError" || name === "TrackStartError") return "recorder-error";
  return "unknown";
}

/** User facing copy for a voiceover failure. No em dashes, per house style. */
export function voiceoverErrorMessage(kind: VoiceoverErrorKind): string {
  switch (kind) {
    case "permission-denied":
      return "Microphone permission was denied. Allow microphone access in your browser, then try again.";
    case "unsupported":
      return "Voiceover recording is not supported in this browser. Try Chrome or Edge on a desktop computer.";
    case "no-device":
      return "No microphone was found. Connect a microphone, then try again.";
    case "recorder-error":
      return "The microphone could not start. Check that no other app is using it, then try again.";
    default:
      return "Voiceover recording could not start. Try again.";
  }
}

export function unsupportedVoiceoverMessage(support: VoiceoverSupport): string {
  return `Voiceover recording is not supported in this browser (missing: ${support.missing.join(", ")}). Try Chrome or Edge on a desktop computer.`;
}

/** Elapsed clock label for the recording UI, for example "0:07" or "12:34". */
export function formatVoiceoverElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Whole seconds left on the countdown, rounded up so 3, 2, 1 all show. */
export function countdownSeconds(remainingMs: number): number {
  return Math.max(0, Math.ceil(remainingMs / 1000));
}

// ---------------------------------------------------------------------------
// Teleprompter: the scene script, in reading order.
// ---------------------------------------------------------------------------

export interface TeleprompterLine {
  lineId: string;
  characterId: string;
  speaker: string;
  text: string;
  /** The line's authored start in the scene, in ms. */
  startMs: number;
  /** The line's authored duration, in ms. */
  durationMs: number;
}

/**
 * The scene's dialogue as a teleprompter script: every character's
 * speech lines, characters in stage order, each character's lines in
 * their authored start order. Scenes without dialogue produce an empty
 * script; the panel then offers a free recording with no prompt.
 */
export function teleprompterLines(scene: VideoScene | undefined): TeleprompterLine[] {
  if (!scene) return [];
  const lines: TeleprompterLine[] = [];
  for (const object of scene.objects) {
    if (object.type !== "character") continue;
    const character = object as CharacterObject;
    const speech = [...(character.speech ?? [])].sort((a, b) => a.start - b.start);
    for (const line of speech) {
      if (!line.text.trim()) continue;
      lines.push({
        lineId: line.id,
        characterId: character.id,
        speaker: character.name ?? "Character",
        text: line.text,
        startMs: Math.max(0, Math.round(line.start)),
        durationMs: Math.max(1, Math.round(line.duration)),
      });
    }
  }
  return lines;
}

export interface TeleprompterCue extends TeleprompterLine {
  /** When this line's reading window starts, ms into the recording. */
  cueStartMs: number;
  /** When this line's reading window ends, ms into the recording. */
  cueEndMs: number;
}

/**
 * Reading windows for a recording: the script laid end to end in
 * reading order, each line keeping its authored duration, starting
 * when the recording starts. The prompter highlights the line whose
 * window contains the elapsed recording time.
 */
export function teleprompterCues(lines: TeleprompterLine[]): TeleprompterCue[] {
  let cursor = 0;
  return lines.map((line) => {
    const cue = { ...line, cueStartMs: cursor, cueEndMs: cursor + line.durationMs };
    cursor = cue.cueEndMs;
    return cue;
  });
}

/** Index of the line to highlight at elapsedMs, or -1 before the first cue. */
export function activeTeleprompterIndex(cues: TeleprompterCue[], elapsedMs: number): number {
  for (let i = 0; i < cues.length; i++) {
    if (elapsedMs >= cues[i].cueStartMs && elapsedMs < cues[i].cueEndMs) return i;
  }
  return elapsedMs >= 0 && cues.length > 0 && elapsedMs >= cues[cues.length - 1].cueEndMs
    ? cues.length - 1
    : -1;
}

/**
 * Re-time the script's lines to a chosen take, the same way generated
 * narration sets each line's duration to its measured audio length:
 * the take is one recording of the whole script, so each line keeps
 * its share of the script's total authored duration, the lines are
 * laid end to end from the first line's authored start, and the last
 * line absorbs rounding so the lines end exactly at the take's end.
 * With this plus the take's own clip, the scene duration the store
 * derives is the take length whenever the take is the longest content.
 */
export function retimeLinesForTake(
  lines: TeleprompterLine[],
  takeDurationMs: number,
): { characterId: string; lineId: string; start: number; duration: number }[] {
  if (lines.length === 0) return [];
  const totalMs = Math.max(1, Math.round(takeDurationMs));
  const authoredTotal = lines.reduce((sum, line) => sum + line.durationMs, 0);
  let cursor = lines[0].startMs;
  return lines.map((line, index) => {
    const isLast = index === lines.length - 1;
    const duration = isLast
      ? Math.max(1, lines[0].startMs + totalMs - cursor)
      : Math.max(
          1,
          Math.round((line.durationMs / Math.max(1, authoredTotal)) * totalMs),
        );
    const patch = { characterId: line.characterId, lineId: line.lineId, start: cursor, duration };
    cursor += duration;
    return patch;
  });
}

// ---------------------------------------------------------------------------
// Takes.
// ---------------------------------------------------------------------------

export interface VoiceoverTake {
  id: string;
  name: string;
  /** Object URL for audition playback and the scene clip resource. */
  url: string;
  /** The recorded bytes (a Blob in the browser). */
  blob: { size: number; type: string };
  mimeType: string;
  durationMs: number;
  createdAtMs: number;
}

export interface VoiceoverClip {
  blob: { size: number; type: string };
  mimeType: string;
  durationMs: number;
  name: string;
}

/** Name for the next take in a list, for example "Voiceover take 2". */
export function nextTakeName(takes: readonly VoiceoverTake[]): string {
  return `Voiceover take ${takes.length + 1}`;
}

/** Turn a finished recording into a listed take. */
export function makeTake(
  clip: VoiceoverClip,
  options: { id: string; url: string; name: string; createdAtMs: number },
): VoiceoverTake {
  return {
    id: options.id,
    name: options.name,
    url: options.url,
    blob: clip.blob,
    mimeType: clip.mimeType,
    durationMs: Math.round(clip.durationMs),
    createdAtMs: options.createdAtMs,
  };
}

/** Append a take; takes stay in recording order. */
export function addTake(
  takes: readonly VoiceoverTake[],
  take: VoiceoverTake,
): VoiceoverTake[] {
  return [...takes, take];
}

/** Drop one take from the list (the scene clip, if any, is unaffected). */
export function removeTake(
  takes: readonly VoiceoverTake[],
  takeId: string,
): VoiceoverTake[] {
  return takes.filter((take) => take.id !== takeId);
}

/** True when an audio object is a scene's chosen voiceover clip. */
export function isVoiceoverObject(object: { type: string }): boolean {
  return (
    object.type === "audio" &&
    getAudioClipMetadata(object as AudioObject).voiceover === true
  );
}

// ---------------------------------------------------------------------------
// Injectable browser surface (structural, so tests can mock every piece).
// Mirrors RecorderDeps in the #26 packages/media recording module.
// ---------------------------------------------------------------------------

export interface VoiceoverTrackLike {
  kind?: string;
  stop: () => void;
}

export interface VoiceoverStreamLike {
  getTracks: () => VoiceoverTrackLike[];
}

export interface VoiceoverDataEventLike {
  data: { size: number };
}

export interface VoiceoverMediaRecorderLike {
  state: string;
  mimeType: string;
  start: (timesliceMs?: number) => void;
  stop: () => void;
  addEventListener?: (
    type: string,
    listener: (event: VoiceoverDataEventLike) => void,
  ) => void;
  ondataavailable?: ((event: VoiceoverDataEventLike) => void) | null;
  onstop?: (() => void) | null;
  onerror?: (() => void) | null;
}

export interface VoiceoverRecorderDeps {
  mediaDevices?: {
    getUserMedia?: (
      constraints: Record<string, unknown>,
    ) => Promise<VoiceoverStreamLike>;
  };
  MediaRecorderCtor?: (new (
    stream: VoiceoverStreamLike,
    options?: { mimeType?: string },
  ) => VoiceoverMediaRecorderLike) & {
    isTypeSupported?: (mimeType: string) => boolean;
  };
  /** Assemble the final take blob from recorded chunks. */
  createBlob?: (
    parts: { size: number }[],
    options: { type: string },
  ) => { size: number; type: string };
  now?: () => number;
  /** Wait out the countdown; injected so tests control the clock. */
  delay?: (ms: number) => Promise<void>;
  /** Countdown before recording starts, in ms. 0 skips the countdown. */
  countdownMs?: number;
  onStateChange?: (state: VoiceoverState) => void;
}

const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/ogg",
];

function defaultCreateBlob(
  parts: { size: number }[],
  options: { type: string },
): { size: number; type: string } {
  const Ctor = (
    globalThis as unknown as {
      Blob?: new (parts: { size: number }[], options: { type: string }) => {
        size: number;
        type: string;
      };
    }
  ).Blob;
  if (Ctor) return new Ctor(parts, options);
  return {
    size: parts.reduce((sum, part) => sum + part.size, 0),
    type: options.type,
  };
}

function pickMimeType(deps: VoiceoverRecorderDeps): string | undefined {
  const isSupported = deps.MediaRecorderCtor?.isTypeSupported;
  if (!isSupported) return undefined;
  return PREFERRED_MIME_TYPES.find((mime) => {
    try {
      return isSupported(mime);
    } catch {
      return false;
    }
  });
}

/**
 * The voiceover recorder state machine.
 *
 * idle -> requesting -> countdown -> recording -> stopping -> done
 * Any start failure lands in permission-denied, unsupported, or error.
 * cancel() discards the take and lands in cancelled, from requesting,
 * countdown, recording, or stopping; no clip is produced.
 */
export class VoiceoverRecorder {
  private readonly deps: VoiceoverRecorderDeps;
  private readonly now: () => number;
  private readonly countdownMs: number;
  private state: VoiceoverState = "idle";
  private recorder: VoiceoverMediaRecorderLike | null = null;
  private stream: VoiceoverStreamLike | null = null;
  private chunks: { size: number }[] = [];
  private startedAtMs = 0;
  private countdownStartedAtMs = 0;
  private finishedDurationMs = 0;
  private discard = false;
  private pendingCancel = false;
  private countdownWake: (() => void) | null = null;
  private stopWaiter: ((clip: VoiceoverClip | null) => void) | null = null;
  private lastClip: VoiceoverClip | null = null;
  errorKind: VoiceoverErrorKind | null = null;
  errorMessage: string | null = null;

  constructor(deps: VoiceoverRecorderDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
    this.countdownMs = Math.max(0, deps.countdownMs ?? DEFAULT_COUNTDOWN_MS);
  }

  getState(): VoiceoverState {
    return this.state;
  }

  isRecording(): boolean {
    return this.state === "recording";
  }

  /** Support given the injected browser APIs. */
  support(): VoiceoverSupport {
    return voiceoverSupport({
      mediaRecorder: typeof this.deps.MediaRecorderCtor === "function",
      getUserMedia: typeof this.deps.mediaDevices?.getUserMedia === "function",
    });
  }

  /**
   * The most recent finished clip. stop() also resolves with it; this
   * getter mirrors StudioRecorder.getLastClip from the #26 module.
   */
  getLastClip(): VoiceoverClip | null {
    return this.lastClip;
  }

  /** Elapsed recording time; freezes at the final duration once stopped. */
  elapsedMs(atMs?: number): number {
    if (this.state === "recording" || this.state === "stopping") {
      return Math.max(0, (atMs ?? this.now()) - this.startedAtMs);
    }
    if (this.state === "done") return this.finishedDurationMs;
    return 0;
  }

  /** Time left on the countdown, in ms; 0 outside the countdown state. */
  countdownRemainingMs(atMs?: number): number {
    if (this.state !== "countdown") return 0;
    return Math.max(0, this.countdownStartedAtMs + this.countdownMs - (atMs ?? this.now()));
  }

  private setState(next: VoiceoverState): void {
    this.state = next;
    this.deps.onStateChange?.(next);
  }

  private fail(
    kind: VoiceoverErrorKind,
  ): { ok: false; kind: VoiceoverErrorKind; message: string } {
    this.errorKind = kind;
    this.errorMessage = voiceoverErrorMessage(kind);
    this.setState(
      kind === "permission-denied"
        ? "permission-denied"
        : kind === "unsupported"
          ? "unsupported"
          : "error",
    );
    return { ok: false, kind, message: this.errorMessage };
  }

  private stopTracks(): void {
    if (!this.stream) return;
    for (const track of this.stream.getTracks()) track.stop();
    this.stream = null;
  }

  private async waitCountdown(): Promise<boolean> {
    // Resolves true when cancel() interrupts the countdown.
    if (this.countdownMs <= 0) return this.pendingCancel;
    let wake: () => void = () => undefined;
    const cancelled = new Promise<boolean>((resolve) => {
      wake = () => resolve(true);
      this.countdownWake = wake;
    });
    const waited = (this.deps.delay ??
      ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))))(
      this.countdownMs,
    ).then(() => false);
    const interrupted = await Promise.race([cancelled, waited]);
    this.countdownWake = null;
    return interrupted || this.pendingCancel;
  }

  async start(): Promise<
    { ok: true } | { ok: false; kind: VoiceoverErrorKind; message: string }
  > {
    if (
      this.state === "requesting" ||
      this.state === "countdown" ||
      this.state === "recording" ||
      this.state === "stopping"
    ) {
      return {
        ok: false,
        kind: "recorder-error",
        message: "A voiceover recording is already in progress.",
      };
    }
    this.errorKind = null;
    this.errorMessage = null;
    this.lastClip = null;
    this.chunks = [];
    this.discard = false;
    this.pendingCancel = false;
    this.finishedDurationMs = 0;

    const support = this.support();
    if (!support.supported) {
      this.errorMessage = unsupportedVoiceoverMessage(support);
      this.errorKind = "unsupported";
      this.setState("unsupported");
      return { ok: false, kind: "unsupported", message: this.errorMessage };
    }

    this.setState("requesting");
    let stream: VoiceoverStreamLike;
    try {
      stream = await this.deps.mediaDevices!.getUserMedia!(microphoneConstraints());
    } catch (err) {
      return this.fail(classifyVoiceoverError(err));
    }
    if (this.pendingCancel) {
      for (const track of stream.getTracks()) track.stop();
      this.setState("cancelled");
      return { ok: false, kind: "unknown", message: "Recording was cancelled." };
    }
    this.stream = stream;

    this.countdownStartedAtMs = this.now();
    this.setState("countdown");
    const interrupted = await this.waitCountdown();
    if (interrupted) {
      this.stopTracks();
      this.setState("cancelled");
      return { ok: false, kind: "unknown", message: "Recording was cancelled." };
    }

    try {
      const mimeType = pickMimeType(this.deps);
      const recorder = new this.deps.MediaRecorderCtor!(
        stream,
        mimeType ? { mimeType } : undefined,
      );
      this.recorder = recorder;
      const onData = (event: VoiceoverDataEventLike) => {
        if (event.data && event.data.size > 0) this.chunks.push(event.data);
      };
      const onStop = () => this.handleRecorderStop();
      if (typeof recorder.addEventListener === "function") {
        recorder.addEventListener("dataavailable", onData);
        recorder.addEventListener(
          "stop",
          onStop as (event: VoiceoverDataEventLike) => void,
        );
      } else {
        recorder.ondataavailable = onData;
        recorder.onstop = onStop;
      }
      this.startedAtMs = this.now();
      recorder.start(250);
      this.setState("recording");
      return { ok: true };
    } catch (err) {
      this.stopTracks();
      this.recorder = null;
      return this.fail(classifyVoiceoverError(err));
    }
  }

  /** Stop recording and resolve with the finished clip (null if none). */
  stop(): Promise<VoiceoverClip | null> {
    if (this.state !== "recording" || !this.recorder) {
      return Promise.resolve(null);
    }
    this.setState("stopping");
    const promise = new Promise<VoiceoverClip | null>((resolve) => {
      this.stopWaiter = resolve;
    });
    try {
      this.recorder.stop();
    } catch {
      this.handleRecorderStop();
    }
    return promise;
  }

  /** Discard the current take. No clip is produced. */
  cancel(): void {
    if (this.state === "requesting" || this.state === "countdown") {
      this.pendingCancel = true;
      this.discard = true;
      this.countdownWake?.();
      return;
    }
    if (this.state !== "recording" && this.state !== "stopping") return;
    this.discard = true;
    if (this.recorder && this.state === "recording") {
      this.setState("stopping");
      try {
        this.recorder.stop();
      } catch {
        this.handleRecorderStop();
      }
    } else if (this.state === "stopping" && !this.recorder) {
      this.handleRecorderStop();
    }
  }

  private handleRecorderStop(): void {
    const durationMs = Math.max(0, this.now() - this.startedAtMs);
    this.stopTracks();
    const recorder = this.recorder;
    this.recorder = null;
    const waiter = this.stopWaiter;
    this.stopWaiter = null;
    if (this.discard) {
      this.chunks = [];
      this.discard = false;
      this.setState("cancelled");
      waiter?.(null);
      return;
    }
    const mimeType = recorder?.mimeType || "audio/webm";
    const blob = (this.deps.createBlob ?? defaultCreateBlob)(this.chunks, {
      type: mimeType,
    });
    this.chunks = [];
    this.finishedDurationMs = durationMs;
    const clip: VoiceoverClip = {
      blob,
      mimeType,
      durationMs,
      name: "Voiceover take",
    };
    this.lastClip = clip;
    this.setState("done");
    waiter?.(clip);
  }
}
