/**
 * Custom character rigging (issue #74, Tier 2 and Tier 3).
 *
 * A user rigged character is plain data over the standard skeleton: a pin
 * set placed on the user's own art, a bone map derived from those pins,
 * a render mode (segmented parts or single image puppet warp), and a
 * face pack that rides the existing expressions and viseme model. The
 * def plugs into the same CharacterDef shape the built in cast uses, so
 * actions, expressions, and scene placement work unchanged.
 *
 * Coordinates: pins are stored normalized to the source image (0 to 1 on
 * both axes) so a saved character survives the image being shown at any
 * size. The bone map is in character space (200 x 400, see skeleton.ts).
 * Everything in this module is pure data and pure functions: no DOM, no
 * canvas, no storage. The editor wizard supplies image metrics and the
 * library persistence; the decisions live here so they are unit tested.
 */
import { BONES, type BoneId } from "./skeleton.js";
import type { CharacterDef } from "./defs.js";
import type { ExpressionName, FaceDef } from "./expressions.js";
import { EXPRESSIONS } from "./expressions.js";

// ---------------------------------------------------------------------------
// Pins
// ---------------------------------------------------------------------------

/** The draggable pin set: about a dozen joints the user fine tunes. */
export const PIN_IDS = [
  "headTop",
  "neck",
  "shoulderL",
  "shoulderR",
  "elbowL",
  "elbowR",
  "wristL",
  "wristR",
  "hipL",
  "hipR",
  "kneeL",
  "kneeR",
  "ankleL",
  "ankleR",
] as const;

export type PinId = (typeof PIN_IDS)[number];

export const PIN_LABELS: Record<PinId, string> = {
  headTop: "Head top",
  neck: "Neck",
  shoulderL: "Left shoulder",
  shoulderR: "Right shoulder",
  elbowL: "Left elbow",
  elbowR: "Right elbow",
  wristL: "Left wrist",
  wristR: "Right wrist",
  hipL: "Left hip",
  hipR: "Right hip",
  kneeL: "Left knee",
  kneeR: "Right knee",
  ankleL: "Left ankle",
  ankleR: "Right ankle",
};

/** One pin position, normalized to the source image (0 to 1). */
export interface PinPoint {
  x: number;
  y: number;
}

export type PinSet = Record<PinId, PinPoint>;

/** Ghost skeleton segments drawn between pins in the wizard overlay. */
export const PIN_SEGMENTS: [PinId, PinId][] = [
  ["headTop", "neck"],
  ["neck", "shoulderL"],
  ["neck", "shoulderR"],
  ["shoulderL", "elbowL"],
  ["elbowL", "wristL"],
  ["shoulderR", "elbowR"],
  ["elbowR", "wristR"],
  ["neck", "hipL"],
  ["neck", "hipR"],
  ["hipL", "hipR"],
  ["hipL", "kneeL"],
  ["kneeL", "ankleL"],
  ["hipR", "kneeR"],
  ["kneeR", "ankleR"],
];

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export function clampPin(p: PinPoint): PinPoint {
  return { x: clamp01(p.x), y: clamp01(p.y) };
}

// ---------------------------------------------------------------------------
// Automatic joint detection (first pass)
// ---------------------------------------------------------------------------

export interface ImageBounds {
  /** Pixel size of the source image. */
  width: number;
  height: number;
  /**
   * Bounding box of the visible (non transparent) art, normalized 0 to 1.
   * The wizard measures this from the uploaded PNG alpha channel. When
   * absent, the whole image is assumed to be the figure.
   */
  content?: { left: number; top: number; right: number; bottom: number };
}

/**
 * First pass joint detection for a front facing spread pose.
 *
 * This is an honest heuristic, not a pose model: it places the standard
 * humanoid proportions inside the measured content box (head in the top
 * band, shoulders just below it, arms angled out to spread wrists, hips
 * at mid height, legs straight down). The wizard always shows these pins
 * for the user to drag into place, and the UI says exactly that.
 */
