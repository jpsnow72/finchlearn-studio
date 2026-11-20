/**
 * Video project timing (SPEC §7.9): scene transitions, lookup, and validation.
 */
import { describe, expect, it } from "vitest";
import {
  makeVideoProject,
  makeVideoScene,
  objectOutsideFrame,
  projectAspect,
  projectTimeline,
  projectDurationMs,
  reframeProjectForAspect,
  sceneContentDurationMs,
  sceneAt,
  stageDimensions,
  transitionAlpha,
  validateVideoProject,
  withProjectAspect,
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
    scene.durationMs = 1000;
    expect(sceneContentDurationMs(scene)).toBe(1000);
    scene.durationMs = 0;
    expect(sceneContentDurationMs(scene)).toBe(500);
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

describe("project aspect (issue #13)", () => {
  it("defaults new projects to 16:9 with a 1280x720 stage", () => {
    const p = makeVideoProject("test");
    expect(p.aspect).toBe("16:9");
    expect(stageDimensions(p)).toEqual({ width: 1280, height: 720 });
    expect(stageDimensions({ aspect: "9:16" })).toEqual({ width: 720, height: 1280 });
    expect(stageDimensions({ aspect: "1:1" })).toEqual({ width: 720, height: 720 });
  });

  it("opens legacy projects without an aspect as 16:9", () => {
    const legacy = makeVideoProject("legacy");
    delete legacy.aspect;
    expect(projectAspect(legacy)).toBe("16:9");
    expect(withProjectAspect(legacy).aspect).toBe("16:9");
    expect(validateVideoProject(legacy)).toEqual([]);
    const broken = { ...legacy, aspect: "4:3" as never };
    expect(projectAspect(broken)).toBe("16:9");
    expect(
      validateVideoProject(broken).some((m) => m.includes("aspect")),
    ).toBe(true);
  });

  it("reframes objects into the portrait frame, scaled and inside", () => {
    const p = makeVideoProject("test");
    p.scenes[0].objects.push({
      id: "hero",
      type: "shape",
      position: { x: 200, y: 200, w: 140, h: 280 },
    } as never);
    const out = reframeProjectForAspect(p, "9:16");
    expect(out.aspect).toBe("9:16");
    expect(out.scenes[0].objects).toHaveLength(1);
    expect(out.scenes[0].objects[0].position).toEqual({
      x: 113,
      y: 356,
      w: 79,
      h: 158,
    });
    // The source project is not mutated.
    expect(p.aspect).toBe("16:9");
    expect(p.scenes[0].objects[0].position).toEqual({
      x: 200,
      y: 200,
      w: 140,
      h: 280,
    });
  });

  it("clamps overflowing elements inside the new frame instead of losing them", () => {
    const p = makeVideoProject("test");
    p.scenes[0].objects.push({
      id: "edge",
      type: "shape",
      position: { x: 1200, y: 600, w: 400, h: 300 },
    } as never);
    const out = reframeProjectForAspect(p, "9:16");
    const pos = out.scenes[0].objects[0].position!;
    expect(pos.x! + pos.w!).toBeLessThanOrEqual(720);
    expect(pos.y! + pos.h!).toBeLessThanOrEqual(1280);
    expect(objectOutsideFrame(out.scenes[0].objects[0], { width: 720, height: 1280 })).toBe(false);
    expect(objectOutsideFrame(p.scenes[0].objects[0], { width: 720, height: 1280 })).toBe(true);
  });

  it("reframes character path waypoints and square projects", () => {
    const p = makeVideoProject("test");
    p.scenes[0].objects.push({
      id: "walker",
      type: "character",
      characterId: "student",
      position: { x: 0, y: 0, w: 140, h: 280 },
      path: [{ x: 1280, y: 720, t: 0 }],
    } as never);
    const square = reframeProjectForAspect(p, "1:1");
    expect(square.aspect).toBe("1:1");
    const walker = square.scenes[0].objects[0] as { path?: { x: number; y: number }[] };
    expect(walker.path?.[0]).toMatchObject({ x: 720, y: 720 });
  });

  it("returns the project unchanged when switching to its current aspect", () => {
    const p = makeVideoProject("test");
    expect(reframeProjectForAspect(p, "16:9")).toBe(p);
  });
});
