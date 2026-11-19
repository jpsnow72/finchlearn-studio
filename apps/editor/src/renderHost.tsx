/**
 * renderHost.tsx — the headless render surface (issue #33).
 *
 * Loaded at /?render=1 by the render service's Chrome. The service
 * injects the job's project into localStorage (the store's own key)
 * before page load, so the store starts on the job project. This page
 * exposes window.__runStudioRender: it runs the SAME exportMp4Project
 * the editor's Download button runs (same frames, same narration mix,
 * same captions), then POSTs the MP4 back to the service's per-job
 * callback. The service does the FFmpeg finish (loudness + faststart).
 *
 * Narration note: generation runs in this page, so basic (Kokoro)
 * voices work fully. Premium (Google) voices need a signed-in session,
 * which the render browser does not have; a project whose lines use
 * premium voices fails the job with that clear error rather than
 * silently swapping voices.
 */
import { useEffect } from "react";
import { useStudioStore } from "./store";
import { exportMp4Project } from "./videoExport";

export interface RenderJobRequest {
  callbackUrl: string;
  token: string;
  width: number;
  height: number;
  captions: boolean;
}

declare global {
  interface Window {
    __studioRenderReady?: boolean;
    __runStudioRender?: (
      job: RenderJobRequest,
    ) => Promise<{ ok: boolean; error?: string; bytes?: number }>;
  }
}

export function RenderHost() {
  useEffect(() => {
    window.__runStudioRender = async (job) => {
      try {
        const project = useStudioStore.getState().project;
        // WebM (VP9 + Opus): headless Linux Chrome has no AAC
        // encoder; the render service transcodes to MP4 with FFmpeg.
        const blob = await exportMp4Project(
          project,
          undefined,
          { width: job.width, height: job.height },
          { captions: job.captions, container: "webm" },
        );
        const res = await fetch(job.callbackUrl, {
          method: "POST",
          headers: {
            "x-render-token": job.token,
            "x-render-format": "webm",
            "content-type": "video/webm",
          },
          body: blob,
        });
        if (!res.ok) return { ok: false, error: `render callback refused (${res.status})` };
        return { ok: true, bytes: blob.size };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    };
    window.__studioRenderReady = true;
    document.title = "studio-render-ready";
  }, []);

  return (
    <main className="shell">
      <h1>FinchLearn Studio render node</h1>
      <p>
        This page renders videos for the Studio server renderer. It is not
        the editor; head to the Studio home page to create.
      </p>
    </main>
  );
}
