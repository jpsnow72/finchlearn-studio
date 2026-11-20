/**
 * Two character interactions (issues #94 and #96): synced action pairs on
 * the shared skeleton, with a hand meet anchor and snap placement.
 *
 * Each interaction is two ordinary actions (one per character) authored in
 * actions.ts, played in sync. The pair is aligned by an anchor frame: at
 * anchorMs both characters' reaching hands land on the same point, provided
 * the second character is placed at the orientation's partner offset from
 * the first. Applying an interaction therefore snaps the second character
 * to that relative position and sets both characters' facing toward each
 * other; planInteraction returns the whole plan as pure data so the editor
 * store can apply it in one commit.
 *
 * Geometry works in character space (the 200 x 400 box from skeleton.ts),
 * in the shared local frame the renderer draws: role actions are authored
 * pre mirrored, so the "reaching right" role reaches toward +x in the
 * frame it is sampled in. Placements are box origins in the same units;
 * multiply offsets by (objectWidth / 200) when a scene object is scaled.
 */
import { ACTIONS, sampleAction, type ActionName } from "./actions.js";
import type { BoneId, BoneTransform } from "./skeleton.js";

export type InteractionName = "handshake" | "high-five";

export type InteractionFacing = "left" | "right";

export interface CharacterPlacement {
  /** Box origin, in character space units (or stage units when scaled). */
  x: number;
  y: number;
  facing: InteractionFacing;
}

export interface InteractionRoleSpec {
  action: ActionName;
  facing: InteractionFacing;
  /** Which hand reaches: the anchor tracks this hand. */
  hand: "L" | "R";
}

export interface InteractionOrientation {
  id: "partner-right" | "partner-left";
  label: string;
  initiator: InteractionRoleSpec;
  partner: InteractionRoleSpec;
  /** Partner box origin relative to the initiator's, in character units. */
  partnerOffset: { dx: number; dy: number };
}

export interface InteractionDef {
  name: InteractionName;
  label: string;
  durationMs: number;
  /** Time at which the two reaching hands meet. */
  anchorMs: number;
  orientations: InteractionOrientation[];
}

export const INTERACTIONS: Record<InteractionName, InteractionDef> = {
  handshake: {
    name: "handshake",
    label: "Handshake",
    durationMs: 1600,
    anchorMs: 700,
    orientations: [
      {
        id: "partner-right",
        label: "Partner on the right",
        initiator: { action: "handshake-right", facing: "right", hand: "R" },
        partner: { action: "handshake-left", facing: "left", hand: "L" },
        // At the anchor the initiator's right hand sits at local x 188.62
        // and the partner's left hand at local x 11.38 (both y 186.43), so
        // the partner origin goes 177.24 units to the right.
        partnerOffset: { dx: 177.24, dy: 0 },
      },
      {
        id: "partner-left",
        label: "Partner on the left",
        initiator: { action: "handshake-left", facing: "left", hand: "L" },
        partner: { action: "handshake-right", facing: "right", hand: "R" },
        partnerOffset: { dx: -177.24, dy: 0 },
      },
    ],
  },
  "high-five": {
    name: "high-five",
    label: "High five",
    durationMs: 1100,
    anchorMs: 550,
    orientations: [
      {
        id: "partner-right",
        label: "Partner on the right",
        initiator: { action: "high-five-right", facing: "right", hand: "R" },
        partner: { action: "high-five-left", facing: "left", hand: "L" },
        // Anchor hands: initiator right hand local (177.83, 78.54),
        // partner left hand local (22.17, 78.54).
        partnerOffset: { dx: 155.67, dy: 0 },
      },
      {
        id: "partner-left",
        label: "Partner on the left",
        initiator: { action: "high-five-left", facing: "left", hand: "L" },
        partner: { action: "high-five-right", facing: "right", hand: "R" },
        partnerOffset: { dx: -155.67, dy: 0 },
      },
    ],
  },
};

export const INTERACTION_NAMES: InteractionName[] = ["handshake", "high-five"];

/**
 * Interactions considered and deliberately not shipped, with the reason.
 * Hug: the standard skeleton has no way to wrap an arm around a second
 * character cleanly. Both arm segments total 92 units, less than the reach
 * around a partner torso (about 60 units wide) plus the return, so the
 * hands land inside the partner's torso silhouette; and because each
 * character renders as one SVG with a fixed part order, there is no depth
 * split that puts one arm behind the partner and the other in front. The
 * result reads as arms clipping through the body, so the hug is skipped
 * until the rig gains a depth seam.
 */
export const SKIPPED_INTERACTIONS: { name: string; reason: string }[] = [
  {
    name: "hug",
    reason:
      "Arm reach (92 units over both segments) cannot wrap a partner torso and the single SVG part order gives no behind/in front depth split, so the arms would clip through the partner's body.",
  },
];

export function interactionOrientation(
  def: InteractionDef,
  orientationId: string,
): InteractionOrientation {
  return def.orientations.find((o) => o.id === orientationId) ?? def.orientations[0];
}

