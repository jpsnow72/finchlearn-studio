/**
 * MulticamPanel: the multicam wizard (issue #47).
 *
 * Three steps in one panel, matching the issue scope: pick up to
 * three camera angles from the scene's video clips, sync them by
 * their audio, then switch the active angle at the playhead. Sync
 * reports the computed offset and a confidence label for every
 * angle, and angles that sync poorly get manual nudge controls.
 * All edits go through the store, so they share the project undo
 * stack. Copy follows the house rule: no em dashes.
 */
import { useState } from "react";
import type { VideoObject } from "@finch-studio/core";
import {
  effectiveAngleOffsetMs,
  resolveMulticamAngle,
  MAX_MULTICAM_ANGLES,
} from "@finch-studio/schema";
import { useStudioStore, useCurrentScene } from "../store";
import {
  getMulticam,
  runMulticamSync,
  type EditorMulticamSyncOutcome,
} from "../multicam";

export function MulticamPanel({ tMs }: { tMs: number }) {
  const scene = useCurrentScene();
  const setupMulticam = useStudioStore((s) => s.setupMulticam);
  const setMulticamGroup = useStudioStore((s) => s.setMulticamGroup);
  const switchAngle = useStudioStore((s) => s.switchMulticamAngle);
  const nudgeAngle = useStudioStore((s) => s.nudgeMulticamAngle);
  const clearMulticam = useStudioStore((s) => s.clearMulticam);
  const [picked, setPicked] = useState<string[]>([]);
  const [lastSync, setLastSync] = useState<EditorMulticamSyncOutcome | null>(null);

  const videos = (scene?.objects ?? []).filter(
    (o): o is VideoObject => o.type === "video",
  );
  const group = scene ? getMulticam(scene) : undefined;
  const playheadMs = Math.round(tMs);

  return (
    <div className="panel">
      <div className="panel-title">Multicam</div>
      {!scene && <p className="muted">No scene selected.</p>}
      {scene && videos.length === 0 && (
        <p className="muted">
          Add at least two video clips of the same moment to this scene, then set up multicam here.
        </p>
      )}

      {scene && videos.length > 0 && !group && (
        <>
          <p className="muted">
            Step 1: pick up to {MAX_MULTICAM_ANGLES} angles of the same moment. The first pick is the reference the others sync to.
          </p>
          {videos.map((clip) => {
            const checked = picked.includes(clip.id);
            const full = !checked && picked.length >= MAX_MULTICAM_ANGLES;
            return (
              <label key={clip.id} className="multicam-angle-pick">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={full}
                  onChange={(e) =>
                    setPicked((prev) =>
                      e.target.checked
                        ? [...prev, clip.id].slice(0, MAX_MULTICAM_ANGLES)
                        : prev.filter((id) => id !== clip.id),
                    )
                  }
                />
                {clip.name ?? clip.resource ?? "Video clip"}
                {full && <span className="muted"> (angle limit reached)</span>}
              </label>
            );
          })}
          <button
            type="button"
            disabled={picked.length < 2}
            onClick={() => {
              setupMulticam(picked);
              setLastSync(null);
            }}
          >
            Set up multicam with {picked.length} angle{picked.length === 1 ? "" : "s"}
          </button>
          {picked.length < 2 && (
            <p className="muted">Pick at least two angles to continue.</p>
          )}
        </>
      )}

      {scene && group && (
        <>
          <p className="muted">
            Step 2: sync the angles by audio. Sync uses the audio peaks saved when each clip was added, so nothing is decoded here.
          </p>
          <button
            type="button"
            onClick={() => {
              const outcome = runMulticamSync(scene, scene.objects);
              if (outcome) {
                setMulticamGroup(outcome.group);
                setLastSync(outcome);
              }
            }}
          >
            Sync angles by audio
          </button>
          {lastSync && (
            <div className="multicam-sync-report" role="status">
              {lastSync.results.map((r) => {
                const angle = group.angles.find((a) => a.id === r.angleId);
                return (
                  <p key={r.angleId} className="muted">
                    {angle?.label ?? r.angleId}: offset {r.offsetMs} ms, confidence{" "}
                    {Math.round(r.confidence * 100)} percent, quality {r.quality}.
                    {r.quality !== "high" && " Check it and nudge by hand if it looks off."}
                  </p>
                );
              })}
              {lastSync.unsynced.map((u) => (
                <p key={u.angleId} className="muted">
                  {u.label}: not synced. {u.reason}
                </p>
              ))}
              {lastSync.results.length === 0 && lastSync.unsynced.length === 0 && (
                <p className="muted">Nothing to sync yet.</p>
              )}
            </div>
          )}

          <p className="muted">Angles in this scene:</p>
          {group.angles.map((angle) => (
            <div key={angle.id} className="multicam-angle-row">
              <div>
                {angle.label}
                {angle.id === group.referenceAngleId && <span className="muted"> (reference)</span>}
              </div>
              <p className="muted">
                {angle.syncQuality
                  ? `Sync offset ${angle.syncOffsetMs} ms, confidence ${Math.round((angle.syncConfidence ?? 0) * 100)} percent, quality ${angle.syncQuality}.`
                  : "Not synced yet."}{" "}
                Nudge {angle.manualNudgeMs} ms. Effective offset {effectiveAngleOffsetMs(angle)} ms.
              </p>
              <div className="multicam-nudge-row">
                <span className="muted">Nudge:</span>
                {[-100, -10, 10, 100].map((delta) => (
                  <button
                    key={delta}
                    type="button"
                    aria-label={`Nudge ${angle.label} by ${delta} ms`}
                    onClick={() => nudgeAngle(angle.id, delta)}
                  >
                    {delta > 0 ? `+${delta}` : delta} ms
                  </button>
                ))}
              </div>
            </div>
          ))}

          <p className="muted">
            Step 3: switch the angle at the playhead ({playheadMs} ms). Switching is an edit you can undo.
          </p>
          <div className="multicam-switch-row">
            {group.angles.map((angle) => {
              const active = resolveMulticamAngle(group, playheadMs)?.angle.id === angle.id;
              return (
                <button
                  key={angle.id}
                  type="button"
                  disabled={active}
                  aria-label={`Switch to ${angle.label} at playhead`}
                  onClick={() => switchAngle(playheadMs, angle.id)}
                >
                  {angle.label}
                  {active ? " (on screen)" : ""}
                </button>
              );
            })}
          </div>
          <p className="muted">Cuts in this scene:</p>
          {group.segments.map((seg) => (
            <p key={seg.id} className="muted">
              {(seg.startMs / 1000).toFixed(1)}s to {(seg.endMs / 1000).toFixed(1)}s:{" "}
              {group.angles.find((a) => a.id === seg.angleId)?.label ?? seg.angleId}
            </p>
          ))}
          <button type="button" onClick={() => { clearMulticam(); setLastSync(null); }}>
            Remove multicam from this scene
          </button>
        </>
      )}
    </div>
  );
}
