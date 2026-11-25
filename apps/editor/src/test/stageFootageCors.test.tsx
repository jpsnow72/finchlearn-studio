// @vitest-environment jsdom
/**
 * Issue #122: the stage footage video must load http(s) previews in
 * CORS mode (the matte composite reads canvas pixels back; a
 * no-CORS frame taints the canvas and the readback throws, which
 * unmounted the whole editor into a blank page), and the CORS
 * decision helper must leave local/blob sources alone.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { VideoObject } from "@finch-studio/core";
import {
  StudioObjectRenderer,
  stageCorsDroppedApplies,
  stageVideoCrossOrigin,
} from "../components/StudioObjectRenderer.js";
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

describe("stageVideoCrossOrigin (issue #122)", () => {
  it("uses anonymous CORS for http and https previews", () => {
    expect(stageVideoCrossOrigin("https://a.example/v.mp4", false)).toBe("anonymous");
    expect(stageVideoCrossOrigin("http://a.example/v.mp4", false)).toBe("anonymous");
  });
  it("leaves relative, blob and data sources in plain mode", () => {
    expect(stageVideoCrossOrigin("media/clip.mp4", false)).toBeUndefined();
    expect(stageVideoCrossOrigin("blob:https://x/1", false)).toBeUndefined();
    expect(stageVideoCrossOrigin("data:video/mp4;base64,AA", false)).toBeUndefined();
  });
  it("drops CORS after a refusal so playback can fall back", () => {
    expect(stageVideoCrossOrigin("https://a.example/v.mp4", true)).toBeUndefined();
  });
});

describe("stage footage element (issue #122)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    useStudioStore.getState().newProject();
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  it("renders an https preview video in CORS mode", () => {
    act(() => root.render(<StudioObjectRenderer object={clip()} />));
    const video = container.querySelector("video");
    if (!video) throw new Error("Missing stage video element");
    expect(video.getAttribute("crossorigin")).toBe("anonymous");
  });

  it("renders a relative preview video without CORS mode", () => {
    act(() =>
      root.render(<StudioObjectRenderer object={clip({ resource: "media/clip.mp4" })} />),
    );
    const video = container.querySelector("video");
    if (!video) throw new Error("Missing stage video element");
    expect(video.getAttribute("crossorigin")).toBeNull();
  });
});

describe("stageCorsDroppedApplies (issue #122)", () => {
  it("applies the drop only to the source that dropped", () => {
    expect(stageCorsDroppedApplies("https://w3.example/v.mp4", "https://w3.example/v.mp4")).toBe(true);
    expect(stageCorsDroppedApplies("https://w3.example/v.mp4", "https://ingest.example/proxy.mp4")).toBe(false);
    expect(stageCorsDroppedApplies("https://w3.example/v.mp4", "blob:https://studio.example/1")).toBe(false);
    expect(stageCorsDroppedApplies(null, "https://w3.example/v.mp4")).toBe(false);
  });
  it("keeps a CORS-served replacement source in CORS mode after a direct drop", () => {
    const droppedFor = "https://w3.example/v.mp4";
    const proxy = "https://ingest.example/proxy.mp4";
    expect(stageVideoCrossOrigin(proxy, stageCorsDroppedApplies(droppedFor, proxy))).toBe("anonymous");
    expect(stageVideoCrossOrigin(droppedFor, stageCorsDroppedApplies(droppedFor, droppedFor))).toBeUndefined();
  });
});
