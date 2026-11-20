/**
 * @finch-studio/animation: FinchLearn Studio animation machinery.
 *
 * Extracted from @ocf/animation-studio (open-course-format) on 2026-11-18.
 * What moved: scene time React infra (SceneTimeContext, useSceneClock,
 * animatedStyle), the TTS provider interface plus browser provider (tts.ts),
 * dialogue scheduling (dialogue.ts), the multi-scene video project model and
 * timing (videoProject.ts), and the embeddable VideoScenePlayer.
 *
 * What did NOT move: the SVG character art and CharacterRenderer. The existing
 * FinchLearn characters stay in FinchLearn for existing courses only (Justin,
 * Nov 18, 2026: new characters are a design-first workstream). CharacterFigure
 * below is the seam the new rigged character system plugs into once the
 * character design package is approved.
 */
export {
  SceneTimeContext,
  useAnimatedObjectStyle,
  WithObjectAnimation,
} from "./SceneTimeContext.js";
export {
  sampledToStyle,
  timelineStyleFor,
  mergeAnimatedStyle,
  baselineRevealClipPath,
  blockRevealOverlayStyle,
} from "./animatedStyle.js";
export { useSceneClock, type SceneClock } from "./useSceneClock.js";
export {
  BrowserTtsProvider,
  browserTts,
  type TtsProvider,
  type TtsVoice,
  type SpeakOptions,
} from "./tts.js";
export {
  DialoguePlayer,
  type DialogueLine,
  type DialoguePlayerOptions,
} from "./dialogue.js";
export {
  newVideoId,
  makeVideoScene,
  makeVideoProject,
  sceneContentDurationMs,
  DEFAULT_SCENE_DURATION_MS,
  PROJECT_ASPECTS,
  DEFAULT_PROJECT_ASPECT,
  STAGE_DIMENSIONS,
  isProjectAspect,
  projectAspect,
  withProjectAspect,
  stageDimensionsForAspect,
  stageDimensions,
  objectOutsideFrame,
  reframeProjectForAspect,
  projectTimeline,
  projectDurationMs,
  sceneAt,
  transitionAlpha,
  allSceneObjectIds,
  validateVideoProject,
  type SceneTiming,
} from "./videoProject.js";
export {
  MOTION_EXTENSION_KEY,
  DEFAULT_MOTION_COLORS,
  motionGraphicColorsFromTheme,
  getMotionMeta,
  withMotionMeta,
  withoutMotionMeta,
  isMotionGraphicMeta,
  motionGraphicGroupOf,
  buildMotionGraphic,
  buildTitleCard,
  buildLowerThird,
  buildCallout,
  rebuildMotionGraphic,
  kenBurnsTracks,
  sampleKenBurns,
  applyKenBurns,
  clearKenBurns,
  effectiveAnimationsForObject,
  splitKineticUnits,
  expandKineticReveal,
  kineticUnitsAt,
  kineticVisibleText,
  applyKineticText,
  clearKineticText,
  isKineticPresetName,
  kineticRevealForObject,
  type MotionGraphicColors,
  type MotionGraphicParams,
  type MotionGraphicKind,
  type MotionGraphicRole,
  type MotionGraphicMeta,
  type KenBurnsMeta,
  type KenBurnsFraming,
  type KineticTextMeta,
  type KineticPresetName,
  type KineticWordTiming,
  type KineticRevealUnit,
  type KineticRevealOptions,
  type MotionMeta,
  type MotionGraphicIdFactory,
} from "./motionGraphics.js";
export { VideoScenePlayer, type VideoScenePlayerProps } from "./VideoScenePlayer.js";
export { CharacterFigure, type CharacterFigureProps } from "./CharacterFigure.js";
