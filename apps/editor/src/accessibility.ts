/**
 * Section 508 pre-flight check (issue #63).
 *
 * A pure, automated pass over the project that runs before export and
 * flags the three problems a reviewer would otherwise catch by hand:
 * - text whose colour contrasts too little with what sits behind it
 *   (WCAG 2.1 AA: 4.5 to 1 for body text, 3 to 1 for large text),
 * - text below the Studio minimum font size, and
 * - content that flashes faster than the WCAG 2.3.1 threshold (more
 *   than three flashes in any one second), counted from authored
 *   opacity animation tracks and presets.
 *
 * Findings are grouped per scene and carry the scene id, so the export
 * dialog can offer a jump to scene action for every finding. The check
 * never blocks an export by itself; it reports, the author decides.
 *
 * Where the style comes from: text objects in the editor model carry
 * their styling as inline HTML (style attributes and heading tags) plus
 * optional authored metadata under extensions["x-finch-studio"]
 * (textColor, backgroundColor, fontSizePx). Anything unstyled falls
 * back to what the stage and export renderers actually paint: 22px
 * dark text (#1a1a1a, the canvas export colour) on the scene
 * background, which defaults to white. A shape the text sits on top
 * of (earlier in the scene, overlapping the text box) supplies the
 * effective background before the scene background does.
 */
import {
  expandAnimationPreset,
  type AnimationTrack,
  type CourseObject,
  type ShapeObject,
  type TextObject,
  type VideoProject,
} from "@finch-studio/core";
import { projectTimeline } from "@finch-studio/animation";

export type PreflightCheckKind = "contrast" | "font-size" | "flash";

export interface PreflightFinding {
  kind: PreflightCheckKind;
  sceneId: string;
  sceneName: string;
  /** Object the finding belongs to, when it is object scoped. */
  objectId?: string;
  objectName?: string;
  /** Human readable, copy ready for the findings list. No em dashes. */
  message: string;
  /** Measured values behind the message, for tests and tooltips. */
  detail: Record<string, number | string>;
}

export interface PreflightSceneReport {
  sceneId: string;
  sceneName: string;
  findings: PreflightFinding[];
}

export interface PreflightReport {
  findings: PreflightFinding[];
  byScene: PreflightSceneReport[];
  /** True when nothing was flagged. */
  pass: boolean;
}

export interface PreflightOptions {
  /** Normal text contrast floor (WCAG AA). Default 4.5. */
  contrastNormal?: number;
  /** Large text contrast floor (WCAG AA). Default 3. */
  contrastLarge?: number;
  /** Px size at or above which text counts as large. Default 24. */
  largeTextPx?: number;
  /** Minimum allowed font size in px. Default 12. */
  minFontSizePx?: number;
  /** Max flashes allowed in any one second (WCAG 2.3.1). Default 3. */
  maxFlashesPerSecond?: number;
}

export const DEFAULT_PREFLIGHT_OPTIONS: Required<PreflightOptions> = {
  contrastNormal: 4.5,
  contrastLarge: 3,
  largeTextPx: 24,
  minFontSizePx: 12,
  maxFlashesPerSecond: 3,
};

/** What the export canvas paints for unstyled text (videoExport drawObject). */
export const DEFAULT_TEXT_COLOR = "#1a1a1a";
export const DEFAULT_SCENE_BACKGROUND = "#ffffff";
export const DEFAULT_FONT_SIZE_PX = 22;
/** Heading sizes as multiples of the 22px base the stage renderer uses. */
const HEADING_SCALE: Record<string, number> = { h1: 2, h2: 1.5, h3: 1.17, h4: 1 };

// ---------------------------------------------------------------------------
// Colour math (WCAG 2.1 relative luminance and contrast ratio)
// ---------------------------------------------------------------------------

