/**
 * Open Course Format (OCF) v0.1.0 — TypeScript types for @ocf/core.
 *
 * These types mirror `open-course-format.schema.json` (draft 2020-12), which is
 * the normative artifact per SPEC §17. Where SPEC.md's prose examples differ from
 * the schema (e.g. composite payload keys in §7.3), the SCHEMA wins — see the
 * JSDoc notes on the affected fields.
 */

export type SpecVersion = `${number}.${number}.${number}`;

/** Namespaced tool-specific extras, e.g. { "x-articulate": {...} }. */
export type Extensions = Record<string, Record<string, unknown>>;

/**
 * One structured import-report entry, produced by an importer at conversion
 * time and stored at `course.extensions.importReport.entries`. Course Health
 * renders each entry as an issue in the "Import" category.
 */
export interface ImportReportEntry {
  /** "warning" = fidelity loss or unresolved reference; "info" = neutral note. */
  severity: "info" | "warning";
  message: string;
  /** OCF page id the entry relates to (when the importer could determine it). */
  pageRef?: string;
  /** OCF object id the entry relates to (when the importer could determine it). */
  objectRef?: string;
  /** Source-tool block/interaction type, e.g. "interactive/process". */
  blockType?: string;
}

/** The full structured import report an importer returns alongside the course. */
export type ImportReport = ImportReportEntry[];



/** Sanitized HTML fragment — see SPEC §7.2 for the allowlist. */
export type RichText = string;

export type LayoutMode = "fixed" | "flow";

// ---------------------------------------------------------------------------
// Top-level document
// ---------------------------------------------------------------------------

export interface Course {
  format: "open-course-format";
  version: SpecVersion;
  meta: Meta;
  theme?: Theme;
  /** Course-level display settings (SPEC rev 11): content column width for flow pages. */
  display?: DisplaySettings;
  /**
   * Course-level player settings (SPEC rev 29): navigation mode,
   * completion rule, resume behavior, and progress chrome. Absent =
   * defaults (see `courseSettingsOf`): free navigation, revisiting
   * allowed, all-pages completion, ask-to-resume, progress shown.
   */
  settings?: CourseSettings;
  /** Background-audio track for the whole course (SPEC §5, rev 19). */
  backgroundAudio?: BackgroundAudio;
  /** Completion certificate template (SPEC §5.2, rev 20). */
  certificate?: CertificateTemplate;
  /** Certification expiry / recertification rules (SPEC §5.2, rev 20). */
  certification?: Certification;
  /** Gamification layer: points, badges, streaks, leaderboards, scenario scoring (SPEC §5.3, rev 21). */
  gamification?: Gamification;
  variables?: Variable[];
  resources?: Resource[];
  glossary?: GlossaryEntry[];
  /** Per-course spelling whitelist (Phase 12D); travels with the .ocf file. */
  dictionary?: string[];
  /** Learning objectives (Phase 12E); linked from sections/pages/questions. */
  objectives?: Objective[];
  outline: Section[];
  assessments?: Assessment[];
  publish?: Publish;
  /** Design-system governance (SPEC §14, rev 26): brand locks, asset policy, publish gates, roles. */
  governance?: Governance;
  extensions?: Extensions;
}

/**
 * Enterprise design-system governance (SPEC §14, rev 26).
 *
 * Carries the brand-compliance policy for a course. The editor enforces
 * these: locked theme paths disable their controls, `approved-only` asset
 * policy restricts the media library, and `publishGate` blocks export until
 * approved. All fields are optional; absent governance = no restrictions.
 */
export interface Governance {
  /** Brand kit id this course is governed by (references a BrandKit). */
  brandKitId?: string;
  /**
   * Asset policy: `"open"` (default) lets authors upload anything;
   * `"approved-only"` restricts the media library to `approvedAssets`.
   */
  assetPolicy?: "open" | "approved-only";
  /**
   * Resource IDs from the approved asset library. Only meaningful when
   * `assetPolicy` is `"approved-only"`.
   */
  approvedAssets?: string[];
  /** Publish approval gate for multi-team orgs. */
  publishGate?: {
    /** When true, export/publish requires approval before proceeding. */
    required?: boolean;
    /** User id who approved (set by the approver). */
    approvedBy?: string;
    /** ISO datetime of approval. */
    approvedAt?: string;
    /** User id who requested approval. */
    requestedBy?: string;
    /** ISO datetime of the request. */
    requestedAt?: string;
  };
  /**
   * Per-user roles for this course (user id → role). `admin` can change
   * governance + locked theme paths; `author` edits within policy;
   * `reviewer` is read-only + comments.
   */
  roles?: Record<string, "admin" | "author" | "reviewer">;
}

/**
 * An enterprise brand kit (SPEC §14, rev 26): a named theme with locked
 * paths plus an approved asset library. Lives in the enterprise library
 * (tool-managed, not per-course); courses reference it via
 * `governance.brandKitId`.
 */
export interface BrandKit {
  id: string;
  name: string;
  description?: string;
  /** The brand theme; `locked` lists the paths authors cannot change. */
  theme: Theme;
  /**
   * Approved assets (images, logos) authors may use.
   *
   * BK-1 recorded identity only (`id`/`name`/`kind`). BK-2 adds the
   * optional binary payload: `src` carries the asset's bytes as a data
   * URL, so a kit file is self-contained and applying the kit can copy
   * the asset into a course's `resources` as a real entry. Entries
   * without `src` stay valid — they are approved-by-id declarations
   * whose bytes live elsewhere (the BK-1 shape).
   */
  approvedAssets?: {
    id: string;
    name: string;
    kind: string;
    /** The asset's bytes as a data URL (BK-2). Absent = metadata-only. */
    src?: string;
    /** MIME type of the bytes in `src`, when known. */
    mime?: string;
    /** Byte size of the asset, when known. */
    size?: number;
  }[];
  /** When true, brand health check requires a logo on the course theme. */
  requireLogo?: boolean;
  /**
   * Insert policy this kit imposes on courses it is applied to
   * (BK-2 activation fix): `"approved-only"` makes applying the kit
   * write `governance.assetPolicy: "approved-only"` into the course,
   * which restricts media-library inserts to the kit's approved
   * assets. Absent = `"open"` — the kit does not restrict inserts.
   * Additive and optional: BK-1/BK-2 kits without it behave exactly
   * as they did before the field existed.
   */
  insertPolicy?: "open" | "approved-only";
}

/**
 * A learning objective (Phase 12E, SPEC §5). Sections link objectives to
 * groups of pages via `objectiveIds`; pages and questions can override.
 */
export interface Objective {
  id: string;
  /** The objective statement, e.g. "The learner will identify…". */
  title: string;
  description?: string;
}

export interface Author {
  name: string;
}

export interface Meta {
  id: string;
  title: string;
  description?: string;
  /** BCP-47 language tag, e.g. "en". */
  language?: string;
  authors?: Author[];
  created?: string;
  modified?: string;
  sourceTool?: { name?: string; version?: string };
  tags?: string[];
}

export interface GlossaryEntry {
  term: string;
  definition?: string;
}

// ---------------------------------------------------------------------------
// Outline: sections → pages → layers → objects
// ---------------------------------------------------------------------------

