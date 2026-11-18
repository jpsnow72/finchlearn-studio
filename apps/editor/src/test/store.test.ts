/**
 * Video studio store: scenes, objects, character edits, persistence.
 */
// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import { useStudioStore, makeStudioCharacter } from "../store.js";

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

describe("persistence", () => {
  it("round-trips the project through localStorage", () => {
    const s = useStudioStore.getState();
    s.setProjectName("Persist me");
    const raw = localStorage.getItem("ocf.video-studio.project.v1");
    expect(raw).toContain("Persist me");
  });
});
