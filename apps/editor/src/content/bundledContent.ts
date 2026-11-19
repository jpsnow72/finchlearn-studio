/**
 * Bundled content pack (issue #101): original, hand authored vector props
 * and full frame backgrounds in the two approved Studio art families.
 *
 * Direction A (Clean Corporate Flat) and Direction B (Warm Storybook Soft)
 * are the same families as the rigged cast (packages/characters): A is
 * flat fills with crisp corners, B is warmer colours, rounder corners,
 * and soft gradient shading. Every design is drawn once as a function of
 * the family palette, so each asset ships in both families.
 *
 * Props are first class scene objects through the existing image object
 * mechanism: placing one creates an image object whose resource is the
 * inline SVG data URI, so it is placeable, resizable, animatable, and
 * drawn by both the stage renderer and the export renderer.
 *
 * Backgrounds ride the existing scene background layer: applying one
 * stores a `bundled-bg:<id>` reference in scene.background (the field the
 * stage and both export paths already read). The stage resolves the
 * reference to a CSS background and the export renderer resolves it to
 * the same SVG artwork drawn full frame, so a swapped background looks
 * identical on stage and in an exported MP4.
 *
 * Provenance: every asset in this file is original FinchLearn work,
 * authored for this pack. No third party art, no AI generation (#95),
 * no Lottie or motion graphics (#99 and #100), no new art style (#53).
 */
import type { CourseObject } from "@finch-studio/core";

export type BundledFamily = "A" | "B";

export interface BundledProvenance {
  origin: "original-bundled";
  license: string;
  author: string;
}

export const BUNDLED_PROVENANCE: BundledProvenance = {
  origin: "original-bundled",
  license: "FinchLearn original work, cleared for commercial use",
  author: "FinchLearn Studio bundled content pack",
};

export type PropCategory =
  | "office"
  | "presentation"
  | "health-safety"
  | "tech"
  | "arrows-callouts"
  | "celebration-seasonal";

export type BackgroundCategory =
  | "office"
  | "classroom"
  | "meeting"
  | "warehouse"
  | "outdoor"
  | "abstract";

export interface BundledProp {
  id: string;
  name: string;
  category: PropCategory;
  family: BundledFamily;
  tags: string[];
  /** Full standalone SVG document (transparent background). */
  svg: string;
  /** Inline data URI form used as the scene object resource. */
  dataUri: string;
  viewBox: string;
  /** Default placement size on the 1280 by 720 stage, in scene pixels. */
  defaultSize: { w: number; h: number };
  provenance: BundledProvenance;
}

export interface BundledBackground {
  id: string;
  name: string;
  category: BackgroundCategory;
  family: BundledFamily;
  tags: string[];
  svg: string;
  dataUri: string;
  viewBox: string;
  provenance: BundledProvenance;
}

interface Palette {
  ink: string;
  primary: string;
  accent: string;
  teal: string;
  coral: string;
  paper: string;
  gray: string;
  mid: string;
  soft: string;
  floor: string;
  sky: string;
  round: number;
  softShading: boolean;
}

/** Family palettes keyed to the cast colours in packages/characters. */
const PALETTES: Record<BundledFamily, Palette> = {
  A: {
    ink: "#1F2430", primary: "#274690", accent: "#F2B134", teal: "#2E6E6A",
    coral: "#D95D39", paper: "#FFFFFF", gray: "#44484F", mid: "#8A93A6",
    soft: "#DCE6F5", floor: "#B9C6DC", sky: "#BFE0F2", round: 4, softShading: false,
  },
  B: {
    ink: "#4A3628", primary: "#8A6D4B", accent: "#E4B33C", teal: "#5F7052",
    coral: "#C96F4A", paper: "#FFF9EF", gray: "#6B5744", mid: "#B49B7F",
    soft: "#F3E3C8", floor: "#D9C29A", sky: "#F6D9A8", round: 12, softShading: true,
  },
};

const FAMILY_NAMES: Record<BundledFamily, string> = {
  A: "Clean Corporate Flat",
  B: "Warm Storybook Soft",
};

export function bundledFamilyName(family: BundledFamily): string {
  return FAMILY_NAMES[family];
}

function svgDocument(viewBox: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${body}</svg>`;
}

export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Soft shading gradient block for family B; empty string for flat A. */
function shade(p: Palette, id: string, from: string, to: string): string {
  if (!p.softShading) return "";
  return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>`;
}

function fill(p: Palette, id: string, flat: string): string {
  return p.softShading ? `url(#${id})` : flat;
}

// ---------------------------------------------------------------------------
// Prop designs. Each returns inner SVG markup on a 0 0 200 200 canvas.
// ---------------------------------------------------------------------------

type PropDraw = (p: Palette) => string;

