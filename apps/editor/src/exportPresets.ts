import type { CharacterObject, VideoProject } from "@finch-studio/core";
import { projectTimeline } from "@finch-studio/animation";

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

export function getRenderViewport(width: number, height: number) {
  const scale = Math.min(width / 1280, height / 720);
  return {
    scale,
    offsetX: (width - 1280 * scale) / 2,
    offsetY: (height - 720 * scale) / 2,
  };
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
  const cues = scenes.flatMap(({ scene, startMs }) =>
    scene.objects.flatMap((object) => {
      if (object.type !== "character") return [];
      return ((object as CharacterObject).speech ?? []).flatMap((line) => {
        const start = Math.max(0, line.start);
        const end = Math.min(scene.durationMs, line.start + line.duration);
        const text = line.text.trim();
        if (!text || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
          return [];
        }
        return [{ start: startMs + start, end: startMs + end, text }];
      });
    }),
  ).sort((a, b) => a.start - b.start);

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