export interface Section {
  id: string;
  title?: string;
  layout?: LayoutMode;
  pages: Page[];
  /** Linked learning-objective ids (Phase 12E) — the group-of-pages linkage. */
  objectiveIds?: string[];
  /** Nearest-override-wins theme. */
  theme?: Theme;
  /** Background-audio track for this section; overrides the course-level track (SPEC §5, rev 19). */
  backgroundAudio?: BackgroundAudio;
  extensions?: Extensions;
}

export interface Page {
  id: string;
  title?: string;
  layout?: LayoutMode;
  /** Fixed-layout canvas size, px. */
  size?: { w?: number; h?: number };
  notes?: string;
  /**
   * Scenario (decision-quality) points added to the learner's scenario score
   * on first entry to this page per attempt (SPEC §5.3, rev 21). Separate
   * from game/assessment points; reported alongside the main score on results.
   */
  scenarioPoints?: number;
  layers: Layer[];
  triggers?: Trigger[];
  /** Linked learning-objective ids (Phase 12E); overrides the section's. */
  objectiveIds?: string[];
  theme?: Theme;
  /**
   * Scene duration in milliseconds for timeline animation and video export
   * (SPEC §7.7, rev 24). Defaults to 5000 when animations exist but no
   * duration is set; ignored when the page has no timeline tracks.
   */
  durationMs?: number;
  extensions?: Extensions;
}

export interface Layer {
  id: string;
  name?: string;
  visible?: boolean;
  objects: CourseObject[];
  extensions?: Extensions;
}

// ---------------------------------------------------------------------------
// Objects
// ---------------------------------------------------------------------------

export type ObjectType =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "shape"
  | "button"
  | "hotspot"
  | "webview"
  | "question"
  | "group"
  | "popup"
  | "accordion"
  | "tabs"
  | "timeline"
  | "slideshow"
  | "flipcards"
  | "image-compare"
  | "interactive-video"
  | "chart"
  | "collage"
  | "simulation"
  | "slider"
  | "dial"
  | "character"
  | "video-scene"
  | "lottie";

export type Color = string; // #rgb or #rrggbb — validated by schema pattern

export interface Position {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  unit?: "px" | "%";
}

export interface Timing {
  /** Seconds on the page timeline. */
  start?: number;
  duration?: number;
}

/**
 * Named cue point on a media object's timeline (SPEC §9, rev 16).
 * Declared on video/audio/interactive-video objects; the player fires a
 * `cue-point` trigger event when playback crosses `at`. Rev 23 adds an
 * optional interactive-video `action` (branching, in-video questions,
 * timeline hotspots) — see `CueAction`.
 */
export interface CuePoint {
  id: string;
  name?: string;
  /** Seconds into the media. */
  at: number;
  /** R8: built-in action the player runs when playback crosses this cue. */
  action?: CueAction;
}

/**
 * R8 — interactive-video cue action (SPEC §9, rev 23). The `cue-point`
 * trigger event still fires; the action is the built-in behavior on top:
 * - `branch`: pause and present 2–4 choice buttons (each choice jumps to a
 *   timestamp in the same video, switches to another video, or navigates
 *   to a page).
 * - `question`: pause and show an embedded question checkpoint; resume is
 *   gated by the author's `requireCorrect` setting.
 * - `hotspot`: clickable regions over the video for a time window; no
 *   pause. Clicking a region jumps, opens a popup, or fires a
 *   `hotspot-click` trigger event on the media object.
 */
export type CueAction = CueBranchAction | CueQuestionAction | CueHotspotAction;

export interface CueBranchAction {
  kind: "branch";
  /** Choice buttons presented while the video is paused. */
  choices: BranchChoice[];
}

export interface BranchChoice {
  id: string;
  label: string;
  /** Seek target, seconds, in the same video. */
  jumpTo?: number;
  /** …or switch playback to another course video resource id. */
  video?: string;
  /** …or navigate to another page id. */
  page?: string;
}

export interface CueQuestionAction {
  kind: "question";
  /** Embedded question (choice / true-false to start). */
  question: QuestionObject;
  /**
   * When true, the learner must answer correctly to resume (unlimited
   * retries); otherwise any submitted answer resumes.
   */
  requireCorrect?: boolean;
}

export interface CueHotspotAction {
  kind: "hotspot";
  /**
   * Hotspots stay live until this media time (seconds); defaults to the
   * cue's `at` + 10.
   */
  until?: number;
  regions: HotspotRegion[];
}

export interface HotspotRegion {
  id: string;
  label?: string;
  /** Rect as fractions of the video surface (0–1). */
  x: number;
  y: number;
  w: number;
  h: number;
  action: HotspotClickAction;
}

/** What clicking a video-timeline hotspot does. */
export type HotspotClickAction =
  | { kind: "jump"; at: number }
  | { kind: "popup"; popupId: string }
  /** Fire a `hotspot-click` trigger event on the media object. */
  | { kind: "event" };

/**
 * Entrance animation vocabulary (SPEC §7, rev 19). Played when the page is
 * entered. `none`/unset = no animation.
 */
export type EntranceAnimation =
  | "none"
  | "fade"
  | "fly-in-left"
  | "fly-in-right"
  | "fly-in-top"
  | "fly-in-bottom"
  | "zoom";

/**
 * Exit animation vocabulary (SPEC §7, rev 19). When the learner navigates
 * back to a previously-viewed page, players play the exit animation when
 * set, otherwise the reversed entrance.
 */
export type ExitAnimation =
  | "none"
  | "fade"
  | "fly-out-left"
  | "fly-out-right"
  | "fly-out-top"
  | "fly-out-bottom"
  | "zoom-out";

export interface Animations {
  entrance?: EntranceAnimation;
  exit?: ExitAnimation;
  /** One-click effects expanded by the timeline animation engine. */
  presets?: AnimationPreset[];
  /**
   * Keyframe-lite timeline tracks (SPEC §7.7, rev 24). Each track animates
   * one property over a time window. `x`/`y` are pixel *offsets* applied on
   * top of the authored position (via CSS transform); `scale` is a
   * multiplier (1 = resting); `rotation` is degrees; `opacity` is 0–1.
   * Sampling semantics: t < start → `from`; start ≤ t ≤ start+duration →
   * eased interpolation; t > start+duration → `to`. When tracks overlap on
   * the same property, the later track in the array wins.
   */
  timeline?: AnimationTrack[];
}

/**
 * Properties animatable on the timeline (SPEC §7.7, rev 24).
 */
export type AnimatableProperty =
  | "x"
  | "y"
  | "opacity"
  | "scale"
  | "rotation"
  | "wipeLeft"
  | "wipeRight"
  | "wipeUp"
  | "wipeDown";

/**
 * Easing functions for timeline tracks (SPEC §7.7, rev 24).
 */
export type EasingName =
  | "linear"
  | "easeIn"
  | "easeOut"
  | "easeInOut"
  | "bounce"
  | "pulse"
  | "shake";

/**
 * One keyframe-lite animation track on an object (SPEC §7.7, rev 24).
 * Times are milliseconds from the scene (page) start.
 */
export interface AnimationTrack {
  property: AnimatableProperty;
  from: number;
  to: number;
  /** Start time in ms from scene start. Defaults to 0. */
  start?: number;
  /** Duration in ms. Defaults to 600. */
  duration?: number;
  /** Easing. Defaults to "easeOut". */
  easing?: EasingName;
}

