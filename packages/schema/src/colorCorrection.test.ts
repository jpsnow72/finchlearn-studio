import { describe, expect, it } from "vitest";
import {
  AUTO_FIX_FALLBACK,
  NEUTRAL_COLOR_CORRECTION,
  applyColorMatrixToPixels,
  autoFixColorCorrection,
  clampColorCorrection,
  colorMatrixFor,
  feColorMatrixValues,
  imageStatisticsFromPixels,
  isNeutralColorCorrection,
  sanitizeColorCorrection,
  type ColorCorrection,
} from "./colorCorrection.js";
import { makeStudioProject, validateStudioProject } from "./schema.js";
import { ocfToStudio, studioToOCF } from "./ocfMapping.js";

const IDENTITY = [
  1, 0, 0, 0, 0,
  0, 1, 0, 0, 0,
  0, 0, 1, 0, 0,
  0, 0, 0, 1, 0,
];

function correction(patch: Partial<ColorCorrection>): ColorCorrection {
  return { ...NEUTRAL_COLOR_CORRECTION, ...patch };
}

describe("colour correction model", () => {
  it("neutral is the identity, so untouched objects render as before", () => {
    expect(isNeutralColorCorrection(NEUTRAL_COLOR_CORRECTION)).toBe(true);
    expect(isNeutralColorCorrection(undefined)).toBe(true);
    expect(colorMatrixFor(NEUTRAL_COLOR_CORRECTION)).toEqual(IDENTITY);
    const pixels = new Uint8ClampedArray([10, 128, 250, 255]);
    applyColorMatrixToPixels(pixels, colorMatrixFor(NEUTRAL_COLOR_CORRECTION));
    expect([...pixels]).toEqual([10, 128, 250, 255]);
  });

  it("maps exposure exactly: +50 doubles, -50 halves", () => {
    const up = colorMatrixFor(correction({ exposure: 50 }));
    expect(up[0]).toBeCloseTo(2);
    expect(up[6]).toBeCloseTo(2);
    expect(up[12]).toBeCloseTo(2);
    expect(up[4]).toBe(0);
    const pixels = new Uint8ClampedArray([40, 80, 120, 255]);
    applyColorMatrixToPixels(pixels, up);
    expect([...pixels]).toEqual([80, 160, 240, 255]);
    const down = colorMatrixFor(correction({ exposure: -50 }));
    expect(down[0]).toBeCloseTo(0.5);
  });

  it("maps contrast exactly around mid grey", () => {
    const m = colorMatrixFor(correction({ contrast: 100 }));
    expect(m[0]).toBeCloseTo(2);
    expect(m[4]).toBeCloseTo(-0.5);
    const pixels = new Uint8ClampedArray([64, 128, 192, 255]);
    applyColorMatrixToPixels(pixels, m);
    // Byte space: value * 2 - 127.5, clamped (0.5 and 128.5 round to even).
    expect(pixels[0]).toBe(0);
    expect(pixels[1]).toBe(128);
    expect(pixels[2]).toBe(255);
    expect(pixels[3]).toBe(255);
  });

  it("maps saturation exactly: -100 collapses to Rec. 709 luma", () => {
    const m = colorMatrixFor(correction({ saturation: -100 }));
    expect(m[0]).toBeCloseTo(0.2126);
    expect(m[1]).toBeCloseTo(0.7152);
    expect(m[2]).toBeCloseTo(0.0722);
    expect(m[5]).toBeCloseTo(0.2126);
    expect(m[10]).toBeCloseTo(0.2126);
    const pixels = new Uint8ClampedArray([255, 0, 0, 255]);
    applyColorMatrixToPixels(pixels, m);
    expect(pixels[0]).toBe(pixels[1]);
    expect(pixels[1]).toBe(pixels[2]);
    expect(pixels[0]).toBe(54);
  });

  it("maps white balance: warm raises red and lowers blue, tint cuts green", () => {
    const warm = colorMatrixFor(correction({ temperature: 100 }));
    expect(warm[0]).toBeCloseTo(1.25);
    expect(warm[6]).toBeCloseTo(1);
    expect(warm[12]).toBeCloseTo(0.75);
    const cool = colorMatrixFor(correction({ temperature: -100 }));
    expect(cool[0]).toBeCloseTo(0.75);
    expect(cool[12]).toBeCloseTo(1.25);
    const magenta = colorMatrixFor(correction({ tint: 100 }));
    expect(magenta[6]).toBeCloseTo(0.8);
    expect(magenta[0]).toBeCloseTo(1.1);
  });

  it("produces the same matrix as the SVG values string", () => {
    const c = correction({ exposure: 25, contrast: -10, temperature: 30, tint: -5, saturation: 40 });
    const fromString = feColorMatrixValues(c).split(" ").map(Number);
    const matrix = colorMatrixFor(c);
    expect(fromString).toHaveLength(20);
    fromString.forEach((value, i) => expect(value).toBeCloseTo(matrix[i], 5));
  });

  it("clamps and sanitizes untrusted values", () => {
    expect(clampColorCorrection(correction({ exposure: 500 })).exposure).toBe(100);
    expect(clampColorCorrection(correction({ exposure: Number.NaN })).exposure).toBe(0);
    expect(sanitizeColorCorrection({ exposure: 20, bogus: 1 })).toEqual(
      correction({ exposure: 20 }),
    );
    expect(sanitizeColorCorrection("nope")).toBeUndefined();
    expect(sanitizeColorCorrection(undefined)).toBeUndefined();
  });
});

