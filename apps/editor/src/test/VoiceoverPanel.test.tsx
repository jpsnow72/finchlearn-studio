// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AudioObject } from "@finch-studio/core";
import { VoiceoverPanel } from "../components/VoiceoverPanel.js";
import { getAudioClipMetadata } from "../audioEditing.js";
import {
  VoiceoverRecorder,
  type VoiceoverDataEventLike,
  type VoiceoverMediaRecorderLike,
  type VoiceoverState,
  type VoiceoverStreamLike,
} from "../voiceover.js";
import { isVoiceoverClip, makeStudioCharacter, useStudioStore } from "../store.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

class FakeRecorder implements VoiceoverMediaRecorderLike {
  static last: FakeRecorder | null = null;
  state = "inactive";
  mimeType = "audio/webm";
  private listeners = new Map<string, ((event: VoiceoverDataEventLike) => void)[]>();
  constructor() {
    FakeRecorder.last = this;
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

const micStream: VoiceoverStreamLike = {
  getTracks: () => [{ kind: "audio", stop: () => undefined }],
};

describe("VoiceoverPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useStudioStore.getState().newProject();
    const character = makeStudioCharacter("businesswoman");
    useStudioStore.getState().addObject(character);
    useStudioStore.getState().addSpeech(character.id, {
      id: "line-1",
      text: "Welcome to the course.",
      start: 0,
      duration: 2000,
    });
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  const clickButton = async (label: string) => {
    const button = [...container.querySelectorAll("button")].find((item) =>
      item.textContent?.includes(label),
    );
    if (!button) throw new Error(`Missing ${label} button`);
    await act(async () => {
      button.click();
    });
  };

  const factoryWithClock = (now: () => number) =>
    (onStateChange: (state: VoiceoverState) => void) =>
      new VoiceoverRecorder({
        mediaDevices: { getUserMedia: async () => micStream },
        MediaRecorderCtor: FakeRecorder as never,
        createBlob: (parts, options) => ({
          size: parts.reduce((sum, part) => sum + part.size, 0),
          type: options.type,
        }),
        now,
        delay: async () => undefined,
        countdownMs: 0,
        onStateChange,
      });

  it("shows the scene script as a teleprompter", () => {
    act(() => {
      root.render(
        <VoiceoverPanel
          recorderFactory={factoryWithClock(() => 0)}
          createObjectUrl={() => "blob:take"}
        />,
      );
    });
    expect(container.textContent).toContain("Welcome to the course.");
    expect(container.textContent).toContain("Record voiceover");
  });

  it("records a take, auditions it, and the chosen take sets the scene duration", async () => {
    let nowMs = 1_000;
    act(() => {
      root.render(
        <VoiceoverPanel
          recorderFactory={factoryWithClock(() => nowMs)}
          createObjectUrl={() => "blob:take-1"}
        />,
      );
    });

    await clickButton("Record voiceover");
    expect(container.textContent).toContain("Recording:");
    FakeRecorder.last?.emitData(200);
    nowMs += 3_000;
    await clickButton("Stop recording");

    expect(container.textContent).toContain("Voiceover take 1");
    expect(container.querySelector("audio")?.getAttribute("src")).toBe("blob:take-1");
    // Nothing has landed yet: choosing the take is a separate step.
    let scene = useStudioStore.getState().project.scenes[0];
    expect(scene.objects.some((o) => isVoiceoverClip(o))).toBe(false);

    await clickButton("Use this take");
    scene = useStudioStore.getState().project.scenes[0];
    const clip = scene.objects.find((o) => isVoiceoverClip(o)) as AudioObject;
    expect(clip).toBeDefined();
    expect(clip.resource).toBe("blob:take-1");
    expect(clip.timing).toEqual({ start: 0, duration: 3 });
    expect(getAudioClipMetadata(clip).voiceover).toBe(true);
    // The script line is re-timed to the take and the scene follows it.
    expect(scene.durationMs).toBe(3000);
    const character = scene.objects.find((o) => o.type === "character");
    expect(
      character?.type === "character" ? character.speech?.[0].duration : undefined,
    ).toBe(3000);
    expect(container.textContent).toContain("scene voiceover");
  });

  it("cancelling a recording keeps no take and adds nothing", async () => {
    act(() => {
      root.render(
        <VoiceoverPanel
          recorderFactory={factoryWithClock(() => 0)}
          createObjectUrl={() => "blob:take"}
        />,
      );
    });
    await clickButton("Record voiceover");
    await clickButton("Cancel");
    expect(container.textContent).toContain("Recording cancelled");
    expect(container.textContent).not.toContain("Use this take");
    const scene = useStudioStore.getState().project.scenes[0];
    expect(scene.objects.some((o) => o.type === "audio")).toBe(false);
  });

  it("shows microphone permission denied copy and adds nothing", async () => {
    const denied = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    const factory = (onStateChange: (state: VoiceoverState) => void) =>
      new VoiceoverRecorder({
        mediaDevices: {
          getUserMedia: async () => {
            throw denied;
          },
        },
        MediaRecorderCtor: FakeRecorder as never,
        onStateChange,
      });
    act(() => {
      root.render(<VoiceoverPanel recorderFactory={factory} createObjectUrl={() => "blob:x"} />);
    });
    await clickButton("Record voiceover");
    expect(container.textContent).toContain("Microphone permission was denied");
    const scene = useStudioStore.getState().project.scenes[0];
    expect(scene.objects.some((o) => o.type === "audio")).toBe(false);
  });

  it("shows unsupported copy instead of a record button when capture APIs are missing", () => {
    const factory = (onStateChange: (state: VoiceoverState) => void) =>
      new VoiceoverRecorder({ onStateChange });
    act(() => {
      root.render(<VoiceoverPanel recorderFactory={factory} />);
    });
    expect(container.textContent).toContain("not supported in this browser");
    const labels = [...container.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels.some((label) => label?.includes("Record voiceover"))).toBe(false);
  });
});