/**
 * Preset animation names for the one-click picker (SPEC §7.7, rev 24).
 * Each expands to one or more timeline tracks via `expandAnimationPreset`.
 */
export type AnimationPresetName =
  | "fadeIn"
  | "fadeOut"
  | "slideInLeft"
  | "slideInRight"
  | "slideInUp"
  | "slideInDown"
  | "zoomIn"
  | "bounce"
  | "slideOutLeft"
  | "slideOutRight"
  | "slideOutUp"
  | "slideOutDown"
  | "popIn"
  | "popOut"
  | "zoomOut"
  | "wipeInLeft"
  | "wipeInRight"
  | "wipeInUp"
  | "wipeInDown"
  | "wipeOutLeft"
  | "wipeOutRight"
  | "wipeOutUp"
  | "wipeOutDown"
  | "emphasisPulse"
  | "emphasisShake"
  | "emphasisSpin"
  | "kenBurns"
  | "chartStingGrow"
  | "chartStingSweep"
  | "typewriterReveal"
  | "wordReveal"
  | "lineReveal"
  | "float"
  | "baselineReveal"
  | "blockReveal";

/** A named engine preset with its authored delay and duration. */
export interface AnimationPreset {
  name: AnimationPresetName;
  /** Delay in ms from the scene start. */
  start?: number;
  /** Duration in ms. Defaults to 600. */
  duration?: number;
}

// ---------------------------------------------------------------------------
// Animated characters (SPEC §7.8, rev 25)
// ---------------------------------------------------------------------------

/**
 * Built-in character designs for Vyond-style animated videos (SPEC §7.8,
 * rev 25). Characters are flat-vector SVG composed of named parts
 * (head, torso, arms, legs) so limbs can be animated with CSS keyframes.
 */
export type CharacterId =
  | "businessman"
  | "businesswoman"
  | "casualMan"
  | "casualWoman"
  | "student"
  | "professor";

/**
 * Named character animations (SPEC §7.8, rev 25). Each maps to CSS keyframes
 * on the character's SVG parts:
 * - `idle`: subtle breathing/sway loop
 * - `walk`: leg/arm swing cycle, loops (auto-plays while moving on a path)
 * - `talk`: mouth open/close + head bob loop
 * - `wave`: one-shot right-arm wave
 * - `point`: right arm extends (holds)
 * - `nod`: one-shot head nod
 * - `shake`: one-shot head shake
 * - `sit`: seated pose (holds)
 * - `stand`: standing pose (default resting)
 */
export type CharacterAnimationName =
  | "idle"
  | "walk"
  | "talk"
  | "wave"
  | "point"
  | "nod"
  | "shake"
  | "sit"
  | "stand"
  // Motion library expansion (Studio issues #94 and #96): names resolve to
  // the rigged actions of the same name in @finch-studio/characters.
  | "run"
  | "clap"
  | "shrug"
  | "thumbs-up"
  | "celebrate"
  | "laugh"
  | "bow"
  | "look-around"
  // Two character interaction roles (issues #94 and #96): pair-applied
  // through planInteraction in @finch-studio/characters, never offered in
  // the single character picker; the names resolve to the rigged role
  // actions of the same name.
  | "handshake-right"
  | "handshake-left"
  | "high-five-right"
  | "high-five-left";

/** Which way the character faces. Auto-set from path direction while moving. */
export type CharacterFacing = "left" | "right";

/** Customizable character colors (SPEC §7.8, rev 25). */
export interface CharacterColors {
  skin?: string;
  hair?: string;
  shirt?: string;
  pants?: string;
}

/**
 * One movement waypoint (SPEC §7.8, rev 25). `x`/`y` are pixel offsets from
 * the object's authored position; `t` is ms from scene start. The character
 * interpolates linearly between waypoints. Walk animation auto-plays while
 * moving; facing auto-follows movement direction.
 *
 * `curve`: `"smooth"` renders a Catmull-Rom spline through this waypoint
 * (and its neighbors) instead of a straight segment — for curved paths.
 * `speed`: optional per-segment speed multiplier applied to the segment
 * STARTING at this waypoint (1 = normal). Speed scales how fast the
 * character traverses the segment; walk-cycle rate syncs to actual speed.
 */
export interface CharacterWaypoint {
  x: number;
  y: number;
  /** Ms from scene start. */
  t: number;
  curve?: "linear" | "smooth";
  speed?: number;
}

/**
 * One speech-bubble line (SPEC §7.8, rev 25). The bubble renders above the
 * character while `start <= t < start + duration`.
 */
export interface CharacterSpeech {
  id: string;
  text: string;
  /** Ms from scene start. */
  start: number;
  /** Ms the bubble stays visible. */
  duration: number;
}

/**
 * Animated character object (SPEC §7.8, rev 25). Renders an SVG character
 * with limb animations, optional path movement, and speech bubbles.
 */
export interface CharacterObject extends ObjectBase {
  type: "character";
  characterId: CharacterId;
  /** Active limb animation. Defaults to "idle". */
  characterAnimation?: CharacterAnimationName;
  /** Facing direction. Defaults to "right"; auto-set while moving on a path. */
  facing?: CharacterFacing;
  colors?: CharacterColors;
  /** Movement waypoints (times in ms from scene start). */
  path?: CharacterWaypoint[];
  /** Dialogue bubbles. */
  speech?: CharacterSpeech[];
}

// ---------------------------------------------------------------------------
// Video scenes / projects (SPEC §7.9, rev 25)
// ---------------------------------------------------------------------------

/** Scene transition between video scenes. */
export type VideoSceneTransition = "cut" | "fade" | "slide" | "wipe" | "zoom" | "push";

/**
 * One scene in a video project (SPEC §7.9, rev 25). A scene is a self-
 * contained animated tableau: its own objects, duration, and background.
 * In the standalone video studio, scenes hold inline objects; when a
 * `video-scene` object is embedded in a course, each scene plays in the
 * course player.
 */
export interface VideoScene {
  id: string;
  name: string;
  /** Scene length in ms. */
  durationMs: number;
  /** Transition INTO this scene from the previous. Defaults to "cut". */
  transition?: VideoSceneTransition;
  /** Transition duration in ms. Defaults to 400. */
  transitionMs?: number;
  /** Scene-level effects use the same timeline engine as object effects. */
  animations?: Animations;
  background?: string;
  /** Namespaced scene metadata, same pattern as ObjectBase extensions. */
  extensions?: Extensions;
  objects: CourseObject[];
}

/** Stage aspect ratios a Studio project can be framed for (issue #13). */
export type ProjectAspect = "16:9" | "9:16" | "1:1";

/**
 * A multi-scene video project (SPEC §7.9, rev 25).
 */
export interface VideoProject {
  id: string;
  name: string;
  scenes: VideoScene[];
  /**
   * Tool-specific project metadata in the established extension style
   * (additive, optional; absent = a plain project). Translation
   * variants (Studio issue #54) record their source linkage under
   * extensions["x-finch-studio"].
   */
  extensions?: Extensions;
  /**
   * Stage aspect for the whole project (issue #13). Additive and
   * backward compatible: absent means "16:9", exactly as projects
   * framed before the aspect switcher behaved.
   */
  aspect?: ProjectAspect;
}

/**
 * Embedded video project object (SPEC §7.9, rev 25). Drops a multi-scene
 * animated video into a course page. "Edit in Video Studio" opens the
 * standalone studio with the project; the result embeds back here.
 */
