/** Top bar for project naming, export, and embedded copy-back. */
import { useState } from "react";
import { useStudioStore } from "../store";
import { exportMp4Project, exportVideoProject } from "../videoExport";
import { projectTimeline } from "@finch-studio/animation";
import { uploadExportToCloud } from "../cloud";
import { requestServerRender, serverRenderConfigured } from "../serverRender";
import {
  exportFileBaseName,
  EXPORT_PRESETS,
  formatCaptions,
  getExportPreset,
  type ExportPresetId,
} from "../exportPresets";

type CaptionOutput = "burn-in" | "srt" | "vtt" | "none";

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
  const [captionOutput, setCaptionOutput] = useState<CaptionOutput>("burn-in");
  const [progress, setProgress] = useState(0);

  const downloadSidecar = (format: "srt" | "vtt", baseName: string) => {
    const content = formatCaptions(project, format);
    const hasCues = format === "vtt"
      ? content.replace(/^WEBVTT\s*/, "").trim().length > 0
      : content.trim().length > 0;
    if (!hasCues) {
      throw new Error("No captions were found. Add narration, then export captions again.");
    }
    const mimeType = format === "vtt" ? "text/vtt" : "application/x-subrip";
    downloadBlob(new Blob([content], { type: mimeType }), `${baseName}.${format}`);
    setStatus(`${format.toUpperCase()} captions downloaded.`);
  };

  const doExport = async () => {
    const preset = getExportPreset(presetId);
    if (
      preset.kind !== "captions" &&
      (captionOutput === "srt" || captionOutput === "vtt") &&
      !formatCaptions(project, captionOutput).replace(/^WEBVTT\s*/, "").trim()
    ) {
      setStatus("Export failed. No captions were found. Add narration, then export captions again.");
      return;
    }
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
        downloadSidecar(preset.captionFormat!, baseName);
      } else if (preset.kind === "mp4") {
        const blob = await exportMp4Project(
          project,
          (fraction) => setProgress(Math.round(fraction * 100)),
          { width: preset.width!, height: preset.height! },
          { captions: captionOutput === "burn-in" },
        );
        downloadBlob(blob, `${baseName}.mp4`);
        if (captionOutput === "srt" || captionOutput === "vtt") {
          downloadSidecar(captionOutput, baseName);
        }
        await saveToLibrary(blob, baseName, "MP4");
      } else {
        setStatus("Rendering in real time. Keep this tab in front until it finishes.");
        const blob = await exportVideoProject(
          project,
          (fraction) => setProgress(Math.round(fraction * 100)),
          { width: preset.width!, height: preset.height! },
          { captions: captionOutput === "burn-in" },
        );
        const extension = blob.type.includes("mp4") ? "mp4" : "webm";
        downloadBlob(blob, `${baseName}.${extension}`);
        if (captionOutput === "srt" || captionOutput === "vtt") {
          downloadSidecar(captionOutput, baseName);
        }
        await saveToLibrary(blob, baseName, extension.toUpperCase());
      }
    } catch (err) {
      setStatus(`Export failed. ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const doServerRender = async () => {
    const preset = getExportPreset(presetId);
    if (preset.kind !== "mp4" && preset.kind !== "video") {
      setStatus("Server rendering produces MP4. Choose a video preset first.");
      return;
    }
    if (
      (captionOutput === "srt" || captionOutput === "vtt") &&
      !formatCaptions(project, captionOutput).replace(/^WEBVTT\s*/, "").trim()
    ) {
      setStatus("No captions were found. Add narration, then export captions again.");
      return;
    }
    setBusy(true);
    try {
      const baseName = exportFileBaseName(project.name || "video");
      const blob = await requestServerRender(
        project,
        { width: preset.width ?? 1280, height: preset.height ?? 720 },
        captionOutput === "burn-in",
        setStatus,
      );
      downloadBlob(blob, `${baseName}.mp4`);
      if (captionOutput === "srt" || captionOutput === "vtt") {
        downloadSidecar(captionOutput, baseName);
      }
      await saveToLibrary(blob, baseName, "MP4");
    } catch (err) {
      setStatus(`Server render failed. ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const recordExport = (name: string, downloadUrl?: string) => {
    try {
      const key = "finch-studio-exports";
      const list = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown[];
      list.unshift({
        id: `exp-${Date.now()}`,
        name,
        savedAt: new Date().toISOString(),
        ...(downloadUrl ? { downloadUrl } : {}),
      });
      localStorage.setItem(key, JSON.stringify(list.slice(0, 12)));
    } catch {
      // Hub list is a nicety; export success never depends on it.
    }
  };

  /** After the local download, save the same file to the user's cloud
   * media library (signed-in accounts). The download always stands on
   * its own; the status line says plainly which saves happened. */
  const saveToLibrary = async (blob: Blob, baseName: string, label: string) => {
    setStatus(`${label} downloaded. Saving to your media library…`);
    try {
      const totalMs = projectTimeline(project).totalMs;
      const saved = await uploadExportToCloud(blob, baseName, project.id, totalMs);
      if (saved) {
        recordExport(baseName, saved.downloadUrl);
        setStatus(`${label} downloaded and saved to your media library.`);
      } else {
        recordExport(baseName);
        setStatus(`${label} downloaded. Sign in to save exports to your media library.`);
      }
    } catch (err) {
      recordExport(baseName);
      setStatus(
        `${label} downloaded. Cloud save failed: ${err instanceof Error ? err.message : String(err)}`,
      );
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
            {getExportPreset(presetId).kind !== "captions" && (
              <label className="field">
                Caption output
                <select
                  value={captionOutput}
                  onChange={(event) => setCaptionOutput(event.target.value as CaptionOutput)}
                  disabled={busy}
                >
                  <option value="burn-in">Burn in on video</option>
                  <option value="srt">Download SRT sidecar</option>
                  <option value="vtt">Download VTT sidecar</option>
                  <option value="none">No captions</option>
                </select>
              </label>
            )}
            <p className="muted small">
              Video downloads use MP4 when supported by your browser, otherwise WebM.
              GIF and audio-only encoding are not available in this client.
              Choose burn-in, an SRT or VTT sidecar, or no captions.
              Signed in? Finished videos also save to your media library.
              Server rendering suits long or 1080p projects: our server does
              the heavy lifting and finishes the audio loudness for you.
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
              {serverRenderConfigured && (
                <button type="button" onClick={doServerRender} disabled={busy}>
                  Render on server
                </button>
              )}
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
