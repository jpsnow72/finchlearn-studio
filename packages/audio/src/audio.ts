/**
 * Audio engine core (issue #28): the track model and the mixing math the
 * editor and both render paths share. Pure functions over plain data, so
 * preview, client export, and server render mix identically.
 *
 * Track roles: voice, music, sfx, and description (the Audio Description
 * track from the Section 508 issue, #63). Ducking: music and sfx sit under
 * voice by a configurable amount, with smooth attack and release ramps.
 * Manual envelope keyframes (the #27/#28 amendment) override the computed
 * gain at their points.
 */

export type AudioRole = "voice" | "music" | "sfx" | "description";

export interface VolumeKeyframe {
  atMs: number;
  /** Gain multiplier, 0..1.5. */
  gain: number;
}

export interface AudioClip {
  id: string;
  assetR2Key: string;
  role: AudioRole;
  /** Placement on the scene or project timeline. */
  startMs: number;
  durationMs: number;
  sourceInMs: number;
  /** Base gain, 0..1. */
  gain: number;
  fadeInMs: number;
  fadeOutMs: number;
  /** Manual envelope nodes (click to add on the waveform line). */
  envelope?: VolumeKeyframe[];
}

export interface DuckingSettings {
  /** How far under-voice tracks drop while voice is active, in dB. */
  duckDb: number;
  attackMs: number;
  releaseMs: number;
}

export const DEFAULT_DUCKING: DuckingSettings = {
  duckDb: 12,
  attackMs: 120,
  releaseMs: 350,
};

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}
export function gainToDb(gain: number): number {
  return 20 * Math.log10(Math.max(1e-6, gain));
}

function envelopeGainAt(clip: AudioClip, localMs: number): number {
  const nodes = [...(clip.envelope ?? [])].sort((a, b) => a.atMs - b.atMs);
  if (nodes.length === 0) return 1;
  if (localMs <= nodes[0].atMs) return nodes[0].gain;
  const last = nodes[nodes.length - 1];
  if (localMs >= last.atMs) return last.gain;
  for (let i = 0; i < nodes.length - 1; i++) {
    const a = nodes[i];
    const b = nodes[i + 1];
    if (localMs >= a.atMs && localMs <= b.atMs) {
      const span = b.atMs - a.atMs;
      const t = span === 0 ? 1 : (localMs - a.atMs) / span;
      return a.gain + (b.gain - a.gain) * t;
    }
  }
  return last.gain;
}

function fadeGainAt(clip: AudioClip, localMs: number): number {
  let g = 1;
  if (clip.fadeInMs > 0 && localMs < clip.fadeInMs) g = Math.min(g, localMs / clip.fadeInMs);
  const remain = clip.durationMs - localMs;
  if (clip.fadeOutMs > 0 && remain < clip.fadeOutMs) g = Math.min(g, Math.max(0, remain / clip.fadeOutMs));
  return g;
}

/**
 * Voice activity envelope over time: 1 while any voice or description clip
 * is sounding (with attack and release ramps applied at the edges), else 0.
 * Sampled coarsely (per 10 ms step) which is plenty for ducking ramps.
 */
export function voiceActivityAt(clips: AudioClip[], tMs: number, duck: DuckingSettings): number {
  const active = clips.some(
    (c) =>
      (c.role === "voice" || c.role === "description") &&
      tMs >= c.startMs &&
      tMs < c.startMs + c.durationMs,
  );
  if (active) return 1;
  // Release: still ramping down shortly after a voice clip ends.
  let nearestEnd = -Infinity;
  for (const c of clips) {
    if (c.role !== "voice" && c.role !== "description") continue;
    const end = c.startMs + c.durationMs;
    if (end <= tMs && end > nearestEnd) nearestEnd = end;
  }
  if (nearestEnd > -Infinity && tMs - nearestEnd < duck.releaseMs) {
    return 1 - (tMs - nearestEnd) / duck.releaseMs;
  }
  // Attack: ramping up just before a voice clip starts.
  let nearestStart = Infinity;
  for (const c of clips) {
    if (c.role !== "voice" && c.role !== "description") continue;
    if (c.startMs > tMs && c.startMs < nearestStart) nearestStart = c.startMs;
  }
  if (nearestStart < Infinity && nearestStart - tMs < duck.attackMs) {
    return 1 - (nearestStart - tMs) / duck.attackMs;
  }
  return 0;
}

/** The gain one clip contributes at tMs, after fades, envelope, and ducking. */
export function clipGainAt(
  clip: AudioClip,
  allClips: AudioClip[],
  tMs: number,
  duck: DuckingSettings = DEFAULT_DUCKING,
): number {
  const localMs = tMs - clip.startMs;
  if (localMs < 0 || localMs >= clip.durationMs) return 0;
  let g = clip.gain * fadeGainAt(clip, localMs) * envelopeGainAt(clip, localMs);
  const duckable = clip.role === "music" || clip.role === "sfx";
  if (duckable) {
    const activity = voiceActivityAt(allClips, tMs, duck);
    const duckGain = dbToGain(-duck.duckDb * activity);
    g *= duckGain;
  }
  return g;
}

/** Simple peak based loudness normalization factor toward a target in LUFS-ish dB. */
export function normalizeGain(peakGain: number, targetDb = -16): number {
  if (peakGain <= 0) return 1;
  const factor = dbToGain(targetDb) / peakGain;
  return Math.min(factor, 4);
}
