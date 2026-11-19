/**
 * Screen and webcam recording core (issue #26): record the screen, the
 * webcam, or both from the browser (getDisplayMedia plus getUserMedia)
 * and hand the finished clip to the normal media ingest path as a user
 * source video asset, exactly like an uploaded footage file.
 *
 * This module is the testable core: every browser API is injected
 * through RecorderDeps, so the state machine, mode selection, and
 * ingest handoff run in unit tests with mocked media APIs. Real capture
 * needs a live browser and a user gesture; the editor component wires
 * the real navigator.mediaDevices and MediaRecorder in.
 */

import { planIngest, type IngestPlan, type MediaAsset } from "./media.js";

export type RecordingMode = "screen" | "webcam" | "screen-and-webcam";

export type RecordingState =
  | "idle"
  | "requesting"
  | "recording"
  | "stopping"
  | "done"
  | "cancelled"
  | "permission-denied"
  | "unsupported"
  | "error";

export type RecordingErrorKind =
  | "permission-denied"
  | "unsupported"
  | "no-device"
  | "recorder-error"
  | "unknown";

export interface RecordingSupportEnv {
  mediaRecorder: boolean;
  getDisplayMedia: boolean;
  getUserMedia: boolean;
}

export interface RecordingSupport {
  supported: boolean;
  /** Human readable names of the missing browser APIs, empty when supported. */
  missing: string[];
}

/** Which browser APIs a recording mode needs. */
export function recordingSupport(
  mode: RecordingMode,
  env: RecordingSupportEnv,
): RecordingSupport {
  const missing: string[] = [];
  if (!env.mediaRecorder) missing.push("MediaRecorder");
  if (mode !== "webcam" && !env.getDisplayMedia) missing.push("screen capture");
  if (mode !== "screen" && !env.getUserMedia) missing.push("camera and microphone");
  return { supported: missing.length === 0, missing };
}

/** Detect support from a navigator-like scope (the real one in the editor). */
export function detectRecordingSupport(
  mode: RecordingMode,
  scope: {
    mediaDevices?: { getDisplayMedia?: unknown; getUserMedia?: unknown };
    MediaRecorder?: unknown;
  },
): RecordingSupport {
  return recordingSupport(mode, {
    mediaRecorder: typeof scope.MediaRecorder === "function",
    getDisplayMedia: typeof scope.mediaDevices?.getDisplayMedia === "function",
    getUserMedia: typeof scope.mediaDevices?.getUserMedia === "function",
  });
}

export function recordingModeLabel(mode: RecordingMode): string {
  if (mode === "webcam") return "Webcam";
  if (mode === "screen-and-webcam") return "Screen and webcam";
  return "Screen";
}

export function defaultRecordingName(mode: RecordingMode): string {
  return `${recordingModeLabel(mode)} recording`;
}

/** getDisplayMedia constraints for the modes that capture the screen. */
export function displayMediaConstraints(): Record<string, unknown> {
  return { video: true, audio: true };
}

/** getUserMedia constraints for the modes that capture the webcam. */
export function userMediaConstraints(): Record<string, unknown> {
  return { video: true, audio: true };
}

export function classifyRecordingError(err: unknown): RecordingErrorKind {
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

/** User facing copy for a recording failure. No em dashes, per house style. */
export function recordingErrorMessage(kind: RecordingErrorKind): string {
  switch (kind) {
    case "permission-denied":
      return "Permission was denied. Allow screen or camera access in your browser, then try again.";
    case "unsupported":
      return "Recording is not supported in this browser. Try Chrome or Edge on a desktop computer.";
    case "no-device":
      return "No camera or microphone was found. Connect a device, then try again.";
    case "recorder-error":
      return "The recording device could not start. Check that no other app is using your camera, then try again.";
    default:
      return "Recording could not start. Try again.";
  }
}

export function unsupportedRecordingMessage(support: RecordingSupport): string {
  return `Recording is not supported in this browser (missing: ${support.missing.join(", ")}). Try Chrome or Edge on a desktop computer.`;
}

/** Elapsed clock label for the recording UI, for example "0:07" or "12:34". */
export function formatRecordingElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Injectable browser surface (structural, so tests can mock every piece).
// ---------------------------------------------------------------------------

export interface RecordingTrackLike {
  kind?: string;
  stop: () => void;
  getSettings?: () => { width?: number; height?: number };
  addEventListener?: (type: string, listener: () => void) => void;
  onended?: (() => void) | null;
}

export interface RecordingStreamLike {
  getTracks: () => RecordingTrackLike[];
}

export interface RecordingDataEventLike {
  data: { size: number };
}

export interface MediaRecorderLike {
  state: string;
  mimeType: string;
  start: (timesliceMs?: number) => void;
  stop: () => void;
  addEventListener?: (
    type: string,
    listener: (event: RecordingDataEventLike) => void,
  ) => void;
  ondataavailable?: ((event: RecordingDataEventLike) => void) | null;
  onstop?: (() => void) | null;
  onerror?: (() => void) | null;
}

export interface RecorderDeps {
  mediaDevices?: {
    getDisplayMedia?: (
      constraints: Record<string, unknown>,
    ) => Promise<RecordingStreamLike>;
    getUserMedia?: (
      constraints: Record<string, unknown>,
    ) => Promise<RecordingStreamLike>;
  };
  MediaRecorderCtor?: (new (
    stream: RecordingStreamLike,
    options?: { mimeType?: string },
  ) => MediaRecorderLike) & {
    isTypeSupported?: (mimeType: string) => boolean;
  };
  /** Combine the screen and webcam streams for screen-and-webcam mode. */
  createStream?: (tracks: RecordingTrackLike[]) => RecordingStreamLike;
  /** Assemble the final clip blob from recorded chunks. */
  createBlob?: (
    parts: { size: number }[],
    options: { type: string },
  ) => { size: number; type: string };
  now?: () => number;
  onStateChange?: (state: RecordingState) => void;
}

export interface RecordedClip {
  /** The recorded bytes (a Blob in the browser). */
  blob: { size: number; type: string };
  mimeType: string;
  durationMs: number;
  mode: RecordingMode;
  name: string;
  width?: number;
  height?: number;
}

const PREFERRED_MIME_TYPES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4",
];

