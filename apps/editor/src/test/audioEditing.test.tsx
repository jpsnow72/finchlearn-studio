// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it } from "vitest";
import type { AudioObject, CourseObject } from "@finch-studio/core";
import { projectTimeline } from "@finch-studio/animation";
import { Timeline } from "../components/Timeline";
import {
  addAudioVolumeKeyframe,
  decibelsToVolume,
  getAudioClipMetadata,
  rippleDeleteAudioRegion,
  volumeToDecibels,
} from "../audioEditing";
import { useStudioStore } from "../store";

const audioClip: AudioObject = {
  id: "audio-clip",
  type: "audio",
  name: "Narration",
  resource: "u/project/narration.wav",
  volume: 0.5,
  timing: { start: 0, duration: 5 },
  extensions: {
    "x-finch-studio": {
      waveformPeaks: [0.2, 0.5, 0.8, 0.3],
      fadeInMs: 200,
      fadeOutMs: 300,
    },
  },
};

function makeAudio(
  id: string,
  start: number,
  duration: number,
  peaks = [0.1, 0.2, 0.3, 0.4],
): AudioObject {
  return {
    id,
    type: "audio",
    resource: `${id}.wav`,
    timing: { start, duration },
    extensions: { "x-finch-studio": { waveformPeaks: peaks, fadeInMs: 100, fadeOutMs: 100 } },
  };
}

