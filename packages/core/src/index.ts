/**
 * @finch-studio/core: OCF type and animation foundation for FinchLearn Studio.
 * Extracted from @ocf/core (open-course-format) on 2026-11-18: types.ts and
 * animations.ts are verbatim copies; see EXTRACTION.md. Pure TypeScript, no
 * React, no DOM.
 */
export * from "./types.js";
export {
  EASINGS,
  EASING_NAMES,
  ANIMATABLE_PROPERTIES,
  ANIMATION_PRESETS,
  CHARACTER_ANIMATIONS,
  CHARACTER_IDS,
  DEFAULT_TRACK_DURATION_MS,
  DEFAULT_SCENE_DURATION_MS,
  facingFromAngle,
  pathEndMs,
  samplePath,
  sampleTrack,
  sampleTimeline,
  sampleAnimations,
  hasTimeline,
  timelineEndMs,
  expandAnimationPreset,
  sceneDurationMs,
} from "./animations.js";
export type { SampledValues, PresetOptions, PathSample } from "./animations.js";
