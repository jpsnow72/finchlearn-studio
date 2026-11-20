/**
 * Shared Effects Core registry tests (Studio issue #111, G7).
 *
 * Drift prevention, two layers:
 * 1. A content hash pin of the registry body: everything in
 *    src/effects.ts below the mirrored-body marker line. Any edit to
 *    the mirrored body (types, data, or helpers) fails this test until
 *    the pin is updated, and the pin may only move when the same edit
 *    lands in the course repo mirror in the same wave.
 * 2. The spec default table pin: the nine spec effects with their
 *    default durations (and the loop flags for Pulse and Float).
 *
 * The cross-repo byte diff lives in the course repo's sync script
 * (packages/core/scripts/sync-effects.mjs in open-course-format).
 *
 * Studio stability pins: every preset Studio shipped before the
 * registry keeps its name, label, and picker group, and expands to
 * exactly the tracks it expanded to before, so saved projects render
 * identically. Two documented adoptions: the fade hints take the
 * registry wording (an arrow in place of the word "to"), and float
 * joins the preset list (previously it existed only as a motion
 * package preset) in the Motion picker group.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ANIMATION_PRESETS,
  DEFAULT_KEN_BURNS,
  EASING_NAMES,
  expandAnimationPreset,
  sampleAnimations,
} from "../src/animations.js";
import {
  EFFECTS,
  EFFECTS_REGISTRY_BODY,
  getEffect,
  getEffectVariant,
  listEffectVariants,
} from "../src/effects.js";

const MARKER =
  "// === SHARED EFFECTS REGISTRY: MIRRORED BODY BELOW THIS LINE ===";

/** SHA-256 of everything in src/effects.ts after the marker line. */
const EXPECTED_BODY_SHA256 =
  "764a02486528b9cd631082bc0ac924d088c8bcb64c49a772bbb0fa17dd57feca";

function effectsSource(): string {
  return readFileSync(new URL("../src/effects.ts", import.meta.url), "utf8");
}

describe("registry body hash pin", () => {
  it("hashes the source below the marker line to the pinned value", () => {
    const src = effectsSource();
    const idx = src.indexOf(MARKER);
    expect(idx).toBeGreaterThanOrEqual(0);
    const body = src.slice(idx + MARKER.length + 1);
    const hash = createHash("sha256").update(body, "utf8").digest("hex");
    expect(hash).toBe(EXPECTED_BODY_SHA256);
  });

  it("the registry data literal is pure JSON and round-trips", () => {
    const src = effectsSource();
    const startTag = "/* REGISTRY-JSON-START */";
    const endTag = "/* REGISTRY-JSON-END */";
    const start = src.indexOf(startTag);
    const end = src.indexOf(endTag);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const literal = src.slice(start + startTag.length, end).trim();
    const parsed = JSON.parse(literal) as unknown;
    expect(parsed).toEqual(JSON.parse(JSON.stringify(EFFECTS_REGISTRY_BODY)));
    expect(parsed).toEqual(EFFECTS_REGISTRY_BODY);
  });
});

describe("spec default table", () => {
  // Spec table (PROGRAM.md G7 / SPEC section 3): duration in ms, with
  // Pulse and Float looping. Delay defaults to 0 for every effect.
  const SPEC_DEFAULTS: Record<string, { durationMs: number; loop: boolean }> = {
    fade: { durationMs: 400, loop: false },
    slide: { durationMs: 500, loop: false },
    "scale-up": { durationMs: 400, loop: false },
    wipe: { durationMs: 600, loop: false },
    "baseline-reveal": { durationMs: 500, loop: false },
    typewriter: { durationMs: 1200, loop: false },
    "block-reveal": { durationMs: 600, loop: false },
    pulse: { durationMs: 1500, loop: true },
    float: { durationMs: 2500, loop: true },
  };

  it("pins every spec effect's default duration and loop flag", () => {
    for (const [id, expected] of Object.entries(SPEC_DEFAULTS)) {
      const effect = getEffect(id);
      expect(effect, `missing spec effect ${id}`).toBeDefined();
      expect(effect!.defaultDurationMs).toBe(expected.durationMs);
      expect(effect!.loop).toBe(expected.loop);
      expect(effect!.defaultDelayMs).toBe(0);
    }
  });

  it("carries the Studio extras both sides adopt", () => {
    for (const id of [
      "word-reveal",
      "line-reveal",
      "shake",
      "spin",
      "bounce",
      "ken-burns",
      "chart-sting-grow",
      "chart-sting-sweep",
    ]) {
      expect(getEffect(id), `missing extra ${id}`).toBeDefined();
    }
    // pop-in and pop-out ride as variants of scale-up.
    expect(getEffectVariant("popIn")?.effect.id).toBe("scale-up");
    expect(getEffectVariant("popOut")?.effect.id).toBe("scale-up");
    // The exit set rides as exit variants of its families.
    expect(getEffectVariant("fadeOut")?.effect.id).toBe("fade");
    expect(getEffectVariant("slideOutLeft")?.effect.id).toBe("slide");
    expect(getEffectVariant("wipeOutDown")?.effect.id).toBe("wipe");
    expect(getEffectVariant("zoomOut")?.effect.id).toBe("scale-up");
  });

  it("effect ids and preset names are unique", () => {
    const ids = EFFECTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(17);
    const names = listEffectVariants().map((v) => v.variant.presetName);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toHaveLength(33);
  });

  it("slide and wipe carry direction variants", () => {
    expect(getEffect("slide")!.directions).toEqual(["left", "right", "up", "down"]);
    expect(getEffect("wipe")!.directions).toEqual(["left", "right", "up", "down"]);
  });
});

