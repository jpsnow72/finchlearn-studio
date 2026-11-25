import { describe, expect, it } from "vitest";
import { isBackgroundRemovalReady, normalizeBackgroundRemoval } from "./matting.js";

describe("footage background removal schema (issue #122)", () => {
  it("normalizes a stored setting and defaults the model version", () => {
    const out = normalizeBackgroundRemoval({
      matteR2Key: "mattes/matte/clip/abc/rvm.mp4",
      replacement: { kind: "color", color: "#112233" },
      status: "ready",
    });
    expect(out?.modelVersion).toBe("rvm-mobilenetv3-1.0.0");
    expect(out?.replacement).toEqual({ kind: "color", color: "#112233" });
    expect(isBackgroundRemovalReady(out)).toBe(true);
  });

  it("rejects malformed settings and never calls them ready", () => {
    expect(normalizeBackgroundRemoval(null)).toBeNull();
    expect(normalizeBackgroundRemoval({ replacement: { kind: "color" } })).toBeNull();
    expect(normalizeBackgroundRemoval({ replacement: { kind: "image", assetId: 4 } })).toBeNull();
    const processing = normalizeBackgroundRemoval({
      replacement: { kind: "scene-background", sceneId: "s2" },
      status: "processing",
    });
    expect(isBackgroundRemovalReady(processing)).toBe(false);
  });
});
