/**
 * Shared Effects Core registry: STUDIO REPO COPY (issue #111, G7).
 *
 * This file is the shared effects registry for FinchLearn Studio and
 * the FinchLearn course editor. The course repo
 * (jpsnow72/open-course-format) mirrors it at the identical relative
 * path, packages/core/src/effects.ts in @ocf/core (course issue #718).
 * The two copies may differ ONLY above the marker line below (this
 * header comment). Everything below the marker line is mirrored byte
 * for byte; the course repo carries the cross-repo sync script
 * (packages/core/scripts/sync-effects.mjs in that repo), and a unit
 * test in each repo pins a content hash of the body below the marker
 * plus the spec timing defaults, so a unilateral edit fails that
 * repo's own tests even before the cross-repo check runs. Registry
 * changes land as paired changes in both repos in the same wave,
 * named in both commit messages.
 *
 * The registry data literal (EFFECTS_REGISTRY_BODY) is pure JSON:
 * double-quoted keys, no comments, no trailing commas, no functions.
 * It sits between the REGISTRY-JSON-START and REGISTRY-JSON-END
 * markers so tests and tooling can extract and JSON-parse it verbatim.
 * Renderers never read the registry at runtime for sampling; they
 * consume expansions (animations.ts expands variants to timeline
 * tracks; the course renderers do the same on their side).
 */
// === SHARED EFFECTS REGISTRY: MIRRORED BODY BELOW THIS LINE ===

/** Effect categories (AUDIT section 16 taxonomy). */
export type EffectCategory =
  | "entrance"
  | "text"
  | "continuous"
  | "emphasis"
  | "exit"
  | "motion";

/** How a variant sits in a picker: an entrance, an exit, or a
 *  standalone effect in its parent effect's category. */
export type EffectVariantKind =
  | "enter"
  | "exit"
  | "emphasis"
  | "continuous"
  | "motion"
  | "text";

/**
 * One keyframe-lite track recipe at the registry's default parameters
 * (slide distance 300px, Ken Burns default framing). `easing: null`
 * means the track carries no easing field and samplers apply their
 * default (easeOut). `durationFixedMs` pins the track duration
 * regardless of the requested duration; `durationMinMs` raises the
 * requested duration to at least that many ms.
 */
export interface EffectTrackRecipe {
  property: string;
  from: number;
  to: number;
  easing: string | null;
  durationFixedMs?: number;
  durationMinMs?: number;
}

/**
 * One expandable preset variant of an effect. `presetName` is the
 * timeline preset name the variant expands from (the course and Studio
 * preset vocabulary, for example "fadeIn" or "wipeInLeft"); it is null
 * for effects no preset engine expands yet (baseline-reveal and
 * block-reveal are authored once here and implemented once per
 * renderer). Kinetic text variants (typewriter, word-reveal,
 * line-reveal) carry an empty track list on purpose: no animatable
 * property expresses per-unit text visibility, so the preset entry is
 * the marker and the renderer expands the per-unit reveal schedule
 * from the effect's `unit` field.
 */
export interface EffectVariant {
  presetName: string | null;
  kind: EffectVariantKind;
  label: string;
  hint: string;
  tracks: EffectTrackRecipe[];
}

/** One shared effect definition. All fields are JSON values. */
export interface EffectDefinition {
  /** Stable kebab-case id, identical in both products. */
  id: string;
  label: string;
  category: EffectCategory;
  /** Default duration in ms (spec table for the nine spec effects). */
  defaultDurationMs: number;
  /** Default delay (start offset) in ms. */
  defaultDelayMs: number;
  /** True when the effect loops (continuous or emphasis-loop). */
  loop: boolean;
  /** Animatable properties the canonical recipe touches. */
  properties: string[];
  /** Direction variants, for Slide and Wipe; empty otherwise. */
  directions: string[];
  /** Canonical keyframe recipe at default parameters. */
  tracks: EffectTrackRecipe[];
  /** Preset variants (entrances, exits, and standalone forms). */
  variants: EffectVariant[];
  /** Kinetic text unit for text effects: character, word, or line. */
  unit?: string;
  /** Ken Burns default framing (motion category only). */
  framing?: {
    from: { scale: number; x: number; y: number };
    to: { scale: number; x: number; y: number };
  };
  /** Renderer or reconciliation note, where the recipe needs one. */
  notes?: string;
}