describe("ANIMATION_PRESETS derived from the registry", () => {
  // The 32 presets Studio shipped before the registry, with their
  // labels and picker groups. The two fade hints below are the
  // registry wording; Studio previously wrote them with the word
  // "to" in place of the arrow. Every other hint is unchanged.
  const LEGACY_STUDIO_PRESETS = [
    { name: "fadeIn", label: "Fade in", hint: "Opacity 0 → 1", category: "enter" },
    { name: "slideInLeft", label: "Slide in from left", hint: "Moves in from the left", category: "enter" },
    { name: "slideInRight", label: "Slide in from right", hint: "Moves in from the right", category: "enter" },
    { name: "slideInUp", label: "Slide in from bottom", hint: "Moves up into place", category: "enter" },
    { name: "slideInDown", label: "Slide in from top", hint: "Moves down into place", category: "enter" },
    { name: "popIn", label: "Pop in", hint: "Scales and fades into place", category: "enter" },
    { name: "zoomIn", label: "Zoom in", hint: "Scales up into place", category: "enter" },
    { name: "wipeInLeft", label: "Wipe in from left", hint: "Reveals from the left", category: "enter" },
    { name: "wipeInRight", label: "Wipe in from right", hint: "Reveals from the right", category: "enter" },
    { name: "wipeInUp", label: "Wipe in from top", hint: "Reveals from the top", category: "enter" },
    { name: "wipeInDown", label: "Wipe in from bottom", hint: "Reveals from the bottom", category: "enter" },
    { name: "bounce", label: "Bounce in", hint: "Drops in with a bounce", category: "enter" },
    { name: "fadeOut", label: "Fade out", hint: "Opacity 1 → 0", category: "exit" },
    { name: "slideOutLeft", label: "Slide out left", hint: "Moves off to the left", category: "exit" },
    { name: "slideOutRight", label: "Slide out right", hint: "Moves off to the right", category: "exit" },
    { name: "slideOutUp", label: "Slide out up", hint: "Moves off the top", category: "exit" },
    { name: "slideOutDown", label: "Slide out down", hint: "Moves off the bottom", category: "exit" },
    { name: "popOut", label: "Pop out", hint: "Scales and fades away", category: "exit" },
    { name: "zoomOut", label: "Zoom out", hint: "Scales down and fades away", category: "exit" },
    { name: "wipeOutLeft", label: "Wipe out left", hint: "Closes toward the left", category: "exit" },
    { name: "wipeOutRight", label: "Wipe out right", hint: "Closes toward the right", category: "exit" },
    { name: "wipeOutUp", label: "Wipe out up", hint: "Closes toward the top", category: "exit" },
    { name: "wipeOutDown", label: "Wipe out down", hint: "Closes toward the bottom", category: "exit" },
    { name: "emphasisPulse", label: "Pulse", hint: "Briefly grows and returns", category: "emphasis" },
    { name: "emphasisShake", label: "Shake", hint: "Briefly shakes and returns", category: "emphasis" },
    { name: "emphasisSpin", label: "Spin", hint: "Rotates once", category: "emphasis" },
    { name: "kenBurns", label: "Ken Burns", hint: "Slow pan and zoom across a still", category: "motion" },
    { name: "chartStingGrow", label: "Chart sting: grow", hint: "Chart reveals upward with a settle", category: "enter" },
    { name: "chartStingSweep", label: "Chart sting: sweep", hint: "Chart sweeps in from the left", category: "enter" },
    { name: "typewriterReveal", label: "Typewriter reveal", hint: "Text appears character by character", category: "enter" },
    { name: "wordReveal", label: "Word by word reveal", hint: "Text appears word by word", category: "enter" },
    { name: "lineReveal", label: "Line by line reveal", hint: "Text appears line by line", category: "enter" },
  ] as const;

  it("keeps every historical Studio preset stable (name, label, hint, picker group)", () => {
    const byName = new Map(ANIMATION_PRESETS.map((p) => [p.name, p]));
    for (const expected of LEGACY_STUDIO_PRESETS) {
      const preset = byName.get(expected.name);
      expect(preset, `missing legacy preset ${expected.name}`).toBeDefined();
      expect(preset!.label).toBe(expected.label);
      expect(preset!.hint).toBe(expected.hint);
      expect(preset!.category).toBe(expected.category);
    }
  });

  it("lists every registry variant exactly once, float joining in Motion", () => {
    expect(ANIMATION_PRESETS).toHaveLength(33);
    const names = ANIMATION_PRESETS.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    const byName = new Map(ANIMATION_PRESETS.map((p) => [p.name, p]));
    expect(byName.get("float")).toEqual({
      name: "float",
      label: "Float",
      hint: "Gently floats up and down",
      category: "motion",
    });
    // Every picker group the EffectsEditor offers stays non-empty.
    for (const group of ["enter", "exit", "emphasis", "motion"] as const) {
      expect(
        ANIMATION_PRESETS.some((p) => p.category === group),
        `picker group ${group} is empty`,
      ).toBe(true);
    }
  });

  it("EASING_NAMES covers the easings the registry expansion can emit", () => {
    expect(EASING_NAMES).toContain("pulse");
    expect(EASING_NAMES).toContain("shake");
    expect(EASING_NAMES).toContain("bounce");
  });
});

