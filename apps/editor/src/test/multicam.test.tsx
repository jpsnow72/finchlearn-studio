/**
 * Multicam in the editor store (issue #47): setup with the angle
 * cap, audio sync from stored peaks, angle switching on the shared
 * undo stack, and the visibility rule playback and exports share.
 */
// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import type { VideoObject } from "@finch-studio/core";
import { resolveMulticamAngle } from "@finch-studio/schema";
import { useStudioStore } from "../store.js";
import {
  getMulticam,
  isMulticamObjectVisibleAt,
  runMulticamSync,
} from "../multicam.js";

beforeEach(() => {
  useStudioStore.getState().newProject();
});

function videoClip(id: string, peaks?: number[]): VideoObject {
  return {
    id,
    type: "video",
    name: id,
    resource: `media/${id}.mp4`,
    timing: { start: 0, duration: 5 },
    ...(peaks
      ? { extensions: { "x-finch-studio": { waveformPeaks: peaks } } }
      : {}),
  } as VideoObject;
}

function series(length: number, seed: number): number[] {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length }, () => next());
}

function delayed(source: number[], delay: number): number[] {
  const out = new Array<number>(source.length).fill(0);
  for (let i = 0; i < source.length; i++) {
    const j = i + delay;
    if (j >= 0 && j < out.length) out[j] = source[i];
  }
  return out;
}

function setupThree(peaks?: [number[], number[], number[]]) {
  const store = useStudioStore.getState();
  store.addObject(videoClip("cam-a", peaks?.[0]));
  store.addObject(videoClip("cam-b", peaks?.[1]));
  store.addObject(videoClip("cam-c", peaks?.[2]));
  useStudioStore.getState().setupMulticam(["cam-a", "cam-b", "cam-c"]);
  return useStudioStore.getState().project.scenes[0];
}

describe("setup", () => {
  it("creates a group whose first segment shows the reference angle", () => {
    const scene = setupThree();
    const group = getMulticam(scene);
    expect(group?.angles.map((a) => a.sourceId)).toEqual(["cam-a", "cam-b", "cam-c"]);
    expect(group?.segments).toHaveLength(1);
    expect(resolveMulticamAngle(group!, 2500)?.angle.sourceId).toBe("cam-a");
  });

  it("refuses more than three angles", () => {
    const store = useStudioStore.getState();
    store.addObject(videoClip("cam-a"));
    store.addObject(videoClip("cam-b"));
    store.addObject(videoClip("cam-c"));
    store.addObject(videoClip("cam-d"));
    useStudioStore.getState().setupMulticam(["cam-a", "cam-b", "cam-c", "cam-d"]);
    const scene = useStudioStore.getState().project.scenes[0];
    expect(getMulticam(scene)).toBeUndefined();
  });

  it("ignores non video objects in the selection", () => {
    const store = useStudioStore.getState();
    store.addObject(videoClip("cam-a"));
    useStudioStore.getState().setupMulticam(["cam-a", "missing-object"]);
    const scene = useStudioStore.getState().project.scenes[0];
    expect(getMulticam(scene)).toBeUndefined();
  });
});

describe("angle switching and undo", () => {
  it("switches the angle at a time and undo restores the previous cut", () => {
    setupThree();
    const group = getMulticam(useStudioStore.getState().project.scenes[0]);
    const angleB = group!.angles[1].id;
    useStudioStore.getState().switchMulticamAngle(2000, angleB);
    let scene = useStudioStore.getState().project.scenes[0];
    expect(resolveMulticamAngle(getMulticam(scene)!, 1000)?.angle.sourceId).toBe("cam-a");
    expect(resolveMulticamAngle(getMulticam(scene)!, 3000)?.angle.sourceId).toBe("cam-b");

    useStudioStore.getState().undo();
    scene = useStudioStore.getState().project.scenes[0];
    expect(resolveMulticamAngle(getMulticam(scene)!, 3000)?.angle.sourceId).toBe("cam-a");

    useStudioStore.getState().redo();
    scene = useStudioStore.getState().project.scenes[0];
    expect(resolveMulticamAngle(getMulticam(scene)!, 3000)?.angle.sourceId).toBe("cam-b");
  });

  it("only the resolved angle object is visible at a time", () => {
    const scene = setupThree();
    const group = getMulticam(scene)!;
    useStudioStore.getState().switchMulticamAngle(2000, group.angles[2].id);
    const current = useStudioStore.getState().project.scenes[0];
    const [a, b, c] = current.objects;
    expect(isMulticamObjectVisibleAt(current, a, 1000)).toBe(true);
    expect(isMulticamObjectVisibleAt(current, b, 1000)).toBe(false);
    expect(isMulticamObjectVisibleAt(current, c, 3000)).toBe(true);
    expect(isMulticamObjectVisibleAt(current, a, 3000)).toBe(false);
  });

  it("nudging an angle moves its resolved source time and is undoable", () => {
    const scene = setupThree();
    const group = getMulticam(scene)!;
    useStudioStore.getState().switchMulticamAngle(1000, group.angles[1].id);
    useStudioStore.getState().nudgeMulticamAngle(group.angles[1].id, 120);
    const current = useStudioStore.getState().project.scenes[0];
    expect(resolveMulticamAngle(getMulticam(current)!, 2000)?.sourceMs).toBe(2120);
    useStudioStore.getState().undo();
    const undone = useStudioStore.getState().project.scenes[0];
    expect(resolveMulticamAngle(getMulticam(undone)!, 2000)?.sourceMs).toBe(2000);
  });
});

describe("sync from stored peaks", () => {
  it("recovers a shifted angle offset with high quality", () => {
    const reference = series(50, 42);
    const scene = setupThree([reference, delayed(reference, 3), delayed(reference, -2)]);
    const outcome = runMulticamSync(scene, scene.objects);
    expect(outcome).not.toBeNull();
    const bySource = new Map(
      outcome!.group.angles.map((a) => [a.sourceId, a]),
    );
    // 50 peaks over a 5000 ms clip means 100 ms per bucket.
    expect(bySource.get("cam-b")?.syncOffsetMs).toBe(300);
    expect(bySource.get("cam-b")?.syncQuality).toBe("high");
    expect(bySource.get("cam-c")?.syncOffsetMs).toBe(-200);
    expect(outcome!.unsynced).toEqual([]);
  });

  it("reports angles without peaks honestly instead of inventing offsets", () => {
    const scene = setupThree();
    const outcome = runMulticamSync(scene, scene.objects);
    expect(outcome?.results).toEqual([]);
    expect(outcome?.unsynced.map((u) => u.label)).toEqual(["cam-b", "cam-c"]);
    expect(
      outcome?.group.angles.every((a) => a.syncOffsetMs === 0 && a.syncQuality === undefined),
    ).toBe(true);
  });
});

describe("scene duplication", () => {
  it("remaps angle sources onto the duplicated objects", () => {
    const store = useStudioStore.getState();
    setupThree();
    const originalId = useStudioStore.getState().project.scenes[0].id;
    store.duplicateScene(originalId);
    const duplicate = useStudioStore.getState().project.scenes[1];
    const group = getMulticam(duplicate);
    expect(group).toBeDefined();
    const objectIds = new Set(duplicate.objects.map((o) => o.id));
    expect(group!.angles.every((a) => objectIds.has(a.sourceId))).toBe(true);
    expect(group!.angles.map((a) => a.sourceId)).not.toContain("cam-a");
  });
});
