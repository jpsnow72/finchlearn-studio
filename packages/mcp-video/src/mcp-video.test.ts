/**
 * mcp-video tests (issues #50 and #66): the Keeper gate semantics,
 * each tool's happy path against mocked Studio seams, and the #66
 * variable injection + render-request shape. Fakes implement the
 * ports in ports.ts; no network, no Supabase, no render service.
 */
import { describe, expect, it } from "vitest";
import type { StudioProject } from "@finch-studio/schema";
import { PlanGate, planAllowsMcp } from "./planGate.js";
import type { CallerContext, ExportRecord, StudioPorts } from "./ports.js";
import { VideoService } from "./service.js";
import { dispatchVideoTool, registerVideoTools, VIDEO_TOOLS } from "./tools.js";
import { injectVariables, validateChartCsv } from "./variables.js";
import { buildRenderRequest } from "./renderRequest.js";
import { projectTemplateById } from "./templates.js";

const CTX: CallerContext = { userId: "user-1", email: "user@example.com" };
const KEEPER_GATE = new PlanGate({ resolvePlan: async () => "keeper" });

function makePorts(overrides: Partial<StudioPorts> = {}): {
  ports: StudioPorts;
  projects: Map<string, StudioProject>;
  exports: Map<string, ExportRecord>;
  renderJobs: Map<string, { state: string }>;
  savedToLibrary: { name: string; bytes: Uint8Array }[];
  narrationCalls: { text: string; voiceId: string }[];
} {
  const projects = new Map<string, StudioProject>();
  const exports = new Map<string, ExportRecord>();
  const renderJobs = new Map<string, { state: string }>();
  const savedToLibrary: { name: string; bytes: Uint8Array }[] = [];
  const narrationCalls: { text: string; voiceId: string }[] = [];
  let seq = 0;
  const ports: StudioPorts = {
    newId: (prefix) => `${prefix}-test-${++seq}`,
    nowIso: () => "2026-11-19T12:00:00.000Z",
    projects: {
      listProjects: async (_ctx, limit) =>
        [...projects.values()].slice(0, limit).map((p) => ({
          id: p.id,
          name: p.name,
          updatedAt: "2026-11-19T12:00:00.000Z",
          sceneCount: p.scenes.length,
        })),
      getProject: async (_ctx, id) => {
        const p = projects.get(id);
        return p ? structuredClone(p) : null;
      },
      saveProject: async (_ctx, project) => {
        projects.set(project.id, structuredClone(project));
        return { updatedAt: "2026-11-19T12:00:00.000Z" };
      },
    },
    exports: {
      createExport: async (_ctx, record) => {
        exports.set(record.id, structuredClone(record));
      },
      getExport: async (_ctx, id) => {
        const r = exports.get(id);
        return r ? structuredClone(r) : null;
      },
      updateExport: async (_ctx, id, patch) => {
        const r = exports.get(id);
        if (r) exports.set(id, { ...r, ...patch });
      },
    },
    narration: {
      generate: async (_ctx, input) => {
        narrationCalls.push({ text: input.text, voiceId: input.voiceId });
        return {
          audio: { r2Key: `s/user-1/${input.projectId}/line.mp3`, kind: "audio" },
          durationMs: 2400,
        };
      },
    },
    render: {
      submit: async () => {
        const jobId = `job-${++seq}`;
        renderJobs.set(jobId, { state: "queued" });
        return { jobId };
      },
      status: async (_ctx, jobId) => {
        const job = renderJobs.get(jobId);
        if (!job) return { state: "error" as const, error: "no such job" };
        if (job.state === "done") {
          return { state: "done" as const, fileBytes: new Uint8Array([1, 2, 3]), contentType: "video/mp4" };
        }
        return { state: job.state as "queued" | "processing" };
      },
    },
    mediaLibrary: {
      saveExport: async (_ctx, input) => {
        savedToLibrary.push({ name: input.name, bytes: input.bytes });
        return { objectKey: `s/user-1/${input.name}.mp4`, downloadUrl: "https://example.test/dl" };
      },
    },
    ...overrides,
  };
  return { ports, projects, exports, renderJobs, savedToLibrary, narrationCalls };
}

