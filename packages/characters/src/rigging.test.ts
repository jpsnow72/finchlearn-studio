import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BONE_IDS, BONES } from "./skeleton.js";
import { ACTIONS, sampleAction } from "./actions.js";
import {
  PIN_IDS,
  boneMapFromPins,
  boneMapSegments,
  buildFacePack,
  buildRig,
  decideRigMode,
  detectJoints,
  faceForExpression,
  isValidCustomCharacterDef,
  jointSeparationScore,
  parseCustomCharacterLibrary,
  parseCustomCharacterRecord,
  rederiveRig,
  serializeCustomCharacter,
  withFacePack,
  withPins,
  withProportions,
  type CustomCharacterDef,
  type PinSet,
} from "./rigging.js";
import {
  SVG_TEMPLATE_GROUPS,
  SVG_TEMPLATE_SVG,
  matchSvgTemplate,
  pinsFromSvgTemplate,
  rigFromSvgTemplate,
  svgGroupNames,
} from "./svgTemplate.js";
import {
  GENERATION_NOT_CONFIGURED_MESSAGE,
  UnconfiguredGeneratedSource,
  CharacterGenerationNotConfiguredError,
} from "./sourcePort.js";
import { CustomCharacterFigure, RigPosePreview, worldJoints } from "./CustomCharacterFigure.js";
import { buildCharacter } from "./defs.js";

const detected = detectJoints({ width: 400, height: 800 });

function customDef(pins: PinSet = detected): CustomCharacterDef {
  const base = buildCharacter("custom-1", "Scout", {});
  const decision = decideRigMode({ sourceKind: "single", partCount: 0, jointSeparation: 0.2, hasTransparency: true });
  return {
    ...base,
    customRig: buildRig({
      sourceKind: "single-png",
      pins,
      detectedPins: detected,
      decision,
      baseImageRef: "data:image/png;base64,AAAA",
      imageSize: { width: 400, height: 800 },
    }),
  };
}

describe("joint detection and bone map generation from pins (#74)", () => {
  it("places a full pin set inside the measured content box", () => {
    const pins = detectJoints({
      width: 800,
      height: 800,
      content: { left: 0.25, top: 0.1, right: 0.75, bottom: 0.9 },
    });
    for (const id of PIN_IDS) {
      expect(pins[id].x).toBeGreaterThanOrEqual(0.25);
      expect(pins[id].x).toBeLessThanOrEqual(0.75);
      expect(pins[id].y).toBeGreaterThanOrEqual(0.1);
      expect(pins[id].y).toBeLessThanOrEqual(0.9);
    }
    expect(pins.headTop.y).toBeLessThan(pins.neck.y);
    expect(pins.ankleL.y).toBeGreaterThan(pins.kneeL.y);
    expect(pins.shoulderL.x).toBeLessThan(pins.shoulderR.x);
  });

  it("generates a bone map covering every skeleton bone, in order", () => {
    const map = boneMapFromPins(detected);
    expect(map.joints.map((j) => j.bone)).toEqual(BONES.map((b) => b.id));
    for (const j of map.joints) {
      expect(Number.isFinite(j.x)).toBe(true);
      expect(Number.isFinite(j.y)).toBe(true);
    }
    for (const bone of BONE_IDS) {
      if (bone === "root") continue;
      expect(map.lengths[bone]).toBeGreaterThan(0);
      expect(map.proportions[bone]).toBeGreaterThan(0.2);
      expect(map.proportions[bone]).toBeLessThan(3);
    }
    expect(boneMapSegments(map)).toHaveLength(BONES.length - 1);
  });

  it("wider shoulders in the pins produce wider arm proportions", () => {
    const narrow = boneMapFromPins(detected);
    const widePins: PinSet = {
      ...detected,
      shoulderL: { x: 0.2, y: detected.shoulderL.y },
      shoulderR: { x: 0.8, y: detected.shoulderR.y },
    };
    const wide = boneMapFromPins(widePins);
    expect(wide.joints.find((j) => j.bone === "armUpperR")!.x).toBeGreaterThan(
      narrow.joints.find((j) => j.bone === "armUpperR")!.x,
    );
  });

  it("proportion adjustments lengthen the segment and move its subtree", () => {
    const map = boneMapFromPins(detected);
    // The thigh segment ends at the knee joint (legLowerL).
    const longer = withProportions(map, { legLowerL: 1.5 });
    expect(longer.lengths.legLowerL!).toBeGreaterThan(map.lengths.legLowerL! * 1.4);
    const kneeBefore = map.joints.find((j) => j.bone === "legLowerL")!;
    const kneeAfter = longer.joints.find((j) => j.bone === "legLowerL")!;
    expect(kneeAfter.y).toBeGreaterThan(kneeBefore.y);
    // The other leg is untouched.
    expect(longer.lengths.legUpperR).toBe(map.lengths.legUpperR);
    expect(longer.lengths.legLowerR).toBe(map.lengths.legLowerR);
    // Input map is not mutated.
    expect(map.lengths.legLowerL).not.toBe(longer.lengths.legLowerL);
  });
});

