# Render spike decision (issue #8)

Decision, Nov 18, 2026, from the Phase 0 spike work and the research in the approved plan:

One shared scene renderer feeds every surface. The browser stage canvas is the reference renderer. Client export (WebCodecs plus Mediabunny, issue #48, promoted ahead of the server pipeline) draws the same scene graph frame by frame; the server FFmpeg pipeline (issue #33) renders the same graph headlessly per scene segment with segment caching.

Why this shape:
- Parity is the exit criterion, not a hope: golden frame tests sample timestamps across a project, render through each path, and compare against stage frames with the parity metric in packages/render (tight per channel tolerance, near zero drift fraction). Text wrapping, fonts, and easing live in the shared renderer, so they cannot drift between paths.
- Client first because standard timelines then cost zero server compute, and the editor already has the renderer. Server is reserved for heavy multi track footage, unsupported codecs or browsers, and headless MCP batch renders.
- ffmpeg.wasm is rejected as a primary path (software only, large download, memory ceiling). Remotion is source available, not open source, and its licence does not fit; Shotstack is a per minute cost we do not need.

Status: the segment planner, path choice rule, and parity metric are built and tested in packages/render. The WebCodecs muxer and the FFmpeg worker land under #48 and #33 against this contract.