/** Parse #rgb, #rrggbb, #rrggbbaa, rgb() and rgba() into 0..255 channels. */
export function parseColor(
  input: string | undefined,
): { r: number; g: number; b: number; a: number } | null {
  if (!input) return null;
  const s = input.trim().toLowerCase();
  const hex = s.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    const h = hex[1];
    if (h.length === 3) {
      return {
        r: parseInt(h[0] + h[0], 16),
        g: parseInt(h[1] + h[1], 16),
        b: parseInt(h[2] + h[2], 16),
        a: 1,
      };
    }
    if (h.length === 6 || h.length === 8) {
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
        a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
      };
    }
    return null;
  }
  const rgb = s.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/);
  if (rgb) {
    const alphaRaw = rgb[4];
    const a = alphaRaw === undefined ? 1 : alphaRaw.endsWith("%")
      ? Number(alphaRaw.slice(0, -1)) / 100
      : Number(alphaRaw);
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a };
  }
  const named: Record<string, string> = {
    black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000",
    blue: "#0000ff", yellow: "#ffff00", gray: "#808080", grey: "#808080",
    orange: "#ffa500", purple: "#800080", pink: "#ffc0cb",
  };
  return named[s] ? parseColor(named[s]) : null;
}

function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio between two colours, 1 (same) to 21 (black on white). */
export function contrastRatio(foreground: string, background: string): number | null {
  const fg = parseColor(foreground);
  const bg = parseColor(background);
  if (!fg || !bg) return null;
  // Composite a translucent foreground over the background first.
  const mix = (f: number, b: number) => f * fg.a + b * (1 - fg.a);
  const fgFlat = { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b) };
  const l1 = relativeLuminance(fgFlat);
  const l2 = relativeLuminance(bg);
  const [light, dark] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (light + 0.05) / (dark + 0.05);
}

// ---------------------------------------------------------------------------
// Text style extraction
// ---------------------------------------------------------------------------

export interface TextStyleInfo {
  /** Plain text content (tags stripped). */
  text: string;
  color?: string;
  backgroundColor?: string;
  fontSizePx?: number;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function fontSizeFromCssValue(raw: string): number | undefined {
  const m = raw.trim().match(/^([\d.]+)\s*(px|pt|em|rem|%)?$/i);
  if (!m) return undefined;
  const value = Number(m[1]);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  const unit = (m[2] ?? "px").toLowerCase();
  if (unit === "pt") return value * (96 / 72);
  if (unit === "em" || unit === "rem") return value * DEFAULT_FONT_SIZE_PX;
  if (unit === "%") return (value / 100) * DEFAULT_FONT_SIZE_PX;
  return value;
}

/**
 * The effective style of one text object: authored metadata first, then
 * inline HTML styles and heading tags, then renderer defaults are left
 * for the caller to apply.
 */
export function textStyleOf(object: TextObject): TextStyleInfo {
  const meta = object.extensions?.["x-finch-studio"] ?? {};
  const html = object.content ?? "";
  const info: TextStyleInfo = { text: stripTags(html) };

  if (typeof meta.textColor === "string") info.color = meta.textColor;
  if (typeof meta.backgroundColor === "string") info.backgroundColor = meta.backgroundColor;
  if (typeof meta.fontSizePx === "number" && Number.isFinite(meta.fontSizePx)) {
    info.fontSizePx = meta.fontSizePx;
  }

  // Inline styles: the last declaration in document order wins, matching
  // how nested markup renders (inner spans override outer ones).
  for (const match of html.matchAll(/style\s*=\s*"([^"]*)"|style\s*=\s*'([^']*)'/gi)) {
    const style = match[1] ?? match[2] ?? "";
    for (const decl of style.split(";")) {
      const [prop, ...rest] = decl.split(":");
      if (!prop || rest.length === 0) continue;
      const value = rest.join(":").trim();
      const name = prop.trim().toLowerCase();
      if (name === "color") info.color = value;
      if (name === "background-color") info.backgroundColor = value;
      if (name === "font-size") {
        const px = fontSizeFromCssValue(value);
        if (px !== undefined) info.fontSizePx = px;
      }
    }
  }
  const fontTag = html.match(/<font[^>]*\bcolor\s*=\s*"?([^"\s>]+)"?/i);
  if (fontTag && !meta.textColor) info.color = fontTag[1];

  if (info.fontSizePx === undefined) {
    const heading = html.match(/<(h[1-4])\b/i);
    if (heading) {
      info.fontSizePx = DEFAULT_FONT_SIZE_PX * (HEADING_SCALE[heading[1].toLowerCase()] ?? 1);
    }
  }
  return info;
}

