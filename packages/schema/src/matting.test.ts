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

  it("round trips the matte job id and token, and leaves them unset for legacy settings", () => {
    const out = normalizeBackgroundRemoval({
      matteR2Key: "sha1-model",
      matteJobId: "job-1",
      matteJobToken: "tok-1",
      replacement: { kind: "color", color: "#112233" },
      status: "ready",
    });
    expect(out?.matteJobId).toBe("job-1");
    expect(out?.matteJobToken).toBe("tok-1");
    const legacy = normalizeBackgroundRemoval({
      matteR2Key: "mattes/matte/clip/abc/rvm.mp4",
      replacement: { kind: "color", color: "#112233" },
      status: "ready",
    });
    expect(legacy?.matteJobId).toBeUndefined();
    expect(legacy?.matteJobToken).toBeUndefined();
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
