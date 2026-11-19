/**
 * AudioPanel: per scene audio clips with the audio engine controls
 * (issue #28): role, fades, and click to add volume keyframes at the
 * playhead. Metadata lives under the object's x-finch-studio extension
 * via the store's audio actions; levels are computed by @finch-studio/audio.
 *
 * Silence tightening (issue #30): per clip detection runs on the ingest
 * waveform peaks via the shared @finch-studio/audio plan, shows the time
 * tightening would save before anything changes, and applies through
 * the store as one undoable ripple trim.
 * playhead. Clean Voice controls (issue #29) live here too: a toggle,
 * an intensity slider, and an A/B original compare per clip. Metadata
 * lives under the object's x-finch-studio extension via the store's
 * audio actions; levels are computed by @finch-studio/audio.
 */
import { useEffect, useState } from "react";
import type { AudioObject } from "@finch-studio/core";
import { DEFAULT_SILENCE_OPTIONS } from "@finch-studio/audio";
import {
  analyzeClipSilence,
  audioRoleForObject,
  getAudioClipMetadata,
  getCleanVoiceSettings,
  type AudioClipRole,
} from "../audioEditing";
import {
  playCleanVoicePreview,
  stopCleanVoicePreview,
  type CleanVoiceCompareMode,
} from "../cleanVoicePreview";
import { timelineLaneForObject, useStudioStore, useCurrentScene, makeStudioAudio } from "../store";

const ROLE_OPTIONS: { value: AudioClipRole; label: string }[] = [
  { value: "voice", label: "Voice" },
  { value: "music", label: "Music" },
  { value: "sfx", label: "Sound effect" },
  { value: "description", label: "Audio description" },
];

