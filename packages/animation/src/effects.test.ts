import { describe, expect, it } from "vitest";
import {
  expandAnimationPreset,
  sampleAnimations,
} from "@finch-studio/core";
import {
  baselineRevealClipPath,
  blockRevealOverlayStyle,
  timelineStyleFor,
} from "./animatedStyle.js";

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

describe("baseline and block reveal rendering (issue #112)", () => {
  it("samples baseline reveal as a rise and fade through the shared style bridge", () => {
    const animations = {
      presets: [{ name: "baselineReveal" as const, start: 0, duration: 500 }],
    };
    const style = timelineStyleFor(animations, 250);
    // easeOut at the window midpoint: y settles 16 -> 2, opacity 0 -> 0.875.
    expect(style.transform).toBe("translateY(2px)");
    expect(style.opacity).toBeCloseTo(0.875);
    expect(timelineStyleFor(animations, 500)).toEqual({ opacity: 1 });
  });

  it("masks the part of a baseline reveal still below its baseline", () => {
    const animations = {
      presets: [{ name: "baselineReveal" as const, start: 0, duration: 500 }],
    };
    expect(baselineRevealClipPath(animations, 0)).toBe("inset(0 0 16px 0)");
    expect(baselineRevealClipPath(animations, 250)).toBe("inset(0 0 2px 0)");
    expect(baselineRevealClipPath(animations, 500)).toBeUndefined();
    expect(
      baselineRevealClipPath({ presets: [{ name: "fadeIn" as const }] }, 250),
    ).toBeUndefined();
  });

  it("rides the block reveal overlay on the reveal front inside its window only", () => {
    const animations = {
      presets: [{ name: "blockReveal" as const, start: 100, duration: 600 }],
    };
    expect(blockRevealOverlayStyle(animations, 50)).toBeNull();
    expect(blockRevealOverlayStyle(animations, 700)).toBeNull();
    expect(
      blockRevealOverlayStyle({ presets: [{ name: "fadeIn" as const }] }, 400),
    ).toBeNull();
    // Window start: nothing revealed yet, the slab sits at the right edge.
    const entering = blockRevealOverlayStyle(animations, 100);
    expect(entering?.left).toBe("86%");
    expect(entering?.width).toBe("14%");
    // Midpoint: wipeRight eased to 0.875, so the front is at 12.5% and
    // the slab has shrunk against the left edge.
    const mid = blockRevealOverlayStyle(animations, 400);
    expect(mid?.left).toBe("0%");
    expect(mid?.width).toBe("12.5%");
    expect(mid?.position).toBe("absolute");
  });

  it("clips block reveal through the shared wipe conversion", () => {
    const style = timelineStyleFor({
      presets: [{ name: "blockReveal", start: 0, duration: 600 }],
    }, 300);
    expect(style.clipPath).toBe("inset(0 0 0 12.5%)");
  });
});