export interface VideoSceneObject extends ObjectBase {
  type: "video-scene";
  videoProject: VideoProject;
}

/**
 * Lottie animated object (Studio issues #97, #99, #100). A first class
 * stage object: it moves, scales, rotates, and times like any other
 * object through the shared ObjectBase position, timing, and timeline
 * animation fields. Playback is deterministic: the shared renderer
 * samples the Lottie timeline from the scene clock, never wall clock.
 *
 * Source, exactly one of:
 * - `packId`: an entry in the built in Generative Icons pack; the
 *   animation data resolves from the bundled asset at render time.
 * - `resource`: a URL or data URI for a .json or .lottie file.
 * - `animationData`: the parsed Lottie animation JSON carried inline,
 *   which is how user imports stay self contained in the project file.
 */
export interface LottieObject extends ObjectBase {
  type: "lottie";
  resource?: string;
  packId?: string;
  /** Parsed Lottie animation JSON (a plain object with fr, ip, op, layers). */
  animationData?: Record<string, unknown>;
  /**
   * Recolor overrides keyed by the animation's shared color slot id
   * (for the bundled pack: "color.primary"), or by "paint:#rrggbb" for
   * imported files whose paints carry no slot id. Values are hex colors.
   */
  colors?: Record<string, string>;
  /** Loop the animation while the object is on stage. Defaults to true. */
  loop?: boolean;
  /** Playback rate multiplier. Defaults to 1. */
  speed?: number;
}


/**
 * PowerPoint-style text wrap around a text object (SPEC §7, rev 19).
 * `none` (default) = no wrapping; `square` = content flows around the
 * bounding box; `tight` = content hugs the box (for rectangular objects
 * this is square with a smaller margin — true contour wrapping around
 * non-rectangular shapes is a future enhancement).
 */
export type TextWrap = "none" | "square" | "tight";

/**
 * A background-audio track scoped to a course or a section (SPEC §5, rev
 * 19). Section-level tracks override the course-level track for pages in
 * that section. `startPage`/`endPage` are page ids bounding the range in
 * document order (inclusive); unset = the whole scope.
 */
export interface BackgroundAudio {
  /** Resource id or URL of the audio file. */
  resource: string;
  /** Repeat the track. Defaults to true when omitted. */
  loop?: boolean;
  /** Playback volume 0–1. Defaults to 1. */
  volume?: number;
  /** Page id where the track starts. Unset = first page of the scope. */
  startPage?: string;
  /** Page id where the track stops (inclusive). Unset = last page of the scope. */
  endPage?: string;
}

/** Certificate visual layout (SPEC §5.2, rev 20). */
export type CertificateLayout = "classic" | "modern" | "minimal";

/** Toggle for each renderable certificate field; each defaults to true. */
export interface CertificateFields {
  learnerName?: boolean;
  courseTitle?: boolean;
  completionDate?: boolean;
  certificateId?: boolean;
  issuer?: boolean;
  signature?: boolean;
}

/**
 * Course completion certificate template (SPEC §5.2, rev 20). `title` and
 * `body` support `{{learnerName}}`, `{{courseTitle}}`, `{{completionDate}}`,
 * `{{certificateId}}`, `{{issuer}}` placeholders, substituted by the player
 * at completion time. Missing data substitutes to an empty string.
 */
export interface CertificateTemplate {
  layout?: CertificateLayout;
  /** Hex background color. Defaults to "#ffffff". */
  background?: string;
  /** Resource id of the logo image shown on the certificate. */
  logoResourceId?: string;
  title?: string;
  body?: string;
  /** Issuing organization name. */
  issuer?: string;
  /** Name printed on the signature line. */
  signatureName?: string;
  fields?: CertificateFields;
}

/**
 * Certification expiry / recertification rules (SPEC §5.2, rev 20).
 * Completion records store `completedAt` + `expiresAt`; players show a
 * recertification nudge inside the `expiryReminderDays` window before expiry.
 */
export interface Certification {
  /** Master switch for expiry/recertification on this course. */
  enabled?: boolean;
  /** How many calendar months a completion stays valid. */
  validForMonths: number;
  /** Days before expiry the player starts the recertification nudge. 0 disables. */
  expiryReminderDays?: number;
}

/** Built-in badge icon set (SPEC §5.3, rev 21). */
export type BadgeIcon =
  | "star"
  | "trophy"
  | "medal"
  | "flame"
  | "target"
  | "crown"
  | "ribbon"
  | "gem";

/**
 * Badge earn rule (SPEC §5.3, rev 21). A template — deliberately not an
 * expression language. Players evaluate these against live game state:
 * - `score`: earn when the game score reaches `points`.
 * - `section`: earn when the learner completes `sectionId` (visits all its pages).
 * - `streak`: earn when the best streak reaches `count` consecutive correct answers.
 */
export type BadgeRule =
  | { kind: "score"; points: number }
  | { kind: "section"; sectionId: string }
  | { kind: "streak"; count: number };

/** An author-defined badge (SPEC §5.3, rev 21). */
export interface Badge {
  id: string;
  /** Badge display name. */
  name: string;
  /** What the badge is for (shown on the Achievements view). */
  description?: string;
  /** Icon from the built-in set. Defaults to "star". */
  icon?: BadgeIcon;
  /** Earn rule — a template, not an expression. */
  rule: BadgeRule;
}

/**
 * Course-level gamification layer (SPEC §5.3, rev 21): native points,
 * badges, streaks, scenario scoring, and leaderboards — no hand-built
 * variable hacks. Opt-in via `enabled`.
 */
export interface Gamification {
  /** Master switch. Defaults to false. */
  enabled?: boolean;
  /**
   * Streak bonus: award `points` every time the consecutive-correct streak
   * hits a multiple of `every`. Omitted = no streak bonus.
   */
  streakBonus?: { every: number; points: number };
  /** Author-defined badges, evaluated by rule templates in the player. */
  badges?: Badge[];
  /**
   * Leaderboard mode. Defaults to "off". "personal" keeps personal bests
   * across attempts (stored with completion records); "class" aggregates a
   * class leaderboard from the LRS via xAPI when an endpoint is configured
   * (honest empty state otherwise).
   */
  leaderboard?: "off" | "personal" | "class";
}

/** Row rendering for a group on flow-layout pages (SPEC §6.1). */
export interface RowSpec {
  /** Grid gap in px — always applied. */
  gap?: number;
  /** Cross-axis alignment of cells. */
  align?: "start" | "center" | "end" | "stretch";
}

/** Per-breakpoint width overrides, in grid ticks (SPEC §6.1). */
export interface SpanBreakpoints {
  /** Applies at >= 640px. */
  tablet?: number;
  /** Applies at >= 1024px. */
  desktop?: number;
}

export interface ObjectBase {
  id: string;
  type: ObjectType;
  name?: string;
  visible?: boolean;
  locked?: boolean;
  /** Accessibility text — required for meaningful images. */
  alt?: string;
  position?: Position;
  timing?: Timing;
  animations?: Animations;
  /** Grid ticks (of 12) spanned as a direct child of a row group on flow pages. */
  span?: number;
  /** Width overrides at wider viewports; unset inherits `span`. */
  spanBreakpoints?: SpanBreakpoints;
  /** State name → property overrides (SPEC §7.4, rev 14). */
  states?: Record<string, ObjectStateOverride>;
  triggers?: Trigger[];
  extensions?: Extensions;
}

