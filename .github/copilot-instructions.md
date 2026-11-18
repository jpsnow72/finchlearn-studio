# Copilot instructions, FinchLearn Studio

- Follow ARCHITECTURE.md first. Packages never import from apps. All project mutations go through the editor store.
- Theme tokens and shared systems only for UI. No hard coded colours or freelance styling. The editor rail and drawer match the FinchLearn editor pattern.
- No em dashes in public facing copy, ever. Plain, direct, short sentences.
- Schema discipline: the Studio project schema lives in packages/schema; OCF types live in packages/core and mirror the OCF schema. Changes to either need round trip tests in the same PR.
- Character work is design gated: do not create character art or rig code. Issue #16 is design only until Justin approves the package.
- Round 3 holds: no AI avatars, voice cloning, generative video clips, real time co-editing, or generative script to video.
- Gate contract: typecheck, build, and tests must pass. Render touching changes also need the golden frame parity suite.
- Media: assets are R2 keys. Never embed media bytes in project JSON. Never key media access off a viewer's identity.
