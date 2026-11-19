/**
 * tools.ts — the MCP tool surface for Studio video (issues #50 and
 * #66), shaped exactly like the FinchLearn MCP server's tool files
 * (packages/mcp-server/src/tools in the OCF repo): a name, a plain
 * description, a JSON Schema inputSchema for tools/list, a validator,
 * and a handler. The Studio repo carries no Zod dependency, so
 * validation here is a small structural checker producing the same
 * invalid_arguments error text the server registry produces; when
 * this module is ported into packages/mcp-server (see MANIFEST.md),
 * each `validate` becomes the tool's Zod schema with no shape change.
 *
 * Dispatch (dispatchVideoTool) mirrors the server's single execution
 * path in tools/index.ts there:
 * 1. unknown tool -> unknown_tool error listing the surface;
 * 2. PLAN GATE on execution only, before anything else, so no result
 *    can cross a plan boundary; get_capabilities is exempt and is
 *    served by the server, not here;
 * 3. argument validation -> invalid_arguments;
 * 4. the handler; VideoToolError codes pass through, anything else
 *    collapses to a generic internal error (never a stack trace).
 *
 * Tool names are the Phase 0 contract names from PLAN.md section 7.5,
 * plus render_template for issue #66.
 */
import { VideoToolError } from "./errors.js";
import { PLAN_GATE_EXEMPT_TOOLS, PlanGate } from "./planGate.js";
import type { CallerContext } from "./ports.js";
import { VideoService } from "./service.js";
import { PROJECT_TEMPLATES, SCENE_TEMPLATES } from "./templates.js";

export interface VideoToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  validate: (args: Record<string, unknown>) => Record<string, unknown>;
  handler: (service: VideoService, ctx: CallerContext, args: never) => Promise<unknown>;
}

function obj(props: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return { type: "object", properties: props, ...(required.length ? { required } : {}) };
}

function check(
  tool: string,
  args: Record<string, unknown>,
  spec: Record<string, "string" | "number" | "boolean" | "object" | "array" | "string[]">,
  required: string[] = [],
): Record<string, unknown> {
  const problems: string[] = [];
  for (const key of required) {
    if (args[key] === undefined || args[key] === null || args[key] === "") {
      problems.push(`${key}: is required`);
    }
  }
  for (const [key, kind] of Object.entries(spec)) {
    const value = args[key];
    if (value === undefined) continue;
    const ok =
      kind === "string"
        ? typeof value === "string"
        : kind === "number"
          ? typeof value === "number" && Number.isFinite(value)
          : kind === "boolean"
            ? typeof value === "boolean"
            : kind === "array"
              ? Array.isArray(value)
              : kind === "string[]"
                ? Array.isArray(value) && value.every((v) => typeof v === "string")
                : typeof value === "object" && value !== null && !Array.isArray(value);
    if (!ok) problems.push(`${key}: must be a ${kind}`);
  }
  if (problems.length) {
    throw new VideoToolError(`Invalid arguments for ${tool}: ${problems.join("; ")}`, "invalid");
  }
  return args;
}

const str = { type: "string" } as const;

