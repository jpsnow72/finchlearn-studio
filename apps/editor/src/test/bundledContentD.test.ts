import { describe, expect, it } from "vitest";
import {
  BUNDLED_D_PROVENANCE,
  D_BACKGROUNDS,
  D_CONTENT_PACK,
  D_FAMILY_NAME,
  D_PROPS,
  bundledDFamilyName,
  dBackgroundFromRef,
  dBackgroundRef,
  dPropById,
  isDBackgroundRef,
  makeDPropObject,
  searchDBackgrounds,
  searchDProps,
} from "../content/bundledContentD.js";

describe("family D bundled content pack (#53)", () => {
  it("registers the pack in the #101 catalogue shape", () => {
    expect(D_CONTENT_PACK.family).toBe("D");
    expect(D_CONTENT_PACK.familyName).toBe(D_FAMILY_NAME);
    expect(bundledDFamilyName()).toBe("Bold Ink Editorial");
    expect(D_CONTENT_PACK.props).toBe(D_PROPS);
    expect(D_CONTENT_PACK.backgrounds).toBe(D_BACKGROUNDS);
    expect(D_CONTENT_PACK.provenance).toBe(BUNDLED_D_PROVENANCE);
  });

  it("ships 10 props and 3 backgrounds, all in family D", () => {
    expect(D_PROPS).toHaveLength(10);
    expect(D_BACKGROUNDS).toHaveLength(3);
    for (const item of [...D_PROPS, ...D_BACKGROUNDS]) {
      expect(item.family).toBe("D");
      expect(item.provenance.origin).toBe("original-bundled");
      expect(item.provenance.license).toContain("FinchLearn original");
    }
  });

  it("covers the office, presentation, and callout categories", () => {
    const cats = new Set(D_PROPS.map((p) => p.category));
    expect(cats).toEqual(new Set(["office", "presentation", "arrows-callouts"]));
    const bgCats = new Set(D_BACKGROUNDS.map((b) => b.category));
    expect(bgCats).toEqual(new Set(["office", "classroom", "abstract"]));
  });

  it("has unique ids in the shared catalogue id scheme", () => {
    const ids = [...D_PROPS, ...D_BACKGROUNDS].map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const prop of D_PROPS) expect(prop.id).toMatch(/^prop-[a-z0-9-]+-d$/);
    for (const bg of D_BACKGROUNDS) expect(bg.id).toMatch(/^bg-[a-z0-9-]+-d$/);
    expect(dPropById(D_PROPS[0].id)).toBe(D_PROPS[0]);
  });

  it("uses no em dashes in user facing text", () => {
    for (const item of [...D_PROPS, ...D_BACKGROUNDS]) {
      expect(item.name).not.toContain("—");
      for (const tag of item.tags) expect(tag).not.toContain("—");
    }
    expect(D_FAMILY_NAME).not.toContain("—");
  });

  it("art is self contained SVG and the data URI round trips exactly", () => {
    for (const item of [...D_PROPS, ...D_BACKGROUNDS]) {
      expect(item.svg.startsWith("<svg")).toBe(true);
      expect(item.svg).not.toMatch(/href=|url\(http|@import|<image/);
      const decoded = decodeURIComponent(item.dataUri.split(",").slice(1).join(","));
      expect(decoded).toBe(item.svg);
    }
  });

  it("props stay transparent and backgrounds paint the full frame", () => {
    for (const prop of D_PROPS) {
      expect(prop.viewBox).toBe("0 0 200 200");
      expect(prop.svg).not.toContain('width="200" height="200"');
      expect(prop.svg).not.toMatch(/<rect x="0" y="0" width="200" height="200"/);
    }
    for (const bg of D_BACKGROUNDS) {
      expect(bg.viewBox).toBe("0 0 1280 720");
      expect(bg.svg).toContain('width="1280" height="720"');
    }
  });

  it("searches by name, category, family, and tags", () => {
    expect(searchDProps("whiteboard").map((p) => p.id)).toEqual(["prop-whiteboard-d"]);
    expect(searchDProps("office").length).toBeGreaterThan(3);
    expect(searchDProps("editorial")).toHaveLength(D_PROPS.length);
    expect(searchDProps("")).toHaveLength(D_PROPS.length);
    expect(searchDBackgrounds("city").map((b) => b.id)).toEqual(["bg-city-window-d"]);
    expect(searchDBackgrounds("zzz-no-match")).toHaveLength(0);
  });

  it("the prop factory stamps provenance like the #101 factory", () => {
    const prop = D_PROPS[0];
    const obj = makeDPropObject(prop) as unknown as {
      type: string;
      name: string;
      resource: string;
      position: { w: number; h: number };
      extensions: { "x-finch-studio": Record<string, string> };
    };
    expect(obj.type).toBe("image");
    expect(obj.name).toBe(`${prop.name} (Bold Ink Editorial)`);
    expect(obj.resource).toBe(prop.dataUri);
    expect(obj.position.w).toBe(prop.defaultSize.w);
    expect(obj.extensions["x-finch-studio"].bundledAssetId).toBe(prop.id);
    expect(obj.extensions["x-finch-studio"].bundledKind).toBe("prop");
    expect(obj.extensions["x-finch-studio"].provenance).toBe("original-bundled");
  });

  it("background references round trip through the shared prefix", () => {
    const bg = D_BACKGROUNDS[0];
    const ref = dBackgroundRef(bg);
    expect(ref).toBe(`bundled-bg:${bg.id}`);
    expect(isDBackgroundRef(ref)).toBe(true);
    expect(isDBackgroundRef("#ffffff")).toBe(false);
    expect(dBackgroundFromRef(ref)).toBe(bg);
    expect(dBackgroundFromRef("bundled-bg:bg-office-a")).toBeUndefined();
    expect(dBackgroundFromRef(undefined)).toBeUndefined();
  });
});
