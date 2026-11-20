import { describe, expect, it } from "vitest";
import {
  makeStudioProject,
  makeStudioScene,
  validateStudioProject,
  type StudioProject,
} from "./schema.js";
import { projectTimeline, projectDurationMs } from "./timing.js";
import {
  studioToOCF,
  ocfToStudio,
  cueMarkerToOCF,
  cuePointToMarker,
} from "./ocfMapping.js";
import { makeCueMarker, type CueMarker } from "./schema.js";

function sampleProject(): StudioProject {
  const p = makeStudioProject("Demo");
  p.sceneGroupPresetRefs = ["group-preset-1"];
  const s1 = p.scenes[0];
  s1.durationMs = 6000;
  s1.effects = [{ name: "fadeIn", start: 100, duration: 400 }];
  s1.elements.push(
    {
      kind: "footage", id: "el-1", startMs: 0, durationMs: 6000,
      asset: { r2Key: "u/a/p/clip.mp4", kind: "video" },
      sourceInMs: 1000, sourceOutMs: 7000, speed: 1, volume: 0.9,
    },
    {
      kind: "text", id: "el-2", startMs: 500, durationMs: 3000,
      text: "Hello", x: 10, y: 20, w: 300, h: 60,
      effects: [{ name: "emphasisPulse", start: 900, duration: 350 }],
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
    expect(back.scenes[0].effects).toEqual([{ name: "fadeIn", start: 100, duration: 400 }]);
    expect(back.scenes[0].elements.find((e) => e.id === "el-2")?.effects).toEqual([
      { name: "emphasisPulse", start: 900, duration: 350 },
    ]);
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

describe("cue markers (#64)", () => {
  function richProject(): StudioProject {
    const p = sampleProject();
    p.scenes[0].markers = [
      {
        id: "cue-check", atMs: 1000, type: "knowledge-check", label: "Quick check",
        question: {
          prompt: "What comes first?",
          choices: [
            { id: "a", label: "Identify the energy source" },
            { id: "b", label: "Start the machine" },
          ],
          correctChoiceIds: ["a"],
          requireCorrect: true,
        },
      },
      {
        id: "cue-branch", atMs: 2000, type: "branch", label: "Pick a path",
        branchChoices: [
          { id: "go-review", label: "Review the basics", jumpToMs: 500 },
          { id: "go-skip", label: "Skip ahead", jumpToMs: 4500 },
        ],
      },
      { id: "cue-modal", atMs: 3000, type: "modal", label: "Safety note", modalRef: "popup-safety" },
      { id: "cue-chapter", atMs: 4000, type: "chapter", label: "Part two" },
    ];
    // A second footage element proves markers land on the first one only.
    p.scenes[0].elements.push({
      kind: "footage", id: "el-9", startMs: 0, durationMs: 6000,
      asset: { r2Key: "u/a/p/other.mp4", kind: "video" },
      sourceInMs: 0, sourceOutMs: 6000, speed: 1, volume: 1,
    });
    return p;
  }

  it("exports every marker type as native OCF cue metadata on the first footage object only", () => {
    const { project } = studioToOCF(richProject());
    const videos = project.scenes[0].objects.filter((o) => o.type === "video");
    expect(videos).toHaveLength(2);
    const [host, other] = videos;
    if (host?.type !== "video" || other?.type !== "video") throw new Error("expected video objects");
    expect(other.cuePoints).toBeUndefined();
    expect(host.cuePoints?.map((c) => c.id)).toEqual([
      "cue-check", "cue-branch", "cue-modal", "cue-chapter",
    ]);
    expect(host.cuePoints?.map((c) => c.at)).toEqual([1, 2, 3, 4]);

    const check = host.cuePoints?.[0];
    expect(check?.action?.kind).toBe("question");
    if (check?.action?.kind === "question") {
      expect(check.action.requireCorrect).toBe(true);
      expect(check.action.question.prompt).toBe("What comes first?");
      expect(check.action.question.choices?.map((c) => c.id)).toEqual(["a", "b"]);
      expect(check.action.question.correctResponses).toEqual(["a"]);
    }
    const branch = host.cuePoints?.[1];
    expect(branch?.action?.kind).toBe("branch");
    if (branch?.action?.kind === "branch") {
      expect(branch.action.choices.map((c) => c.jumpTo)).toEqual([0.5, 4.5]);
    }
    // Modal markers pause via a cue-point trigger opening the popup.
    const modalTrigger = host.triggers?.find((t) => t.event.cuePoint === "cue-modal");
    expect(modalTrigger?.event.type).toBe("cue-point");
    expect(modalTrigger?.actions).toEqual([{ type: "open-popup", target: "popup-safety" }]);
    // The lossless extension copy rides on the same host object.
    const stored = host.extensions?.["x-finch-studio"]?.cueMarkers as CueMarker[];
    expect(stored.map((m) => m.type)).toEqual([
      "knowledge-check", "branch", "modal", "chapter",
    ]);
    expect(stored[2].modalRef).toBe("popup-safety");
  });

  it("round trips markers intact through OCF export and import without a sidecar", () => {
    const p = richProject();
    const { project } = studioToOCF(p);
    const back = ocfToStudio(project);
    expect(back.scenes[0].markers).toEqual(p.scenes[0].markers);
    expect(validateStudioProject(back)).toEqual([]);
  });

  it("round trips markers intact with the sidecar", () => {
    const p = richProject();
    const { project, sidecar } = studioToOCF(p);
    expect(ocfToStudio(project, sidecar).scenes[0].markers).toEqual(p.scenes[0].markers);
  });

  it("rebuilds marker payloads from native cue points when the extension copy is stripped", () => {
    const { project } = studioToOCF(richProject());
    const host = project.scenes[0].objects.find((o) => o.type === "video");
    if (host?.type !== "video") throw new Error("expected a video host");
    delete host.extensions;
    const back = ocfToStudio(project);
    const markers = back.scenes[0].markers ?? [];
    expect(markers.map((m) => m.type)).toEqual([
      "knowledge-check", "branch", "modal", "chapter",
    ]);
    expect(markers[0].question?.prompt).toBe("What comes first?");
    expect(markers[0].question?.correctChoiceIds).toEqual(["a"]);
    expect(markers[1].branchChoices?.map((c) => c.jumpToMs)).toEqual([500, 4500]);
    expect(markers[2].modalRef).toBe("popup-safety");
    expect(markers[3].label).toBe("Part two");
  });

  it("carries markers on the first object when a scene has no footage", () => {
    const p = sampleProject();
    p.scenes[0].elements = p.scenes[0].elements.filter((e) => e.kind !== "footage");
    p.scenes[0].markers = [{ id: "cue-only", atMs: 1500, type: "chapter", label: "Intro" }];
    const { project } = studioToOCF(p);
    const first = project.scenes[0].objects[0];
    const stored = first?.extensions?.["x-finch-studio"]?.cueMarkers as CueMarker[];
    expect(stored).toEqual(p.scenes[0].markers);
    expect(ocfToStudio(project).scenes[0].markers).toEqual(p.scenes[0].markers);
  });

  it("keeps pre-#64 markers valid and gives them deterministic export ids", () => {
    const p = sampleProject(); // marker has no id and no payload
    expect(validateStudioProject(p)).toEqual([]);
    const { project } = studioToOCF(p);
    const video = project.scenes[0].objects.find((o) => o.type === "video");
    if (video?.type !== "video") throw new Error("expected a video object");
    expect(video.cuePoints?.[0].id).toBe("cue-el-1-0");
    expect(video.cuePoints?.[0].name).toBe("Check");
    const back = ocfToStudio(project);
    expect(back.scenes[0].markers?.[0]).toMatchObject({
      atMs: 3000, type: "knowledge-check", label: "Check",
    });
  });

  it("validates marker payloads when they are present", () => {
    const p = sampleProject();
    p.scenes[0].markers = [
      { id: "bad-q", atMs: 100, type: "knowledge-check", question: { prompt: "", choices: [{ id: "a", label: "A" }], correctChoiceIds: ["nope"] } },
      { id: "bad-b", atMs: 200, type: "branch", branchChoices: [{ id: "x", label: "Only", jumpToMs: 99999 }] },
      { id: "bad-q", atMs: 300, type: "chapter" },
      { id: "bad-t", atMs: 400, type: "quiz" as CueMarker["type"] },
    ];
    const problems = validateStudioProject(p);
    expect(problems.some((x) => x.includes("empty question prompt"))).toBe(true);
    expect(problems.some((x) => x.includes("fewer than two question choices"))).toBe(true);
    expect(problems.some((x) => x.includes("correct choice"))).toBe(true);
    expect(problems.some((x) => x.includes("fewer than two choices"))).toBe(true);
    expect(problems.some((x) => x.includes("jumping outside the scene"))).toBe(true);
    expect(problems.some((x) => x.includes("duplicate marker id"))).toBe(true);
    expect(problems.some((x) => x.includes("unknown type"))).toBe(true);
  });

  it("converts a modal marker that only carries the legacy ocfRef", () => {
    const { cuePoint, trigger } = cueMarkerToOCF(
      { atMs: 2500, type: "modal", ocfRef: "popup-legacy" },
      "cue-fallback",
    );
    expect(cuePoint).toEqual({ id: "cue-fallback", name: undefined, at: 2.5 });
    expect(trigger?.actions).toEqual([{ type: "open-popup", target: "popup-legacy" }]);
    expect(cuePointToMarker(cuePoint, trigger ? [trigger] : [])).toMatchObject({
      type: "modal", modalRef: "popup-legacy", atMs: 2500,
    });
  });

  it("makeCueMarker stamps a fresh id", () => {
    const marker = makeCueMarker("chapter", 1200, { label: "Start" });
    expect(marker.id).toContain("cue-");
    expect(marker).toMatchObject({ type: "chapter", atMs: 1200, label: "Start" });
  });
});

describe("whiteboard draw-on (#52)", () => {
  function whiteboardProject(): StudioProject {
    const p = sampleProject();
    const s1 = p.scenes[0];
    s1.whiteboard = { surface: "#fdfdf8" };
    s1.elements.push(
      {
        kind: "shape", id: "el-wb-1", startMs: 0, durationMs: 4000,
        shape: "rect", fill: "#1d4ed8",
        drawOn: { durationMs: 2000, handStyle: "marker" },
      },
      {
        kind: "image", id: "el-wb-2", startMs: 1000, durationMs: 3000,
        asset: { r2Key: "u/a/p/diagram.png", kind: "image" },
        drawOn: { durationMs: 1500, handStyle: "chalk", eraseDelayMs: 500, eraseDurationMs: 800 },
      },
    );
    const text = s1.elements.find((e) => e.id === "el-2");
    if (text) text.drawOn = { handStyle: "pen" };
    return p;
  }

  it("validates a whiteboard project and flags bad draw-on values", () => {
    expect(validateStudioProject(whiteboardProject())).toEqual([]);
    const bad = whiteboardProject();
    const el = bad.scenes[0].elements.find((e) => e.id === "el-wb-1");
    if (el) el.drawOn = { durationMs: 0, eraseDurationMs: -5 };
    const problems = validateStudioProject(bad);
    expect(problems.some((x) => x.includes("drawOn durationMs"))).toBe(true);
    expect(problems.some((x) => x.includes("drawOn eraseDurationMs"))).toBe(true);
  });

  it("round trips draw-on and the whiteboard scene with the sidecar", () => {
    const p = whiteboardProject();
    const { project, sidecar } = studioToOCF(p);
    expect(ocfToStudio(project, sidecar)).toEqual(p);
  });

  it("rebuilds draw-on and the whiteboard scene without a sidecar", () => {
    const { project } = studioToOCF(whiteboardProject());
    const shape = project.scenes[0].objects.find((o) => o.id === "el-wb-1");
    expect(shape?.extensions?.["x-finch-studio"]?.drawOn).toEqual({
      durationMs: 2000, handStyle: "marker",
    });
    expect(project.scenes[0].extensions?.["x-finch-studio"]?.whiteboard).toEqual({
      surface: "#fdfdf8",
    });
    const back = ocfToStudio(project);
    expect(validateStudioProject(back)).toEqual([]);
    expect(back.scenes[0].whiteboard).toEqual({ surface: "#fdfdf8" });
    expect(back.scenes[0].elements.find((e) => e.id === "el-wb-1")?.drawOn).toEqual({
      durationMs: 2000, handStyle: "marker",
    });
    expect(back.scenes[0].elements.find((e) => e.id === "el-wb-2")?.drawOn).toEqual({
      durationMs: 1500, handStyle: "chalk", eraseDelayMs: 500, eraseDurationMs: 800,
    });
    expect(back.scenes[0].elements.find((e) => e.id === "el-2")?.drawOn).toEqual({
      handStyle: "pen",
    });
  });

  it("leaves legacy projects without draw-on untouched", () => {
    const p = sampleProject();
    const { project, sidecar } = studioToOCF(p);
    for (const scene of project.scenes) {
      expect(scene.extensions).toBeUndefined();
      for (const o of scene.objects) {
        expect(o.extensions?.["x-finch-studio"]?.drawOn).toBeUndefined();
      }
    }
    const back = ocfToStudio(project);
    expect(back.scenes[0].whiteboard).toBeUndefined();
    for (const el of back.scenes[0].elements) {
      expect(el.drawOn).toBeUndefined();
    }
    expect(ocfToStudio(project, sidecar)).toEqual(p);
  });
});

import { parseScript } from "./scriptImport.js";
import { duplicateProjectAs, restoreSnapshot, safeZones, takeSnapshot } from "./reframe.js";

describe("script import (#55)", () => {
  it("parses scenes, speakers, and narration deterministically", () => {
    const script = "[Scene: Intro]\nNARRATOR: Welcome to the course.\nThis line is plain narration.\n[Scene: Demo]\nSAM: Watch this step carefully now.";
    const p = parseScript(script, "Parsed");
    expect(p.scenes).toHaveLength(2);
    expect(p.scenes[0].name).toBe("Intro");
    expect(p.scenes[0].dialogue).toHaveLength(2);
    expect(p.scenes[1].dialogue[0].text).toContain("Watch this step");
    expect(p.scenes[0].durationMs).toBeGreaterThanOrEqual(2000);
    expect(parseScript(script, "Parsed").scenes.map((s) => s.dialogue.length)).toEqual([2, 1]);
  });
});

describe("snapshots and reframe (#62)", () => {
  it("snapshots round trip", () => {
    const p = sampleProject();
    const snap = takeSnapshot(p, "before edits");
    expect(restoreSnapshot(snap)).toEqual(p);
  });
  it("duplicating to 9:16 keeps elements inside the frame", () => {
    const p = sampleProject();
    const v = duplicateProjectAs(p, "9:16");
    expect(v.aspect).toBe("9:16");
    expect(v.id).not.toBe(p.id);
    for (const el of v.scenes[0].elements) {
      if (el.x !== undefined && el.w !== undefined) expect(el.x + el.w).toBeLessThanOrEqual(1080);
    }
    expect(safeZones("9:16").socialSafe.w).toBeLessThan(1);
  });
});

describe("project aspect (issue #13)", () => {
  it("flags an unsupported aspect and accepts the three supported ones", () => {
    const p = sampleProject();
    for (const aspect of ["16:9", "9:16", "1:1"] as const) {
      p.aspect = aspect;
      expect(validateStudioProject(p)).toEqual([]);
    }
    p.aspect = "4:3" as never;
    expect(
      validateStudioProject(p).some((x) => x.includes("aspect")),
    ).toBe(true);
  });

  it("carries the aspect through the OCF mapping on the project and the sidecar", () => {
    const p = sampleProject();
    p.aspect = "9:16";
    const { project, sidecar } = studioToOCF(p);
    expect(project.aspect).toBe("9:16");
    expect(sidecar.aspect).toBe("9:16");
    expect(ocfToStudio(project, sidecar)).toEqual(p);
  });

  it("reads the aspect off a plain OCF project and defaults legacy projects to 16:9", () => {
    const p = sampleProject();
    const { project } = studioToOCF(p);
    project.aspect = "1:1";
    expect(ocfToStudio(project).aspect).toBe("1:1");
    delete project.aspect;
    expect(ocfToStudio(project).aspect).toBe("16:9");
  });
});
