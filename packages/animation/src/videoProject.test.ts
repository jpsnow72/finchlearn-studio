/**
 * Video project timing (SPEC §7.9): scene transitions, lookup, and validation.
 */
import { describe, expect, it } from "vitest";
import {
  makeVideoProject,
  makeVideoScene,
  projectTimeline,
  projectDurationMs,
  sceneContentDurationMs,
  sceneAt,
  transitionAlpha,
  validateVideoProject,
} from "./videoProject.js";
import type { VideoProject } from "@finch-studio/core";

function twoSceneProject(transition: "cut" | "fade"): VideoProject {
  const p = makeVideoProject("test");
  const s1 = { ...makeVideoScene("One"), durationMs: 4000 };
  const s2 = { ...makeVideoScene("Two"), durationMs: 6000, transition, transitionMs: 500 };
  return { ...p, scenes: [s1, s2] };
}

describe("projectTimeline", () => {
  it("abuts scenes with cut transitions", () => {
    const { scenes, totalMs } = projectTimeline(twoSceneProject("cut"));
    expect(scenes[0].startMs).toBe(0);
    expect(scenes[0].endMs).toBe(4000);
    expect(scenes[1].startMs).toBe(4000);
    expect(scenes[1].endMs).toBe(10000);
    expect(totalMs).toBe(10000);
  });

  it("treats a missing transition as a cut", () => {
    const project = twoSceneProject("cut");
    delete project.scenes[1].transition;
    expect(projectTimeline(project).totalMs).toBe(10000);
  });

  it("overlaps scenes with fade transitions", () => {
    const { scenes, totalMs } = projectTimeline(twoSceneProject("fade"));
    expect(scenes[0].startMs).toBe(0);
    expect(scenes[0].endMs).toBe(4000);
    expect(scenes[1].startMs).toBe(3500); // 500ms overlap
    expect(scenes[1].endMs).toBe(9500);
    expect(totalMs).toBe(9500);
  });

  it("overlaps scenes for every non-cut transition", () => {
    for (const transition of ["fade", "slide", "wipe", "zoom", "push"] as const) {
      const project = twoSceneProject("cut");
      project.scenes[1].transition = transition;
      expect(projectTimeline(project).totalMs).toBe(9500);
    }
  });

  it("projectDurationMs matches the timeline total", () => {
    const p = twoSceneProject("fade");
    expect(projectDurationMs(p)).toBe(projectTimeline(p).totalMs);
  });

});

describe("sceneContentDurationMs", () => {
  it("uses timed content with a half-second minimum and defaults untimed scenes to five seconds", () => {
    const scene = makeVideoScene();
    expect(sceneContentDurationMs(scene)).toBe(5000);
    scene.objects.push({
      id: "text",
      type: "text",
      name: "Text",
      content: "Timed",
      position: { x: 0, y: 0, w: 100, h: 40 },
      timing: { start: 2, duration: 4 },
    });
    expect(sceneContentDurationMs(scene)).toBe(6000);
    scene.objects[0].timing = { start: 0, duration: 2 };
    expect(sceneContentDurationMs(scene)).toBe(2000);
    scene.objects[0].timing = { start: 0, duration: 0.1 };
    expect(sceneContentDurationMs(scene)).toBe(500);
    delete scene.objects[0].timing;
    expect(sceneContentDurationMs(scene)).toBe(5000);
  });
});

describe("sceneAt", () => {
  it("finds the active scene at a project time", () => {
    const p = twoSceneProject("cut");
    const hit = sceneAt(p, 5000);
    expect(hit?.scene.name).toBe("Two");
    expect(hit?.sceneT).toBe(1000);
  });

  it("prefers the later scene during a fade overlap", () => {
    const p = twoSceneProject("fade");
    const hit = sceneAt(p, 3750); // inside the 3500–4000 overlap
    expect(hit?.scene.name).toBe("Two");
  });

  it("returns null past the end", () => {
    expect(sceneAt(twoSceneProject("cut"), 99999)).toBeNull();
  });
});

describe("transitionAlpha", () => {
  it("is 1 for cut transitions", () => {
    const p = twoSceneProject("cut");
    expect(transitionAlpha(p, 4500)).toBe(1);
  });

  it("ramps 0→1 across the fade overlap", () => {
    const p = twoSceneProject("fade");
    expect(transitionAlpha(p, 3500)).toBeCloseTo(0, 2);
    expect(transitionAlpha(p, 3750)).toBeCloseTo(0.5, 2);
    expect(transitionAlpha(p, 4100)).toBe(1);
  });
});

describe("validateVideoProject", () => {
  it("accepts a well-formed project", () => {
    expect(validateVideoProject(twoSceneProject("cut"))).toEqual([]);
  });

  it("flags missing scenes and bad durations", () => {
    const p = makeVideoProject("bad");
    const broken = { ...p, scenes: [] };
    expect(validateVideoProject(broken).length).toBeGreaterThan(0);
    const zeroDur = {
      ...p,
      scenes: [{ ...makeVideoScene("z"), durationMs: 0 }],
    };
    expect(
      validateVideoProject(zeroDur).some((m) => m.includes("durationMs")),
    ).toBe(true);
  });
});
