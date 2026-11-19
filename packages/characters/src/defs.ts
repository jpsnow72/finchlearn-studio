/**
 * Character definitions, style families, and customization (issue #20).
 *
 * A character is a small data record: a style family plus colour and hair
 * choices over the standard skeleton. Style families are art packs keyed
 * to the same parts and bones: Direction A (Clean Corporate Flat) is the
 * launch family, Direction B (Warm Storybook Soft) is the approved
 * secondary set, and more packs (and user rigged sets, #74) plug into the
 * same shape. Switching family restyles a character without touching its
 * actions, expressions, or scene placement.
 */

export type StyleFamilyId = "A" | "B";

export interface StyleFamily {
  id: StyleFamilyId;
  name: string;
  /** Head scale relative to the standard skeleton (B runs larger heads). */
  headScale: number;
  /** Corner softness multiplier for part shapes (B is rounder). */
  roundness: number;
  /** Soft gradient shading (B) vs flat fills (A). */
  softShading: boolean;
}

export const STYLE_FAMILIES: Record<StyleFamilyId, StyleFamily> = {
  A: { id: "A", name: "Clean Corporate Flat", headScale: 1, roundness: 1, softShading: false },
  B: { id: "B", name: "Warm Storybook Soft", headScale: 1.12, roundness: 1.35, softShading: true },
};

export type HairStyle = "bob" | "short" | "curly" | "gray-short" | "bun" | "bald";
export type Accessory = "none" | "glasses";

export interface CharacterDef {
  id: string;
  name: string;
  family: StyleFamilyId;
  skin: string;
  hairColor: string;
  hairStyle: HairStyle;
  topColor: string;
  bottomColor: string;
  shoeColor: string;
  accessory: Accessory;
}

export const SKIN_TONES = ["#FFDFC4", "#F0C8A0", "#D9A066", "#B07B4F", "#8D5524", "#5C3836"];
export const HAIR_COLORS = ["#1F2430", "#3B2A20", "#6B4423", "#A9713F", "#C9A227", "#B0B3B8", "#7A4A8C", "#2E6E6A"];
export const OUTFIT_COLORS = ["#274690", "#F2B134", "#D95D39", "#2E6E6A", "#6C4AB0", "#44484F", "#8C2F39", "#E8E3D8"];

export const STUDIO_CHARACTERS: CharacterDef[] = [
  {
    id: "maya", name: "Maya", family: "A",
    skin: "#D9A066", hairColor: "#1F2430", hairStyle: "bob",
    topColor: "#274690", bottomColor: "#274690", shoeColor: "#1F2430", accessory: "none",
  },
  {
    id: "leo", name: "Leo", family: "A",
    skin: "#F0C8A0", hairColor: "#3B2A20", hairStyle: "short",
    topColor: "#F2B134", bottomColor: "#44484F", shoeColor: "#3B2A20", accessory: "none",
  },
  {
    id: "rosa", name: "Rosa", family: "B",
    skin: "#D9A066", hairColor: "#6B4423", hairStyle: "curly",
    topColor: "#E4B33C", bottomColor: "#5F7052", shoeColor: "#6B4423", accessory: "none",
  },
  {
    id: "walter", name: "Walter", family: "B",
    skin: "#F0C8A0", hairColor: "#B0B3B8", hairStyle: "gray-short",
    topColor: "#8A6D4B", bottomColor: "#33526B", shoeColor: "#3B2A20", accessory: "glasses",
  },
];

export function characterById(id: string): CharacterDef {
  return STUDIO_CHARACTERS.find((c) => c.id === id) ?? STUDIO_CHARACTERS[0];
}

/** Deterministically pick a studio character for any legacy character id. */
export function characterForLegacyId(legacyId: string): CharacterDef {
  let h = 0;
  for (let i = 0; i < legacyId.length; i++) h = (h * 31 + legacyId.charCodeAt(i)) | 0;
  return STUDIO_CHARACTERS[Math.abs(h) % STUDIO_CHARACTERS.length];
}

export interface CustomizationChoices {
  family?: StyleFamilyId;
  skin?: string;
  hairColor?: string;
  hairStyle?: HairStyle;
  topColor?: string;
  bottomColor?: string;
  shoeColor?: string;
  accessory?: Accessory;
}

/** Apply builder choices (Tier 1 of user created characters, #74). */
export function customizeCharacter(base: CharacterDef, choices: CustomizationChoices): CharacterDef {
  return { ...base, ...stripUndefined(choices) };
}

function stripUndefined(obj: CustomizationChoices): Partial<CustomizationChoices> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as Partial<CustomizationChoices>;
}

/** A fresh user built character from choices alone. */
export function buildCharacter(id: string, name: string, choices: CustomizationChoices): CharacterDef {
  return customizeCharacter(
    {
      id, name, family: "A",
      skin: SKIN_TONES[1], hairColor: HAIR_COLORS[1], hairStyle: "short",
      topColor: OUTFIT_COLORS[0], bottomColor: OUTFIT_COLORS[5], shoeColor: "#1F2430",
      accessory: "none",
    },
    choices,
  );
}
