/**
 * ports.ts — the seams between the video-tool service core and the
 * shipped Studio surfaces. The core (service.ts) is pure orchestration
 * over these ports; every port has exactly one production adapter,
 * wired on the MCP server / ship side, and tests inject fakes.
 *
 * Production wiring (ship-point, see MANIFEST.md):
 * - ProjectStore / ExportStore: Supabase studio_projects /
 *   studio_exports through the caller's RLS client, the same tables
 *   apps/editor/src/cloud.ts syncs. studio_projects.data holds the
 *   editor's VideoProject JSON; the adapter converts with
 *   packages/schema's ocfToStudio / studioToOCF so this core always
 *   works on the StudioProject contract (issue #10: the project JSON
 *   is the shared contract for UI, embed, and MCP).
 * - NarrationPort: the production TTS stack the editor uses
 *   (apps/editor/src/narration.ts: Kokoro basic via the finch-narration
 *   Worker, Google premium via the ai-generate edge function). The
 *   adapter uploads the generated audio as a project asset and
 *   returns its R2 ref plus the measured duration.
 * - RenderPort: finch-render (services/render, render.finchlearn.com),
 *   the shipped server FFmpeg path. POST /jobs with the render
 *   request built by renderRequest.ts, poll GET /jobs/:id, fetch
 *   GET /jobs/:id/file. Headless MCP renders always take the server
 *   path (docs/render-spike.md).
 * - MediaLibraryPort: the finch-media Worker's POST /v1/studio/exports
 *   grant flow (presigned R2 PUT, keys s/{userId}/...), exactly the
 *   flow apps/editor/src/cloud.ts uploadExportToCloud runs, followed
 *   by the studio_exports row insert the ExportStore performs.
 * - EmbedPort: SEAM, pending issues #49 (Studio) and #629 (OCF). See
 *   the EmbedPort note below.
 */
import type { AssetRef, StudioProject } from "@finch-studio/schema";

/** One authenticated caller's context. Data access is scoped to this
 * user by the adapters (RLS on the MCP server side); the core never
 * sees another user's rows because the ports are built per caller. */
export interface CallerContext {
  userId: string;
  email: string | null;
}

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  sceneCount: number;
}

export interface ProjectStore {
  listProjects(ctx: CallerContext, limit: number): Promise<ProjectSummary[]>;
  getProject(ctx: CallerContext, projectId: string): Promise<StudioProject | null>;
  /** Insert or replace the caller's project (upsert on id, owner-checked). */
  saveProject(ctx: CallerContext, project: StudioProject): Promise<{ updatedAt: string }>;
}

export type ExportState = "queued" | "processing" | "done" | "error";

export interface ExportRecord {
  id: string;
  projectId: string;
  name: string;
  state: ExportState;
  /** finch-render job id while the render runs server-side. */
  renderJobId?: string;
  /** R2 object key once the output is saved to the media library. */
  objectKey?: string;
  downloadUrl?: string;
  durationMs?: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExportStore {
  createExport(ctx: CallerContext, record: ExportRecord): Promise<void>;
  getExport(ctx: CallerContext, exportId: string): Promise<ExportRecord | null>;
  updateExport(ctx: CallerContext, exportId: string, patch: Partial<ExportRecord>): Promise<void>;
}

export interface NarrationResult {
  audio: AssetRef;
  durationMs: number;
  /** Word timings when the provider returns them (captions, Phase 2). */
  wordTimings?: { word: string; startMs: number; endMs: number }[];
}

export interface NarrationPort {
  /**
   * Generate narration for one line of text in the given voice (an id
   * from @finch-studio/audio's catalogue) and store the audio as a
   * project asset. Throws with a plain-language reason on failure.
   */
  generate(
    ctx: CallerContext,
    input: { projectId: string; text: string; voiceId: string },
  ): Promise<NarrationResult>;
}

export interface RenderJobRequest {
  /** OCF VideoProject JSON, the shape finch-render's page consumes. */
  project: unknown;
  width: number;
  height: number;
  captions: boolean;
}

export interface RenderPort {
  /** Submit a job to finch-render; returns its job id. */
  submit(ctx: CallerContext, request: RenderJobRequest): Promise<{ jobId: string }>;
  /** Current state of a job; fileBytes is present once state is done. */
  status(
    ctx: CallerContext,
    jobId: string,
  ): Promise<{ state: ExportState; error?: string; fileBytes?: Uint8Array; contentType?: string }>;
}

export interface MediaLibraryPort {
  /**
   * Save rendered bytes to the caller's media library (finch-media
   * grant + R2 PUT). Returns the object key and a signed download URL.
   */
  saveExport(
    ctx: CallerContext,
    input: { name: string; bytes: Uint8Array; contentType: string },
  ): Promise<{ objectKey: string; downloadUrl: string }>;
}

/**
 * The embed handoff return payload (issues #49 / #629): what Finish
 * in the Studio hands back so a course video block can reference the
 * rendered asset. The course holds the asset id, MP4 URL, poster,
 * duration, and caption files, plus the Studio project id for
 * edit-again. Media identity rule: the asset resolves off the
 * course's own entitlements, never the viewer's session.
 */
export interface EmbedResult {
  assetId: string;
  mp4Url: string;
  posterUrl?: string;
  durationMs?: number;
  captionFiles?: { lang: string; url: string }[];
  studioProjectId: string;
}

/**
 * SEAM (pending #49 Studio embed handoff + #629 OCF course binding,
 * building in parallel lanes): attach a finished Studio export to a
 * course module's video block. Until those lanes land, the ship
 * coordinator wires this port to the handoff service the #49 lane
 * ships; the tool surface, gate, and payload shape here are final
 * against the #49/#629 issue bodies. An adapter that is not wired
 * yet must throw a plain "not available yet" error, never fake success.
 */
export interface EmbedPort {
  attachToCourseModule(
    ctx: CallerContext,
    input: {
      courseId: string;
      /** Module (course section) id; blockId targets an existing block when given. */
      moduleId: string;
      blockId?: string;
      exportRecord: ExportRecord;
    },
  ): Promise<EmbedResult>;
}

export interface StudioPorts {
  projects: ProjectStore;
  exports: ExportStore;
  narration: NarrationPort;
  render: RenderPort;
  mediaLibrary: MediaLibraryPort;
  /** Optional until #49/#629 land; embed tools report unavailable without it. */
  embed?: EmbedPort;
  /** Id factory override for tests; defaults to the schema package's. */
  newId?: (prefix: string) => string;
  /** Clock override for tests; defaults to Date-based ISO strings. */
  nowIso?: () => string;
}