describe("plan gate (mirrors the FinchLearn MCP server gate)", () => {
  it("allows Keeper and every plan above it, denies Community", () => {
    expect(planAllowsMcp("keeper")).toBe(true);
    expect(planAllowsMcp("creator")).toBe(true);
    expect(planAllowsMcp("studio")).toBe(true);
    expect(planAllowsMcp("enterprise")).toBe(true);
    expect(planAllowsMcp("community")).toBe(false);
  });

  it("fails closed when the plan cannot be confirmed", async () => {
    const gate = new PlanGate({ resolvePlan: async () => null });
    const verdict = await gate.check("u1", "export_video");
    expect(verdict.allowed).toBe(false);
    expect(verdict.plan).toBeNull();
    expect(verdict.message).toContain("could not confirm");
    const throwing = new PlanGate({
      resolvePlan: async () => {
        throw new Error("offline");
      },
    });
    expect((await throwing.check("u1", "export_video")).allowed).toBe(false);
  });

  it("never caches a denial: an upgrade unlocks on the next call", async () => {
    let plan: "community" | "keeper" = "community";
    let resolutions = 0;
    const gate = new PlanGate({
      resolvePlan: async () => {
        resolutions += 1;
        return plan;
      },
    });
    expect((await gate.check("u1", "export_video")).allowed).toBe(false);
    expect((await gate.check("u1", "export_video")).allowed).toBe(false);
    expect(resolutions).toBe(2); // both denials re-resolved
    plan = "keeper";
    expect((await gate.check("u1", "export_video")).allowed).toBe(true);
    expect(resolutions).toBe(3);
  });

  it("caches an allowance briefly per user", async () => {
    let resolutions = 0;
    const gate = new PlanGate({
      resolvePlan: async () => {
        resolutions += 1;
        return "studio" as const;
      },
    });
    await gate.check("u1", "export_video");
    await gate.check("u1", "list_video_projects");
    expect(resolutions).toBe(1);
    await gate.check("u2", "export_video");
    expect(resolutions).toBe(2); // cache is per user
  });

  it("capabilities summary self-describes the requirement and the caller's state", async () => {
    const gate = new PlanGate({ resolvePlan: async () => "community" });
    const summary = await gate.accessSummary("u1");
    expect(summary.tools_unlocked).toBe(false);
    expect(summary.caller_plan).toBe("community");
    expect(String(summary.requirement)).toContain("Keeper ($99/yr)");
  });

  it("dispatch denies a sub-Keeper caller with plan_required before touching the service", async () => {
    const { ports, projects } = makePorts();
    const gate = new PlanGate({ resolvePlan: async () => "community" });
    const result = await dispatchVideoTool(
      { service: new VideoService(ports), planGate: gate },
      "create_video_project",
      { name: "Nope" },
      CTX,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("plan_required");
      expect(result.message).toContain("Community");
      expect(result.message).not.toContain("—"); // no em dashes
    }
    expect(projects.size).toBe(0);
  });

  it("listing the tools is not gated (registerVideoTools is a pure read)", () => {
    const listed = registerVideoTools();
    expect(listed.map((t) => t.name)).toEqual(VIDEO_TOOLS.map((t) => t.name));
    expect(listed.some((t) => t.name === "render_template")).toBe(true);
  });
});

