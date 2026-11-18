# FinchLearn Studio Architecture

Last updated 2026-11-18 (Phase 0 bootstrap). Source of truth for layout, schema, and state patterns; update this file in the same change that alters any of them.

## Layout
- packages/core (@finch-studio/core): OCF types and animation runtime, extracted verbatim from @ocf/core (types.ts, animations.ts). Pure TypeScript, no React, no DOM. See packages/core/EXTRACTION.md.
- packages/animation (@finch-studio/animation): scene time infra, dialogue scheduling, the TTS provider seam, and the OCF video project model, extracted from @ocf/animation-studio. Character art did NOT move; the CharacterFigure component is the seam for the new rigged characters. See packages/animation/EXTRACTION.md.
- packages/schema (@finch-studio/schema): the Studio project schema v1 (the product's own format), timing math, validation, and the OCF mapping with its sidecar (stored under extensions["x-finch-studio"] when embedded).
- apps/editor (@finch-studio/editor): the editor app, extracted from @ocf/video-studio. One zustand store; all project mutations go through the store.

## Project schema
One versioned JSON document per project (schema.ts): scenes with timed elements (footage, character, image, text, chart, shape, audio), dialogue lines with voice bindings and reserved word timings, global music, caption tracks, cue markers (OCF knowledge checks and branching), snapshots for non-destructive versioning. Assets are R2 keys only, never bytes and never viewer identity.

## State patterns
- The editor store owns the open project; components never mutate project JSON directly.
- Undo is one stack across scene and timeline edits.
- Scene duration derives from the longest timed element, narration, or character movement, with a five-second minimum for untimed scenes.

## Rendering
Preview in the browser on proxy media. Two export paths, both held to 1:1 parity with the stage canvas (golden frame tests): client WebCodecs plus Mediabunny as the default for standard timelines, and server FFmpeg workers for heavy footage, unsupported codecs, and headless MCP renders. Server renders are split by scene with segment caching.

## Media
All media lives in Cloudflare R2 behind the key checked media worker: Finch Stock, Unsplash (via the worker proxy, attribution stamped), and the user media library. Ingest generates a 720p proxy, waveform peaks, and a thumbnail strip.

## Surfaces and integration
- studio.finchlearn.com: signed out visitors get the landing page, signed in users get the studio hub at the root with no redirect flash; auth is shared across .finchlearn.com (Supabase).
- Embedded mode: a signed handoff from FinchLearn opens the editor directly in a popup; Save & Return binds the saved library asset into the course video block.
- MCP: the FinchLearn MCP server gains video tools over this same project JSON, Keeper and up.

## Design gates (standing)
- Character look and rig: design first (issue #16, design:figma). No character art or rig code until Justin approves the design package.
- Round 3 holds: AI avatars, voice cloning, generative clips, real time co-editing, generative script to video stay held until Justin releases them.
- UI follows the FinchLearn editor rail and drawer pattern; theme tokens only, no freelance styling. No em dashes in public copy.

## CI
GitHub Actions fast path on push and PR: install, typecheck, build, unit tests (which include the schema round trip tests). Heavy render and WebCodecs golden frame suites are separate workflows run nightly and on demand, mirroring the repo's finch-gate two tier gate model.