describe("auto fix", () => {
  it("falls back to the conservative preset without statistics", () => {
    expect(autoFixColorCorrection(null)).toEqual(AUTO_FIX_FALLBACK);
    expect(autoFixColorCorrection(null)).not.toBe(AUTO_FIX_FALLBACK);
  });

  it("lifts a dark, flat, blue image and leaves a balanced one near neutral", () => {
    const dark = autoFixColorCorrection({
      meanR: 40, meanG: 48, meanB: 72, meanLuma: 48, stdLuma: 20,
    });
    expect(dark.exposure).toBeGreaterThan(50);
    expect(dark.contrast).toBeGreaterThan(0);
    expect(dark.temperature).toBeGreaterThan(0);

    const balanced = autoFixColorCorrection({
      meanR: 128, meanG: 128, meanB: 128, meanLuma: 128, stdLuma: 55,
    });
    expect(balanced.exposure).toBe(0);
    expect(balanced.contrast).toBe(0);
    expect(balanced.temperature).toBe(0);
    expect(balanced.tint).toBe(0);
  });

  it("computes statistics from synthetic pixels", () => {
    // Two pixels: pure red and pure blue.
    const pixels = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]);
    const stats = imageStatisticsFromPixels(pixels);
    expect(stats).not.toBeNull();
    expect(stats?.meanR).toBeCloseTo(127.5);
    expect(stats?.meanB).toBeCloseTo(127.5);
    expect(stats?.meanG).toBe(0);
    expect(imageStatisticsFromPixels(new Uint8ClampedArray(0))).toBeNull();
    const fix = autoFixColorCorrection(stats);
    expect(fix.tint).toBeLessThan(0); // green is missing, so shift away from magenta
  });
});

describe("schema integration", () => {
  function projectWithCorrection() {
    const p = makeStudioProject("Colour");
    p.scenes[0].elements.push(
      {
        kind: "image", id: "img-1", startMs: 0, durationMs: 4000,
        asset: { r2Key: "u/a/p/photo.png", kind: "image" },
        colorCorrection: { exposure: 20, contrast: 10, temperature: -15, tint: 5, saturation: 30 },
      },
      {
        kind: "footage", id: "ft-1", startMs: 0, durationMs: 4000,
        asset: { r2Key: "u/a/p/clip.mp4", kind: "video" },
        sourceInMs: 0, sourceOutMs: 4000, speed: 1, volume: 1,
        colorCorrection: { exposure: -10, contrast: 0, temperature: 25, tint: 0, saturation: -20 },
      },
    );
    return p;
  }

  it("validates in-range corrections and flags out-of-range ones", () => {
    const p = projectWithCorrection();
    expect(validateStudioProject(p)).toEqual([]);
    const el = p.scenes[0].elements[0];
    if (el.colorCorrection) el.colorCorrection.exposure = 101;
    const problems = validateStudioProject(p);
    expect(problems.some((x) => x.includes("colour correction"))).toBe(true);
  });

  it("round trips corrections through the OCF mapping without a sidecar", () => {
    const p = projectWithCorrection();
    const { project } = studioToOCF(p);
    const image = project.scenes[0].objects.find((o) => o.id === "img-1");
    expect(image?.extensions?.["x-finch-studio"]?.colorCorrection).toEqual(
      p.scenes[0].elements[0].colorCorrection,
    );
    const back = ocfToStudio(project);
    expect(back.scenes[0].elements.find((e) => e.id === "img-1")?.colorCorrection).toEqual(
      p.scenes[0].elements[0].colorCorrection,
    );
    expect(back.scenes[0].elements.find((e) => e.id === "ft-1")?.colorCorrection).toEqual(
      p.scenes[0].elements[1].colorCorrection,
    );
  });

  it("round trips corrections losslessly with the sidecar", () => {
    const p = projectWithCorrection();
    const { project, sidecar } = studioToOCF(p);
    expect(ocfToStudio(project, sidecar)).toEqual(p);
  });

  it("leaves untouched elements without any correction metadata", () => {
    const p = makeStudioProject("Plain");
    p.scenes[0].elements.push({
      kind: "image", id: "img-2", startMs: 0, durationMs: 1000,
      asset: { r2Key: "u/a/p/plain.png", kind: "image" },
    });
    const { project } = studioToOCF(p);
    const image = project.scenes[0].objects.find((o) => o.id === "img-2");
    expect(image?.extensions).toBeUndefined();
    const back = ocfToStudio(project);
    expect(back.scenes[0].elements[0].colorCorrection).toBeUndefined();
  });
});
