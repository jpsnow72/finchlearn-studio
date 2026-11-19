/**
 * service.ts — the video-tool operations (issues #50 and #66) over
 * the ports in ports.ts. Pure orchestration: load a project through
 * the store, mutate the StudioProject JSON (the shared contract),
 * validate with the schema package, save back. Every failure a
 * caller can act on is a VideoToolError with a plain-language message.
 *
 * The plan gate is NOT here: it runs at the dispatch layer
 * (tools.ts) before any operation executes, mirroring the MCP
 * server's single execution path.
 */
import {
  makeStudioProject,
  makeStudioScene,
  newStudioId,
  validateStudioProject,
  type AssetRef,
  type StudioProject,
} from "@finch-studio/schema";
import { voiceById } from "@finch-studio/audio";
import { invalid, notFound, VideoToolError } from "./errors.js";
import type { CallerContext, ExportRecord, StudioPorts } from "./ports.js";
import { projectTemplateById, sceneTemplateById } from "./templates.js";
import { injectVariables, type TemplateVariables } from "./variables.js";
import { buildRenderRequest, projectDurationMs } from "./renderRequest.js";

export class VideoService {
  constructor(private readonly ports: StudioPorts) {}

  private newId(prefix: string): string {
    return this.ports.newId ? this.ports.newId(prefix) : newStudioId(prefix);
  }

  private nowIso(): string {
    return this.ports.nowIso ? this.ports.nowIso() : new Date().toISOString();
  }

  private async loadProject(ctx: CallerContext, projectId: string): Promise<StudioProject> {
    const project = await this.ports.projects.getProject(ctx, projectId);
    if (!project) throw notFound(`Video project ${projectId}`);
    return project;
  }

  private async saveValidated(ctx: CallerContext, project: StudioProject): Promise<{ updatedAt: string }> {
    const problems = validateStudioProject(project);
    if (problems.length) throw invalid(`The project would be invalid: ${problems.join(" ")}`);
    return this.ports.projects.saveProject(ctx, project);
  }

  // ---------------------------------------------------------------- #50

  async createProject(
    ctx: CallerContext,
    input: { name: string; templateId?: string },
  ): Promise<{ project: StudioProject; updatedAt: string }> {
    if (!input.name?.trim()) throw invalid("A project name is required.");
    let project: StudioProject;
    if (input.templateId) {
      const template = projectTemplateById(input.templateId);
      if (!template) throw invalid(`Unknown template "${input.templateId}".`);
      project = template.build();
      project.id = this.newId("proj");
      project.name = input.name;
    } else {
      project = makeStudioProject(input.name);
      project.id = this.newId("proj");
    }
    const { updatedAt } = await this.saveValidated(ctx, project);
    return { project, updatedAt };
  }

  async listProjects(ctx: CallerContext, input: { limit?: number } = {}) {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
    return { projects: await this.ports.projects.listProjects(ctx, limit) };
  }

  async addSceneFromTemplate(
    ctx: CallerContext,
    input: { projectId: string; templateId: string; position?: number },
  ): Promise<{ projectId: string; sceneId: string; sceneIndex: number; updatedAt: string }> {
    const template = sceneTemplateById(input.templateId);
    if (!template) throw invalid(`Unknown scene template "${input.templateId}".`);
    const project = await this.loadProject(ctx, input.projectId);
    const scene = template.build();
    scene.id = this.newId("scene");
    const at =
      input.position === undefined
        ? project.scenes.length
        : Math.min(Math.max(input.position, 0), project.scenes.length);
    project.scenes.splice(at, 0, scene);
    const { updatedAt } = await this.saveValidated(ctx, project);
    return { projectId: project.id, sceneId: scene.id, sceneIndex: at, updatedAt };
  }

