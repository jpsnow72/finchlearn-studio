import { describe, expect, it } from "vitest";
import {
  ACTIONS,
  ACTION_GROUPS,
  ACTION_GROUP_OF,
  ACTION_GROUP_ORDER,
  ACTION_CATALOGUE,
  groupedActionCatalogue,
  sampleAction,
  type ActionName,
} from "./actions.js";
import { BONE_IDS } from "./skeleton.js";
import {
  INTERACTIONS,
  INTERACTION_NAMES,
  INTERACTION_ROLE_ACTIONS,
  SKIPPED_INTERACTIONS,
  handPositionLocal,
  interactionHandsAt,
  isInteractionRoleAction,
  planInteraction,
  snapPartnerPlacement,
  type CharacterPlacement,
} from "./interactions.js";

const NEW_SOLO: ActionName[] = [
  "run", "clap", "nod", "shake", "shrug",
  "thumbs-up", "celebrate", "laugh", "bow", "look-around",
];

const ROLE_ACTIONS: ActionName[] = [
  "handshake-right", "handshake-left", "high-five-right", "high-five-left",
];

describe("motion library expansion: solo motions (#94, #96)", () => {
  it("every new solo motion exists with keyframes", () => {
    for (const name of NEW_SOLO) {
      const def = ACTIONS[name];
      expect(def, name).toBeTruthy();
      expect(def.name).toBe(name);
      expect(def.durationMs).toBeGreaterThan(0);
      const bones = Object.keys(def.keys);
      expect(bones.length, name).toBeGreaterThan(0);
      for (const bone of bones) {
        expect(def.keys[bone as keyof typeof def.keys]?.length, `${name}:${bone}`).toBeGreaterThan(0);
      }
    }
  });

  it("every new motion samples through the motion engine without error", () => {
    for (const name of [...NEW_SOLO, ...ROLE_ACTIONS]) {
      const def = ACTIONS[name];
      const stamps = [0, 0.25, 0.5, 0.75, 1].map((f) => def.durationMs * f);
      stamps.push(def.durationMs + 250); // past the end: loops wrap, one shots clamp
      for (const tMs of stamps) {
        const pose = sampleAction(def, tMs);
        for (const bone of BONE_IDS) {
          const tr = pose[bone];
          expect(Number.isFinite(tr.rotate), `${name}@${tMs}:${bone}`).toBe(true);
          expect(Number.isFinite(tr.dx), `${name}@${tMs}:${bone}`).toBe(true);
          expect(Number.isFinite(tr.dy), `${name}@${tMs}:${bone}`).toBe(true);
        }
      }
    }
  });

  it("the new motions actually move (poses differ across the cycle)", () => {
    for (const name of NEW_SOLO) {
      const def = ACTIONS[name];
      const a = sampleAction(def, def.durationMs * 0.3);
      const b = sampleAction(def, def.durationMs * 0.7);
      const moved = BONE_IDS.some(
        (bone) =>
          Math.abs(a[bone].rotate - b[bone].rotate) > 0.01 ||
          Math.abs(a[bone].dy - b[bone].dy) > 0.01,
      );
      expect(moved, name).toBe(true);
    }
  });

  it("clap brings both hands together at the center", () => {
    const pose = sampleAction(ACTIONS.clap, 225);
    const r = handPositionLocal(pose, "R");
    const l = handPositionLocal(pose, "L");
    expect(Math.hypot(r.x - l.x, r.y - l.y)).toBeLessThan(3);
    expect(r.x).toBeGreaterThan(95);
    expect(r.x).toBeLessThan(108);
  });
});

