import { describe, expect, it } from "vitest";
import {
  expandAnimationPreset,
  sampleAnimations,
} from "@finch-studio/core";
import { timelineStyleFor } from "./animatedStyle.js";

describe("animation effect presets", () => {
  it("expands enter and exit presets into timeline tracks", () => {
    expect(expandAnimationPreset("slideOutLeft", { start: 200, duration: 500 })).toEqual([
      { property: "x", from: 0, to: -300, start: 200, duration: 500 },
      { property: "opacity", from: 1, to: 0, start: 200, duration: 500 },
    ]);
    expect(expandAnimationPreset("wipeInRight", { duration: 400 })).toEqual([
      { property: "wipeRight", from: 0, to: 1, start: 0, duration: 400 },
    ]);
  });

  it("samples delay, duration, and emphasis through the shared timeline", () => {
    const animations = {
      presets: [{ name: "fadeIn" as const, start: 100, duration: 400 }],
    };
    expect(sampleAnimations(animations, 100).opacity).toBe(0);
    expect(sampleAnimations(animations, 500).opacity).toBe(1);
    expect(sampleAnimations({
      presets: [{ name: "emphasisPulse", start: 0, duration: 400 }],
    }, 200).scale).toBeCloseTo(1.16);
    expect(sampleAnimations({
      presets: [{ name: "emphasisPulse", start: 0, duration: 400 }],
    }, 400).scale).toBe(1);
    const fadeBoth = {
      presets: [
        { name: "fadeIn" as const, start: 0, duration: 400 },
        { name: "fadeOut" as const, start: 600, duration: 400 },
      ],
    };
    expect(sampleAnimations(fadeBoth, 200).opacity).toBeGreaterThan(0);
    expect(sampleAnimations(fadeBoth, 500).opacity).toBe(1);
    expect(sampleAnimations(fadeBoth, 800).opacity).toBeLessThan(1);
  });

  it("converts wipe presets to CSS clipping", () => {
    const style = timelineStyleFor({
      presets: [{ name: "wipeInLeft", duration: 400 }],
    }, 200);
    expect(style.clipPath).toMatch(/^inset\(0 /);
  });
});
