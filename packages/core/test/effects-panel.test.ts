/**
 * Studio effects panel parity (issue #112).
 *
 * The panel offers the full shared registry: the two registry
 * effects without preset variants (Baseline Reveal, Block Reveal)
 * become applicable Studio presets whose labels, expansions, and
 * timing defaults all come from the registry definitions, and every
 * preset's default timing is the registry default for its parent
 * effect rather than the flat 600ms the panel used before.
 */
import { describe, expect, it } from "vitest";
import {
  ANIMATION_PRESETS,
  expandAnimationPreset,
  presetDefaults,
  sampleAnimations,
} from "../src/animations.js";
import { EFFECTS, getEffect } from "../src/effects.js";

describe("registry effect presets (issue #112)", () => {
  it("offers every registry effect in the picker list", () => {
    // 33 variant-derived presets plus baselineReveal and blockReveal.
    expect(ANIMATION_PRESETS).toHaveLength(35);
    for (const effect of EFFECTS) {
      const covered =
        effect.variants.some((variant) => variant.presetName !== null) ||
        ANIMATION_PRESETS.some((preset) => preset.label === effect.label);
      expect(covered, effect.id).toBe(true);
    }
  });

  it("builds the baseline and block entries from the registry definitions", () => {
    const baseline = ANIMATION_PRESETS.find((p) => p.name === "baselineReveal");
    expect(baseline?.label).toBe(getEffect("baseline-reveal")?.label);
    expect(baseline?.category).toBe("enter");
    const block = ANIMATION_PRESETS.find((p) => p.name === "blockReveal");
    expect(block?.label).toBe(getEffect("block-reveal")?.label);
    expect(block?.category).toBe("enter");
  });

  it("expands baseline reveal from the registry recipe", () => {
    expect(
      expandAnimationPreset("baselineReveal", { start: 100, duration: 500 }),
    ).toEqual([
      { property: "y", from: 16, to: 0, start: 100, duration: 500 },
      { property: "opacity", from: 0, to: 1, start: 100, duration: 500 },
    ]);
  });

  it("expands block reveal from the registry recipe", () => {
    expect(expandAnimationPreset("blockReveal", { duration: 600 })).toEqual([
      { property: "wipeRight", from: 0, to: 1, start: 0, duration: 600 },
      { property: "opacity", from: 0, to: 1, start: 0, duration: 600 },
    ]);
  });

  it("samples the two new presets through the shared sampler", () => {
    const animations = {
      presets: [{ name: "baselineReveal" as const, start: 0, duration: 500 }],
    };
    const mid = sampleAnimations(animations, 250);
    expect(mid.y).toBeGreaterThan(0);
    expect(mid.y).toBeLessThan(16);
    expect(mid.opacity).toBeGreaterThan(0);
    expect(mid.opacity).toBeLessThan(1);
    const done = sampleAnimations(animations, 500);
    expect(done.y).toBe(0);
    expect(done.opacity).toBe(1);
    const blockMid = sampleAnimations(
      { presets: [{ name: "blockReveal" as const, start: 0, duration: 600 }] },
      300,
    );
    expect(blockMid.wipeRight).toBeGreaterThan(0);
    expect(blockMid.wipeRight).toBeLessThan(1);
  });
});

describe("preset registry defaults (issue #112)", () => {
  it("returns the spec defaults for the spec effects' presets", () => {
    expect(presetDefaults("fadeIn")).toEqual({ start: 0, duration: 400 });
    expect(presetDefaults("slideInLeft")).toEqual({ start: 0, duration: 500 });
    expect(presetDefaults("slideOutRight")).toEqual({ start: 0, duration: 500 });
    expect(presetDefaults("zoomIn")).toEqual({ start: 0, duration: 400 });
    expect(presetDefaults("wipeInLeft")).toEqual({ start: 0, duration: 600 });
    expect(presetDefaults("baselineReveal")).toEqual({ start: 0, duration: 500 });
    expect(presetDefaults("typewriterReveal")).toEqual({
      start: 0,
      duration: 1200,
    });
    expect(presetDefaults("blockReveal")).toEqual({ start: 0, duration: 600 });
    expect(presetDefaults("emphasisPulse")).toEqual({
      start: 0,
      duration: 1500,
    });
    expect(presetDefaults("float")).toEqual({ start: 0, duration: 2500 });
  });

  it("returns the registry defaults for Studio extras", () => {
    expect(presetDefaults("kenBurns")).toEqual({ start: 0, duration: 6000 });
    expect(presetDefaults("bounce")).toEqual({ start: 0, duration: 800 });
    expect(presetDefaults("emphasisShake")).toEqual({ start: 0, duration: 600 });
  });
});
