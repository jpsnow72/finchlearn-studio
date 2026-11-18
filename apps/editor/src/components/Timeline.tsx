/**
 * Timeline — per-scene preview: play/pause + scrubber for the current scene.
 */
import { projectTimeline } from "@finch-studio/animation";
import { useStudioStore } from "../store";

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

  const idx = project.scenes.findIndex((s) => s.id === currentSceneId);
  const scene = project.scenes[idx];
  const local = tMs ?? 0;

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
            }}
            title={`${s.name} — ${(s.durationMs / 1000).toFixed(1)}s`}
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
          max={scene?.durationMs ?? 0}
          step={33}
          value={Math.min(local, scene?.durationMs ?? 0)}
          onChange={(e) => {
            setPlaying(false);
            setTMs(parseInt(e.target.value, 10));
          }}
          aria-label="Scrub scene"
        />
        <span className="tl-time">
          {(local / 1000).toFixed(1)}s / {((scene?.durationMs ?? 0) / 1000).toFixed(1)}s
        </span>
        <span className="tl-time muted">
          Export: {(projectTimeline(project).totalMs / 1000).toFixed(1)}s total
        </span>
      </div>
    </div>
  );
}
