/**
 * renderRequest.ts — builds the finch-render job request for a
 * StudioProject: the exact body the shipped server renderer accepts
 * (services/render/server.mjs: POST /jobs {project, width, height,
 * captions}), the same shape apps/editor/src/serverRender.ts sends.
 *
 * The render service drives the Studio app's render page, which
 * consumes the OCF VideoProject JSON, so the project is mapped with
 * packages/schema's studioToOCF (the sidecar rides along in the
 * caller's stored project; the render page rebuilds from the OCF
 * objects, which is the shipped #33 behavior).
 *
 * Dimensions derive from the project's aspect: 16:9 renders at
 * 1280x720, 9:16 at 720x1280, 1:1 at 960x960. finch-render caps
 * projects at 10 minutes and 1080p; the width/height pairs here sit
 * inside that cap.
 */
import { studioToOCF, type StudioProject } from "@finch-studio/schema";
import { invalid } from "./errors.js";
import type { RenderJobRequest } from "./ports.js";

export const ASPECT_DIMENSIONS: Record<string, { width: number; height: number }> = {
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 720, height: 1280 },
  "1:1": { width: 960, height: 960 },
};

export function buildRenderRequest(
  project: StudioProject,
  opts: { captions?: boolean } = {},
): RenderJobRequest {
  const dims = ASPECT_DIMENSIONS[project.aspect ?? "16:9"];
  if (!dims) throw invalid(`Unsupported project aspect "${project.aspect}".`);
  const { project: ocfProject } = studioToOCF(project);
  return {
    project: ocfProject,
    width: dims.width,
    height: dims.height,
    captions: opts.captions ?? true,
  };
}

/** Total project duration in ms (scene durations summed). */
export function projectDurationMs(project: StudioProject): number {
  return project.scenes.reduce((sum, s) => sum + (s.durationMs || 0), 0);
}