// ---------------------------------------------------------------------------
// Flash detection
// ---------------------------------------------------------------------------

/** Opacity tracks for one object or scene: authored tracks plus the
 * tracks its presets expand to (the shared engine expansion). */
export function opacityTracksOf(source: {
  animations?: CourseObject["animations"];
}): AnimationTrack[] {
  const anim = source.animations;
  if (!anim) return [];
  const fromPresets = (anim.presets ?? []).flatMap((preset) =>
    expandAnimationPreset(preset.name, { start: preset.start, duration: preset.duration }),
  );
  return [...fromPresets, ...(anim.timeline ?? [])].filter(
    (t) => t.property === "opacity",
  );
}

/**
 * Flash instants (ms) in a set of opacity tracks. A track segment counts
 * as one flash when it swings between near off (0.25 or less) and near
 * on (0.75 or more); the flash is stamped at the segment midpoint.
 */
export function flashInstantsMs(tracks: AnimationTrack[]): number[] {
  const instants: number[] = [];
  for (const t of tracks) {
    const swing = Math.abs(t.to - t.from);
    const crosses = (t.from <= 0.25 && t.to >= 0.75) || (t.to <= 0.25 && t.from >= 0.75);
    if (!crosses || swing < 0.5) continue;
    const start = t.start ?? 0;
    const duration = Math.max(1, t.duration ?? 600);
    instants.push(start + duration / 2);
  }
  return instants.sort((a, b) => a - b);
}

/** The most flashes inside any one second window. */
export function maxFlashesInOneSecond(instantsMs: number[]): number {
  let max = 0;
  for (let i = 0; i < instantsMs.length; i++) {
    let count = 0;
    for (let j = i; j < instantsMs.length; j++) {
      if (instantsMs[j] - instantsMs[i] < 1000) count++;
      else break;
    }
    if (count > max) max = count;
  }
  return max;
}

// ---------------------------------------------------------------------------
// The pre-flight pass
// ---------------------------------------------------------------------------

function rectsOverlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function objectRect(object: CourseObject): { x: number; y: number; w: number; h: number } | null {
  const p = object.position;
  if (!p || p.w === undefined || p.h === undefined) return null;
  return { x: p.x ?? 0, y: p.y ?? 0, w: p.w, h: p.h };
}

/** Background colour a text object effectively sits on in its scene. */
export function effectiveTextBackground(
  scene: { background?: string; objects: CourseObject[] },
  textObject: CourseObject,
): string {
  const style = textStyleOf(textObject as TextObject);
  if (style.backgroundColor && parseColor(style.backgroundColor)) {
    return style.backgroundColor;
  }
  const textRect = objectRect(textObject);
  const sceneObjects = scene.objects ?? [];
  const textIndex = sceneObjects.findIndex((o) => o.id === textObject.id);
  if (textRect) {
    // The topmost shape painted before the text and overlapping it.
    const below = sceneObjects
      .slice(0, textIndex < 0 ? sceneObjects.length : textIndex)
      .filter((o) => o.type === "shape");
    for (let i = below.length - 1; i >= 0; i--) {
      const shape = below[i] as ShapeObject;
      const rect = objectRect(shape);
      if (rect && rectsOverlap(rect, textRect) && typeof shape.fill === "string" && parseColor(shape.fill)) {
        return shape.fill as string;
      }
    }
  }
  return scene.background ?? DEFAULT_SCENE_BACKGROUND;
}