/** The registry body: version, category list, and effect definitions. */
export interface EffectsRegistryBody {
  version: number;
  categories: EffectCategory[];
  effects: EffectDefinition[];
}

export const EFFECTS_REGISTRY_BODY: EffectsRegistryBody = /* REGISTRY-JSON-START */ {
  "version": 1,
  "categories": ["entrance", "text", "continuous", "emphasis", "exit", "motion"],
  "effects": [
    {
      "id": "fade",
      "label": "Fade",
      "category": "entrance",
      "defaultDurationMs": 400,
      "defaultDelayMs": 0,
      "loop": false,
      "properties": ["opacity"],
      "directions": [],
      "tracks": [
        { "property": "opacity", "from": 0, "to": 1, "easing": null }
      ],
      "variants": [
        {
          "presetName": "fadeIn",
          "kind": "enter",
          "label": "Fade in",
          "hint": "Opacity 0 → 1",
          "tracks": [
            { "property": "opacity", "from": 0, "to": 1, "easing": null }
          ]
        },
        {
          "presetName": "fadeOut",
          "kind": "exit",
          "label": "Fade out",
          "hint": "Opacity 1 → 0",
          "tracks": [
            { "property": "opacity", "from": 1, "to": 0, "easing": null }
          ]
        }
      ]
    },
    {
      "id": "slide",
      "label": "Slide",
      "category": "entrance",
      "defaultDurationMs": 500,
      "defaultDelayMs": 0,
      "loop": false,
      "properties": ["x", "y", "opacity"],
      "directions": ["left", "right", "up", "down"],
      "tracks": [
        { "property": "x", "from": -300, "to": 0, "easing": null },
        { "property": "opacity", "from": 0, "to": 1, "easing": null }
      ],
      "notes": "Track offsets are px at the default slide distance of 300; expanders scale the 300 endpoints by the requested distance. Direction names the side the object comes from on entry (left, right, up meaning from the bottom, down meaning from the top), matching the legacy slideIn preset labels.",
      "variants": [
        {
          "presetName": "slideInLeft",
          "kind": "enter",
          "label": "Slide in from left",
          "hint": "Moves in from the left",
          "tracks": [
            { "property": "x", "from": -300, "to": 0, "easing": null },
            { "property": "opacity", "from": 0, "to": 1, "easing": null }
          ]
        },
        {
          "presetName": "slideInRight",
          "kind": "enter",
          "label": "Slide in from right",
          "hint": "Moves in from the right",
          "tracks": [
            { "property": "x", "from": 300, "to": 0, "easing": null },
            { "property": "opacity", "from": 0, "to": 1, "easing": null }
          ]
        },
        {
          "presetName": "slideInUp",
          "kind": "enter",
          "label": "Slide in from bottom",
          "hint": "Moves up into place",
          "tracks": [
            { "property": "y", "from": 300, "to": 0, "easing": null },
            { "property": "opacity", "from": 0, "to": 1, "easing": null }
          ]
        },
        {
          "presetName": "slideInDown",
          "kind": "enter",
          "label": "Slide in from top",
          "hint": "Moves down into place",
          "tracks": [
            { "property": "y", "from": -300, "to": 0, "easing": null },
            { "property": "opacity", "from": 0, "to": 1, "easing": null }
          ]
        },
        {
          "presetName": "slideOutLeft",
          "kind": "exit",
          "label": "Slide out left",
          "hint": "Moves off to the left",
          "tracks": [
            { "property": "x", "from": 0, "to": -300, "easing": null },
            { "property": "opacity", "from": 1, "to": 0, "easing": null }
          ]
        },
        {
          "presetName": "slideOutRight",
          "kind": "exit",
          "label": "Slide out right",
          "hint": "Moves off to the right",
          "tracks": [
            { "property": "x", "from": 0, "to": 300, "easing": null },
            { "property": "opacity", "from": 1, "to": 0, "easing": null }
          ]
        },
        {
          "presetName": "slideOutUp",
          "kind": "exit",
          "label": "Slide out up",
          "hint": "Moves off the top",
          "tracks": [
            { "property": "y", "from": 0, "to": -300, "easing": null },
            { "property": "opacity", "from": 1, "to": 0, "easing": null }
          ]
        },
        {
          "presetName": "slideOutDown",
          "kind": "exit",
          "label": "Slide out down",
          "hint": "Moves off the bottom",
          "tracks": [
            { "property": "y", "from": 0, "to": 300, "easing": null },
            { "property": "opacity", "from": 1, "to": 0, "easing": null }
          ]
        }
      ]
    },
    {
      "id": "scale-up",
      "label": "Scale Up",
      "category": "entrance",
      "defaultDurationMs": 400,
      "defaultDelayMs": 0,
      "loop": false,
      "properties": ["scale", "opacity"],
      "directions": [],
      "tracks": [
        { "property": "scale", "from": 0.8, "to": 1, "easing": null },
        { "property": "opacity", "from": 0, "to": 1, "easing": null }
      ],
      "notes": "The canonical recipe is the spec Scale Up (scale 0.8 to 1). The legacy zoomIn variant keeps its historical 0.3 start and the Studio popIn variant keeps its 0.65 start with bounce easing, so saved courses and Studio scenes render exactly as before; neither variant is the canonical recipe.",
      "variants": [
        {
          "presetName": "zoomIn",
          "kind": "enter",
          "label": "Zoom in",
          "hint": "Scales up into place",
          "tracks": [
            { "property": "scale", "from": 0.3, "to": 1, "easing": null },
            { "property": "opacity", "from": 0, "to": 1, "easing": null }
          ]
        },
        {
          "presetName": "popIn",
          "kind": "enter",
          "label": "Pop in",
          "hint": "Scales and fades into place",
          "tracks": [
            { "property": "scale", "from": 0.65, "to": 1, "easing": "bounce" },
            { "property": "opacity", "from": 0, "to": 1, "easing": null }
          ]
        },
        {
          "presetName": "zoomOut",
          "kind": "exit",
          "label": "Zoom out",
          "hint": "Scales down and fades away",
          "tracks": [
            { "property": "scale", "from": 1, "to": 0.3, "easing": null },
            { "property": "opacity", "from": 1, "to": 0, "easing": null }
          ]
        },
        {
          "presetName": "popOut",
          "kind": "exit",
          "label": "Pop out",
          "hint": "Scales and fades away",
          "tracks": [
            { "property": "scale", "from": 1, "to": 0.65, "easing": null },
            { "property": "opacity", "from": 1, "to": 0, "easing": null }
          ]
        }
      ]
    },
    {
      "id": "wipe",
      "label": "Wipe",
      "category": "entrance",
      "defaultDurationMs": 600,
      "defaultDelayMs": 0,
      "loop": false,
      "properties": ["wipeLeft", "wipeRight", "wipeUp", "wipeDown"],
      "directions": ["left", "right", "up", "down"],
      "tracks": [
        { "property": "wipeLeft", "from": 0, "to": 1, "easing": null }
      ],
      "notes": "Wipe properties run 0 (fully clipped) to 1 (fully revealed) and render as CSS clip-path inset on the side named by the property, per the Studio animatedStyle renderer. Direction names the side the reveal starts from. The course JSON Schema property enum does not carry the wipe properties yet; that schema addition is a separate rule-4 change and is not part of the registry.",
      "variants": [
        {
          "presetName": "wipeInLeft",
          "kind": "enter",
          "label": "Wipe in from left",
          "hint": "Reveals from the left",
          "tracks": [
            { "property": "wipeLeft", "from": 0, "to": 1, "easing": null }
          ]
        },
        {
          "presetName": "wipeInRight",
          "kind": "enter",
          "label": "Wipe in from right",
          "hint": "Reveals from the right",
          "tracks": [
            { "property": "wipeRight", "from": 0, "to": 1, "easing": null }
          ]
        },
        {
          "presetName": "wipeInUp",
          "kind": "enter",
          "label": "Wipe in from top",
          "hint": "Reveals from the top",
          "tracks": [
            { "property": "wipeUp", "from": 0, "to": 1, "easing": null }
          ]
        },
        {
          "presetName": "wipeInDown",
          "kind": "enter",
          "label": "Wipe in from bottom",
          "hint": "Reveals from the bottom",
          "tracks": [
            { "property": "wipeDown", "from": 0, "to": 1, "easing": null }
          ]
        },
        {
          "presetName": "wipeOutLeft",
          "kind": "exit",
          "label": "Wipe out left",
          "hint": "Closes toward the left",
          "tracks": [
            { "property": "wipeLeft", "from": 1, "to": 0, "easing": null }
          ]
        },
        {
          "presetName": "wipeOutRight",
          "kind": "exit",
          "label": "Wipe out right",
          "hint": "Closes toward the right",
          "tracks": [
            { "property": "wipeRight", "from": 1, "to": 0, "easing": null }
          ]
        },
        {
          "presetName": "wipeOutUp",
          "kind": "exit",
          "label": "Wipe out up",
          "hint": "Closes toward the top",
          "tracks": [
            { "property": "wipeUp", "from": 1, "to": 0, "easing": null }
          ]
        },
        {
          "presetName": "wipeOutDown",
          "kind": "exit",
          "label": "Wipe out down",
          "hint": "Closes toward the bottom",
          "tracks": [
            { "property": "wipeDown", "from": 1, "to": 0, "easing": null }
          ]
        }
      ]
    },
    {
      "id": "bounce",
      "label": "Bounce",
      "category": "entrance",
      "defaultDurationMs": 800,
      "defaultDelayMs": 0,
      "loop": false,
      "properties": ["y", "opacity"],
      "directions": [],
      "tracks": [
        { "property": "y", "from": -100, "to": 0, "easing": "bounce", "durationMinMs": 800 },
        { "property": "opacity", "from": 0, "to": 1, "easing": null, "durationFixedMs": 300 }
      ],
      "notes": "The y recipe value (-100) is the drop at the default slide distance of 300; expanders compute the drop as -max(80, distance / 3), the historical course and Studio formula, which is -100 at the default. The y track duration is at least 800ms and the fade is fixed at 300ms, as in both legacy copies.",
      "variants": [
        {
          "presetName": "bounce",
          "kind": "enter",
          "label": "Bounce in",
          "hint": "Drops in with a bounce",
          "tracks": [
            { "property": "y", "from": -100, "to": 0, "easing": "bounce", "durationMinMs": 800 },
            { "property": "opacity", "from": 0, "to": 1, "easing": null, "durationFixedMs": 300 }
          ]
        }
      ]
    },
    {
      "id": "baseline-reveal",
      "label": "Baseline Reveal",
      "category": "entrance",
      "defaultDurationMs": 500,
      "defaultDelayMs": 0,
      "loop": false,
      "properties": ["y", "opacity"],
      "directions": [],
      "tracks": [
        { "property": "y", "from": 16, "to": 0, "easing": null },
        { "property": "opacity", "from": 0, "to": 1, "easing": null }
      ],
      "notes": "New in the shared core (existed in neither product). The motion language comes from the course ambient scroll reveal (opacity 0 plus translateY 16px settling to place); renderers present it as an authored, selectable reveal with a baseline mask. There is no legacy preset name; renderers key off the effect id.",
      "variants": []
    },
    {
      "id": "block-reveal",
      "label": "Block Reveal",
      "category": "entrance",
      "defaultDurationMs": 600,
      "defaultDelayMs": 0,
      "loop": false,
      "properties": ["wipeRight", "opacity"],
      "directions": ["right"],
      "tracks": [
        { "property": "wipeRight", "from": 0, "to": 1, "easing": null },
        { "property": "opacity", "from": 0, "to": 1, "easing": null }
      ],
      "notes": "New in the shared core (existed in neither product). A solid color block sweeps across the object left to right and the object is unmasked behind it; the tracks describe the reveal window in shared properties and the renderer draws the overlay block. This effect is distinct from the course ambient scroll reveal whose CSS keyframe name (ocf-kf-block-reveal) predates it; the two must never share a CSS or UI name.",
      "variants": []
    },
    {
      "id": "typewriter",
      "label": "Typewriter",
      "category": "text",
      "defaultDurationMs": 1200,
      "defaultDelayMs": 0,
      "loop": false,
      "properties": [],
      "directions": [],
      "tracks": [],
      "unit": "character",
      "notes": "Kinetic text reveal: the renderer splits the text into character units and spreads them evenly across the reveal window (Studio expandKineticReveal). No timeline tracks; the preset entry carries the window.",
      "variants": [
        {
          "presetName": "typewriterReveal",
          "kind": "text",
          "label": "Typewriter reveal",
          "hint": "Text appears character by character",
          "tracks": []
        }
      ]
    },
    {
      "id": "word-reveal",
      "label": "Word Reveal",
      "category": "text",
      "defaultDurationMs": 1200,
      "defaultDelayMs": 0,
      "loop": false,
      "properties": [],
      "directions": [],
      "tracks": [],
      "unit": "word",
      "notes": "Kinetic text reveal, word units weighted by length across the reveal window (Studio expandKineticReveal). The 1200ms default matches the typewriter spec default; Studio encoded no per-effect default for this variant.",
      "variants": [
        {
          "presetName": "wordReveal",
          "kind": "text",
          "label": "Word by word reveal",
          "hint": "Text appears word by word",
          "tracks": []
        }
      ]
    },
    {
      "id": "line-reveal",
      "label": "Line Reveal",
      "category": "text",
      "defaultDurationMs": 1200,
      "defaultDelayMs": 0,
      "loop": false,
      "properties": [],
      "directions": [],
      "tracks": [],
      "unit": "line",
      "notes": "Kinetic text reveal, line units weighted by length across the reveal window (Studio expandKineticReveal). The 1200ms default matches the typewriter spec default; Studio encoded no per-effect default for this variant.",
      "variants": [
        {
          "presetName": "lineReveal",
          "kind": "text",
          "label": "Line by line reveal",
          "hint": "Text appears line by line",
          "tracks": []
        }
      ]
    },
    {
      "id": "pulse",
      "label": "Pulse",
      "category": "emphasis",
      "defaultDurationMs": 1500,
      "defaultDelayMs": 0,
      "loop": true,
      "properties": ["scale"],
      "directions": [],
      "tracks": [
        { "property": "scale", "from": 1, "to": 1.16, "easing": "pulse" }
      ],
      "notes": "One definition wins: the Studio core emphasisPulse recipe (scale to 1.16 with the pulse easing, a sine bump that returns to 1). The Studio motion package's separate pulse keyframes (scale to 1.08) are superseded by this recipe for the shared taxonomy. When authored as a one-shot emphasis the same recipe plays once; the registry marks the effect as looping because its spec form is a continuous loop, and renderers repeat the window while the object is shown.",
      "variants": [
        {
          "presetName": "emphasisPulse",
          "kind": "emphasis",
          "label": "Pulse",
          "hint": "Briefly grows and returns",
          "tracks": [
            { "property": "scale", "from": 1, "to": 1.16, "easing": "pulse" }
          ]
        }
      ]
    },
    {
      "id": "shake",
      "label": "Shake",
      "category": "emphasis",
      "defaultDurationMs": 600,
      "defaultDelayMs": 0,
      "loop": false,
      "properties": ["rotation"],
      "directions": [],
      "tracks": [
        { "property": "rotation", "from": 0, "to": 8, "easing": "shake" }
      ],
      "notes": "Studio emphasisShake recipe: rotation driven by the shake easing (a decaying-frequency sine, sin(6 * pi * t) scaled), settling back to 0 after the window. The 600ms default is the Studio preset engine default; no spec default exists for this extra.",
      "variants": [
        {
          "presetName": "emphasisShake",
          "kind": "emphasis",
          "label": "Shake",
          "hint": "Briefly shakes and returns",
          "tracks": [
            { "property": "rotation", "from": 0, "to": 8, "easing": "shake" }
          ]
        }
      ]
    },
    {
      "id": "spin",
      "label": "Spin",
      "category": "emphasis",
      "defaultDurationMs": 600,
      "defaultDelayMs": 0,
      "loop": false,
      "properties": ["rotation"],
      "directions": [],
      "tracks": [
        { "property": "rotation", "from": 0, "to": 360, "easing": null }
      ],
      "notes": "Studio emphasisSpin recipe: one full rotation with the default easing. The 600ms default is the Studio preset engine default; no spec default exists for this extra.",
      "variants": [
        {
          "presetName": "emphasisSpin",
          "kind": "emphasis",
          "label": "Spin",
          "hint": "Rotates once",
          "tracks": [
            { "property": "rotation", "from": 0, "to": 360, "easing": null }
          ]
        }
      ]
    },
    {
      "id": "float",
      "label": "Float",
      "category": "continuous",
      "defaultDurationMs": 2500,
      "defaultDelayMs": 0,
      "loop": true,
      "properties": ["y"],
      "directions": [],
      "tracks": [
        { "property": "y", "from": 0, "to": -10, "easing": "pulse" }
      ],
      "notes": "Promoted from the Studio motion package presetTracks float (y keyframes 0, -10, 0 over the window). The single track with the pulse easing reproduces that keyframe shape exactly in the track model: the sine bump lifts to -10 at the window midpoint and returns to 0. Renderers repeat the window while the object is shown.",
      "variants": [
        {
          "presetName": "float",
          "kind": "continuous",
          "label": "Float",
          "hint": "Gently floats up and down",
          "tracks": [
            { "property": "y", "from": 0, "to": -10, "easing": "pulse" }
          ]
        }
      ]
    },
    {
      "id": "ken-burns",
      "label": "Ken Burns",
      "category": "motion",
      "defaultDurationMs": 6000,
      "defaultDelayMs": 0,
      "loop": false,
      "properties": ["scale", "x", "y"],
      "directions": [],
      "tracks": [
        { "property": "scale", "from": 1, "to": 1.15, "easing": "easeInOut" },
        { "property": "x", "from": 0, "to": -24, "easing": "easeInOut" },
        { "property": "y", "from": 0, "to": -12, "easing": "easeInOut" }
      ],
      "framing": {
        "from": { "scale": 1, "x": 0, "y": 0 },
        "to": { "scale": 1.15, "x": -24, "y": -12 }
      },
      "notes": "Studio kenBurns recipe with its DEFAULT_KEN_BURNS framing (a slow push-in drifting up and left); authored framing overrides the recipe endpoints. The 6000ms default is the duration Studio's effectiveAnimationsForObject falls back to when no preset duration or object timing exists.",
      "variants": [
        {
          "presetName": "kenBurns",
          "kind": "motion",
          "label": "Ken Burns",
          "hint": "Slow pan and zoom across a still",
          "tracks": [
            { "property": "scale", "from": 1, "to": 1.15, "easing": "easeInOut" },
            { "property": "x", "from": 0, "to": -24, "easing": "easeInOut" },
            { "property": "y", "from": 0, "to": -12, "easing": "easeInOut" }
          ]
        }
      ]
    },
    {
      "id": "chart-sting-grow",
      "label": "Chart Sting: Grow",
      "category": "entrance",
      "defaultDurationMs": 600,
      "defaultDelayMs": 0,
      "loop": false,
      "properties": ["wipeUp", "scale"],
      "directions": [],
      "tracks": [
        { "property": "wipeUp", "from": 0, "to": 1, "easing": null },
        { "property": "scale", "from": 0.96, "to": 1, "easing": null }
      ],
      "notes": "Studio chartStingGrow recipe, tuned for chart and data blocks. The 600ms default is the Studio preset engine default; no spec default exists for this extra.",
      "variants": [
        {
          "presetName": "chartStingGrow",
          "kind": "enter",
          "label": "Chart sting: grow",
          "hint": "Chart reveals upward with a settle",
          "tracks": [
            { "property": "wipeUp", "from": 0, "to": 1, "easing": null },
            { "property": "scale", "from": 0.96, "to": 1, "easing": null }
          ]
        }
      ]
    },
    {
      "id": "chart-sting-sweep",
      "label": "Chart Sting: Sweep",
      "category": "entrance",
      "defaultDurationMs": 600,
      "defaultDelayMs": 0,
      "loop": false,
      "properties": ["wipeRight", "opacity"],
      "directions": [],
      "tracks": [
        { "property": "wipeRight", "from": 0, "to": 1, "easing": null },
        { "property": "opacity", "from": 0, "to": 1, "easing": null }
      ],
      "notes": "Studio chartStingSweep recipe, tuned for chart and data blocks. The 600ms default is the Studio preset engine default; no spec default exists for this extra.",
      "variants": [
        {
          "presetName": "chartStingSweep",
          "kind": "enter",
          "label": "Chart sting: sweep",
          "hint": "Chart sweeps in from the left",
          "tracks": [
            { "property": "wipeRight", "from": 0, "to": 1, "easing": null },
            { "property": "opacity", "from": 0, "to": 1, "easing": null }
          ]
        }
      ]
    }
  ]
} /* REGISTRY-JSON-END */;

