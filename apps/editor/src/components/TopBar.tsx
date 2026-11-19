/** Top bar for project naming, export, and embedded copy-back. */
import { useState } from "react";
import { useStudioStore } from "../store";
import {
  exportDescriptionTrackFiles,
  exportMp4Project,
  exportVideoProject,
  projectHasDescriptionTrack,
} from "../videoExport";
import { runPreflight } from "../accessibility";
import type { DescriptionExportMode } from "@finch-studio/audio";
import { projectTimeline } from "@finch-studio/animation";
import { uploadExportToCloud } from "../cloud";
import { requestServerRender, serverRenderConfigured } from "../serverRender";
import {
  buildFinishPayload,
  deliverFinish,
  type FinishRenderResult,
} from "../embed";
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
  const embedContext = useStudioStore((s) => s.embedContext);
  const newProject = useStudioStore((s) => s.newProject);
  const setProjectName = useStudioStore((s) => s.setProjectName);
  const canUndo = useStudioStore((s) => s.pastProjects.length > 0);
  const canRedo = useStudioStore((s) => s.futureProjects.length > 0);
  const undo = useStudioStore((s) => s.undo);
  const redo = useStudioStore((s) => s.redo);
  const selectScene = useStudioStore((s) => s.selectScene);
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

  const [adMode, setAdMode] = useState<DescriptionExportMode>("mixed");

  // Section 508 pre-flight (issue #63): recomputed each time the export
  // dialog is shown, so the findings list reflects the current project.
  const preflight = dialogOpen ? runPreflight(project) : null;
  const hasDescriptionTrack = projectHasDescriptionTrack(project);

  /** Secondary AD export: the description track as its own audio file
   * plus its VTT track, downloaded next to the main export. */
  const downloadDescriptionTrack = async (baseName: string) => {
    const files = await exportDescriptionTrackFiles(project);
    if (!files) return;
    downloadBlob(files.wav, `${baseName}-description.wav`);
    downloadBlob(
      new Blob([files.vtt], { type: "text/vtt" }),
      `${baseName}-description.vtt`,
    );
    setStatus(
      "Description track downloaded too: a separate audio file and its VTT track, next to the main export.",
    );
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
          { captions: captionOutput === "burn-in", audioDescriptionMode: adMode },
        );
        downloadBlob(blob, `${baseName}.mp4`);
        if (captionOutput === "srt" || captionOutput === "vtt") {
          downloadSidecar(captionOutput, baseName);
        }
        await saveToLibrary(blob, baseName, "MP4");
        if (adMode === "secondary") await downloadDescriptionTrack(baseName);
      } else {
        setStatus("Rendering in real time. Keep this tab in front until it finishes.");
        const blob = await exportVideoProject(
          project,
          (fraction) => setProgress(Math.round(fraction * 100)),
          { width: preset.width!, height: preset.height! },
          { captions: captionOutput === "burn-in", audioDescriptionMode: adMode },
        );
        const extension = blob.type.includes("mp4") ? "mp4" : "webm";
        downloadBlob(blob, `${baseName}.${extension}`);
        if (captionOutput === "srt" || captionOutput === "vtt") {
          downloadSidecar(captionOutput, baseName);
        }
        await saveToLibrary(blob, baseName, extension.toUpperCase());
        if (adMode === "secondary") await downloadDescriptionTrack(baseName);
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

  /**
   * Finish (issue #49): Save and Return to Course. The block binds the
   * project right away with a renderState "rendering" payload, then the
   * render runs through the normal export path, saves to the media
   * library, and a "ready" payload with the asset fields follows. If
   * the render fails, the rendering payload already returned stands:
   * the block shows the render state and the project is never lost.
   */
  const doFinish = async () => {
    if (!embedContext) return;
    setBusy(true);
    setProgress(0);
    try {
      deliverFinish(
        buildFinishPayload({ context: embedContext, project, renderState: "rendering" }),
        embedContext,
      );
      setStatus("Rendering your video for the course. Keep this tab open until it finishes.");
      const blob = await exportMp4Project(
        project,
        (fraction) => setProgress(Math.round(fraction * 100)),
        { width: 1280, height: 720 },
        { captions: true },
      );
      const baseName = exportFileBaseName(project.name || "video");
      downloadBlob(blob, `${baseName}.mp4`);
      const totalMs = projectTimeline(project).totalMs;
      const saved = await uploadExportToCloud(blob, baseName, project.id, totalMs);
      if (!saved) {
        setStatus(
          "Your video downloaded, but returning it to the course needs a signed in Studio session. Sign in, then press Save and Return again. Your project is saved in Studio either way.",
        );
        return;
      }
      recordExport(baseName, saved.downloadUrl);
      const render: FinishRenderResult = {
        exportId: saved.id,
        assetId: saved.id,
        objectKey: saved.objectKey,
        mp4Url: saved.downloadUrl,
        posterUrl: null,
        durationMs: totalMs,
      };
      deliverFinish(
        buildFinishPayload({ context: embedContext, project, renderState: "ready", render }),
        embedContext,
      );
      setStatus("Video returned to your course. You can close this tab now.");
    } catch (err) {
      setStatus(
        `The render did not finish: ${err instanceof Error ? err.message : String(err)} Your project is saved in Studio and the course block keeps its place. Press Save and Return to try again.`,
      );
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
        {embedObjectId && !embedContext && (
          <button type="button" onClick={copyBack}>
            ⤺ Copy back to course
          </button>
        )}
        {embedContext ? (
          <>
            <button type="button" onClick={() => setDialogOpen(true)} disabled={busy}>
              Export
            </button>
            <button type="button" className="primary" onClick={doFinish} disabled={busy}>
              {busy ? "Returning..." : "Save and Return to Course"}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="primary"
            onClick={() => setDialogOpen(true)}
            disabled={busy}
          >
            Export
          </button>
        )}
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
            {hasDescriptionTrack && (
              <label className="field">
                Audio description track
                <select
                  value={adMode}
                  onChange={(event) => setAdMode(event.target.value as DescriptionExportMode)}
                  disabled={busy}
                >
                  <option value="mixed">Mixed in, primary audio ducks under it</option>
                  <option value="secondary">Separate audio file and VTT track</option>
                </select>
              </label>
            )}
            {preflight && (
              <div className="preflight">
                <div className="sub-title">Accessibility pre-flight (Section 508)</div>
                {preflight.pass ? (
                  <p className="muted small">
                    No contrast, font size, or flashing problems found.
                  </p>
                ) : (
                  <>
                    <p className="muted small">
                      {preflight.findings.length}{" "}
                      {preflight.findings.length === 1 ? "finding" : "findings"}.
                      Exports still work; fix what you can first.
                    </p>
                    {preflight.byScene
                      .filter((sceneReport) => sceneReport.findings.length > 0)
                      .map((sceneReport) => (
                        <div key={sceneReport.sceneId} className="preflight-scene">
                          <div className="preflight-scene-head">
                            <span>{sceneReport.sceneName}</span>
                            <button
                              type="button"
                              onClick={() => {
                                selectScene(sceneReport.sceneId);
                                setDialogOpen(false);
                              }}
                            >
                              Jump to scene
                            </button>
                          </div>
                          <ul className="preflight-list">
                            {sceneReport.findings.map((finding, i) => (
                              <li key={`${finding.kind}-${finding.objectId ?? "scene"}-${i}`}>
                                {finding.message}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                  </>
                )}
              </div>
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