/**
 * Per-state visual property overrides (SPEC §7.4, rev 14).
 *
 * Only presentation properties may be overridden. The engine merges an
 * override over the base object with `resolveObjectState()` (deep merge for
 * plain objects, arrays replaced). Protected keys — `id`, `type`, `states`,
 * `triggers`, `timing`, `position` — are rejected by the schema and skipped
 * by the merge even if present, so an override can never corrupt the base
 * object's identity, behavior, or layout (position/size are shared across
 * states, Storyline-style).
 */
export interface ObjectStateOverride {
  visible?: boolean;
  alt?: string;
  /** `text` objects: rich-text content shown in this state. */
  content?: RichText;
  /** `button` objects: label shown in this state. */
  label?: RichText;
  /** `image` / `video` / `audio` objects: media source used in this state. */
  resource?: string;
  /** `video` objects: poster image used in this state. */
  poster?: string;
  /** `shape` objects: fill used in this state. */
  fill?: Color;
  /** `shape` objects: stroke used in this state (deep-merged with the base stroke). */
  stroke?: { color?: Color; width?: number };
}

// --- primitives ---

export interface TextObject extends ObjectBase {
  type: "text";
  content: RichText;
  /** PowerPoint-style text wrap around this object (SPEC §7, rev 19). */
  wrap?: TextWrap;
}

export interface ImageObject extends ObjectBase {
  type: "image";
  resource?: string;
  fit?: "contain" | "cover" | "fill";
  /**
   * Numbered marker pins on the image (SPEC §7.1, rev 18). A deliberate
   * data-model choice: markers live ON the image object rather than as a
   * dedicated type, because a marker is meaningless without its base image
   * (anchored to it by fractions of the image size).
   */
  markers?: Marker[];
}

/**
 * One numbered marker pin on an image (SPEC §7.1, rev 18). `x`/`y` are
 * fractions (0–1) of the image's rendered size; readers show `title` +
 * `description` (sanitized HTML) when the learner activates the pin.
 */
export interface Marker {
  id: string;
  x: number;
  y: number;
  title: string;
  description?: RichText;
}

export interface AudioObject extends ObjectBase {
  type: "audio";
  resource?: string;
  autoplay?: boolean;
  loop?: boolean;
  volume?: number;
  /** Named cue points on the audio timeline (SPEC §9, rev 16). */
  cuePoints?: CuePoint[];
}

export interface VideoObject extends ObjectBase {
  type: "video";
  resource?: string;
  autoplay?: boolean;
  controls?: boolean;
  poster?: string;
  /** Named cue points on the video timeline (SPEC §9, rev 16). */
  cuePoints?: CuePoint[];
  /**
   * Caption tracks stored on the object itself (same `ResourceCaption`
   * shape and data-VTT authored-track encoding as `Resource.captions`).
   * Used when `resource` is a plain URL with no library resource entry to
   * carry the tracks; resource-backed videos keep captions on the resource.
   * Players render the union of resource and object tracks.
   */
  captions?: ResourceCaption[];
}

export interface ShapeObject extends ObjectBase {
  type: "shape";
  shape?: "rect" | "ellipse" | "line" | "polygon";
  fill?: Color;
  stroke?: { color?: Color; width?: number };
}

export interface ButtonObject extends ObjectBase {
  type: "button";
  label?: RichText;
  style?: string;
}

export interface HotspotObject extends ObjectBase {
  type: "hotspot";
  // position-only; usually carries triggers
}

export interface WebviewObject extends ObjectBase {
  type: "webview";
  url?: string;
  html?: string;
}

export interface GroupObject extends ObjectBase {
  type: "group";
  objects: CourseObject[];
  /** Present: renders as a 12-column grid row on flow-layout pages. */
  row?: RowSpec;
}

/**
 * Modal dialog (SPEC §7.1, rev 12). Same nested-objects pattern as group —
 * `objects` is the dialog content. Hidden by default: readers never render
 * popups inline on the page; they appear only as modal dialogs while an
 * `open-popup` action has them open (closed by `close-popup`, ESC, the close
 * button, or a backdrop click).
 */
export interface PopupObject extends ObjectBase {
  type: "popup";
  /** Dialog title, rendered in the dialog header. */
  title?: string;
  /** Show a dimming backdrop behind the dialog. Defaults to true. */
  overlay?: boolean;
  /** Dialog content — recursive, like group children. */
  objects: CourseObject[];
}

// --- question (SPEC §10) ---

export type InteractionType =
  | "choice"
  | "true-false"
  | "fill-in"
  | "long-fill-in"
  | "matching"
  | "performance"
  | "sequencing"
  | "likert"
  | "numeric"
  | "other"
  | "dictation"
  | "audio-response"
  | "mark-words"
  | "memory"
  | "word-search"
  | "crossword";

export interface Choice {
  id: string;
  label?: RichText;
  image?: string;
  feedback?: RichText;
  /** Personality quizzes only. */
  profileScores?: Record<string, number>;
}

export interface Blank {
  id: string;
  answers: string[];
  /** Dropdown / word-bank options. */
  options?: string[];
}

export interface QuestionFeedback {
  correct?: RichText;
  incorrect?: RichText;
  tryAgain?: RichText;
}

export interface ScoringProfile {
  id: string;
  title: string;
  description?: RichText;
}

export interface Scoring {
  points?: number;
  attempts?: number;
  penalty?: number;
  mode?: "points" | "profile";
  /** Profile mode only. */
  profiles?: ScoringProfile[];
}

export interface QuestionObject extends ObjectBase {
  type: "question";
  interactionType: InteractionType;
  /** "single" | "multiple" — choice only. */
  choiceType?: "single" | "multiple";
  prompt: RichText;
  /** Resource id for prompt media. */
  media?: string;
  choices?: Choice[];
  /** xAPI-style correct-response patterns. */
  correctResponses?: string[];
  /** matching only */
  matching?: {
    source?: { id: string; label?: RichText }[];
    target?: { id: string; label?: RichText }[];
  };
  /** fill-in only */
  blanks?: Blank[];
  /** Drag-the-words source list. */
  wordBank?: string[];
  /** Hotspot questions (interactionType "other"). */
  hotspots?: { x: number; y: number; w: number; h: number; correct: boolean }[];
  /** Drag-and-drop questions. */
  dragDrop?: {
    draggables?: { id: string; label?: RichText }[];
    dropZones?: { id: string; label?: RichText; accepts?: string[] }[];
  };
  /** memory game pairs. */
  pairs?: { id: string; a?: RichText; b?: RichText }[];
  /** word-search grid words. */
  wordList?: string[];
  crosswordEntries?: { word: string; clue?: string }[];
  /** mark-the-words targets. */
  markTargets?: { word: string; correct: boolean }[];
  /** audio-response: max seconds. */
  maxDuration?: number;
  shuffleChoices?: boolean;
  feedback?: QuestionFeedback;
  scoring?: Scoring;
  graded?: boolean;
  /** Linked learning-objective ids (Phase 12E) — assessment alignment. */
  objectiveIds?: string[];
  /** Question-bank membership. */
  bank?: string;
}

