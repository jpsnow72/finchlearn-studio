import { afterEach, describe, expect, it, vi } from "vitest";
import type { VideoProject, VideoScene } from "@finch-studio/core";
import { exportVideoProject } from "../videoExport";

describe("video export transitions", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each(["fade", "push", "slide", "wipe", "zoom"] as const)(
    "composites %s at the selected output dimensions",
    async (transition) => {
      vi.useFakeTimers();
      const stopTrack = vi.fn();
      const canvases: Canvas[] = [];
      class Canvas {
        width = 0;
        height = 0;
        context = {
          save: vi.fn(), restore: vi.fn(), setTransform: vi.fn(),
          fillRect: vi.fn(), drawImage: vi.fn(), beginPath: vi.fn(),
          rect: vi.fn(), clip: vi.fn(), fillStyle: "", globalAlpha: 1,
        };
        getContext() { return this.context; }
        captureStream() { return { getTracks: () => [{ stop: stopTrack }] }; }
      }
      class Recorder {
        static isTypeSupported(type: string) { return type === "video/webm"; }
        mimeType = "video/webm";
        ondataavailable?: (event: { data: Blob }) => void;
        onstop?: () => void;
        start() {}
        stop() {
          this.ondataavailable?.({ data: new Blob(["frame"]) });
          this.onstop?.();
        }
      }
      vi.stubGlobal("HTMLCanvasElement", Canvas);
      vi.stubGlobal("MediaRecorder", Recorder);
      vi.stubGlobal("document", {
        createElement: () => {
          const canvas = new Canvas();
          canvases.push(canvas);
          return canvas;
        },
      });

      const scene = (id: string, seam: VideoScene["transition"]): VideoScene => ({
        id, name: id, durationMs: 200, transition: seam, transitionMs: 100, objects: [],
      });
      const project: VideoProject = {
        id: "project", name: "Project",
        scenes: [scene("first", "cut"), scene("second", transition)],
      };
      const result = exportVideoProject(project, undefined, { width: 1080, height: 1920 });
      await vi.runAllTimersAsync();
      expect((await result).type).toBe("video/webm");
      expect(canvases).toHaveLength(3);
      for (const canvas of canvases) {
        expect([canvas.width, canvas.height]).toEqual([1080, 1920]);
      }
      const [output, incoming, previous] = canvases;
      expect(incoming.context.setTransform).toHaveBeenCalledWith(0.84375, 0, 0, 0.84375, 0, 656.25);
      if (transition === "fade" || transition === "push") {
        expect(previous.context.setTransform).toHaveBeenCalledWith(0.84375, 0, 0, 0.84375, 0, 656.25);
        expect(output.context.drawImage.mock.calls.some(([canvas]) => canvas === previous)).toBe(true);
      }
      expect(output.context.drawImage.mock.calls.some(([canvas]) => canvas === incoming)).toBe(true);
      if (transition === "wipe") expect(output.context.clip).toHaveBeenCalled();
      if (transition === "zoom") {
        expect(output.context.drawImage.mock.calls.some((args) => args.length === 5)).toBe(true);
      }
      expect(stopTrack).toHaveBeenCalledOnce();
    },
  );
});
