/**
 * SceneManager — always-visible scene strip with scene actions and seam transitions.
 */
import { Fragment, useState } from "react";
import { projectTimeline } from "@finch-studio/animation";
import type { VideoSceneTransition } from "@finch-studio/core";
import { useStudioStore } from "../store";

const transitions: { value: VideoSceneTransition; label: string }[] = [
  { value: "cut", label: "Cut" },
  { value: "fade", label: "Fade" },
  { value: "slide", label: "Slide" },
  { value: "wipe", label: "Wipe" },
  { value: "zoom", label: "Zoom" },
  { value: "push", label: "Push" },
];

export function SceneManager() {
  const project = useStudioStore((s) => s.project);
  const currentSceneId = useStudioStore((s) => s.currentSceneId);
  const selectScene = useStudioStore((s) => s.selectScene);
  const addScene = useStudioStore((s) => s.addScene);
  const duplicateScene = useStudioStore((s) => s.duplicateScene);
  const removeScene = useStudioStore((s) => s.removeScene);
  const renameScene = useStudioStore((s) => s.renameScene);
  const setSceneTransition = useStudioStore((s) => s.setSceneTransition);
  const moveScene = useStudioStore((s) => s.moveScene);
  const moveSceneTo = useStudioStore((s) => s.moveSceneTo);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const totalMs = projectTimeline(project).totalMs;

  return (
    <section className="panel scene-manager" aria-label="Scene strip">
      <header className="scene-strip-header">
        <div className="panel-title">Scenes</div>
        <span className="scene-total" aria-live="polite">
          Project duration: {(totalMs / 1000).toFixed(1)}s
        </span>
        <button type="button" className="add-scene" onClick={addScene}>
          + Add scene
        </button>
      </header>
      <ol className="scene-list">
        {project.scenes.map((scene, index) => {
          const active = scene.id === currentSceneId;
          const incoming = project.scenes[index + 1];
          return (
            <Fragment key={scene.id}>
              <li
                className={`scene-item${active ? " active" : ""}${draggedId === scene.id ? " dragging" : ""}`}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", scene.id);
                  setDraggedId(scene.id);
                }}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  const sourceId = draggedId ?? event.dataTransfer.getData("text/plain");
                  if (sourceId) moveSceneTo(sourceId, index);
                  setDraggedId(null);
                }}
                onDragEnd={() => setDraggedId(null)}
              >
                <div className="scene-card">
                  {editingId === scene.id ? (
                    <div className="scene-select">
                      <span className="scene-num">{index + 1}</span>
                      <span className="scene-name">
                        <input
                          autoFocus
                          className="scene-name-input"
                          defaultValue={scene.name}
                          aria-label={`Scene ${index + 1} name`}
                          onBlur={(event) => {
                            const value = event.target.value.trim();
                            if (value) renameScene(scene.id, value);
                            setEditingId(null);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") (event.target as HTMLInputElement).blur();
                            if (event.key === "Escape") setEditingId(null);
                          }}
                        />
                      </span>
                      <span className="scene-meta">{(scene.durationMs / 1000).toFixed(1)}s</span>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="scene-select"
                      onClick={() => selectScene(scene.id)}
                      aria-current={active ? "step" : undefined}
                      title="Drag to reorder"
                    >
                      <span className="scene-num">{index + 1}</span>
                      <span className="scene-name">
                        <span
                          onDoubleClick={(event) => {
                            event.stopPropagation();
                            setEditingId(scene.id);
                          }}
                          title="Double-click to rename"
                        >
                          {scene.name}
                        </span>
                      </span>
                      <span className="scene-meta">{(scene.durationMs / 1000).toFixed(1)}s</span>
                    </button>
                  )}
                  <div className="scene-actions">
                    <button
                      type="button"
                      title="Move scene left"
                      aria-label={`Move ${scene.name} left`}
                      onClick={() => moveScene(scene.id, -1)}
                      disabled={index === 0}
                    >
                      ←
                    </button>
                    <button
                      type="button"
                      title="Move scene right"
                      aria-label={`Move ${scene.name} right`}
                      onClick={() => moveScene(scene.id, 1)}
                      disabled={index === project.scenes.length - 1}
                    >
                      →
                    </button>
                    <button
                      type="button"
                      title="Duplicate scene"
                      aria-label={`Duplicate ${scene.name}`}
                      onClick={() => duplicateScene(scene.id)}
                    >
                      +
                    </button>
                    <button
                      type="button"
                      title="Delete scene"
                      aria-label={`Delete ${scene.name}`}
                      onClick={() => removeScene(scene.id)}
                      disabled={project.scenes.length <= 1}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </li>
              {incoming && (
                <li className="scene-seam">
                  <label>
                    <span aria-hidden="true">→</span>
                    <select
                      value={incoming.transition ?? "cut"}
                      aria-label={`Transition from ${scene.name} to ${incoming.name}`}
                      onChange={(event) =>
                        setSceneTransition(
                          incoming.id,
                          event.target.value as VideoSceneTransition,
                        )
                      }
                    >
                      {transitions.map((transition) => (
                        <option key={transition.value} value={transition.value}>
                          {transition.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
    </section>
  );
}
