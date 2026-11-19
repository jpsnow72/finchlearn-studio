/**
 * serverRender.ts — client for the finch-render service (issue #33).
 *
 * The server drives the same Studio app in headless Chrome and
 * finishes with FFmpeg (loudness + faststart), which suits long or
 * 1080p projects that would tie up a tab. Configured by build env:
 * VITE_RENDER_URL + VITE_RENDER_KEY (the key ships in the bundle, the
 * same trust class as the narration app key). When unconfigured the
 * feature hides and local export is the only path.
 */
import type { VideoProject } from "@finch-studio/core";

const RENDER_URL = (import.meta.env.VITE_RENDER_URL as string | undefined) ?? "";
const RENDER_KEY = (import.meta.env.VITE_RENDER_KEY as string | undefined) ?? "";

export const serverRenderConfigured = Boolean(RENDER_URL && RENDER_KEY);

export async function requestServerRender(
  project: VideoProject,
  dimensions: { width: number; height: number },
  captions: boolean,
  onStatus: (text: string) => void,
): Promise<Blob> {
  if (!serverRenderConfigured) {
    throw new Error("Server rendering is not configured in this build.");
  }
  const begin = await fetch(`${RENDER_URL}/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-render-key": RENDER_KEY },
    body: JSON.stringify({
      project,
      width: dimensions.width,
      height: dimensions.height,
      captions,
    }),
  });
  if (!begin.ok) {
    let detail = "";
    try {
      detail = ((await begin.json()) as { error?: string }).error ?? "";
    } catch {
      // keep the status-based message
    }
    throw new Error(`the render service refused the job (${begin.status})${detail ? `: ${detail}` : ""}`);
  }
  const { jobId, token } = (await begin.json()) as { jobId: string; token: string };
  onStatus("Server render queued…");

  const deadline = Date.now() + 15 * 60_000;
  for (;;) {
    if (Date.now() > deadline) throw new Error("the server render timed out (15 minutes)");
    await new Promise((r) => setTimeout(r, 3000));
    const poll = await fetch(`${RENDER_URL}/jobs/${jobId}`, {
      headers: { "x-render-token": token },
    });
    if (!poll.ok) continue;
    const state = (await poll.json()) as { state: string; error?: string | null };
    if (state.state === "done") break;
    if (state.state === "error") {
      throw new Error(state.error ?? "the server render failed");
    }
    onStatus(
      state.state === "processing"
        ? "Server is finishing the video (loudness + faststart)…"
        : "Server is rendering… keep this tab open or come back, the job continues either way.",
    );
  }

  const file = await fetch(`${RENDER_URL}/jobs/${jobId}/file?token=${token}`);
  if (!file.ok) throw new Error(`the finished video could not be downloaded (${file.status})`);
  return await file.blob();
}
