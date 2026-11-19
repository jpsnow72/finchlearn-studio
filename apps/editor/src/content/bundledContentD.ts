/**
 * Bundled content mini pack for style family D, Bold Ink Editorial
 * (issue #53). Original, hand authored vector art drawn in the family D
 * shape language: deep ink outlines, flat saturated colour blocks, and
 * angular geometry, matching the family D cast in packages/characters.
 *
 * COMPOSE SEAM (read before gating): the bundled content catalogue from
 * issue #101 (apps/editor/src/content/bundledContent.ts) is not on main
 * yet, so this pack ships as its own module that mirrors the #101
 * catalogue shape field for field: same provenance record, same id
 * scheme (prop-<slug>-d, bg-<slug>-d), the same bundled-bg:<id> scene
 * reference form, and the same provenance stamping in the prop object
 * factory. At compose time the merge is mechanical:
 *   1. extend BundledFamily in bundledContent.ts to "A" | "B" | "D",
 *   2. add the D palette and the "Bold Ink Editorial" family name,
 *   3. fold D_PROPS / D_BACKGROUNDS (or the design tables below) into
 *      BUNDLED_PROPS / BUNDLED_BACKGROUNDS,
 *   4. delete this module and point its tests at the merged catalogue.
 * Until that compose lands, this module is fully usable on its own: the
 * prop factory returns the same image object shape #101 uses, and the
 * background helpers use the same bundled-bg: reference prefix, so the
 * stage and export resolvers from the #101 lane read family D
 * backgrounds unchanged once the catalogues merge.
 */
import type { CourseObject } from "@finch-studio/core";

export type BundledDFamily = "D";

export interface BundledDProvenance {
  origin: "original-bundled";
  license: string;
  author: string;
}

export const BUNDLED_D_PROVENANCE: BundledDProvenance = {
  origin: "original-bundled",
  license: "FinchLearn original work, cleared for commercial use",
  author: "FinchLearn Studio bundled content pack",
};

export type DPropCategory = "office" | "presentation" | "arrows-callouts";
export type DBackgroundCategory = "office" | "classroom" | "abstract";

export interface BundledDProp {
  id: string;
  name: string;
  category: DPropCategory;
  family: BundledDFamily;
  tags: string[];
  /** Full standalone SVG document (transparent background). */
  svg: string;
  /** Inline data URI form used as the scene object resource. */
  dataUri: string;
  viewBox: string;
  /** Default placement size on the 1280 by 720 stage, in scene pixels. */
  defaultSize: { w: number; h: number };
  provenance: BundledDProvenance;
}

export interface BundledDBackground {
  id: string;
  name: string;
  category: DBackgroundCategory;
  family: BundledDFamily;
  tags: string[];
  svg: string;
  dataUri: string;
  viewBox: string;
  provenance: BundledDProvenance;
}

/** Family D palette, keyed to the cast colours in packages/characters. */
export const D_PALETTE = {
  ink: "#1B2A3B",
  teal: "#0E7C6B",
  coral: "#E4572E",
  amber: "#F2A81D",
  slate: "#43536B",
  deep: "#22304A",
  paper: "#F7F3EA",
  soft: "#DCE9E4",
  floor: "#C9D4CE",
  sky: "#CFE6DF",
} as const;

type Palette = typeof D_PALETTE;

export const D_FAMILY_NAME = "Bold Ink Editorial";

export function bundledDFamilyName(): string {
  return D_FAMILY_NAME;
}

