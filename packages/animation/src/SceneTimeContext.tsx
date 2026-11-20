/**
 * Scene-time React context (Vyond-lite MVP).
 *
 * PlayerPage provides the current animation clock time; leaf object wrappers
 * consume it via `useAnimatedObjectStyle` to merge engine-generated preset
 * and timeline deltas into their inline styles. `null` (default) disables
 * animation — existing render paths are untouched.
 */
import { createContext, useContext, type CSSProperties, type ReactNode } from "react";
import type { CourseObject } from "@finch-studio/core";
import { mergeAnimatedStyle } from "./animatedStyle.js";
import { timelineStyleFor } from "./animatedStyle.js";
import { effectiveAnimationsForObject } from "./motionGraphics.js";

/** Current scene time in ms, or null when timeline animation is off. */
export const SceneTimeContext = createContext<number | null>(null);

/**
 * Compute the animation style delta for one object at the current scene
 * time, merged over `base`. Returns `base` unchanged when animation is off
 * or the object has no effects or timeline tracks.
 *
 * Must be called unconditionally at the top of a component (before any
 * early returns) — it reads context.
 */
export function useAnimatedObjectStyle(
  object: CourseObject,
  base?: CSSProperties,
): CSSProperties | undefined {
  const tMs = useContext(SceneTimeContext);
  if (tMs === null) return base;
  const animations = effectiveAnimationsForObject(object);
  if (!animations?.presets?.length && !animations?.timeline?.length) return base;
  const delta = timelineStyleFor(animations, tMs);
  return mergeAnimatedStyle(base, delta);
}

/**
 * Render-prop version for spots where hooks can't be called (e.g. inside a
 * `.map()` callback). Renders `children` with the merged animation style.
 */
export function WithObjectAnimation({
  object,
  base,
  children,
}: {
  object: CourseObject;
  base?: CSSProperties;
  children: (style: CSSProperties | undefined) => ReactNode;
}): ReactNode {
  const tMs = useContext(SceneTimeContext);
  if (tMs === null) return children(base);
  const animations = effectiveAnimationsForObject(object);
  if (!animations?.presets?.length && !animations?.timeline?.length) return children(base);
  return children(mergeAnimatedStyle(base, timelineStyleFor(animations, tMs)));
}
