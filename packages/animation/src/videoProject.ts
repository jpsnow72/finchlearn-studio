/**
 * Video project helpers (SPEC §7.9, rev 27).
 *
 * A `VideoProject` is an ordered list of `VideoScene`s. Helpers here compute
 * project timing (with transitions), validate structure, and convert between
 * projects and plain JSON for save/load.
 */
import type {
  CourseObject,
  ProjectAspect,
  VideoProject,
  VideoScene,
} from "@finch-studio/core";

export const DEFAULT_SCENE_DURATION_MS = 5000;

/* ------------------------------------------------------------------ */
/* Project aspect (issue #13 stage aspect switcher)                    */
/* ------------------------------------------------------------------ */

export const PROJECT_ASPECTS: ProjectAspect[] = ["16:9", "9:16", "1:1"];
export const DEFAULT_PROJECT_ASPECT: ProjectAspect = "16:9";

/**
 * Stage coordinate space per aspect. Object positions live in this
 * space, so the stage, the safe-area preview, and export rendering all
 * agree on one frame per aspect. The frames keep one shared scale:
 * 1280x720 landscape, 720x1280 portrait, 720x720 square.
 */
export const STAGE_DIMENSIONS: Record<
  ProjectAspect,
  { width: number; height: number }
> = {
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 720, height: 1280 },
  "1:1": { width: 720, height: 720 },
};

export function isProjectAspect(value: unknown): value is ProjectAspect {
  return value === "16:9" || value === "9:16" || value === "1:1";
}

/** The project's effective aspect; legacy projects without the field
 * (and any unrecognized value) open as 16:9, exactly as before. */
export function projectAspect(
  project: Pick<VideoProject, "aspect">,
): ProjectAspect {
  return isProjectAspect(project.aspect)
    ? project.aspect
    : DEFAULT_PROJECT_ASPECT;
}

/** Copy of the project with its effective aspect made explicit. */
export function withProjectAspect(project: VideoProject): VideoProject {
  const aspect = projectAspect(project);
  return project.aspect === aspect ? project : { ...project, aspect };
}

export function stageDimensionsForAspect(aspect: ProjectAspect): {
  width: number;
  height: number;
} {
  return STAGE_DIMENSIONS[aspect];
}

export function stageDimensions(project: Pick<VideoProject, "aspect">): {
  width: number;
  height: number;
} {
  return STAGE_DIMENSIONS[projectAspect(project)];
}

/** True when a positioned object sits partly or wholly outside a frame. */
export function objectOutsideFrame(
  object: CourseObject,
  frame: { width: number; height: number },
): boolean {
  const pos = object.position;
  if (!pos) return false;
  const x = pos.x ?? 0;
  const y = pos.y ?? 0;
  const w = pos.w ?? 0;
  const h = pos.h ?? 0;
  return x < 0 || y < 0 || x + w > frame.width || y + h > frame.height;
}

function reframeObject(
  object: CourseObject,
  sx: number,
  sy: number,
  s: number,
  frame: { width: number; height: number },
): CourseObject {
  let next = object;
  if (object.position) {
    const pos = object.position;
    let w = pos.w !== undefined ? Math.round(pos.w * s) : undefined;
    let h = pos.h !== undefined ? Math.round(pos.h * s) : undefined;
    if (w !== undefined && w > frame.width) w = frame.width;
    if (h !== undefined && h > frame.height) h = frame.height;
    let x = pos.x !== undefined ? Math.round(pos.x * sx) : undefined;
    let y = pos.y !== undefined ? Math.round(pos.y * sy) : undefined;
    // Clamp inside the new frame: nothing is silently clipped or lost,
    // the same rule duplicateProjectAs applies in @finch-studio/schema.
    if (x !== undefined) {
      x = Math.max(0, Math.min(x, frame.width - (w ?? 0)));
    }
    if (y !== undefined) {
      y = Math.max(0, Math.min(y, frame.height - (h ?? 0)));
    }
    next = { ...next, position: { ...pos, x, y, w, h } };
  }
  const char = next as { path?: { x: number; y: number; t: number }[] };
  if (Array.isArray(char.path) && char.path.length > 0) {
    next = {
      ...next,
      path: char.path.map((wp) => ({
        ...wp,
        x: Math.max(0, Math.min(frame.width, Math.round(wp.x * sx))),
        y: Math.max(0, Math.min(frame.height, Math.round(wp.y * sy))),
      })),
    } as CourseObject;
  }
  const group = next as { objects?: CourseObject[] };
  if (Array.isArray(group.objects)) {
    next = {
      ...next,
      objects: group.objects.map((child) =>
        reframeObject(child, sx, sy, s, frame),
      ),
    } as CourseObject;
  }
  return next;
}

/**
 * Reframe a project into a new stage aspect in place (issue #13),
 * mirroring the smart auto-reframe of duplicateProjectAs (issue #62):
 * positions scale by the frame ratio, sizes shrink to fit rather than
 * cropping, and every element is clamped inside the new frame so no
 * element is lost. Switching to the current aspect returns the project
 * unchanged. The input project is not mutated.
 */
export function reframeProjectForAspect(
  project: VideoProject,
  aspect: ProjectAspect,
): VideoProject {
  const from = STAGE_DIMENSIONS[projectAspect(project)];
  const to = STAGE_DIMENSIONS[aspect];
  if (from === to) {
    return project.aspect === aspect ? project : { ...project, aspect };
  }
  const sx = to.width / from.width;
  const sy = to.height / from.height;
  const s = Math.min(sx, sy);
  return {
    ...project,
    aspect,
    scenes: project.scenes.map((scene) => ({
      ...scene,
      objects: scene.objects.map((object) =>
        reframeObject(object, sx, sy, s, to),
      ),
    })),
  };
}

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

/** Scene duration from timed content; untimed scenes retain edits up to the five-second default. */
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
  return endTimes.length > 0
    ? Math.max(500, ...endTimes)
    : Math.min(DEFAULT_SCENE_DURATION_MS, Math.max(500, scene.durationMs));
}

export function makeVideoProject(name = "Untitled video"): VideoProject {
  return {
    id: newVideoId("vproj"),
    name,
    scenes: [makeVideoScene("Scene 1")],
    aspect: DEFAULT_PROJECT_ASPECT,
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
  if (project.aspect !== undefined && !isProjectAspect(project.aspect)) {
    problems.push(`Project aspect "${String(project.aspect)}" is not supported. Use 16:9, 9:16, or 1:1.`);
  }
  project.scenes.forEach((s, i) => {
    if (!s.id) problems.push(`Scene ${i + 1} is missing an id.`);
    if (!(s.durationMs > 0)) problems.push(`Scene "${s.name || i + 1}" needs a positive durationMs.`);
    if (!Array.isArray(s.objects)) problems.push(`Scene "${s.name || i + 1}" objects must be an array.`);
  });
  return problems;
}