function defaultCreateStream(tracks: RecordingTrackLike[]): RecordingStreamLike {
  const Ctor = (
    globalThis as unknown as {
      MediaStream?: new (tracks: RecordingTrackLike[]) => RecordingStreamLike;
    }
  ).MediaStream;
  if (Ctor) return new Ctor(tracks);
  return { getTracks: () => tracks };
}

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

function pickMimeType(deps: RecorderDeps): string | undefined {
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
 * The recorder state machine.
 *
 * idle -> requesting -> recording -> stopping -> done
 * Any start failure lands in permission-denied, unsupported, or error.
 * cancel() discards the take and lands in cancelled, from requesting or
 * recording. When the user ends screen sharing from the browser chrome,
 * the screen track fires "ended" and the recorder stops on its own,
 * keeping the take (state done), like other recording tools.
 */
export class StudioRecorder {
  private readonly deps: RecorderDeps;
  private readonly now: () => number;
  private state: RecordingState = "idle";
  private mode: RecordingMode = "screen";
  private recorder: MediaRecorderLike | null = null;
  private streams: RecordingStreamLike[] = [];
  private chunks: { size: number }[] = [];
  private startedAtMs = 0;
  private finishedDurationMs = 0;
  private discard = false;
  private pendingCancel = false;
  private stopWaiter: ((clip: RecordedClip | null) => void) | null = null;
  private clipWidth: number | undefined;
  private clipHeight: number | undefined;
  private lastClip: RecordedClip | null = null;
  errorKind: RecordingErrorKind | null = null;
  errorMessage: string | null = null;

  constructor(deps: RecorderDeps) {
    this.deps = deps;
    this.now = deps.now ?? (() => Date.now());
  }

  getState(): RecordingState {
    return this.state;
  }

  getMode(): RecordingMode {
    return this.mode;
  }

  isRecording(): boolean {
    return this.state === "recording";
  }

  /** Support for a mode given the injected browser APIs. */
  support(mode: RecordingMode): RecordingSupport {
    return recordingSupport(mode, {
      mediaRecorder: typeof this.deps.MediaRecorderCtor === "function",
      getDisplayMedia: typeof this.deps.mediaDevices?.getDisplayMedia === "function",
      getUserMedia: typeof this.deps.mediaDevices?.getUserMedia === "function",
    });
  }

  /**
   * The most recent finished clip. stop() also resolves with it; this
   * getter covers the browser initiated stop (the user ends screen
   * sharing from the browser chrome), where no caller is awaiting stop.
   */
  getLastClip(): RecordedClip | null {
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

  private setState(next: RecordingState): void {
    this.state = next;
    this.deps.onStateChange?.(next);
  }

  private fail(kind: RecordingErrorKind): { ok: false; kind: RecordingErrorKind; message: string } {
    this.errorKind = kind;
    this.errorMessage = recordingErrorMessage(kind);
    this.setState(
      kind === "permission-denied"
        ? "permission-denied"
        : kind === "unsupported"
          ? "unsupported"
          : "error",
    );
    return { ok: false, kind, message: this.errorMessage };
  }

  async start(
    mode: RecordingMode,
  ): Promise<{ ok: true } | { ok: false; kind: RecordingErrorKind; message: string }> {
    if (this.state === "requesting" || this.state === "recording" || this.state === "stopping") {
      return { ok: false, kind: "recorder-error", message: "A recording is already in progress." };
    }
    this.mode = mode;
    this.errorKind = null;
    this.errorMessage = null;
    this.lastClip = null;
    this.chunks = [];
    this.discard = false;
    this.pendingCancel = false;
    this.finishedDurationMs = 0;
    this.clipWidth = undefined;
    this.clipHeight = undefined;

    const support = this.support(mode);
    if (!support.supported) {
      this.errorMessage = unsupportedRecordingMessage(support);
      this.errorKind = "unsupported";
      this.setState("unsupported");
      return { ok: false, kind: "unsupported", message: this.errorMessage };
    }

    this.setState("requesting");
    const streams: RecordingStreamLike[] = [];
    try {
      let screenStream: RecordingStreamLike | null = null;
      if (mode !== "webcam") {
        screenStream = await this.deps.mediaDevices!.getDisplayMedia!(
          displayMediaConstraints(),
        );
        streams.push(screenStream);
      }
      let webcamStream: RecordingStreamLike | null = null;
      if (mode !== "screen") {
        webcamStream = await this.deps.mediaDevices!.getUserMedia!(
          userMediaConstraints(),
        );
        streams.push(webcamStream);
      }
      if (this.pendingCancel) {
        for (const stream of streams) {
          for (const track of stream.getTracks()) track.stop();
        }
        this.setState("cancelled");
        return { ok: false, kind: "unknown", message: "Recording was cancelled." };
      }
      this.streams = streams;

      let recordStream: RecordingStreamLike;
      if (streams.length === 1) {
        recordStream = streams[0];
      } else {
        const tracks = streams.flatMap((stream) => stream.getTracks());
        recordStream = (this.deps.createStream ?? defaultCreateStream)(tracks);
      }

      const videoTrack = recordStream
        .getTracks()
        .find((track) => track.kind === "video");
      const settings = videoTrack?.getSettings?.();
      if (settings?.width) this.clipWidth = settings.width;
      if (settings?.height) this.clipHeight = settings.height;

      const mimeType = pickMimeType(this.deps);
      const recorder = new this.deps.MediaRecorderCtor!(
        recordStream,
        mimeType ? { mimeType } : undefined,
      );
      this.recorder = recorder;
      const onData = (event: RecordingDataEventLike) => {
        if (event.data && event.data.size > 0) this.chunks.push(event.data);
      };
      const onStop = () => this.handleRecorderStop();
      if (typeof recorder.addEventListener === "function") {
        recorder.addEventListener("dataavailable", onData);
        recorder.addEventListener("stop", onStop as (event: RecordingDataEventLike) => void);
      } else {
        recorder.ondataavailable = onData;
        recorder.onstop = onStop;
      }

      if (screenStream) {
        const onEnded = () => {
          if (this.state === "recording") void this.stop();
        };
        for (const track of screenStream.getTracks()) {
          if (track.kind !== "video") continue;
          if (typeof track.addEventListener === "function") {
            track.addEventListener("ended", onEnded);
          } else if ("onended" in track) {
            track.onended = onEnded;
          }
        }
      }

      this.startedAtMs = this.now();
      recorder.start(250);
      this.setState("recording");
      return { ok: true };
    } catch (err) {
      for (const stream of streams) {
        for (const track of stream.getTracks()) track.stop();
      }
      this.streams = [];
      this.recorder = null;
      return this.fail(classifyRecordingError(err));
    }
  }

  /** Stop recording and resolve with the finished clip (null if none). */
  stop(): Promise<RecordedClip | null> {
    if (this.state !== "recording" || !this.recorder) {
      return Promise.resolve(null);
    }
    this.setState("stopping");
    const promise = new Promise<RecordedClip | null>((resolve) => {
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
    if (this.state === "requesting") {
      this.pendingCancel = true;
      this.discard = true;
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
    for (const stream of this.streams) {
      for (const track of stream.getTracks()) track.stop();
    }
    this.streams = [];
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
    const mimeType = recorder?.mimeType || "video/webm";
    const blob = (this.deps.createBlob ?? defaultCreateBlob)(this.chunks, {
      type: mimeType,
    });
    this.chunks = [];
    this.finishedDurationMs = durationMs;
    const clip: RecordedClip = {
      blob,
      mimeType,
      durationMs,
      mode: this.mode,
      name: defaultRecordingName(this.mode),
      ...(this.clipWidth ? { width: this.clipWidth } : {}),
      ...(this.clipHeight ? { height: this.clipHeight } : {}),
    };
    this.lastClip = clip;
    this.setState("done");
    waiter?.(clip);
  }
}

/**
 * Ingest handoff: a finished recording becomes a normal user source
 * video asset in the three source model, so it flows through the same
 * ingest plan (proxy ladder, thumbnail strip, waveform) and the same
 * library and placement path as uploaded footage.
 */
export function recordedClipToAsset(
  clip: RecordedClip,
  options: { id: string; url?: string },
): MediaAsset {
  return {
    id: options.id,
    source: "user",
    kind: "video",
    name: clip.name,
    ...(options.url ? { remoteUrl: options.url } : {}),
    durationMs: Math.round(clip.durationMs),
    ...(clip.width ? { width: clip.width } : {}),
    ...(clip.height ? { height: clip.height } : {}),
    tags: ["recording", clip.mode],
  };
}

/** The ingest plan a recorded clip gets, same ladder as uploaded video. */
export function planRecordingIngest(clip: RecordedClip): IngestPlan {
  return planIngest({
    kind: "video",
    width: clip.width,
    durationMs: clip.durationMs,
  });
}