function svgDocument(viewBox: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`;
}

export function svgToDataUriD(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Shared ink outline attributes for the family D shape language. */
const ink = (p: Palette, w = 5) =>
  `stroke="${p.ink}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;

// ---------------------------------------------------------------------------
// Prop designs. Each returns inner SVG markup on a 0 0 200 200 canvas.
// ---------------------------------------------------------------------------

type PropDraw = (p: Palette) => string;

const PROP_DESIGNS: { slug: string; name: string; category: DPropCategory; tags: string[]; draw: PropDraw }[] = [
  {
    slug: "whiteboard", name: "Whiteboard", category: "presentation",
    tags: ["whiteboard", "board", "teach", "training", "chart"],
    draw: (p) => `
      <path d="M62 140 L52 178 M138 140 L148 178" ${ink(p)} fill="none"/>
      <rect x="28" y="34" width="144" height="108" fill="${p.paper}" ${ink(p)}/>
      <polyline points="46,118 76,88 100,102 132,62" fill="none" stroke="${p.coral}" stroke-width="6" stroke-linecap="round"/>
      <rect x="46" y="52" width="34" height="10" fill="${p.teal}"/>
      <rect x="46" y="70" width="24" height="10" fill="${p.slate}"/>`,
  },
  {
    slug: "standing-desk", name: "Standing desk", category: "office",
    tags: ["desk", "standing", "office", "work"],
    draw: (p) => `
      <path d="M48 96 L38 172 M152 96 L162 172" ${ink(p)} fill="none"/>
      <rect x="30" y="78" width="140" height="16" fill="${p.slate}" ${ink(p)}/>
      <rect x="76" y="44" width="48" height="32" fill="${p.paper}" ${ink(p)}/>
      <rect x="70" y="76" width="60" height="6" fill="${p.ink}"/>
      <rect x="140" y="58" width="16" height="20" fill="${p.coral}" ${ink(p)}/>`,
  },
  {
    slug: "books-stack", name: "Stack of books", category: "office",
    tags: ["books", "reading", "study", "learning"],
    draw: (p) => `
      <path d="M44 150 L156 150 L148 124 L52 124 Z" fill="${p.teal}" ${ink(p)}/>
      <path d="M52 124 L148 124 L142 100 L58 100 Z" fill="${p.coral}" ${ink(p)}/>
      <path d="M60 100 L140 100 L134 76 L66 76 Z" fill="${p.amber}" ${ink(p)}/>
      <rect x="128" y="76" width="8" height="24" fill="${p.paper}"/>
      <rect x="52" y="134" width="44" height="7" fill="${p.paper}"/>`,
  },
  {
    slug: "clipboard", name: "Clipboard checklist", category: "office",
    tags: ["clipboard", "checklist", "form", "tasks", "check"],
    draw: (p) => `
      <rect x="56" y="30" width="88" height="140" fill="${p.slate}" ${ink(p)}/>
      <rect x="66" y="44" width="68" height="116" fill="${p.paper}"/>
      <rect x="82" y="22" width="36" height="18" fill="${p.amber}" ${ink(p)}/>
      <path d="M76 78 l7 7 l13 -14" fill="none" stroke="${p.teal}" stroke-width="6" stroke-linecap="round"/>
      <rect x="102" y="72" width="24" height="7" fill="${p.ink}"/>
      <rect x="76" y="106" width="10" height="10" fill="none" ${ink(p, 4)}/>
      <rect x="102" y="106" width="24" height="7" fill="${p.ink}"/>
      <rect x="76" y="132" width="10" height="10" fill="none" ${ink(p, 4)}/>
      <rect x="102" y="132" width="24" height="7" fill="${p.ink}"/>`,
  },
  {
    slug: "water-bottle", name: "Water bottle", category: "office",
    tags: ["bottle", "water", "drink", "wellness"],
    draw: (p) => `
      <rect x="84" y="26" width="32" height="16" fill="${p.coral}" ${ink(p)}/>
      <path d="M84 42 L74 66 L74 160 a10 10 0 0 0 10 10 l32 0 a10 10 0 0 0 10 -10 L126 66 L116 42 Z" fill="${p.teal}" ${ink(p)}/>
      <path d="M74 104 L126 104 L126 138 L74 138 Z" fill="${p.soft}"/>
      <rect x="74" y="104" width="52" height="6" fill="${p.paper}"/>`,
  },
  {
    slug: "wall-clock", name: "Wall clock", category: "office",
    tags: ["clock", "time", "schedule", "deadline"],
    draw: (p) => `
      <circle cx="100" cy="100" r="66" fill="${p.paper}" ${ink(p, 7)}/>
      <path d="M100 52 L100 62 M148 100 L138 100 M100 148 L100 138 M52 100 L62 100" ${ink(p, 4)} fill="none"/>
      <path d="M100 100 L100 70 M100 100 L126 112" ${ink(p, 6)} fill="none"/>
      <path d="M100 100 L82 84" stroke="${p.coral}" stroke-width="4" stroke-linecap="round"/>
      <circle cx="100" cy="100" r="6" fill="${p.ink}"/>`,
  },
  {
    slug: "pointer-arrow", name: "Pointer arrow", category: "arrows-callouts",
    tags: ["arrow", "pointer", "next", "direction", "callout"],
    draw: (p) => `
      <path d="M26 78 L118 78 L118 52 L178 100 L118 148 L118 122 L26 122 Z" fill="${p.coral}" ${ink(p, 6)}/>`,
  },
  {
    slug: "star-badge", name: "Star badge", category: "arrows-callouts",
    tags: ["star", "badge", "achievement", "award", "callout"],
    draw: (p) => `
      <path d="M100 26 L120 68 L166 72 L130 102 L142 148 L100 124 L58 148 L70 102 L34 72 L80 68 Z" fill="${p.amber}" ${ink(p, 6)}/>
      <path d="M84 100 l11 11 l22 -24" fill="none" stroke="${p.ink}" stroke-width="7" stroke-linecap="round"/>`,
  },
  {
    slug: "checklist-card", name: "Checklist card", category: "presentation",
    tags: ["checklist", "card", "steps", "agenda", "presentation"],
    draw: (p) => `
      <path d="M44 40 L156 40 L156 164 L44 164 Z" fill="${p.paper}" ${ink(p)}/>
      <path d="M44 40 L156 40 L156 66 L44 66 Z" fill="${p.teal}"/>
      <rect x="58" y="50" width="52" height="8" fill="${p.paper}"/>
      <path d="M60 92 l6 6 l12 -13" fill="none" stroke="${p.teal}" stroke-width="6" stroke-linecap="round"/>
      <rect x="88" y="88" width="52" height="8" fill="${p.ink}"/>
      <path d="M60 122 l6 6 l12 -13" fill="none" stroke="${p.coral}" stroke-width="6" stroke-linecap="round"/>
      <rect x="88" y="118" width="40" height="8" fill="${p.ink}"/>`,
  },
  {
    slug: "angular-plant", name: "Angular plant", category: "office",
    tags: ["plant", "office", "decor", "green"],
    draw: (p) => `
      <path d="M100 96 L100 56 M100 96 L72 62 M100 96 L128 62" ${ink(p, 5)} fill="none"/>
      <path d="M100 22 L116 52 L100 62 L84 52 Z" fill="${p.teal}" ${ink(p, 4)}/>
      <path d="M62 44 L88 66 L78 82 L56 66 Z" fill="${p.teal}" ${ink(p, 4)}/>
      <path d="M138 44 L144 66 L122 82 L112 66 Z" fill="${p.teal}" ${ink(p, 4)}/>
      <path d="M66 104 L134 104 L124 168 L76 168 Z" fill="${p.coral}" ${ink(p)}/>
      <rect x="60" y="94" width="80" height="12" fill="${p.ink}"/>`,
  },
];

// ---------------------------------------------------------------------------
// Background designs. Each returns inner SVG markup on a 0 0 1280 720
// canvas and paints the full frame.
// ---------------------------------------------------------------------------

type BgDraw = (p: Palette) => string;

const BG_DESIGNS: { slug: string; name: string; category: DBackgroundCategory; tags: string[]; draw: BgDraw }[] = [
  {
    slug: "training-studio", name: "Training studio", category: "classroom",
    tags: ["training", "classroom", "studio", "whiteboard"],
    draw: (p) => `
      <rect x="0" y="0" width="1280" height="720" fill="${p.soft}"/>
      <rect x="0" y="540" width="1280" height="180" fill="${p.floor}"/>
      <rect x="0" y="532" width="1280" height="10" fill="${p.ink}"/>
      <rect x="340" y="110" width="600" height="330" fill="${p.paper}" ${ink(p, 8)}/>
      <polyline points="400,380 520,280 610,320 720,210 880,240" fill="none" stroke="${p.coral}" stroke-width="10" stroke-linecap="round"/>
      <rect x="400" y="160" width="180" height="22" fill="${p.teal}"/>
      <rect x="400" y="200" width="120" height="22" fill="${p.slate}"/>
      <path d="M240 0 L240 70 M1040 0 L1040 70" ${ink(p, 6)} fill="none"/>
      <path d="M206 70 L274 70 L262 116 L218 116 Z" fill="${p.amber}" ${ink(p, 6)}/>
      <path d="M1006 70 L1074 70 L1062 116 L1018 116 Z" fill="${p.amber}" ${ink(p, 6)}/>
      <path d="M120 620 L420 620 L400 560 L140 560 Z" fill="${p.slate}" ${ink(p, 6)}/>
      <path d="M860 620 L1160 620 L1140 560 L880 560 Z" fill="${p.slate}" ${ink(p, 6)}/>`,
  },
  {
    slug: "city-window", name: "City window office", category: "office",
    tags: ["office", "city", "window", "skyline"],
    draw: (p) => `
      <rect x="0" y="0" width="1280" height="720" fill="${p.paper}"/>
      <rect x="0" y="560" width="1280" height="160" fill="${p.floor}"/>
      <rect x="0" y="552" width="1280" height="10" fill="${p.ink}"/>
      <rect x="150" y="70" width="980" height="430" fill="${p.sky}" ${ink(p, 9)}/>
      <path d="M150 500 L150 330 L260 330 L260 500 Z" fill="${p.slate}"/>
      <path d="M300 500 L300 250 L430 250 L430 500 Z" fill="${p.deep}"/>
      <path d="M470 500 L470 360 L580 360 L580 500 Z" fill="${p.slate}"/>
      <path d="M620 500 L620 210 L770 210 L770 500 Z" fill="${p.teal}"/>
      <path d="M810 500 L810 320 L940 320 L940 500 Z" fill="${p.deep}"/>
      <path d="M980 500 L980 380 L1130 380 L1130 500 Z" fill="${p.slate}"/>
      <g fill="${p.amber}">
        <rect x="330" y="280" width="22" height="22"/><rect x="380" y="330" width="22" height="22"/>
        <rect x="660" y="250" width="22" height="22"/><rect x="710" y="310" width="22" height="22"/>
        <rect x="840" y="350" width="22" height="22"/><rect x="190" y="360" width="22" height="22"/>
      </g>
      <path d="M640 70 L640 500" ${ink(p, 7)} fill="none"/>`,
  },
  {
    slug: "simple-stage", name: "Simple stage", category: "abstract",
    tags: ["stage", "abstract", "minimal", "backdrop"],
    draw: (p) => `
      <rect x="0" y="0" width="1280" height="720" fill="${p.paper}"/>
      <circle cx="1010" cy="180" r="200" fill="${p.coral}"/>
      <circle cx="1010" cy="180" r="200" fill="none" ${ink(p, 8)}/>
      <path d="M0 470 L420 330 L420 720 L0 720 Z" fill="${p.teal}"/>
      <path d="M0 470 L420 330" ${ink(p, 8)} fill="none"/>
      <path d="M880 720 L1280 560 L1280 720 Z" fill="${p.amber}"/>
      <rect x="0" y="612" width="1280" height="8" fill="${p.ink}"/>
      <rect x="120" y="120" width="150" height="26" fill="${p.ink}"/>
      <rect x="120" y="166" width="96" height="26" fill="${p.slate}"/>`,
  },
];

// ---------------------------------------------------------------------------
// Catalogue build: same registration pattern as the #101 catalogue.
// ---------------------------------------------------------------------------

function buildDProps(): BundledDProp[] {
  return PROP_DESIGNS.map((design) => {
    const svg = svgDocument("0 0 200 200", design.draw(D_PALETTE));
    return {
      id: `prop-${design.slug}-d`,
      name: design.name,
      category: design.category,
      family: "D" as const,
      tags: [...design.tags, "editorial", "ink"],
      svg,
      dataUri: svgToDataUriD(svg),
      viewBox: "0 0 200 200",
      defaultSize: { w: 200, h: 200 },
      provenance: BUNDLED_D_PROVENANCE,
    };
  });
}

function buildDBackgrounds(): BundledDBackground[] {
  return BG_DESIGNS.map((design) => {
    const svg = svgDocument("0 0 1280 720", design.draw(D_PALETTE));
    return {
      id: `bg-${design.slug}-d`,
      name: design.name,
      category: design.category,
      family: "D" as const,
      tags: [...design.tags, "editorial", "ink"],
      svg,
      dataUri: svgToDataUriD(svg),
      viewBox: "0 0 1280 720",
      provenance: BUNDLED_D_PROVENANCE,
    };
  });
}

export const D_PROPS: BundledDProp[] = buildDProps();
export const D_BACKGROUNDS: BundledDBackground[] = buildDBackgrounds();

export function dPropById(id: string): BundledDProp | undefined {
  return D_PROPS.find((prop) => prop.id === id);
}

export function dBackgroundById(id: string): BundledDBackground | undefined {
  return D_BACKGROUNDS.find((bg) => bg.id === id);
}

/** Free text search over name, category, family, and tags (mirrors #101). */
export function searchDProps(query: string): BundledDProp[] {
  const q = query.trim().toLowerCase();
  if (!q) return D_PROPS;
  return D_PROPS.filter((prop) =>
    [prop.name, prop.category, bundledDFamilyName(), ...prop.tags]
      .some((value) => value.toLowerCase().includes(q)),
  );
}

export function searchDBackgrounds(query: string): BundledDBackground[] {
  const q = query.trim().toLowerCase();
  if (!q) return D_BACKGROUNDS;
  return D_BACKGROUNDS.filter((bg) =>
    [bg.name, bg.category, bundledDFamilyName(), ...bg.tags]
      .some((value) => value.toLowerCase().includes(q)),
  );
}

// ---------------------------------------------------------------------------
// Scene wiring: props as image objects, backgrounds as scene references.
// Same shapes as the #101 catalogue so the merge at compose is a fold-in.
// ---------------------------------------------------------------------------

let dPropCounter = 0;

/**
 * Create the scene object for a family D bundled prop: an image object
 * carrying the inline SVG, with provenance stamped into the studio
 * extension metadata, exactly as the #101 factory stamps its props.
 */
export function makeDPropObject(prop: BundledDProp): CourseObject {
  dPropCounter += 1;
  return {
    id: `prop-${Date.now().toString(36)}-${dPropCounter}`,
    type: "image",
    name: `${prop.name} (${bundledDFamilyName()})`,
    position: { x: 480, y: 260, w: prop.defaultSize.w, h: prop.defaultSize.h },
    resource: prop.dataUri,
    extensions: {
      "x-finch-studio": {
        bundledAssetId: prop.id,
        bundledKind: "prop",
        provenance: prop.provenance.origin,
        license: prop.provenance.license,
      },
    },
  } as unknown as CourseObject;
}

/** The scene.background value that references a bundled background. */
export function dBackgroundRef(bg: BundledDBackground): string {
  return `bundled-bg:${bg.id}`;
}

const BG_REF_PREFIX = "bundled-bg:";

export function isDBackgroundRef(value: string | undefined): boolean {
  return typeof value === "string" && value.startsWith(BG_REF_PREFIX);
}

export function dBackgroundFromRef(
  value: string | undefined,
): BundledDBackground | undefined {
  if (!isDBackgroundRef(value)) return undefined;
  return dBackgroundById((value as string).slice(BG_REF_PREFIX.length));
}

/**
 * Registration record for the family D pack, in the shape a merged
 * catalogue consumes at compose time (see the seam note at the top).
 */
export const D_CONTENT_PACK = {
  family: "D" as const,
  familyName: D_FAMILY_NAME,
  palette: D_PALETTE,
  props: D_PROPS,
  backgrounds: D_BACKGROUNDS,
  provenance: BUNDLED_D_PROVENANCE,
};
