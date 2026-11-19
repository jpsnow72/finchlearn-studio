import type {
  CharacterObject,
  ProjectAspect,
  VideoProject,
} from "@finch-studio/core";
import { projectTimeline, stageDimensions } from "@finch-studio/animation";
import { getCaptionCues } from "./captions";

export type ExportPresetId =
  | "lms"
  | "mp4-720"
  | "mp4-1080"
  | "youtube-1080"
  | "youtube-720"
  | "shorts"
  | "gif"
  | "audio"
  | "srt"
  | "vtt";

export interface ExportPreset {
  id: ExportPresetId;
  label: string;
  kind: "video" | "mp4" | "gif" | "audio" | "captions";
  width?: number;
  height?: number;
  captionFormat?: "srt" | "vtt";
}

/**
 * Fit a stage frame into an output frame, letterboxed and centered.
 * The stage defaults to the 16:9 stage (1280x720); portrait and square
 * projects pass their own stage dimensions so exports frame the stage
 * the author actually saw (issue #13).
 */
export function getRenderViewport(
  width: number,
  height: number,
  stage: { width: number; height: number } = { width: 1280, height: 720 },
) {
  const scale = Math.min(width / stage.width, height / stage.height);
  return {
    scale,
    offsetX: (width - stage.width * scale) / 2,
    offsetY: (height - stage.height * scale) / 2,
  };
}

/** The stage frame a project renders from, for export callers. */
export function projectStageDimensions(project: VideoProject): {
  width: number;
  height: number;
} {
  return stageDimensions(project);
}

function even(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

/**
 * Output dimensions for a preset at a project aspect (issue #13).
 * A preset fixes a resolution tier (its short side: 720 or 1080); the
 * project aspect fixes the shape, so a 9:16 project exports portrait
 * and a 1:1 project exports square instead of always 16:9. Presets
 * without dimensions (GIF, audio, captions) pass through unchanged.
 */
export function exportDimensionsForAspect(
  preset: ExportPreset,
  aspect: ProjectAspect,
): { width: number; height: number } | undefined {
  if (preset.width === undefined || preset.height === undefined) {
    return undefined;
  }
  const tier = Math.min(preset.width, preset.height);
  switch (aspect) {
    case "9:16":
      return { width: tier, height: even((tier * 16) / 9) };
    case "1:1":
      return { width: tier, height: tier };
    case "16:9":
    default:
      return { width: even((tier * 16) / 9), height: tier };
  }
}

/** A preset with its dimensions resolved for the project's aspect. */
export function resolveExportPreset(
  id: ExportPresetId,
  aspect: ProjectAspect,
): ExportPreset {
  const preset = getExportPreset(id);
  const dims = exportDimensionsForAspect(preset, aspect);
  return dims ? { ...preset, ...dims } : preset;
}

export const EXPORT_PRESETS: ExportPreset[] = [
  { id: "lms", label: "LMS video (720p)", kind: "video", width: 1280, height: 720 },
  { id: "mp4-720", label: "MP4 fast export (720p)", kind: "mp4", width: 1280, height: 720 },
  { id: "mp4-1080", label: "MP4 fast export (1080p)", kind: "mp4", width: 1920, height: 1080 },
  { id: "youtube-1080", label: "YouTube 1080p", kind: "video", width: 1920, height: 1080 },
  { id: "youtube-720", label: "YouTube 720p", kind: "video", width: 1280, height: 720 },
  { id: "shorts", label: "Shorts (9:16)", kind: "video", width: 1080, height: 1920 },
  { id: "gif", label: "GIF", kind: "gif" },
  { id: "audio", label: "Audio only", kind: "audio" },
  { id: "srt", label: "SRT captions", kind: "captions", captionFormat: "srt" },
  { id: "vtt", label: "VTT captions", kind: "captions", captionFormat: "vtt" },
];

export function getExportPreset(id: ExportPresetId): ExportPreset {
  return EXPORT_PRESETS.find((preset) => preset.id === id)!;
}

export function exportFileBaseName(name: string): string {
  return name
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/^\.+|\.+$/g, "")
    .trim() || "video";
}

export function formatCaptions(
  project: VideoProject,
  format: "srt" | "vtt",
): string {
  const { scenes } = projectTimeline(project);
  const cueByScene = new Map(scenes.map(({ scene, startMs }) => [scene.id, { scene, startMs }]));
  const cues = getCaptionCues(project).flatMap((cue) => {
    const scene = cueByScene.get(cue.sceneId);
    if (!scene) return [];
    const start = Math.max(0, cue.startMs);
    const end = Math.min(scene.scene.durationMs, cue.startMs + cue.durationMs);
    const text = cue.text.trim();
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return [];
    }
    return [{
      start: scene.startMs + start,
      end: scene.startMs + end,
      text,
    }];
  }).sort((a, b) => a.start - b.start);

  const timestamp = (ms: number) => {
    const total = Math.max(0, Math.round(ms));
    const hours = Math.floor(total / 3_600_000);
    const minutes = Math.floor((total % 3_600_000) / 60_000);
    const seconds = Math.floor((total % 60_000) / 1000);
    const millis = total % 1000;
    const fraction = String(millis).padStart(3, "0");
    const separator = format === "srt" ? "," : ".";
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${separator}${fraction}`;
  };

  const output = cues.map(
    (cue, index) =>
      `${index + 1}\n${timestamp(cue.start)} --> ${timestamp(cue.end)}\n${cue.text}`,
  );
  return format === "vtt"
    ? `WEBVTT\n\n${output.join("\n\n")}${output.length ? "\n" : ""}`
    : output.join("\n\n");
}
