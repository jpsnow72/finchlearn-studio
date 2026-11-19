/**
 * Shared input model for the standalone exports (issue #56).
 *
 * The packaging modules are pure: they never render. Scene frames arrive
 * as PNG bytes produced by the editor through the same canvas renderer
 * the MP4 paths use (see apps/editor/src/videoExport.ts,
 * renderProjectSceneFrames), and the SCORM video arrives as the MP4 blob
 * from that same pipeline. Assets are bytes supplied by the caller, never
 * URLs and never viewer identity: a finished package runs entirely
 * offline, honoring the media identity-independence principle.
 */
import { pngInfo } from "./png.js";

export interface StandaloneSceneInput {
  id: string;
  /** Scene title, shown in slide notes and package metadata. */
  name: string;
  /** Dialogue or script lines for the scene, in spoken order. */
  dialogue: string[];
  /** Scene frame PNG, rendered by the shared scene renderer. */
  framePng: Uint8Array;
}

export interface StandaloneProjectInput {
  /** Project title, used in package metadata and file names. */
  name: string;
  scenes: StandaloneSceneInput[];
}

export interface StandaloneVideoInput extends StandaloneProjectInput {
  /** The rendered project video (MP4 bytes from the shared pipeline). */
  videoFileName: string;
  videoBytes: Uint8Array;
}

export function xmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** File-name-safe slug: lowercase words joined with hyphens. */
export function slugifyFilePart(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "scene";
}

/** "scene-01-intro.png" style name for one scene frame inside a package. */
export function sceneFrameFileName(scene: StandaloneSceneInput, index: number): string {
  return `scene-${String(index + 1).padStart(2, "0")}-${slugifyFilePart(scene.name)}.png`;
}

export function requireScenes(project: StandaloneProjectInput): StandaloneSceneInput[] {
  if (!project.name.trim()) throw new Error("The project needs a name before it can be exported.");
  if (!Array.isArray(project.scenes) || project.scenes.length === 0) {
    throw new Error("The project has no scenes to export.");
  }
  project.scenes.forEach((scene, i) => {
    if (!scene.framePng || scene.framePng.length === 0) {
      throw new Error(`Scene ${i + 1} ("${scene.name}") has no rendered frame yet.`);
    }
    // Throws with a precise message when the bytes are not a real PNG.
    pngInfo(scene.framePng);
  });
  return project.scenes;
}

/** Speaker-notes text for one scene: title first, then its script lines. */
export function sceneNotesText(scene: StandaloneSceneInput, index: number, total: number): string {
  const title = scene.name.trim() || `Scene ${index + 1}`;
  const lines = [`${title} (scene ${index + 1} of ${total})`];
  const dialogue = scene.dialogue.map((d) => d.trim()).filter(Boolean);
  if (dialogue.length > 0) {
    lines.push("", "Script:");
    for (const line of dialogue) lines.push(line);
  } else {
    lines.push("", "No dialogue in this scene.");
  }
  return lines.join("\n");
}
