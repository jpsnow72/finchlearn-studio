/**
 * Timeline — scene preview controls and audio clip editing.
 */
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { projectTimeline } from "@finch-studio/animation";
import type { AudioObject } from "@finch-studio/core";
import {
  getAudioClipMetadata,
  volumeToDecibels,
} from "../audioEditing";
import { useStudioStore } from "../store";

interface Region {
  startMs: number;
  endMs: number;
}

export function Timeline({
  playing,
  setPlaying,
  tMs,
  setTMs,
}: {
  playing: boolean;
  setPlaying: (v: boolean) => void;
  tMs: number | null;
  setTMs: (ms: number | null) => void;
}) {
  const project = useStudioStore((s) => s.project);
  const currentSceneId = useStudioStore((s) => s.currentSceneId);
  const selectScene = useStudioStore((s) => s.selectScene);
  const rippleDeleteAudioRegion = useStudioStore((s) => s.rippleDeleteAudioRegion);
  const [region, setRegion] = useState<Region | null>(null);
  const regionStart = useRef<number | null>(null);

  const idx = project.scenes.findIndex((s) => s.id === currentSceneId);
  const scene = project.scenes[idx];
  const local = tMs ?? 0;
  const sceneDuration = scene?.durationMs ?? 0;
  const audioClips = scene?.objects.filter(
    (object): object is AudioObject => object.type === "audio",
  ) ?? [];

  function getRegionTime(event: ReactPointerEvent<HTMLDivElement>): number {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width) return 0;
    return Math.max(
      0,
      Math.min(sceneDuration, ((event.clientX - bounds.left) / bounds.width) * sceneDuration),
    );
  }

  function beginRegion(event: ReactPointerEvent<HTMLDivElement>) {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const time = getRegionTime(event);
    regionStart.current = time;
    setRegion({ startMs: time, endMs: time });
  }

  function moveRegion(event: ReactPointerEvent<HTMLDivElement>) {
    if (regionStart.current === null) return;
    setRegion({ startMs: regionStart.current, endMs: getRegionTime(event) });
  }

  function finishRegion(event: ReactPointerEvent<HTMLDivElement>) {
    if (regionStart.current === null) return;
    const time = getRegionTime(event);
    const startMs = Math.min(regionStart.current, time);
    const endMs = Math.max(regionStart.current, time);
    regionStart.current = null;
    setRegion(endMs - startMs >= 33 ? { startMs, endMs } : null);
  }

  return (
    <div className="timeline">
      <div className="timeline-scenes">
        {project.scenes.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`tl-scene${s.id === currentSceneId ? " active" : ""}`}
            style={{ flexGrow: s.durationMs }}
            onClick={() => {
              selectScene(s.id);
              setTMs(null);
              setRegion(null);
            }}
            title={`${s.name} - ${(s.durationMs / 1000).toFixed(1)}s`}
          >
            {s.name}
          </button>
        ))}
      </div>
      <div className="timeline-controls">
        <button
          type="button"
          onClick={() => setPlaying(!playing)}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? "⏸" : "▶"}
        </button>
        <input
          type="range"
          min={0}
          max={sceneDuration}
          step={33}
          value={Math.min(local, sceneDuration)}
          onChange={(e) => {
            setPlaying(false);
            setTMs(parseInt(e.target.value, 10));
          }}
          aria-label="Scrub scene"
        />
        <span className="tl-time">
          {(local / 1000).toFixed(1)}s / {(sceneDuration / 1000).toFixed(1)}s
        </span>
        <span className="tl-time muted">
          Export: {(projectTimeline(project).totalMs / 1000).toFixed(1)}s total
        </span>
      </div>
      {audioClips.length > 0 && (
        <section className="timeline-audio" aria-label="Audio timeline">
          <div className="timeline-region-row">
            <span className="audio-track-label">Edit region</span>
            <div
              className="timeline-region-ruler"
              onPointerDown={beginRegion}
              onPointerMove={moveRegion}
              onPointerUp={finishRegion}
              onPointerCancel={() => {
                regionStart.current = null;
                setRegion(null);
              }}
              aria-label="Drag to select an audio region"
              role="slider"
              aria-valuemin={0}
              aria-valuemax={sceneDuration}
              aria-valuenow={region ? Math.round(region.startMs) : 0}
            >
              {region && (
                <span
                  className="audio-region-selection"
                  style={{
                    left: `${(Math.min(region.startMs, region.endMs) / sceneDuration) * 100}%`,
                    width: `${(Math.abs(region.endMs - region.startMs) / sceneDuration) * 100}%`,
                  }}
                />
              )}
            </div>
          </div>
          {audioClips.map((clip) => (
            <AudioClipTrack
              key={clip.id}
              clip={clip}
              sceneDurationMs={sceneDuration}
            />
          ))}
          <div className="audio-region-actions">
            <span className="tl-time muted">
              {region && region.endMs > region.startMs
                ? `Selected ${(region.startMs / 1000).toFixed(2)}s to ${(region.endMs / 1000).toFixed(2)}s`
                : "Drag above to select a region"}
            </span>
            <button
              type="button"
              disabled={!region || region.endMs <= region.startMs}
              onClick={() => {
                if (!region) return;
                rippleDeleteAudioRegion(region.startMs, region.endMs);
                setRegion(null);
              }}
            >
              Ripple delete region
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function AudioClipTrack({
  clip,
  sceneDurationMs,
}: {
  clip: AudioObject;
  sceneDurationMs: number;
}) {
  const updateAudioMetadata = useStudioStore((s) => s.updateAudioMetadata);
  const addAudioVolumeKeyframe = useStudioStore((s) => s.addAudioVolumeKeyframe);
  const updateObject = useStudioStore((s) => s.updateObject);
  const clipStartMs = Math.max(0, (clip.timing?.start ?? 0) * 1000);
  const durationMs = Math.max(
    1,
    (clip.timing?.duration ?? sceneDurationMs / 1000) * 1000,
  );
  const metadata = getAudioClipMetadata(clip);
  const peaks = metadata.waveformPeaks ?? [];
  const keyframes = metadata.volumeKeyframes ?? [];
  const fadeInMs = Math.min(durationMs, metadata.fadeInMs ?? 0);
  const fadeOutMs = Math.min(durationMs, metadata.fadeOutMs ?? 0);
  const volumeDb = volumeToDecibels(clip.volume ?? 1);
  const left = (clipStartMs / sceneDurationMs) * 100;
  const width = (durationMs / sceneDurationMs) * 100;

  function setFade(direction: "fadeInMs" | "fadeOutMs", value: number) {
    updateAudioMetadata(clip.id, {
      [direction]: Math.max(0, Math.min(durationMs, value)),
    });
  }

  function addKeyframe(event: ReactPointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const fraction = Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width));
    const vertical = Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height));
    const decibels = 6 - vertical * 66;
    addAudioVolumeKeyframe(clip.id, fraction * durationMs, decibels);
  }

  const envelope = [
    { timeMs: 0, decibels: volumeDb },
    ...keyframes,
    { timeMs: durationMs, decibels: volumeDb },
  ]
    .sort((a, b) => a.timeMs - b.timeMs)
    .filter((point, index, points) => index === 0 || point.timeMs !== points[index - 1].timeMs)
    .map((point) => ({
      x: (Math.min(durationMs, Math.max(0, point.timeMs)) / durationMs) * 100,
      y: 48 - ((Math.min(6, Math.max(-60, point.decibels)) + 60) / 66) * 48,
    }));

  return (
    <div className="timeline-audio-track">
      <span className="audio-track-label" title={clip.name ?? clip.resource ?? "Audio clip"}>
        {clip.name ?? clip.resource?.split("/").pop() ?? "Audio clip"}
      </span>
      <div className="timeline-audio-lane">
        <div
          className="audio-clip"
          style={{ left: `${left}%`, width: `${width}%` }}
          aria-label={`${clip.name ?? "Audio clip"} waveform`}
        >
          {peaks.length > 0 ? (
            <svg className="audio-waveform" viewBox="0 0 100 48" preserveAspectRatio="none" aria-hidden="true">
              {peaks.map((peak, index) => {
                const amplitude = Math.min(1, Math.max(0, Math.abs(peak)));
                const x = ((index + 0.5) / peaks.length) * 100;
                const halfHeight = Math.max(1, amplitude * 21);
                return (
                  <line
                    key={index}
                    x1={x}
                    x2={x}
                    y1={24 - halfHeight}
                    y2={24 + halfHeight}
                  />
                );
              })}
            </svg>
          ) : (
            <span className="audio-waveform-empty">Waveform peaks unavailable</span>
          )}
          <svg
            className="audio-volume-envelope"
            viewBox="0 0 100 48"
            preserveAspectRatio="none"
            role="button"
            tabIndex={0}
            aria-label="Click to add a volume keyframe"
            onClick={addKeyframe}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                const bounds = event.currentTarget.getBoundingClientRect();
                if (bounds.width && bounds.height) {
                  const x = event.key === "Enter" ? bounds.width / 2 : 0;
                  addAudioVolumeKeyframe(clip.id, (x / bounds.width) * durationMs, volumeDb);
                }
                event.preventDefault();
              }
            }}
          >
            <polyline
              points={envelope.map((point) => `${point.x},${point.y}`).join(" ")}
            />
            {keyframes.map((keyframe) => (
              <circle
                key={`${keyframe.timeMs}-${keyframe.decibels}`}
                cx={(Math.min(durationMs, Math.max(0, keyframe.timeMs)) / durationMs) * 100}
                cy={48 - ((Math.min(6, Math.max(-60, keyframe.decibels)) + 60) / 66) * 48}
                r="2"
              />
            ))}
          </svg>
          <FadeHandle
            label="Fade in"
            direction="fadeInMs"
            value={fadeInMs}
            durationMs={durationMs}
            onChange={(value) => setFade("fadeInMs", value)}
          />
          <FadeHandle
            label="Fade out"
            direction="fadeOutMs"
            value={fadeOutMs}
            durationMs={durationMs}
            onChange={(value) => setFade("fadeOutMs", value)}
          />
        </div>
      </div>
      <div className="audio-clip-controls">
        <label>
          Fade in ms
          <input
            type="number"
            min={0}
            max={durationMs}
            value={Math.round(fadeInMs)}
            onChange={(event) => setFade("fadeInMs", Number(event.target.value))}
          />
        </label>
        <label>
          Fade out ms
          <input
            type="number"
            min={0}
            max={durationMs}
            value={Math.round(fadeOutMs)}
            onChange={(event) => setFade("fadeOutMs", Number(event.target.value))}
          />
        </label>
        <label>
          Volume dB
          <input
            type="number"
            min={-60}
            max={6}
            step={0.1}
            value={Number(volumeDb.toFixed(1))}
            onChange={(event) =>
              updateObject(clip.id, { volume: 10 ** (Number(event.target.value) / 20) })
            }
          />
        </label>
      </div>
    </div>
  );
}

function FadeHandle({
  label,
  direction,
  value,
  durationMs,
  onChange,
}: {
  label: string;
  direction: "fadeInMs" | "fadeOutMs";
  value: number;
  durationMs: number;
  onChange: (value: number) => void;
}) {
  const drag = useRef<{ x: number; value: number; width: number } | null>(null);
  const fadeFraction = Math.min(1, Math.max(0, value / durationMs));
  const style = {
    [direction === "fadeInMs" ? "left" : "right"]: `${fadeFraction * 100}%`,
  };

  return (
    <button
      type="button"
      className={`audio-fade-handle ${direction}`}
      style={style}
      aria-label={`Drag ${label.toLowerCase()} handle`}
      title={`${label}: ${Math.round(value)} ms`}
      onPointerDown={(event) => {
        const bounds = event.currentTarget.parentElement?.getBoundingClientRect();
        drag.current = {
          x: event.clientX,
          value,
          width: bounds?.width ?? 0,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!drag.current || !drag.current.width) return;
        const delta =
          ((event.clientX - drag.current.x) / drag.current.width) *
          durationMs *
          (direction === "fadeInMs" ? 1 : -1);
        onChange(drag.current.value + delta);
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
    />
  );
}