/** Where the partner goes when an interaction is applied to an initiator. */
export function snapPartnerPlacement(
  orientation: InteractionOrientation,
  initiator: CharacterPlacement,
  scale = 1,
): CharacterPlacement {
  return {
    x: initiator.x + orientation.partnerOffset.dx * scale,
    y: initiator.y + orientation.partnerOffset.dy * scale,
    facing: orientation.partner.facing,
  };
}

export interface InteractionPlan {
  interaction: InteractionName;
  orientation: InteractionOrientation["id"];
  durationMs: number;
  anchorMs: number;
  initiator: { action: ActionName; facing: InteractionFacing };
  partner: {
    action: ActionName;
    facing: InteractionFacing;
    placement: CharacterPlacement;
  };
}

/**
 * Plan applying an interaction: the initiator keeps its position, takes the
 * orientation's role action and facing, and the partner snaps to the
 * relative position and facing that make the hands meet at the anchor.
 * `scale` converts character units to stage units (objectWidth / 200).
 */
export function planInteraction(
  name: InteractionName,
  orientationId: string,
  initiator: CharacterPlacement,
  scale = 1,
): InteractionPlan {
  const def = INTERACTIONS[name];
  const orientation = interactionOrientation(def, orientationId);
  return {
    interaction: name,
    orientation: orientation.id,
    durationMs: def.durationMs,
    anchorMs: def.anchorMs,
    initiator: { action: orientation.initiator.action, facing: orientation.initiator.facing },
    partner: {
      action: orientation.partner.action,
      facing: orientation.partner.facing,
      placement: snapPartnerPlacement(orientation, initiator, scale),
    },
  };
}

// ---------------------------------------------------------------------------
// Hand positions: forward kinematics over the sampled pose, following the
// exact transform chain RiggedCharacter renders (root at (100, 238), torso
// at (0, -4) inside it, shoulder at (+/-27, -94) inside the torso, elbow at
// (0, 46) inside the upper arm, hand at (0, 46) inside the lower arm).
// ---------------------------------------------------------------------------

/** Every role action an interaction can assign, across all orientations. */
export const INTERACTION_ROLE_ACTIONS: ActionName[] = [
  ...new Set(
    INTERACTION_NAMES.flatMap((name) =>
      INTERACTIONS[name].orientations.flatMap((o) => [
        o.initiator.action,
        o.partner.action,
      ]),
    ),
  ),
];

/**
 * True for the pair-applied role actions. Role actions are authored
 * pre-mirrored in the shared local frame (each role's data already
 * reaches the correct way), so renderers must not apply a second
 * facing mirror on top of them; the facing on a pair-applied character
 * is semantic (it records which way the character turns in the scene).
 */
export function isInteractionRoleAction(name: string | undefined): boolean {
  return !!name && (INTERACTION_ROLE_ACTIONS as string[]).includes(name);
}

export interface Point {
  x: number;
  y: number;
}

function applyTransform(p: Point, tx: number, ty: number, rotateDeg: number): Point {
  const rad = (rotateDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return { x: tx + p.x * c - p.y * s, y: ty + p.x * s + p.y * c };
}

/** A hand's position in character space for a sampled pose. */
export function handPositionLocal(
  pose: Record<BoneId, BoneTransform>,
  side: "L" | "R",
): Point {
  const upper = pose[side === "L" ? "armUpperL" : "armUpperR"];
  const lower = pose[side === "L" ? "armLowerL" : "armLowerR"];
  let p: Point = { x: 0, y: 46 };
  p = applyTransform(p, lower.dx, 46 + lower.dy, lower.rotate);
  p = applyTransform(p, (side === "L" ? -27 : 27) + upper.dx, -94 + upper.dy, upper.rotate);
  p = applyTransform(p, pose.torso.dx, -4 + pose.torso.dy, pose.torso.rotate);
  p = applyTransform(p, 100 + pose.root.dx, 238 + pose.root.dy, pose.root.rotate);
  return p;
}

/** A hand's position for a character placed at a box origin (same units). */
export function handPositionWorld(
  pose: Record<BoneId, BoneTransform>,
  side: "L" | "R",
  placement: CharacterPlacement,
): Point {
  const local = handPositionLocal(pose, side);
  return { x: placement.x + local.x, y: placement.y + local.y };
}

/**
 * The two reaching hands' world positions at a time, for a planned pair.
 * At the plan's anchorMs (and the plan's placements) the two points meet.
 */
export function interactionHandsAt(
  plan: InteractionPlan,
  initiator: CharacterPlacement,
  tMs: number,
): { initiatorHand: Point; partnerHand: Point } {
  const def = INTERACTIONS[plan.interaction];
  const orientation = interactionOrientation(def, plan.orientation);
  const initiatorPose = sampleAction(ACTIONS[plan.initiator.action], tMs);
  const partnerPose = sampleAction(ACTIONS[plan.partner.action], tMs);
  return {
    initiatorHand: handPositionWorld(initiatorPose, orientation.initiator.hand, initiator),
    partnerHand: handPositionWorld(partnerPose, orientation.partner.hand, plan.partner.placement),
  };
}
