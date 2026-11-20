/**
 * Two character interaction wiring (issues #94 and #96, coordinator
 * completion): the store action that consumes planInteraction from
 * @finch-studio/characters and applies an interaction to a pair in one
 * commit: role actions and facings on both characters, and the partner
 * snapped to the hand-meet placement.
 */
// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import { planInteraction } from "@finch-studio/characters";
import type { CharacterObject } from "@finch-studio/core";
import { makeStudioCharacter, useStudioStore } from "../store.js";

beforeEach(() => {
  useStudioStore.getState().newProject();
});

function sceneObjects() {
  const s = useStudioStore.getState();
  const scene = s.project.scenes.find((sc) => sc.id === s.currentSceneId);
  return scene?.objects ?? [];
}

function charById(id: string): CharacterObject {
  return sceneObjects().find((o) => o.id === id) as CharacterObject;
}

function starterHost(): CharacterObject {
  return sceneObjects().find((o) => o.type === "character") as CharacterObject;
}

function addPartnerAt(x: number): CharacterObject {
  const partner = makeStudioCharacter("businesswoman");
  useStudioStore.getState().addObject(partner);
  useStudioStore
    .getState()
    .updateObject(partner.id, { position: { x, y: 300, w: 140, h: 280 } });
  return charById(partner.id);
}

describe("applyInteraction (two character motions)", () => {
  it("applies a handshake to the initiator and nearest partner in one commit", () => {
    const store = useStudioStore.getState();
    const host = starterHost();
    store.updateObject(host.id, {
      position: { x: 200, y: 300, w: 140, h: 280 },
    });
    const partner = addPartnerAt(600);

    const plan = planInteraction(
      "handshake",
      "partner-right",
      { x: 200, y: 300, facing: "right" },
      140 / 200,
    );
    const pastBefore = useStudioStore.getState().pastProjects.length;
    useStudioStore
      .getState()
      .applyInteraction(host.id, "handshake", "partner-right");
    const pastAfter = useStudioStore.getState().pastProjects.length;
    expect(pastAfter - pastBefore).toBe(1);

    const afterInitiator = charById(host.id);
    expect(afterInitiator.characterAnimation).toBe(plan.initiator.action);
    expect(afterInitiator.characterAnimation).toBe("handshake-right");
    expect(afterInitiator.facing).toBe(plan.initiator.facing);

    const afterPartner = charById(partner.id);
    expect(afterPartner.characterAnimation).toBe(plan.partner.action);
    expect(afterPartner.characterAnimation).toBe("handshake-left");
    expect(afterPartner.facing).toBe(plan.partner.facing);
    expect(afterPartner.position?.x).toBeCloseTo(plan.partner.placement.x, 6);
    expect(afterPartner.position?.y).toBe(300);
    // The partner keeps its own size; only its origin snapped.
    expect(afterPartner.position?.w).toBe(140);
    expect(afterPartner.position?.h).toBe(280);

    expect(useStudioStore.getState().selectedObjectIds).toEqual([
      host.id,
      partner.id,
    ]);
  });

  it("high five with the partner on the left snaps the partner left", () => {
    const store = useStudioStore.getState();
    const host = starterHost();
    store.updateObject(host.id, {
      position: { x: 500, y: 300, w: 140, h: 280 },
    });
    const partner = addPartnerAt(100);

    store.applyInteraction(host.id, "high-five", "partner-left");
    const plan = planInteraction(
      "high-five",
      "partner-left",
      { x: 500, y: 300, facing: "right" },
      140 / 200,
    );
    const afterPartner = charById(partner.id);
    expect(afterPartner.position?.x).toBeCloseTo(plan.partner.placement.x, 6);
    expect(afterPartner.position?.x).toBeLessThan(500);
    expect(charById(host.id).characterAnimation).toBe(plan.initiator.action);
    expect(afterPartner.characterAnimation).toBe(plan.partner.action);
  });

  it("does nothing when the scene has a single character", () => {
    const host = starterHost();
    const pastBefore = useStudioStore.getState().pastProjects.length;
    useStudioStore
      .getState()
      .applyInteraction(host.id, "handshake", "partner-right");
    expect(useStudioStore.getState().pastProjects.length).toBe(pastBefore);
    expect(charById(host.id).characterAnimation).toBe("wave");
  });

  it("picks the nearest other character as the partner", () => {
    const store = useStudioStore.getState();
    const host = starterHost();
    store.updateObject(host.id, {
      position: { x: 200, y: 300, w: 140, h: 280 },
    });
    const far = addPartnerAt(900);
    const near = addPartnerAt(350);

    store.applyInteraction(host.id, "handshake", "partner-right");
    expect(charById(near.id).characterAnimation).toBe("handshake-left");
    expect(charById(far.id).characterAnimation).toBe("idle");
  });
});
