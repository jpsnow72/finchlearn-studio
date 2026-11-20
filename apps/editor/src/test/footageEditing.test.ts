/**
 * Footage editing (issue #25): metadata round trip, resolver defaults
 * for legacy clips, and store retiming for speed, trim, and freeze.
 */
// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import type { VideoObject } from "@finch-studio/core";
import { footageSourceAt } from "@finch-studio/schema";
import {
  getFootageClipMetadata,
  resolveFootageObject,
  withFootageClipMetadata,
} from "../footageEditing";
import { useStudioStore } from "../store";

const clip = (patch: Partial<VideoObject> = {}): VideoObject => ({
  id: "footage-1",
  type: "video",
  name: "Lesson footage",
  resource: "media/clip.mp4",
  position: { x: 0, y: 0, w: 1280, h: 720 },
  timing: { start: 0, duration: 6 },
  ...patch,
});

beforeEach(() => {
  useStudioStore.getState().newProject();
});

describe("footage metadata", () => {
  it("round trips edits and preserves other studio extension keys", () => {
    const base = clip({
      extensions: {
        "x-finch-studio": { timelineLane: "main", sourceInMs: 500 },
      },
    });
    const updated = withFootageClipMetadata(base, {
      sourceInMs: 1000,
      sourceOutMs: 7000,
      speed: 1.5,
      volume: 0.4,
      freeze: { atSourceMs: 4000, durationMs: 1500 },
      crop: { x: 0.1, y: 0.2, w: 0.6, h: 0.7 },
      pipLayout: "bottom-right",
    });
    expect(getFootageClipMetadata(updated)).toEqual({
      sourceInMs: 1000,
      sourceOutMs: 7000,
      sourceDurationMs: undefined,
      speed: 1.5,
      volume: 0.4,
      freeze: { atSourceMs: 4000, durationMs: 1500 },
      crop: { x: 0.1, y: 0.2, w: 0.6, h: 0.7 },
      pipLayout: "bottom-right",
    });
    expect(updated.extensions?.["x-finch-studio"]?.timelineLane).toBe("main");

    const cleared = withFootageClipMetadata(updated, { freeze: null, crop: null });
    expect(getFootageClipMetadata(cleared).freeze).toBeUndefined();
    expect(getFootageClipMetadata(cleared).crop).toBeUndefined();
    expect(getFootageClipMetadata(cleared).speed).toBe(1.5);
  });

  it("resolves a legacy clip with no metadata exactly as before", () => {
    const resolved = resolveFootageObject(clip());
    expect(resolved.sourceInMs).toBe(0);
    expect(resolved.sourceOutMs).toBe(6000);
    expect(resolved.speed).toBe(1);
    expect(resolved.volume).toBe(1);
    expect(resolved.freeze).toBeNull();
    expect(resolved.crop).toBeNull();
    expect(resolved.pipLayout).toBeNull();
    expect(resolved.timelineDurationMs).toBe(6000);
    expect(footageSourceAt(resolved, 2500).sourceMs).toBe(2500);
  });

  it("derives the out point from the timeline duration at speed", () => {
    const resolved = resolveFootageObject(
      clip({
        timing: { start: 0, duration: 3 },
        extensions: { "x-finch-studio": { sourceInMs: 1000, speed: 2 } },
      }),
    );
    expect(resolved.sourceOutMs).toBe(7000);
    expect(resolved.timelineDurationMs).toBe(3000);
  });
});

