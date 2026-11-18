# Extraction note
Extracted 2026-11-18 from jpsnow72/open-course-format, package @ocf/core:
- src/types.ts: verbatim copy (OCF types; the normative types mirror the OCF schema).
- src/animations.ts: verbatim copy (animation presets, path and timeline sampling, character animation data).
- src/index.ts: new slim index exporting the types plus the animation runtime surface that @finch-studio/animation and @finch-studio/editor import. The course level helpers, sanitizer, and validators of @ocf/core did NOT move; course concerns stay in FinchLearn.
Sync rule: OCF type changes that affect video projects flow through @finch-studio/schema's OCF mapping, which is tested round trip. Do not fork the types silently.
