/**
 * FootagePanel: per scene footage (video) clips with the standard
 * editing controls (issue #25): trim in and out, playback speed, freeze
 * frame, volume, picture-in-picture layout presets, and crop.
 *
 * Edits are non-destructive metadata under the object's x-finch-studio
 * extension via the store's footage action (one undo stack), resolved
 * everywhere through @finch-studio/schema's footage resolver.
 */
import type { VideoObject } from "@finch-studio/core";
import {
  FOOTAGE_PIP_LAYOUTS,
  FOOTAGE_SPEEDS,
  footageSourceAt,
  type FootagePipLayout,
} from "@finch-studio/schema";
import {
  footageClipStartMs,
  getFootageClipMetadata,
  resolveFootageObject,
} from "../footageEditing";
import { useStudioStore, useCurrentScene } from "../store";

const PIP_LABELS: Record<FootagePipLayout, string> = {
  full: "Full frame",
  "top-left": "Top left",
  "top-right": "Top right",
  "bottom-left": "Bottom left",
  "bottom-right": "Bottom right",
  "split-left": "Split left",
  "split-right": "Split right",
};

export function FootagePanel({ tMs }: { tMs: number }) {
  const scene = useCurrentScene();
  const updateFootageMetadata = useStudioStore((s) => s.updateFootageMetadata);

  const clips = (scene?.objects ?? []).filter(
    (o): o is VideoObject => o.type === "video",
  );

  return (
    <div className="panel">
      <div className="panel-title">Footage</div>
      {clips.length === 0 && (
        <p className="muted">No footage clips in this scene yet.</p>
      )}
      {clips.map((clip) => {
        const meta = getFootageClipMetadata(clip);
        const resolved = resolveFootageObject(clip);
        const localMs = tMs - footageClipStartMs(clip);
        const atPlayhead = footageSourceAt(resolved, localMs);
        const crop = resolved.crop ?? { x: 0, y: 0, w: 1, h: 1 };
        const setCrop = (patch: Partial<typeof crop>) =>
          updateFootageMetadata(clip.id, { crop: { ...crop, ...patch } });
        return (
          <div key={clip.id} className="audio-clip">
            <div className="audio-clip-name">{clip.name ?? "Footage clip"}</div>
            <label>
              Trim in (ms)
              <input
                type="number"
                min={0}
                step={100}
                value={Math.round(resolved.sourceInMs)}
                onChange={(e) =>
                  updateFootageMetadata(clip.id, {
                    sourceInMs: Math.max(0, Number(e.target.value) || 0),
                  })
                }
              />
            </label>
            <label>
              Trim out (ms)
              <input
                type="number"
                min={0}
                step={100}
                value={Math.round(resolved.sourceOutMs)}
                onChange={(e) =>
                  updateFootageMetadata(clip.id, {
                    sourceOutMs: Math.max(0, Number(e.target.value) || 0),
                  })
                }
              />
            </label>
            <label>
              Speed
              <select
                value={resolved.speed}
                onChange={(e) =>
                  updateFootageMetadata(clip.id, { speed: Number(e.target.value) })
                }
              >
                {FOOTAGE_SPEEDS.map((speed) => (
                  <option key={speed} value={speed}>
                    {speed}x
                  </option>
                ))}
              </select>
            </label>
            <label>
              Volume ({Math.round(resolved.volume * 100)}%)
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={Math.round(resolved.volume * 100)}
                onChange={(e) =>
                  updateFootageMetadata(clip.id, {
                    volume: (Number(e.target.value) || 0) / 100,
                  })
                }
              />
            </label>
            <div className="audio-kf-row">
              <button
                type="button"
                onClick={() =>
                  updateFootageMetadata(clip.id, {
                    freeze: {
                      atSourceMs: Math.round(atPlayhead.sourceMs),
                      durationMs: resolved.freeze?.durationMs ?? 1000,
                    },
                  })
                }
              >
                Freeze frame at playhead ({Math.round(atPlayhead.sourceMs)} ms)
              </button>
              {resolved.freeze && (
                <button
                  type="button"
                  onClick={() => updateFootageMetadata(clip.id, { freeze: null })}
                >
                  Clear freeze
                </button>
              )}
            </div>
            {resolved.freeze && (
              <label>
                Freeze hold (ms)
                <input
                  type="number"
                  min={100}
                  step={100}
                  value={resolved.freeze.durationMs}
                  onChange={(e) =>
                    updateFootageMetadata(clip.id, {
                      freeze: {
                        atSourceMs: resolved.freeze!.atSourceMs,
                        durationMs: Math.max(0, Number(e.target.value) || 0),
                      },
                    })
                  }
                />
              </label>
            )}
            <label>
              Layout
              <select
                value={resolved.pipLayout ?? ""}
                onChange={(e) => {
                  const value = e.target.value;
                  updateFootageMetadata(clip.id, {
                    pipLayout: value
                      ? (value as FootagePipLayout)
                      : null,
                  });
                }}
              >
                <option value="">No preset</option>
                {FOOTAGE_PIP_LAYOUTS.map((layout) => (
                  <option key={layout} value={layout}>
                    {PIP_LABELS[layout]}
                  </option>
                ))}
              </select>
            </label>
            <div className="audio-kf-row">
              <label>
                Crop X %
                <input
                  type="number"
                  min={0}
                  max={95}
                  value={Math.round(crop.x * 100)}
                  onChange={(e) => setCrop({ x: (Number(e.target.value) || 0) / 100 })}
                />
              </label>
              <label>
                Crop Y %
                <input
                  type="number"
                  min={0}
                  max={95}
                  value={Math.round(crop.y * 100)}
                  onChange={(e) => setCrop({ y: (Number(e.target.value) || 0) / 100 })}
                />
              </label>
              <label>
                Crop W %
                <input
                  type="number"
                  min={5}
                  max={100}
                  value={Math.round(crop.w * 100)}
                  onChange={(e) => setCrop({ w: (Number(e.target.value) || 0) / 100 })}
                />
              </label>
              <label>
                Crop H %
                <input
                  type="number"
                  min={5}
                  max={100}
                  value={Math.round(crop.h * 100)}
                  onChange={(e) => setCrop({ h: (Number(e.target.value) || 0) / 100 })}
                />
              </label>
              {meta.crop && (
                <button
                  type="button"
                  onClick={() => updateFootageMetadata(clip.id, { crop: null })}
                >
                  Clear crop
                </button>
              )}
            </div>
            <p className="muted">
              Timeline duration {(resolved.timelineDurationMs / 1000).toFixed(1)}s
              {resolved.freeze ? `, freeze at ${resolved.freeze.atSourceMs} ms` : ""}
            </p>
          </div>
        );
      })}
    </div>
  );
}