export const VIDEO_TOOLS: VideoToolDef[] = [
  {
    name: "create_video_project",
    description:
      "Create a Studio video project for the signed-in user, optionally starting from a template. Returns the full project JSON (the shared contract the Studio UI and these tools both use).",
    inputSchema: obj({ name: str, template_id: str }, ["name"]),
    validate: (a) => check("create_video_project", a, { name: "string", template_id: "string" }, ["name"]),
    handler: async (svc, ctx, args: { name: string; template_id?: string }) =>
      svc.createProject(ctx, { name: args.name, ...(args.template_id ? { templateId: args.template_id } : {}) }),
  },
  {
    name: "list_video_projects",
    description: "List the signed-in user's Studio video projects, newest first, with scene counts.",
    inputSchema: obj({ limit: { type: "integer", minimum: 1, maximum: 50, default: 20 } }),
    validate: (a) => check("list_video_projects", a, { limit: "number" }),
    handler: async (svc, ctx, args: { limit?: number }) =>
      svc.listProjects(ctx, { ...(args.limit ? { limit: args.limit } : {}) }),
  },
  {
    name: "add_scene_from_template",
    description:
      "Add a scene built from a scene template (host intro, host point, title card, chart scene) to a video project, at an optional position. Returns the new scene id and index.",
    inputSchema: obj({ project_id: str, template_id: str, position: { type: "integer", minimum: 0 } }, ["project_id", "template_id"]),
    validate: (a) =>
      check("add_scene_from_template", a, { project_id: "string", template_id: "string", position: "number" }, ["project_id", "template_id"]),
    handler: async (svc, ctx, args: { project_id: string; template_id: string; position?: number }) =>
      svc.addSceneFromTemplate(ctx, {
        projectId: args.project_id,
        templateId: args.template_id,
        ...(args.position !== undefined ? { position: args.position } : {}),
      }),
  },
  {
    name: "set_scene_dialogue",
    description:
      "Set the dialogue lines of one scene: pass line_id to replace a line's text (its generated audio is discarded), or omit line_id to append a new line. voice_id is a FinchLearn narration catalogue id.",
    inputSchema: obj(
      {
        project_id: str,
        scene_id: str,
        lines: {
          type: "array",
          items: obj({ line_id: str, text: str, voice_id: str, speaker_element_id: str }, ["text"]),
        },
      },
      ["project_id", "scene_id", "lines"],
    ),
    validate: (a) =>
      check("set_scene_dialogue", a, { project_id: "string", scene_id: "string", lines: "array" }, ["project_id", "scene_id", "lines"]),
    handler: async (svc, ctx, args: { project_id: string; scene_id: string; lines: { line_id?: string; text: string; voice_id?: string; speaker_element_id?: string }[] }) =>
      svc.setDialogue(ctx, {
        projectId: args.project_id,
        sceneId: args.scene_id,
        lines: args.lines.map((l) => ({
          text: l.text,
          ...(l.line_id ? { lineId: l.line_id } : {}),
          ...(l.voice_id ? { voiceId: l.voice_id } : {}),
          ...(l.speaker_element_id ? { speakerElementId: l.speaker_element_id } : {}),
        })),
      }),
  },
  {
    name: "generate_scene_narration",
    description:
      "Generate TTS narration audio for dialogue lines using the production narration stack, and store the audio on the lines. Scope with scene_id and line_id, or generate every line in the project. Lines need a voice (voice_id here, or one set earlier).",
    inputSchema: obj({ project_id: str, scene_id: str, line_id: str, voice_id: str }, ["project_id"]),
    validate: (a) =>
      check("generate_scene_narration", a, { project_id: "string", scene_id: "string", line_id: "string", voice_id: "string" }, ["project_id"]),
    handler: async (svc, ctx, args: { project_id: string; scene_id?: string; line_id?: string; voice_id?: string }) =>
      svc.generateNarration(ctx, {
        projectId: args.project_id,
        ...(args.scene_id ? { sceneId: args.scene_id } : {}),
        ...(args.line_id ? { lineId: args.line_id } : {}),
        ...(args.voice_id ? { voiceId: args.voice_id } : {}),
      }),
  },
  {
    name: "add_footage_scene",
    description:
      "Add a scene that plays a footage asset from the user's media library (an R2 key), trimmed with source_in_ms and source_out_ms. The scene lasts exactly the trim length.",
    inputSchema: obj(
      {
        project_id: str,
        name: str,
        asset: obj({ r2Key: str, kind: str, durationMs: { type: "number" } }, ["r2Key", "kind"]),
        source_in_ms: { type: "number", minimum: 0 },
        source_out_ms: { type: "number", minimum: 0 },
        position: { type: "integer", minimum: 0 },
      },
      ["project_id", "asset"],
    ),
    validate: (a) =>
      check(
        "add_footage_scene",
        a,
        { project_id: "string", name: "string", asset: "object", source_in_ms: "number", source_out_ms: "number", position: "number" },
        ["project_id", "asset"],
      ),
    handler: async (svc, ctx, args: { project_id: string; name?: string; asset: { r2Key: string; kind: "video"; durationMs?: number }; source_in_ms?: number; source_out_ms?: number; position?: number }) =>
      svc.addFootageScene(ctx, {
        projectId: args.project_id,
        asset: args.asset,
        ...(args.name ? { name: args.name } : {}),
        ...(args.source_in_ms !== undefined ? { sourceInMs: args.source_in_ms } : {}),
        ...(args.source_out_ms !== undefined ? { sourceOutMs: args.source_out_ms } : {}),
        ...(args.position !== undefined ? { position: args.position } : {}),
      }),
  },
  {
    name: "export_video",
    description:
      "Start a server render of a video project (finch-render, the FFmpeg path used for headless renders). Returns an export record with state queued; poll get_export_status until it is done, when the MP4 is saved to the user's media library.",
    inputSchema: obj({ project_id: str, name: str, captions: { type: "boolean" } }, ["project_id"]),
    validate: (a) =>
      check("export_video", a, { project_id: "string", name: "string", captions: "boolean" }, ["project_id"]),
    handler: async (svc, ctx, args: { project_id: string; name?: string; captions?: boolean }) =>
      svc.exportVideo(ctx, {
        projectId: args.project_id,
        ...(args.name ? { name: args.name } : {}),
        ...(args.captions !== undefined ? { captions: args.captions } : {}),
      }),
  },
  {
    name: "get_export_status",
    description:
      "Read an export's state (queued, processing, done, error). When a render finishes, this call saves the MP4 to the user's media library and the record gains object_key and download_url.",
    inputSchema: obj({ export_id: str }, ["export_id"]),
    validate: (a) => check("get_export_status", a, { export_id: "string" }, ["export_id"]),
    handler: async (svc, ctx, args: { export_id: string }) => svc.getExportStatus(ctx, { exportId: args.export_id }),
  },
  {
    name: "embed_video_in_course",
    description:
      "Attach a finished export to a course module's video block (the #49/#629 handoff). The course references the rendered R2 asset, so it plays signed in or out. If the render is still running, the error says so and the project is safe; poll get_export_status and retry.",
    inputSchema: obj({ export_id: str, course_id: str, module_id: str, block_id: str }, ["export_id", "course_id", "module_id"]),
    validate: (a) =>
      check("embed_video_in_course", a, { export_id: "string", course_id: "string", module_id: "string", block_id: "string" }, ["export_id", "course_id", "module_id"]),
    handler: async (svc, ctx, args: { export_id: string; course_id: string; module_id: string; block_id?: string }) =>
      svc.embedInCourse(ctx, {
        exportId: args.export_id,
        courseId: args.course_id,
        moduleId: args.module_id,
        ...(args.block_id ? { blockId: args.block_id } : {}),
      }),
  },
  {
    name: "render_template",
    description:
      "Issue #66 in one call: clone a template project (template_id) or an existing project (source_project_id), inject variables (script lines, TTS voice, brand kit id, chart CSV data, localized text), optionally generate narration for every line, and start the server render. Returns the cloned project and the export record; poll get_export_status for the library-saved MP4, then embed_video_in_course to attach it.",
    inputSchema: obj(
      {
        template_id: str,
        source_project_id: str,
        variables: obj({
          project_name: str,
          script_lines: { type: "object", additionalProperties: str },
          script: { type: "array", items: obj({ scene_index: { type: "integer" }, line_index: { type: "integer" }, text: str }, ["text"]) },
          voice_id: str,
          brand_kit_id: str,
          chart_csv: { type: "object", additionalProperties: str },
          localized_text: { type: "object", additionalProperties: str },
          locale: str,
        }),
        generate_narration: { type: "boolean" },
        captions: { type: "boolean" },
        export_name: str,
      },
      [],
    ),
    validate: (a) =>
      check(
        "render_template",
        a,
        { template_id: "string", source_project_id: "string", variables: "object", generate_narration: "boolean", captions: "boolean", export_name: "string" },
        [],
      ),
    handler: async (svc, ctx, args: {
      template_id?: string;
      source_project_id?: string;
      variables?: {
        project_name?: string;
        script_lines?: Record<string, string>;
        script?: { scene_index?: number; line_index?: number; text: string }[];
        voice_id?: string;
        brand_kit_id?: string;
        chart_csv?: Record<string, string>;
        localized_text?: Record<string, string>;
        locale?: string;
      };
      generate_narration?: boolean;
      captions?: boolean;
      export_name?: string;
    }) => {
      const v = args.variables ?? {};
      return svc.renderTemplate(ctx, {
        ...(args.template_id ? { templateId: args.template_id } : {}),
        ...(args.source_project_id ? { sourceProjectId: args.source_project_id } : {}),
        variables: {
          ...(v.project_name !== undefined ? { projectName: v.project_name } : {}),
          ...(v.script_lines ? { scriptLines: v.script_lines } : {}),
          ...(v.script
            ? {
                script: v.script.map((s) => ({
                  text: s.text,
                  ...(s.scene_index !== undefined ? { sceneIndex: s.scene_index } : {}),
                  ...(s.line_index !== undefined ? { lineIndex: s.line_index } : {}),
                })),
              }
            : {}),
          ...(v.voice_id ? { voiceId: v.voice_id } : {}),
          ...(v.brand_kit_id ? { brandKitId: v.brand_kit_id } : {}),
          ...(v.chart_csv ? { chartCsv: v.chart_csv } : {}),
          ...(v.localized_text ? { localizedText: v.localized_text } : {}),
          ...(v.locale ? { locale: v.locale } : {}),
        },
        ...(args.generate_narration !== undefined ? { generateNarration: args.generate_narration } : {}),
        ...(args.captions !== undefined ? { captions: args.captions } : {}),
        ...(args.export_name ? { exportName: args.export_name } : {}),
      });
    },
  },
];

