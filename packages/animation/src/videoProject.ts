/**
 * Video project helpers (SPEC §7.9, rev 27).
 *
 * A `VideoProject` is an ordered list of `VideoScene`s. Helpers here compute
 * project timing (with transitions), validate structure, and convert between
 * projects and plain JSON for save/load.
 */
import type { CourseObject, VideoProject, VideoScene } from "@finch-studio/core";

export const DEFAULT_SCENE_DURATION_MS = 5000;

let counter = 0;
/** Collision-resistant id for studio-created entities. */
export function newVideoId(prefix: string): string {
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${counter}-${rand}`;
}

export function makeVideoScene(name?: string): VideoScene {
  const n = name ?? "Scene";
  return {
    id: newVideoId("scene"),
    name: n,
    durationMs: DEFAULT_SCENE_DURATION_MS,
    transition: "cut",
    transitionMs: 400,
    objects: [],
  };
}

/** Scene duration from timed content, with a five-second minimum for untimed content. */
export function sceneContentDurationMs(scene: VideoScene): number {
  const endTimes = scene.objects.flatMap((object) => {
    const ends: number[] = [];
    if (object.timing) {
      ends.push(((object.timing.start ?? 0) + (object.timing.duration ?? 0)) * 1000);
    }
    if (object.type === "character") {
      ends.push(...(object.speech ?? []).map((line) => line.start + line.duration));
      ends.push(...(object.path ?? []).map((waypoint) => waypoint.t));
    }
    return ends.filter(Number.isFinite);
  });
  return Math.max(DEFAULT_SCENE_DURATION_MS, ...endTimes);
}

export function makeVideoProject(name = "Untitled video"): VideoProject {
  return {
    id: newVideoId("vproj"),
    name,
    scenes: [makeVideoScene("Scene 1")],
  };
}

export interface SceneTiming {
  scene: VideoScene;
  /** Ms from project start when this scene starts (after transition overlap). */
  startMs: number;
  /** Ms from project start when this scene ends. */
  endMs: number;
}

/**
 * Project timeline with transitions. Non-cut transitions overlap the tail of
 * the previous scene by `transitionMs`; cut transitions abut.
 */
export function projectTimeline(project: VideoProject): {
  scenes: SceneTiming[];
  totalMs: number;
} {
  const out: SceneTiming[] = [];
  let cursor = 0;
  project.scenes.forEach((scene, i) => {
    const overlap =
      i > 0 && scene.transition && scene.transition !== "cut"
        ? (scene.transitionMs ?? 400)
        : 0;
    const startMs = Math.max(0, cursor - overlap);
    const endMs = startMs + Math.max(1, scene.durationMs);
    out.push({ scene, startMs, endMs });
    cursor = endMs;
  });
  return { scenes: out, totalMs: cursor };
}

/** Total project duration in ms (with transitions). */
export function projectDurationMs(project: VideoProject): number {
  return projectTimeline(project).totalMs;
}

/** Find which scene is active at project time `tMs` (for crossfade, the later scene wins). */
export function sceneAt(
  project: VideoProject,
  tMs: number,
): { scene: VideoScene; sceneT: number; timing: SceneTiming } | null {
  const { scenes } = projectTimeline(project);
  for (let i = scenes.length - 1; i >= 0; i--) {
    const timing = scenes[i];
    if (tMs >= timing.startMs && tMs < timing.endMs) {
      return { scene: timing.scene, sceneT: tMs - timing.startMs, timing };
    }
  }
  return null;
}

/** Progress through the incoming scene's transition at project time `tMs`. */
export function transitionAlpha(
  project: VideoProject,
  tMs: number,
): number {
  const { scenes } = projectTimeline(project);
  // During a fade overlap two scenes are active; the later (incoming) one
  // wins — same rule as sceneAt.
  let idx = -1;
  for (let i = scenes.length - 1; i >= 0; i--) {
    const s = scenes[i];
    if (tMs >= s.startMs && tMs < s.endMs) {
      idx = i;
      break;
    }
  }
  if (idx <= 0) return 1;
  const timing = scenes[idx];
  const overlap =
    timing.scene.transition && timing.scene.transition !== "cut"
      ? (timing.scene.transitionMs ?? 400)
      : 0;
  if (overlap <= 0) return 1;
  const into = tMs - timing.startMs;
  return Math.min(1, Math.max(0, into / overlap));
}

/** Collect every object id in a project (for selection repair). */
export function allSceneObjectIds(project: VideoProject): string[] {
  const ids: string[] = [];
  const walk = (objs: CourseObject[]) => {
    for (const o of objs) {
      ids.push(o.id);
      const g = o as { objects?: CourseObject[] };
      if (Array.isArray(g.objects)) walk(g.objects);
    }
  };
  for (const s of project.scenes) walk(s.objects);
  return ids;
}

/** Basic structural validation; returns human-readable problems. */
export function validateVideoProject(project: VideoProject): string[] {
  const problems: string[] = [];
  if (!project.id) problems.push("Project is missing an id.");
  if (!project.name) problems.push("Project is missing a name.");
  if (!Array.isArray(project.scenes) || project.scenes.length === 0) {
    problems.push("Project has no scenes.");
  }
  project.scenes.forEach((s, i) => {
    if (!s.id) problems.push(`Scene ${i + 1} is missing an id.`);
    if (!(s.durationMs > 0)) problems.push(`Scene "${s.name || i + 1}" needs a positive durationMs.`);
    if (!Array.isArray(s.objects)) problems.push(`Scene "${s.name || i + 1}" objects must be an array.`);
  });
  return problems;
}
