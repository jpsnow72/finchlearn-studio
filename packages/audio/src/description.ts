/**
 * Audio Description export planning (issue #63, Section 508).
 *
 * The dedicated "description" track role can leave the project two ways:
 * - "mixed": the AD clips are mixed into the main audio, and primary
 *   audio auto-ducks under them (see clipGainAt in audio.ts).
 * - "secondary": the AD clips are kept OUT of the main mix and exported
 *   as their own audio track, plus a timed VTT track built from each
 *   clip's descriptionText, delivered alongside the captions track.
 *
 * This module is the pure planning layer both render paths share: given
 * the project's clips it decides which clips land in which output and
 * renders the VTT text, so client and server exports cannot drift.
 */
import type { AudioClip } from "./audio.js";

/** How the Audio Description track leaves the project. */
export type DescriptionExportMode = "mixed" | "secondary";

export interface DescriptionCue {
  clipId: string;
  /** Ms from project start. */
  startMs: number;
  /** Ms from project start. */
  endMs: number;
  text: string;
}

export interface AudioExportPlan {
  mode: DescriptionExportMode;
  /** Clips that belong in the main (programme) mix for this mode. */
  mixedClips: AudioClip[];
  /** Description clips exported as the secondary track (secondary mode only). */
  secondaryClips: AudioClip[];
  /** Timed description cues for the secondary VTT track. */
  descriptionCues: DescriptionCue[];
  /** VTT file contents for the description track, or null when there is no AD. */
  descriptionVtt: string | null;
  /** True when the plan carries any description clips at all. */
  hasDescription: boolean;
}

export function isDescriptionClip(clip: AudioClip): boolean {
  return clip.role === "description";
}

/** Description clips in timeline order, as timed VTT cues. Clips without
 * script text produce no cue (the audio still exports; there is simply
 * nothing to put on the text track for that span). */
export function descriptionCues(clips: AudioClip[]): DescriptionCue[] {
  return clips
    .filter(isDescriptionClip)
    .map((clip) => ({
      clipId: clip.id,
      startMs: Math.max(0, clip.startMs),
      endMs: Math.max(0, clip.startMs) + Math.max(0, clip.durationMs),
      text: (clip.descriptionText ?? "").trim(),
    }))
    .filter((cue) => cue.text.length > 0 && cue.endMs > cue.startMs)
    .sort((a, b) => a.startMs - b.startMs);
}

function vttTimestamp(ms: number): string {
  const total = Math.max(0, Math.round(ms));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1000);
  const millis = total % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

/** The WebVTT file for the description track (header only when the AD
 * clips carry no script text yet). */
export function formatDescriptionVtt(clips: AudioClip[]): string {
  const cues = descriptionCues(clips);
  const body = cues
    .map(
      (cue, i) =>
        `${i + 1}\n${vttTimestamp(cue.startMs)} --> ${vttTimestamp(cue.endMs)}\n${cue.text}`,
    )
    .join("\n\n");
  return `WEBVTT\n\n${body}${body ? "\n" : ""}`;
}

/**
 * Plan an audio export. In mixed mode every clip is in the main mix and
 * there is no secondary output. In secondary mode the description clips
 * are removed from the main mix and returned as the secondary track,
 * with their VTT text rendered from the same clip list.
 */
export function planAudioExport(
  clips: AudioClip[],
  mode: DescriptionExportMode,
): AudioExportPlan {
  const description = clips.filter(isDescriptionClip);
  const hasDescription = description.length > 0;
  if (mode === "secondary") {
    return {
      mode,
      mixedClips: clips.filter((c) => !isDescriptionClip(c)),
      secondaryClips: description,
      descriptionCues: descriptionCues(clips),
      descriptionVtt: hasDescription ? formatDescriptionVtt(clips) : null,
      hasDescription,
    };
  }
  return {
    mode: "mixed",
    mixedClips: [...clips],
    secondaryClips: [],
    descriptionCues: descriptionCues(clips),
    descriptionVtt: null,
    hasDescription,
  };
}

// ---------------------------------------------------------------------------
// Secondary audio serialization
// ---------------------------------------------------------------------------

/** The slice of an AudioBuffer the WAV writer needs (structural, so
 * tests can pass a plain fake without a Web Audio context). */
export interface PcmBufferLike {
  numberOfChannels: number;
  sampleRate: number;
  length: number;
  getChannelData(channel: number): Float32Array;
}

/**
 * Encode a rendered PCM buffer as a 16-bit WAV file. The secondary AD
 * track is delivered as its own audio file next to the main export, and
 * WAV is the lossless, universally playable container for that hand-off
 * (the server render path can transcode it the same way it transcodes
 * the main WebM, which is noted as ship-point work).
 */
export function encodeWav(buffer: PcmBufferLike): Uint8Array {
  const channels = Math.max(1, buffer.numberOfChannels);
  const frames = Math.max(0, buffer.length);
  const bytesPerSample = 2;
  const dataBytes = frames * channels * bytesPerSample;
  const out = new Uint8Array(44 + dataBytes);
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  const writeAscii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, dataBytes, true);
  const channelData: Float32Array[] = [];
  for (let ch = 0; ch < channels; ch++) channelData.push(buffer.getChannelData(ch));
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < channels; ch++) {
      const sample = Math.max(-1, Math.min(1, channelData[ch][i] ?? 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return out;
}
