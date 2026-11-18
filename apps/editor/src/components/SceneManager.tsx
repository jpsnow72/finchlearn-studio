/**
 * SceneManager — sidebar list of scenes: select, rename, reorder,
 * duration + transition, add/remove.
 */
import { useState } from "react";
import type { VideoSceneTransition } from "@finch-studio/core";
import { useStudioStore } from "../store";

export function SceneManager() {
  const project = useStudioStore((s) => s.project);
  const currentSceneId = useStudioStore((s) => s.currentSceneId);
  const selectScene = useStudioStore((s) => s.selectScene);
  const addScene = useStudioStore((s) => s.addScene);
  const removeScene = useStudioStore((s) => s.removeScene);
  const renameScene = useStudioStore((s) => s.renameScene);
  const setSceneDuration = useStudioStore((s) => s.setSceneDuration);
  const setSceneTransition = useStudioStore((s) => s.setSceneTransition);
  const moveScene = useStudioStore((s) => s.moveScene);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="panel scene-manager">
      <div className="panel-title">Scenes</div>
      <ol className="scene-list">
        {project.scenes.map((s, i) => {
          const active = s.id === currentSceneId;
          return (
            <li key={s.id} className={`scene-item${active ? " active" : ""}`}>
              <button
                type="button"
                className="scene-select"
                onClick={() => selectScene(s.id)}
              >
                <span className="scene-num">{i + 1}</span>
                {editingId === s.id ? (
                  <input
                    autoFocus
                    className="scene-name-input"
                    defaultValue={s.name}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v) renameScene(s.id, v);
                      setEditingId(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span
                    className="scene-name"
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setEditingId(s.id);
                    }}
                    title="Double-click to rename"
                  >
                    {s.name}
                  </span>
                )}
                <span className="scene-meta">
                  {(s.durationMs / 1000).toFixed(1)}s
                </span>
              </button>
              {active && (
                <div className="scene-detail">
                  <label className="field-inline">
                    Duration
                    <input
                      type="number"
                      min={500}
                      step={500}
                      defaultValue={s.durationMs}
                      key={s.durationMs}
                      onBlur={(e) => {
                        const v = parseInt(e.target.value, 10);
                        if (!Number.isNaN(v)) setSceneDuration(s.id, v);
                      }}
                    />
                    ms
                  </label>
                  <label className="field-inline">
                    Transition
                    <select
                      value={s.transition ?? "cut"}
                      onChange={(e) =>
                        setSceneTransition(s.id, e.target.value as VideoSceneTransition)
                      }
                    >
                      <option value="cut">Cut</option>
                      <option value="fade">Fade</option>
                    </select>
                  </label>
                  <div className="scene-actions">
                    <button type="button" title="Move up" onClick={() => moveScene(s.id, -1)}>↑</button>
                    <button type="button" title="Move down" onClick={() => moveScene(s.id, 1)}>↓</button>
                    <button
                      type="button"
                      title="Delete scene"
                      onClick={() => removeScene(s.id)}
                      disabled={project.scenes.length <= 1}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <button type="button" className="add-scene" onClick={addScene}>
        + Add scene
      </button>
    </div>
  );
}
