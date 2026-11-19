import { describe, expect, it, vi } from "vitest";
import {
  StudioRecorder,
  classifyRecordingError,
  detectRecordingSupport,
  formatRecordingElapsed,
  planRecordingIngest,
  recordedClipToAsset,
  recordingErrorMessage,
  recordingSupport,
  type MediaRecorderLike,
  type RecordedClip,
  type RecordingStreamLike,
  type RecordingTrackLike,
} from "./recording.js";

class FakeTrack implements RecordingTrackLike {
  stopped = false;
  private endedListeners: (() => void)[] = [];
  constructor(
    public kind: string,
    private settings: { width?: number; height?: number } = {},
  ) {}
  stop() {
    this.stopped = true;
  }
  getSettings() {
    return this.settings;
  }
  addEventListener(_type: string, listener: () => void) {
    this.endedListeners.push(listener);
  }
  fireEnded() {
    for (const listener of this.endedListeners) listener();
  }
}

function fakeStream(tracks: FakeTrack[]): RecordingStreamLike {
  return { getTracks: () => tracks };
}

class FakeRecorder implements MediaRecorderLike {
  static instances: FakeRecorder[] = [];
  static isTypeSupported = (mimeType: string) => mimeType === "video/webm";
  state = "inactive";
  mimeType = "";
  stream: RecordingStreamLike;
  private listeners = new Map<string, ((event: { data: { size: number } }) => void)[]>();
  constructor(stream: RecordingStreamLike, options?: { mimeType?: string }) {
    this.stream = stream;
    this.mimeType = options?.mimeType ?? "video/webm";
    FakeRecorder.instances.push(this);
  }
  addEventListener(type: string, listener: (event: { data: { size: number } }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    for (const listener of this.listeners.get("stop") ?? []) {
      (listener as unknown as () => void)();
    }
  }
  emitData(size: number) {
    for (const listener of this.listeners.get("dataavailable") ?? []) {
      listener({ data: { size } });
    }
  }
}

function makeRecorderHarness() {
  FakeRecorder.instances = [];
  let nowMs = 1_000;
  const screenTrack = new FakeTrack("video", { width: 1920, height: 1080 });
  const screenAudio = new FakeTrack("audio");
  const camTrack = new FakeTrack("video", { width: 1280, height: 720 });
  const micTrack = new FakeTrack("audio");
  const screenStream = fakeStream([screenTrack, screenAudio]);
  const webcamStream = fakeStream([camTrack, micTrack]);
  const getDisplayMedia = vi.fn(async () => screenStream);
  const getUserMedia = vi.fn(async () => webcamStream);
  const combinedTracks: RecordingTrackLike[][] = [];
  const recorder = new StudioRecorder({
    mediaDevices: { getDisplayMedia, getUserMedia },
    MediaRecorderCtor: FakeRecorder as never,
    createStream: (tracks) => {
      combinedTracks.push(tracks);
      return fakeStream(tracks as FakeTrack[]);
    },
    createBlob: (parts, options) => ({
      size: parts.reduce((sum, part) => sum + part.size, 0),
      type: options.type,
    }),
    now: () => nowMs,
  });
  return {
    recorder,
    getDisplayMedia,
    getUserMedia,
    combinedTracks,
    screenTrack,
    camTrack,
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

describe("recording support and mode selection", () => {
  it("requires MediaRecorder plus the capture APIs each mode uses", () => {
    const bare = { mediaRecorder: false, getDisplayMedia: false, getUserMedia: false };
    expect(recordingSupport("screen", bare).supported).toBe(false);
    expect(recordingSupport("screen", bare).missing).toContain("MediaRecorder");
    expect(
      recordingSupport("webcam", { mediaRecorder: true, getDisplayMedia: false, getUserMedia: true })
        .supported,
    ).toBe(true);
    expect(
      recordingSupport("screen-and-webcam", {
        mediaRecorder: true,
        getDisplayMedia: true,
        getUserMedia: false,
      }).missing,
    ).toEqual(["camera and microphone"]);
  });

  it("detects support from a navigator like scope", () => {
    expect(
      detectRecordingSupport("screen", {
        mediaDevices: { getDisplayMedia: () => undefined },
        MediaRecorder: class {},
      }).supported,
    ).toBe(true);
    expect(detectRecordingSupport("webcam", {}).supported).toBe(false);
  });

  it("screen mode never asks for the webcam, and webcam mode never asks for the screen", async () => {
    const screen = makeRecorderHarness();
    await screen.recorder.start("screen");
    expect(screen.getDisplayMedia).toHaveBeenCalledTimes(1);
    expect(screen.getUserMedia).not.toHaveBeenCalled();

    const webcam = makeRecorderHarness();
    await webcam.recorder.start("webcam");
    expect(webcam.getUserMedia).toHaveBeenCalledTimes(1);
    expect(webcam.getDisplayMedia).not.toHaveBeenCalled();
  });

  it("screen and webcam mode combines every track into one recording stream", async () => {
    const h = makeRecorderHarness();
    await h.recorder.start("screen-and-webcam");
    expect(h.getDisplayMedia).toHaveBeenCalledTimes(1);
    expect(h.getUserMedia).toHaveBeenCalledTimes(1);
    expect(h.combinedTracks[0]).toHaveLength(4);
    expect(FakeRecorder.instances[0].stream.getTracks()).toHaveLength(4);
  });
});

describe("recorder state machine", () => {
  it("records, tracks elapsed time, and stops into a finished clip", async () => {
    const h = makeRecorderHarness();
    const started = await h.recorder.start("screen");
    expect(started).toEqual({ ok: true });
    expect(h.recorder.getState()).toBe("recording");
    expect(h.recorder.isRecording()).toBe(true);

    h.advance(7_000);
    expect(h.recorder.elapsedMs()).toBe(7_000);
    expect(formatRecordingElapsed(h.recorder.elapsedMs())).toBe("0:07");

    FakeRecorder.instances[0].emitData(100);
    FakeRecorder.instances[0].emitData(50);
    h.advance(3_000);
    const clip = await h.recorder.stop();
    expect(h.recorder.getState()).toBe("done");
    expect(clip?.durationMs).toBe(10_000);
    expect(clip?.blob.size).toBe(150);
    expect(clip?.mimeType).toBe("video/webm");
    expect(clip?.mode).toBe("screen");
    expect(clip?.name).toBe("Screen recording");
    expect(clip?.width).toBe(1920);
    expect(h.recorder.elapsedMs()).toBe(10_000);
    expect(h.screenTrack.stopped).toBe(true);
  });

  it("cancel discards the take and stops every track", async () => {
    const h = makeRecorderHarness();
    await h.recorder.start("webcam");
    FakeRecorder.instances[0].emitData(80);
    h.recorder.cancel();
    expect(h.recorder.getState()).toBe("cancelled");
    expect(h.camTrack.stopped).toBe(true);
    expect(await h.recorder.stop()).toBeNull();
  });

  it("ending screen share from the browser stops and keeps the take", async () => {
    const h = makeRecorderHarness();
    await h.recorder.start("screen");
    FakeRecorder.instances[0].emitData(42);
    h.advance(2_000);
    h.screenTrack.fireEnded();
    expect(h.recorder.getState()).toBe("done");
  });

  it("a second start while recording is refused", async () => {
    const h = makeRecorderHarness();
    await h.recorder.start("screen");
    const again = await h.recorder.start("webcam");
    expect(again.ok).toBe(false);
    expect(h.recorder.getState()).toBe("recording");
  });
});

describe("recording failures", () => {
  it("permission denied lands in its own state with clear copy and no recorder", async () => {
    const denied = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    const recorder = new StudioRecorder({
      mediaDevices: {
        getDisplayMedia: async () => {
          throw denied;
        },
      },
      MediaRecorderCtor: FakeRecorder as never,
    });
    FakeRecorder.instances = [];
    const result = await recorder.start("screen");
    expect(result.ok).toBe(false);
    expect(recorder.getState()).toBe("permission-denied");
    expect(recorder.errorMessage).toContain("Permission was denied");
    expect(FakeRecorder.instances).toHaveLength(0);
  });

  it("unsupported browsers are refused before any capture API is called", async () => {
    const getDisplayMedia = vi.fn(async () => fakeStream([]));
    const recorder = new StudioRecorder({ mediaDevices: { getDisplayMedia } });
    const result = await recorder.start("screen");
    expect(result.ok).toBe(false);
    expect(recorder.getState()).toBe("unsupported");
    expect(recorder.errorMessage).toContain("not supported in this browser");
    expect(getDisplayMedia).not.toHaveBeenCalled();
  });

  it("a webcam failure after screen capture still stops the screen tracks", async () => {
    const h = makeRecorderHarness();
    h.getUserMedia.mockRejectedValueOnce(
      Object.assign(new Error("gone"), { name: "NotFoundError" }),
    );
    const result = await h.recorder.start("screen-and-webcam");
    expect(result.ok).toBe(false);
    expect(h.recorder.getState()).toBe("error");
    expect(h.recorder.errorKind).toBe("no-device");
    expect(h.screenTrack.stopped).toBe(true);
  });

  it("classifies browser errors and formats elapsed time", () => {
    expect(classifyRecordingError({ name: "NotAllowedError" })).toBe("permission-denied");
    expect(classifyRecordingError({ name: "NotFoundError" })).toBe("no-device");
    expect(classifyRecordingError(new Error("boom"))).toBe("unknown");
    expect(recordingErrorMessage("unsupported")).toContain("Chrome or Edge");
    expect(formatRecordingElapsed(0)).toBe("0:00");
    expect(formatRecordingElapsed(65_000)).toBe("1:05");
    expect(formatRecordingElapsed(3_599_000)).toBe("59:59");
  });
});

describe("ingest handoff", () => {
  const clip: RecordedClip = {
    blob: { size: 2048, type: "video/webm" },
    mimeType: "video/webm",
    durationMs: 12_400,
    mode: "screen-and-webcam",
    name: "Screen and webcam recording",
    width: 1920,
    height: 1080,
  };

  it("turns a finished clip into a user source video asset", () => {
    const asset = recordedClipToAsset(clip, {
      id: "usr-abc123",
      url: "blob:https://studio.example/1",
    });
    expect(asset.source).toBe("user");
    expect(asset.kind).toBe("video");
    expect(asset.remoteUrl).toBe("blob:https://studio.example/1");
    expect(asset.durationMs).toBe(12_400);
    expect(asset.tags).toEqual(["recording", "screen-and-webcam"]);
  });

  it("gets the same ingest plan as uploaded footage", () => {
    const plan = planRecordingIngest(clip);
    expect(plan.proxies.map((p) => p.label)).toContain("720p");
    expect(plan.waveform).toBe(true);
    expect(plan.thumbnailStrip.count).toBeGreaterThan(0);
  });
});