  async setDialogue(
    ctx: CallerContext,
    input: {
      projectId: string;
      sceneId: string;
      lines: { lineId?: string; text: string; voiceId?: string; speakerElementId?: string }[];
    },
  ): Promise<{ projectId: string; sceneId: string; lineIds: string[]; updatedAt: string }> {
    if (!input.lines?.length) throw invalid("At least one dialogue line is required.");
    const project = await this.loadProject(ctx, input.projectId);
    const scene = project.scenes.find((s) => s.id === input.sceneId);
    if (!scene) throw notFound(`Scene ${input.sceneId} in video project ${input.projectId}`);
    const lineIds: string[] = [];
    for (const entry of input.lines) {
      if (!entry.text?.trim()) throw invalid("Dialogue line text must not be empty.");
      if (entry.voiceId && !voiceById(entry.voiceId)) {
        throw invalid(`Unknown voice id "${entry.voiceId}". Use a voice id from the FinchLearn narration catalogue.`);
      }
      if (entry.lineId) {
        const line = scene.dialogue.find((l) => l.id === entry.lineId);
        if (!line) throw notFound(`Dialogue line ${entry.lineId} in scene ${input.sceneId}`);
        line.text = entry.text;
        if (entry.voiceId) line.voiceId = entry.voiceId;
        if (entry.speakerElementId) line.speakerElementId = entry.speakerElementId;
        // New text invalidates audio generated for the old text.
        delete line.audio;
        delete line.wordTimings;
        lineIds.push(line.id);
      } else {
        const line = {
          id: this.newId("line"),
          text: entry.text,
          ...(entry.voiceId ? { voiceId: entry.voiceId } : {}),
          ...(entry.speakerElementId ? { speakerElementId: entry.speakerElementId } : {}),
        };
        scene.dialogue.push(line);
        lineIds.push(line.id);
      }
    }
    const { updatedAt } = await this.saveValidated(ctx, project);
    return { projectId: project.id, sceneId: scene.id, lineIds, updatedAt };
  }

  async generateNarration(
    ctx: CallerContext,
    input: { projectId: string; sceneId?: string; lineId?: string; voiceId?: string },
  ): Promise<{ projectId: string; generated: { lineId: string; durationMs: number }[]; updatedAt: string }> {
    const project = await this.loadProject(ctx, input.projectId);
    const targets: { scene: StudioProject["scenes"][number]; line: StudioProject["scenes"][number]["dialogue"][number] }[] = [];
    for (const scene of project.scenes) {
      if (input.sceneId && scene.id !== input.sceneId) continue;
      for (const line of scene.dialogue) {
        if (input.lineId && line.id !== input.lineId) continue;
        targets.push({ scene, line });
      }
    }
    if (!targets.length) {
      throw notFound(
        input.lineId
          ? `Dialogue line ${input.lineId} in video project ${input.projectId}`
          : `Dialogue lines in video project ${input.projectId}`,
      );
    }
    const generated: { lineId: string; durationMs: number }[] = [];
    for (const { line } of targets) {
      const voiceId = input.voiceId ?? line.voiceId;
      if (!voiceId) {
        throw invalid(
          `Dialogue line "${line.id}" has no voice. Pass voice_id or set one with set_scene_dialogue first.`,
        );
      }
      if (!voiceById(voiceId)) {
        throw invalid(`Unknown voice id "${voiceId}". Use a voice id from the FinchLearn narration catalogue.`);
      }
      const result = await this.ports.narration.generate(ctx, {
        projectId: project.id,
        text: line.text,
        voiceId,
      });
      line.voiceId = voiceId;
      line.audio = result.audio;
      if (result.wordTimings) line.wordTimings = result.wordTimings;
      generated.push({ lineId: line.id, durationMs: result.durationMs });
    }
    const { updatedAt } = await this.saveValidated(ctx, project);
    return { projectId: project.id, generated, updatedAt };
  }

