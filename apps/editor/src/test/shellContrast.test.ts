import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "../accessibility";

/**
 * Contrast pins for the workspace shell cards (issues #159, #170, #177).
 *
 * The shell page is dark themed (--text #e8eaf0 on --bg #14161c), but
 * .shell-card paints a white surface. The card originally set no color,
 * so card titles inherited --text and rendered at 1.2:1 on white,
 * virtually invisible. jsdom has no cascade for external stylesheets,
 * so these pins read the shipped stylesheet, resolve the theme tokens
 * the rules actually bind, and lock every shell text seat at WCAG AA
 * (>= 4.5:1) against the background it really sits on.
 */
const CSS = readFileSync(
  fileURLToPath(new URL("../studio.css", import.meta.url)),
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

function resolveColor(rule: string): string {
  const m = rule.match(/color:\s*([^;]+);/);
  expect(m, "color declaration").not.toBeNull();
  const value = m![1].trim();
  const varMatch = value.match(/^var\(--([a-z0-9-]+)\)$/i);
  return varMatch ? rootVar(varMatch[1]) : value;
}

function backgroundOf(rule: string): string {
  const m = rule.match(/background:\s*(#[0-9a-fA-F]{3,6})\s*;/);
  expect(m, "background declaration").not.toBeNull();
  return m![1];
}

describe("workspace shell card contrast", () => {
  it("binds shell-card text to a token that passes AA on the white card", () => {
    const card = ruleBody(".shell-card");
    const bg = backgroundOf(card);
    expect(bg.toLowerCase()).toBe("#fff");
    const ratio = contrastRatio(resolveColor(card), bg);
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeGreaterThanOrEqual(4.5);
  });

  it("does not let shell-card text fall back to the dark theme text token", () => {
    // --text on the white card is the original 1.2:1 failure.
    expect(contrastRatio(rootVar("text"), "#ffffff")!).toBeLessThan(4.5);
    expect(resolveColor(ruleBody(".shell-card")).toLowerCase()).not.toBe(
      rootVar("text").toLowerCase(),
    );
  });

  it("keeps the muted note inside a card passing AA on white", () => {
    const inner = ruleBody(".shell-card .shell-empty");
    const ratio = contrastRatio(resolveColor(inner), "#ffffff");
    expect(ratio!).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps page level shell-empty text passing AA on the page background", () => {
    const page = ruleBody(".shell-empty");
    const ratio = contrastRatio(resolveColor(page), rootVar("bg"));
    expect(ratio!).toBeGreaterThanOrEqual(4.5);
  });
});
