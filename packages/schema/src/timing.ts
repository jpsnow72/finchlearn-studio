/**
 * Project timing math (issue #4). Same rule as the OCF video project model:
 * a fade transition overlaps the tail of the previous scene by transitionMs;
 * every other transition abuts.
 */
import type { StudioProject, StudioScene } from "./schema.js";

export interface SceneTiming {
  scene: StudioScene;
  startMs: number;
  endMs: number;
}

export function projectTimeline(project: StudioProject): {
  scenes: SceneTiming[];
  totalMs: number;
} {
  const out: SceneTiming[] = [];
  let cursor = 0;
  project.scenes.forEach((scene, i) => {
    const overlap =
      i > 0 && scene.transition === "fade" ? (scene.transitionMs ?? 400) : 0;
    const startMs = Math.max(0, cursor - overlap);
    const endMs = startMs + Math.max(1, scene.durationMs);
    out.push({ scene, startMs, endMs });
    cursor = endMs;
  });
  return { scenes: out, totalMs: cursor };
}

export function projectDurationMs(project: StudioProject): number {
  return projectTimeline(project).totalMs;
}

/** Scene duration derived from content: the latest element or dialogue end. */
export function derivedSceneDurationMs(scene: StudioScene): number {
  let end = 0;
  for (const el of scene.elements) end = Math.max(end, el.startMs + el.durationMs);
  return end;
}
