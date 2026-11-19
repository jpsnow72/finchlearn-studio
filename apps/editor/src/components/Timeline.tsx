/**
 * Per-scene timeline with a fixed set of four lanes.
 */
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { projectTimeline } from "@finch-studio/animation";
import {
  TIMELINE_LANES,
  timelineClipRange,
  timelineLaneForObject,
  snapTimelineTime,
  useStudioStore,
  type TimelineLane,
} from "../store";

const LANE_LABELS: Record<TimelineLane, string> = {
  main: "Main",
  overlay: "Overlay",
  voice: "Voice",
  music: "Music",
};

interface ClipDrag {
  id: string;
  edge: "start" | "end";
  startMs: number;
  durationMs: number;
  pointerX: number;
}

export function Timeline({
  playing,
  setPlaying,
  tMs,
  setTMs,
}: {
  playing: boolean;
  setPlaying: (v: boolean) => void;
  tMs: number;
  setTMs: (ms: number) => void;
}) {
  const project = useStudioStore((s) => s.project);
  const currentSceneId = useStudioStore((s) => s.currentSceneId);
  const selectedClipId = useStudioStore((s) => s.selectedTimelineClipId);
  const snapEnabled = useStudioStore((s) => s.timelineSnapEnabled);
  const selectScene = useStudioStore((s) => s.selectScene);
  const selectClip = useStudioStore((s) => s.selectTimelineClip);
  const beginTimelineEdit = useStudioStore((s) => s.beginTimelineEdit);
  const endTimelineEdit = useStudioStore((s) => s.endTimelineEdit);
  const updateClip = useStudioStore((s) => s.updateTimelineClip);
  const splitClip = useStudioStore((s) => s.splitTimelineAt);
  const rippleDeleteClip = useStudioStore((s) => s.rippleDeleteTimelineClip);
  const rippleDeleteGap = useStudioStore((s) => s.rippleDeleteGapAt);
  const toggleSnap = useStudioStore((s) => s.toggleTimelineSnap);
  const [zoom, setZoom] = useState(1);
  const drag = useRef<ClipDrag | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const idx = project.scenes.findIndex((s) => s.id === currentSceneId);
  const scene = project.scenes[idx];
  const sceneDuration = scene?.durationMs ?? 1;
  const clips = scene?.objects ?? [];
  const selectedClip = clips.find((clip) => clip.id === selectedClipId);

  useEffect(() => () => endTimelineEdit(), [endTimelineEdit]);

  useEffect(() => {
    const move = (event: MouseEvent) => {
      const active = drag.current;
      const bounds = gridRef.current?.getBoundingClientRect();
      const trackWidth = (bounds?.width ?? 0) - 70;
      if (!active || !bounds || trackWidth <= 0) return;
      const deltaMs = ((event.clientX - active.pointerX) / trackWidth) * sceneDuration;
      const edgeMs = active.edge === "start"
        ? active.startMs + deltaMs
        : active.startMs + active.durationMs + deltaMs;
      let snappedEdge = edgeMs;
      if (snapEnabled) {
        const toleranceMs = (8 / trackWidth) * sceneDuration;
        const otherEdges = clips
          .filter((clip) => clip.id !== active.id)
          .flatMap((clip) => {
            const range = timelineClipRange(clip, sceneDuration);
            return [range.startMs, range.startMs + range.durationMs];
          });
        const candidates = [0, sceneDuration, tMs, ...otherEdges];
        snappedEdge = snapTimelineTime(edgeMs, candidates, toleranceMs);
      }
      if (active.edge === "start") {
        const startMs = Math.max(0, Math.min(snappedEdge, active.startMs + active.durationMs - 100));
        const durationMs = active.startMs + active.durationMs - startMs;
        updateClip(active.id, {
          startMs,
          durationMs,
          trimEdge: "start",
        }, false);
        active.startMs = startMs;
        active.durationMs = durationMs;
      } else {
        const durationMs = Math.max(100, Math.min(sceneDuration, snappedEdge) - active.startMs);
        updateClip(active.id, {
          durationMs,
          trimEdge: "end",
        }, false);
        active.durationMs = durationMs;
      }
      active.pointerX = event.clientX;
    };
    const end = () => {
      endTimelineEdit();
      drag.current = null;
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", end);
    };
  }, [clips, endTimelineEdit, sceneDuration, snapEnabled, tMs, updateClip, zoom]);

  const beginTrim = (
    event: ReactMouseEvent<HTMLButtonElement>,
    clipId: string,
    edge: "start" | "end",
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const clip = clips.find((item) => item.id === clipId);
    if (!clip) return;
    const range = timelineClipRange(clip, sceneDuration);
    drag.current = {
      id: clip.id,
      edge,
      startMs: range.startMs,
      durationMs: range.durationMs,
      pointerX: event.clientX,
    };
    beginTimelineEdit();
    selectClip(clipId);
  };

  const changePlayhead = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!gridRef.current) return;
    const bounds = gridRef.current.getBoundingClientRect();
    const trackWidth = bounds.width - 70;
    if (trackWidth <= 0) return;
    const raw = Math.max(
      0,
      Math.min(sceneDuration, ((event.clientX - bounds.left - 70) / trackWidth) * sceneDuration),
    );
    setPlaying(false);
    setTMs(raw);
  };

  return (
    <div className="timeline">
      <div className="timeline-scenes">
        {project.scenes.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`tl-scene${item.id === currentSceneId ? " active" : ""}`}
            style={{ flexGrow: item.durationMs }}
            onClick={() => {
              selectScene(item.id);
              setTMs(0);
            }}
            title={`${item.name} - ${(item.durationMs / 1000).toFixed(1)}s`}
          >
            {item.name}
          </button>
        ))}
      </div>
      <div className="timeline-toolbar">
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
            step={10}
            value={Math.min(tMs, sceneDuration)}
            onChange={(event) => {
              setPlaying(false);
              setTMs(parseInt(event.target.value, 10));
            }}
            aria-label="Scrub scene"
          />
          <span className="tl-time">
            {(tMs / 1000).toFixed(1)}s / {(sceneDuration / 1000).toFixed(1)}s
          </span>
        </div>
        <div className="timeline-tools">
          <button type="button" className={snapEnabled ? "active" : ""} onClick={toggleSnap}>
            Snap {snapEnabled ? "on" : "off"}
          </button>
          <button type="button" onClick={() => splitClip(tMs)}>Split at playhead</button>
          <button type="button" onClick={() => rippleDeleteGap(tMs)}>Ripple delete gap</button>
          {selectedClip && (
            <>
              <label className="timeline-lane-select">
                Track
                <select
                  aria-label="Move selected clip to lane"
                  value={timelineLaneForObject(selectedClip)}
                  onChange={(event) =>
                    updateClip(selectedClip.id, { lane: event.target.value as TimelineLane })
                  }
                >
                  {TIMELINE_LANES.map((lane) => (
                    <option key={lane} value={lane}>{LANE_LABELS[lane]}</option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                aria-label={`Ripple delete ${selectedClip.name ?? selectedClip.type}`}
                onClick={() => rippleDeleteClip(selectedClip.id)}
              >
                Ripple delete clip
              </button>
            </>
          )}
          <label className="timeline-zoom">
            Zoom
            <input
              type="range"
              min={0.5}
              max={3}
              step={0.25}
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
              aria-label="Timeline zoom"
            />
          </label>
        </div>
      </div>
      <div className="timeline-viewport">
        <div
          className="timeline-grid"
          ref={gridRef}
          style={{ width: `${zoom * 100}%` }}
          onClick={changePlayhead}
        >
          <div className="timeline-ruler" aria-hidden="true">
            {[0, 25, 50, 75, 100].map((mark) => (
              <span key={mark} style={{ left: `${mark}%` }}>
                {((sceneDuration * mark) / 100 / 1000).toFixed(1)}s
              </span>
            ))}
          </div>
          {TIMELINE_LANES.map((lane) => (
            <div className="timeline-lane" key={lane} aria-label={`${LANE_LABELS[lane]} lane`}>
              <div className="timeline-lane-name">{LANE_LABELS[lane]}</div>
              <div className="timeline-lane-track">
                {clips
                  .filter((clip) => timelineLaneForObject(clip) === lane)
                  .map((clip) => {
                    const range = timelineClipRange(clip, sceneDuration);
                    const left = (range.startMs / sceneDuration) * 100;
                    const width = (Math.min(range.durationMs, sceneDuration - range.startMs) / sceneDuration) * 100;
                    return (
                      <div
                        key={clip.id}
                        className={`timeline-clip${clip.id === selectedClipId ? " selected" : ""}`}
                        style={{ left: `${left}%`, width: `${width}%` }}
                        onClick={(event) => {
                          event.stopPropagation();
                          selectClip(clip.id);
                        }}
                        title={clip.name ?? clip.type}
                      >
                        <button
                          type="button"
                          className="timeline-trim-handle start"
                          aria-label={`Trim start of ${clip.name ?? clip.type}`}
                          onMouseDown={(event) => beginTrim(event, clip.id, "start")}
                        />
                        <span className="timeline-clip-label">{clip.name ?? clip.type}</span>
                        <button
                          type="button"
                          className="timeline-trim-handle end"
                          aria-label={`Trim end of ${clip.name ?? clip.type}`}
                          onMouseDown={(event) => beginTrim(event, clip.id, "end")}
                        />
                      </div>
                    );
                  })}
                <div
                  className="timeline-playhead"
                  style={{ left: `${(Math.min(tMs, sceneDuration) / sceneDuration) * 100}%` }}
                  aria-hidden="true"
                />
              </div>
            </div>
          ))}
        </div>
      </div>
      <span className="tl-time muted">
        Export: {(projectTimeline(project).totalMs / 1000).toFixed(1)}s total
      </span>
    </div>
  );
}
