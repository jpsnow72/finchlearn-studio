/**
 * Character source port (issue #74).
 *
 * Every way a custom character enters the library goes through this one
 * small interface, so sources are swappable and the wizard never cares
 * which one produced the art:
 *
 *  - "upload": one transparent PNG of a whole figure (pin rigging).
 *  - "parts": separate PNGs per body part (pin rigging, segmented).
 *  - "svg-template": an SVG matching the named layer template
 *    (svgTemplate.ts), which rigs itself with zero pins.
 *  - "generated": an AI generated character from a prompt or template.
 *
 * The "generated" kind is a SEAM ONLY in this lane. Image generation
 * itself belongs to the AI asset generation work; at compose time that
 * service binds a real provider behind this port. Until then the only
 * binding shipped here is UnconfiguredGeneratedSource, which reports
 * isConfigured false and fails honestly with
 * CharacterGenerationNotConfiguredError. Nothing in this package fakes
 * a generated character.
 */
import type { CustomCharacterDef } from "./rigging.js";
import type { StyleFamilyId } from "./defs.js";

export type CharacterSourceKind = "upload" | "parts" | "svg-template" | "generated";

export interface GeneratedCharacterRequest {
  kind: "generated";
  /** Free text description of the character to generate. */
  prompt: string;
  /** Optional named template or style the generation should follow. */
  template?: string;
  /**
   * Optional style family the generation should follow. When absent the
   * binding resolves the style from the scene, then the project, then
   * the launch family (issue #362).
   */
  styleFamily?: StyleFamilyId;
}

export type CharacterSourceRequest =
  | { kind: "upload"; imageRef: string; width: number; height: number }
  | { kind: "parts"; partRefs: { slot: string; ref: string }[] }
  | { kind: "svg-template"; svgText: string }
  | GeneratedCharacterRequest;

/**
 * A source of custom characters. Producing art is only half the job:
 * the returned value is the source material the rigging flow consumes
 * (an image reference, part references, or SVG text), never a finished
 * rig, so every source goes through the same rigging and quality
 * decisions.
 */
export interface CharacterSourcePort {
  readonly kind: CharacterSourceKind;
  /** Stable binding id, recorded for provenance. */
  readonly providerId: string;
  /** True when the binding has what it needs to run. */
  readonly isConfigured: boolean;
  /**
   * Produce source material for a request of this port's kind.
   * Implementations must throw on failure rather than return stand-in
   * art. Rigging the material into a CustomCharacterDef is the
   * caller's job (rigging.ts, svgTemplate.ts).
   */
  produce(request: CharacterSourceRequest): Promise<CharacterSourceMaterial>;
}

export type CharacterSourceMaterial =
  | { kind: "upload"; imageRef: string; width: number; height: number }
  | { kind: "parts"; partRefs: { slot: string; ref: string }[] }
  | { kind: "svg-template"; svgText: string };

/** No AI generation service is bound to the generated source yet. */
export class CharacterGenerationNotConfiguredError extends Error {
  readonly code = "character-generation-not-configured";
  constructor(message: string) {
    super(message);
    this.name = "CharacterGenerationNotConfiguredError";
  }
}

export const GENERATION_NOT_CONFIGURED_MESSAGE =
  "AI character generation is not available yet. The generation service " +
  "is not connected to Studio, so no character was created. Upload a PNG " +
  "or use the SVG template instead.";

/**
 * The seam binding for the "generated" source: present in the UI so the
 * entry point exists, honest about not being configured. At compose
 * time the AI asset generation service replaces this binding with a
 * real provider behind the same CharacterSourcePort interface; the
 * wizard and the rigging flow do not change.
 */
export class UnconfiguredGeneratedSource implements CharacterSourcePort {
  readonly kind = "generated" as const;
  readonly providerId = "generated-unconfigured";
  readonly isConfigured = false;

  async produce(_request: CharacterSourceRequest): Promise<CharacterSourceMaterial> {
    throw new CharacterGenerationNotConfiguredError(GENERATION_NOT_CONFIGURED_MESSAGE);
  }
}

/** Type guard for defs whose rig came from the generated source. */
export function isGeneratedSourceDef(def: CustomCharacterDef): boolean {
  return def.customRig.sourceKind === "generated";
}
