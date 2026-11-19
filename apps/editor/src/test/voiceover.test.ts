/**
 * Voiceover core (issue #31): teleprompter script and cues, take
 * management, line re-timing, and the recorder state machine, all
 * with mocked media APIs. Real microphone capture cannot run here.
 */
import { describe, expect, it } from "vitest";
import type { AudioObject, VideoScene } from "@finch-studio/core";
import { getAudioClipMetadata, withAudioClipMetadata } from "../audioEditing.js";
import {
  VoiceoverRecorder,
  activeTeleprompterIndex,
  addTake,
  classifyVoiceoverError,
  countdownSeconds,
  detectVoiceoverSupport,
  formatVoiceoverElapsed,
  isVoiceoverObject,
  makeTake,
  microphoneConstraints,
  nextTakeName,
  removeTake,
  retimeLinesForTake,
  teleprompterCues,
  teleprompterLines,
  voiceoverErrorMessage,
  voiceoverSupport,
  type VoiceoverDataEventLike,
  type VoiceoverMediaRecorderLike,
  type VoiceoverStreamLike,
  type VoiceoverTake,
} from "../voiceover.js";

class FakeRecorder implements VoiceoverMediaRecorderLike {
  static last: FakeRecorder | null = null;
  static constructed = 0;
  state = "inactive";
  mimeType = "audio/webm";
  private listeners = new Map<string, ((event: VoiceoverDataEventLike) => void)[]>();
  constructor() {
    FakeRecorder.last = this;
    FakeRecorder.constructed += 1;
  }
  addEventListener(type: string, listener: (event: VoiceoverDataEventLike) => void) {
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

function micStream(stopped: { count: number }): VoiceoverStreamLike {
  return {
    getTracks: () => [
      {
        kind: "audio",
        stop: () => {
          stopped.count += 1;
        },
      },
    ],
  };
}

function sceneWithScript(): VideoScene {
  return {
    id: "scene-1",
    name: "Scene 1",
    durationMs: 5000,
    transition: "cut",
    objects: [
      {
        id: "tx-1",
        type: "text",
        name: "Title",
        position: { x: 0, y: 0, w: 100, h: 40 },
      },
      {
        id: "ch-1",
        type: "character",
        name: "Maya",
        position: { x: 0, y: 0, w: 100, h: 200 },
        characterId: "businesswoman",
        facing: "right",
        speech: [
          { id: "line-2", text: "Second line.", start: 3000, duration: 2000 },
          { id: "line-1", text: "First line.", start: 0, duration: 3000 },
          { id: "line-blank", text: "   ", start: 5000, duration: 1000 },
        ],
      },
      {
        id: "ch-2",
        type: "character",
        name: "Leo",
        position: { x: 200, y: 0, w: 100, h: 200 },
        characterId: "businessman",
        facing: "left",
        speech: [{ id: "line-3", text: "Leo replies.", start: 500, duration: 1500 }],
      },
    ],
  } as unknown as VideoScene;
}

describe("support and errors", () => {
  it("requires MediaRecorder and microphone capture", () => {
    expect(voiceoverSupport({ mediaRecorder: true, getUserMedia: true }).supported).toBe(true);
    expect(voiceoverSupport({ mediaRecorder: false, getUserMedia: true }).missing).toContain(
      "MediaRecorder",
    );
    expect(voiceoverSupport({ mediaRecorder: true, getUserMedia: false }).missing).toContain(
      "microphone capture",
    );
    expect(
      detectVoiceoverSupport({
        mediaDevices: { getUserMedia: () => undefined },
        MediaRecorder: class {},
      }).supported,
    ).toBe(true);
    expect(detectVoiceoverSupport({}).supported).toBe(false);
  });

  it("asks for the microphone only, never the camera", () => {
    expect(microphoneConstraints()).toEqual({ audio: true, video: false });
  });

  it("classifies capture errors and writes copy without em dashes", () => {
    expect(classifyVoiceoverError({ name: "NotAllowedError" })).toBe("permission-denied");
    expect(classifyVoiceoverError({ name: "NotFoundError" })).toBe("no-device");
    expect(classifyVoiceoverError({ name: "NotReadableError" })).toBe("recorder-error");
    expect(classifyVoiceoverError(new Error("boom"))).toBe("unknown");
    for (const kind of [
      "permission-denied",
      "unsupported",
      "no-device",
      "recorder-error",
      "unknown",
    ] as const) {
      expect(voiceoverErrorMessage(kind)).not.toContain("—");
    }
    expect(voiceoverErrorMessage("permission-denied")).toContain("Microphone permission");
  });

  it("formats elapsed time and countdown seconds", () => {
    expect(formatVoiceoverElapsed(0)).toBe("0:00");
    expect(formatVoiceoverElapsed(65_000)).toBe("1:05");
    expect(countdownSeconds(3000)).toBe(3);
    expect(countdownSeconds(2500)).toBe(3);
    expect(countdownSeconds(2000)).toBe(2);
    expect(countdownSeconds(0)).toBe(0);
  });
});

describe("teleprompter", () => {
  it("builds the script in reading order, skipping non-dialogue and blank lines", () => {
    const lines = teleprompterLines(sceneWithScript());
    expect(lines.map((l) => l.lineId)).toEqual(["line-1", "line-2", "line-3"]);
    expect(lines[0]).toMatchObject({ speaker: "Maya", text: "First line.", startMs: 0 });
    expect(lines[2]).toMatchObject({ speaker: "Leo", characterId: "ch-2" });
    expect(teleprompterLines(undefined)).toEqual([]);
  });

  it("lays cues end to end and highlights the active line", () => {
    const cues = teleprompterCues(teleprompterLines(sceneWithScript()));
    expect(cues.map((c) => [c.cueStartMs, c.cueEndMs])).toEqual([
      [0, 3000],
      [3000, 5000],
      [5000, 6500],
    ]);
    expect(activeTeleprompterIndex(cues, 0)).toBe(0);
    expect(activeTeleprompterIndex(cues, 3200)).toBe(1);
    expect(activeTeleprompterIndex(cues, 99999)).toBe(2);
    expect(activeTeleprompterIndex([], 100)).toBe(-1);
  });

  it("re-times lines to a take proportionally, ending exactly at the take end", () => {
    const lines = teleprompterLines(sceneWithScript());
    const patched = retimeLinesForTake(lines, 13_000);
    // Authored durations 3000/2000/1500 (total 6500) scale by 2.
    expect(patched).toEqual([
      { characterId: "ch-1", lineId: "line-1", start: 0, duration: 6000 },
      { characterId: "ch-1", lineId: "line-2", start: 6000, duration: 4000 },
      { characterId: "ch-2", lineId: "line-3", start: 10000, duration: 3000 },
    ]);
    const last = patched[patched.length - 1];
    expect(last.start + last.duration).toBe(13_000);
    expect(retimeLinesForTake([], 5000)).toEqual([]);
  });
});

describe("takes", () => {
  const take = (id: string): VoiceoverTake =>
    makeTake(
      { blob: { size: 10, type: "audio/webm" }, mimeType: "audio/webm", durationMs: 2500.4, name: "Voiceover take" },
      { id, url: `blob:${id}`, name: id, createdAtMs: 123 },
    );

  it("creates, names, adds, and removes takes", () => {
    expect(take("a").durationMs).toBe(2500);
    expect(nextTakeName([])).toBe("Voiceover take 1");
    const list = addTake(addTake([], take("a")), take("b"));
    expect(list.map((t) => t.id)).toEqual(["a", "b"]);
    expect(nextTakeName(list)).toBe("Voiceover take 3");
    expect(removeTake(list, "a").map((t) => t.id)).toEqual(["b"]);
  });

  it("keeps the voiceover flag through audio metadata edits", () => {
    const clip = {
      id: "au-1",
      type: "audio",
      name: "Voiceover take 1",
      position: { x: 0, y: 0, w: 10, h: 10 },
      resource: "blob:take-1",
      extensions: { "x-finch-studio": { voiceover: true, voiceoverTakeId: "take-1" } },
    } as unknown as AudioObject;
    const faded = withAudioClipMetadata(clip, { fadeInMs: 120 });
    expect(getAudioClipMetadata(faded)).toMatchObject({
      fadeInMs: 120,
      voiceover: true,
      voiceoverTakeId: "take-1",
    });
    expect(isVoiceoverObject(faded)).toBe(true);
  });

  it("recognises a chosen voiceover clip by its metadata", () => {
    expect(
      isVoiceoverObject({
        type: "audio",
        extensions: { "x-finch-studio": { voiceover: true } },
      } as never),
    ).toBe(true);
    expect(isVoiceoverObject({ type: "audio" } as never)).toBe(false);
    expect(isVoiceoverObject({ type: "character" } as never)).toBe(false);
  });
});

describe("VoiceoverRecorder", () => {
  it("records through a countdown into a finished clip and stops the tracks", async () => {
    FakeRecorder.constructed = 0;
    let nowMs = 10_000;
    const stopped = { count: 0 };
    const states: string[] = [];
    const recorder = new VoiceoverRecorder({
      mediaDevices: { getUserMedia: async () => micStream(stopped) },
      MediaRecorderCtor: FakeRecorder as never,
      createBlob: (parts, options) => ({
        size: parts.reduce((sum, part) => sum + part.size, 0),
        type: options.type,
      }),
      now: () => nowMs,
      delay: async (ms) => {
        nowMs += ms;
      },
      countdownMs: 3000,
      onStateChange: (state) => states.push(state),
    });

    const started = await recorder.start();
    expect(started).toEqual({ ok: true });
    expect(states).toEqual(["requesting", "countdown", "recording"]);
    expect(recorder.isRecording()).toBe(true);

    FakeRecorder.last?.emitData(400);
    nowMs += 4200;
    expect(recorder.elapsedMs()).toBe(4200);
    const clip = await recorder.stop();
    expect(clip).toMatchObject({ mimeType: "audio/webm", durationMs: 4200 });
    expect(clip?.blob.size).toBe(400);
    expect(recorder.getState()).toBe("done");
    expect(recorder.elapsedMs()).toBe(4200);
    expect(recorder.getLastClip()).toBe(clip);
    expect(stopped.count).toBe(1);
  });

  it("cancel during recording discards the take", async () => {
    let nowMs = 0;
    const stopped = { count: 0 };
    const recorder = new VoiceoverRecorder({
      mediaDevices: { getUserMedia: async () => micStream(stopped) },
      MediaRecorderCtor: FakeRecorder as never,
      now: () => nowMs,
      delay: async () => undefined,
      countdownMs: 0,
    });
    await recorder.start();
    nowMs += 1000;
    recorder.cancel();
    expect(recorder.getState()).toBe("cancelled");
    expect(recorder.getLastClip()).toBeNull();
    expect(stopped.count).toBe(1);
    expect(await recorder.stop()).toBeNull();
  });

  it("cancel during the countdown never creates a recorder", async () => {
    FakeRecorder.constructed = 0;
    const stopped = { count: 0 };
    const recorder = new VoiceoverRecorder({
      mediaDevices: { getUserMedia: async () => micStream(stopped) },
      MediaRecorderCtor: FakeRecorder as never,
      delay: () => new Promise<void>(() => undefined), // countdown hangs until cancelled
      countdownMs: 3000,
    });
    const starting = recorder.start();
    // Let start() reach the countdown state.
    for (let i = 0; i < 20 && recorder.getState() !== "countdown"; i++) {
      await Promise.resolve();
    }
    expect(recorder.getState()).toBe("countdown");
    expect(recorder.countdownRemainingMs(0)).toBeGreaterThan(0);
    recorder.cancel();
    const result = await starting;
    expect(result.ok).toBe(false);
    expect(recorder.getState()).toBe("cancelled");
    expect(FakeRecorder.constructed).toBe(0);
    expect(stopped.count).toBe(1);
  });

  it("refuses a second start while recording", async () => {
    const recorder = new VoiceoverRecorder({
      mediaDevices: { getUserMedia: async () => micStream({ count: 0 }) },
      MediaRecorderCtor: FakeRecorder as never,
      delay: async () => undefined,
      countdownMs: 0,
    });
    await recorder.start();
    const again = await recorder.start();
    expect(again.ok).toBe(false);
    recorder.cancel();
  });

  it("lands in permission-denied with clear copy when the mic is refused", async () => {
    const denied = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    let asked = 0;
    const recorder = new VoiceoverRecorder({
      mediaDevices: {
        getUserMedia: async () => {
          asked += 1;
          throw denied;
        },
      },
      MediaRecorderCtor: FakeRecorder as never,
    });
    const result = await recorder.start();
    expect(result).toEqual({
      ok: false,
      kind: "permission-denied",
      message: voiceoverErrorMessage("permission-denied"),
    });
    expect(recorder.getState()).toBe("permission-denied");
    expect(asked).toBe(1);
  });

  it("refuses unsupported browsers before any capture API is called", async () => {
    let asked = 0;
    const recorder = new VoiceoverRecorder({
      mediaDevices: {
        getUserMedia: async () => {
          asked += 1;
          return micStream({ count: 0 });
        },
      },
      // No MediaRecorderCtor: unsupported.
    });
    const result = await recorder.start();
    expect(result.ok).toBe(false);
    expect(recorder.getState()).toBe("unsupported");
    expect(recorder.errorMessage).toContain("not supported in this browser");
    expect(asked).toBe(0);
  });
});
