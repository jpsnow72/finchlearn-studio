/**
 * PNG scene export (issue #56): every scene frame as its own PNG.
 *
 * Frames come from the shared scene renderer at the project's aspect
 * and resolution (the editor renders them; see renderProjectSceneFrames
 * in the editor's videoExport module). Individual downloads use the
 * same bytes as the zip entries: one source, two deliveries.
 */
import { buildZip } from "./zip.js";
import {
  requireScenes,
  sceneFrameFileName,
  slugifyFilePart,
  type StandaloneProjectInput,
} from "./model.js";

export function pngZipFileName(projectName: string): string {
  return `${slugifyFilePart(projectName)}-scenes.zip`;
}

/** Zip path for one scene frame inside the scenes zip. */
export function scenePngEntryName(
  scene: StandaloneProjectInput["scenes"][number],
  index: number,
): string {
  return `scenes/${sceneFrameFileName(scene, index)}`;
}

/** Build the scenes zip: one PNG entry per scene, in scene order. */
export function buildScenePngZip(input: StandaloneProjectInput): Uint8Array {
  const scenes = requireScenes(input);
  return buildZip(
    scenes.map((scene, i) => ({ name: scenePngEntryName(scene, i), data: scene.framePng })),
  );
}
