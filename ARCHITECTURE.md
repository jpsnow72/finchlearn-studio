# FinchLearn Studio Architecture

Last updated 2026-11-18 (Phase 0 bootstrap). Source of truth for layout, schema, and state patterns; update this file in the same change that alters any of them.

## Layout
- packages/core (@finch-studio/core): OCF types and animation runtime, extracted verbatim from @ocf/core (types.ts, animations.ts). Pure TypeScript, no React, no DOM. See packages/core/EXTRACTION.md.
- packages/animation (@finch-studio/animation): scene time infra, dialogue scheduling, the TTS provider seam, and the OCF video project model, extracted from @ocf/animation-studio. Character art did NOT move; the CharacterFigure component is the seam for the new rigged characters. See packages/animation/EXTRACTION.md.
- packages/schema (@finch-studio/schema): the Studio project schema v1 (the product's own format), timing math, validation, and the OCF mapping with its sidecar (stored under extensions["x-finch-studio"] when embedded).
- packages/characters (@finch-studio/characters): the rigged character system. One standard skeleton for every character in every style family; actions are keyframed data sampled through the motion engine; expressions and viseme lip sync are face data; style families are art packs over the same parts (A Clean Corporate Flat is the launch family, B Warm Storybook Soft the approved secondary set). RiggedCharacter renders the same SVG on the stage and in exports. The editor maps legacy character ids onto the studio cast until the picker is refreshed; user rigged characters (#74) plug into the same skeleton.
- apps/editor (@finch-studio/editor): the editor app, extracted from @ocf/video-studio. One zustand store; all project mutations go through the store.

## Project schema
One versioned JSON document per project (schema.ts): scenes with timed elements (footage, character, image, text, chart, shape, audio), dialogue lines with voice bindings and reserved word timings, global music, caption tracks, cue markers (OCF knowledge checks and branching), snapshots for non-destructive versioning. Assets are R2 keys only, never bytes and never viewer identity.

Scene and object effects are named presets in the shared animation engine. The Studio schema mirrors these presets, which expand to timeline tracks at render time. The editor exposes preset, delay, and duration controls only.

## State patterns
- The editor store owns the open project; components never mutate project JSON directly.
- Undo is one stack across scene and timeline edits.
- Scene duration derives from the longest timed element, narration, or character movement, with a half-second minimum. Untimed scenes default to five seconds and retain shorter durations after ripple deletion.

## Rendering
Preview in the browser on proxy media. Two export paths, both held to 1:1 parity with the stage canvas (golden frame tests): client WebCodecs plus Mediabunny as the default for standard timelines, and server FFmpeg workers for heavy footage, unsupported codecs, and headless MCP renders. Server renders are split by scene with segment caching.

## Accessibility (Section 508, issue #63)
The export dialog runs a pre-flight pass (apps/editor/src/accessibility.ts) over the project before export: text contrast against its effective background (scene background, or the topmost shape under the text), minimum font size, and flash rate from authored opacity animations (WCAG 2.3.1, more than three flashes in any second). Findings are grouped per scene with a jump to scene action; the pass reports and never blocks an export by itself. Audio clips carry an engine role in their x-finch-studio metadata (role, plus descriptionText for the Audio Description script). The description role in @finch-studio/audio auto-ducks primary audio in a mixed export, or exports as a secondary WAV audio track plus a timed VTT track alongside captions (planAudioExport in packages/audio is the shared planning layer for both render paths).

## Media
All media lives in Cloudflare R2 behind the key checked media worker: Finch Stock, Unsplash (via the worker proxy, attribution stamped), and the user media library. Ingest generates a 720p proxy, waveform peaks, and a thumbnail strip. Audio peak arrays and edit metadata use the `x-finch-studio` object extension; peak values are normalized numbers, not media bytes. Browser screen and webcam recordings (packages/media recording core, Record tab in the media panel) enter through the same ingest path as user source video assets and land in a scene as normal footage objects.

## Surfaces and integration
- studio.finchlearn.com: signed out visitors get the landing page, signed in users get the studio hub at the root with no redirect flash; auth is shared across .finchlearn.com (Supabase).
- Embedded mode: a signed handoff from FinchLearn opens the editor directly in a popup; Save & Return binds the saved library asset into the course video block. The handoff/return contract is pinned in docs/embed-contract.md and implemented in apps/editor/src/embed.ts (verification fails closed; Finish posts the return payload to the handoff's return origin and persists it under the local return key; a render still running returns a rendering payload first and a ready payload when the render lands).
- MCP: the FinchLearn MCP server gains video tools over this same project JSON, Keeper and up.

## Design gates (standing)
- Character look and rig: design first (issue #16). APPROVED by Justin Nov 18, 2026: Direction A is the launch family, Direction B the secondary set; the gate is lifted and recorded on #16.
- Round 3 holds: AI avatars, voice cloning, generative clips, real time co-editing, generative script to video stay held until Justin releases them.
- UI follows the FinchLearn editor rail and drawer pattern; theme tokens only, no freelance styling. No em dashes in public copy.

## CI
GitHub Actions fast path on push and PR: install, typecheck, build, unit tests (which include the schema round trip tests). Heavy render and WebCodecs golden frame suites are separate workflows run nightly and on demand, mirroring the repo's finch-gate two tier gate model.
