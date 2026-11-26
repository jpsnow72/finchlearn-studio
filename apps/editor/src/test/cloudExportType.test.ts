import { describe, expect, it } from "vitest";
import { exportContentType } from "../cloud";

function blobOf(type: string): Blob {
  return new Blob([new Uint8Array([1, 2, 3])], { type });
}

describe("exportContentType (issue #118)", () => {
  it("strips MediaRecorder codec parameters from mp4", () => {
    expect(exportContentType(blobOf("video/mp4;codecs=avc1.42E01E"))).toBe("video/mp4");
    expect(exportContentType(blobOf("video/mp4;codecs=avc1.640028,mp4a.40.2"))).toBe("video/mp4");
  });

  it("strips MediaRecorder codec parameters from webm", () => {
    expect(exportContentType(blobOf("video/webm;codecs=vp9,opus"))).toBe("video/webm");
  });

  it("passes bare accepted types through", () => {
    expect(exportContentType(blobOf("video/mp4"))).toBe("video/mp4");
    expect(exportContentType(blobOf("video/webm"))).toBe("video/webm");
    expect(exportContentType(blobOf("application/zip"))).toBe("application/zip");
  });

  it("normalizes case and surrounding whitespace", () => {
    expect(exportContentType(blobOf(" Video/MP4 "))).toBe("video/mp4");
  });

  it("falls back to video/mp4 for an empty blob type", () => {
    expect(exportContentType(new Blob([new Uint8Array([1])]))).toBe("video/mp4");
  });

  it("returns null for types the media service does not store", () => {
    expect(exportContentType(blobOf("image/png"))).toBeNull();
    expect(
      exportContentType(
        blobOf("application/vnd.openxmlformats-officedocument.presentationml.presentation"),
      ),
    ).toBeNull();
  });
});
