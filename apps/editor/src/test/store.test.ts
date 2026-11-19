/**
 * Video studio store: scenes, objects, character edits, persistence.
 */
// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import type { VideoObject } from "@finch-studio/core";
import {
  TIMELINE_LANES,
  snapTimelineTime,
  useStudioStore,
  makeStudioCharacter,
} from "../store.js";

beforeEach(() => {
  // Fresh project per test; localStorage is stubbed by jsdom/node env.
  useStudioStore.getState().newProject();
});

describe("scenes", () => {
  it("starts with one scene", () => {
    const { project } = useStudioStore.getState();
    expect(project.scenes).toHaveLength(1);
  });

  it("adds and removes scenes", () => {
    const s = useStudioStore.getState();
    s.addScene();
    expect(useStudioStore.getState().project.scenes).toHaveLength(2);
    const second = useStudioStore.getState().project.scenes[1];
    s.removeScene(second.id);
    expect(useStudioStore.getState().project.scenes).toHaveLength(1);
  });

  it("won't remove the last scene", () => {
    const s = useStudioStore.getState();
    const only = s.project.scenes[0];
    s.removeScene(only.id);
    expect(useStudioStore.getState().project.scenes).toHaveLength(1);
  });

  it("reorders scenes", () => {
    const s = useStudioStore.getState();
    s.addScene();
    const ids = () => useStudioStore.getState().project.scenes.map((x) => x.id);
    const before = ids();
    s.moveScene(before[0], 1);
    const after = ids();
    expect(after[0]).toBe(before[1]);
    expect(after[1]).toBe(before[0]);
  });

  it("renames and resizes a scene", () => {
    const s = useStudioStore.getState();
    const id = s.project.scenes[0].id;
    s.renameScene(id, "Intro");
    s.setSceneDuration(id, 8000);
    const scene = useStudioStore.getState().project.scenes[0];
    expect(scene.name).toBe("Intro");
    expect(scene.durationMs).toBe(8000);
  });
});

describe("objects", () => {
  it("adds a character and selects it", () => {
    const s = useStudioStore.getState();
    const char = makeStudioCharacter("businessman");
    s.addObject(char);
    const st = useStudioStore.getState();
    expect(st.project.scenes[0].objects).toHaveLength(1);
    expect(st.selectedObjectId).toBe(char.id);
  });

  it("edits character animation, facing, colors", () => {
    const s = useStudioStore.getState();
    const char = makeStudioCharacter("student");
    s.addObject(char);
    s.setCharAnimation(char.id, "wave");
    s.setCharFacing(char.id, "left");
    s.setCharColors(char.id, { shirt: "#ff0000" });
    const obj = useStudioStore.getState().project.scenes[0].objects[0];
    expect(obj.type).toBe("character");
    if (obj.type === "character") {
      expect(obj.characterAnimation).toBe("wave");
      expect(obj.facing).toBe("left");
      expect(obj.colors?.shirt).toBe("#ff0000");
    }
  });

  it("manages waypoints", () => {
    const s = useStudioStore.getState();
    const char = makeStudioCharacter("professor");
    s.addObject(char);
    s.addWaypoint(char.id, { x: 100, y: 200, t: 0 });
    s.addWaypoint(char.id, { x: 300, y: 200, t: 2000, curve: "smooth", speed: 1.5 });
    let obj = useStudioStore.getState().project.scenes[0].objects[0];
    expect(obj.type === "character" && obj.path).toHaveLength(2);
    s.updateWaypoint(char.id, 1, { x: 350 });
    s.removeWaypoint(char.id, 0);
    obj = useStudioStore.getState().project.scenes[0].objects[0];
    if (obj.type === "character") {
      expect(obj.path).toHaveLength(1);
      expect(obj.path?.[0].x).toBe(350);
      expect(obj.path?.[0].curve).toBe("smooth");
    }
  });

  it("manages speech lines", () => {
    const s = useStudioStore.getState();
    const char = makeStudioCharacter("casualWoman");
    s.addObject(char);
    s.addSpeech(char.id, { id: "l1", text: "Hi!", start: 0, duration: 2000 });
    let obj = useStudioStore.getState().project.scenes[0].objects[0];
    expect(obj.type === "character" && obj.speech).toHaveLength(1);
    s.updateSpeech(char.id, "l1", { text: "Hello there!" });
    s.removeSpeech(char.id, "l1");
    obj = useStudioStore.getState().project.scenes[0].objects[0];
    expect(obj.type === "character" && obj.speech === undefined).toBe(true);
  });

  it("removes objects and clears selection", () => {
    const s = useStudioStore.getState();
    const char = makeStudioCharacter("businesswoman");
    s.addObject(char);
    s.removeObject(char.id);
    const st = useStudioStore.getState();
    expect(st.project.scenes[0].objects).toHaveLength(0);
    expect(st.selectedObjectId).toBeNull();
  });
});

