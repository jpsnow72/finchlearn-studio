// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  StudioRecorder,
  type MediaRecorderLike,
  type RecordingState,
  type RecordingStreamLike,
} from "@finch-studio/media";
import { RecordPanel } from "../components/RecordPanel.js";
import { useStudioStore } from "../store.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

class FakeRecorder implements MediaRecorderLike {
  static last: FakeRecorder | null = null;
  state = "inactive";
  mimeType = "video/webm";
  private listeners = new Map<string, ((event: { data: { size: number } }) => void)[]>();
  constructor() {
    FakeRecorder.last = this;
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

const screenStream: RecordingStreamLike = {
  getTracks: () => [
    {
      kind: "video",
      stop: () => undefined,
      getSettings: () => ({ width: 1920, height: 1080 }),
    },
    { kind: "audio", stop: () => undefined },
  ],
};

describe("RecordPanel", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useStudioStore.getState().newProject();
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

  it("records the screen with mocked APIs and drops the take into the scene as footage", async () => {
    let nowMs = 1_000;
    const factory = (onStateChange: (state: RecordingState) => void) =>
      new StudioRecorder({
        mediaDevices: { getDisplayMedia: async () => screenStream },
        MediaRecorderCtor: FakeRecorder as never,
        createBlob: (parts, options) => ({
          size: parts.reduce((sum, part) => sum + part.size, 0),
          type: options.type,
        }),
        now: () => nowMs,
        onStateChange,
      });
    act(() => {
      root.render(
        <RecordPanel recorderFactory={factory} createObjectUrl={() => "blob:mock-take"} />,
      );
    });

    await clickButton("Record screen");
    expect(container.textContent).toContain("Recording screen:");
    FakeRecorder.last?.emitData(120);
    nowMs += 3_000;
    await clickButton("Stop recording");

    const objects = useStudioStore.getState().project.scenes[0].objects;
    expect(objects).toHaveLength(1);
    expect(objects[0].type).toBe("video");
    expect(objects[0].name).toBe("Screen recording");
    expect((objects[0] as { resource?: string }).resource).toBe("blob:mock-take");
    expect(objects[0].timing).toEqual({ start: 0, duration: 3 });
    expect(container.textContent).toContain("Added \"Screen recording\" to the scene");
  });

  it("cancelling a recording adds nothing to the scene", async () => {
    const factory = (onStateChange: (state: RecordingState) => void) =>
      new StudioRecorder({
        mediaDevices: { getDisplayMedia: async () => screenStream },
        MediaRecorderCtor: FakeRecorder as never,
        createBlob: (parts, options) => ({
          size: parts.reduce((sum, part) => sum + part.size, 0),
          type: options.type,
        }),
        onStateChange,
      });
    act(() => {
      root.render(
        <RecordPanel recorderFactory={factory} createObjectUrl={() => "blob:mock-take"} />,
      );
    });
    await clickButton("Record screen");
    await clickButton("Cancel");
    expect(container.textContent).toContain("Recording cancelled");
    expect(useStudioStore.getState().project.scenes[0].objects).toHaveLength(0);
  });

  it("shows clear permission denied copy and adds nothing", async () => {
    const denied = Object.assign(new Error("denied"), { name: "NotAllowedError" });
    const factory = (onStateChange: (state: RecordingState) => void) =>
      new StudioRecorder({
        mediaDevices: {
          getDisplayMedia: async () => {
            throw denied;
          },
        },
        MediaRecorderCtor: FakeRecorder as never,
        onStateChange,
      });
    act(() => {
      root.render(
        <RecordPanel recorderFactory={factory} createObjectUrl={() => "blob:mock-take"} />,
      );
    });
    await clickButton("Record screen");
    expect(container.textContent).toContain("Permission was denied");
    expect(useStudioStore.getState().project.scenes[0].objects).toHaveLength(0);
  });

  it("shows unsupported copy instead of a record button when capture APIs are missing", () => {
    const factory = (onStateChange: (state: RecordingState) => void) =>
      new StudioRecorder({ onStateChange });
    act(() => {
      root.render(<RecordPanel recorderFactory={factory} />);
    });
    expect(container.textContent).toContain("not supported in this browser");
    const labels = [...container.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels.some((label) => label?.startsWith("Record "))).toBe(false);
  });
});
