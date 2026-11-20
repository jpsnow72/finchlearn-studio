import { describe, expect, it } from "vitest";
import {
  clampCropRect,
  clampFootageSpeed,
  cropRectToPixels,
  decibelsToFootageVolume,
  footageGain,
  footageSourceAt,
  footageTimelineDurationMs,
  footageVolumeToDecibels,
  pipLayoutRect,
  resolveFootageEdit,
  type FootageEdit,
} from "./footage.js";
import {
  makeStudioProject,
  validateStudioProject,
  type FootageElement,
} from "./schema.js";
import { ocfToStudio, studioToOCF } from "./ocfMapping.js";

const edit = (patch: Partial<FootageEdit> = {}): FootageEdit => ({
  sourceInMs: 1000,
  sourceOutMs: 7000,
  speed: 1,
  volume: 1,
  ...patch,
});

describe("footage trim and speed math (#25)", () => {
  it("derives timeline duration from the trim at speed 1", () => {
    expect(footageTimelineDurationMs(edit())).toBe(6000);
  });

  it("retimes the timeline duration when speed changes", () => {
    expect(footageTimelineDurationMs(edit({ speed: 2 }))).toBe(3000);
    expect(footageTimelineDurationMs(edit({ speed: 0.5 }))).toBe(12000);
    expect(footageTimelineDurationMs(edit({ speed: 1.25 }))).toBe(4800);
  });

  it("clamps speed into the 0.5x to 2x menu range", () => {
    expect(clampFootageSpeed(4)).toBe(2);
    expect(clampFootageSpeed(0.1)).toBe(0.5);
    expect(clampFootageSpeed(Number.NaN)).toBe(1);
    expect(resolveFootageEdit(edit({ speed: 3 })).timelineDurationMs).toBe(3000);
  });

  it("maps timeline offsets to source times through the trim and speed", () => {
    const resolved = resolveFootageEdit(edit({ speed: 2 }));
    expect(footageSourceAt(resolved, 0)).toEqual({ sourceMs: 1000, frozen: false, ended: false });
    expect(footageSourceAt(resolved, 1000).sourceMs).toBe(3000);
    expect(footageSourceAt(resolved, 3000)).toEqual({ sourceMs: 7000, frozen: false, ended: true });
    expect(footageSourceAt(resolved, -500).sourceMs).toBe(1000);
  });
});

describe("footage freeze frame (#25)", () => {
  const frozen = () =>
    resolveFootageEdit(edit({ freeze: { atSourceMs: 4000, durationMs: 2000 } }));

  it("adds the hold to the timeline duration and splits the segments", () => {
    const resolved = frozen();
    expect(resolved.timelineDurationMs).toBe(8000);
    expect(resolved.segments.map((s) => [s.kind, s.timelineStartMs, s.durationMs])).toEqual([
      ["play", 0, 3000],
      ["freeze", 3000, 2000],
      ["play", 5000, 3000],
    ]);
  });

  it("holds the frozen source frame for the whole freeze segment", () => {
    const resolved = frozen();
    expect(footageSourceAt(resolved, 2999).frozen).toBe(false);
    expect(footageSourceAt(resolved, 3000)).toEqual({ sourceMs: 4000, frozen: true, ended: false });
    expect(footageSourceAt(resolved, 4999)).toEqual({ sourceMs: 4000, frozen: true, ended: false });
    expect(footageSourceAt(resolved, 5000)).toEqual({ sourceMs: 4000, frozen: false, ended: false });
    expect(footageSourceAt(resolved, 6000).sourceMs).toBe(5000);
  });

  it("composes freeze with speed", () => {
    const resolved = resolveFootageEdit(
      edit({ speed: 2, freeze: { atSourceMs: 4000, durationMs: 1000 } }),
    );
    expect(resolved.timelineDurationMs).toBe(4000);
    expect(footageSourceAt(resolved, 1500)).toEqual({ sourceMs: 4000, frozen: true, ended: false });
    expect(footageSourceAt(resolved, 2500).sourceMs).toBe(4000);
    expect(footageSourceAt(resolved, 3000).sourceMs).toBe(5000);
  });

  it("clamps a freeze outside the trim into the trim range", () => {
    const resolved = resolveFootageEdit(
      edit({ freeze: { atSourceMs: 99999, durationMs: 500 } }),
    );
    expect(resolved.freeze?.atSourceMs).toBe(7000);
    expect(resolved.timelineDurationMs).toBe(6500);
  });
});

