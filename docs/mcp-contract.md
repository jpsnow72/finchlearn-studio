# MCP contract (issue #10, as implemented by #50 and #66)

The Phase 0 design contract, carried into code by packages/mcp-video.
The FinchLearn MCP server (jpsnow72/open-course-format,
packages/mcp-server, live at https://mcp.finchlearn.com/mcp) gains
video tools over the Studio project JSON. The same project JSON is
the contract for the Studio UI, the embed handoff (#49/#629), and MCP.

## Tools

| Tool | Purpose |
| --- | --- |
| create_video_project | Create a project, optionally from a project template |
| list_video_projects | List the caller's projects, newest first |
| add_scene_from_template | Append or insert a scene built from a scene template |
| set_scene_dialogue | Replace or append dialogue lines on one scene |
| generate_scene_narration | Generate TTS audio for lines via the production narration stack |
| add_footage_scene | Add a scene playing a media-library footage asset, trimmed |
| export_video | Start a server render (finch-render FFmpeg path) |
| get_export_status | Poll an export; completion saves the MP4 to the media library |
| embed_video_in_course | Attach a finished export to a course module video block (#49/#629 seam) |
| render_template | #66: clone a template, inject variables, narrate, and render in one flow |

## Gate

Execution only, Keeper ($99/yr) and up, fail closed, denials never
cached, allowances cached per user for 60 seconds. Connect, tools/list,
resources, prompts, and get_capabilities stay open to any signed-in
user; get_capabilities self-describes the requirement and reports the
caller's own plan state. The plan source is the product's own
effective_plan_level() resolver, the same one the course tools use.
There is no separate video plan and no read carve-out. Full semantics:
packages/mcp-video/src/planGate.ts.

## Data surfaces

- Projects: Supabase studio_projects (RLS owner-only), the table the
  editor's cloud save syncs. The editor stores its VideoProject JSON
  there; the MCP adapter converts with packages/schema's ocfToStudio
  and studioToOCF so the tools always work on StudioProject.
- Exports: studio_exports rows plus the finch-media Worker grant flow
  (POST /v1/studio/exports, presigned R2 PUT, keys s/{userId}/...).
- Narration: the production stack (Kokoro basic via the finch-narration
  Worker, Google premium via the ai-generate edge function), voices
  validated against the @finch-studio/audio catalogue.
- Render: finch-render (render.finchlearn.com), POST /jobs with
  {project, width, height, captions}, poll GET /jobs/:id, fetch the
  file on done. Headless MCP renders always take the server path.

## Issue #66 variables

render_template accepts: project_name; script_lines (dialogue text by
line id) or script (ordered {scene_index, line_index, text}); voice_id
(TTS voice for every line); brand_kit_id (stamps brandKitRef);
chart_csv (CSV by chart element id, or by scene id for its first
chart, validated for shape); localized_text (replacement text by line
or text element id) with locale (records a caption track for it).
Unknown ids are errors, never silent no-ops. Replacing dialogue text
discards audio generated for the old text.

## Embed seam

embed_video_in_course takes the #49/#629 handoff return payload:
asset id, MP4 URL, poster, duration, caption files, and the Studio
project id for edit-again. Until the #49/#629 lanes land and the
EmbedPort adapter is wired, the tool reports plainly that embedding
is not available yet; the export remains saved in the media library.
