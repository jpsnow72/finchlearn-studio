import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ACTIONS, ACTION_NAMES, sampleAction } from "./actions.js";
import { BONE_IDS } from "./skeleton.js";
import { EXPRESSION_NAMES, MOUTH_PATHS, type MouthShapeId } from "./expressions.js";
import {
  buildCharacter,
  CANONICAL_LEGACY_ID,
  characterById,
  characterForLegacyId,
  STUDIO_CHARACTERS,
  STYLE_FAMILIES,
} from "./defs.js";
import { RiggedCharacter } from "./RiggedCharacter.js";

const familyD = STUDIO_CHARACTERS.filter((c) => c.family === "D");
const render = (props: Parameters<typeof RiggedCharacter>[0]) =>
  renderToStaticMarkup(createElement(RiggedCharacter, props));

describe("family D registration (#53)", () => {
  it("registers Bold Ink Editorial alongside the approved families", () => {
    expect(Object.keys(STYLE_FAMILIES).sort()).toEqual(["A", "B", "D"]);
    expect(STYLE_FAMILIES.D.name).toBe("Bold Ink Editorial");
  });

  it("is visually distinct from A and B in its shape language", () => {
    const d = STYLE_FAMILIES.D;
    expect(d.outlineColor).toBeTruthy();
    expect(d.angular).toBe(true);
    expect(STYLE_FAMILIES.A.outlineColor).toBeUndefined();
    expect(STYLE_FAMILIES.B.outlineColor).toBeUndefined();
    expect(d.softShading).toBe(false);
    expect(STYLE_FAMILIES.B.softShading).toBe(true);
    expect(d.roundness).toBeLessThan(STYLE_FAMILIES.A.roundness);
    expect(d.headScale).not.toBe(STYLE_FAMILIES.A.headScale);
    expect(d.headScale).not.toBe(STYLE_FAMILIES.B.headScale);
  });

  it("ships a launch cast of two fully defined characters", () => {
    expect(familyD.map((c) => c.id).sort()).toEqual(["marcus", "priya"]);
    for (const def of familyD) {
      expect(def.name.length).toBeGreaterThan(0);
      expect(def.skin).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(def.hairColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(def.topColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(def.bottomColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(def.shoeColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
    // The two D hair styles are new to the system and used by the cast.
    expect(familyD.map((c) => c.hairStyle).sort()).toEqual(["fade", "ponytail"]);
  });

  it("uses no em dashes in user facing names", () => {
    expect(STYLE_FAMILIES.D.name).not.toContain("—");
    for (const def of STUDIO_CHARACTERS) expect(def.name).not.toContain("—");
  });
});

describe("family D cast completeness on the shared skeleton (#53)", () => {
  it("every D character performs every action with finite bone transforms", () => {
    for (const def of familyD) {
      for (const name of ACTION_NAMES) {
        const a = ACTIONS[name];
        for (const tMs of [0, a.durationMs / 2, a.durationMs]) {
          const pose = sampleAction(a, tMs);
          for (const bone of BONE_IDS) {
            expect(Number.isFinite(pose[bone].rotate)).toBe(true);
            expect(Number.isFinite(pose[bone].dx)).toBe(true);
            expect(Number.isFinite(pose[bone].dy)).toBe(true);
          }
          const html = render({ def, action: name, tMs });
          expect(html).toContain("<svg");
          expect(html).toContain(def.name);
        }
      }
    }
  });

  it("every D character renders every expression", () => {
    for (const def of familyD) {
      for (const expression of EXPRESSION_NAMES) {
        const html = render({ def, expression, tMs: 0 });
        expect(html).toContain("<svg");
        expect(html).toContain(def.name);
      }
    }
  });

  it("every D character renders every viseme mouth shape for lip sync", () => {
    for (const def of familyD) {
      for (const mouth of Object.keys(MOUTH_PATHS) as MouthShapeId[]) {
        const html = render({ def, mouthOverride: mouth, tMs: 0 });
        expect(html).toContain(MOUTH_PATHS[mouth]);
      }
    }
  });

  it("family D rendering carries the ink outline; family A does not", () => {
    const priya = characterById("priya");
    const htmlD = render({ def: priya, tMs: 0 });
    expect(htmlD).toContain(`stroke="${STYLE_FAMILIES.D.outlineColor}"`);
    const maya = characterById("maya");
    const htmlA = render({ def: maya, tMs: 0 });
    expect(htmlA).not.toContain(`stroke="${STYLE_FAMILIES.D.outlineColor}"`);
    // A and B output is unchanged in silhouette: no stroke attributes at
    // the part level beyond the face strokes that were always there.
    expect(htmlA).not.toContain("stroke-linejoin");
  });

  it("the new hair styles render distinct art", () => {
    const priya = render({ def: characterById("priya"), tMs: 0 });
    const marcus = render({ def: characterById("marcus"), tMs: 0 });
    const leo = render({ def: characterById("leo"), tMs: 0 });
    expect(priya).not.toBe(marcus);
    expect(priya).not.toBe(leo);
    expect(marcus).not.toBe(leo);
  });
});

describe("family D picker and customization wiring (#53)", () => {
  it("every cast member round trips through its canonical legacy id", () => {
    for (const def of STUDIO_CHARACTERS) {
      const legacy = CANONICAL_LEGACY_ID[def.id];
      expect(legacy, def.id).toBeTruthy();
      expect(characterForLegacyId(legacy).id).toBe(def.id);
    }
  });

  it("customization can build new family D characters", () => {
    const built = buildCharacter("u-d", "Mine", { family: "D", hairStyle: "ponytail" });
    expect(built.family).toBe("D");
    expect(built.hairStyle).toBe("ponytail");
    const html = render({ def: built, action: "wave", tMs: 200 });
    expect(html).toContain("<svg");
    expect(html).toContain(`stroke="${STYLE_FAMILIES.D.outlineColor}"`);
  });
});