const PROP_DESIGNS: { slug: string; name: string; category: PropCategory; tags: string[]; draw: PropDraw }[] = [
  { slug: "desk", name: "Desk", category: "office", tags: ["desk", "office", "table", "work"], draw: (p) => `
    <rect x="20" y="86" width="160" height="14" rx="${p.round}" fill="${p.primary}"/>
    <rect x="32" y="100" width="12" height="62" fill="${p.gray}"/><rect x="156" y="100" width="12" height="62" fill="${p.gray}"/>
    <rect x="118" y="104" width="52" height="26" rx="${p.round}" fill="${p.soft}"/>
    <rect x="124" y="112" width="40" height="5" rx="2" fill="${p.mid}"/>` },
  { slug: "office-chair", name: "Office chair", category: "office", tags: ["chair", "office", "seat"], draw: (p) => `
    <rect x="66" y="26" width="68" height="62" rx="${p.round * 2}" fill="${p.teal}"/>
    <rect x="58" y="92" width="84" height="16" rx="${p.round * 2}" fill="${p.primary}"/>
    <rect x="96" y="108" width="8" height="34" fill="${p.gray}"/>
    <path d="M100 142 L64 164 M100 142 L100 168 M100 142 L136 164" stroke="${p.gray}" stroke-width="7" stroke-linecap="round"/>` },
  { slug: "laptop", name: "Laptop", category: "office", tags: ["laptop", "computer", "tech", "work"], draw: (p) => `
    <rect x="44" y="52" width="112" height="76" rx="${p.round}" fill="${p.ink}"/>
    <rect x="52" y="60" width="96" height="60" fill="${p.sky}"/>
    <rect x="62" y="70" width="52" height="8" rx="3" fill="${p.paper}"/><rect x="62" y="84" width="76" height="8" rx="3" fill="${p.paper}" opacity="0.7"/>
    <path d="M34 140 L166 140 L156 128 L44 128 Z" fill="${p.mid}"/>` },
  { slug: "monitor", name: "Desktop monitor", category: "office", tags: ["monitor", "screen", "computer", "display"], draw: (p) => `
    <rect x="30" y="38" width="140" height="96" rx="${p.round}" fill="${p.ink}"/>
    <rect x="38" y="46" width="124" height="80" fill="${p.soft}"/>
    <rect x="50" y="58" width="60" height="10" rx="3" fill="${p.primary}"/><rect x="50" y="76" width="88" height="8" rx="3" fill="${p.mid}"/><rect x="50" y="90" width="74" height="8" rx="3" fill="${p.mid}"/>
    <rect x="94" y="134" width="12" height="20" fill="${p.gray}"/><rect x="70" y="154" width="60" height="8" rx="3" fill="${p.gray}"/>` },
  { slug: "notebook", name: "Notebook and pen", category: "office", tags: ["notebook", "notes", "pen", "writing"], draw: (p) => `
    <rect x="46" y="34" width="96" height="132" rx="${p.round}" fill="${p.paper}" stroke="${p.mid}" stroke-width="3"/>
    <rect x="46" y="34" width="16" height="132" fill="${p.coral}"/>
    <path d="M74 62 h52 M74 84 h52 M74 106 h52 M74 128 h34" stroke="${p.mid}" stroke-width="5" stroke-linecap="round"/>
    <path d="M138 118 L168 148 L156 160 L126 130 Z" fill="${p.accent}"/><path d="M168 148 L172 166 L154 162 Z" fill="${p.ink}"/>` },
  { slug: "coffee-mug", name: "Coffee mug", category: "office", tags: ["coffee", "mug", "drink", "break"], draw: (p) => `
    <path d="M52 66 h84 v62 a14 14 0 0 1 -14 14 h-56 a14 14 0 0 1 -14 -14 Z" fill="${p.coral}"/>
    <path d="M136 78 q30 6 24 28 q-5 20 -28 18" fill="none" stroke="${p.coral}" stroke-width="10"/>
    <ellipse cx="94" cy="66" rx="42" ry="8" fill="${p.ink}" opacity="0.55"/>
    <path d="M76 40 q6 -10 0 -18 M102 40 q6 -10 0 -18" stroke="${p.mid}" stroke-width="5" fill="none" stroke-linecap="round"/>` },
  { slug: "desk-lamp", name: "Desk lamp", category: "office", tags: ["lamp", "light", "desk"], draw: (p) => `
    <ellipse cx="100" cy="168" rx="40" ry="8" fill="${p.gray}"/>
    <path d="M100 166 L100 104 L138 62" stroke="${p.gray}" stroke-width="9" fill="none" stroke-linecap="round"/>
    <path d="M122 44 L166 62 L148 92 L112 70 Z" fill="${p.accent}"/>
    <circle cx="140" cy="80" r="7" fill="${p.paper}"/>` },
  { slug: "potted-plant", name: "Potted plant", category: "office", tags: ["plant", "green", "decor", "office"], draw: (p) => `
    <path d="M64 118 h72 l-8 50 h-56 Z" fill="${p.coral}"/>
    <rect x="58" y="106" width="84" height="14" rx="${p.round}" fill="${p.primary}"/>
    <path d="M100 106 C100 76 84 62 58 56 C64 84 78 100 100 106 C100 70 116 52 144 46 C142 78 126 98 100 106" fill="${p.teal}"/>` },
  { slug: "presentation-board", name: "Presentation board", category: "presentation", tags: ["board", "presentation", "screen", "meeting"], draw: (p) => `
    <rect x="26" y="34" width="148" height="100" rx="${p.round}" fill="${p.paper}" stroke="${p.primary}" stroke-width="6"/>
    <path d="M44 108 L78 78 L104 92 L140 56" stroke="${p.coral}" stroke-width="7" fill="none" stroke-linecap="round"/>
    <circle cx="140" cy="56" r="6" fill="${p.accent}"/>
    <path d="M62 134 L48 168 M138 134 L152 168" stroke="${p.gray}" stroke-width="7" stroke-linecap="round"/>` },
  { slug: "flip-chart", name: "Flip chart", category: "presentation", tags: ["flip chart", "easel", "presentation", "workshop"], draw: (p) => `
    <rect x="52" y="26" width="96" height="104" rx="${p.round}" fill="${p.paper}" stroke="${p.mid}" stroke-width="4"/>
    <rect x="52" y="26" width="96" height="16" fill="${p.primary}"/>
    <path d="M66 62 h68 M66 82 h68 M66 102 h44" stroke="${p.mid}" stroke-width="6" stroke-linecap="round"/>
    <path d="M64 130 L44 172 M136 130 L156 172 M100 130 L100 172" stroke="${p.gray}" stroke-width="7" stroke-linecap="round"/>` },
  { slug: "podium", name: "Podium", category: "presentation", tags: ["podium", "speaker", "stage", "talk"], draw: (p) => `
    <path d="M56 52 h88 l-8 116 h-72 Z" fill="${p.primary}"/>
    <rect x="44" y="38" width="112" height="16" rx="${p.round}" fill="${p.accent}"/>
    <circle cx="100" cy="102" r="17" fill="${p.paper}"/><path d="M92 102 l6 6 l12 -13" stroke="${p.teal}" stroke-width="5" fill="none" stroke-linecap="round"/>` },
  { slug: "bar-chart-card", name: "Bar chart card", category: "presentation", tags: ["chart", "bars", "data", "report"], draw: (p) => `
    <rect x="34" y="34" width="132" height="132" rx="${p.round * 2}" fill="${p.paper}" stroke="${p.mid}" stroke-width="3"/>
    <rect x="56" y="102" width="20" height="42" fill="${p.teal}"/><rect x="88" y="80" width="20" height="64" fill="${p.primary}"/><rect x="120" y="58" width="20" height="86" fill="${p.accent}"/>
    <path d="M48 144 h104" stroke="${p.ink}" stroke-width="4" stroke-linecap="round"/>` },
  { slug: "microphone", name: "Microphone", category: "presentation", tags: ["microphone", "audio", "speaker", "voice"], draw: (p) => `
    <rect x="84" y="24" width="32" height="72" rx="16" fill="${p.gray}"/>
    <path d="M84 44 h32 M84 62 h32" stroke="${p.ink}" stroke-width="4"/>
    <path d="M62 78 a38 38 0 0 0 76 0" fill="none" stroke="${p.ink}" stroke-width="7" stroke-linecap="round"/>
    <path d="M100 122 L100 158 M76 168 h48" stroke="${p.ink}" stroke-width="7" stroke-linecap="round"/>` },
  { slug: "first-aid-kit", name: "First aid kit", category: "health-safety", tags: ["first aid", "health", "medical", "safety"], draw: (p) => `
    <rect x="34" y="62" width="132" height="98" rx="${p.round * 2}" fill="${p.paper}" stroke="${p.mid}" stroke-width="3"/>
    <path d="M74 62 v-10 a10 10 0 0 1 10 -10 h32 a10 10 0 0 1 10 10 v10" fill="none" stroke="${p.gray}" stroke-width="8"/>
    <path d="M100 82 v58 M71 111 h58" stroke="#C0392B" stroke-width="16"/>` },
  { slug: "hard-hat", name: "Hard hat", category: "health-safety", tags: ["hard hat", "safety", "construction", "ppe"], draw: (p) => `
    <path d="M44 118 a56 52 0 0 1 112 0 Z" fill="${p.accent}"/>
    <rect x="88" y="52" width="24" height="22" rx="${p.round}" fill="${p.accent}"/>
    <rect x="28" y="118" width="144" height="14" rx="7" fill="${p.coral}"/>` },
  { slug: "safety-vest", name: "Safety vest", category: "health-safety", tags: ["vest", "safety", "hi vis", "ppe"], draw: (p) => `
    <path d="M70 30 L40 52 L56 74 L56 168 L144 168 L144 74 L160 52 L130 30 L118 62 L100 74 L82 62 Z" fill="${p.accent}"/>
    <path d="M56 108 h88 M56 140 h88" stroke="${p.mid}" stroke-width="10"/>
    <path d="M100 74 L100 168" stroke="${p.coral}" stroke-width="5"/>` },
  { slug: "fire-extinguisher", name: "Fire extinguisher", category: "health-safety", tags: ["fire", "extinguisher", "safety", "emergency"], draw: (p) => `
    <rect x="76" y="66" width="48" height="104" rx="${p.round * 2}" fill="#C0392B"/>
    <rect x="88" y="92" width="24" height="34" rx="${p.round}" fill="${p.paper}"/>
    <path d="M100 66 v-14 M84 40 q16 -12 32 0" stroke="${p.ink}" stroke-width="7" fill="none" stroke-linecap="round"/>
    <path d="M112 48 q26 4 30 26" stroke="${p.ink}" stroke-width="6" fill="none"/>` },
  { slug: "hand-sanitizer", name: "Hand sanitizer", category: "health-safety", tags: ["sanitizer", "hygiene", "health", "hands"], draw: (p) => `
    <path d="M74 78 h52 v78 a12 12 0 0 1 -12 12 h-28 a12 12 0 0 1 -12 -12 Z" fill="${p.teal}"/>
    <rect x="86" y="56" width="28" height="22" fill="${p.gray}"/>
    <path d="M100 56 v-12 h30" stroke="${p.gray}" stroke-width="9" fill="none" stroke-linecap="round"/>
    <rect x="84" y="102" width="32" height="38" rx="${p.round}" fill="${p.paper}"/>
    <path d="M92 121 h16 M100 113 v16" stroke="#C0392B" stroke-width="5"/>` },
  { slug: "warning-sign", name: "Warning sign", category: "health-safety", tags: ["warning", "sign", "caution", "safety"], draw: (p) => `
    <path d="M100 30 L176 162 L24 162 Z" fill="${p.accent}" stroke="${p.ink}" stroke-width="5" stroke-linejoin="round"/>
    <rect x="94" y="76" width="12" height="44" rx="6" fill="${p.ink}"/><circle cx="100" cy="140" r="8" fill="${p.ink}"/>` },
  { slug: "smartphone", name: "Smartphone", category: "tech", tags: ["phone", "smartphone", "mobile", "device"], draw: (p) => `
    <rect x="64" y="22" width="72" height="156" rx="${p.round * 3}" fill="${p.ink}"/>
    <rect x="71" y="36" width="58" height="118" fill="${p.sky}"/>
    <circle cx="100" cy="166" r="5" fill="${p.mid}"/>
    <rect x="80" y="52" width="40" height="7" rx="3" fill="${p.paper}"/><rect x="80" y="66" width="40" height="7" rx="3" fill="${p.paper}" opacity="0.7"/>` },
  { slug: "tablet", name: "Tablet", category: "tech", tags: ["tablet", "device", "screen"], draw: (p) => `
    <rect x="38" y="42" width="124" height="116" rx="${p.round * 2}" fill="${p.ink}"/>
    <rect x="46" y="50" width="108" height="100" fill="${p.soft}"/>
    <circle cx="72" cy="76" r="12" fill="${p.accent}"/><path d="M56 138 L96 104 L116 122 L136 106 L148 116 L148 150 L56 150 Z" fill="${p.teal}"/>` },
  { slug: "headphones", name: "Headphones", category: "tech", tags: ["headphones", "audio", "listen", "device"], draw: (p) => `
    <path d="M44 132 a56 56 0 0 1 112 0" fill="none" stroke="${p.ink}" stroke-width="11"/>
    <rect x="32" y="118" width="26" height="48" rx="${p.round * 2}" fill="${p.coral}"/>
    <rect x="142" y="118" width="26" height="48" rx="${p.round * 2}" fill="${p.coral}"/>
    <path d="M158 166 q4 22 -26 24" fill="none" stroke="${p.ink}" stroke-width="6" stroke-linecap="round"/>` },
  { slug: "keyboard", name: "Keyboard", category: "tech", tags: ["keyboard", "typing", "computer", "device"], draw: (p) => `
    <rect x="26" y="66" width="148" height="68" rx="${p.round * 2}" fill="${p.gray}"/>
    ${[0, 1, 2].map((r) => [0, 1, 2, 3, 4, 5].map((c) => `<rect x="${38 + c * 21}" y="${76 + r * 16}" width="16" height="11" rx="2" fill="${p.paper}"/>`).join("")).join("")}
    <rect x="66" y="122" width="68" height="8" rx="4" fill="${p.paper}"/>` },
  { slug: "video-camera", name: "Video camera", category: "tech", tags: ["camera", "video", "record", "device"], draw: (p) => `
    <rect x="34" y="66" width="96" height="68" rx="${p.round * 2}" fill="${p.primary}"/>
    <path d="M130 88 L168 66 L168 134 L130 112 Z" fill="${p.ink}"/>
    <circle cx="66" cy="100" r="15" fill="${p.sky}"/><circle cx="66" cy="100" r="7" fill="${p.ink}"/>
    <rect x="52" y="50" width="34" height="16" rx="${p.round}" fill="${p.coral}"/>` },
  { slug: "arrow-straight", name: "Straight arrow", category: "arrows-callouts", tags: ["arrow", "direction", "next", "pointer"], draw: (p) => `
    <path d="M26 84 h96 v-24 l52 40 l-52 40 v-24 h-96 Z" fill="${p.coral}"/>` },
  { slug: "arrow-curved", name: "Curved arrow", category: "arrows-callouts", tags: ["arrow", "curved", "turn", "direction"], draw: (p) => `
    <path d="M44 156 a62 62 0 0 1 84 -74" fill="none" stroke="${p.teal}" stroke-width="17"/>
    <path d="M106 52 L146 74 L112 104 Z" fill="${p.teal}"/>` },
  { slug: "callout-bubble", name: "Callout bubble", category: "arrows-callouts", tags: ["callout", "speech", "bubble", "note"], draw: (p) => `
    <rect x="28" y="42" width="144" height="88" rx="${p.round * 3}" fill="${p.paper}" stroke="${p.primary}" stroke-width="6"/>
    <path d="M66 130 l-8 30 l42 -30 Z" fill="${p.paper}" stroke="${p.primary}" stroke-width="6" stroke-linejoin="round"/>
    <path d="M52 74 h96 M52 98 h64" stroke="${p.mid}" stroke-width="7" stroke-linecap="round"/>` },
  { slug: "check-badge", name: "Check badge", category: "arrows-callouts", tags: ["check", "done", "badge", "correct"], draw: (p) => `
    <circle cx="100" cy="100" r="66" fill="${p.teal}"/>
    <circle cx="100" cy="100" r="52" fill="none" stroke="${p.paper}" stroke-width="4" stroke-dasharray="7 8"/>
    <path d="M70 102 l20 20 l42 -46" stroke="${p.paper}" stroke-width="13" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` },
  { slug: "location-pin", name: "Location pin", category: "arrows-callouts", tags: ["pin", "location", "map", "marker"], draw: (p) => `
    <path d="M100 22 a50 50 0 0 1 50 50 c0 36 -50 106 -50 106 c0 0 -50 -70 -50 -106 a50 50 0 0 1 50 -50" fill="${p.coral}"/>
    <circle cx="100" cy="72" r="21" fill="${p.paper}"/>` },
  { slug: "balloon", name: "Party balloon", category: "celebration-seasonal", tags: ["balloon", "party", "celebration"], draw: (p) => `
    <ellipse cx="100" cy="70" rx="46" ry="54" fill="${p.coral}"/>
    <ellipse cx="82" cy="50" rx="12" ry="20" fill="${p.paper}" opacity="0.45"/>
    <path d="M94 124 h12 l-6 12 Z" fill="${p.coral}"/>
    <path d="M100 136 q-12 14 0 26 q12 12 0 24" stroke="${p.gray}" stroke-width="4" fill="none"/>` },
  { slug: "gift-box", name: "Gift box", category: "celebration-seasonal", tags: ["gift", "present", "celebration", "reward"], draw: (p) => `
    <rect x="42" y="78" width="116" height="88" rx="${p.round}" fill="${p.teal}"/>
    <rect x="34" y="56" width="132" height="26" rx="${p.round}" fill="${p.primary}"/>
    <rect x="92" y="56" width="16" height="110" fill="${p.accent}"/>
    <path d="M100 56 C70 20 36 44 58 56 C76 64 100 56 100 56 C100 56 124 64 142 56 C164 44 130 20 100 56" fill="${p.accent}"/>` },
  { slug: "trophy", name: "Trophy", category: "celebration-seasonal", tags: ["trophy", "award", "win", "achievement"], draw: (p) => `
    <path d="M58 30 h84 v34 a42 42 0 0 1 -84 0 Z" fill="${p.accent}"/>
    <path d="M58 44 C30 44 28 78 58 84 M142 44 C170 44 172 78 142 84" fill="none" stroke="${p.accent}" stroke-width="11"/>
    <rect x="92" y="100" width="16" height="26" fill="${p.accent}"/><rect x="66" y="126" width="68" height="12" rx="${p.round}" fill="${p.gray}"/><rect x="54" y="138" width="92" height="14" rx="${p.round}" fill="${p.ink}"/>` },
  { slug: "snowflake", name: "Snowflake", category: "celebration-seasonal", tags: ["snowflake", "winter", "seasonal", "holiday"], draw: (p) => `
    <g stroke="${p.teal}" stroke-width="9" stroke-linecap="round">
      <path d="M100 26 v148 M36 62 l128 76 M164 62 l-128 76"/>
      <path d="M84 40 l16 14 l16 -14 M84 160 l16 -14 l16 14 M50 56 l4 22 l22 4 M150 144 l-4 -22 l-22 -4 M150 56 l-4 22 l-22 4 M50 144 l4 -22 l22 -4"/>
    </g>` },
  { slug: "pumpkin", name: "Pumpkin", category: "celebration-seasonal", tags: ["pumpkin", "autumn", "fall", "seasonal"], draw: (p) => `
    <path d="M96 44 q4 -18 20 -20 q-2 12 -6 20 Z" fill="${p.teal}"/>
    <ellipse cx="100" cy="118" rx="66" ry="52" fill="${p.coral}"/>
    <ellipse cx="72" cy="118" rx="34" ry="50" fill="${p.coral}" stroke="#B34A28" stroke-width="3"/>
    <ellipse cx="128" cy="118" rx="34" ry="50" fill="${p.coral}" stroke="#B34A28" stroke-width="3"/>` },
];

