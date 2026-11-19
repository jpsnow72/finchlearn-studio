import type { CharacterObject, VideoProject, VideoScene } from "@finch-studio/core";

const STUDIO_EXTENSION = "x-finch-studio";

export type CaptionFont = "system" | "serif" | "monospace";
export type CaptionPosition = "top" | "center" | "bottom";

export interface CaptionStyle {
  font: CaptionFont;
  size: number;
  position: CaptionPosition;
}

export interface CaptionEdit {
  text?: string;
  startMs?: number;
  durationMs?: number;
}

export interface CaptionProject extends VideoProject {
  extensions?: Record<string, unknown>;
}

export interface CaptionCue extends CaptionEdit {
  sceneId: string;
  sceneName: string;
  lineId: string;
  text: string;
  startMs: number;
  durationMs: number;
}

interface CaptionExtension {
  captionStyle?: Partial<CaptionStyle>;
  captionEdits?: Record<string, CaptionEdit>;
}

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
  font: "system",
  size: 32,
  position: "bottom",
};

function captionExtension(project: VideoProject): CaptionExtension {
  const extensions = (project as CaptionProject).extensions;
  const value = extensions?.[STUDIO_EXTENSION];
  return value && typeof value === "object" ? value as CaptionExtension : {};
}

export function captionEditKey(sceneId: string, lineId: string): string {
  return JSON.stringify([sceneId, lineId]);
}

export function getCaptionStyle(project: VideoProject): CaptionStyle {
  const style = captionExtension(project).captionStyle;
  return {
    font: style?.font === "serif" || style?.font === "monospace" ? style.font : "system",
    size: typeof style?.size === "number" && Number.isFinite(style.size)
      ? Math.min(64, Math.max(16, style.size))
      : DEFAULT_CAPTION_STYLE.size,
    position: style?.position === "top" || style?.position === "center"
      ? style.position
      : "bottom",
  };
}

export function getCaptionCues(project: VideoProject): CaptionCue[] {
  const edits = captionExtension(project).captionEdits ?? {};
  const cues = project.scenes.flatMap((scene) =>
    scene.objects.flatMap((object) => {
      if (object.type !== "character") return [];
      return ((object as CharacterObject).speech ?? []).map((line) => {
        const edit = edits[captionEditKey(scene.id, line.id)];
        return {
          sceneId: scene.id,
          sceneName: scene.name,
          lineId: line.id,
          text: typeof edit?.text === "string" ? edit.text : line.text,
          startMs: typeof edit?.startMs === "number" && Number.isFinite(edit.startMs)
            ? Math.max(0, edit.startMs)
            : Math.max(0, line.start),
          durationMs: typeof edit?.durationMs === "number" && Number.isFinite(edit.durationMs)
            ? Math.max(100, edit.durationMs)
            : Math.max(100, line.duration),
        };
      });
    }),
  );
  const sceneOrder = new Map(project.scenes.map((scene, index) => [scene.id, index]));
  return cues.sort(
    (a, b) =>
      (sceneOrder.get(a.sceneId) ?? 0) - (sceneOrder.get(b.sceneId) ?? 0) ||
      a.startMs - b.startMs,
  );
}

export function getCaptionAt(
  project: VideoProject,
  sceneId: string,
  localT: number,
): string | undefined {
  const scene = project.scenes.find((item) => item.id === sceneId);
  if (!scene) return undefined;
  const edits = captionExtension(project).captionEdits ?? {};
  for (const object of scene.objects) {
    if (object.type !== "character") continue;
    for (const line of (object as CharacterObject).speech ?? []) {
      const edit = edits[captionEditKey(scene.id, line.id)];
      const start = typeof edit?.startMs === "number" && Number.isFinite(edit.startMs)
        ? Math.max(0, edit.startMs)
        : Math.max(0, line.start);
      const duration = typeof edit?.durationMs === "number" && Number.isFinite(edit.durationMs)
        ? Math.max(100, edit.durationMs)
        : Math.max(100, line.duration);
      const text = typeof edit?.text === "string" ? edit.text : line.text;
      if (text && localT >= start && localT < start + duration) return text;
    }
  }
  return undefined;
}

export function withCaptionStyle(
  project: CaptionProject,
  patch: Partial<CaptionStyle>,
): CaptionProject {
  const extension = captionExtension(project);
  const style = { ...getCaptionStyle(project), ...patch };
  return {
    ...project,
    extensions: {
      ...project.extensions,
      [STUDIO_EXTENSION]: { ...extension, captionStyle: style },
    },
  };
}

export function withCaptionEdit(
  project: CaptionProject,
  sceneId: string,
  lineId: string,
  patch: CaptionEdit,
): CaptionProject {
  const extension = captionExtension(project);
  const edits = extension.captionEdits ?? {};
  const key = captionEditKey(sceneId, lineId);
  const previous = edits[key] ?? {};
  const cleanPatch: CaptionEdit = {};
  if (typeof patch.text === "string") cleanPatch.text = patch.text;
  if (typeof patch.startMs === "number" && Number.isFinite(patch.startMs)) {
    cleanPatch.startMs = Math.max(0, patch.startMs);
  }
  if (typeof patch.durationMs === "number" && Number.isFinite(patch.durationMs)) {
    cleanPatch.durationMs = Math.max(100, patch.durationMs);
  }
  return {
    ...project,
    extensions: {
      ...project.extensions,
      [STUDIO_EXTENSION]: {
        ...extension,
        captionEdits: { ...edits, [key]: { ...previous, ...cleanPatch } },
      },
    },
  };
}

export function copyCaptionEditsForScene(
  project: CaptionProject,
  source: VideoScene,
  duplicate: VideoScene,
): CaptionProject {
  const extension = captionExtension(project);
  const edits = extension.captionEdits ?? {};
  const copied = { ...edits };
  source.objects.forEach((object, objectIndex) => {
    const duplicateObject = duplicate.objects[objectIndex];
    if (object.type !== "character" || duplicateObject?.type !== "character") return;
    const originalSpeech = (object as CharacterObject).speech ?? [];
    const duplicateSpeech = (duplicateObject as CharacterObject).speech ?? [];
    originalSpeech.forEach((line, lineIndex) => {
      const edit = edits[captionEditKey(source.id, line.id)];
      const duplicateLine = duplicateSpeech[lineIndex];
      if (edit && duplicateLine) {
        copied[captionEditKey(duplicate.id, duplicateLine.id)] = { ...edit };
      }
    });
  });
  if (Object.keys(copied).length === Object.keys(edits).length) return project;
  return {
    ...project,
    extensions: {
      ...project.extensions,
      [STUDIO_EXTENSION]: { ...extension, captionEdits: copied },
    },
  };
}
