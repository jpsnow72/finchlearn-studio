import { describe, expect, it } from "vitest";
import {
  makeStudioProject,
  makeStudioScene,
  validateStudioProject,
  type StudioProject,
} from "./schema.js";
import { projectTimeline, projectDurationMs } from "./timing.js";
import { studioToOCF, ocfToStudio } from "./ocfMapping.js";

function sampleProject(): StudioProject {
  const p = makeStudioProject("Demo");
  const s1 = p.scenes[0];
  s1.durationMs = 6000;
  s1.elements.push(
    {
      kind: "footage", id: "el-1", startMs: 0, durationMs: 6000,
      asset: { r2Key: "u/a/p/clip.mp4", kind: "video" },
      sourceInMs: 1000, sourceOutMs: 7000, speed: 1, volume: 0.9,
    },
    {
      kind: "text", id: "el-2", startMs: 500, durationMs: 3000,
      text: "Hello", x: 10, y: 20, w: 300, h: 60,
    },
    {
      kind: "chart", id: "el-3", startMs: 0, durationMs: 4000,
      chartType: "bar", csv: "a,b\n1,2",
    },
  );
  s1.dialogue.push({
    id: "line-1", text: "Welcome", voiceId: "kokoro-af",
    wordTimings: [{ word: "Welcome", startMs: 0, endMs: 480 }],
  });
  s1.markers = [{ atMs: 3000, type: "knowledge-check", label: "Check" }];
  const s2 = makeStudioScene("Second");
  s2.durationMs = 5000;
  s2.transition = "fade";
  s2.transitionMs = 400;
  p.scenes.push(s2);
  return p;
}

describe("schema v1", () => {
  it("validates a well formed project", () => {
    expect(validateStudioProject(sampleProject())).toEqual([]);
  });

  it("flags bad footage trims and duplicate ids", () => {
    const p = sampleProject();
    const bad = p.scenes[0].elements[0];
    if (bad.kind === "footage") bad.sourceOutMs = 0;
    p.scenes[0].elements.push({ ...p.scenes[0].elements[1] });
    const problems = validateStudioProject(p);
    expect(problems.some((x) => x.includes("sourceOutMs"))).toBe(true);
    expect(problems.some((x) => x.includes("Duplicate"))).toBe(true);
  });

  it("computes timeline with fade overlap", () => {
    const p = sampleProject();
    const { scenes, totalMs } = projectTimeline(p);
    expect(scenes[1].startMs).toBe(5600);
    expect(totalMs).toBe(10600);
    expect(projectDurationMs(p)).toBe(10600);
  });

  it("overlaps every non-cut transition", () => {
    const p = sampleProject();
    for (const transition of ["fade", "slide", "wipe", "zoom", "push"] as const) {
      p.scenes[1].transition = transition;
      expect(projectTimeline(p).totalMs).toBe(10600);
    }
  });
});

describe("OCF mapping", () => {
  it("round trips losslessly with the sidecar", () => {
    const p = sampleProject();
    const { project, sidecar } = studioToOCF(p);
    expect(project.scenes).toHaveLength(2);
    const back = ocfToStudio(project, sidecar);
    expect(back).toEqual(p);
  });

  it("maps cue markers onto the footage object as OCF cue points", () => {
    const { project } = studioToOCF(sampleProject());
    const video = project.scenes[0].objects.find((o) => o.type === "video");
    expect(video?.type).toBe("video");
    if (video?.type === "video") {
      expect(video.cuePoints).toHaveLength(1);
      expect(video.cuePoints?.[0].at).toBe(3);
    }
  });

  it("rebuilds a valid project without a sidecar", () => {
    const { project } = studioToOCF(sampleProject());
    const back = ocfToStudio(project);
    expect(validateStudioProject(back)).toEqual([]);
    expect(back.scenes[0].elements.some((e) => e.kind === "footage")).toBe(true);
    expect(back.scenes[0].elements.some((e) => e.kind === "chart")).toBe(false);
  });

  it("round trips all supported seam transitions without a sidecar", () => {
    const p = sampleProject();
    const transitions = ["cut", "fade", "slide", "wipe", "zoom", "push"] as const;
    p.scenes = transitions.map((transition, index) => ({
      ...makeStudioScene(`Scene ${index + 1}`),
      transition,
    }));
    const { project } = studioToOCF(p);
    const back = ocfToStudio(project);
    expect(back.scenes.map((scene) => scene.transition)).toEqual(transitions);
  });
});