export function detectJoints(bounds: ImageBounds): PinSet {
  const box = bounds.content ?? { left: 0, top: 0, right: 1, bottom: 1 };
  const w = Math.max(0.05, box.right - box.left);
  const h = Math.max(0.05, box.bottom - box.top);
  const at = (fx: number, fy: number): PinPoint => ({
    x: clamp01(box.left + fx * w),
    y: clamp01(box.top + fy * h),
  });
  return {
    headTop: at(0.5, 0.01),
    neck: at(0.5, 0.16),
    shoulderL: at(0.36, 0.19),
    shoulderR: at(0.64, 0.19),
    elbowL: at(0.2, 0.36),
    elbowR: at(0.8, 0.36),
    wristL: at(0.06, 0.52),
    wristR: at(0.94, 0.52),
    hipL: at(0.43, 0.52),
    hipR: at(0.57, 0.52),
    kneeL: at(0.42, 0.76),
    kneeR: at(0.58, 0.76),
    ankleL: at(0.41, 0.99),
    ankleR: at(0.59, 0.99),
  };
}

// ---------------------------------------------------------------------------
// Bone map: pins onto the standard skeleton
// ---------------------------------------------------------------------------

/** Character space is 200 x 400 (skeleton.ts). */
export const CHARACTER_SPACE = { width: 200, height: 400 } as const;

export interface BoneMapEntry {
  bone: BoneId;
  /** Joint position in character space, derived from the pins. */
  x: number;
  y: number;
}

export interface BoneMap {
  /** One entry per skeleton bone, in BONES order. */
  joints: BoneMapEntry[];
  /** Segment lengths in character space units, keyed by child bone. */
  lengths: Partial<Record<BoneId, number>>;
  /**
   * Proportion scale per segment relative to the standard skeleton
   * (1 = standard). User adjustable in the wizard; stored on the rig so
   * a saved character keeps its proportions.
   */
  proportions: Partial<Record<BoneId, number>>;
}

const STANDARD_JOINTS = new Map<BoneId, { x: number; y: number }>(
  BONES.map((b) => [b.id, { x: b.x, y: b.y }]),
);

