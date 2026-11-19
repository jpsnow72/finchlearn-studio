/**
 * Multicam model (issue #47): a footage scene can hold up to three
 * camera angles of the same moment, synced by audio, with the viewer
 * facing angle chosen by a list of segments over the scene timeline.
 *
 * This module is the single source of truth for the model. It is
 * additive and backward compatible: a scene without a `multicam`
 * group behaves exactly as before, and every function here is pure
 * (inputs are never mutated), so the editor store can run edits
 * through its shared undo stack and both export paths can resolve
 * the same segments.
 *
 * How #25 (footage trim / speed / crop) composes on top: an angle's
 * `sourceId` is the id of the scene element (schema scenes) or scene
 * object (editor scenes) that carries that angle's footage. Trim,
 * speed, and crop stay on that element / object; this model only
 * decides WHICH source is on screen at a scene time and what source
 * time it shows (scene time plus the angle's effective offset).
 * Nothing here renames or reshapes footage fields.
 */

export const MAX_MULTICAM_ANGLES = 3;

export type MulticamSyncQuality = "high" | "medium" | "low" | "unknown";

export interface MulticamAngle {
  id: string;
  label: string;
  /** Id of the footage element / object carrying this angle. */
  sourceId: string;
  /**
   * Offset found by audio sync, in ms: the source time matching
   * scene time t is t + syncOffsetMs + manualNudgeMs. See the sign
   * convention in @finch-studio/media's multicamSync module.
   */
  syncOffsetMs: number;
  /** User correction on top of the sync offset, in ms. */
  manualNudgeMs: number;
  /** 0..1 confidence from the last sync run; absent before any run. */
  syncConfidence?: number;
  /** Honest quality label from the last sync run. */
  syncQuality?: MulticamSyncQuality;
}

export interface MulticamSegment {
  id: string;
  /** Scene time where this angle takes over, inclusive. */
  startMs: number;
  /** Scene time where this segment ends, exclusive. */
  endMs: number;
  angleId: string;
}

export interface MulticamGroup {
  id: string;
  /** The angle the others were synced against; its offset stays 0. */
  referenceAngleId: string;
  angles: MulticamAngle[];
  segments: MulticamSegment[];
}

export interface MulticamResolution {
  angle: MulticamAngle;
  segment: MulticamSegment;
  /** Source time to show for the requested scene time. */
  sourceMs: number;
}

/** Total offset applied to an angle: sync result plus manual nudge. */
export function effectiveAngleOffsetMs(angle: MulticamAngle): number {
  return angle.syncOffsetMs + angle.manualNudgeMs;
}

let groupCounter = 0;
function fallbackId(prefix: string): string {
  groupCounter += 1;
  return `${prefix}-mc-${Date.now().toString(36)}-${groupCounter}`;
}

/**
 * Create a group from 1 to 3 angle sources. The first angle is the
 * sync reference and one segment shows it for the whole scene, so a
 * freshly created group changes nothing on screen until the user
 * syncs or switches. Returns null when the cap or floor is violated
 * or a source id repeats; callers surface that as a plain refusal.
 */
export function createMulticamGroup(input: {
  id?: string;
  angles: { id: string; label: string; sourceId: string }[];
  durationMs: number;
  segmentId?: string;
}): MulticamGroup | null {
  if (input.angles.length < 1 || input.angles.length > MAX_MULTICAM_ANGLES) return null;
  if (new Set(input.angles.map((a) => a.sourceId)).size !== input.angles.length) return null;
  if (new Set(input.angles.map((a) => a.id)).size !== input.angles.length) return null;
  if (!(input.durationMs > 0)) return null;
  const angles: MulticamAngle[] = input.angles.map((a) => ({
    ...a,
    syncOffsetMs: 0,
    manualNudgeMs: 0,
  }));
  return {
    id: input.id ?? fallbackId("group"),
    referenceAngleId: angles[0].id,
    angles,
    segments: [
      {
        id: input.segmentId ?? fallbackId("seg"),
        startMs: 0,
        endMs: input.durationMs,
        angleId: angles[0].id,
      },
    ],
  };
}

export type AddAngleResult =
  | { ok: true; group: MulticamGroup }
  | { ok: false; error: string };

/** Add one angle, enforcing the three angle cap. Pure. */
export function addMulticamAngle(
  group: MulticamGroup,
  angle: { id: string; label: string; sourceId: string },
): AddAngleResult {
  if (group.angles.length >= MAX_MULTICAM_ANGLES) {
    return { ok: false, error: `A multicam scene holds at most ${MAX_MULTICAM_ANGLES} angles.` };
  }
  if (group.angles.some((a) => a.id === angle.id)) {
    return { ok: false, error: `Duplicate angle id "${angle.id}".` };
  }
  if (group.angles.some((a) => a.sourceId === angle.sourceId)) {
    return { ok: false, error: "That footage is already an angle in this scene." };
  }
  return {
    ok: true,
    group: {
      ...group,
      angles: [...group.angles, { ...angle, syncOffsetMs: 0, manualNudgeMs: 0 }],
    },
  };
}

/** Segments sorted by start, zero length segments dropped, adjacent
 * segments showing the same angle merged. Pure. */
export function normalizeMulticamSegments(segments: MulticamSegment[]): MulticamSegment[] {
  const sorted = [...segments]
    .filter((s) => s.endMs > s.startMs)
    .sort((a, b) => a.startMs - b.startMs);
  const out: MulticamSegment[] = [];
  for (const seg of sorted) {
    const prev = out[out.length - 1];
    if (prev && prev.angleId === seg.angleId && prev.endMs >= seg.startMs) {
      prev.endMs = Math.max(prev.endMs, seg.endMs);
    } else {
      out.push({ ...seg });
    }
  }
  return out;
}

