/**
 * SVG named layer auto-rig (issue #74, Tier 3).
 *
 * The template is an SVG whose groups carry fixed names. An upload whose
 * groups match the template rigs itself at full part quality with zero
 * pins: each named group is already a body part, and the part anchors in
 * the template define the pin positions the bone map is built from.
 *
 * Matching is structural and forgiving about everything except the group
 * names themselves: extra groups are allowed (they ride along as
 * decoration on their nearest part), missing or renamed groups fail the
 * match with the exact list, so the UI can tell the user what to fix
 * instead of silently producing a broken rig.
 *
 * Parsing is text based on purpose: the same matcher runs in the editor,
 * in tests, and in tooling with no DOM dependency. It reads id and
 * data-part attributes on g elements, which is what design tools export
 * for named groups (Figma and Illustrator both write layer names as ids).
 */
import {
  buildRig,
  decideRigMode,
  type CustomRig,
  type PinSet,
} from "./rigging.js";

/** One required named group in the template. */
export interface SvgTemplatePart {
  /** The group name an upload must carry, exactly. */
  group: string;
  /** Part slot the group fills (skeleton.ts PART_SLOTS vocabulary). */
  slot: string;
  /** Default pin anchors this part provides, normalized 0 to 1. */
  pins: Partial<PinSet>;
}

export const SVG_TEMPLATE_PARTS: SvgTemplatePart[] = [
  { group: "head", slot: "head", pins: { headTop: { x: 0.5, y: 0.03 }, neck: { x: 0.5, y: 0.17 } } },
  { group: "torso", slot: "torso", pins: {} },
  { group: "arm-upper-left", slot: "armUpperL", pins: { shoulderL: { x: 0.37, y: 0.2 }, elbowL: { x: 0.22, y: 0.37 } } },
  { group: "arm-lower-left", slot: "armLowerL", pins: { wristL: { x: 0.08, y: 0.53 } } },
  { group: "arm-upper-right", slot: "armUpperR", pins: { shoulderR: { x: 0.63, y: 0.2 }, elbowR: { x: 0.78, y: 0.37 } } },
  { group: "arm-lower-right", slot: "armLowerR", pins: { wristR: { x: 0.92, y: 0.53 } } },
  { group: "leg-upper-left", slot: "legUpperL", pins: { hipL: { x: 0.44, y: 0.53 }, kneeL: { x: 0.43, y: 0.76 } } },
  { group: "leg-lower-left", slot: "legLowerL", pins: { ankleL: { x: 0.42, y: 0.98 } } },
  { group: "leg-upper-right", slot: "legUpperR", pins: { hipR: { x: 0.56, y: 0.53 }, kneeR: { x: 0.57, y: 0.76 } } },
  { group: "leg-lower-right", slot: "legLowerR", pins: { ankleR: { x: 0.58, y: 0.98 } } },
];

export const SVG_TEMPLATE_GROUPS: string[] = SVG_TEMPLATE_PARTS.map((p) => p.group);

/**
 * The downloadable template SVG: a spread pose figure outline with every
 * required group named, ready to trace over in a design tool. Art placed
 * inside each group replaces the outline; the group names must survive
 * the export for the auto-rig to match.
 */
