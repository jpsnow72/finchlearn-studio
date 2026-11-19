/**
 * The standard skeleton (issue #17). ONE bone set for every character in
 * every style family, forever: that is what makes actions portable across
 * characters, style packs (Direction A now, B as the secondary set, more
 * later), and user rigged characters (#74).
 *
 * Character space is 200 x 400 units, origin top left, ground at y=392.
 * Bones rotate around their joint point; positions are rest pose joints.
 */

export type BoneId =
  | "root"
  | "torso"
  | "neck"
  | "head"
  | "armUpperL"
  | "armLowerL"
  | "armUpperR"
  | "armLowerR"
  | "legUpperL"
  | "legLowerL"
  | "legUpperR"
  | "legLowerR";

export interface Bone {
  id: BoneId;
  parent: BoneId | null;
  /** Rest pose joint position in character space. */
  x: number;
  y: number;
}

export const BONES: Bone[] = [
  { id: "root", parent: null, x: 100, y: 238 },
  { id: "torso", parent: "root", x: 100, y: 232 },
  { id: "neck", parent: "torso", x: 100, y: 128 },
  { id: "head", parent: "neck", x: 100, y: 118 },
  { id: "armUpperL", parent: "torso", x: 76, y: 140 },
  { id: "armLowerL", parent: "armUpperL", x: 66, y: 186 },
  { id: "armUpperR", parent: "torso", x: 124, y: 140 },
  { id: "armLowerR", parent: "armUpperR", x: 134, y: 186 },
  { id: "legUpperL", parent: "root", x: 86, y: 244 },
  { id: "legLowerL", parent: "legUpperL", x: 84, y: 316 },
  { id: "legUpperR", parent: "root", x: 114, y: 244 },
  { id: "legLowerR", parent: "legUpperR", x: 116, y: 316 },
];

export const BONE_IDS: BoneId[] = BONES.map((b) => b.id);

/** The part slots every style family must provide (parity across packs). */
export const PART_SLOTS = [
  "hairBack",
  "legUpperL",
  "legLowerL",
  "legUpperR",
  "legLowerR",
  "shoeL",
  "shoeR",
  "torso",
  "armUpperL",
  "armLowerL",
  "armUpperR",
  "armLowerR",
  "handL",
  "handR",
  "neck",
  "head",
  "face",
  "hairFront",
] as const;

export type PartSlot = (typeof PART_SLOTS)[number];

export interface BoneTransform {
  rotate: number;
  dx: number;
  dy: number;
}

export const IDENTITY_TRANSFORM: BoneTransform = { rotate: 0, dx: 0, dy: 0 };

export type Pose = Partial<Record<BoneId, BoneTransform>>;

/** Fill a partial pose out to every bone with identity transforms. */
export function completePose(pose: Pose): Record<BoneId, BoneTransform> {
  const out = {} as Record<BoneId, BoneTransform>;
  for (const id of BONE_IDS) out[id] = pose[id] ?? IDENTITY_TRANSFORM;
  return out;
}
