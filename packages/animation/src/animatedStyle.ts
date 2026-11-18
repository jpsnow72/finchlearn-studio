/**
 * Timeline → CSS bridge (Vyond-lite MVP).
 *
 * Converts sampled animation values (from @finch-studio/core `sampleTimeline`) into
 * React inline styles. `x`/`y` are offsets applied via CSS transform on top
 * of the authored position, so animations compose with layout instead of
 * fighting it. `opacity` rides alongside any existing opacity.
 */
import type { CSSProperties } from "react";
import { sampleTimeline, type SampledValues } from "@finch-studio/core";

/**
 * Sample an object's timeline at `tMs` and return the inline style delta.
 * Returns an empty object when there is nothing to animate (cheap no-op).
 */
export function timelineStyleFor(
  timeline: Parameters<typeof sampleTimeline>[0],
  tMs: number,
): CSSProperties {
  const v: SampledValues = sampleTimeline(timeline, tMs);
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
  return style;
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
  if (!anim.transform && anim.opacity === undefined) return base;
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
  return out;
}
