# FinchLearn Studio

A scene first video editor: Vyond style ease (scenes, characters, templates, AI voices) plus the Premiere basics that matter for training and business video (footage trimming, audio mixing, captions), in one simple tool. Standalone at studio.finchlearn.com and embedded inside FinchLearn courses.

## Layout
- packages/core: OCF type and animation foundation (extracted from @ocf/core).
- packages/animation: scene clock, dialogue, TTS seam, video project machinery (extracted from @ocf/animation-studio). Character art is NOT here; see the design gate note in ARCHITECTURE.md.
- packages/schema: the Studio project schema v1, timing math, validation, and the OCF mapping.
- apps/editor: the Studio editor app (extracted from @ocf/video-studio).

## Develop
npm install, then npm run typecheck, npm test, npm run build at the root.

## Gates
Daytime fast path: typecheck plus build plus schema round trip tests. Heavy render and WebCodecs golden frame tests run nightly. See ARCHITECTURE.md.