describe("expandAnimationPreset: historical Studio recipes unchanged", () => {
  it("fade, slide, and scale entrances", () => {
    expect(expandAnimationPreset("fadeIn")).toEqual([
      { property: "opacity", from: 0, to: 1, start: 0, duration: 600 },
    ]);
    expect(expandAnimationPreset("slideInLeft")).toEqual([
      { property: "x", from: -300, to: 0, start: 0, duration: 600 },
      { property: "opacity", from: 0, to: 1, start: 0, duration: 600 },
    ]);
    expect(expandAnimationPreset("slideInUp", { distance: 120 })).toEqual([
      { property: "y", from: 120, to: 0, start: 0, duration: 600 },
      { property: "opacity", from: 0, to: 1, start: 0, duration: 600 },
    ]);
    expect(expandAnimationPreset("slideInDown", { start: 50, duration: 250 })).toEqual([
      { property: "y", from: -300, to: 0, start: 50, duration: 250 },
      { property: "opacity", from: 0, to: 1, start: 50, duration: 250 },
    ]);
    expect(expandAnimationPreset("zoomIn")).toEqual([
      { property: "scale", from: 0.3, to: 1, start: 0, duration: 600 },
      { property: "opacity", from: 0, to: 1, start: 0, duration: 600 },
    ]);
    expect(expandAnimationPreset("popIn")).toEqual([
      { property: "scale", from: 0.65, to: 1, start: 0, duration: 600, easing: "bounce" },
      { property: "opacity", from: 0, to: 1, start: 0, duration: 600 },
    ]);
  });

  it("bounce keeps the drop formula, the 800ms floor, and the 300ms fade", () => {
    expect(expandAnimationPreset("bounce")).toEqual([
      { property: "y", from: -100, to: 0, start: 0, duration: 800, easing: "bounce" },
      { property: "opacity", from: 0, to: 1, start: 0, duration: 300 },
    ]);
    expect(expandAnimationPreset("bounce", { distance: 600, duration: 1000 })).toEqual([
      { property: "y", from: -200, to: 0, start: 0, duration: 1000, easing: "bounce" },
      { property: "opacity", from: 0, to: 1, start: 0, duration: 300 },
    ]);
  });

  it("exit set", () => {
    expect(expandAnimationPreset("fadeOut")).toEqual([
      { property: "opacity", from: 1, to: 0, start: 0, duration: 600 },
    ]);
    expect(expandAnimationPreset("slideOutLeft", { start: 200, duration: 500 })).toEqual([
      { property: "x", from: 0, to: -300, start: 200, duration: 500 },
      { property: "opacity", from: 1, to: 0, start: 200, duration: 500 },
    ]);
    expect(expandAnimationPreset("slideOutDown")).toEqual([
      { property: "y", from: 0, to: 300, start: 0, duration: 600 },
      { property: "opacity", from: 1, to: 0, start: 0, duration: 600 },
    ]);
    expect(expandAnimationPreset("popOut")).toEqual([
      { property: "scale", from: 1, to: 0.65, start: 0, duration: 600 },
      { property: "opacity", from: 1, to: 0, start: 0, duration: 600 },
    ]);
    expect(expandAnimationPreset("zoomOut")).toEqual([
      { property: "scale", from: 1, to: 0.3, start: 0, duration: 600 },
      { property: "opacity", from: 1, to: 0, start: 0, duration: 600 },
    ]);
  });

  it("wipe set expands over the wipe properties", () => {
    expect(expandAnimationPreset("wipeInRight", { duration: 400 })).toEqual([
      { property: "wipeRight", from: 0, to: 1, start: 0, duration: 400 },
    ]);
    expect(expandAnimationPreset("wipeOutDown")).toEqual([
      { property: "wipeDown", from: 1, to: 0, start: 0, duration: 600 },
    ]);
  });

  it("emphasis set", () => {
    expect(expandAnimationPreset("emphasisPulse")).toEqual([
      { property: "scale", from: 1, to: 1.16, start: 0, duration: 600, easing: "pulse" },
    ]);
    expect(expandAnimationPreset("emphasisShake")).toEqual([
      { property: "rotation", from: 0, to: 8, start: 0, duration: 600, easing: "shake" },
    ]);
    expect(expandAnimationPreset("emphasisSpin")).toEqual([
      { property: "rotation", from: 0, to: 360, start: 0, duration: 600 },
    ]);
  });

  it("kinetic text presets expand to no tracks (the entry is the marker)", () => {
    expect(expandAnimationPreset("typewriterReveal")).toEqual([]);
    expect(expandAnimationPreset("wordReveal")).toEqual([]);
    expect(expandAnimationPreset("lineReveal")).toEqual([]);
  });

  it("kenBurns uses the registry default framing and honors authored framing", () => {
    expect(DEFAULT_KEN_BURNS).toEqual({
      from: { scale: 1, x: 0, y: 0 },
      to: { scale: 1.15, x: -24, y: -12 },
    });
    expect(expandAnimationPreset("kenBurns")).toEqual([
      { property: "scale", from: 1, to: 1.15, start: 0, duration: 600, easing: "easeInOut" },
      { property: "x", from: 0, to: -24, start: 0, duration: 600, easing: "easeInOut" },
      { property: "y", from: 0, to: -12, start: 0, duration: 600, easing: "easeInOut" },
    ]);
    expect(
      expandAnimationPreset("kenBurns", {
        kenBurns: {
          from: { scale: 1.2, x: 10, y: 5 },
          to: { scale: 1, x: 0, y: 0 },
        },
      }),
    ).toEqual([
      { property: "scale", from: 1.2, to: 1, start: 0, duration: 600, easing: "easeInOut" },
      { property: "x", from: 10, to: 0, start: 0, duration: 600, easing: "easeInOut" },
      { property: "y", from: 5, to: 0, start: 0, duration: 600, easing: "easeInOut" },
    ]);
  });

  it("chart stings", () => {
    expect(expandAnimationPreset("chartStingGrow")).toEqual([
      { property: "wipeUp", from: 0, to: 1, start: 0, duration: 600 },
      { property: "scale", from: 0.96, to: 1, start: 0, duration: 600 },
    ]);
    expect(expandAnimationPreset("chartStingSweep")).toEqual([
      { property: "wipeRight", from: 0, to: 1, start: 0, duration: 600 },
      { property: "opacity", from: 0, to: 1, start: 0, duration: 600 },
    ]);
  });
});

describe("float, promoted from the motion package into the core presets", () => {
  it("expands to the single pulse-eased y track", () => {
    expect(expandAnimationPreset("float")).toEqual([
      { property: "y", from: 0, to: -10, start: 0, duration: 600, easing: "pulse" },
    ]);
  });

  it("samples through sampleAnimations, lifting at the midpoint and resting after", () => {
    const animations = {
      presets: [{ name: "float" as const, start: 0, duration: 1000 }],
    };
    expect(sampleAnimations(animations, 500).y).toBeCloseTo(-10);
    expect(sampleAnimations(animations, 1000).y).toBe(0);
    expect(sampleAnimations(animations, 5000).y).toBe(0);
  });
});
