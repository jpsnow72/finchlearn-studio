/**
 * Aspect ratio duplication with smart auto-reframe (issue #62).
 *
 * Duplicating a project to 9:16 or 1:1 rescales every positioned element
 * into the new frame: positions scale by the frame ratio, elements that
 * would overflow are clamped inside safe bounds, and sizes shrink to fit
 * rather than cropping content off. The original project is untouched;
 * snapshots (schema.snapshots) are the non-destructive version store.
 */
import type { StudioProject, StudioScene } from "./schema.js";
import { newStudioId } from "./schema.js";

export const ASPECT_FRAMES = {
  "16:9": { w: 1920, h: 1080 },
  "9:16": { w: 1080, h: 1920 },
  "1:1": { w: 1080, h: 1080 },
} as const;

export type AspectName = keyof typeof ASPECT_FRAMES;

/** Title safe and social safe zone rectangles, as fractions of the frame. */
export function safeZones(aspect: AspectName): {
  titleSafe: { x: number; y: number; w: number; h: number };
  socialSafe: { x: number; y: number; w: number; h: number };
} {
  void aspect;
  return {
    titleSafe: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 },
    // Social platforms cover the bottom and right edges with their own UI.
    socialSafe: { x: 0.06, y: 0.08, w: 0.82, h: 0.78 },
  };
}

export function duplicateProjectAs(
  project: StudioProject,
  aspect: AspectName,
  nameSuffix?: string,
): StudioProject {
  const from = ASPECT_FRAMES[project.aspect ?? "16:9"];
  const to = ASPECT_FRAMES[aspect];
  const sx = to.w / from.w;
  const sy = to.h / from.h;
  const s = Math.min(sx, sy);

  const scenes: StudioScene[] = project.scenes.map((scene) => ({
    ...scene,
    id: newStudioId("scene"),
    elements: scene.elements.map((el) => {
      const next = { ...el, id: newStudioId("el") };
      if (next.x !== undefined) next.x = Math.round(next.x * sx);
      if (next.y !== undefined) next.y = Math.round(next.y * sy);
      if (next.w !== undefined) next.w = Math.round(next.w * s);
      if (next.h !== undefined) next.h = Math.round(next.h * s);
      // Clamp inside the frame.
      if (next.x !== undefined && next.w !== undefined) {
        next.x = Math.max(0, Math.min(next.x, to.w - Math.min(next.w, to.w)));
        if (next.w > to.w) next.w = to.w;
      }
      if (next.y !== undefined && next.h !== undefined) {
        next.y = Math.max(0, Math.min(next.y, to.h - Math.min(next.h, to.h)));
        if (next.h > to.h) next.h = to.h;
      }
      return next;
    }),
    dialogue: scene.dialogue.map((d) => ({ ...d })),
    markers: scene.markers?.map((m) => ({ ...m })),
  }));

  return {
    ...project,
    id: newStudioId("proj"),
    name: `${project.name} (${nameSuffix ?? aspect})`,
    aspect,
    scenes,
    snapshots: undefined,
  };
}

export interface ProjectSnapshotRecord {
  id: string;
  name: string;
  createdAt: string;
  json: string;
}

/** Take a named snapshot of a project (non-destructive, JSON stored). */
export function takeSnapshot(project: StudioProject, name: string): ProjectSnapshotRecord {
  return {
    id: newStudioId("snap"),
    name,
    createdAt: new Date().toISOString(),
    json: JSON.stringify(project),
  };
}

/** Restore a snapshot into a fresh project value (original ids preserved). */
export function restoreSnapshot(record: ProjectSnapshotRecord): StudioProject {
  return JSON.parse(record.json) as StudioProject;
}