describe("footage store actions", () => {
  it("retimes the timeline duration when speed changes, keeping the trim", () => {
    const store = useStudioStore.getState();
    store.addObject(clip());
    store.updateFootageMetadata("footage-1", { speed: 2 });
    let saved = useStudioStore.getState().project.scenes[0].objects[0] as VideoObject;
    expect(saved.timing?.duration).toBe(3);
    expect(getFootageClipMetadata(saved).sourceInMs).toBe(0);
    expect(getFootageClipMetadata(saved).sourceOutMs).toBe(6000);

    store.updateFootageMetadata("footage-1", { speed: 0.5 });
    saved = useStudioStore.getState().project.scenes[0].objects[0] as VideoObject;
    expect(saved.timing?.duration).toBe(12);
    expect(resolveFootageObject(saved).timelineDurationMs).toBe(12000);
  });

  it("applies trim and freeze as one undoable edit each", () => {
    const store = useStudioStore.getState();
    store.addObject(clip());
    store.updateFootageMetadata("footage-1", { sourceInMs: 1000, sourceOutMs: 5000 });
    let saved = useStudioStore.getState().project.scenes[0].objects[0] as VideoObject;
    expect(saved.timing?.duration).toBe(4);

    store.updateFootageMetadata("footage-1", {
      freeze: { atSourceMs: 3000, durationMs: 2000 },
    });
    saved = useStudioStore.getState().project.scenes[0].objects[0] as VideoObject;
    expect(saved.timing?.duration).toBe(6);
    const resolved = resolveFootageObject(saved);
    expect(footageSourceAt(resolved, 2500)).toEqual({
      sourceMs: 3000,
      frozen: true,
      ended: false,
    });

    useStudioStore.getState().undo();
    saved = useStudioStore.getState().project.scenes[0].objects[0] as VideoObject;
    expect(getFootageClipMetadata(saved).freeze).toBeUndefined();
    expect(saved.timing?.duration).toBe(4);
  });

  it("stores volume and crop, clamped through the resolver", () => {
    const store = useStudioStore.getState();
    store.addObject(clip());
    store.updateFootageMetadata("footage-1", {
      volume: 0.25,
      crop: { x: 0.9, y: 0, w: 0.5, h: 0.5 },
    });
    const saved = useStudioStore.getState().project.scenes[0].objects[0] as VideoObject;
    expect(getFootageClipMetadata(saved).volume).toBe(0.25);
    expect(resolveFootageObject(saved).crop).toEqual({ x: 0.5, y: 0, w: 0.5, h: 0.5 });
    expect(saved.timing?.duration).toBe(6);
  });

  it("applies a picture-in-picture layout preset to the object position", () => {
    const store = useStudioStore.getState();
    store.addObject(clip());
    store.updateFootageMetadata("footage-1", { pipLayout: "bottom-right" });
    let saved = useStudioStore.getState().project.scenes[0].objects[0] as VideoObject;
    expect(saved.position).toEqual({ x: 846, y: 466, w: 410, h: 230 });
    expect(getFootageClipMetadata(saved).pipLayout).toBe("bottom-right");

    store.updateFootageMetadata("footage-1", { pipLayout: "full" });
    saved = useStudioStore.getState().project.scenes[0].objects[0] as VideoObject;
    expect(saved.position).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
  });

  it("persists footage edits through localStorage with the project", () => {
    const store = useStudioStore.getState();
    store.addObject(clip());
    store.updateFootageMetadata("footage-1", { speed: 1.25, volume: 0.5 });
    const raw = JSON.parse(
      localStorage.getItem("ocf.video-studio.project.v1") ?? "{}",
    ) as { scenes: { objects: VideoObject[] }[] };
    const saved = raw.scenes[0].objects[0];
    expect(getFootageClipMetadata(saved).speed).toBe(1.25);
    expect(getFootageClipMetadata(saved).volume).toBe(0.5);
    expect(saved.timing?.duration).toBe(4.8);
  });

  it("scales the source in point by speed on a timeline start trim", () => {
    const store = useStudioStore.getState();
    store.addObject(clip());
    store.updateFootageMetadata("footage-1", { speed: 2 });
    store.updateTimelineClip("footage-1", {
      startMs: 500,
      durationMs: 2500,
      trimEdge: "start",
    });
    const saved = useStudioStore.getState().project.scenes[0].objects[0] as VideoObject;
    expect(getFootageClipMetadata(saved).sourceInMs).toBe(1000);
    expect(saved.timing).toEqual({ start: 0.5, duration: 2.5 });
  });

  it("re-trims the source out point on a timeline end trim", () => {
    const store = useStudioStore.getState();
    store.addObject(clip());
    store.updateTimelineClip("footage-1", { durationMs: 4000 });
    const saved = useStudioStore.getState().project.scenes[0].objects[0] as VideoObject;
    expect(getFootageClipMetadata(saved).sourceOutMs).toBe(4000);
    expect(resolveFootageObject(saved).timelineDurationMs).toBe(4000);
  });
});