describe("segmentation versus puppet warp decision (#74)", () => {
  it("per part uploads at full count segment; too few fall back", () => {
    const full = decideRigMode({ sourceKind: "parts", partCount: 8 });
    expect(full.mode).toBe("segmented");
    expect(full.quality).toBe("full-parts");
    const few = decideRigMode({ sourceKind: "parts", partCount: 3 });
    expect(few.mode).toBe("puppet-warp");
    expect(few.qualityNote).toContain("Mesh deformation");
  });

  it("a single image segments only when the joints measure clean", () => {
    const clean = decideRigMode({ sourceKind: "single", partCount: 0, jointSeparation: 0.85, hasTransparency: true });
    expect(clean.mode).toBe("segmented");
    const merged = decideRigMode({ sourceKind: "single", partCount: 0, jointSeparation: 0.2, hasTransparency: true });
    expect(merged.mode).toBe("puppet-warp");
    expect(merged.reason).toContain("does not separate cleanly");
    const opaque = decideRigMode({ sourceKind: "single", partCount: 0, jointSeparation: 0.95, hasTransparency: false });
    expect(opaque.mode).toBe("puppet-warp");
  });

  it("scores joint separation from visible fractions", () => {
    expect(jointSeparationScore([])).toBe(0);
    expect(jointSeparationScore([0, 0])).toBe(1);
    expect(jointSeparationScore([1, 1])).toBe(0);
    expect(jointSeparationScore([0.2, 0.4])).toBeCloseTo(0.7);
  });

  it("states quality honestly with no em dashes in the copy", () => {
    for (const input of [
      { sourceKind: "parts", partCount: 8 },
      { sourceKind: "single", partCount: 0, jointSeparation: 0.1, hasTransparency: true },
    ] as const) {
      const d = decideRigMode(input);
      expect(d.reason).not.toContain("—");
      expect(d.qualityNote).not.toContain("—");
    }
  });
});

