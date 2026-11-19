/**
 * Standalone export adapters (issue #56): SCORM, PowerPoint, and PNG
 * scenes for the editor's VideoProject model.
 *
 * All frames and video come from the shared export renderer in
 * videoExport.ts (renderProjectSceneFrames and exportMp4Project), never
 * a second renderer. The pure packaging lives in
 * @finch-studio/standalone-export; this module only adapts the project
 * shape (character speech becomes scene dialogue, in spoken order) and
 * turns package bytes into named Blobs.
 */
import type { CharacterObject, VideoProject, VideoScene } from "@finch-studio/core";
import {
  buildPptx,
  buildScenePngZip,
  buildScormPackage,
  pngZipFileName,
  pptxFileName,
  sceneFrameFileName,
  scormPackageFileName,
  type ScormVersion,
  type StandaloneProjectInput,
} from "@finch-studio/standalone-export";
import { exportFileBaseName } from "./exportPresets";
import { exportMp4Project, renderProjectSceneFrames } from "./videoExport";

export interface StandaloneResult {
  blob: Blob;
  fileName: string;
  label: string;
}

export type ExportDimensions = { width: number; height: number };

/** Scene dialogue for notes and metadata: character speech, spoken order. */
export function sceneDialogueLines(scene: VideoScene): string[] {
  const lines: { start: number; text: string }[] = [];
  for (const object of scene.objects) {
    if (object.type !== "character") continue;
    for (const line of (object as CharacterObject).speech ?? []) {
      const text = line.text.trim();
      if (text) lines.push({ start: line.start, text });
    }
  }
  return lines.sort((a, b) => a.start - b.start).map((line) => line.text);
}

async function standaloneInput(
  project: VideoProject,
  dimensions: ExportDimensions,
): Promise<StandaloneProjectInput> {
  const frames = await renderProjectSceneFrames(project, dimensions);
  const byScene = new Map(frames.map((frame) => [frame.sceneId, frame.png]));
  return {
    name: project.name || "Untitled video",
    scenes: project.scenes.map((scene) => {
      const framePng = byScene.get(scene.id);
      if (!framePng) throw new Error(`Could not render a frame for scene "${scene.name}".`);
      return {
        id: scene.id,
        name: scene.name,
        dialogue: sceneDialogueLines(scene),
        framePng,
      };
    }),
  };
}

function toBlob(bytes: Uint8Array, type: string): Blob {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return new Blob([copy.buffer], { type });
}

export async function exportStandaloneScorm(
  project: VideoProject,
  version: ScormVersion,
  dimensions: ExportDimensions,
  onProgress?: (fraction: number) => void,
  options: { captions?: boolean } = {},
): Promise<StandaloneResult> {
  const input = await standaloneInput(project, dimensions);
  const video = await exportMp4Project(project, onProgress, dimensions, options);
  const videoBytes = new Uint8Array(await video.arrayBuffer());
  const baseName = exportFileBaseName(project.name || "video");
  const bytes = buildScormPackage(
    { ...input, videoFileName: `${baseName}.mp4`, videoBytes },
    version,
  );
  return {
    blob: toBlob(bytes, "application/zip"),
    fileName: scormPackageFileName(project.name || "video", version),
    label: `SCORM ${version}`,
  };
}

export async function exportStandalonePptx(
  project: VideoProject,
  dimensions: ExportDimensions,
): Promise<StandaloneResult> {
  const input = await standaloneInput(project, dimensions);
  return {
    blob: toBlob(
      buildPptx(input),
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ),
    fileName: pptxFileName(project.name || "video"),
    label: "PowerPoint",
  };
}

export async function exportStandaloneScenePngZip(
  project: VideoProject,
  dimensions: ExportDimensions,
): Promise<StandaloneResult> {
  const input = await standaloneInput(project, dimensions);
  return {
    blob: toBlob(buildScenePngZip(input), "application/zip"),
    fileName: pngZipFileName(project.name || "video"),
    label: "PNG scenes",
  };
}

export async function exportStandaloneScenePng(
  project: VideoProject,
  dimensions: ExportDimensions,
  sceneIndex: number,
): Promise<StandaloneResult> {
  const input = await standaloneInput(project, dimensions);
  const scene = input.scenes[sceneIndex];
  if (!scene) throw new Error("That scene no longer exists. Close and reopen the export dialog.");
  return {
    blob: toBlob(scene.framePng, "image/png"),
    fileName: sceneFrameFileName(scene, sceneIndex),
    label: `PNG for ${scene.name}`,
  };
}