describe("audio editing", () => {
  it("converts volume to dB and inserts ordered, bounded keyframes", () => {
    expect(volumeToDecibels(decibelsToVolume(-12))).toBeCloseTo(-12);
    let updated = addAudioVolumeKeyframe(audioClip, 1800, 3, 2000);
    updated = addAudioVolumeKeyframe(updated, -100, -90, 2000);
    updated = addAudioVolumeKeyframe(updated, 1800, 0, 2000);
    expect(getAudioClipMetadata(updated).volumeKeyframes).toEqual([
      { timeMs: 0, decibels: -60 },
      { timeMs: 1800, decibels: 0 },
    ]);
  });

  it("ripple deletes a region, splits overlaps, shifts later audio, and keeps other objects", () => {
    const laterText: CourseObject = {
      id: "title",
      type: "text",
      content: "Still in place",
      timing: { start: 4, duration: 1 },
    };
    const still: CourseObject = { id: "static-title", type: "text", content: "Static" };
    const before = makeAudio("before", 0, 1);
    const overlapping = makeAudio("overlap", 0, 5);
    const later = makeAudio("later", 6, 1);

    const edited = rippleDeleteAudioRegion(
      [before, overlapping, later, laterText, still],
      1000,
      2000,
      8000,
    );
    const audio = edited.filter((object): object is AudioObject => object.type === "audio");
    const split = audio.filter(
      (object) => object.id !== "before" && object.id !== "later",
    );

    expect(audio.find((object) => object.id === "before")?.timing).toEqual({
      start: 0,
      duration: 1,
    });
    expect(split).toHaveLength(2);
    expect(split.map((object) => object.timing?.start)).toEqual([0, 1]);
    expect(split.map((object) => object.timing?.duration)).toEqual([1, 3]);
    expect(getAudioClipMetadata(split[1]).sourceOffsetMs).toBe(2000);
    expect(audio.find((object) => object.id === "later")?.timing?.start).toBe(5);
    expect(edited.find((object) => object.id === laterText.id)?.timing?.start).toBe(3);
    expect(edited.find((object) => object.id === still.id)).toEqual(still);
  });

  it("keeps waveform edits independent across duplicated, reordered scenes and persists derived timing", () => {
    const store = useStudioStore.getState();
    store.newProject();
    const originalId = useStudioStore.getState().currentSceneId;
    store.addObject(audioClip);
    store.addAudioVolumeKeyframe(audioClip.id, 2500, -12);
    store.duplicateScene(originalId);
    const duplicateId = useStudioStore.getState().currentSceneId;
    const duplicateClip = useStudioStore.getState().project.scenes[1].objects[0];
    expect(duplicateClip.id).not.toBe(audioClip.id);
    store.updateAudioMetadata(duplicateClip.id, { fadeInMs: 450 });
    store.rippleDeleteAudioRegion(1000, 2000);
    store.setSceneTransition(duplicateId, "wipe");
    store.renameScene(duplicateId, "Edited narration");
    store.moveSceneTo(duplicateId, 0);

    const project = useStudioStore.getState().project;
    const [edited, original] = project.scenes;
    expect(edited.id).toBe(duplicateId);
    expect(edited.durationMs).toBe(4000);
    expect(edited.transition).toBe("wipe");
    expect(edited.objects.map((object) => object.timing)).toEqual([
      { start: 0, duration: 1 },
      { start: 1, duration: 3 },
    ]);
    expect(getAudioClipMetadata(edited.objects[0] as AudioObject).fadeInMs).toBe(450);
    expect(getAudioClipMetadata(edited.objects[1] as AudioObject)).toMatchObject({
      waveformPeaks: [0.5, 0.8, 0.3],
      sourceOffsetMs: 2000,
      volumeKeyframes: [{ timeMs: 500, decibels: -12 }],
    });
    expect(original.id).toBe(originalId);
    expect(original.durationMs).toBe(5000);
    expect(original.objects).toHaveLength(1);
    expect(getAudioClipMetadata(original.objects[0] as AudioObject)).toMatchObject({
      fadeInMs: 200,
      volumeKeyframes: [{ timeMs: 2500, decibels: -12 }],
    });
    store.moveSceneTo(duplicateId, 1);
    expect(projectTimeline(useStudioStore.getState().project).totalMs).toBe(8600);
    expect(JSON.parse(localStorage.getItem("ocf.video-studio.project.v1")!)).toEqual(
      useStudioStore.getState().project,
    );
    store.selectScene(originalId);
    store.updateAudioMetadata(audioClip.id, { fadeOutMs: 600 });
    expect(useStudioStore.getState().project.scenes[1]).toEqual(edited);
  });

  it("preserves the minimum scene duration after deleting all audio and editing the scene strip", () => {
    const store = useStudioStore.getState();
    store.newProject();
    store.addObject(makeAudio("short", 0, 3));
    const sceneId = useStudioStore.getState().currentSceneId;
    expect(useStudioStore.getState().project.scenes[0].durationMs).toBe(3000);
    store.rippleDeleteAudioRegion(0, 3000);
    store.renameScene(sceneId, "Cleared narration");
    store.duplicateScene(sceneId);
    const { project } = useStudioStore.getState();
    expect(project.scenes.map((scene) => scene.durationMs)).toEqual([500, 500]);
    expect(project.scenes.map((scene) => scene.objects)).toEqual([[], []]);
    expect(projectTimeline(project).totalMs).toBe(1000);
  });

  it("renders ingest peaks and adds a keyframe when the envelope is clicked", () => {
    const container = document.createElement("div");
    document.body.append(container);
    let root: Root;
    act(() => {
      root = createRoot(container);
      useStudioStore.getState().newProject();
      useStudioStore.getState().addObject(audioClip);
      root.render(
        <Timeline
          playing={false}
          setPlaying={() => {}}
          tMs={0}
          setTMs={() => {}}
        />,
      );
    });

    const waveform = container.querySelector(".audio-waveform");
    expect(waveform?.querySelectorAll("line")).toHaveLength(4);
    const fadeInLabel = Array.from(container.querySelectorAll("label")).find((label) =>
      label.textContent?.startsWith("Fade in ms"),
    );
    const fadeInInput = fadeInLabel?.querySelector("input");
    expect(fadeInInput?.value).toBe("200");
    if (fadeInInput) {
      act(() => {
        const setValue = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        setValue?.call(fadeInInput, "450");
        fadeInInput.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    let saved = useStudioStore.getState().project.scenes[0].objects[0] as AudioObject;
    expect(getAudioClipMetadata(saved).fadeInMs).toBe(450);

    const fadeHandle = container.querySelector(
      ".audio-fade-handle.fadeInMs",
    ) as HTMLButtonElement;
    const audioClipNode = fadeHandle.parentElement as HTMLDivElement;
    audioClipNode.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 100, height: 46 } as DOMRect);
    act(() => {
      fadeHandle.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, clientX: 0 }),
      );
      fadeHandle.dispatchEvent(
        new MouseEvent("pointermove", { bubbles: true, clientX: 10 }),
      );
    });
    saved = useStudioStore.getState().project.scenes[0].objects[0] as AudioObject;
    expect(getAudioClipMetadata(saved).fadeInMs).toBe(950);

    const envelope = container.querySelector(".audio-volume-envelope") as SVGSVGElement;
    envelope.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 200, height: 48 } as DOMRect);
    act(() => {
      envelope.dispatchEvent(
        new MouseEvent("click", { bubbles: true, clientX: 100, clientY: 24 }),
      );
    });
    saved = useStudioStore.getState().project.scenes[0].objects[0] as AudioObject;
    expect(getAudioClipMetadata(saved).volumeKeyframes).toEqual([
      { timeMs: 2500, decibels: -27 },
    ]);

    const regionRuler = container.querySelector(
      ".timeline-region-ruler",
    ) as HTMLDivElement;
    regionRuler.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 200, height: 20 } as DOMRect);
    act(() => {
      regionRuler.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, clientX: 40 }),
      );
      regionRuler.dispatchEvent(
        new MouseEvent("pointermove", { bubbles: true, clientX: 80 }),
      );
      regionRuler.dispatchEvent(
        new MouseEvent("pointerup", { bubbles: true, clientX: 80 }),
      );
    });
    const rippleButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Ripple delete region",
    );
    expect(rippleButton?.disabled).toBe(false);
    act(() => rippleButton?.click());
    const clips = useStudioStore
      .getState()
      .project.scenes[0].objects.filter((object) => object.type === "audio") as AudioObject[];
    expect(clips).toHaveLength(2);
    expect(clips.map((clip) => clip.timing?.start)).toEqual([0, 1]);
    expect(useStudioStore.getState().project.scenes[0].durationMs).toBe(4000);
    expect(getAudioClipMetadata(clips[1]).volumeKeyframes).toEqual([
      { timeMs: 500, decibels: -27 },
    ]);

    act(() => root.unmount());
    container.remove();
  });
});