/** Descriptors for ListToolsRequestSchema. Listing is never gated. */
export function registerVideoTools(): { name: string; description: string; inputSchema: Record<string, unknown> }[] {
  return VIDEO_TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
}

/** The video block the server's get_capabilities payload gains. */
export function videoCapabilities(): Record<string, unknown> {
  return {
    video: {
      note:
        "Studio video tools operate on the Studio project JSON, the same contract the Studio UI, the embed handoff, and these tools share (issue #10). Projects live in studio_projects, exports render on the server FFmpeg path (finch-render) and save to the user's media library.",
      project_templates: PROJECT_TEMPLATES.map((t) => ({ id: t.id, name: t.name, blurb: t.blurb })),
      scene_templates: SCENE_TEMPLATES.map((t) => ({ id: t.id, name: t.name, blurb: t.blurb })),
      headless_flow:
        "render_template clones and injects in one call; export_video and render_template are async (poll get_export_status); a done export carries its media library object_key and download_url; embed_video_in_course attaches it to a course module.",
    },
  };
}

export type VideoDispatchResult =
  | { ok: true; result: unknown }
  | { ok: false; error: string; message: string };

/**
 * The gated execution path for video tools. Mirrors the server's
 * handleToolExecution ordering: resolve the tool, run the plan gate
 * (execution only, before validation), validate, run, and convert
 * errors to clean codes. The server adapter wraps this into its
 * CallToolResult shape.
 */