  async addFootageScene(
    ctx: CallerContext,
    input: {
      projectId: string;
      name?: string;
      asset: AssetRef;
      sourceInMs?: number;
      sourceOutMs?: number;
      position?: number;
    },
  ): Promise<{ projectId: string; sceneId: string; sceneIndex: number; updatedAt: string }> {
    if (!input.asset?.r2Key) throw invalid("A footage asset with an r2Key is required.");
    if (input.asset.kind !== "video") throw invalid("A footage scene needs a video asset.");
    const project = await this.loadProject(ctx, input.projectId);
    const sourceInMs = input.sourceInMs ?? 0;
    const sourceOutMs = input.sourceOutMs ?? input.asset.durationMs ?? sourceInMs + 5000;
    if (sourceOutMs <= sourceInMs) throw invalid("sourceOutMs must be after sourceInMs.");
    const scene = makeStudioScene(input.name ?? "Footage");
    scene.id = this.newId("scene");
    scene.durationMs = sourceOutMs - sourceInMs;
    scene.elements.push({
      kind: "footage",
      id: this.newId("el"),
      startMs: 0,
      durationMs: scene.durationMs,
      asset: input.asset,
      sourceInMs,
      sourceOutMs,
      speed: 1,
      volume: 1,
    });
    const at =
      input.position === undefined
        ? project.scenes.length
        : Math.min(Math.max(input.position, 0), project.scenes.length);
    project.scenes.splice(at, 0, scene);
    const { updatedAt } = await this.saveValidated(ctx, project);
    return { projectId: project.id, sceneId: scene.id, sceneIndex: at, updatedAt };
  }

  async exportVideo(
    ctx: CallerContext,
    input: { projectId: string; name?: string; captions?: boolean },
  ): Promise<ExportRecord> {
    const project = await this.loadProject(ctx, input.projectId);
    const request = buildRenderRequest(project, { captions: input.captions });
    const { jobId } = await this.ports.render.submit(ctx, request);
    const now = this.nowIso();
    const record: ExportRecord = {
      id: this.newId("exp"),
      projectId: project.id,
      name: input.name ?? project.name,
      state: "queued",
      renderJobId: jobId,
      durationMs: projectDurationMs(project),
      createdAt: now,
      updatedAt: now,
    };
    await this.ports.exports.createExport(ctx, record);
    return record;
  }

  async getExportStatus(
    ctx: CallerContext,
    input: { exportId: string },
  ): Promise<ExportRecord> {
    const record = await this.ports.exports.getExport(ctx, input.exportId);
    if (!record) throw notFound(`Export ${input.exportId}`);
    if (record.state === "done" || record.state === "error" || !record.renderJobId) return record;
    const status = await this.ports.render.status(ctx, record.renderJobId);
    const state: ExportRecord["state"] = status.state;
    if (state === record.state && (state === "queued" || state === "processing")) return record;
    if (state === "error") {
      const patch: Partial<ExportRecord> = {
        state: "error",
        error: status.error ?? "The server render failed.",
        updatedAt: this.nowIso(),
      };
      await this.ports.exports.updateExport(ctx, record.id, patch);
      return { ...record, ...patch };
    }
    if (state === "done") {
      if (!status.fileBytes) {
        throw new VideoToolError("The render finished but returned no file.", "internal");
      }
      const saved = await this.ports.mediaLibrary.saveExport(ctx, {
        name: record.name,
        bytes: status.fileBytes,
        contentType: status.contentType ?? "video/mp4",
      });
      const patch: Partial<ExportRecord> = {
        state: "done",
        objectKey: saved.objectKey,
        downloadUrl: saved.downloadUrl,
        updatedAt: this.nowIso(),
      };
      await this.ports.exports.updateExport(ctx, record.id, patch);
      return { ...record, ...patch };
    }
    const patch: Partial<ExportRecord> = { state, updatedAt: this.nowIso() };
    await this.ports.exports.updateExport(ctx, record.id, patch);
    return { ...record, ...patch };
  }