// --- composites (SPEC §7.3) ---
//
// NOTE (spec/schema divergence): SPEC §7.3's prose examples use flat payload
// keys (events, slides, cards, before/after, video, chartType, images), but the
// normative schema prefixes them (timelineEvents, slideshow, flipCards,
// compare, interactiveVideo, chart, collage). The types below follow the
// SCHEMA. SPEC.md should be updated to match (rev 3 candidate).

export interface AccordionPanel {
  title: RichText;
  content: CourseObject[];
}

export interface AccordionObject extends ObjectBase {
  type: "accordion";
  panels?: AccordionPanel[];
}

export interface TabsTab {
  title: RichText;
  content: CourseObject[];
}

export interface TabsObject extends ObjectBase {
  type: "tabs";
  tabs?: TabsTab[];
}

export interface TimelineEvent {
  dateLabel?: string;
  title: RichText;
  body?: RichText;
  media?: string;
}

export interface TimelineObject extends ObjectBase {
  type: "timeline";
  /** Schema key is `timelineEvents`; spec §7.3 example calls it `events`. */
  timelineEvents?: TimelineEvent[];
}

export interface SlideshowSlide {
  resource: string;
  caption?: RichText;
}

export interface SlideshowObject extends ObjectBase {
  type: "slideshow";
  /** Schema key is `slideshow`; spec §7.3 example uses flat `slides`/`autoplay`/etc. */
  slideshow?: {
    slides?: SlideshowSlide[];
    autoplay?: boolean;
    loop?: boolean;
    transition?: string;
  };
}

export interface FlipCard {
  front: RichText;
  back: RichText;
  image?: string;
}

export interface FlipcardsObject extends ObjectBase {
  type: "flipcards";
  /** Schema key is `flipCards`; spec §7.3 example calls it `cards`. */
  flipCards?: FlipCard[];
}

export interface ImageCompareObject extends ObjectBase {
  type: "image-compare";
  /** Schema key is `compare`; spec §7.3 example uses flat `before`/`after`/etc. */
  compare?: {
    before: string;
    after: string;
    orientation?: "horizontal" | "vertical";
    startPosition?: number;
  };
}

export interface InteractiveVideoInteraction {
  /** Seconds into the video. */
  at: number;
  pause?: boolean;
  object: CourseObject;
}

export interface InteractiveVideoObject extends ObjectBase {
  type: "interactive-video";
  /** Schema key is `interactiveVideo`; spec §7.3 example uses flat `video`/`interactions`. */
  interactiveVideo?: {
    video: string;
    interactions?: InteractiveVideoInteraction[];
  };
  /** Named cue points on the video timeline (SPEC §9, rev 16). */
  cuePoints?: CuePoint[];
  /**
   * Caption tracks stored on the object itself — see `VideoObject.captions`.
   * Used when `interactiveVideo.video` is a plain URL with no library
   * resource entry to carry the tracks.
   */
  captions?: ResourceCaption[];
}

export interface ChartDataset {
  label?: string;
  values: number[];
}

export interface ChartObject extends ObjectBase {
  type: "chart";
  /** Schema key is `chart`; spec §7.3 example uses flat `chartType`/`labels`/`datasets`. */
  chart?: {
    chartType: "bar" | "line" | "pie";
    labels?: string[];
    datasets?: ChartDataset[];
  };
}

export interface CollageObject extends ObjectBase {
  type: "collage";
  /** Schema key is `collage`; spec §7.3 example uses flat `images`/`layout`/`captions`. */
  collage?: {
    images?: string[];
    layout?: "grid" | "masonry";
    captions?: RichText[];
  };
}

/**
 * Click region on a simulation step's screenshot, as fractions (0–1) of the
 * screenshot dimensions (SPEC §7.3, rev 17). Fractions keep the geometry
 * valid at any render size.
 */