describe("footage crop (#25)", () => {
  it("clamps crop rectangles into the source frame with a minimum size", () => {
    expect(clampCropRect({ x: 0.8, y: -0.2, w: 0.5, h: 0.01 })).toEqual({
      x: 0.5,
      y: 0,
      w: 0.5,
      h: 0.05,
    });
    expect(clampCropRect({ x: 0, y: 0, w: 1, h: 1 })).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it("converts a crop to source pixels", () => {
    expect(cropRectToPixels({ x: 0.25, y: 0.1, w: 0.5, h: 0.8 }, 1920, 1080)).toEqual({
      x: 480,
      y: 108,
      w: 960,
      h: 864,
    });
    const clamped = cropRectToPixels({ x: 0.9, y: 0.9, w: 0.5, h: 0.5 }, 100, 100);
    expect(clamped.x + clamped.w).toBeLessThanOrEqual(100);
    expect(clamped.y + clamped.h).toBeLessThanOrEqual(100);
  });
});

describe("footage volume (#25)", () => {
  it("maps volume to linear gain with clamping", () => {
    expect(footageGain(0.5)).toBe(0.5);
    expect(footageGain(2)).toBe(1);
    expect(footageGain(-1)).toBe(0);
    expect(footageGain(undefined)).toBe(1);
  });

  it("round trips volume through decibels", () => {
    expect(footageVolumeToDecibels(1)).toBe(0);
    expect(footageVolumeToDecibels(0)).toBe(-60);
    expect(decibelsToFootageVolume(footageVolumeToDecibels(0.25))).toBeCloseTo(0.25);
    expect(decibelsToFootageVolume(-120)).toBeCloseTo(0.001, 3);
  });
});

describe("footage picture-in-picture layouts (#25)", () => {
  it("resolves full, corner, and split presets in stage pixels", () => {
    expect(pipLayoutRect("full", 1280, 720)).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
    expect(pipLayoutRect("bottom-right", 1280, 720)).toEqual({ x: 846, y: 466, w: 410, h: 230 });
    expect(pipLayoutRect("top-left", 1280, 720)).toEqual({ x: 24, y: 24, w: 410, h: 230 });
    expect(pipLayoutRect("split-left", 1280, 720)).toEqual({ x: 0, y: 0, w: 640, h: 720 });
    expect(pipLayoutRect("split-right", 1280, 720)).toEqual({ x: 640, y: 0, w: 640, h: 720 });
  });
});

describe("footage schema integration (#25)", () => {
  function projectWithFootage(patch: Partial<FootageElement> = {}) {
    const p = makeStudioProject("Footage");
    p.scenes[0].durationMs = 6000;
    p.scenes[0].elements.push({
      kind: "footage",
      id: "ft-1",
      startMs: 0,
      durationMs: 6000,
      asset: { r2Key: "u/a/p/clip.mp4", kind: "video", durationMs: 20000 },
      sourceInMs: 1000,
      sourceOutMs: 7000,
      speed: 1,
      volume: 0.8,
      ...patch,
    });
    return p;
  }

  it("leaves legacy footage (no new fields) valid and unchanged", () => {
    const p = projectWithFootage();
    expect(validateStudioProject(p)).toEqual([]);
    const el = p.scenes[0].elements[0];
    expect(el.kind === "footage" && el.freeze).toBeUndefined();
    expect(el.kind === "footage" && el.crop).toBeUndefined();
    const resolved = resolveFootageEdit(el as FootageElement);
    expect(resolved.segments).toHaveLength(1);
    expect(resolved.timelineDurationMs).toBe(6000);
  });

  it("round trips footage edits through the OCF mapping without a sidecar", () => {
    const p = projectWithFootage({
      speed: 1.5,
      freeze: { atSourceMs: 4000, durationMs: 1500 },
      crop: { x: 0.1, y: 0.2, w: 0.6, h: 0.7 },
      pipLayout: "bottom-right",
    });
    const { project } = studioToOCF(p);
    const back = ocfToStudio(project);
    const el = back.scenes[0].elements[0];
    expect(el.kind).toBe("footage");
    if (el.kind === "footage") {
      expect(el.sourceInMs).toBe(1000);
      expect(el.sourceOutMs).toBe(7000);
      expect(el.speed).toBe(1.5);
      expect(el.volume).toBe(0.8);
      expect(el.freeze).toEqual({ atSourceMs: 4000, durationMs: 1500 });
      expect(el.crop).toEqual({ x: 0.1, y: 0.2, w: 0.6, h: 0.7 });
      expect(el.pipLayout).toBe("bottom-right");
    }
    expect(validateStudioProject(back)).toEqual([]);
  });

  it("flags out-of-range speed, volume, freeze, and crop in validation", () => {
    const problems = validateStudioProject(
      projectWithFootage({
        speed: 3,
        volume: 1.5,
        freeze: { atSourceMs: 9000, durationMs: 1000 },
        crop: { x: 0.8, y: 0, w: 0.5, h: 0.5 },
      }),
    );
    expect(problems.some((x) => x.includes("speed"))).toBe(true);
    expect(problems.some((x) => x.includes("volume"))).toBe(true);
    expect(problems.some((x) => x.includes("freeze"))).toBe(true);
    expect(problems.some((x) => x.includes("crop"))).toBe(true);
  });
});