// ---------------------------------------------------------------------------
// Background designs. Each returns inner SVG markup on a 0 0 1280 720 canvas.
// ---------------------------------------------------------------------------

type BgDraw = (p: Palette) => string;

const BG_VIEWBOX = "0 0 1280 720";
const PROP_VIEWBOX = "0 0 200 200";

function roomBase(p: Palette, wall: string, floorColor: string): string {
  return `<rect width="1280" height="720" fill="${fill(p, "bgwall", wall)}"/><rect y="520" width="1280" height="200" fill="${floorColor}"/><rect y="512" width="1280" height="10" fill="${p.ink}" opacity="0.14"/>`;
}

const BACKGROUND_DESIGNS: { slug: string; name: string; category: BackgroundCategory; tags: string[]; draw: BgDraw }[] = [
  { slug: "office", name: "Office", category: "office", tags: ["office", "work", "desk", "room"], draw: (p) => `
    ${shade(p, "bgwall", "#EAF1FA", "#C9D9EE")}${roomBase(p, "#EAF1FA", p.floor)}
    <rect x="70" y="90" width="300" height="240" rx="${p.round}" fill="${p.sky}"/><rect x="70" y="90" width="300" height="240" rx="${p.round}" fill="none" stroke="${p.paper}" stroke-width="14"/>
    <path d="M220 90 v240 M70 210 h300" stroke="${p.paper}" stroke-width="10"/>
    <rect x="880" y="90" width="300" height="240" rx="${p.round}" fill="${p.sky}"/><path d="M1030 90 v240 M880 210 h300" stroke="${p.paper}" stroke-width="10"/>
    <rect x="470" y="140" width="340" height="200" rx="${p.round}" fill="${p.paper}"/><path d="M510 290 L610 210 L680 250 L770 170" stroke="${p.coral}" stroke-width="10" fill="none" stroke-linecap="round"/>
    <rect x="120" y="470" width="440" height="26" rx="${p.round}" fill="${p.primary}"/><rect x="150" y="496" width="20" height="90" fill="${p.gray}"/><rect x="510" y="496" width="20" height="90" fill="${p.gray}"/>
    <rect x="760" y="470" width="400" height="26" rx="${p.round}" fill="${p.primary}"/><rect x="790" y="496" width="20" height="90" fill="${p.gray}"/><rect x="1110" y="496" width="20" height="90" fill="${p.gray}"/>
    <rect x="230" y="404" width="90" height="62" rx="${p.round}" fill="${p.ink}"/><rect x="238" y="412" width="74" height="46" fill="${p.soft}"/>
    <path d="M1010 466 v-44 M1010 422 c0 -26 -16 -38 -40 -42 c4 24 16 38 40 42 M1010 422 c2 -28 18 -42 42 -46 c-2 26 -16 42 -42 46" fill="${p.teal}"/><rect x="986" y="462" width="48" height="12" rx="${p.round}" fill="${p.coral}"/>` },
  { slug: "classroom", name: "Classroom", category: "classroom", tags: ["classroom", "school", "learning", "room"], draw: (p) => `
    ${shade(p, "bgwall", "#FDF3E0", "#F3DFC0")}${roomBase(p, "#FDF3E0", p.floor)}
    <rect x="330" y="80" width="620" height="300" rx="${p.round}" fill="${p.teal}"/><rect x="330" y="80" width="620" height="300" rx="${p.round}" fill="none" stroke="${p.primary}" stroke-width="16"/>
    <path d="M380 150 h300 M380 200 h380 M380 250 h240" stroke="${p.paper}" stroke-width="9" stroke-linecap="round" opacity="0.85"/>
    <rect x="70" y="110" width="180" height="130" rx="${p.round}" fill="${p.accent}"/><path d="M92 150 h136 M92 182 h100" stroke="${p.ink}" stroke-width="8" stroke-linecap="round" opacity="0.5"/>
    <rect x="1030" y="110" width="180" height="130" rx="${p.round}" fill="${p.coral}"/><circle cx="1120" cy="158" r="26" fill="${p.paper}"/><path d="M1096 206 h48" stroke="${p.paper}" stroke-width="8" stroke-linecap="round"/>
    ${[170, 490, 810].map((x) => `<rect x="${x}" y="500" width="220" height="22" rx="${p.round}" fill="${p.primary}"/><rect x="${x + 16}" y="522" width="16" height="70" fill="${p.gray}"/><rect x="${x + 188}" y="522" width="16" height="70" fill="${p.gray}"/><rect x="${x + 52}" y="452" width="52" height="48" rx="${p.round}" fill="${p.mid}"/>`).join("")}` },
  { slug: "meeting-room", name: "Meeting room", category: "meeting", tags: ["meeting", "conference", "room", "team"], draw: (p) => `
    ${shade(p, "bgwall", "#EDF2F7", "#D3DEE9")}${roomBase(p, "#EDF2F7", p.floor)}
    <rect x="90" y="80" width="520" height="300" rx="${p.round}" fill="${p.sky}"/><path d="M350 80 v300 M90 230 h520" stroke="${p.paper}" stroke-width="12"/>
    <rect x="700" y="100" width="470" height="250" rx="${p.round}" fill="${p.paper}"/><rect x="730" y="130" width="410" height="130" rx="${p.round}" fill="${p.soft}"/>
    <rect x="760" y="160" width="150" height="70" fill="${p.teal}"/><rect x="940" y="190" width="150" height="40" fill="${p.accent}"/><rect x="760" y="290" width="330" height="10" rx="4" fill="${p.mid}"/>
    <ellipse cx="640" cy="540" rx="430" ry="74" fill="${p.primary}"/><ellipse cx="640" cy="522" rx="430" ry="74" fill="${p.mid}" opacity="0.35"/>
    ${[270, 470, 670, 870].map((x) => `<rect x="${x}" y="470" width="64" height="54" rx="${p.round * 2}" fill="${p.ink}"/>`).join("")}` },
  { slug: "warehouse", name: "Warehouse floor", category: "warehouse", tags: ["warehouse", "floor", "industrial", "logistics"], draw: (p) => `
    ${shade(p, "bgwall", "#E8EAED", "#C9CDD4")}${roomBase(p, "#E8EAED", "#9AA1AC")}
    <path d="M0 520 L420 300 M1280 520 L860 300 M640 720 L640 300" stroke="${p.paper}" stroke-width="6" opacity="0.4"/>
    ${[60, 420, 900].map((x) => `<rect x="${x}" y="180" width="300" height="240" fill="${p.gray}"/><rect x="${x + 14}" y="194" width="272" height="60" fill="${p.accent}"/><rect x="${x + 14}" y="268" width="272" height="60" fill="${p.coral}"/><rect x="${x + 14}" y="342" width="272" height="60" fill="${p.teal}"/><path d="M${x} 254 h300 M${x} 328 h300" stroke="${p.ink}" stroke-width="6" opacity="0.35"/>`).join("")}
    <rect x="540" y="70" width="200" height="90" rx="${p.round}" fill="${p.sky}"/><path d="M640 70 v90 M540 115 h200" stroke="${p.paper}" stroke-width="8"/>
    <path d="M120 640 h1040" stroke="${p.accent}" stroke-width="14" stroke-dasharray="46 30"/>` },
  { slug: "outdoor", name: "Outdoor park", category: "outdoor", tags: ["outdoor", "park", "nature", "sky"], draw: (p) => `
    ${shade(p, "bgsky", "#BFE0F2", "#8FC3E8")}<rect width="1280" height="720" fill="${fill(p, "bgsky", p.sky)}"/>
    <circle cx="1090" cy="120" r="62" fill="${p.accent}"/><circle cx="1090" cy="120" r="86" fill="${p.accent}" opacity="0.25"/>
    <g fill="${p.paper}"><ellipse cx="240" cy="110" rx="110" ry="34"/><ellipse cx="330" cy="92" rx="70" ry="28"/><ellipse cx="760" cy="170" rx="90" ry="26"/><ellipse cx="830" cy="156" rx="56" ry="22"/></g>
    <path d="M0 470 Q320 400 640 460 T1280 440 V720 H0 Z" fill="${p.teal}"/>
    <path d="M0 560 Q400 500 820 550 T1280 540 V720 H0 Z" fill="${p.teal}" opacity="0.75"/>
    ${[150, 1080].map((x) => `<rect x="${x}" y="380" width="18" height="130" rx="8" fill="${p.primary === "#274690" ? "#6B4423" : p.primary}"/><circle cx="${x + 9}" cy="330" r="72" fill="${p.teal}"/><circle cx="${x - 42}" cy="366" r="44" fill="${p.teal}"/><circle cx="${x + 60}" cy="366" r="44" fill="${p.teal}"/>`).join("")}
    <path d="M480 720 C560 640 720 640 800 720 Z" fill="${p.floor}"/>` },
  { slug: "abstract-waves", name: "Abstract waves", category: "abstract", tags: ["abstract", "waves", "backdrop", "soft"], draw: (p) => `
    ${shade(p, "bgwall", "#EAF1FA", "#BFD4EE")}<rect width="1280" height="720" fill="${fill(p, "bgwall", p.soft)}"/>
    <path d="M0 470 C240 380 420 560 700 470 C940 396 1100 500 1280 430 V720 H0 Z" fill="${p.primary}" opacity="0.85"/>
    <path d="M0 540 C260 460 480 620 760 540 C980 478 1140 560 1280 510 V720 H0 Z" fill="${p.teal}" opacity="0.85"/>
    <path d="M0 620 C300 550 560 680 860 610 C1060 565 1180 620 1280 590 V720 H0 Z" fill="${p.ink}" opacity="0.55"/>
    <circle cx="180" cy="150" r="70" fill="${p.accent}" opacity="0.8"/><circle cx="1080" cy="120" r="42" fill="${p.coral}" opacity="0.7"/><circle cx="960" cy="230" r="20" fill="${p.primary}" opacity="0.6"/>` },
  { slug: "abstract-gradient", name: "Gradient set", category: "abstract", tags: ["abstract", "gradient", "backdrop", "clean"], draw: (p) => `
    <defs><linearGradient id="bggrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.primary}"/><stop offset="0.55" stop-color="${p.teal}"/><stop offset="1" stop-color="${p.accent}"/></linearGradient></defs>
    <rect width="1280" height="720" fill="url(#bggrad)"/>
    <circle cx="1140" cy="90" r="200" fill="${p.paper}" opacity="0.14"/><circle cx="90" cy="660" r="240" fill="${p.ink}" opacity="0.12"/>
    <path d="M0 600 L1280 380 V720 H0 Z" fill="${p.paper}" opacity="0.10"/>` },
];

// ---------------------------------------------------------------------------
// Catalogue registration.
// ---------------------------------------------------------------------------

function buildProps(): BundledProp[] {
  const out: BundledProp[] = [];
  for (const family of ["A", "B"] as BundledFamily[]) {
    const p = PALETTES[family];
    for (const design of PROP_DESIGNS) {
      const body = `${shade(p, "shade", "#FFFFFF", "#000000")}${design.draw(p)}`;
      const svg = svgDocument(PROP_VIEWBOX, body);
      out.push({
        id: `prop-${design.slug}-${family.toLowerCase()}`,
        name: design.name,
        category: design.category,
        family,
        tags: [...design.tags, family === "A" ? "flat" : "storybook"],
        svg,
        dataUri: svgToDataUri(svg),
        viewBox: PROP_VIEWBOX,
        defaultSize: { w: 200, h: 200 },
        provenance: BUNDLED_PROVENANCE,
      });
    }
  }
  return out;
}

function buildBackgrounds(): BundledBackground[] {
  const out: BundledBackground[] = [];
  for (const family of ["A", "B"] as BundledFamily[]) {
    const p = PALETTES[family];
    for (const design of BACKGROUND_DESIGNS) {
      const svg = svgDocument(BG_VIEWBOX, design.draw(p));
      out.push({
        id: `bg-${design.slug}-${family.toLowerCase()}`,
        name: design.name,
        category: design.category,
        family,
        tags: [...design.tags, family === "A" ? "flat" : "storybook"],
        svg,
        dataUri: svgToDataUri(svg),
        viewBox: BG_VIEWBOX,
        provenance: BUNDLED_PROVENANCE,
      });
    }
  }
  return out;
}

export const BUNDLED_PROPS: BundledProp[] = buildProps();
export const BUNDLED_BACKGROUNDS: BundledBackground[] = buildBackgrounds();

export function bundledPropById(id: string): BundledProp | undefined {
  return BUNDLED_PROPS.find((prop) => prop.id === id);
}

export function bundledBackgroundById(id: string): BundledBackground | undefined {
  return BUNDLED_BACKGROUNDS.find((bg) => bg.id === id);
}

/** Free text search over name, category, family, and tags. */
export function searchBundledProps(query: string): BundledProp[] {
  const q = query.trim().toLowerCase();
  if (!q) return BUNDLED_PROPS;
  return BUNDLED_PROPS.filter((prop) =>
    [prop.name, prop.category, bundledFamilyName(prop.family), ...prop.tags]
      .some((value) => value.toLowerCase().includes(q)),
  );
}

export function searchBundledBackgrounds(query: string): BundledBackground[] {
  const q = query.trim().toLowerCase();
  if (!q) return BUNDLED_BACKGROUNDS;
  return BUNDLED_BACKGROUNDS.filter((bg) =>
    [bg.name, bg.category, bundledFamilyName(bg.family), ...bg.tags]
      .some((value) => value.toLowerCase().includes(q)),
  );
}

// ---------------------------------------------------------------------------
// Scene wiring: props as image objects, backgrounds as scene references.
// ---------------------------------------------------------------------------

let propCounter = 0;

/**
 * Create the scene object for a bundled prop. An image object carrying
 * the inline SVG, so the stage renderer, the properties panel, the
 * timeline, and the export renderer all treat it like any other object.
 * Provenance is stamped into the studio extension metadata.
 */
export function makeBundledPropObject(prop: BundledProp): CourseObject {
  propCounter += 1;
  return {
    id: `prop-${Date.now().toString(36)}-${propCounter}`,
    type: "image",
    name: `${prop.name} (${bundledFamilyName(prop.family)})`,
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
export function bundledBackgroundRef(bg: BundledBackground): string {
  return `bundled-bg:${bg.id}`;
}

const BG_REF_PREFIX = "bundled-bg:";

export function isBundledBackgroundRef(value: string | undefined): boolean {
  return typeof value === "string" && value.startsWith(BG_REF_PREFIX);
}

export function bundledBackgroundFromRef(
  value: string | undefined,
): BundledBackground | undefined {
  if (!isBundledBackgroundRef(value)) return undefined;
  return bundledBackgroundById((value as string).slice(BG_REF_PREFIX.length));
}

/** CSS background value for the stage: bundled art full frame, else the raw value. */
export function sceneBackgroundCss(value: string | undefined): string {
  const bg = bundledBackgroundFromRef(value);
  if (bg) return `url("${bg.dataUri}") center / cover no-repeat`;
  return value ?? "#ffffff";
}