  /**
   * SEAM (pending #49/#629): delegates to the EmbedPort. Without a
   * wired adapter this reports unavailable plainly; it never fakes
   * an attach. See ports.ts EmbedPort and MANIFEST.md.
   */
  async embedInCourse(
    ctx: CallerContext,
    input: { exportId: string; courseId: string; moduleId: string; blockId?: string },
  ) {
    const record = await this.ports.exports.getExport(ctx, input.exportId);
    if (!record) throw notFound(`Export ${input.exportId}`);
    if (record.state !== "done") {
      // Fill in from the render service once, so a just-finished
      // render can embed without a separate status call.
      const fresh = await this.getExportStatus(ctx, { exportId: input.exportId });
      if (fresh.state !== "done") {
        throw invalid(
          `Export ${input.exportId} is still ${fresh.state}. Call get_export_status until it is done, then embed. The project is saved and nothing is lost.`,
        );
      }
      return this.embedDone(ctx, fresh, input);
    }
    return this.embedDone(ctx, record, input);
  }

  private async embedDone(
    ctx: CallerContext,
    record: ExportRecord,
    input: { courseId: string; moduleId: string; blockId?: string },
  ) {
    if (!this.ports.embed) {
      throw new VideoToolError(
        "Embedding a video in a course is not available on this server yet. The export is saved to the media library and can be attached from the course editor.",
        "invalid",
      );
    }
    const result = await this.ports.embed.attachToCourseModule(ctx, {
      courseId: input.courseId,
      moduleId: input.moduleId,
      ...(input.blockId ? { blockId: input.blockId } : {}),
      exportRecord: record,
    });
    return { embedded: true, ...result };
  }

  // ---------------------------------------------------------------- #66

  /**
   * One headless flow: clone a template project (or an existing
   * project), inject variables, optionally generate narration for
   * every line, and start a render via the server FFmpeg path. The
   * render is async on finch-render: this returns the export record,
   * get_export_status completes the media-library save when the
   * render finishes, and embed_video_in_course then attaches the
   * finished export to a course module (the #49/#629 seam). One MCP
   * session drives the whole chain with three calls.
   */
  async renderTemplate(
    ctx: CallerContext,
    input: {
      templateId?: string;
      sourceProjectId?: string;
      variables?: TemplateVariables;
      generateNarration?: boolean;
      captions?: boolean;
      exportName?: string;
    },
  ): Promise<{
    project: StudioProject;
    appliedVariables: string[];
    narration: { lineId: string; durationMs: number }[];
    export: ExportRecord;
  }> {
    let project: StudioProject;
    if (input.templateId) {
      const template = projectTemplateById(input.templateId);
      if (!template) throw invalid(`Unknown template "${input.templateId}".`);
      project = template.build();
    } else if (input.sourceProjectId) {
      project = structuredClone(await this.loadProject(ctx, input.sourceProjectId));
    } else {
      throw invalid("render_template needs a template_id or a source_project_id to clone.");
    }
    project.id = this.newId("proj");
    // A clone never carries the source's snapshots or generated audio
    // keyed to old text; fresh ids keep element identity unambiguous.
    delete project.snapshots;

    const { applied } = injectVariables(project, input.variables ?? {});
    await this.saveValidated(ctx, project);

    let narration: { lineId: string; durationMs: number }[] = [];
    if (input.generateNarration) {
      const voiceId = input.variables?.voiceId;
      const result = await this.generateNarration(ctx, {
        projectId: project.id,
        ...(voiceId ? { voiceId } : {}),
      });
      narration = result.generated;
      project = await this.loadProject(ctx, project.id);
    }

    const exportRecord = await this.exportVideo(ctx, {
      projectId: project.id,
      ...(input.exportName ? { name: input.exportName } : {}),
      ...(input.captions !== undefined ? { captions: input.captions } : {}),
    });
    return { project, appliedVariables: applied, narration, export: exportRecord };
  }
}
