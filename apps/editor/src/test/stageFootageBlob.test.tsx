// @vitest-environment jsdom
/**
 * Issue #122: a footage object with a ready matte plays its stage
 * preview from a same-origin blob object URL once the preview bytes
 * arrive, so the matte composite canvas readback cannot be tainted
 * by a footage host that serves no CORS headers. Unmatted footage
 * keeps the direct CORS-mode element and pays no fetch cost.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { VideoObject } from "@finch-studio/core";
import { StudioObjectRenderer } from "../components/StudioObjectRenderer.js";
import { useStudioStore } from "../store.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const clip = (patch: Partial<VideoObject> = {}): VideoObject => ({
  id: "footage-1",
  type: "video",
  name: "Lesson footage",
  resource: "https://videos.example/clip.mp4",
  position: { x: 0, y: 0, w: 1280, h: 720 },
  timing: { start: 0, duration: 6 },
  ...patch,
});

const mattedClip = (): VideoObject =>
  clip({
    extensions: {
      "x-finch-studio": {
        backgroundRemoval: {
          status: "ready",
          matteR2Key: "3bb938fb-rvm_mobilenetv3_fp32@v1.0.0",
          replacement: { kind: "color", color: "#224466" },
        },
      },
    } as VideoObject["extensions"],
  });

describe("stage footage blob preview (issue #122)", () => {
  let container: HTMLDivElement;
  let root: Root;
  const fetchMock = vi.fn(async () => ({
    ok: true,
    blob: async () => new Blob(["bytes"], { type: "video/mp4" }),
  }));

  beforeEach(() => {
    useStudioStore.getState().newProject();
    container = document.createElement("div");
    root = createRoot(container);
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    URL.createObjectURL = vi.fn(() => "blob:stage-preview-1");
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  });

  it("switches a matted clip to the blob URL with no CORS attribute", async () => {
    await act(async () => root.render(<StudioObjectRenderer object={mattedClip()} />));
    const video = container.querySelector("video");
    if (!video) throw new Error("Missing stage video element");
    expect(fetchMock).toHaveBeenCalledWith("https://videos.example/clip.mp4", undefined);
    expect(video.getAttribute("src")).toBe("blob:stage-preview-1");
    expect(video.getAttribute("crossorigin")).toBeNull();
  });

  it("does not fetch bytes for unmatted footage", async () => {
    await act(async () => root.render(<StudioObjectRenderer object={clip()} />));
    const video = container.querySelector("video");
    if (!video) throw new Error("Missing stage video element");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(video.getAttribute("src")).toBe("https://videos.example/clip.mp4");
    expect(video.getAttribute("crossorigin")).toBe("anonymous");
  });
});