describe("SVG named layer template matching (#74 Tier 3)", () => {
  it("the shipped template matches itself with nothing missing", () => {
    const match = matchSvgTemplate(SVG_TEMPLATE_SVG);
    expect(match.matches).toBe(true);
    expect(match.missing).toEqual([]);
    expect(match.present).toEqual(SVG_TEMPLATE_GROUPS);
    expect(svgGroupNames(SVG_TEMPLATE_SVG).sort()).toEqual([...SVG_TEMPLATE_GROUPS].sort());
  });

  it("extra groups are allowed and reported", () => {
    const withCape = SVG_TEMPLATE_SVG.replace("</svg>", '<g id="cape"><path d="M0 0 L4 4"/></g></svg>');
    const match = matchSvgTemplate(withCape);
    expect(match.matches).toBe(true);
    expect(match.extra).toContain("cape");
  });

  it("missing and renamed groups fail the match with the exact list", () => {
    const partial = '<svg><g id="head"></g><g id="torso"></g></svg>';
    const match = matchSvgTemplate(partial);
    expect(match.matches).toBe(false);
    expect(match.missing).toContain("arm-upper-left");
    expect(match.missing).toContain("leg-lower-right");
    const renamed = SVG_TEMPLATE_SVG.replace('id="head"', 'id="Head"');
    const renamedMatch = matchSvgTemplate(renamed);
    expect(renamedMatch.matches).toBe(false);
    expect(renamedMatch.missing).toEqual(["head"]);
    expect(rigFromSvgTemplate(partial)).toBeNull();
    expect(rigFromSvgTemplate(renamed)).toBeNull();
  });

  it("a matching upload rigs itself at full part quality with zero pins placed", () => {
    const rig = rigFromSvgTemplate(SVG_TEMPLATE_SVG);
    expect(rig).not.toBeNull();
    expect(rig!.mode).toBe("segmented");
    expect(rig!.quality).toBe("full-parts");
    expect(rig!.userAdjustedPins).toEqual([]);
    expect(rig!.parts).toHaveLength(SVG_TEMPLATE_GROUPS.length);
    const pins = pinsFromSvgTemplate();
    for (const id of PIN_IDS) expect(pins[id]).toBeTruthy();
    expect(rig!.boneMap.joints).toHaveLength(BONES.length);
  });
});

describe("face pack attachment (#74)", () => {
  it("builds a face pack anchored on the head with a blink range", () => {
    const map = boneMapFromPins(detected);
    const pack = buildFacePack(detected, map);
    const head = map.joints.find((j) => j.bone === "head")!;
    expect(Math.abs(pack.anchor.x - head.x)).toBeLessThan(2);
    expect(pack.scale).toBeGreaterThan(0.3);
    expect(pack.scale).toBeLessThan(3);
    expect(pack.blinkMs.min).toBeGreaterThan(0);
    expect(pack.blinkMs.max).toBeGreaterThan(pack.blinkMs.min);
  });

  it("attaches and replaces a face pack without mutating the rig", () => {
    const def = customDef();
    const pack = { ...def.customRig.facePack, scale: 1.4 };
    const next = withFacePack(def.customRig, pack);
    expect(next.facePack.scale).toBe(1.4);
    expect(def.customRig.facePack.scale).not.toBe(1.4);
    expect(next.pins).toBe(def.customRig.pins);
  });

  it("expression overrides ride the standard expression model", () => {
    const def = customDef();
    const pack = {
      ...def.customRig.facePack,
      expressionOverrides: { happy: { mouth: "laugh" as const } },
    };
    expect(faceForExpression(pack, "happy").mouth).toBe("laugh");
    expect(faceForExpression(pack, "neutral").mouth).toBe("rest");
  });

  it("a saved character reopens intact through the library round trip", () => {
    const def = customDef();
    const raw = serializeCustomCharacter(def, "2026-11-19T00:00:00.000Z");
    const record = parseCustomCharacterRecord(raw);
    expect(record?.def.id).toBe(def.id);
    expect(record?.def.customRig.pins).toEqual(def.customRig.pins);
    const library = parseCustomCharacterLibrary(JSON.stringify([record, { def: { id: "broken" } }, null]));
    expect(library).toHaveLength(1);
    expect(library[0].name).toBe("Scout");
    expect(isValidCustomCharacterDef({ id: "x" })).toBe(false);
    expect(parseCustomCharacterRecord("not json")).toBeNull();
  });
});