describe("two character interactions (#94)", () => {
  const initiator: CharacterPlacement = { x: 300, y: 120, facing: "right" };

  it("ships handshake and high five, and documents the skipped hug", () => {
    expect(INTERACTION_NAMES).toEqual(["handshake", "high-five"]);
    expect(INTERACTIONS.handshake.orientations).toHaveLength(2);
    expect(INTERACTIONS["high-five"].orientations.length).toBeGreaterThanOrEqual(1);
    expect(INTERACTIONS as Record<string, unknown>).not.toHaveProperty("hug");
    const hug = SKIPPED_INTERACTIONS.find((s) => s.name === "hug");
    expect(hug).toBeTruthy();
    expect(hug?.reason).toContain("clip");
  });

  it("interaction role actions exist and match the interaction durations", () => {
    for (const name of INTERACTION_NAMES) {
      const def = INTERACTIONS[name];
      for (const o of def.orientations) {
        expect(ACTIONS[o.initiator.action].durationMs).toBe(def.durationMs);
        expect(ACTIONS[o.partner.action].durationMs).toBe(def.durationMs);
      }
    }
  });

  it("handshake hands meet at the anchor in BOTH orientations", () => {
    for (const orientationId of ["partner-right", "partner-left"]) {
      const plan = planInteraction("handshake", orientationId, initiator);
      const { initiatorHand, partnerHand } = interactionHandsAt(
        plan,
        initiator,
        plan.anchorMs,
      );
      const gap = Math.hypot(
        initiatorHand.x - partnerHand.x,
        initiatorHand.y - partnerHand.y,
      );
      expect(gap, orientationId).toBeLessThan(1.5);
    }
  });

  it("high five hands meet at the anchor in both orientations", () => {
    for (const orientationId of ["partner-right", "partner-left"]) {
      const plan = planInteraction("high-five", orientationId, initiator);
      const { initiatorHand, partnerHand } = interactionHandsAt(
        plan,
        initiator,
        plan.anchorMs,
      );
      const gap = Math.hypot(
        initiatorHand.x - partnerHand.x,
        initiatorHand.y - partnerHand.y,
      );
      expect(gap, orientationId).toBeLessThan(1.5);
    }
  });

  it("hands stay together through the handshake hold after the anchor", () => {
    const plan = planInteraction("handshake", "partner-right", initiator);
    for (const tMs of [700, 900, 1100, 1300]) {
      const { initiatorHand, partnerHand } = interactionHandsAt(plan, initiator, tMs);
      const gap = Math.hypot(
        initiatorHand.x - partnerHand.x,
        initiatorHand.y - partnerHand.y,
      );
      expect(gap, `t=${tMs}`).toBeLessThan(1.5);
    }
  });

  it("snap places the partner at the relative position with facing toward the initiator", () => {
    const right = planInteraction("handshake", "partner-right", initiator);
    expect(right.partner.placement.x).toBeCloseTo(initiator.x + 177.24);
    expect(right.partner.placement.y).toBe(initiator.y);
    expect(right.partner.placement.facing).toBe("left");
    expect(right.partner.facing).toBe("left");
    expect(right.initiator.facing).toBe("right");
    expect(right.initiator.action).toBe("handshake-right");
    expect(right.partner.action).toBe("handshake-left");

    const left = planInteraction("handshake", "partner-left", initiator);
    expect(left.partner.placement.x).toBeCloseTo(initiator.x - 177.24);
    expect(left.partner.placement.y).toBe(initiator.y);
    expect(left.partner.facing).toBe("right");
    expect(left.initiator.facing).toBe("left");
  });

  it("snap math scales offsets and keeps the initiator's y", () => {
    const def = INTERACTIONS["high-five"];
    const orientation = def.orientations[0];
    const placed = snapPartnerPlacement(orientation, initiator, 0.5);
    expect(placed.x).toBeCloseTo(initiator.x + 155.67 * 0.5);
    expect(placed.y).toBe(initiator.y);
    expect(placed.facing).toBe(orientation.partner.facing);
  });
});

describe("action picker grouping (#94, #96)", () => {
  it("covers every action exactly once across the four groups", () => {
    expect(ACTION_GROUP_ORDER).toEqual(["basics", "movement", "reactions", "two-characters"]);
    const grouped = ACTION_GROUP_ORDER.flatMap((g) => ACTION_GROUPS[g]);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual(Object.keys(ACTIONS).sort());
    for (const entry of ACTION_CATALOGUE) {
      expect(ACTION_GROUP_OF[entry.name]).toBe(entry.group);
    }
    const groupedCatalogue = groupedActionCatalogue();
    expect(groupedCatalogue.map((g) => g.label)).toEqual([
      "Basics", "Movement", "Reactions", "Two characters",
    ]);
    expect(groupedCatalogue.flatMap((g) => g.entries)).toHaveLength(grouped.length);
  });

  it("the two characters group holds exactly the interaction roles", () => {
    expect([...ACTION_GROUPS["two-characters"]].sort()).toEqual([...ROLE_ACTIONS].sort());
  });
});

describe("motion library expansion: role action recognition (coordinator wiring)", () => {
  it("INTERACTION_ROLE_ACTIONS holds exactly the four role actions", () => {
    expect([...INTERACTION_ROLE_ACTIONS].sort()).toEqual([...ROLE_ACTIONS].sort());
  });

  it("isInteractionRoleAction recognizes roles and nothing else", () => {
    for (const name of ROLE_ACTIONS) expect(isInteractionRoleAction(name)).toBe(true);
    for (const name of NEW_SOLO) expect(isInteractionRoleAction(name)).toBe(false);
    expect(isInteractionRoleAction("idle")).toBe(false);
    expect(isInteractionRoleAction("wave")).toBe(false);
    expect(isInteractionRoleAction(undefined)).toBe(false);
    expect(isInteractionRoleAction("")).toBe(false);
  });
});
