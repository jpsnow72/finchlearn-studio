/**
 * AudioPanel: per scene audio clips with the audio engine controls
 * (issue #28): role, fades, and click to add volume keyframes at the
 * playhead. Metadata lives under the object's x-finch-studio extension
 * via the store's audio actions; levels are computed by @finch-studio/audio.
 */
import { useState } from "react";
import type { AudioObject } from "@finch-studio/core";
import { getAudioClipMetadata } from "../audioEditing";
import { useStudioStore, useCurrentScene, makeStudioAudio } from "../store";

export function AudioPanel({ tMs }: { tMs: number }) {
  const scene = useCurrentScene();
  const addObject = useStudioStore((s) => s.addObject);
  const updateAudioMetadata = useStudioStore((s) => s.updateAudioMetadata);
  const addAudioVolumeKeyframe = useStudioStore((s) => s.addAudioVolumeKeyframe);
  const [url, setUrl] = useState("");
  const [db, setDb] = useState(0);

  const clips = (scene?.objects ?? []).filter(
    (o): o is AudioObject => o.type === "audio",
  );

  return (
    <div className="panel">
      <div className="panel-title">Audio</div>
      {clips.length === 0 && <p className="muted">No audio clips in this scene yet.</p>}
      {clips.map((clip) => {
        const meta = getAudioClipMetadata(clip);
        return (
          <div key={clip.id} className="audio-clip">
            <div className="audio-clip-name">{clip.name ?? "Audio clip"}</div>
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