/** The shared effect definitions, in registry order. */
export const EFFECTS: readonly EffectDefinition[] = EFFECTS_REGISTRY_BODY.effects;

/** The shared category list, in taxonomy order. */
export const EFFECT_CATEGORIES: readonly EffectCategory[] =
  EFFECTS_REGISTRY_BODY.categories;

/** Look up one effect by its stable id. */
export function getEffect(id: string): EffectDefinition | undefined {
  return EFFECTS.find((effect) => effect.id === id);
}

/** One preset variant paired with its parent effect. */
export interface EffectVariantEntry {
  effect: EffectDefinition;
  variant: EffectVariant;
}

/**
 * Every preset variant in registry order (effects in registry order,
 * variants in authored order). This is the order preset pickers list.
 */
export function listEffectVariants(): EffectVariantEntry[] {
  const out: EffectVariantEntry[] = [];
  for (const effect of EFFECTS) {
    for (const variant of effect.variants) {
      if (variant.presetName !== null) out.push({ effect, variant });
    }
  }
  return out;
}

/** Look up a preset variant by preset name (for example "fadeIn"). */
export function getEffectVariant(presetName: string): EffectVariantEntry | undefined {
  for (const effect of EFFECTS) {
    for (const variant of effect.variants) {
      if (variant.presetName === presetName) return { effect, variant };
    }
  }
  return undefined;
}

/**
 * The picker category for a variant: exits report "exit"; every other
 * variant reports its parent effect's category.
 */
export function effectVariantCategory(entry: EffectVariantEntry): EffectCategory {
  return entry.variant.kind === "exit" ? "exit" : entry.effect.category;
}