export interface SimulationTarget {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * One recorded step of a simulation (SPEC §7.3, rev 17).
 */
export interface SimulationStep {
  id: string;
  /** Resource id of the step's screenshot. */
  screen: string;
  /** Instruction shown to the learner (sanitized HTML). */
  caption?: RichText;
  /** Click region; absent on keypress steps. */
  target?: SimulationTarget;
  /** Keypress step: the recorded key the learner must press (e.g. "Enter"). */
  expectedKey?: string;
  /** Sanitized HTML hint shown after `missesBeforeHint` wrong attempts. */
  hint?: RichText;
  /** Offer a "show me" highlight for this step. Defaults to true. */
  showMe?: boolean;
}

export interface SimulationObject extends ObjectBase {
  type: "simulation";
  /**
   * The recorded simulation. A LOCKED container (Justin's standing
   * decision): players run the steps, but the authoring tool exposes no
   * step editing — authors can move, resize, and delete the object only.
   */
  simulation: {
    title?: string;
    /** Wrong attempts before the step hint is shown. Defaults to 2. */
    missesBeforeHint?: number;
    steps: SimulationStep[];
    /** Import provenance (which tool recorded it). */
    source?: { tool?: string; note?: string };
  };
}

/**
 * Slider/dial configuration (SPEC §7.3, rev 18). Storyline's slider and
 * dial inputs: a numeric value the learner sets by dragging (or keyboard).
 * The runtime writes the current value to `variable` as it changes and
 * fires a `slider-change` trigger event on the object.
 */
export interface SliderConfig {
  /** Minimum value. Defaults to 0. */
  min?: number;
  /** Maximum value. Defaults to 100. */
  max?: number;
  /** Step increment; must be > 0. Defaults to 1. */
  step?: number;
  /** Initial value shown. Defaults to `min`. */
  value?: number;
  /** Course variable id (or name) the current value is written to. */
  variable?: string;
  /** Slider track orientation; ignored by dial. Defaults to "horizontal". */
  orientation?: "horizontal" | "vertical";
}

/** Numeric slider input (track + thumb), SPEC §7.3 rev 18. */
export interface SliderObject extends ObjectBase {
  type: "slider";
  slider: SliderConfig;
}

/** Rotary dial numeric input, SPEC §7.3 rev 18. */
export interface DialObject extends ObjectBase {
  type: "dial";
  dial: SliderConfig;
}

export type CourseObject =
  | TextObject
  | ImageObject
  | AudioObject
  | VideoObject
  | ShapeObject
  | ButtonObject
  | HotspotObject
  | WebviewObject
  | GroupObject
  | PopupObject
  | QuestionObject
  | AccordionObject
  | TabsObject
  | TimelineObject
  | SlideshowObject
  | FlipcardsObject
  | ImageCompareObject
  | InteractiveVideoObject
  | ChartObject
  | CollageObject
  | SimulationObject
  | SliderObject
  | DialObject
  | CharacterObject
  | VideoSceneObject
  | LottieObject;

// ---------------------------------------------------------------------------
// Variables (SPEC §8)
// ---------------------------------------------------------------------------

export interface Variable {
  id: string;
  name: string;
  type: "text" | "number" | "boolean";
  initial?: unknown;
}

// ---------------------------------------------------------------------------
// Triggers (SPEC §9)
// ---------------------------------------------------------------------------

export type TriggerEventType =
  | "click"
  | "double-click"
  | "hover"
  | "hover-out"
  | "timeline-start"
  | "timeline-end"
  | "cue-point"
  | "media-complete"
  | "variable-change"
  | "key-press"
  | "page-enter"
  | "page-exit"
  | "drop-on"
  | "simulation-complete"
  | "slider-change"
  /** R8: fired on a media object when a video-timeline hotspot is clicked. */
  | "hotspot-click";

export interface TriggerEvent {
  type: TriggerEventType;
  /** Seconds — cue-point. */
  at?: number;
  /** Cue point id — cue-point (SPEC rev 16). Takes precedence over `at`. */
  cuePoint?: string;
  /** key-press. */
  key?: string;
  /** Object id — drop-on. For drag-drop questions this is the drop-zone id. */
  target?: string;
  /** Hotspot region id — hotspot-click (SPEC rev 23). */
  hotspot?: string;
  /** Variable id — variable-change. */
  variable?: string;
}

export type ConditionOperator =
  | "=="
  | "!="
  | ">"
  | ">="
  | "<"
  | "<="
  | "contains"
  | "is-empty";

export type Condition =
  | { variable: string; op: ConditionOperator; value: unknown }
  | { object: string; state: string };

export type ActionType =
  | "show"
  | "hide"
  | "toggle"
  | "jump"
  | "lightbox"
  | "close-lightbox"
  | "open-popup"
  | "close-popup"
  | "set-variable"
  | "play-media"
  | "pause-media"
  | "seek-media"
  | "toggle-captions"
  | "change-state"
  | "open-url"
  | "submit-results"
  | "send-xapi"
  | "restart-timeline"
  | "exit-course"
  | "execute-js";

export interface ActionBase {
  type: ActionType;
}

/** Target: object/layer id, or structured page/section reference. */
export type ActionTarget =
  | string
  | { page?: string; section?: string; [key: string]: unknown };

export interface ShowAction extends ActionBase {
  type: "show";
  target?: ActionTarget;
}
export interface HideAction extends ActionBase {
  type: "hide";
  target?: ActionTarget;
}
export interface ToggleAction extends ActionBase {
  type: "toggle";
  target?: ActionTarget;
}
export interface JumpAction extends ActionBase {
  type: "jump";
  target?: ActionTarget;
  page?: string;
  section?: string;
  transition?: string;
}
export interface LightboxAction extends ActionBase {
  type: "lightbox";
  target?: ActionTarget;
  page?: string;
}
export interface CloseLightboxAction extends ActionBase {
  type: "close-lightbox";
}
/** Open a `popup` object as a modal dialog. `target` is the popup object id. */
export interface OpenPopupAction extends ActionBase {
  type: "open-popup";
  target?: ActionTarget;
}
/** Close the currently open popup, if any. */
export interface ClosePopupAction extends ActionBase {
  type: "close-popup";
}
export interface SetVariableAction extends ActionBase {
  type: "set-variable";
  variable?: string;
  value?: unknown;
  operation?: "set" | "add" | "toggle";
}
export interface PlayMediaAction extends ActionBase {
  type: "play-media";
  target?: ActionTarget;
}
export interface PauseMediaAction extends ActionBase {
  type: "pause-media";
  target?: ActionTarget;
}
export interface SeekMediaAction extends ActionBase {
  type: "seek-media";
  target?: ActionTarget;
  at?: number;
}
export interface ToggleCaptionsAction extends ActionBase {
  type: "toggle-captions";
  target?: ActionTarget;
}
export interface ChangeStateAction extends ActionBase {
  type: "change-state";
  target?: ActionTarget;
  state?: string;
}
export interface OpenUrlAction extends ActionBase {
  type: "open-url";
  url?: string;
  urlTarget?: "_blank" | "_self";
}
export interface SubmitResultsAction extends ActionBase {
  type: "submit-results";
  assessment?: string;
}
export interface XapiExtensionPair {
  /** Extension IRI (validated as an absolute IRI). */
  key: string;
  value: string;
}

/**
 * R6 — no-code xAPI statement builder (SPEC rev 22). Authors pick the verb,
 * object, and result mapping from dropdowns; the xAPI exporter serializes
 * the statement at runtime. No JavaScript required.
 */
export interface XapiBuilder {
  /** xAPI verb IRI (validated as an absolute IRI). */
  verb?: string;
  /** Human-readable verb label for the author UI, e.g. "completed". */
  verbDisplay?: string;
  /** What the statement is about. */
  objectKind?: "course" | "current-page" | "page" | "question" | "object" | "custom";
  /** Page/object id when objectKind is "page", "question", or "object". */
  objectRef?: string;
  /** Display name for the activity (en-US). */
  objectName?: string;
  /** Full activity IRI when objectKind is "custom". */
  objectId?: string;
  /**
   * How `result.success` is set: "none" (omit), "from-answer" (the last
   * submitted question's correct/incorrect verdict), "correct", "incorrect".
   */
  success?: "none" | "from-answer" | "correct" | "incorrect";
  /** Fixed score reported on the statement result. */
  score?: { raw?: number; max?: number };
  /** Include the learner's last response string on `result.response`. */
  includeResponse?: boolean;
  /** Extra result extensions: IRI → string value. */
  extensions?: XapiExtensionPair[];
}

export interface SendXapiAction extends ActionBase {
  type: "send-xapi";
  verb?: string;
  xapiObject?: Record<string, unknown>;
  xapiResult?: Record<string, unknown>;
  /**
   * R6 — no-code statement builder. When present, the xAPI exporter
   * serializes the statement from these fields (no JavaScript needed);
   * `verb` is mirrored for legacy readers. Validate verbs as IRIs.
   */
  xapiBuilder?: XapiBuilder;
}
export interface RestartTimelineAction extends ActionBase {
  type: "restart-timeline";
}
export interface ExitCourseAction extends ActionBase {
  type: "exit-course";
}
/** Non-portable by definition — converters must preserve, players may sandbox or ignore. */
export interface ExecuteJsAction extends ActionBase {
  type: "execute-js";
  code?: string;
}

export type Action =
  | ShowAction
  | HideAction
  | ToggleAction
  | JumpAction
  | LightboxAction
  | CloseLightboxAction
  | OpenPopupAction
  | ClosePopupAction
  | SetVariableAction
  | PlayMediaAction
  | PauseMediaAction
  | SeekMediaAction
  | ToggleCaptionsAction
  | ChangeStateAction
  | OpenUrlAction
  | SubmitResultsAction
  | SendXapiAction
  | RestartTimelineAction
  | ExitCourseAction
  | ExecuteJsAction;

export interface Trigger {
  id: string;
  event: TriggerEvent;
  conditions?: Condition[];
  actions: Action[];
}

// ---------------------------------------------------------------------------
// Assessments (SPEC §11)
// ---------------------------------------------------------------------------

export interface QuestionBank {
  id: string;
  draw?: number;
  randomize?: boolean;
  topic?: string;
}

// ---------------------------------------------------------------------------
// Adaptive learning paths (SPEC §11, rev 26 — R9)
// ---------------------------------------------------------------------------

/**
 * A single adaptive path rule. Evaluated in array order; the first rule whose
 * `when` matches the learner's score wins and the learner is routed to `page`.
 *
 * `when` uses the same expression syntax as remediation (`"score < 50"`,
 * `"score >= 80"`), parsed by `parseWhen` in the player engine.
 */
export interface AdaptivePathRule {
  id: string;
  /** Author-facing label, e.g. "Needs intensive help". */
  label?: string;
  /** Score condition, e.g. "score < 50". */
  when: string;
  /** Page id to route to when this rule matches. */
  page: string;
}

export interface Assessment {
  id: string;
  title: string;
  /** Question page ids. */
  pages?: string[];
  banks?: QuestionBank[];
  shuffleQuestions?: boolean;
  /** Percent required to pass. */
  passScore?: number;
  attempts?: number;
  /** Seconds. */
  timeLimit?: number;
  results?: {
    successPage?: string;
    failurePage?: string;
    remediation?: { page?: string; when?: string };
    /**
     * R9 (rev 26): adaptive path rules. Evaluated in order on results submit;
     * first matching rule routes the learner. Takes precedence over the
     * simple successPage/failurePage when present and non-empty.
     */
    pathRules?: AdaptivePathRule[];
    /**
     * R9 (rev 26): marks this assessment as a diagnostic pre-test. A
     * diagnostic is typically placed at the course start; its pathRules route
     * learners to different entry points based on prior knowledge
     * (test-out for experts, foundations for beginners).
     */
    isDiagnostic?: boolean;
  };
  extensions?: Extensions;
}

// ---------------------------------------------------------------------------
// Resources (SPEC §13)
// ---------------------------------------------------------------------------

export type ResourceKind = "image" | "audio" | "video" | "document" | "font" | "other";

export interface ResourceCaption {
  src: string;
  lang: string;
  kind?: "captions" | "subtitles";
}

export interface Resource {
  id: string;
  kind: ResourceKind;
  /** Relative path from course.json. */
  src: string;
  mime?: string;
  title?: string;
  alt?: string;
  /** Seconds — audio/video. */
  duration?: number;
  /** File size in bytes, when known (importers may record it at conversion time). */
  size?: number;
  captions?: ResourceCaption[];
  /** Text transcript for audio/video content (sanitized HTML fragment). */
  transcript?: RichText;
  /** Resource id of poster image. */
  poster?: string;
  extensions?: Extensions;
}

// ---------------------------------------------------------------------------
// Theme (SPEC §14)
// ---------------------------------------------------------------------------

export interface Theme {
  /** Named theme reference (premade library or user-saved set); inline keys override it. */
  id?: string;
  /** Display name for a user-defined theme. */
  name?: string;
  palette?: {
    primary?: Color;
    secondary?: Color;
    accent?: Color;
    text?: Color;
    background?: Color;
    success?: Color;
    danger?: Color;
  };
  fonts?: { heading?: string; body?: string; mono?: string };
  /**
   * Type scale in px (SPEC §14; Element Wave C). One coherent scale shared
   * by the editor canvas, the player, and the SCORM runtime: the editor maps
   * each present step onto its `--ocf-type-*` CSS variable, so a theme can
   * restyle every surface's typography at once. Every key is optional —
   * absent steps fall back to the built-in defaults (h1 32 · h2 24 · h3 20 ·
   * h4 20 · lead 20 · label 15 · body 16 · small 14 · caption 13 · quote 24 ·
   * statement 24). Per-object authored font-size overrides still win over
   * these defaults.
   */
  typeScale?: {
    h1?: number;
    h2?: number;
    h3?: number;
    h4?: number;
    lead?: number;
    label?: number;
    body?: number;
    small?: number;
    caption?: number;
    quote?: number;
    statement?: number;
  };
  corners?: "sharp" | "rounded" | "pill";
  /** Resource id of a logo image shown in the player chrome. */
  logo?: string;
  /** Player header/footer variant id ("minimal" | "branded" | "classroom" …). */
  chrome?: string;
  /**
   * Locked theme paths (SPEC §14, rev 26, enterprise governance). Dot-notation
   * paths into this theme that authors cannot change, e.g.
   * `["palette.primary", "palette.accent", "fonts", "logo"]`.
   * A parent path locks all children (`"palette"` locks every palette key).
   * The editor disables controls for locked paths.
   */
  locked?: string[];
  /**
   * Author-chosen player color scheme ("light" | "dark"). This is the
   * learner-facing default; readers may offer the learner a toggle that
   * overrides it. Defaults to "light" when absent.
   */
  colorScheme?: "light" | "dark";
}

/**
 * Course-level player settings (SPEC rev 29).
 *
 * Stored on the course as `course.settings`; every field is optional and
 * absent settings mean today's behavior. Players resolve the effective
 * values with `courseSettingsOf` (in helpers), which applies these
 * defaults: navigation `"free"`, allowRevisit `true`, completionRule
 * `"all-pages"`, resume `"ask"`, showProgress `true`.
 */
export interface CourseSettings {
  /**
   * `"free"` (default): learners can jump to any page.
   * `"restricted"`: a page unlocks only when every page before it in
   * course order is complete (a page is complete when visited, or — when
   * it contains a question — when an answer has been submitted on it).
   */
  navigation?: "free" | "restricted";
  /**
   * Only meaningful in restricted mode. Defaults to `true`. When `false`,
   * completed pages lock again — learners move forward in lock-step and
   * cannot revisit pages they have completed.
   */
  allowRevisit?: boolean;
  /**
   * What counts as course completion (defaults to `"all-pages"`):
   * `"all-pages"` = every page complete; `"assessment"` = the required
   * assessment passed; `"both"` = both conditions.
   */
  completionRule?: "all-pages" | "assessment" | "both";
  /**
   * Resume behavior when a learner returns (defaults to `"ask"`):
   * `"ask"` prompts, `"always"` resumes silently, `"never"` restarts.
   * Host-chrome concern; engines expose it via `courseSettingsOf`.
   */
  resume?: "ask" | "always" | "never";
  /** Show progress chrome in the player. Defaults to `true`. Host-chrome concern. */
  showProgress?: boolean;
}

/** `CourseSettings` with every default applied — the return of `courseSettingsOf`. */
export type ResolvedCourseSettings = Required<CourseSettings>;

/**
 * Flow-page width mode (SPEC §14, rev 13).
 *
 * - `"contained"` (default): all flow content renders in a centered column no
 *   wider than `contentWidth` px.
 * - `"full"`: the page canvas runs edge-to-edge — block units (groups with
 *   `row`: banners, full-width image rows, any grid row) stretch full-bleed,
 *   while text content stays constrained to `contentWidth` px and centered.
 */
export type WidthMode = "contained" | "full";

/**
 * Course-level display settings (SPEC §14, rev 11 + rev 13).
 */
export interface DisplaySettings {
  /**
   * Max content width in px for flow pages — the flow content renders in a
   * centered column no wider than this (Rise-style). Defaults to
   * {@link DEFAULT_CONTENT_WIDTH} (1024) when absent; suggested range
   * 640–1600. Fixed pages are unaffected. In `"full"` width mode this still
   * constrains the text content column while block units bleed past it.
   */
  contentWidth?: number;
  /**
   * Width mode for flow pages (SPEC §14, rev 13). Defaults to `"contained"`
   * when absent. Fixed pages are unaffected.
   */
  widthMode?: WidthMode;
}

// ---------------------------------------------------------------------------
// Publish hints (SPEC §15)
// ---------------------------------------------------------------------------

export type LmsStandard = "scorm-1.2" | "scorm-2004" | "xapi" | "cmi5" | "none";

export interface Publish {
  lms?: {
    standard?: LmsStandard;
    identifier?: string;
    masteryScore?: number;
    launchSize?: { w?: number; h?: number };
  };
  objectives?: { id: string; title?: string }[];
}