export async function dispatchVideoTool(
  deps: { service: VideoService; planGate: PlanGate },
  name: string,
  args: unknown,
  ctx: CallerContext,
): Promise<VideoDispatchResult> {
  const tool = VIDEO_TOOLS.find((t) => t.name === name);
  if (!tool) {
    return {
      ok: false,
      error: "unknown_tool",
      message: `Unknown tool: ${name}. Available tools: ${VIDEO_TOOLS.map((t) => t.name).join(", ")}.`,
    };
  }
  if (!PLAN_GATE_EXEMPT_TOOLS.has(name)) {
    const verdict = await deps.planGate.check(ctx.userId, name);
    if (!verdict.allowed) {
      return { ok: false, error: "plan_required", message: verdict.message ?? "This tool requires a paid plan." };
    }
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = tool.validate((args ?? {}) as Record<string, unknown>);
  } catch (err) {
    if (err instanceof VideoToolError) return { ok: false, error: err.code, message: err.message };
    return { ok: false, error: "invalid_arguments", message: `Invalid arguments for ${name}.` };
  }
  try {
    const result = await tool.handler(deps.service, ctx, parsed as never);
    return { ok: true, result };
  } catch (err) {
    if (err instanceof VideoToolError) return { ok: false, error: err.code, message: err.message };
    return { ok: false, error: "internal", message: `Internal error while running ${name}.` };
  }
}
