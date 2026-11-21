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
  isVoiceoverClip,
  makeStudioCharacter,
  makeStudioShape,
  makeStudioVideo,
  timelineLaneForObject,
  makeStudioVoiceover,
  readProjectLibrary,
  libraryProject,
} from "../store.js";
import { getCaptionCues, getCaptionStyle } from "../captions.js";
import { formatCaptions } from "../exportPresets.js";

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

  it("renames a scene", () => {
    const s = useStudioStore.getState();
    const id = s.project.scenes[0].id;
    s.renameScene(id, "Intro");
    const scene = useStudioStore.getState().project.scenes[0];
    expect(scene.name).toBe("Intro");
    expect(scene.durationMs).toBe(5000);
  });

  it("derives scene duration from the longest timed content", () => {
    const s = useStudioStore.getState();
    const character = makeStudioCharacter("student");
    s.addObject(character);
    s.addSpeech(character.id, {
      id: "line-1",
      text: "Hello",
      start: 6000,
      duration: 2500,
    });
    s.addWaypoint(character.id, { x: 400, y: 200, t: 12000 });
    expect(useStudioStore.getState().project.scenes[0].durationMs).toBe(12000);

    s.removeWaypoint(character.id, 0);
    expect(useStudioStore.getState().project.scenes[0].durationMs).toBe(8500);
  });

  it("duplicates a scene with independent object and speech ids", () => {
    const s = useStudioStore.getState();
    const originalId = s.project.scenes[0].id;
    const character = makeStudioCharacter("student");
    s.addObject(character);
    s.addSpeech(character.id, { id: "line-1", text: "Hello", start: 0, duration: 1000 });

    s.duplicateScene(originalId);
    const state = useStudioStore.getState();
    const duplicate = state.project.scenes[1];
    expect(state.currentSceneId).toBe(duplicate.id);
    expect(duplicate.name).toBe("Scene 1 copy");
    expect(duplicate.id).not.toBe(originalId);
    expect(duplicate.objects[0].id).not.toBe(character.id);
    if (duplicate.objects[0].type === "character") {
      expect(duplicate.objects[0].speech?.[0].id).not.toBe("line-1");
    }

    state.setCharColors(duplicate.objects[0].id, { shirt: "#ff0000" });
    const original = useStudioStore.getState().project.scenes[0].objects[0];
    expect(original.type === "character" && original.colors?.shirt).toBeUndefined();
  });

  it("reorders to a drop target and applies the seam transition", () => {
    const s = useStudioStore.getState();
    s.addScene();
    const ids = useStudioStore.getState().project.scenes.map((scene) => scene.id);
    s.addScene();
    const newSceneId = useStudioStore.getState().project.scenes[2].id;
    s.moveSceneTo(ids[0], 2);
    s.setSceneTransition(ids[0], "wipe");
    const project = useStudioStore.getState().project;
    expect(project.scenes.map((scene) => scene.id)).toEqual([
      ids[1],
      newSceneId,
      ids[0],
    ]);
    expect(project.scenes[2].transition).toBe("wipe");
    expect(project.scenes[2].durationMs).toBe(5000);
  });

  it("stores scene effects", () => {
    const s = useStudioStore.getState();
    const id = s.project.scenes[0].id;
    const effects = [{ name: "fadeIn" as const, start: 150, duration: 700 }];
    s.setScenePresets(id, effects);
    expect(useStudioStore.getState().project.scenes[0].animations?.presets).toEqual(effects);
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
    expect(st.selectedObjectIds).toEqual([char.id]);
  });

  it("saves selected objects for insertion into another project with motion and effects intact", () => {
    const store = useStudioStore.getState();
    const character = makeStudioCharacter("student");
    character.animations = {
      presets: [{ name: "fadeIn", start: 150, duration: 700 }],
      timeline: [{ property: "x", from: 0, to: 80, start: 0, duration: 1200 }],
    };
    character.path = [{ x: 120, y: 240, t: 0 }, { x: 360, y: 240, t: 1800 }];
    const shape = makeStudioShape();
    shape.animations = { presets: [{ name: "zoomIn", start: 250, duration: 500 }] };
    store.addObject(character);
    store.addObject(shape);
    useStudioStore.getState().selectObject(character.id);
    useStudioStore.getState().selectObject(shape.id, true);

    const sourceObjects = useStudioStore.getState().project.scenes[0].objects
      .filter((object) => useStudioStore.getState().selectedObjectIds.includes(object.id));
    expect(useStudioStore.getState().selectedObjectIds).toEqual([character.id, shape.id]);

    useStudioStore.getState().newProject();
    const initialObjectCount = useStudioStore.getState().project.scenes[0].objects.length;
    useStudioStore.getState().insertObjectGroup(sourceObjects);

    const inserted = useStudioStore.getState().project.scenes[0].objects.slice(initialObjectCount);
    expect(inserted).toHaveLength(2);
    expect(inserted.map((object) => object.id)).not.toContain(character.id);
    expect(inserted.map((object) => object.id)).not.toContain(shape.id);
    expect(inserted[0].animations).toEqual(character.animations);
    expect(inserted[0].type === "character" && inserted[0].path).toEqual(character.path);
    expect(inserted[1].animations).toEqual(shape.animations);
    expect(useStudioStore.getState().selectedObjectIds).toEqual(inserted.map((object) => object.id));
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

  it("stores effects on the selected object without losing other animation data", () => {
    const s = useStudioStore.getState();
    const char = makeStudioCharacter("student");
    s.addObject(char);
    s.updateObject(char.id, {
      animations: { timeline: [{ property: "x", from: 0, to: 10 }] },
    });
    const effects = [{ name: "wipeInLeft" as const, start: 100, duration: 500 }];
    useStudioStore.getState().setObjectPresets(char.id, effects);
    const object = useStudioStore.getState().project.scenes[0].objects[0];
    expect(object.animations?.presets).toEqual(effects);
    expect(object.animations?.timeline).toHaveLength(1);
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

describe("captions", () => {
  it("keeps caption edits separate from narration and persists the global style", () => {
    const store = useStudioStore.getState();
    const character = makeStudioCharacter("student");
    store.addObject(character);
    store.addSpeech(character.id, {
      id: "caption-line",
      text: "Spoken words",
      start: 500,
      duration: 1200,
    });
    const sceneId = useStudioStore.getState().project.scenes[0].id;

    useStudioStore.getState().updateCaption(sceneId, "caption-line", {
      text: "Edited captions",
      startMs: 700,
      durationMs: 900,
    });
    useStudioStore.getState().setCaptionStyle({
      font: "monospace",
      size: 38,
      position: "top",
    });

    const project = useStudioStore.getState().project;
    const updatedCharacter = project.scenes[0].objects.find(
      (object) => object.id === character.id,
    );
    expect(updatedCharacter?.type === "character" && updatedCharacter.speech?.[0].text)
      .toBe("Spoken words");
    expect(getCaptionCues(project)).toMatchObject([
      { text: "Edited captions", startMs: 700, durationMs: 900 },
    ]);
    expect(getCaptionStyle(project)).toEqual({
      font: "monospace",
      size: 38,
      position: "top",
    });
    expect(localStorage.getItem("ocf.video-studio.project.v1")).toContain("Edited captions");
  });

  it("keeps caption timing within the scene so exports retain the cue", () => {
    const store = useStudioStore.getState();
    const character = makeStudioCharacter("student");
    store.addObject(character);
    store.addSpeech(character.id, {
      id: "caption-line",
      text: "Spoken words",
      start: 500,
      duration: 1200,
    });
    const sceneId = useStudioStore.getState().project.scenes[0].id;

    useStudioStore.getState().updateCaption(sceneId, "caption-line", {
      startMs: 6000,
      durationMs: 2000,
    });

    const project = useStudioStore.getState().project;
    const scene = project.scenes[0];
    const cue = getCaptionCues(project)[0];
    expect(cue.startMs + cue.durationMs).toBe(scene.durationMs);
    expect(cue.durationMs).toBe(100);
    expect(scene.durationMs).toBe(1700);
    expect(formatCaptions(project, "srt")).toContain(
      "00:00:01,600 --> 00:00:01,700\nSpoken words",
    );
  });

  it("copies caption edits when a scene is duplicated", () => {
    const store = useStudioStore.getState();
    const sourceSceneId = store.project.scenes[0].id;
    const character = makeStudioCharacter("student");
    store.addObject(character);
    store.addSpeech(character.id, {
      id: "caption-line",
      text: "Spoken words",
      start: 500,
      duration: 1200,
    });
    useStudioStore.getState().updateCaption(sourceSceneId, "caption-line", {
      text: "Edited captions",
      startMs: 700,
      durationMs: 1500,
    });

    useStudioStore.getState().duplicateScene(sourceSceneId);

    const cues = getCaptionCues(useStudioStore.getState().project);
    expect(cues).toHaveLength(2);
    expect(cues.map((cue) => cue.text)).toEqual(["Edited captions", "Edited captions"]);
    expect(cues.map((cue) => cue.sceneId)).toEqual(
      useStudioStore.getState().project.scenes.map((scene) => scene.id),
    );
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
      start: 1.9,
      duration: 0.1,
    });
    expect(useStudioStore.getState().pastProjects).toHaveLength(pastCount + 1);
    useStudioStore.getState().undo();
    expect(useStudioStore.getState().project.scenes[0].objects[0].timing).toEqual({
      start: 0,
      duration: 2,
    });
  });

  it("keeps the original scene bound while trimming its longest clip", () => {
    const store = useStudioStore.getState();
    store.addObject(videoClip("longest", 0, 8));
    store.beginTimelineEdit();
    store.updateTimelineClip("longest", { durationMs: 6000 }, false);
    expect(useStudioStore.getState().project.scenes[0].durationMs).toBe(6000);

    store.updateTimelineClip("longest", { durationMs: 8000 }, false);
    store.endTimelineEdit();

    const scene = useStudioStore.getState().project.scenes[0];
    expect(scene.durationMs).toBe(8000);
    expect(scene.objects[0].timing?.duration).toBe(8);
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

  it("ripple deletes a gap and shifts following clips within the scene minimum", () => {
    const store = useStudioStore.getState();
    store.addObject(videoClip("before-gap", 0, 1));
    store.addObject(videoClip("after-gap", 2, 1));
    store.rippleDeleteGapAt(1500);
    const scene = useStudioStore.getState().project.scenes[0];
    expect(scene.objects.find((clip) => clip.id === "after-gap")?.timing?.start).toBe(1);
    expect(scene.durationMs).toBe(2000);
  });
});

describe("footage factory", () => {
  it("makes a normal video object whose timeline duration is the clip length", () => {
    const obj = makeStudioVideo("blob:take-1", "Screen recording", 12_000);
    expect(obj.type).toBe("video");
    expect(obj.timing).toEqual({ start: 0, duration: 12 });
    const short = makeStudioVideo("blob:take-2", "Webcam recording", 200);
    expect(short.timing?.duration).toBe(0.5);
    const unknown = makeStudioVideo("blob:take-3", "Video");
    expect(unknown.timing).toBeUndefined();
  });

  it("recorded footage trims on the timeline like other video clips", () => {
    const store = useStudioStore.getState();
    const obj = makeStudioVideo("blob:take-4", "Screen recording", 8_000);
    store.addObject(obj);
    store.updateTimelineClip(obj.id, { durationMs: 3000, trimEdge: "end" });
    const clip = useStudioStore.getState().project.scenes[0].objects[0];
    expect(clip.type).toBe("video");
    expect(clip.timing?.duration).toBe(3);
    expect(timelineLaneForObject(clip)).toBe("main");
  });
});

describe("voiceover takes (#31)", () => {
  it("lands a chosen take on the voice lane and sets the scene duration from it", () => {
    const s = useStudioStore.getState();
    const character = makeStudioCharacter("student");
    s.addObject(character);
    s.addSpeech(character.id, { id: "line-1", text: "Hello", start: 0, duration: 2000 });

    const take = makeStudioVoiceover("blob:take-1", "Voiceover take 1", 4500, "take-1");
    s.applyVoiceoverTake(take, [
      { characterId: character.id, lineId: "line-1", start: 0, duration: 4500 },
    ]);
    const scene = useStudioStore.getState().project.scenes[0];
    const clips = scene.objects.filter((o) => isVoiceoverClip(o));
    expect(clips).toHaveLength(1);
    expect(clips[0].timing).toEqual({ start: 0, duration: 4.5 });
    expect(scene.durationMs).toBe(4500);
  });

  it("replaces the previous take when a new one is chosen, and clears on request", () => {
    const s = useStudioStore.getState();
    s.applyVoiceoverTake(makeStudioVoiceover("blob:a", "Take A", 3000, "a"), []);
    s.applyVoiceoverTake(makeStudioVoiceover("blob:b", "Take B", 6000, "b"), []);
    let scene = useStudioStore.getState().project.scenes[0];
    const clips = scene.objects.filter((o) => isVoiceoverClip(o));
    expect(clips).toHaveLength(1);
    expect((clips[0] as { resource?: string }).resource).toBe("blob:b");
    expect(scene.durationMs).toBe(6000);

    s.clearSceneVoiceover();
    scene = useStudioStore.getState().project.scenes[0];
    expect(scene.objects.some((o) => isVoiceoverClip(o))).toBe(false);
  });

  it("clamps a take duration to the minimum clip length", () => {
    const take = makeStudioVoiceover("blob:tiny", "Tiny", 20, "tiny");
    expect(take.timing?.duration).toBe(0.1);
  });
});

describe("cue markers (#64)", () => {
  it("adds, edits, sorts, and deletes markers on the current scene", () => {
    const s = useStudioStore.getState();
    const chapter = s.addCueMarker("chapter", 4000);
    const check = s.addCueMarker("knowledge-check", 1000);
    let scene = useStudioStore.getState().project.scenes[0] as {
      cueMarkers?: { id?: string; type: string; atMs: number }[];
    };
    expect(scene.cueMarkers?.map((m) => m.id)).toEqual([check.id, chapter.id]);

    s.updateCueMarker(check.id!, {
      label: "Quick check",
      question: {
        prompt: "Ready?",
        choices: [
          { id: "y", label: "Yes" },
          { id: "n", label: "No" },
        ],
        correctChoiceIds: ["y"],
      },
    });
    scene = useStudioStore.getState().project.scenes[0] as typeof scene;
    expect(scene.cueMarkers?.[0]).toMatchObject({ label: "Quick check" });

    s.removeCueMarker(chapter.id!);
    scene = useStudioStore.getState().project.scenes[0] as typeof scene;
    expect(scene.cueMarkers).toHaveLength(1);
  });

  it("clamps marker times to the scene and shares undo with other edits", () => {
    const s = useStudioStore.getState();
    const marker = s.addCueMarker("modal", 999999);
    const scene = useStudioStore.getState().project.scenes[0] as {
      cueMarkers?: { atMs: number }[];
    };
    expect(scene.cueMarkers?.[0].atMs).toBeLessThanOrEqual(
      useStudioStore.getState().project.scenes[0].durationMs,
    );
    expect(marker.atMs).toBe(scene.cueMarkers?.[0].atMs);
    useStudioStore.getState().undo();
    const after = useStudioStore.getState().project.scenes[0] as {
      cueMarkers?: unknown[];
    };
    expect(after.cueMarkers).toBeUndefined();
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

describe("aspect (issue #13)", () => {
  it("starts new projects at 16:9", () => {
    expect(useStudioStore.getState().project.aspect).toBe("16:9");
  });

  it("switches aspect and reframes objects inside the new frame", () => {
    const s = useStudioStore.getState();
    const shape = makeStudioShape();
    expect(shape.position).toEqual({ x: 300, y: 300, w: 240, h: 160 });
    s.addObject(shape);
    s.setProjectAspect("9:16");
    const state = useStudioStore.getState();
    expect(state.project.aspect).toBe("9:16");
    expect(state.project.scenes[0].objects).toHaveLength(1);
    expect(state.project.scenes[0].objects[0].position).toEqual({
      x: 169,
      y: 533,
      w: 135,
      h: 90,
    });
  });

  it("treats switching to the current aspect as a no-op", () => {
    const s = useStudioStore.getState();
    const pastCount = useStudioStore.getState().pastProjects.length;
    s.setProjectAspect("16:9");
    expect(useStudioStore.getState().pastProjects).toHaveLength(pastCount);
    expect(useStudioStore.getState().project.aspect).toBe("16:9");
  });

  it("undoes an aspect switch with its reframe", () => {
    const s = useStudioStore.getState();
    s.addObject(makeStudioShape());
    s.setProjectAspect("1:1");
    expect(useStudioStore.getState().project.aspect).toBe("1:1");
    useStudioStore.getState().undo();
    const project = useStudioStore.getState().project;
    expect(project.aspect).toBe("16:9");
    expect(project.scenes[0].objects[0].position).toEqual({
      x: 300,
      y: 300,
      w: 240,
      h: 160,
    });
  });

  it("round-trips the aspect through localStorage persistence", () => {
    const s = useStudioStore.getState();
    s.setProjectAspect("9:16");
    const raw = localStorage.getItem("ocf.video-studio.project.v1");
    expect(raw).toContain('"aspect":"9:16"');
  });

  it("loads legacy projects without an aspect as 16:9 and keeps a stored aspect", () => {
    const s = useStudioStore.getState();
    const legacy = JSON.parse(JSON.stringify(s.project)) as typeof s.project;
    delete legacy.aspect;
    s.loadProject(legacy);
    expect(useStudioStore.getState().project.aspect).toBe("16:9");

    const portrait = { ...legacy, aspect: "9:16" as const };
    s.loadProject(portrait);
    expect(useStudioStore.getState().project.aspect).toBe("9:16");
  });
});

describe("whiteboard draw-on (#52)", () => {
  it("stores a draw-on treatment on the selected object only", () => {
    const s = useStudioStore.getState();
    const shape = makeStudioShape();
    s.addObject(shape);
    s.setObjectDrawOn(shape.id, { durationMs: 1800, handStyle: "chalk" });
    const stored = useStudioStore.getState().project.scenes[0].objects.find(
      (o) => o.id === shape.id,
    );
    expect(stored?.extensions?.["x-finch-studio"]?.drawOn).toEqual({
      durationMs: 1800,
      handStyle: "chalk",
    });
    // The treatment survives the localStorage persistence round trip.
    const raw = localStorage.getItem("ocf.video-studio.project.v1") ?? "";
    expect(JSON.parse(raw).scenes[0].objects[0].extensions["x-finch-studio"].drawOn)
      .toEqual({ durationMs: 1800, handStyle: "chalk" });
    s.setObjectDrawOn(shape.id, undefined);
    const cleared = useStudioStore.getState().project.scenes[0].objects.find(
      (o) => o.id === shape.id,
    );
    expect(cleared?.extensions?.["x-finch-studio"]?.drawOn).toBeUndefined();
  });

  it("leaves objects without a treatment untouched", () => {
    const s = useStudioStore.getState();
    const shape = makeStudioShape();
    s.addObject(shape);
    const stored = useStudioStore.getState().project.scenes[0].objects.find(
      (o) => o.id === shape.id,
    );
    expect(stored?.extensions?.["x-finch-studio"]?.drawOn).toBeUndefined();
  });

  it("stores and clears the whiteboard scene style", () => {
    const s = useStudioStore.getState();
    const sceneId = s.project.scenes[0].id;
    s.setSceneWhiteboard(sceneId, { surface: "#fdfdf8" });
    expect(
      useStudioStore.getState().project.scenes[0].extensions?.["x-finch-studio"]?.whiteboard,
    ).toEqual({ surface: "#fdfdf8" });
    s.setSceneWhiteboard(sceneId, undefined);
    expect(
      useStudioStore.getState().project.scenes[0].extensions?.["x-finch-studio"]?.whiteboard,
    ).toBeUndefined();
  });
});

describe("aspect duplication (#62)", () => {
  it("duplicates at a new aspect under a fresh id and keeps the original", () => {
    const s = useStudioStore.getState();
    const original = s.project;
    expect(original.aspect ?? "16:9").toBe("16:9");
    s.duplicateAtAspect("9:16");
    const after = useStudioStore.getState().project;
    expect(after.id).not.toBe(original.id);
    expect(after.aspect).toBe("9:16");
    expect(after.name).toBe(`${original.name} (9:16)`);
    // The original survives untouched in the local library.
    const kept = libraryProject(original.id);
    expect(kept?.aspect ?? "16:9").toBe("16:9");
    expect(readProjectLibrary().some((e) => e.project.id === after.id)).toBe(true);
  });

  it("is a no-op at the current aspect", () => {
    const s = useStudioStore.getState();
    const before = s.project.id;
    s.duplicateAtAspect("16:9");
    expect(useStudioStore.getState().project.id).toBe(before);
  });
});

describe("project ducking (#28)", () => {
  it("defaults to medium and round-trips a new level", async () => {
    const { getProjectDucking } = await import("../audioEditing.js");
    const s = useStudioStore.getState();
    expect(getProjectDucking(s.project)).toBe("medium");
    s.setProjectDucking("strong");
    expect(getProjectDucking(useStudioStore.getState().project)).toBe("strong");
    s.setProjectDucking("off");
    expect(getProjectDucking(useStudioStore.getState().project)).toBe("off");
  });
});
