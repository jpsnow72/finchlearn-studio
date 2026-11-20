/**
 * styles.ts: style families for generated assets (issues #93 and #95).
 *
 * Generated art targets a style family so a prop or background lands
 * in a scene looking like it belongs there. The built in families are
 * the rigged cast families from packages/characters: Direction A
 * (Clean Corporate Flat, called Clean Flat in the asset issues),
 * Direction B (Warm Storybook Soft, called Warm Storybook), and
 * Direction D (Bold Ink Editorial). A custom character set carries
 * its own style, represented here as data (an id, a name, and an
 * optional plain words description) so a set built by the user rigging
 * work can be targeted without this package knowing how sets are made.
 *
 * Resolution order (first hit wins):
 *   1. an explicit pick by the user in the generate panel,
 *   2. the current scene (a custom set in the scene, else the family
 *      most of the scene characters use),
 *   3. the current project (same rule across the whole project),
 *   4. Direction A, the launch family.
 * The caller extracts the scene and project contexts from the project
 * JSON; this module is pure resolution over plain data.
 */

export type BuiltInStyleFamilyId = "A" | "B" | "D";

export interface CustomStyleSetRef {
  id: string;
  name: string;
  /** Plain words style description, sent to the provider as guidance. */
  description?: string;
}

export interface StyleFamilyDescriptor {
  id: BuiltInStyleFamilyId;
  name: string;
  /** Library tag stamped on every asset generated in this family. */
  tag: string;
  /** Style guidance sent to the generation provider. */
  promptGuidance: string;
}

export const STYLE_FAMILY_DESCRIPTORS: Record<BuiltInStyleFamilyId, StyleFamilyDescriptor> = {
  A: {
    id: "A",
    name: "Clean Corporate Flat",
    tag: "style-a-clean-flat",
    promptGuidance:
      "Clean Corporate Flat style: flat vector shapes, crisp clean edges, flat fills with no gradients, calm corporate palette",
  },
  B: {
    id: "B",
    name: "Warm Storybook Soft",
    tag: "style-b-warm-storybook",
    promptGuidance:
      "Warm Storybook Soft style: flat vector shapes with rounded corners, warm colours, gentle soft shading, friendly storybook feel",
  },
  D: {
    id: "D",
    name: "Bold Ink Editorial",
    tag: "style-d-bold-ink-editorial",
    promptGuidance:
      "Bold Ink Editorial style: flat vector shapes with confident dark ink outlines, flat saturated colour blocks, angular tapered geometry",
  },
};

export const BUILT_IN_STYLE_FAMILIES: StyleFamilyDescriptor[] = [
  STYLE_FAMILY_DESCRIPTORS.A,
  STYLE_FAMILY_DESCRIPTORS.B,
  STYLE_FAMILY_DESCRIPTORS.D,
];

/** What the caller knows about one scope (a scene or a whole project). */
export interface StyleContext {
  /** Families of the characters present, in scene order. */
  characterFamilies?: BuiltInStyleFamilyId[];
  /** The custom character set in this scope, when one is in use. */
  customStyleSet?: CustomStyleSetRef;
}

/** An explicit pick in the generate panel: a built in family or a set. */
export type ExplicitStyle =
  | { family: BuiltInStyleFamilyId }
  | { customSet: CustomStyleSetRef };

export type StyleResolutionSource = "explicit" | "scene" | "project" | "default";

export interface ResolvedStyle {
  /** Built in family id, or "custom" for a custom character set. */
  familyId: BuiltInStyleFamilyId | "custom";
  familyName: string;
  /** Library tag stamped on generated assets in this style. */
  tag: string;
  /** Style guidance sent to the generation provider. */
  promptGuidance: string;
  source: StyleResolutionSource;
  customSet?: CustomStyleSetRef;
}

function slugify(value: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "set";
}

export function customStyleTag(set: CustomStyleSetRef): string {
  return `style-custom-${slugify(set.id)}`;
}

function resolvedCustom(set: CustomStyleSetRef, source: StyleResolutionSource): ResolvedStyle {
  return {
    familyId: "custom",
    familyName: set.name,
    tag: customStyleTag(set),
    promptGuidance:
      `Match the custom character set "${set.name}"` +
      (set.description ? `: ${set.description}` : "") +
      ". Keep the same flat vector look, palette, and line treatment as that set",
    source,
    customSet: set,
  };
}

function resolvedBuiltIn(id: BuiltInStyleFamilyId, source: StyleResolutionSource): ResolvedStyle {
  const d = STYLE_FAMILY_DESCRIPTORS[id];
  return {
    familyId: d.id,
    familyName: d.name,
    tag: d.tag,
    promptGuidance: d.promptGuidance,
    source,
  };
}

/** The family most characters use; ties keep the earliest in order. */
export function majorityFamily(
  families: BuiltInStyleFamilyId[] | undefined,
): BuiltInStyleFamilyId | undefined {
  if (!families || families.length === 0) return undefined;
  const counts = new Map<BuiltInStyleFamilyId, number>();
  for (const f of families) counts.set(f, (counts.get(f) ?? 0) + 1);
  let best: BuiltInStyleFamilyId | undefined;
  let bestCount = 0;
  for (const f of families) {
    const c = counts.get(f) ?? 0;
    if (c > bestCount) {
      best = f;
      bestCount = c;
    }
  }
  return best;
}

function fromContext(
  context: StyleContext | undefined,
  source: StyleResolutionSource,
): ResolvedStyle | undefined {
  if (!context) return undefined;
  if (context.customStyleSet) return resolvedCustom(context.customStyleSet, source);
  const family = majorityFamily(context.characterFamilies);
  return family ? resolvedBuiltIn(family, source) : undefined;
}

/**
 * Resolve the style a generation should target. Pure and total: with
 * no explicit pick and no characters anywhere it falls back to
 * Direction A, the launch family, and says so in `source`.
 */
export function resolveStyleFamily(input: {
  explicit?: ExplicitStyle;
  scene?: StyleContext;
  project?: StyleContext;
}): ResolvedStyle {
  if (input.explicit) {
    if ("customSet" in input.explicit) {
      return resolvedCustom(input.explicit.customSet, "explicit");
    }
    return resolvedBuiltIn(input.explicit.family, "explicit");
  }
  return (
    fromContext(input.scene, "scene") ??
    fromContext(input.project, "project") ??
    resolvedBuiltIn("A", "default")
  );
}
