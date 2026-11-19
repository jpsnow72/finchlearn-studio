import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ACTIONS, ACTION_NAMES, sampleAction } from "./actions.js";
import { BONE_IDS } from "./skeleton.js";
import { EXPRESSIONS, EXPRESSION_NAMES, mouthAt, visemesFromText } from "./expressions.js";
import { buildCharacter, characterById, customizeCharacter, STUDIO_CHARACTERS, STYLE_FAMILIES } from "./defs.js";
import { RiggedCharacter } from "./RiggedCharacter.js";

describe("actions as data (#18)", () => {
  it("covers the full launch set", () => {
    expect(Object.keys(ACTIONS).sort()).toEqual([...ACTION_NAMES].sort());
  });
  it("every action samples finite transforms for every bone", () => {
    for (const name of ACTION_NAMES) {
      const a = ACTIONS[name];
      for (const tMs of [0, a.durationMs / 2, a.durationMs]) {
        const pose = sampleAction(a, tMs);
        for (const bone of BONE_IDS) {
          const tr = pose[bone];
          expect(Number.isFinite(tr.rotate)).toBe(true);
          expect(Number.isFinite(tr.dx)).toBe(true);
          expect(Number.isFinite(tr.dy)).toBe(true);
        }
      }
    }
  });
  it("sit lowers the root and bends the legs; walk cycles", () => {
    const sit = sampleAction(ACTIONS.sit, ACTIONS.sit.durationMs);
    expect(sit.root.dy).toBeGreaterThan(40);
    expect(Math.abs(sit.legUpperL.rotate)).toBeGreaterThan(60);
    const w0 = sampleAction(ACTIONS.walk, 0);
    const w1 = sampleAction(ACTIONS.walk, ACTIONS.walk.durationMs);
    expect(w0.legUpperL.rotate).toBeCloseTo(w1.legUpperL.rotate);
  });
});

describe("expressions and visemes (#19)", () => {
  it("all expressions resolve to mouth shapes that exist", () => {
    for (const name of EXPRESSION_NAMES) expect(EXPRESSIONS[name].mouth).toBeTruthy();
  });
  it("visemes track the text", () => {
    const cues = visemesFromText("mama");
    expect(cues[0].mouth).toBe("m");
    expect(mouthAt(cues, 0)).toBe("m");
    expect(mouthAt([], 100)).toBe("rest");
  });
});

describe("families and customization (#17, #20)", () => {
  it("both approved families exist and the launch cast covers them", () => {
    expect(STYLE_FAMILIES.A.name).toContain("Corporate");
    expect(STYLE_FAMILIES.B.name).toContain("Storybook");
    expect(STUDIO_CHARACTERS.some((c) => c.family === "A")).toBe(true);
    expect(STUDIO_CHARACTERS.some((c) => c.family === "B")).toBe(true);
  });
  it("customization changes only the chosen axes", () => {
    const maya = characterById("maya");
    const v = customizeCharacter(maya, { topColor: "#D95D39", hairStyle: "bun" });
    expect(v.topColor).toBe("#D95D39");
    expect(v.hairStyle).toBe("bun");
    expect(v.skin).toBe(maya.skin);
    const built = buildCharacter("u1", "Mine", { family: "B" });
    expect(built.family).toBe("B");
  });
  it("renders an SVG with the character label for both families", () => {
    for (const def of STUDIO_CHARACTERS) {
      const html = renderToStaticMarkup(createElement(RiggedCharacter, { def, action: "wave", tMs: 300 }));
      expect(html).toContain("<svg");
      expect(html).toContain(def.name);
    }
  });
});
