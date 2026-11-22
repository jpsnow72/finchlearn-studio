import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "../accessibility";

/**
 * Contrast pins for the Studio EDITOR surface (issues #178, #193,
 * #194, #195; round 3 axe color-contrast, nodeCount 9-11).
 *
 * Three seats failed AA in the round 3 audit of studio-editor:
 *  1. The stage title text (an h1 inside a text object) at 1.2:1:
 *     TextView set no color, so scene text inherited the app chrome's
 *     --text (#e8eaf0) onto the default white scene background.
 *  2. The inactive stage-control toggles (Stage aspect / Duplicate at /
 *     safe zones) at 1.2:1: .guide-toggle paints a white surface (the
 *     --surface token is undefined in this theme, so its #fff fallback
 *     applies) and set no color, inheriting --text the same way.
 *  3. White text on --accent2 (#4c7dd9) at 4.01:1 (button.primary,
 *     button.active, .seg button.active, .tl-scene.active): NOT pinned
 *     here as fixed. No existing token reaches 4.5:1 with white text;
 *     darkening --accent2 is a palette decision, recorded in the lane
 *     FIX-REPORT for the design loop.
 *
 * jsdom has no cascade for external stylesheets, so, like
 * shellContrast.test.ts, these pins read the shipped sources, resolve
 * the tokens the rules actually bind, and lock seats 1 and 2 at
 * WCAG AA (>= 4.5:1).
 */
const CSS = readFileSync(
  fileURLToPath(new URL("../studio.css", import.meta.url)),
  "utf8",
);
const RENDERER = readFileSync(
  fileURLToPath(
    new URL("../components/StudioObjectRenderer.tsx", import.meta.url),
  ),
  "utf8",
);

function rootVar(name: string): string {
  const m = CSS.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{3,6})\\s*;`));
  expect(m, `--${name} token`).not.toBeNull();
  return m![1];
}

function ruleBody(selector: string): string {
  const start = CSS.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThan(-1);
  return CSS.slice(start, CSS.indexOf("}", start));
}

describe("editor stage-control toggle contrast", () => {
  it("binds guide-toggle text to a token that passes AA on its white surface", () => {
    const rule = ruleBody(".guide-toggle");
    // The rule's background is var(--surface, #fff); --surface is not
    // defined in this theme, so the painted surface is the fallback.
    expect(CSS).not.toMatch(/--surface:\s*#/);
    expect(rule).toContain("background: var(--surface, #fff)");
    const color = rule.match(/color:\s*var\(--([a-z0-9-]+)\)/);
    expect(color, "guide-toggle color binding").not.toBeNull();
    const ratio = contrastRatio(rootVar(color![1]), "#ffffff");
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeGreaterThanOrEqual(4.5);
  });

  it("does not let guide-toggle text fall back to the dark theme text token", () => {
    // --text on the white toggle surface is the original 1.2:1 failure.
    expect(contrastRatio(rootVar("text"), "#ffffff")!).toBeLessThan(4.5);
    expect(ruleBody(".guide-toggle")).not.toContain("color: var(--text)");
  });
});

describe("editor stage text default ink", () => {
  it("gives TextView a default ink that passes AA on the default white scene", () => {
    const start = RENDERER.indexOf("function TextView");
    expect(start).toBeGreaterThan(-1);
    const body = RENDERER.slice(start, start + 1600);
    const ink = body.match(/color:\s*"(#[0-9a-fA-F]{6})"/);
    expect(ink, "TextView default color").not.toBeNull();
    const ratio = contrastRatio(ink![1], "#ffffff");
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps the motion-graphic textColor override after the default ink", () => {
    const start = RENDERER.indexOf("function TextView");
    const body = RENDERER.slice(start, start + 1600);
    const inkAt = body.search(/color:\s*"#[0-9a-fA-F]{6}"/);
    const overrideAt = body.indexOf("style.color = meta.params.textColor");
    expect(inkAt).toBeGreaterThan(-1);
    expect(overrideAt).toBeGreaterThan(inkAt);
  });
});