describe("re-derivation preserves pin adjustments (#74)", () => {
  it("keeps user offsets on the new detection and follows it elsewhere", () => {
    const userPins: PinSet = {
      ...detected,
      wristL: { x: detected.wristL.x + 0.05, y: detected.wristL.y - 0.03 },
    };
    const base = buildCharacter("custom-2", "Moved", {});
    const rig = buildRig({
      sourceKind: "single-png",
      pins: userPins,
      detectedPins: detected,
      userAdjustedPins: ["wristL"],
      decision: decideRigMode({ sourceKind: "single", partCount: 0, jointSeparation: 0.2, hasTransparency: true }),
      baseImageRef: "old-image",
      imageSize: { width: 400, height: 800 },
    });
    const detected2 = detectJoints({
      width: 500,
      height: 900,
      content: { left: 0.1, top: 0.05, right: 0.9, bottom: 0.95 },
    });
    const next = rederiveRig(rig, {
      detected: detected2,
      decision: decideRigMode({ sourceKind: "single", partCount: 0, jointSeparation: 0.9, hasTransparency: true }),
      baseImageRef: "new-image",
      imageSize: { width: 500, height: 900 },
    });
    expect(next.baseImageRef).toBe("new-image");
    expect(next.pins.wristL.x).toBeCloseTo(detected2.wristL.x + 0.05, 5);
    expect(next.pins.wristL.y).toBeCloseTo(detected2.wristL.y - 0.03, 5);
    expect(next.pins.neck).toEqual(detected2.neck);
    expect(next.userAdjustedPins).toEqual(["wristL"]);
    expect(next.detectedPins).toEqual(detected2);
    expect(next.mode).toBe("segmented");
    // The face pack follows the merged pins to the new head position.
    expect(next.facePack.anchor.x).toBeCloseTo(
      next.boneMap.joints.find((j) => j.bone === "head")!.x,
      1,
    );
  });

  it("withPins recomputes the adjusted list from detection", () => {
    const def = customDef();
    const nudged: PinSet = { ...detected, elbowR: { x: detected.elbowR.x - 0.04, y: detected.elbowR.y } };
    const next = withPins(def.customRig, nudged);
    expect(next.userAdjustedPins).toEqual(["elbowR"]);
    expect(next.pins.elbowR.x).toBeCloseTo(detected.elbowR.x - 0.04, 5);
  });
});

describe("custom character rendering and previews (#74)", () => {
  it("renders segmented and puppet warp characters as SVG", () => {
    const def = customDef();
    const html = renderToStaticMarkup(createElement(CustomCharacterFigure, { def, action: "walk", tMs: 200 }));
    expect(html).toContain("<svg");
    expect(html).toContain("Scout");
    const svgDef: CustomCharacterDef = {
      ...buildCharacter("custom-svg", "Vector", {}),
      customRig: rigFromSvgTemplate(SVG_TEMPLATE_SVG)!,
    };
    const svgHtml = renderToStaticMarkup(createElement(CustomCharacterFigure, { def: svgDef, action: "point", tMs: 300 }));
    expect(svgHtml).toContain("<svg");
    expect(svgHtml).toContain("Vector");
  });

  it("forward kinematics lowers the figure when sitting", () => {
    const map = boneMapFromPins(detected);
    const standing = worldJoints(map, sampleAction(ACTIONS.stand, 0));
    const sitting = worldJoints(map, sampleAction(ACTIONS.sit, ACTIONS.sit.durationMs));
    expect(sitting.root.y).toBeGreaterThan(standing.root.y + 30);
    const preview = renderToStaticMarkup(
      createElement(RigPosePreview, { map, action: "sit", tMs: ACTIONS.sit.durationMs }),
    );
    expect(preview).toContain("<svg");
  });
});

describe("generated character source seam (#74)", () => {
  it("ships unconfigured and fails honestly, creating nothing", async () => {
    const source = new UnconfiguredGeneratedSource();
    expect(source.kind).toBe("generated");
    expect(source.isConfigured).toBe(false);
    await expect(
      source.produce({ kind: "generated", prompt: "a friendly fox teacher" }),
    ).rejects.toBeInstanceOf(CharacterGenerationNotConfiguredError);
    await expect(
      source.produce({ kind: "generated", prompt: "a friendly fox teacher" }),
    ).rejects.toThrow(GENERATION_NOT_CONFIGURED_MESSAGE);
    expect(GENERATION_NOT_CONFIGURED_MESSAGE).not.toContain("—");
  });
});
