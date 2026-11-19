import { getCaptionCues, getCaptionStyle } from "../captions";
import { useStudioStore } from "../store";

export function CaptionsPanel() {
  const project = useStudioStore((state) => state.project);
  const updateCaption = useStudioStore((state) => state.updateCaption);
  const setCaptionStyle = useStudioStore((state) => state.setCaptionStyle);
  const style = getCaptionStyle(project);
  const cues = getCaptionCues(project);
  const sceneDurations = new Map(
    project.scenes.map((scene) => [scene.id, scene.durationMs]),
  );

  return (
    <section className="panel captions-panel">
      <div className="panel-title">Captions</div>
      <label className="field">
        Font
        <select
          value={style.font}
          onChange={(event) => setCaptionStyle({ font: event.target.value as typeof style.font })}
        >
          <option value="system">System sans</option>
          <option value="serif">Serif</option>
          <option value="monospace">Monospace</option>
        </select>
      </label>
      <label className="field">
        Size
        <input
          type="number"
          min={16}
          max={64}
          step={1}
          value={style.size}
          onChange={(event) => setCaptionStyle({ size: Number(event.target.value) })}
        />
      </label>
      <label className="field">
        Position
        <select
          value={style.position}
          onChange={(event) => setCaptionStyle({ position: event.target.value as typeof style.position })}
        >
          <option value="top">Top</option>
          <option value="center">Center</option>
          <option value="bottom">Bottom</option>
        </select>
      </label>
      <div className="sub-title">Caption list</div>
      {cues.length === 0 ? (
        <p className="muted small">Add narration in Dialogue to create captions.</p>
      ) : (
        <ol className="caption-cue-list">
          {cues.map((cue, index) => (
            <li key={`${cue.sceneId}:${cue.lineId}`}>
              <div className="caption-cue-heading">
                <strong>Caption {index + 1}</strong>
                <span className="muted">{cue.sceneName}</span>
              </div>
              <label className="field">
                Text
                <textarea
                  rows={2}
                  value={cue.text}
                  onChange={(event) =>
                    updateCaption(cue.sceneId, cue.lineId, { text: event.target.value })
                  }
                />
              </label>
              <div className="caption-cue-timing">
                <label className="field">
                  Start (seconds)
                  <input
                    type="number"
                    min={0}
                    max={Math.max(0, (sceneDurations.get(cue.sceneId) ?? 100) - 100) / 1000}
                    step={0.1}
                    value={(cue.startMs / 1000).toFixed(2)}
                    onChange={(event) =>
                      updateCaption(cue.sceneId, cue.lineId, {
                        startMs: Number(event.target.value) * 1000,
                      })
                    }
                  />
                </label>
                <label className="field">
                  Duration (seconds)
                  <input
                    type="number"
                    min={0.1}
                    max={Math.max(
                      100,
                      (sceneDurations.get(cue.sceneId) ?? 100) - cue.startMs,
                    ) / 1000}
                    step={0.1}
                    value={(cue.durationMs / 1000).toFixed(2)}
                    onChange={(event) =>
                      updateCaption(cue.sceneId, cue.lineId, {
                        durationMs: Number(event.target.value) * 1000,
                      })
                    }
                  />
                </label>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
