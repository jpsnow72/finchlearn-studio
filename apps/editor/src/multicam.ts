/**
 * multicam.ts: editor bridge for the multicam model (issue #47).
 *
 * The model itself lives in @finch-studio/schema (multicam.ts) and
 * the audio alignment in @finch-studio/media (multicamSync.ts); this
 * module only adapts them to the editor's VideoScene / CourseObject
 * shapes:
 *
 * - The group rides on the scene object as `scene.multicam`. The
 *   core VideoScene type does not declare the field yet, so it is
 *   carried through a narrow intersection type here. Every store
 *   helper spreads scenes, and persistence is JSON, so the group
 *   survives edits, undo, save, and the server render handoff (the
 *   render host loads the same project JSON into the same store).
 * - An angle's sourceId is the id of a "video" object in the scene.
 * - Sync reads the waveform peaks ingest stored on the object under
 *   the x-finch-studio extension (the same convention audio clips
 *   use). No audio is decoded here.
 * - Playback (StudioCanvas) and both browser export paths filter
 *   scene objects through isMulticamObjectVisibleAt below, and the
 *   server path runs the same export code in the render host, so
 *   all three resolve the same segments.
 */
import type { CourseObject, VideoScene } from "@finch-studio/core";
import {
  applyMulticamSync,
  createMulticamGroup,
  newStudioId,
  resolveMulticamAngle,
  type MulticamGroup,
  type MulticamSyncResult,
} from "@finch-studio/schema";
import { alignAudioEnergy, peaksToEnergy } from "@finch-studio/media";

export type SceneWithMulticam = VideoScene & { multicam?: MulticamGroup };

export function getMulticam(scene: VideoScene): MulticamGroup | undefined {
  return (scene as SceneWithMulticam).multicam;
}

export function withMulticam(scene: VideoScene, group: MulticamGroup | null): VideoScene {
  const next = { ...(scene as SceneWithMulticam) };
  if (group) next.multicam = group;
  else delete next.multicam;
  return next as VideoScene;
}

/** Angle id for a source object: stable per group, derived from the object id. */
export function multicamAngleId(sourceObjectId: string): string {
  return `angle-${sourceObjectId}`;
}

/**
 * Build a group for the chosen video objects (at most 3, enforced by
 * the schema factory). Labels come from object names. Returns null
 * when the selection cannot form a group.
 */
export function buildMulticamGroup(
  objects: CourseObject[],
  durationMs: number,
): MulticamGroup | null {
  return createMulticamGroup({
    id: newStudioId("mcgroup"),
    segmentId: newStudioId("mcseg"),
    durationMs,
    angles: objects.map((o, i) => ({
      id: multicamAngleId(o.id),
      label: o.name ?? `Angle ${i + 1}`,
      sourceId: o.id,
    })),
  });
}

/**
 * Whether an object is on screen at a scene time under multicam.
 * Non-angle objects are always visible; an angle object is visible
 * only while its angle is the resolved one. Scenes without a group
 * show everything, exactly as before.
 */
export function isMulticamObjectVisibleAt(
  scene: VideoScene,
  object: CourseObject,
  atMs: number,
): boolean {
  const group = getMulticam(scene);
  if (!group) return true;
  if (!group.angles.some((a) => a.sourceId === object.id)) return true;
  const resolved = resolveMulticamAngle(group, atMs);
  return resolved?.angle.sourceId === object.id;
}

/** Peak magnitudes stored on an object at ingest, when present. */
export function waveformPeaksForObject(object: CourseObject): number[] {
  const raw = object.extensions?.["x-finch-studio"];
  if (!raw || typeof raw !== "object") return [];
  const peaks = (raw as Record<string, unknown>).waveformPeaks;
  if (!Array.isArray(peaks)) return [];
  return peaks.filter(
    (p): p is number => typeof p === "number" && Number.isFinite(p),
  );
}

function clipDurationMs(object: CourseObject, sceneDurationMs: number): number {
  const duration = object.timing?.duration;
  return duration && duration > 0 ? duration * 1000 : sceneDurationMs;
}

export interface EditorMulticamSyncOutcome {
  group: MulticamGroup;
  results: MulticamSyncResult[];
  /** Angles that could not be synced, with the plain reason. */
  unsynced: { angleId: string; label: string; reason: string }[];
}

/**
 * Run audio sync for a scene's group against the objects' stored
 * peaks. The first angle is the reference. An angle without peaks,
 * or whose peaks carry no usable pattern, is reported in `unsynced`
 * and keeps its current offset: the wizard shows the honest state
 * and offers a manual nudge instead of inventing an offset.
 */
export function runMulticamSync(
  scene: VideoScene,
  objects: CourseObject[],
): EditorMulticamSyncOutcome | null {
  const group = getMulticam(scene);
  if (!group) return null;
  const bySource = new Map(objects.map((o) => [o.id, o]));
  const reference = group.angles.find((a) => a.id === group.referenceAngleId);
  const refObject = reference ? bySource.get(reference.sourceId) : undefined;
  const refPeaks = refObject ? waveformPeaksForObject(refObject) : [];
  const results: MulticamSyncResult[] = [];
  const unsynced: EditorMulticamSyncOutcome["unsynced"] = [];

  for (const angle of group.angles) {
    if (reference && angle.id === reference.id) continue;
    const object = bySource.get(angle.sourceId);
    const peaks = object ? waveformPeaksForObject(object) : [];
    if (!object || peaks.length === 0 || refPeaks.length === 0) {
      unsynced.push({
        angleId: angle.id,
        label: angle.label,
        reason: "No audio peaks are stored for this angle yet, so it cannot be synced automatically.",
      });
      continue;
    }
    const bucketMs = clipDurationMs(object, scene.durationMs) / peaks.length;
    const aligned = alignAudioEnergy(peaksToEnergy(refPeaks), peaksToEnergy(peaks), {
      bucketMs,
    });
    if (aligned.quality === "unknown") {
      unsynced.push({
        angleId: angle.id,
        label: angle.label,
        reason: "The audio pattern was too flat or too short to align. Check the offset by hand with the nudge controls.",
      });
      continue;
    }
    results.push({
      angleId: angle.id,
      offsetMs: aligned.offsetMs,
      confidence: aligned.confidence,
      quality: aligned.quality,
    });
  }
  return { group: applyMulticamSync(group, results), results, unsynced };
}