export const SVG_TEMPLATE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 400">
  <!-- FinchLearn Studio character template. Keep every group name exactly as written. -->
  <g id="leg-upper-left"><rect x="78" y="212" width="16" height="92" rx="8" fill="#c9ced6"/></g>
  <g id="leg-lower-left"><rect x="77" y="300" width="15" height="88" rx="7" fill="#b7bdc9"/></g>
  <g id="leg-upper-right"><rect x="106" y="212" width="16" height="92" rx="8" fill="#c9ced6"/></g>
  <g id="leg-lower-right"><rect x="108" y="300" width="15" height="88" rx="7" fill="#b7bdc9"/></g>
  <g id="torso"><path d="M74 84 L126 84 L130 216 L70 216 Z" fill="#9aa3b2"/></g>
  <g id="arm-upper-left"><rect x="30" y="88" width="15" height="62" rx="7" transform="rotate(24 38 92)" fill="#c9ced6"/></g>
  <g id="arm-lower-left"><rect x="8" y="140" width="13" height="58" rx="6" transform="rotate(24 14 144)" fill="#b7bdc9"/></g>
  <g id="arm-upper-right"><rect x="155" y="88" width="15" height="62" rx="7" transform="rotate(-24 162 92)" fill="#c9ced6"/></g>
  <g id="arm-lower-right"><rect x="179" y="140" width="13" height="58" rx="6" transform="rotate(-24 186 144)" fill="#b7bdc9"/></g>
  <g id="head"><circle cx="100" cy="52" r="34" fill="#d8dce4"/></g>
</svg>`;

/** Extract the group names an SVG carries (id or data-part on g elements). */
export function svgGroupNames(svgText: string): string[] {
  const names: string[] = [];
  const tagRe = /<g\b[^>]*>/gi;
  let tag: RegExpExecArray | null;
  while ((tag = tagRe.exec(svgText)) !== null) {
    const idMatch = /\bid\s*=\s*"([^"]+)"/i.exec(tag[0]) ?? /\bid\s*=\s*'([^']+)'/i.exec(tag[0]);
    const partMatch =
      /\bdata-part\s*=\s*"([^"]+)"/i.exec(tag[0]) ?? /\bdata-part\s*=\s*'([^']+)'/i.exec(tag[0]);
    const name = partMatch?.[1] ?? idMatch?.[1];
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

export interface SvgTemplateMatch {
  matches: boolean;
  /** Required groups found in the upload. */
  present: string[];
  /** Required groups the upload is missing (renamed counts as missing). */
  missing: string[];
  /** Groups in the upload that are not part of the template. */
  extra: string[];
}

/** Match an SVG upload against the template, by group name. */
export function matchSvgTemplate(svgText: string): SvgTemplateMatch {
  const found = svgGroupNames(svgText);
  const present = SVG_TEMPLATE_GROUPS.filter((g) => found.includes(g));
  const missing = SVG_TEMPLATE_GROUPS.filter((g) => !found.includes(g));
  const extra = found.filter((g) => !SVG_TEMPLATE_GROUPS.includes(g));
  return { matches: missing.length === 0, present, missing, extra };
}

/** The pin set implied by the template anchors. */
export function pinsFromSvgTemplate(): PinSet {
  const pins = {} as PinSet;
  for (const part of SVG_TEMPLATE_PARTS) {
    for (const [pin, point] of Object.entries(part.pins)) {
      pins[pin as keyof PinSet] = { ...(point as { x: number; y: number }) };
    }
  }
  return pins;
}

/**
 * Build a full part quality rig from a matching SVG upload, with zero
 * pins placed by hand. Returns null when the upload does not match, so
 * callers fall back to the pin wizard with the match report in hand.
 * The SVG text itself is the base image: editing it and re-uploading
 * re-derives through the same match.
 */
export function rigFromSvgTemplate(
  svgText: string,
  derivedAt?: string,
): CustomRig | null {
  const match = matchSvgTemplate(svgText);
  if (!match.matches) return null;
  const pins = pinsFromSvgTemplate();
  const decision = decideRigMode({
    sourceKind: "svg-template",
    partCount: SVG_TEMPLATE_PARTS.length,
    hasTransparency: true,
  });
  return buildRig({
    sourceKind: "svg-template",
    pins,
    detectedPins: pins,
    decision,
    baseImageRef: svgText,
    imageSize: { width: 200, height: 400 },
    parts: SVG_TEMPLATE_PARTS.map((p) => ({ slot: p.slot, ref: p.group })),
    ...(derivedAt ? { derivedAt } : {}),
  });
}
