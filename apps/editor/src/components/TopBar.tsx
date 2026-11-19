/** Top bar for project naming, export, and embedded copy-back. */
import { useState } from "react";
import { useStudioStore } from "../store";
import { exportMp4Project, exportVideoProject } from "../videoExport";
import {
  exportFileBaseName,
  EXPORT_PRESETS,
  formatCaptions,
  getExportPreset,
  type ExportPresetId,
} from "../exportPresets";

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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [presetId, setPresetId] = useState<ExportPresetId>("lms");
  const [progress, setProgress] = useState(0);

  const doExport = async () => {
    const preset = getExportPreset(presetId);
    setBusy(true);
    setProgress(0);
    try {
      const baseName = exportFileBaseName(project.name || "video");
      if (preset.kind === "gif") {
        throw new Error("GIF encoding is not available in this client. Choose a video preset instead.");
      }
      if (preset.kind === "audio") {
        throw new Error("Audio-only rendering is not available in this client. Choose a video preset instead.");
      }
      if (preset.kind === "captions") {
        const content = formatCaptions(project, preset.captionFormat!);
        const hasCues = preset.captionFormat === "vtt"
          ? content.replace(/^WEBVTT\s*/, "").trim().length > 0
          : content.trim().length > 0;
        if (!hasCues) {
          throw new Error("No character speech was found. Add speech to a character, then export captions again.");
        }
        const mimeType = preset.captionFormat === "vtt" ? "text/vtt" : "application/x-subrip";
        downloadBlob(
          new Blob([content], { type: mimeType }),
          `${baseName}.${preset.captionFormat}`,
        );
        setStatus(`${preset.captionFormat!.toUpperCase()} captions downloaded. Saving to the User Media Library is not connected in this build.`);
      } else if (preset.kind === "mp4") {
        const blob = await exportMp4Project(
          project,
          (fraction) => setProgress(Math.round(fraction * 100)),
          { width: preset.width!, height: preset.height! },
        );
        downloadBlob(blob, `${baseName}.mp4`);
        setStatus("MP4 downloaded. Saving to the User Media Library is not connected in this build.");
      } else {
        const blob = await exportVideoProject(
          project,
          (fraction) => setProgress(Math.round(fraction * 100)),
          { width: preset.width!, height: preset.height! },
        );
        const extension = blob.type.includes("mp4") ? "mp4" : "webm";
        downloadBlob(blob, `${baseName}.${extension}`);
        setStatus(`Video downloaded as ${extension.toUpperCase()}. Saving to the User Media Library is not connected in this build.`);
      }
    } catch (err) {
      setStatus(`Export failed. ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
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
      setStatus("Copied. Close this tab, then reopen the video object in the course editor to import.");
    } catch {
      setStatus("Copy failed: storage unavailable.");
    }
    setTimeout(() => setStatus(""), 6000);
  };

  return (
    <header className="topbar">
      <div className="brand">🎬 FinchLearn Studio</div>
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
        <button
          type="button"
          className="primary"
          onClick={() => setDialogOpen(true)}
          disabled={busy}
        >
          Export
        </button>
      </div>
      {status && <div className="topbar-status">{status}</div>}
      {dialogOpen && (
        <div className="export-overlay">
          <section
            className="export-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="export-title"
          >
            <div className="panel-title" id="export-title">Export project</div>
            <label className="field">
              Preset
              <select
                value={presetId}
                onChange={(event) => setPresetId(event.target.value as ExportPresetId)}
                disabled={busy}
              >
                {EXPORT_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>{preset.label}</option>
                ))}
              </select>
            </label>
            <p className="muted small">
              Video downloads use MP4 when supported by your browser, otherwise WebM.
              GIF and audio-only encoding are not available in this client.
              Files download to this device. The User Media Library and server render jobs are not connected.
            </p>
            {busy && (
              <div className="export-progress">
                <label htmlFor="render-progress">Rendering {progress}%</label>
                <progress id="render-progress" max={100} value={progress} />
              </div>
            )}
            {status && <div className="export-status" role="status">{status}</div>}
            <div className="export-actions">
              <button type="button" onClick={() => setDialogOpen(false)} disabled={busy}>
                Close
              </button>
              <button type="button" className="primary" onClick={doExport} disabled={busy}>
                {busy ? "Rendering..." : "Download"}
              </button>
            </div>
          </section>
        </div>
      )}
    </header>
  );
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