describe("timeline", () => {
  const videoClip = (id: string, start: number, duration: number): VideoObject => ({
    id,
    type: "video",
    resource: "media/clip.mp4",
    timing: { start, duration },
  });

  it("uses exactly four fixed lanes and snaps to nearby edges", () => {
    expect(TIMELINE_LANES).toEqual(["main", "overlay", "voice", "music"]);
    expect(snapTimelineTime(994, [0, 1000, 2000], 10)).toBe(1000);
    expect(snapTimelineTime(980, [0, 1000, 2000], 10)).toBe(980);
  });

  it("trims clips within the selected scene and stores their lane", () => {
    const store = useStudioStore.getState();
    store.addObject(videoClip("trim-me", 0, 4));
    store.updateTimelineClip("trim-me", {
      startMs: 500,
      durationMs: 1000,
      lane: "voice",
      trimEdge: "start",
    });
    const clip = useStudioStore.getState().project.scenes[0].objects[0];
    expect(clip.timing).toEqual({ start: 0.5, duration: 1 });
    expect(clip.extensions?.["x-finch-studio"]?.timelineLane).toBe("voice");
    expect(clip.extensions?.["x-finch-studio"]?.sourceInMs).toBe(500);
  });

  it("caps clips at the scene end and records a drag as one undo step", () => {
    const store = useStudioStore.getState();
    store.addObject(videoClip("dragged", 0, 2));
    const pastCount = useStudioStore.getState().pastProjects.length;
    store.beginTimelineEdit();
    store.updateTimelineClip("dragged", { startMs: 1000, durationMs: 1000 }, false);
    store.updateTimelineClip("dragged", { startMs: 2000, durationMs: 5000 }, false);
    store.endTimelineEdit();

    expect(useStudioStore.getState().project.scenes[0].objects[0].timing).toEqual({
      start: 2,
      duration: 3,
    });
    expect(useStudioStore.getState().pastProjects).toHaveLength(pastCount + 1);
    useStudioStore.getState().undo();
    expect(useStudioStore.getState().project.scenes[0].objects[0].timing).toEqual({
      start: 0,
      duration: 2,
    });
  });

  it("splits a clip and shares undo and redo with scene edits", () => {
    const store = useStudioStore.getState();
    const sceneId = store.project.scenes[0].id;
    store.renameScene(sceneId, "Renamed");
    store.addObject(videoClip("split-me", 0, 2));
    store.splitTimelineClip("split-me", 1000);
    let scene = useStudioStore.getState().project.scenes[0];
    expect(scene.objects).toHaveLength(2);
    expect(scene.objects.map((clip) => clip.timing?.duration)).toEqual([1, 1]);
    expect(scene.objects[1].extensions?.["x-finch-studio"]?.sourceInMs).toBe(1000);

    useStudioStore.getState().undo();
    expect(useStudioStore.getState().project.scenes[0].objects).toHaveLength(1);
    useStudioStore.getState().undo();
    expect(useStudioStore.getState().project.scenes[0].name).toBe("Renamed");
    useStudioStore.getState().undo();
    scene = useStudioStore.getState().project.scenes[0];
    expect(scene.name).toBe("Scene 1");
    expect(scene.objects).toHaveLength(0);
    useStudioStore.getState().redo();
    expect(useStudioStore.getState().project.scenes[0].name).toBe("Renamed");
  });

  it("ripple deletes a gap and shifts following clips and scene duration", () => {
    const store = useStudioStore.getState();
    store.addObject(videoClip("before-gap", 0, 1));
    store.addObject(videoClip("after-gap", 2, 1));
    store.rippleDeleteGapAt(1500);
    const scene = useStudioStore.getState().project.scenes[0];
    expect(scene.objects.find((clip) => clip.id === "after-gap")?.timing?.start).toBe(1);
    expect(scene.durationMs).toBe(4000);
  });
});

describe("persistence", () => {
  it("round-trips the project through localStorage", () => {
    const s = useStudioStore.getState();
    s.setProjectName("Persist me");
    const raw = localStorage.getItem("ocf.video-studio.project.v1");
    expect(raw).toContain("Persist me");
  });
});