function dist(a: PinPoint, b: PinPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function mid(a: PinPoint, b: PinPoint): PinPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Map a pin set onto the standard skeleton.
 *
 * The pins are normalized into character space by their own extent: the
 * figure height (head top to the lower ankle) maps to the standard
 * figure height, and the horizontal centre maps to x = 100. Bone joints
 * land where the pins say they are; segment lengths and proportion
 * scales are computed against the standard skeleton so the wizard can
 * show and adjust them.
 */
export function boneMapFromPins(pins: PinSet): BoneMap {
  const hipCentre = mid(pins.hipL, pins.hipR);
  const topY = pins.headTop.y;
  const bottomY = Math.max(pins.ankleL.y, pins.ankleR.y);
  const figureH = Math.max(0.05, bottomY - topY);
  const centreX = (pins.headTop.x + hipCentre.x) / 2;
  // Standard figure: head joint y 118 to ground 392, about 274 units for
  // the joint span; the pin span (head top to ankle) is a bit taller, so
  // scale by the standard head-top-to-ankle span of about 330 units.
  const scale = 330 / figureH;
  const toSpace = (p: PinPoint): { x: number; y: number } => ({
    x: 100 + (p.x - centreX) * scale * (CHARACTER_SPACE.height / CHARACTER_SPACE.width) * 0.5,
    y: 60 + (p.y - topY) * scale,
  });

  const neck = toSpace(pins.neck);
  const headTop = toSpace(pins.headTop);
  const root = toSpace(hipCentre);
  const jointFor: Record<BoneId, { x: number; y: number }> = {
    root,
    torso: { x: root.x, y: root.y - 6 },
    neck,
    head: { x: neck.x, y: neck.y - Math.max(8, (neck.y - headTop.y) * 0.45) },
    armUpperL: toSpace(pins.shoulderL),
    armLowerL: toSpace(pins.elbowL),
    armUpperR: toSpace(pins.shoulderR),
    armLowerR: toSpace(pins.elbowR),
    legUpperL: toSpace(pins.hipL),
    legLowerL: toSpace(pins.kneeL),
    legUpperR: toSpace(pins.hipR),
    legLowerR: toSpace(pins.kneeR),
  };

  const joints: BoneMapEntry[] = BONES.map((b) => ({
    bone: b.id,
    x: Math.round(jointFor[b.id].x * 10) / 10,
    y: Math.round(jointFor[b.id].y * 10) / 10,
  }));
  const byBone = new Map(joints.map((j) => [j.bone, j]));
  const lengths: Partial<Record<BoneId, number>> = {};
  const proportions: Partial<Record<BoneId, number>> = {};
  for (const b of BONES) {
    if (!b.parent) continue;
    const child = byBone.get(b.id);
    const parent = byBone.get(b.parent);
    const stdChild = STANDARD_JOINTS.get(b.id);
    const stdParent = STANDARD_JOINTS.get(b.parent);
    if (!child || !parent || !stdChild || !stdParent) continue;
    const len = Math.hypot(child.x - parent.x, child.y - parent.y);
    const stdLen = Math.hypot(stdChild.x - stdParent.x, stdChild.y - stdParent.y);
    lengths[b.id] = Math.round(len * 10) / 10;
    proportions[b.id] = stdLen > 0 ? Math.round((len / stdLen) * 100) / 100 : 1;
  }
  return { joints, lengths, proportions };
}

/**
 * Apply user proportion adjustments (segment scale factors) to a bone
 * map. Adjusting a parent segment moves its whole subtree so the figure
 * stays connected; lengths and proportions are recomputed afterwards.
 * Pure: the input map is not mutated.
 */
export function withProportions(
  map: BoneMap,
  adjustments: Partial<Record<BoneId, number>>,
): BoneMap {
  const pos = new Map<BoneId, { x: number; y: number }>(
    map.joints.map((j) => [j.bone, { x: j.x, y: j.y }]),
  );
  // Process bones in skeleton order so parents move before children.
  for (const b of BONES) {
    const factor = adjustments[b.id];
    if (!b.parent || factor === undefined || factor === 1) continue;
    const parent = pos.get(b.parent);
    const self = pos.get(b.id);
    if (!parent || !self) continue;
    const dx = (self.x - parent.x) * (factor - 1);
    const dy = (self.y - parent.y) * (factor - 1);
    // Move this joint and every descendant by the same delta.
    const subtree: BoneId[] = [b.id];
    for (let i = 0; i < subtree.length; i += 1) {
      for (const child of BONES) {
        if (child.parent === subtree[i] && !subtree.includes(child.id)) {
          subtree.push(child.id);
        }
      }
    }
    for (const id of subtree) {
      const p = pos.get(id);
      if (p) pos.set(id, { x: p.x + dx, y: p.y + dy });
    }
  }
  const joints: BoneMapEntry[] = BONES.map((b) => {
    const p = pos.get(b.id) ?? { x: 0, y: 0 };
    return { bone: b.id, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
  });
  const byBone = new Map(joints.map((j) => [j.bone, j]));
  const lengths: Partial<Record<BoneId, number>> = {};
  const proportions: Partial<Record<BoneId, number>> = {};
  for (const b of BONES) {
    if (!b.parent) continue;
    const child = byBone.get(b.id);
    const parent = byBone.get(b.parent);
    const stdChild = STANDARD_JOINTS.get(b.id);
    const stdParent = STANDARD_JOINTS.get(b.parent);
    if (!child || !parent || !stdChild || !stdParent) continue;
    const len = Math.hypot(child.x - parent.x, child.y - parent.y);
    const stdLen = Math.hypot(stdChild.x - stdParent.x, stdChild.y - stdParent.y);
    lengths[b.id] = Math.round(len * 10) / 10;
    proportions[b.id] = stdLen > 0 ? Math.round((len / stdLen) * 100) / 100 : 1;
  }
  return { joints, lengths, proportions };
}

/** Ghost skeleton segments in character space, for previews and tests. */
export function boneMapSegments(map: BoneMap): { from: BoneMapEntry; to: BoneMapEntry }[] {
  const byBone = new Map(map.joints.map((j) => [j.bone, j]));
  const out: { from: BoneMapEntry; to: BoneMapEntry }[] = [];
  for (const b of BONES) {
    if (!b.parent) continue;
    const from = byBone.get(b.parent);
    const to = byBone.get(b.id);
    if (from && to) out.push({ from, to });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Segmentation versus puppet warp
// ---------------------------------------------------------------------------

export type RigRenderMode = "segmented" | "puppet-warp";

/** Quality tier stated honestly in the UI for each render mode. */
export type RigQuality = "full-parts" | "mesh-deform";

export interface SegmentationInput {
  /** How the art arrived: one whole figure, or one file per body part. */
  sourceKind: "single" | "parts" | "svg-template";
  /** Number of separate part images supplied (parts and svg sources). */
  partCount: number;
  /**
   * Joint separation score 0 to 1 for a single image: how cleanly the
   * art separates at the joints (narrow bridges of visible pixels at
   * elbows, knees, shoulders, hips, and neck, measured by the wizard
   * from the alpha channel). 1 means the limbs are fully distinct.
   */
  jointSeparation?: number;
  /** True when the source carries a real alpha channel with cut out art. */
  hasTransparency?: boolean;
}

export interface SegmentationDecision {
  mode: RigRenderMode;
  quality: RigQuality;
  /** Plain language reason, safe to show in the UI as written. */
  reason: string;
  /** Plain language quality note, safe to show in the UI as written. */
  qualityNote: string;
}

export const SEGMENTED_NOTE =
  "Full part quality: each body part is its own layer, so joints bend cleanly with no stretching.";
export const PUPPET_WARP_NOTE =
  "Mesh deformation quality: the single image bends around the pins. Joints can stretch or smear, especially on wide bends. " +
  "Upload separate part images, or art whose limbs are clearly separated, for full part quality.";

/** Separation at or above this score counts as cleanly separated art. */
export const SEGMENTATION_THRESHOLD = 0.6;

/** The minimum part files that count as a complete per part upload. */
export const MIN_PART_FILES = 6;

/**
 * Decide segmented parts versus single image puppet warp.
 *
 * Per part uploads and template SVGs are segmented by construction. A
 * single image segments only when its joints measure cleanly separated;
 * anything else falls back to puppet warp, and the decision carries the
 * honest quality note the UI shows either way.
 */
export function decideRigMode(input: SegmentationInput): SegmentationDecision {
  if (input.sourceKind === "svg-template") {
    return {
      mode: "segmented",
      quality: "full-parts",
      reason: "The upload matches the named layer template, so every part is already its own layer.",
      qualityNote: SEGMENTED_NOTE,
    };
  }
  if (input.sourceKind === "parts" && input.partCount >= MIN_PART_FILES) {
    return {
      mode: "segmented",
      quality: "full-parts",
      reason: "Separate part images were supplied, so each part rigs as its own layer with joint overlap.",
      qualityNote: SEGMENTED_NOTE,
    };
  }
  if (input.sourceKind === "parts") {
    return {
      mode: "puppet-warp",
      quality: "mesh-deform",
      reason: `Only ${input.partCount} part image${input.partCount === 1 ? "" : "s"} arrived, fewer than the ${MIN_PART_FILES} needed for a full part set, so the figure rigs as one image.`,
      qualityNote: PUPPET_WARP_NOTE,
    };
  }
  if (input.hasTransparency === false) {
    return {
      mode: "puppet-warp",
      quality: "mesh-deform",
      reason: "The image has no transparent background, so the figure cannot be separated from its background.",
      qualityNote: PUPPET_WARP_NOTE,
    };
  }
  const score = input.jointSeparation ?? 0;
  if (score >= SEGMENTATION_THRESHOLD) {
    return {
      mode: "segmented",
      quality: "full-parts",
      reason: "The limbs measure cleanly separated at the joints, so the image can be cut into parts with joint overlap.",
      qualityNote: SEGMENTED_NOTE,
    };
  }
  return {
    mode: "puppet-warp",
    quality: "mesh-deform",
    reason: "The art does not separate cleanly at the joints, so the figure rigs as one image with mesh deformation instead of cut parts.",
    qualityNote: PUPPET_WARP_NOTE,
  };
}

/**
 * Score how cleanly a single image separates at its joints, from alpha
 * samples the wizard takes along the cut line at each joint. Each sample
 * is the fraction of visible pixels across the limb at that joint (0 to
 * 1): a narrow neck of pixels scores high, a wide merged mass scores
 * low. Returns the mean separation across the sampled joints.
 */
export function jointSeparationScore(jointVisibleFractions: number[]): number {
  if (jointVisibleFractions.length === 0) return 0;
  const mean =
    jointVisibleFractions.reduce((sum, f) => sum + (1 - Math.min(1, Math.max(0, f))), 0) /
    jointVisibleFractions.length;
  return Math.round(mean * 100) / 100;
}

// ---------------------------------------------------------------------------
// Face pack
// ---------------------------------------------------------------------------

/**
 * Face data for a custom character, riding the existing expressions and
 * viseme model: the anchor and scale place the standard 64 x 64 face
 * space (expressions.ts) onto the user's head art, and per expression
 * overrides stay optional. Blink is data too: an interval range the
 * renderer samples, matching how built in faces blink by closing eyes.
 */
export interface FacePack {
  /** Face centre in character space. */
  anchor: { x: number; y: number };
  /** Face scale relative to the standard head (1 = standard). */
  scale: number;
  /** Head width in character space units, measured from the pins. */
  headWidth: number;
  /** Blink interval range in ms (renderer picks within the range). */
  blinkMs: { min: number; max: number };
  /** Optional per expression face overrides; absent means standard. */
  expressionOverrides?: Partial<Record<ExpressionName, Partial<FaceDef>>>;
}

/** Build the default face pack from a pin set and its bone map. */
export function buildFacePack(pins: PinSet, map: BoneMap): FacePack {
  const head = map.joints.find((j) => j.bone === "head") ?? { x: 100, y: 118 };
  const headHeight = Math.max(
    12,
    dist(pins.headTop, pins.neck) * CHARACTER_SPACE.height,
  );
  const headWidth = Math.round(headHeight * 0.82 * 10) / 10;
  return {
    anchor: { x: head.x, y: Math.round((head.y + 6) * 10) / 10 },
    scale: Math.round((headWidth / 60) * 100) / 100,
    headWidth,
    blinkMs: { min: 2400, max: 5200 },
  };
}

/** Resolve the face for an expression through a face pack. */
export function faceForExpression(
  pack: FacePack,
  expression: ExpressionName,
): FaceDef {
  const base = EXPRESSIONS[expression] ?? EXPRESSIONS.neutral;
  const override = pack.expressionOverrides?.[expression];
  return override ? { ...base, ...override } : base;
}

/** Attach (or replace) a face pack on a rig, returning a new rig. */
export function withFacePack(rig: CustomRig, pack: FacePack): CustomRig {
  return { ...rig, facePack: pack };
}

/**
 * Replace the pin set on a rig (the wizard saves pin nudges this way):
 * the bone map and face pack are recomputed from the new pins, and the
 * adjusted pin list records which pins now sit away from detection.
 * Face pack expression overrides survive the recompute.
 */
export function withPins(
  rig: CustomRig,
  pins: PinSet,
): CustomRig {
  const adjusted = PIN_IDS.filter(
    (id) =>
      Math.abs(pins[id].x - rig.detectedPins[id].x) > 0.001 ||
      Math.abs(pins[id].y - rig.detectedPins[id].y) > 0.001,
  );
  const boneMap = boneMapFromPins(pins);
  const freshFace = buildFacePack(pins, boneMap);
  return {
    ...rig,
    pins,
    userAdjustedPins: adjusted,
    boneMap,
    facePack: rig.facePack.expressionOverrides
      ? { ...freshFace, expressionOverrides: rig.facePack.expressionOverrides }
      : freshFace,
  };
}

// ---------------------------------------------------------------------------
// The custom rig and character def
// ---------------------------------------------------------------------------

export type RigSourceKind = "single-png" | "part-pngs" | "svg-template" | "generated";

export interface RigPartImage {
  /** Part slot this image fills (skeleton.ts PART_SLOTS vocabulary). */
  slot: string;
  /** R2 key or data URL for the part art; never viewer identity. */
  ref: string;
}

export interface CustomRig {
  sourceKind: RigSourceKind;
  /**
   * The editable base image (single image sources) or the template SVG
   * text reference. Editing it re-derives the rig; see rederiveRig.
   * Part sources keep their art in parts instead.
   */
  baseImageRef?: string;
  /** Source image pixel size, for re-derivation and previews. */
  imageSize?: { width: number; height: number };
  /** Per part art (segmented sources). */
  parts?: RigPartImage[];
  /** Final pin set (detection plus user fine tuning). */
  pins: PinSet;
  /**
   * The raw detection this rig was derived from, kept so a later
   * re-derivation can measure each user adjustment as an offset from
   * detection and reapply it to the new detection.
   */
  detectedPins: PinSet;
  /** Pins the user dragged away from the detected position. */
  userAdjustedPins: PinId[];
  boneMap: BoneMap;
  mode: RigRenderMode;
  quality: RigQuality;
  /** The honest quality note captured at decision time. */
  qualityNote: string;
  facePack: FacePack;
  /** ISO timestamp of the last derivation. */
  derivedAt: string;
}

/** A user rigged character: a standard def plus its rig. */
export interface CustomCharacterDef extends CharacterDef {
  customRig: CustomRig;
}

export function isCustomCharacter(
  def: CharacterDef,
): def is CustomCharacterDef {
  return (
    typeof (def as CustomCharacterDef).customRig === "object" &&
    (def as CustomCharacterDef).customRig !== null
  );
}

/** Assemble a rig from pins and a segmentation decision. */
export function buildRig(input: {
  sourceKind: RigSourceKind;
  pins: PinSet;
  /** Raw detection the pins started from; defaults to pins. */
  detectedPins?: PinSet;
  userAdjustedPins?: PinId[];
  decision: SegmentationDecision;
  baseImageRef?: string;
  imageSize?: { width: number; height: number };
  parts?: RigPartImage[];
  derivedAt?: string;
}): CustomRig {
  const boneMap = boneMapFromPins(input.pins);
  const rig: CustomRig = {
    sourceKind: input.sourceKind,
    pins: input.pins,
    detectedPins: input.detectedPins ?? input.pins,
    userAdjustedPins: input.userAdjustedPins ?? [],
    boneMap,
    mode: input.decision.mode,
    quality: input.decision.quality,
    qualityNote: input.decision.qualityNote,
    facePack: buildFacePack(input.pins, boneMap),
    derivedAt: input.derivedAt ?? new Date(0).toISOString(),
  };
  if (input.baseImageRef !== undefined) rig.baseImageRef = input.baseImageRef;
  if (input.imageSize !== undefined) rig.imageSize = input.imageSize;
  if (input.parts !== undefined) rig.parts = input.parts;
  return rig;
}

// ---------------------------------------------------------------------------
// Re-derivation: the base image stays editable
// ---------------------------------------------------------------------------

export interface RederiveInput {
  /** Fresh detection on the edited base image. */
  detected: PinSet;
  /** Fresh segmentation decision for the edited image. */
  decision: SegmentationDecision;
  baseImageRef: string;
  imageSize?: { width: number; height: number };
  derivedAt?: string;
}

/**
 * Re-derive a rig after the base image is edited.
 *
 * Detection runs again on the new art, but pins the user fine tuned are
 * preserved by their offset: each adjusted pin keeps the delta it had
 * from the old detection, applied to the new detection at the same pin.
 * When the geometry still maps (the new detection is close to the old),
 * the preserved pin lands where the user left it relative to the art.
 * Pins the user never touched follow the new detection exactly. The
 * face pack is rebuilt from the merged pins so lip sync, blink, and
 * expressions track the new head position, keeping any expression
 * overrides the pack already carried.
 */
export function rederiveRig(previous: CustomRig, input: RederiveInput): CustomRig {
  const oldDetected = previous.detectedPins ?? previous.pins;
  const merged = {} as PinSet;
  for (const id of PIN_IDS) {
    if (previous.userAdjustedPins.includes(id)) {
      const delta = {
        x: previous.pins[id].x - oldDetected[id].x,
        y: previous.pins[id].y - oldDetected[id].y,
      };
      merged[id] = clampPin({
        x: input.detected[id].x + delta.x,
        y: input.detected[id].y + delta.y,
      });
    } else {
      merged[id] = { ...input.detected[id] };
    }
  }
  const boneMap = boneMapFromPins(merged);
  const freshFace = buildFacePack(merged, boneMap);
  const facePack: FacePack = previous.facePack.expressionOverrides
    ? { ...freshFace, expressionOverrides: previous.facePack.expressionOverrides }
    : freshFace;
  const next: CustomRig = {
    ...previous,
    pins: merged,
    detectedPins: input.detected,
    boneMap,
    mode: input.decision.mode,
    quality: input.decision.quality,
    qualityNote: input.decision.qualityNote,
    facePack,
    baseImageRef: input.baseImageRef,
    derivedAt: input.derivedAt ?? previous.derivedAt,
  };
  if (input.imageSize !== undefined) next.imageSize = input.imageSize;
  return next;
}

// ---------------------------------------------------------------------------
// Library persistence shape (pure serialize and validate)
// ---------------------------------------------------------------------------

/**
 * The user library record for one custom character. The editor persists
 * these records through its existing user library storage (the same
 * localStorage backed library the media panel uses); this module owns
 * the shape and its validation so a record written by one project opens
 * intact in another.
 */
export interface CustomCharacterRecord {
  def: CustomCharacterDef;
  /** ISO timestamp the character was saved to the library. */
  savedAt: string;
}

export function serializeCustomCharacter(
  def: CustomCharacterDef,
  savedAt: string,
): string {
  return JSON.stringify({ def, savedAt } satisfies CustomCharacterRecord);
}

export function parseCustomCharacterRecord(
  raw: string,
): CustomCharacterRecord | null {
  try {
    const parsed = JSON.parse(raw) as CustomCharacterRecord;
    if (!parsed || typeof parsed !== "object") return null;
    if (!isValidCustomCharacterDef(parsed.def)) return null;
    if (typeof parsed.savedAt !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function parseCustomCharacterLibrary(raw: string): CustomCharacterDef[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: CustomCharacterDef[] = [];
    for (const item of parsed) {
      const def = (item as CustomCharacterRecord)?.def ?? (item as CustomCharacterDef);
      if (isValidCustomCharacterDef(def)) out.push(def);
    }
    return out;
  } catch {
    return [];
  }
}

export function isValidCustomCharacterDef(
  def: unknown,
): def is CustomCharacterDef {
  if (!def || typeof def !== "object") return false;
  const d = def as CustomCharacterDef;
  if (typeof d.id !== "string" || typeof d.name !== "string") return false;
  const rig = d.customRig;
  if (!rig || typeof rig !== "object") return false;
  if (!rig.pins || typeof rig.pins !== "object") return false;
  for (const id of PIN_IDS) {
    const p = rig.pins[id];
    if (!p || typeof p.x !== "number" || typeof p.y !== "number") return false;
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
  }
  if (!Array.isArray(rig.boneMap?.joints)) return false;
  if (rig.boneMap.joints.length !== BONES.length) return false;
  if (rig.mode !== "segmented" && rig.mode !== "puppet-warp") return false;
  if (!rig.facePack || typeof rig.facePack.scale !== "number") return false;
  return true;
}
