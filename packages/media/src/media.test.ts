import { describe, expect, it } from "vitest";
import { computePeaks, filterAssets, planIngest, unsplashToAsset, type MediaAsset, type UnsplashPhoto } from "./media.js";

const photo: UnsplashPhoto = {
  id: "abc", width: 4000, height: 3000,
  urls: { raw: "r", full: "f", regular: "https://images.unsplash.com/x?w=1080", small: "s", thumb: "t" },
  links: { download_location: "https://api.unsplash.com/photos/abc/download" },
  user: { name: "Sam Shooter", username: "samshoots" },
};

describe("unsplash", () => {
  it("stamps guideline attribution with UTM", () => {
    const a = unsplashToAsset(photo);
    expect(a.source).toBe("unsplash");
    expect(a.credit).toContain("Sam Shooter on Unsplash");
    expect(a.credit).toContain("utm_source=finchlearn");
  });
});

describe("ingest plan", () => {
  it("video gets proxy ladder and thumbnails", () => {
    const p = planIngest({ kind: "video", width: 1920, durationMs: 60000 });
    expect(p.proxies.map((x) => x.label)).toContain("720p");
    expect(p.thumbnailStrip.count).toBe(12);
    expect(p.waveform).toBe(true);
  });
  it("audio gets waveform only", () => {
    const p = planIngest({ kind: "audio" });
    expect(p.waveform).toBe(true);
    expect(p.proxies).toHaveLength(0);
  });
});

describe("peaks", () => {
  it("normalizes to 1", () => {
    const samples = new Float32Array([0, 0.5, -0.25, 0.1, 0, -0.5, 0.25, 0]);
    const peaks = computePeaks(samples, 4);
    expect(peaks).toHaveLength(4);
    expect(Math.max(...peaks.map((p) => p.max))).toBeCloseTo(1);
  });
});

describe("filter", () => {
  const assets: MediaAsset[] = [
    { id: "1", source: "user", kind: "video", name: "Intro take", tags: ["course"] },
    { id: "2", source: "finch-stock", kind: "image", name: "Office", tags: ["work"] },
  ];
  it("filters by kind and query", () => {
    expect(filterAssets(assets, { kind: "video" })).toHaveLength(1);
    expect(filterAssets(assets, { query: "office" })).toHaveLength(1);
    expect(filterAssets(assets, { source: "user", query: "course" })).toHaveLength(1);
  });
});