describe("video tools happy paths (mocked Studio seams)", () => {
  it("creates, lists, and grows a project scene by scene", async () => {
    const { ports } = makePorts();
    const svc = new VideoService(ports);

    const created = await svc.createProject(CTX, { name: "Onboarding" });
    expect(created.project.scenes).toHaveLength(1);

    const listed = await svc.listProjects(CTX, {});
    expect(listed.projects.map((p) => p.id)).toContain(created.project.id);

    const added = await svc.addSceneFromTemplate(CTX, {
      projectId: created.project.id,
      templateId: "host-intro",
    });
    expect(added.sceneIndex).toBe(1);

    const dialogue = await svc.setDialogue(CTX, {
      projectId: created.project.id,
      sceneId: added.sceneId,
      lines: [{ text: "Welcome aboard.", voiceId: "af_heart" }],
    });
    expect(dialogue.lineIds).toHaveLength(1);

    const footage = await svc.addFootageScene(CTX, {
      projectId: created.project.id,
      asset: { r2Key: "s/user-1/clip.mp4", kind: "video", durationMs: 9000 },
      sourceInMs: 1000,
      sourceOutMs: 7000,
    });
    expect(footage.sceneIndex).toBe(2);
    const project = await ports.projects.getProject(CTX, created.project.id);
    const footageScene = project?.scenes.find((s) => s.id === footage.sceneId);
    expect(footageScene?.durationMs).toBe(6000);
    expect(footageScene?.elements[0].kind).toBe("footage");
  });

  it("generates narration and stores the audio on the line", async () => {
    const { ports, narrationCalls } = makePorts();
    const svc = new VideoService(ports);
    const created = await svc.createProject(CTX, { name: "Narrated", templateId: "welcome" });
    const result = await svc.generateNarration(CTX, { projectId: created.project.id, voiceId: "af_heart" });
    expect(result.generated).toHaveLength(1);
    expect(narrationCalls[0].voiceId).toBe("af_heart");
    const project = await ports.projects.getProject(CTX, created.project.id);
    expect(project?.scenes[0].dialogue[0].audio?.r2Key).toContain("line.mp3");
    expect(project?.scenes[0].dialogue[0].voiceId).toBe("af_heart");
  });

  it("rejects an unknown voice instead of generating with it", async () => {
    const { ports } = makePorts();
    const svc = new VideoService(ports);
    const created = await svc.createProject(CTX, { name: "Voices" });
    await expect(
      svc.setDialogue(CTX, {
        projectId: created.project.id,
        sceneId: created.project.scenes[0].id,
        lines: [{ text: "Hi", voiceId: "not-a-voice" }],
      }),
    ).rejects.toThrow(/Unknown voice id/);
  });

  it("export starts a render; status completes it into the media library", async () => {
    const { ports, renderJobs, savedToLibrary } = makePorts();
    const svc = new VideoService(ports);
    const created = await svc.createProject(CTX, { name: "Export me" });
    const record = await svc.exportVideo(CTX, { projectId: created.project.id });
    expect(record.state).toBe("queued");
    expect(record.renderJobId).toBeTruthy();

    const stillQueued = await svc.getExportStatus(CTX, { exportId: record.id });
    expect(stillQueued.state).toBe("queued");
    expect(savedToLibrary).toHaveLength(0);

    renderJobs.set(record.renderJobId as string, { state: "done" });
    const done = await svc.getExportStatus(CTX, { exportId: record.id });
    expect(done.state).toBe("done");
    expect(done.objectKey).toContain("s/user-1/");
    expect(done.downloadUrl).toBe("https://example.test/dl");
    expect(savedToLibrary).toHaveLength(1);
  });

  it("embed reports unavailable plainly when the #49/#629 seam is not wired", async () => {
    const { ports, renderJobs } = makePorts();
    const svc = new VideoService(ports);
    const created = await svc.createProject(CTX, { name: "Embed me" });
    const record = await svc.exportVideo(CTX, { projectId: created.project.id });
    renderJobs.set(record.renderJobId as string, { state: "done" });
    await svc.getExportStatus(CTX, { exportId: record.id });
    await expect(
      svc.embedInCourse(CTX, { exportId: record.id, courseId: "course-1", moduleId: "mod-1" }),
    ).rejects.toThrow(/not available on this server yet/);
  });

  it("embed delegates to the seam when it is wired", async () => {
    const { ports, renderJobs } = makePorts({
      embed: {
        attachToCourseModule: async (_ctx, input) => ({
          assetId: "asset-1",
          mp4Url: "https://example.test/v.mp4",
          durationMs: input.exportRecord.durationMs,
          studioProjectId: input.exportRecord.projectId,
        }),
      },
    });
    const svc = new VideoService(ports);
    const created = await svc.createProject(CTX, { name: "Embed wired" });
    const record = await svc.exportVideo(CTX, { projectId: created.project.id });
    renderJobs.set(record.renderJobId as string, { state: "done" });
    const embedded = (await svc.embedInCourse(CTX, {
      exportId: record.id,
      courseId: "course-1",
      moduleId: "mod-1",
    })) as { embedded: boolean; assetId: string };
    expect(embedded.embedded).toBe(true);
    expect(embedded.assetId).toBe("asset-1");
  });

  it("dispatch runs a gated happy path end to end", async () => {
    const { ports } = makePorts();
    const deps = { service: new VideoService(ports), planGate: KEEPER_GATE };
    const created = await dispatchVideoTool(deps, "create_video_project", { name: "Via dispatch" }, CTX);
    expect(created.ok).toBe(true);
    const bad = await dispatchVideoTool(deps, "create_video_project", {}, CTX);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toBe("invalid");
    const unknown = await dispatchVideoTool(deps, "nope", {}, CTX);
    expect(unknown.ok).toBe(false);
    if (!unknown.ok) expect(unknown.error).toBe("unknown_tool");
  });
});