/**
 * Resolve which angle is on screen at a scene time. Segments are
 * consulted in order; a time inside no segment falls back to the
 * nearest segment that started earlier, then to the first segment,
 * so playback and exports never show a blank multicam scene. Times
 * outside the scene clamp to the nearest edge segment.
 */
export function resolveMulticamAngle(
  group: MulticamGroup,
  atMs: number,
): MulticamResolution | null {
  const segments = normalizeMulticamSegments(group.segments);
  if (segments.length === 0 || group.angles.length === 0) return null;
  const t = Math.max(0, atMs);
  let segment = segments.find((s) => t >= s.startMs && t < s.endMs);
  if (!segment) {
    const earlier = segments.filter((s) => s.startMs <= t);
    segment = earlier[earlier.length - 1] ?? segments[0];
  }
  const angle = group.angles.find((a) => a.id === segment.angleId) ?? group.angles[0];
  return { angle, segment, sourceMs: t + effectiveAngleOffsetMs(angle) };
}

/**
 * Switch the on-screen angle at a scene time: the segment covering
 * that time splits there and shows the new angle until its original
 * end; later segments keep their own cuts. Switching to the angle
 * already on screen is a no-op (the same group is returned). Pure,
 * so the caller can treat the result as one undoable edit.
 */
export function switchMulticamAngle(
  group: MulticamGroup,
  atMs: number,
  angleId: string,
  newSegmentId: string,
): MulticamGroup {
  if (!group.angles.some((a) => a.id === angleId)) return group;
  const segments = normalizeMulticamSegments(group.segments);
  const t = Math.max(0, Math.round(atMs));
  const covering = segments.find((s) => t >= s.startMs && t < s.endMs);
  if (!covering || covering.angleId === angleId) return group;
  const next: MulticamSegment[] = [];
  for (const seg of segments) {
    if (seg.id !== covering.id) {
      next.push(seg);
      continue;
    }
    if (t > seg.startMs) next.push({ ...seg, endMs: t });
    next.push({ id: newSegmentId, startMs: t, endMs: seg.endMs, angleId });
  }
  return { ...group, segments: normalizeMulticamSegments(next) };
}

/** Adjust one angle's manual nudge by a delta, in ms. Pure. */
export function nudgeMulticamAngle(
  group: MulticamGroup,
  angleId: string,
  deltaMs: number,
): MulticamGroup {
  if (!group.angles.some((a) => a.id === angleId)) return group;
  return {
    ...group,
    angles: group.angles.map((a) =>
      a.id === angleId ? { ...a, manualNudgeMs: a.manualNudgeMs + Math.round(deltaMs) } : a,
    ),
  };
}

/** Set one angle's manual nudge to an absolute value, in ms. Pure. */
export function setMulticamAngleNudge(
  group: MulticamGroup,
  angleId: string,
  nudgeMs: number,
): MulticamGroup {
  if (!group.angles.some((a) => a.id === angleId)) return group;
  return {
    ...group,
    angles: group.angles.map((a) =>
      a.id === angleId ? { ...a, manualNudgeMs: Math.round(nudgeMs) } : a,
    ),
  };
}

export interface MulticamSyncResult {
  angleId: string;
  offsetMs: number;
  confidence: number;
  quality: MulticamSyncQuality;
}

/**
 * Record a sync run on the group: each listed angle takes the
 * computed offset and its honest confidence / quality. The reference
 * angle and unlisted angles are untouched, and manual nudges are
 * preserved so a re-sync never silently discards a user correction.
 * Pure.
 */
export function applyMulticamSync(
  group: MulticamGroup,
  results: MulticamSyncResult[],
): MulticamGroup {
  const byId = new Map(results.map((r) => [r.angleId, r]));
  return {
    ...group,
    angles: group.angles.map((a) => {
      const r = byId.get(a.id);
      if (!r || a.id === group.referenceAngleId) return a;
      return {
        ...a,
        syncOffsetMs: Math.round(r.offsetMs),
        syncConfidence: Math.min(1, Math.max(0, r.confidence)),
        syncQuality: r.quality,
      };
    }),
  };
}

/** Structural problems with a group (empty = valid). */
export function validateMulticamGroup(
  group: MulticamGroup,
  sceneDurationMs?: number,
): string[] {
  const problems: string[] = [];
  if (group.angles.length === 0) problems.push("Multicam group has no angles.");
  if (group.angles.length > MAX_MULTICAM_ANGLES) {
    problems.push(`Multicam group has ${group.angles.length} angles; the maximum is ${MAX_MULTICAM_ANGLES}.`);
  }
  const angleIds = new Set<string>();
  for (const a of group.angles) {
    if (angleIds.has(a.id)) problems.push(`Duplicate multicam angle id "${a.id}".`);
    angleIds.add(a.id);
    if (!a.sourceId) problems.push(`Multicam angle "${a.id}" is missing its footage source.`);
  }
  if (!angleIds.has(group.referenceAngleId)) {
    problems.push("Multicam reference angle is not one of the group angles.");
  }
  const segmentIds = new Set<string>();
  for (const s of group.segments) {
    if (segmentIds.has(s.id)) problems.push(`Duplicate multicam segment id "${s.id}".`);
    segmentIds.add(s.id);
    if (!angleIds.has(s.angleId)) {
      problems.push(`Multicam segment "${s.id}" points at unknown angle "${s.angleId}".`);
    }
    if (!(s.endMs > s.startMs)) problems.push(`Multicam segment "${s.id}" ends before it starts.`);
    if (sceneDurationMs !== undefined && (s.startMs < 0 || s.endMs > sceneDurationMs)) {
      problems.push(`Multicam segment "${s.id}" sits outside the scene.`);
    }
  }
  return problems;
}
