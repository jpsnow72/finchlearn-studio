/**
 * Timeline → CSS bridge (Vyond-lite MVP).
 *
 * Converts sampled animation values (from @finch-studio/core `sampleTimeline`) into
 * React inline styles. `x`/`y` are offsets applied via CSS transform on top
 * of the authored position, so animations compose with layout instead of
 * fighting it. `opacity` rides alongside any existing opacity.
 */
import type { CSSProperties } from "react";
import {
  DEFAULT_TRACK_DURATION_MS,
  sampleAnimations,
  sampleTimeline,
  type Animations,
  type AnimationTrack,
  type SampledValues,
} from "@finch-studio/core";

/**
 * Sample an object's timeline at `tMs` and return the inline style delta.
 * Returns an empty object when there is nothing to animate (cheap no-op).
 */
export function timelineStyleFor(
  timeline: AnimationTrack[] | Pick<Animations, "presets" | "timeline"> | undefined,
  tMs: number,
): CSSProperties {
  const v: SampledValues = Array.isArray(timeline)
    ? sampleTimeline(timeline, tMs)
    : sampleAnimations(timeline, tMs);
  return sampledToStyle(v);
}

/**
 * Convert already-sampled values to a CSSProperties object.
 */
export function sampledToStyle(v: SampledValues): CSSProperties {
  const transforms: string[] = [];
  if (v.x) transforms.push(`translateX(${v.x}px)`);
  if (v.y) transforms.push(`translateY(${v.y}px)`);
  if (v.scale !== undefined && v.scale !== 1) transforms.push(`scale(${v.scale})`);
  if (v.rotation) transforms.push(`rotate(${v.rotation}deg)`);
  const style: CSSProperties = {};
  if (transforms.length > 0) style.transform = transforms.join(" ");
  if (v.opacity !== undefined) style.opacity = v.opacity;
  if (v.wipeLeft !== undefined) {
    style.clipPath = `inset(0 ${(1 - v.wipeLeft) * 100}% 0 0)`;
  } else if (v.wipeRight !== undefined) {
    style.clipPath = `inset(0 0 0 ${(1 - v.wipeRight) * 100}%)`;
  } else if (v.wipeUp !== undefined) {
    style.clipPath = `inset(${(1 - v.wipeUp) * 100}% 0 0 0)`;
  } else if (v.wipeDown !== undefined) {
    style.clipPath = `inset(0 0 ${(1 - v.wipeDown) * 100}% 0)`;
  }
  return style;
}

/**
 * Baseline Reveal presentation (issue #112): while an object's
 * baselineReveal preset is still rising, the part of the object below
 * its resting baseline is masked, so it reads as rising from behind
 * an invisible line. The mask is the preset's own sampled y offset
 * (16px settling to 0) expressed as a bottom clip; before the window
 * the object sits fully behind the baseline, after it there is no
 * clip. Returns undefined when no baseline reveal applies or nothing
 * is masked. Hosts apply the returned clip-path to the object element
 * (a draw-on wipe, when present, takes precedence, as it is applied
 * later by the stage).
 */
export function baselineRevealClipPath(
  animations: Pick<Animations, "presets" | "timeline"> | undefined,
  tMs: number,
): string | undefined {
  const preset = animations?.presets?.find((p) => p.name === "baselineReveal");
  if (!preset) return undefined;
  const y = sampleAnimations({ presets: [preset] }, tMs).y;
  if (y === undefined || y <= 0) return undefined;
  return `inset(0 0 ${y}px 0)`;
}

/** Width of the block-reveal overlay slab, as a percent of the object. */
const BLOCK_REVEAL_SLAB_PCT = 14;

/**
 * Block Reveal overlay (issue #112): the solid color block the shared
 * registry's renderer note calls for. While an object's blockReveal
 * preset is inside its window, a slab rides the reveal front on the
 * not-yet-revealed side: the object's own wipeRight clip unmasks it
 * behind the slab (see sampledToStyle). The slab spans from the front
 * leftward and shrinks as the front exits the left edge. Returns null
 * outside the window or when no block reveal applies, so hosts render
 * the overlay only while it is on screen. Position it absolutely
 * inside the object's (positioned) element.
 */
export function blockRevealOverlayStyle(
  animations: Pick<Animations, "presets" | "timeline"> | undefined,
  tMs: number,
): CSSProperties | null {
  const preset = animations?.presets?.find((p) => p.name === "blockReveal");
  if (!preset) return null;
  const start = preset.start ?? 0;
  const duration = Math.max(1, preset.duration ?? DEFAULT_TRACK_DURATION_MS);
  if (tMs < start || tMs >= start + duration) return null;
  const v = sampleAnimations({ presets: [preset] }, tMs).wipeRight;
  if (v === undefined) return null;
  const frontPct = (1 - v) * 100;
  const widthPct = Math.min(BLOCK_REVEAL_SLAB_PCT, frontPct);
  if (widthPct <= 0) return null;
  return {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: `${frontPct - widthPct}%`,
    width: `${widthPct}%`,
    background: "var(--accent2, #3f6cc4)",
    pointerEvents: "none",
  };
}

/**
 * Merge an animation style delta into an existing style object.
 * Transform strings concatenate (animation offset applies after layout
 * transforms); opacity multiplies when both are set.
 */
export function mergeAnimatedStyle(
  base: CSSProperties | undefined,
  anim: CSSProperties,
): CSSProperties | undefined {
  if (!anim.transform && anim.opacity === undefined && anim.clipPath === undefined) return base;
  const out: CSSProperties = { ...(base ?? {}) };
  if (anim.transform) {
    out.transform = base?.transform
      ? `${base.transform} ${anim.transform}`
      : anim.transform;
  }
  if (typeof anim.opacity === "number") {
    const baseOp =
      typeof base?.opacity === "number" ? base.opacity : undefined;
    out.opacity =
      baseOp !== undefined ? baseOp * anim.opacity : anim.opacity;
  }
  if (typeof anim.clipPath === "string") out.clipPath = anim.clipPath;
  return out;
}