describe("issue #66: variable injection and template rendering", () => {
  it("localizedText does not silently accept a chart element id", () => {
    const template = projectTemplateById("chart-brief");
    if (!template) throw new Error("chart-brief template missing");
    expect(() =>
      injectVariables(template.build(), { localizedText: { "chart-main": "unused" } }),
    ).toThrow(/not a dialogue line or text element/);
  });

  it("applies the full variable set when every key matches its surface", () => {
    const template = projectTemplateById("chart-brief");
    if (!template) throw new Error("chart-brief template missing");
    const project = template.build();
    const { applied } = injectVariables(project, {
      projectName: "Q3 brief",
      scriptLines: { "line-chart": "Here is how Q3 went." },
      voiceId: "af_heart",
      brandKitId: "kit-42",
      chartCsv: { "chart-main": "label,value\nRevenue,10\nCosts,4" },
    });
    expect(applied).toEqual(["projectName", "brandKitId", "voiceId", "scriptLines", "chartCsv"]);
    expect(project.name).toBe("Q3 brief");
    expect(project.brandKitRef).toBe("kit-42");
    const line = project.scenes[0].dialogue[0];
    expect(line.text).toBe("Here is how Q3 went.");
    expect(line.voiceId).toBe("af_heart");
    const chart = project.scenes[0].elements.find((e) => e.kind === "chart");
    expect(chart?.kind === "chart" ? chart.csv : "").toContain("Revenue,10");
  });

  it("fails loudly on unknown ids and malformed chart CSV", () => {
    const template = projectTemplateById("welcome");
    if (!template) throw new Error("welcome template missing");
    expect(() => injectVariables(template.build(), { scriptLines: { nope: "x" } })).toThrow(/not in this project/);
    expect(() => injectVariables(template.build(), { voiceId: "not-a-voice" })).toThrow(/Unknown voice id/);
    expect(validateChartCsv("only-header")).toContain("Chart CSV needs a header row and at least one data row.");
    expect(validateChartCsv("a,b\n1,2,3")).toContain("Chart CSV row 2 has a different column count than the header.");
    expect(validateChartCsv("a,b\n1,2")).toEqual([]);
  });

  it("localized text replaces a line and records the locale caption track", () => {
    const template = projectTemplateById("welcome");
    if (!template) throw new Error("welcome template missing");
    const project = template.build();
    injectVariables(project, {
      localizedText: { "line-welcome": "Bienvenue dans ce cours." },
      locale: "fr",
    });
    expect(project.scenes[0].dialogue[0].text).toContain("Bienvenue");
    expect(project.captions?.some((c) => c.lang === "fr")).toBe(true);
  });

  it("builds the finch-render request shape from a project", () => {
    const template = projectTemplateById("welcome");
    if (!template) throw new Error("welcome template missing");
    const request = buildRenderRequest(template.build(), { captions: true });
    expect(request.width).toBe(1280);
    expect(request.height).toBe(720);
    expect(request.captions).toBe(true);
    const ocf = request.project as { id: string; scenes: unknown[] };
    expect(ocf.scenes.length).toBe(1);
  });

  it("render_template clones, injects, narrates, and starts the render in one flow", async () => {
    const { ports, narrationCalls } = makePorts();
    const svc = new VideoService(ports);
    const result = await svc.renderTemplate(CTX, {
      templateId: "chart-brief",
      generateNarration: true,
      variables: {
        projectName: "Q3 brief",
        scriptLines: { "line-chart": "Here is how Q3 went." },
        voiceId: "af_heart",
        brandKitId: "kit-42",
        chartCsv: { "chart-main": "label,value\nRevenue,10\nCosts,4" },
      },
    });
    expect(result.project.name).toBe("Q3 brief");
    expect(result.appliedVariables).toContain("chartCsv");
    expect(result.narration).toHaveLength(1);
    expect(narrationCalls[0].text).toBe("Here is how Q3 went.");
    expect(result.export.state).toBe("queued");
    expect(result.export.projectId).toBe(result.project.id);
    // The clone is a real saved project the user can open and polish.
    const stored = await ports.projects.getProject(CTX, result.project.id);
    expect(stored?.name).toBe("Q3 brief");
  });

  it("render_template can clone an existing project instead of a template", async () => {
    const { ports } = makePorts();
    const svc = new VideoService(ports);
    const created = await svc.createProject(CTX, { name: "Source", templateId: "welcome" });
    const result = await svc.renderTemplate(CTX, {
      sourceProjectId: created.project.id,
      variables: { projectName: "Clone" },
    });
    expect(result.project.id).not.toBe(created.project.id);
    expect(result.project.name).toBe("Clone");
  });
});