export function runPreflight(
  project: VideoProject,
  options: PreflightOptions = {},
): PreflightReport {
  const opts: Required<PreflightOptions> = { ...DEFAULT_PREFLIGHT_OPTIONS, ...options };
  const findings: PreflightFinding[] = [];
  const byScene: PreflightSceneReport[] = [];
  // Reference the project timeline so scene order in the report matches
  // export order even when transitions overlap scenes.
  const ordered = projectTimeline(project).scenes.map((t) => t.scene);
  const scenes = ordered.length > 0 ? ordered : project.scenes;

  for (const scene of scenes) {
    const sceneFindings: PreflightFinding[] = [];
    const push = (f: PreflightFinding) => {
      sceneFindings.push(f);
      findings.push(f);
    };

    // Scene level flash check (scene effects animate the whole frame).
    const sceneFlashes = maxFlashesInOneSecond(flashInstantsMs(opacityTracksOf(scene)));
    if (sceneFlashes > opts.maxFlashesPerSecond) {
      push({
        kind: "flash",
        sceneId: scene.id,
        sceneName: scene.name,
        message: `Scene flashes ${sceneFlashes} times in one second. The limit is ${opts.maxFlashesPerSecond} flashes per second (WCAG 2.3.1). Slow the scene effects down.`,
        detail: { flashesInOneSecond: sceneFlashes, maxAllowed: opts.maxFlashesPerSecond },
      });
    }

    for (const object of scene.objects ?? []) {
      if (object.visible === false) continue;
      const objectName = object.name ?? object.type;

      if (object.type === "text") {
        const textObject = object as TextObject;
        const style = textStyleOf(textObject);
        if (style.text) {
          const fontSizePx = style.fontSizePx ?? DEFAULT_FONT_SIZE_PX;
          if (fontSizePx < opts.minFontSizePx) {
            push({
              kind: "font-size",
              sceneId: scene.id,
              sceneName: scene.name,
              objectId: object.id,
              objectName,
              message: `Text "${truncate(style.text)}" is ${round1(fontSizePx)}px. The minimum is ${opts.minFontSizePx}px. Make the text larger.`,
              detail: { fontSizePx: round1(fontSizePx), minFontSizePx: opts.minFontSizePx },
            });
          }
          const foreground = style.color ?? DEFAULT_TEXT_COLOR;
          const background = effectiveTextBackground(scene, object);
          const ratio = contrastRatio(foreground, background);
          if (ratio !== null) {
            const large = fontSizePx >= opts.largeTextPx;
            const required = large ? opts.contrastLarge : opts.contrastNormal;
            if (ratio < required) {
              push({
                kind: "contrast",
                sceneId: scene.id,
                sceneName: scene.name,
                objectId: object.id,
                objectName,
                message: `Text "${truncate(style.text)}" has contrast ${ratio.toFixed(2)} to 1 against its background. ${large ? "Large" : "Body"} text needs at least ${required} to 1 (WCAG AA). Darken the text or lighten the background.`,
                detail: {
                  ratio: Number(ratio.toFixed(2)),
                  required,
                  foreground,
                  background,
                  fontSizePx: round1(fontSizePx),
                },
              });
            }
          }
        }
      }

      // Object level flash check.
      const flashes = maxFlashesInOneSecond(flashInstantsMs(opacityTracksOf(object)));
      if (flashes > opts.maxFlashesPerSecond) {
        push({
          kind: "flash",
          sceneId: scene.id,
          sceneName: scene.name,
          objectId: object.id,
          objectName,
          message: `"${objectName}" flashes ${flashes} times in one second. The limit is ${opts.maxFlashesPerSecond} flashes per second (WCAG 2.3.1). Slow its animation down.`,
          detail: { flashesInOneSecond: flashes, maxAllowed: opts.maxFlashesPerSecond },
        });
      }
    }

    byScene.push({ sceneId: scene.id, sceneName: scene.name, findings: sceneFindings });
  }

  return { findings, byScene, pass: findings.length === 0 };
}

function truncate(text: string, max = 40): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
