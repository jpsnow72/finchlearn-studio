/**
 * Cue points in the editor (issue #64).
 *
 * The editor's project model is the OCF VideoProject, whose VideoScene
 * has no marker field in @finch-studio/core. Until the core types gain
 * one upstream, authored markers live on the scene object itself under
 * `cueMarkers` (the same CueMarker shape @finch-studio/schema defines):
 * the field rides through JSON persistence, project load and save, and
 * scene duplication untouched, and every mutation goes through the
 * store like all other project edits.
 *
 * Export: `withSceneCuePoints` applies a scene's markers to a copy of
 * the scene exactly the way the schema OCF mapping does, so a project
 * handed to FinchLearn (OCF #629) carries native cue points, question
 * and branch cue actions, modal cue-point triggers, and the lossless
 * extensions["x-finch-studio"].cueMarkers copy on the scene's first
 * video object (or the extension copy alone on the first object when
 * the scene has no video object).
 */
import type {
  CourseObject,
  CuePoint,
  Trigger,
  VideoObject,
  VideoScene,
} from "@finch-studio/core";
import {
  CUE_MARKERS_EXTENSION_KEY,
  cueMarkerToOCF,
  type CueBranchChoice,
  type CueMarker,
  type CueQuestionChoice,
} from "@finch-studio/schema";

export type { CueMarker };

/** A VideoScene as the editor stores it, with its authored markers. */
export type SceneWithCueMarkers = VideoScene & { cueMarkers?: CueMarker[] };

export function sceneCueMarkers(scene: VideoScene): CueMarker[] {
  const markers = (scene as SceneWithCueMarkers).cueMarkers ?? [];
  return [...markers].sort((a, b) => a.atMs - b.atMs);
}

export function withSceneCueMarkers(
  scene: VideoScene,
  markers: CueMarker[],
): VideoScene {
  const sorted = [...markers].sort((a, b) => a.atMs - b.atMs);
  const next = { ...scene } as SceneWithCueMarkers;
  if (sorted.length) next.cueMarkers = sorted;
  else delete next.cueMarkers;
  return next;
}

export function clampMarkerMs(atMs: number, sceneDurationMs: number): number {
  if (!Number.isFinite(atMs)) return 0;
  return Math.max(0, Math.min(sceneDurationMs, Math.round(atMs)));
}

/**
 * Return a copy of the scene with its authored markers applied as OCF
 * cue-point metadata (issue #64), mirroring the schema mapping: native
 * cue points and modal triggers on the first video object, extension
 * copy on the host object. Scenes without markers return unchanged.
 */
export function withSceneCuePoints(scene: VideoScene): VideoScene {
  const markers = sceneCueMarkers(scene);
  if (!markers.length || scene.objects.length === 0) return scene;
  const videoIndex = scene.objects.findIndex((o) => o.type === "video");
  const hostIndex = videoIndex >= 0 ? videoIndex : 0;
  const host = scene.objects[hostIndex];
  const normalized = markers.map((marker, i) => ({
    ...marker,
    id: marker.id ?? `cue-${host.id}-${i}`,
  }));
  const studioExtension = {
    ...(host.extensions?.["x-finch-studio"] ?? {}),
    [CUE_MARKERS_EXTENSION_KEY]: normalized,
  };
  let next: CourseObject = {
    ...host,
    extensions: { ...host.extensions, "x-finch-studio": studioExtension },
  };
  if (videoIndex >= 0) {
    const video = next as VideoObject;
    const cuePoints: CuePoint[] = [];
    const triggers: Trigger[] = [...(video.triggers ?? [])];
    normalized.forEach((marker, i) => {
      const converted = cueMarkerToOCF(marker, `cue-${host.id}-${i}`);
      cuePoints.push(converted.cuePoint);
      if (converted.trigger) triggers.push(converted.trigger);
    });
    next = { ...video, cuePoints, triggers: triggers.length ? triggers : undefined };
  }
  const objects = scene.objects.map((o, i) => (i === hostIndex ? next : o));
  return { ...scene, objects };
}

/** Apply cue-point metadata to every scene of a project (issue #64). */
export function projectWithCuePoints<T extends { scenes: VideoScene[] }>(
  project: T,
): T {
  return { ...project, scenes: project.scenes.map(withSceneCuePoints) };
}

// ---------------------------------------------------------------------------
// Text forms used by the cue point editor panel. One choice per line.
// ---------------------------------------------------------------------------

let choiceCounter = 0;
function newChoiceId(prefix: string): string {
  choiceCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${choiceCounter}`;
}

export function questionChoicesToText(choices: CueQuestionChoice[]): string {
  return choices.map((choice) => choice.label).join("\n");
}

/** Parse the question choices textarea; ids stay stable per line index. */
export function parseQuestionChoices(
  text: string,
  previous: CueQuestionChoice[] = [],
): CueQuestionChoice[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((label, i) => ({
      id: previous[i]?.label === label ? previous[i].id : (previous[i]?.id ?? newChoiceId("choice")),
      label,
    }));
}

export function branchChoicesToText(choices: CueBranchChoice[]): string {
  return choices
    .map((choice) => {
      const parts = [choice.label];
      if (choice.jumpToMs !== undefined) parts.push(`@${(choice.jumpToMs / 1000).toFixed(1)}s`);
      if (choice.pageId) parts.push(`-> page ${choice.pageId}`);
      if (choice.videoRef) parts.push(`-> video ${choice.videoRef}`);
      return parts.join(" ");
    })
    .join("\n");
}

/**
 * Parse the branch choices textarea. Each line is a label, optionally
 * followed by `@<seconds>` (jump inside this scene), `-> page <id>`
 * (navigate), or `-> video <id>` (switch video).
 */
export function parseBranchChoices(
  text: string,
  previous: CueBranchChoice[] = [],
): CueBranchChoice[] {
  const choices: CueBranchChoice[] = [];
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .forEach((line, i) => {
      let rest = line;
      let jumpToMs: number | undefined;
      let pageId: string | undefined;
      let videoRef: string | undefined;
      const arrow = rest.match(/->\s*(page|video)\s+(\S+)\s*$/);
      if (arrow) {
        if (arrow[1] === "page") pageId = arrow[2];
        else videoRef = arrow[2];
        rest = rest.slice(0, arrow.index).trim();
      }
      const jump = rest.match(/@\s*(\d+(?:\.\d+)?)\s*s?\s*$/);
      if (jump) {
        jumpToMs = Math.round(Number(jump[1]) * 1000);
        rest = rest.slice(0, jump.index).trim();
      }
      if (!rest) return;
      choices.push({
        id: previous[i]?.label === rest ? previous[i].id : (previous[i]?.id ?? newChoiceId("branch")),
        label: rest,
        jumpToMs,
        pageId,
        videoRef,
      });
    });
  return choices;
}
