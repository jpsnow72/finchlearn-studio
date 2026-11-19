// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it } from "vitest";
import type { AudioObject, CourseObject } from "@finch-studio/core";
import { cleanVoiceChain } from "@finch-studio/audio";
import {
  getAudioClipMetadata,
  getCleanVoiceSettings,
  withAudioClipMetadata,
  withCleanVoiceOnAllAudioClips,
} from "../audioEditing";
import { AudioPanel } from "../components/AudioPanel";
import { useStudioStore } from "../store";

const clip: AudioObject = {
  id: "voice-clip",
  type: "audio",
  name: "Voiceover take",
  resource: "u/project/take.wav",
  timing: { start: 0, duration: 5 },
};

describe("clean voice metadata", () => {
  it("defaults OFF for a clip that never set it, so the chain is identity", () => {
    const settings = getCleanVoiceSettings(clip);
    expect(settings).toEqual({ enabled: false, intensity: 0.5 });
    expect(cleanVoiceChain(settings)).toEqual([]);
  });

  it("round trips through the extension and through JSON save and load", () => {
    const updated = withAudioClipMetadata(clip, {
      cleanVoice: { enabled: true, intensity: 0.75 },
    });
    expect(getCleanVoiceSettings(updated)).toEqual({ enabled: true, intensity: 0.75 });
    const reloaded = JSON.parse(JSON.stringify(updated)) as AudioObject;
    expect(getCleanVoiceSettings(reloaded)).toEqual({ enabled: true, intensity: 0.75 });
    expect(getAudioClipMetadata(reloaded).cleanVoice).toEqual({
      enabled: true,
      intensity: 0.75,
    });
  });

  it("normalizes stored junk to OFF and clamps intensity", () => {
    const junk = {
      ...clip,
      extensions: {
        "x-finch-studio": { cleanVoice: { enabled: "yes", intensity: 42 } },
      },
    } as AudioObject;
    expect(getCleanVoiceSettings(junk)).toEqual({ enabled: false, intensity: 1 });
    const written = withAudioClipMetadata(clip, {
      cleanVoice: { enabled: true, intensity: -3 },
    });
    expect(getCleanVoiceSettings(written)).toEqual({ enabled: true, intensity: 0 });
  });

  it("turning the toggle off keeps the intensity but removes all processing", () => {
    const on = withAudioClipMetadata(clip, {
      cleanVoice: { enabled: true, intensity: 0.8 },
    });
    const off = withAudioClipMetadata(on, {
      cleanVoice: { ...getCleanVoiceSettings(on), enabled: false },
    });
    expect(getCleanVoiceSettings(off)).toEqual({ enabled: false, intensity: 0.8 });
    expect(cleanVoiceChain(getCleanVoiceSettings(off))).toEqual([]);
  });

  it("applies to all audio clips in a scene and leaves other objects alone", () => {
    const text: CourseObject = { id: "t", type: "text", content: "Title" };
    const other: AudioObject = { ...clip, id: "music-clip", name: "Bed" };
    const input: CourseObject[] = [clip, text, other];
    const next = withCleanVoiceOnAllAudioClips(input, { enabled: true, intensity: 0.4 });
    expect(getCleanVoiceSettings(next[0] as AudioObject)).toEqual({
      enabled: true,
      intensity: 0.4,
    });
    expect(next[1]).toBe(text);
    expect(getCleanVoiceSettings(next[2] as AudioObject)).toEqual({
      enabled: true,
      intensity: 0.4,
    });
    expect(getAudioClipMetadata(clip).cleanVoice).toBeUndefined();
  });
});

describe("clean voice in the store and panel", () => {
  it("persists through the store and the saved project JSON", () => {
    const store = useStudioStore.getState();
    store.newProject();
    store.addObject(clip);
    store.updateAudioMetadata(clip.id, {
      cleanVoice: { enabled: true, intensity: 0.6 },
    });
    const saved = useStudioStore.getState().project.scenes[0].objects[0] as AudioObject;
    expect(getCleanVoiceSettings(saved)).toEqual({ enabled: true, intensity: 0.6 });
    expect(JSON.parse(localStorage.getItem("ocf.video-studio.project.v1")!)).toEqual(
      useStudioStore.getState().project,
    );
    store.setCleanVoiceOnAllClips({ enabled: false, intensity: 0.6 });
    const afterAll = useStudioStore.getState().project.scenes[0].objects[0] as AudioObject;
    expect(getCleanVoiceSettings(afterAll)).toEqual({ enabled: false, intensity: 0.6 });
  });

  it("panel toggle, intensity, and A/B compare state update the clip", () => {
    const container = document.createElement("div");
    document.body.append(container);
    let root: Root;
    act(() => {
      root = createRoot(container);
      useStudioStore.getState().newProject();
      useStudioStore.getState().addObject(clip);
      root.render(<AudioPanel tMs={0} />);
    });

    const toggle = container.querySelector(
      'input[aria-label="Clean Voice for Voiceover take"]',
    ) as HTMLInputElement;
    expect(toggle).not.toBeNull();
    expect(toggle.checked).toBe(false);
    act(() => toggle.click());
    let saved = useStudioStore.getState().project.scenes[0].objects[0] as AudioObject;
    expect(getCleanVoiceSettings(saved).enabled).toBe(true);

    const slider = container.querySelector(
      'input[aria-label="Clean Voice intensity"]',
    ) as HTMLInputElement;
    expect(slider.disabled).toBe(false);
    act(() => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setValue?.call(slider, "80");
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    saved = useStudioStore.getState().project.scenes[0].objects[0] as AudioObject;
    expect(getCleanVoiceSettings(saved).intensity).toBeCloseTo(0.8);

    const buttons = Array.from(container.querySelectorAll("button"));
    const original = buttons.find((b) => b.textContent === "A: Original");
    const cleaned = buttons.find((b) => b.textContent === "B: Cleaned");
    expect(original?.getAttribute("aria-pressed")).toBe("false");
    expect(cleaned?.getAttribute("aria-pressed")).toBe("true");
    act(() => original?.click());
    expect(original?.getAttribute("aria-pressed")).toBe("true");
    expect(cleaned?.getAttribute("aria-pressed")).toBe("false");
    const play = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Play original",
    );
    expect(play).toBeDefined();
    act(() => cleaned?.click());
    expect(cleaned?.getAttribute("aria-pressed")).toBe("true");

    act(() => root.unmount());
    container.remove();
  });
});