export function AudioPanel({ tMs }: { tMs: number }) {
  const scene = useCurrentScene();
  const addObject = useStudioStore((s) => s.addObject);
  const updateAudioMetadata = useStudioStore((s) => s.updateAudioMetadata);
  const addAudioVolumeKeyframe = useStudioStore((s) => s.addAudioVolumeKeyframe);
  const tightenAudioSilence = useStudioStore((s) => s.tightenAudioSilence);
  const [url, setUrl] = useState("");
  const [db, setDb] = useState(0);
  const [thresholdPct, setThresholdPct] = useState(
    Math.round(DEFAULT_SILENCE_OPTIONS.threshold * 100),
  );
  const [minSilenceMs, setMinSilenceMs] = useState(DEFAULT_SILENCE_OPTIONS.minSilenceMs);
  const [keepPauseMs, setKeepPauseMs] = useState(DEFAULT_SILENCE_OPTIONS.keepPauseMs);
  const setCleanVoiceOnAllClips = useStudioStore((s) => s.setCleanVoiceOnAllClips);
  const [url, setUrl] = useState("");
  const [db, setDb] = useState(0);
  const [compareModes, setCompareModes] = useState<Record<string, CleanVoiceCompareMode>>({});
  const [previewStatus, setPreviewStatus] = useState<Record<string, string>>({});

  useEffect(() => stopCleanVoicePreview, []);

  const clips = (scene?.objects ?? []).filter(
    (o): o is AudioObject => o.type === "audio",
  );
  const silenceOptions = {
    threshold: Math.min(50, Math.max(1, thresholdPct || 0)) / 100,
    minSilenceMs: Math.max(0, minSilenceMs || 0),
    keepPauseMs: Math.max(0, keepPauseMs || 0),
  };

  return (
    <div className="panel">
      <div className="panel-title">Audio</div>
      {clips.length === 0 && <p className="muted">No audio clips in this scene yet.</p>}
      {clips.length > 0 && (
        <div className="audio-clip">
          <div className="audio-clip-name">Silence tightening settings</div>
          <label>
            Silence level (% of peak)
            <input
              type="number"
              min={1}
              max={50}
              step={1}
              value={thresholdPct}
              onChange={(e) => setThresholdPct(Number(e.target.value) || 0)}
            />
          </label>
          <label>
            Shortest silence (ms)
            <input
              type="number"
              min={0}
              step={50}
              value={minSilenceMs}
              onChange={(e) => setMinSilenceMs(Number(e.target.value) || 0)}
            />
          </label>
          <label>
            Pause to keep (ms)
            <input
              type="number"
              min={0}
              step={50}
              value={keepPauseMs}
              onChange={(e) => setKeepPauseMs(Number(e.target.value) || 0)}
            />
          </label>
        </div>
      )}
      {clips.map((clip) => {
        const meta = getAudioClipMetadata(clip);
        const analysis = analyzeClipSilence(clip, scene?.durationMs ?? 0, silenceOptions);
        return (
          <div key={clip.id} className="audio-clip">
            <div className="audio-clip-name">{clip.name ?? "Audio clip"}</div>
            <label>
              Role
              <select
                value={audioRoleForObject(clip, timelineLaneForObject(clip))}
                onChange={(e) =>
                  updateAudioMetadata(clip.id, { role: e.target.value as AudioClipRole })
                }
              >
                {ROLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            {audioRoleForObject(clip, timelineLaneForObject(clip)) === "description" && (
              <>
                <label>
                  Description text (for the VTT track)
                  <textarea
                    value={meta.descriptionText ?? ""}
                    onChange={(e) =>
                      updateAudioMetadata(clip.id, { descriptionText: e.target.value })
                    }
                    placeholder="What the description voice says in this clip"
                    rows={2}
                  />
                </label>
                <p className="muted">
                  Audio description: primary audio ducks under this clip in a
                  mixed export, or it exports as its own audio and VTT track.
                  Choose that in the export dialog.
                </p>
              </>
            )}
            <label>
              Fade in (ms)
              <input
                type="number"
                min={0}
                step={100}
                value={meta.fadeInMs ?? 0}
                onChange={(e) =>
                  updateAudioMetadata(clip.id, { fadeInMs: Math.max(0, Number(e.target.value) || 0) })
                }
              />
            </label>
            <label>
              Fade out (ms)
              <input
                type="number"
                min={0}
                step={100}
                value={meta.fadeOutMs ?? 0}
                onChange={(e) =>
                  updateAudioMetadata(clip.id, { fadeOutMs: Math.max(0, Number(e.target.value) || 0) })
                }
              />
            </label>
            <div className="audio-kf-row">
              <input
                type="number"
                min={-60}
                max={6}
                value={db}
                onChange={(e) => setDb(Number(e.target.value) || 0)}
                aria-label="Keyframe level in decibels"
              />
              <button
                type="button"
                onClick={() => addAudioVolumeKeyframe(clip.id, Math.round(tMs), db)}
              >
                Add keyframe at playhead ({Math.round(tMs)} ms)
              </button>
            </div>
            {(meta.volumeKeyframes ?? []).length > 0 && (
              <p className="muted">
                Keyframes: {(meta.volumeKeyframes ?? []).map((k) => `${k.timeMs}ms ${k.decibels}dB`).join(", ")}
              </p>
            )}
            {!analysis.hasPeaks && (
              <p className="muted">
                Silence check needs waveform peaks, which this clip does not have yet.
              </p>
            )}
            {analysis.hasPeaks && analysis.plan.gaps.length === 0 && (
              <p className="muted">No silences found with these settings.</p>
            )}
            {analysis.hasPeaks && analysis.plan.gaps.length > 0 && (
              <>
                <p className="muted">
                  Found {analysis.plan.gaps.length}{" "}
                  {analysis.plan.gaps.length === 1 ? "silence" : "silences"}. Tightening
                  saves {(analysis.plan.totalRemovedMs / 1000).toFixed(1)}s.
                </p>
                <button
                  type="button"
                  disabled={analysis.plan.totalRemovedMs <= 0}
                  onClick={() => tightenAudioSilence(clip.id, silenceOptions)}
                >
                  Tighten silences
                </button>
              </>
            )}
            {(() => {
              const cleanVoice = getCleanVoiceSettings(clip);
              const compareMode = compareModes[clip.id] ?? "cleaned";
              return (
                <div className="clean-voice">
                  <label>
                    Clean Voice
                    <input
                      type="checkbox"
                      aria-label={`Clean Voice for ${clip.name ?? "audio clip"}`}
                      checked={cleanVoice.enabled}
                      onChange={(e) =>
                        updateAudioMetadata(clip.id, {
                          cleanVoice: { ...cleanVoice, enabled: e.target.checked },
                        })
                      }
                    />
                  </label>
                  <label>
                    Intensity ({Math.round(cleanVoice.intensity * 100)}%)
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      aria-label="Clean Voice intensity"
                      disabled={!cleanVoice.enabled}
                      value={Math.round(cleanVoice.intensity * 100)}
                      onChange={(e) =>
                        updateAudioMetadata(clip.id, {
                          cleanVoice: {
                            ...cleanVoice,
                            intensity: Number(e.target.value) / 100,
                          },
                        })
                      }
                    />
                  </label>
                  <div className="clean-voice-compare" role="group" aria-label="Compare original and cleaned audio">
                    <button
                      type="button"
                      aria-pressed={compareMode === "original"}
                      onClick={() => {
                        stopCleanVoicePreview();
                        setCompareModes((modes) => ({ ...modes, [clip.id]: "original" }));
                      }}
                    >
                      A: Original
                    </button>
                    <button
                      type="button"
                      aria-pressed={compareMode === "cleaned"}
                      onClick={() => {
                        stopCleanVoicePreview();
                        setCompareModes((modes) => ({ ...modes, [clip.id]: "cleaned" }));
                      }}
                    >
                      B: Cleaned
                    </button>
                    <button
                      type="button"
                      disabled={!clip.resource}
                      onClick={() => {
                        const resource = clip.resource;
                        if (!resource) return;
                        setPreviewStatus((all) => ({ ...all, [clip.id]: "" }));
                        void playCleanVoicePreview(resource, cleanVoice, compareMode).catch(
                          (err: unknown) =>
                            setPreviewStatus((all) => ({
                              ...all,
                              [clip.id]: err instanceof Error ? err.message : String(err),
                            })),
                        );
                      }}
                    >
                      Play {compareMode === "original" ? "original" : "cleaned"}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCleanVoiceOnAllClips(cleanVoice)}
                  >
                    Apply this Clean Voice setting to all clips in this scene
                  </button>
                  {previewStatus[clip.id] && <p className="muted">{previewStatus[clip.id]}</p>}
                </div>
              );
            })()}
          </div>
        );
      })}
      <div className="audio-add">
        <input
          type="url"
          placeholder="Audio file URL (mp3, wav)"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <button
          type="button"
          disabled={!url.trim()}
          onClick={() => {
            addObject(makeStudioAudio(url.trim(), "Audio clip"));
            setUrl("");
          }}
        >
          Add audio
        </button>
      </div>
    </div>
  );
}
