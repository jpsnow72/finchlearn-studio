/**
 * TopBar — project name, New, export WebM, copy-back for embedded use.
 */
import { useState } from "react";
import { useStudioStore } from "../store";
import { exportVideoProject } from "../videoExport";

export function TopBar() {
  const project = useStudioStore((s) => s.project);
  const embedObjectId = useStudioStore((s) => s.embedObjectId);
  const newProject = useStudioStore((s) => s.newProject);
  const setProjectName = useStudioStore((s) => s.setProjectName);
  const canUndo = useStudioStore((s) => s.pastProjects.length > 0);
  const canRedo = useStudioStore((s) => s.futureProjects.length > 0);
  const undo = useStudioStore((s) => s.undo);
  const redo = useStudioStore((s) => s.redo);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const doExport = async () => {
    setBusy(true);
    setStatus("Rendering…");
    try {
      const blob = await exportVideoProject(project, (p) =>
        setStatus(`Rendering ${(p * 100).toFixed(0)}%`),
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${project.name || "video"}.webm`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setStatus("Done");
    } catch (err) {
      setStatus(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
      setTimeout(() => setStatus(""), 4000);
    }
  };

  const copyBack = () => {
    if (!embedObjectId) return;
    // Editor reads this key when the user re-opens the embed; the object
    // patch itself is applied by the editor's "import studio changes" step.
    try {
      localStorage.setItem(
        `ocf.video-studio.return.${embedObjectId}`,
        JSON.stringify(project),
      );
      setStatus("Copied - close this tab, then re-open the video object in the course editor to import.");
    } catch {
      setStatus("Copy failed: storage unavailable.");
    }
    setTimeout(() => setStatus(""), 6000);
  };

  return (
    <header className="topbar">
      <div className="brand">🎬 OCF Video Studio</div>
      <input
        className="project-name"
        defaultValue={project.name}
        key={project.name}
        onBlur={(e) => {
          const v = e.target.value.trim();
          if (v && v !== project.name) setProjectName(v);
        }}
        aria-label="Project name"
      />
      {embedObjectId && <span className="embed-badge">Embedded in course</span>}
      <div className="topbar-actions">
        <button type="button" onClick={undo} disabled={!canUndo} aria-label="Undo">
          Undo
        </button>
        <button type="button" onClick={redo} disabled={!canRedo} aria-label="Redo">
          Redo
        </button>
        <button
          type="button"
          onClick={() => {
            if (window.confirm("Start a new project? Unsaved work is kept in autosave.")) {
              newProject();
            }
          }}
        >
          New
        </button>
        {embedObjectId && (
          <button type="button" onClick={copyBack}>
            ⤺ Copy back to course
          </button>
        )}
        <button type="button" className="primary" onClick={doExport} disabled={busy}>
          {busy ? "Rendering…" : "⬇ Export WebM"}
        </button>
      </div>
      {status && <div className="topbar-status">{status}</div>}
    </header>
  );
}
