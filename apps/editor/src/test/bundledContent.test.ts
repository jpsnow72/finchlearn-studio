import { describe, expect, it } from "vitest";
import {
  BUNDLED_BACKGROUNDS,
  BUNDLED_PROPS,
  bundledBackgroundFromRef,
  bundledBackgroundRef,
  isBundledBackgroundRef,
  makeBundledPropObject,
  sceneBackgroundCss,
  searchBundledBackgrounds,
  searchBundledProps,
  type BundledBackground,
  type BundledProp,
} from "../content/bundledContent.js";

const EM_DASH = "—";

function checkMetadata(asset: BundledProp | BundledBackground) {
  expect(asset.id).toBeTruthy();
  expect(asset.name.trim().length).toBeGreaterThan(0);
  expect(asset.tags.length).toBeGreaterThanOrEqual(2);
  expect(asset.family === "A" || asset.family === "B").toBe(true);
  expect(asset.provenance.origin).toBe("original-bundled");
  expect(asset.provenance.license).toContain("commercial use");
  expect(asset.provenance.author.length).toBeGreaterThan(0);
  for (const text of [asset.name, asset.provenance.license, ...asset.tags]) {
    expect(text).not.toContain(EM_DASH);
  }
}

function checkSvg(asset: BundledProp | BundledBackground) {
  expect(asset.svg.startsWith("<svg")).toBe(true);
  expect(asset.svg.endsWith("</svg>")).toBe(true);
  expect(asset.svg).toContain(`viewBox="${asset.viewBox}"`);
  // No external references: the art is fully self contained.
  expect(asset.svg).not.toContain("href=");
  expect(asset.svg).not.toContain("url(http");
  expect(asset.dataUri.startsWith("data:image/svg+xml;charset=utf-8,")).toBe(true);
  expect(decodeURIComponent(asset.dataUri.split(",").slice(1).join(","))).toBe(asset.svg);
}

describe("bundled props catalogue (issue #101)", () => {
  it("ships a solid first pack in both art families", () => {
    expect(BUNDLED_PROPS.length).toBeGreaterThanOrEqual(40);
    for (const family of ["A", "B"] as const) {
      expect(BUNDLED_PROPS.filter((p) => p.family === family).length)
        .toBeGreaterThanOrEqual(20);
    }
  });

  it("covers every named prop category in each family", () => {
    const categories = [
      "office", "presentation", "health-safety", "tech",
      "arrows-callouts", "celebration-seasonal",
    ];
    for (const family of ["A", "B"] as const) {
      for (const category of categories) {
        expect(
          BUNDLED_PROPS.some((p) => p.family === family && p.category === category),
          `${family} ${category}`,
        ).toBe(true);
      }
    }
  });

  it("has unique ids and complete provenance metadata", () => {
    const ids = BUNDLED_PROPS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const prop of BUNDLED_PROPS) checkMetadata(prop);
  });

  it("has self contained, transparent SVG art for every prop", () => {
    for (const prop of BUNDLED_PROPS) {
      checkSvg(prop);
      expect(prop.viewBox).toBe("0 0 200 200");
      // Transparent background: no full canvas backdrop rect.
      expect(prop.svg).not.toContain('width="200" height="200"');
      expect(prop.defaultSize.w).toBeGreaterThan(0);
      expect(prop.defaultSize.h).toBeGreaterThan(0);
    }
  });

  it("searches by name, category, and tags", () => {
    expect(searchBundledProps("")).toHaveLength(BUNDLED_PROPS.length);
    expect(searchBundledProps("laptop").map((p) => p.id).sort())
      .toEqual(["prop-laptop-a", "prop-laptop-b"]);
    expect(searchBundledProps("safety").length).toBeGreaterThanOrEqual(6);
    expect(searchBundledProps("no such prop").length).toBe(0);
  });

  it("creates a first class image scene object with provenance stamped", () => {
    const prop = BUNDLED_PROPS.find((p) => p.id === "prop-desk-a");
    if (!prop) throw new Error("desk prop missing");
    const obj = makeBundledPropObject(prop) as unknown as {
      type: string;
      name: string;
      resource: string;
      position: { w: number; h: number };
      extensions?: Record<string, Record<string, string>>;
    };
    expect(obj.type).toBe("image");
    expect(obj.resource).toBe(prop.dataUri);
    expect(obj.name).toContain("Desk");
    expect(obj.position.w).toBe(prop.defaultSize.w);
    const meta = obj.extensions?.["x-finch-studio"];
    expect(meta?.bundledAssetId).toBe("prop-desk-a");
    expect(meta?.provenance).toBe("original-bundled");
    expect(meta?.license).toContain("commercial use");
  });
});

describe("bundled backgrounds catalogue (issue #101)", () => {
  it("ships a solid first pack in both art families", () => {
    expect(BUNDLED_BACKGROUNDS.length).toBeGreaterThanOrEqual(10);
    for (const family of ["A", "B"] as const) {
      expect(BUNDLED_BACKGROUNDS.filter((b) => b.family === family).length)
        .toBeGreaterThanOrEqual(5);
    }
  });

  it("covers every named background category in each family", () => {
    const categories = ["office", "classroom", "meeting", "warehouse", "outdoor", "abstract"];
    for (const family of ["A", "B"] as const) {
      for (const category of categories) {
        expect(
          BUNDLED_BACKGROUNDS.some((b) => b.family === family && b.category === category),
          `${family} ${category}`,
        ).toBe(true);
      }
    }
  });

  it("has unique ids, complete metadata, and full frame art", () => {
    const ids = BUNDLED_BACKGROUNDS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const bg of BUNDLED_BACKGROUNDS) {
      checkMetadata(bg);
      checkSvg(bg);
      expect(bg.viewBox).toBe("0 0 1280 720");
      expect(bg.svg).toContain('width="1280" height="720"');
    }
  });

  it("searches by name and tags", () => {
    expect(searchBundledBackgrounds("")).toHaveLength(BUNDLED_BACKGROUNDS.length);
    expect(searchBundledBackgrounds("warehouse").map((b) => b.id).sort())
      .toEqual(["bg-warehouse-a", "bg-warehouse-b"]);
    expect(searchBundledBackgrounds("no such place").length).toBe(0);
  });

  it("round trips through the scene background reference", () => {
    for (const bg of BUNDLED_BACKGROUNDS) {
      const ref = bundledBackgroundRef(bg);
      expect(isBundledBackgroundRef(ref)).toBe(true);
      expect(bundledBackgroundFromRef(ref)?.id).toBe(bg.id);
      expect(sceneBackgroundCss(ref)).toContain(bg.dataUri);
    }
    expect(isBundledBackgroundRef("#ffffff")).toBe(false);
    expect(bundledBackgroundFromRef("#ffffff")).toBeUndefined();
    expect(bundledBackgroundFromRef("bundled-bg:bg-missing-a")).toBeUndefined();
    expect(sceneBackgroundCss("#123456")).toBe("#123456");
    expect(sceneBackgroundCss(undefined)).toBe("#ffffff");
  });
});
