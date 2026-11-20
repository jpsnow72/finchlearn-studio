import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  discoverColorSlots,
  isLottieAnimationData,
  lottieDurationMs,
  lottieFrameAtTime,
  parseLottieAnimationData,
  quantizeMsToFps,
  renderLottieSvg,
  resolvePaintColor,
  sampleProperty,
  type LottieAnimationData,
} from "../lottie/lottieCore";
import { extractDotLottie, parseZipEntries } from "../lottie/dotLottie";
import {
  LOTTIE_PACK,
  LOTTIE_PACK_BLOCKED,
  searchLottiePack,
} from "../lottie/lottiePack";
import { mapGenerativeIconsResponse } from "../lottie/generativeIcons";
import { makeImportedLottieObject } from "../lottie/lottieObject";
import type { LottieObject } from "@finch-studio/core";

const EM_DASH = "—";

/** A small hand built animation: one rect layer, a shared color slot,
 * a keyframed opacity, and a keyframed position. */
function fixtureAnimation(): LottieAnimationData {
  return {
    fr: 30,
    ip: 0,
    op: 60,
    w: 100,
    h: 100,
    layers: [
      {
        ind: 1,
        ty: 4,
        ip: 0,
        op: 60,
        st: 0,
        sr: 1,
        ks: {
          a: { a: 0, k: [0, 0] },
          o: {
            a: 1,
            k: [
              { t: 0, s: [0], o: { x: [0.333], y: [0] } },
              { t: 30, s: [100], i: { x: [0.667], y: [1] } },
              { t: 60, s: [100] },
            ],
          },
          p: {
            a: 1,
            k: [
              { t: 0, s: [10, 10], o: { x: [0.333], y: [0] } },
              { t: 60, s: [50, 10], i: { x: [0.667], y: [1] } },
            ],
          },
          r: { a: 0, k: 0 },
          s: { a: 0, k: [100, 100] },
          sa: { a: 0, k: 0 },
          sk: { a: 0, k: 0 },
        },
        shapes: [
          { ty: "rc", p: { a: 0, k: [50, 50] }, s: { a: 0, k: [40, 40] }, r: { a: 0, k: 4 } },
          {
            ty: "fl",
            c: { a: 0, k: [1, 0, 0, 1], sid: "color.primary" },
            o: { a: 0, k: 100 },
            r: 1,
          },
        ],
      },
    ],
  };
}

describe("lottie validation (#97)", () => {
  it("accepts a real animation and rejects non animations", () => {
    expect(isLottieAnimationData(fixtureAnimation())).toBe(true);
    expect(parseLottieAnimationData(fixtureAnimation()).fr).toBe(30);
    expect(isLottieAnimationData({ hello: "world" })).toBe(false);
    expect(() => parseLottieAnimationData({ layers: [] })).toThrow(/frame rate/);
    expect(() => parseLottieAnimationData("nope")).toThrow(/not a Lottie/);
    expect(lottieDurationMs(fixtureAnimation())).toBe(2000);
  });
});

describe("deterministic sampling (#97)", () => {
  it("renders the identical SVG for the same scene time, every time", () => {
    const anim = fixtureAnimation();
    const first = renderLottieSvg(anim, 500);
    for (let i = 0; i < 5; i++) expect(renderLottieSvg(anim, 500)).toBe(first);
    expect(first).toContain("<rect");
    expect(first).toContain('fill="#ff0000"');
    expect(first).not.toContain(EM_DASH);
  });

  it("samples the same frame across the export frame rate grid", () => {
    const anim = fixtureAnimation();
    // Export at 30 fps: every scene time inside one export frame
    // bucket renders that bucket's frame, identically on repeat.
    const bucketStart = quantizeMsToFps(510, 30);
    expect(bucketStart).toBe(500);
    expect(renderLottieSvg(anim, bucketStart)).toBe(renderLottieSvg(anim, 500));
    expect(quantizeMsToFps(533, 30)).toBe(500);
    expect(quantizeMsToFps(534, 30)).toBeCloseTo(533.333, 2);
    expect(lottieFrameAtTime(anim, 1000 / 30)).toBeCloseTo(1, 5);
    expect(lottieFrameAtTime(anim, 500)).toBe(15);
  });

  it("loops by wrapping and clamps when loop is off", () => {
    const anim = fixtureAnimation();
    expect(renderLottieSvg(anim, 2500)).toBe(renderLottieSvg(anim, 500));
    expect(lottieFrameAtTime(anim, 2500)).toBe(lottieFrameAtTime(anim, 500));
    const clamped = lottieFrameAtTime(anim, 99999, { loop: false });
    expect(clamped).toBeLessThan(60);
    expect(clamped).toBeGreaterThan(59);
  });

  it("interpolates keyframes with easing and holds hold keyframes", () => {
    const opacity = {
      a: 1,
      k: [
        { t: 0, s: [0], o: { x: [0.333], y: [0] } },
        { t: 30, s: [100], i: { x: [0.667], y: [1] } },
      ],
    };
    const mid = sampleProperty(opacity, 15);
    expect(typeof mid).toBe("number");
    expect(mid as number).toBeGreaterThan(0);
    expect(mid as number).toBeLessThan(100);
    const hold = { a: 1, k: [{ t: 0, s: [7], h: 1 }, { t: 30, s: [9] }] };
    expect(sampleProperty(hold, 29)).toBe(7);
    expect(sampleProperty(hold, 30)).toBe(9);
  });

  it("speed multiplies the sampled frame", () => {
    const anim = fixtureAnimation();
    expect(lottieFrameAtTime(anim, 500, { speed: 2 })).toBe(30);
  });
});

describe("recolor slot mapping (#100)", () => {
  it("discovers the shared slot and its shipped default", () => {
    const slots = discoverColorSlots(fixtureAnimation());
    expect(slots).toEqual([
      { id: "color.primary", label: "primary", defaultColor: "#ff0000" },
    ]);
  });

  it("maps an override onto the slot in the rendered SVG", () => {
    const anim = fixtureAnimation();
    const svg = renderLottieSvg(anim, 1000, { colors: { "color.primary": "#274690" } });
    expect(svg).toContain('fill="#274690"');
    expect(svg).not.toContain('fill="#ff0000"');
  });

  it("falls back to paint hex slots for imports without slot ids", () => {
    expect(resolvePaintColor(undefined, [0, 0.5, 1], { "paint:#0080ff": "#111111" })).toBe("#111111");
    expect(resolvePaintColor(undefined, [0, 0.5, 1], undefined)).toBe("#0080ff");
    expect(resolvePaintColor("color.primary", [1, 0, 0], { "color.primary": "#00ff00" })).toBe("#00ff00");
  });

  it("seeds imported object colors from the discovered slots", () => {
    const obj = makeImportedLottieObject(fixtureAnimation(), "Imported icon", "import") as LottieObject;
    expect(obj.type).toBe("lottie");
    expect(obj.colors).toEqual({ "color.primary": "#ff0000" });
    expect(obj.animationData).toBeTruthy();
  });
});

const PACK_DIR = fileURLToPath(new URL("../../public/lottie/", import.meta.url));

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(inflateRawSync(data));
}

describe("bundled pack catalogue integrity (#100)", () => {
  it("has about two dozen entries with unique ids", () => {
    expect(LOTTIE_PACK.length).toBeGreaterThanOrEqual(24);
    expect(new Set(LOTTIE_PACK.map((e) => e.id)).size).toBe(LOTTIE_PACK.length);
    expect(searchLottiePack("arrow")).toHaveLength(4);
    expect(searchLottiePack("")).toHaveLength(LOTTIE_PACK.length);
  });

  it("records the blocked icon instead of bundling a substitute", () => {
    expect(LOTTIE_PACK.some((e) => e.id === "receipt-confirmed")).toBe(false);
    expect(LOTTIE_PACK_BLOCKED).toHaveLength(1);
    expect(LOTTIE_PACK_BLOCKED[0].id).toBe("receipt-confirmed");
    expect(LOTTIE_PACK_BLOCKED[0].reason).toContain("404");
  });

  it("every entry has an asset file and a license record", () => {
    const licenses = JSON.parse(readFileSync(`${PACK_DIR}licenses.json`, "utf8")) as {
      license: string;
      icons: { id: string; license: string; file: string }[];
      blocked: { id: string }[];
    };
    expect(licenses.license).toBe("MIT");
    for (const item of LOTTIE_PACK) {
      expect(existsSync(`${PACK_DIR}${item.id}.lottie`), item.id).toBe(true);
      const record = licenses.icons.find((icon) => icon.id === item.id);
      expect(record, item.id).toBeTruthy();
      expect(record?.license).toBe("MIT");
      expect(record?.file).toBe(`${item.id}.lottie`);
      expect(item.license).toBe("MIT");
      expect(item.name).not.toContain(EM_DASH);
    }
    expect(licenses.blocked.map((b) => b.id)).toEqual(["receipt-confirmed"]);
  });

  it("every bundled asset parses and renders deterministically", async () => {
    for (const item of LOTTIE_PACK) {
      const bytes = new Uint8Array(readFileSync(`${PACK_DIR}${item.id}.lottie`));
      const { animation, animationId } = await extractDotLottie(bytes, inflate);
      expect(animationId, item.id).toBe(item.animationId);
      expect(animation.fr).toBe(60);
      expect(animation.op).toBe(144);
      expect(discoverColorSlots(animation).map((s) => s.id)).toContain("color.primary");
      const a = renderLottieSvg(animation, 700);
      const b = renderLottieSvg(animation, 700);
      expect(a).toBe(b);
      expect(a.length).toBeGreaterThan(50);
    }
  });
});

describe("dotLottie container reading (#97)", () => {
  function storedZip(files: Record<string, string>): Uint8Array {
    const enc = new TextEncoder();
    const chunks: number[] = [];
    const central: number[] = [];
    const push = (arr: number[], v: number, n: number) => {
      for (let i = 0; i < n; i++) arr.push((v >> (8 * i)) & 255);
    };
    for (const [name, text] of Object.entries(files)) {
      const nameBytes = [...enc.encode(name)];
      const data = [...enc.encode(text)];
      const localOff = chunks.length;
      push(chunks, 0x04034b50, 4); push(chunks, 20, 2); push(chunks, 0, 2);
      push(chunks, 0, 2); push(chunks, 0, 2); push(chunks, 0, 2);
      push(chunks, 0, 4); push(chunks, data.length, 4); push(chunks, data.length, 4);
      push(chunks, nameBytes.length, 2); push(chunks, 0, 2);
      chunks.push(...nameBytes, ...data);
      push(central, 0x02014b50, 4); push(central, 20, 2); push(central, 20, 2);
      push(central, 0, 2); push(central, 0, 2); push(central, 0, 2); push(central, 0, 2);
      push(central, 0, 4); push(central, data.length, 4); push(central, data.length, 4);
      push(central, nameBytes.length, 2); push(central, 0, 2); push(central, 0, 2);
      push(central, 0, 2); push(central, 0, 2); push(central, 0, 4); push(central, localOff, 4);
      central.push(...nameBytes);
    }
    const cdStart = chunks.length;
    chunks.push(...central);
    push(chunks, 0x06054b50, 4); push(chunks, 0, 2); push(chunks, 0, 2);
    push(chunks, Object.keys(files).length, 2); push(chunks, Object.keys(files).length, 2);
    push(chunks, central.length, 4); push(chunks, cdStart, 4); push(chunks, 0, 2);
    return new Uint8Array(chunks);
  }

  it("extracts the manifest initial animation from a stored container", async () => {
    const anim = JSON.stringify({ fr: 60, ip: 0, op: 144, w: 32, h: 32, layers: [] });
    const bytes = storedZip({
      "manifest.json": JSON.stringify({ initial: { animation: "demo" }, animations: [{ id: "demo" }] }),
      "a/demo.json": anim,
      "t/dark.json": JSON.stringify({ rules: [] }),
    });
    expect(parseZipEntries(bytes).map((e) => e.name)).toContain("a/demo.json");
    const out = await extractDotLottie(bytes, async () => {
      throw new Error("stored entries must not need inflate");
    });
    expect(out.animationId).toBe("demo");
    expect(out.animation.fr).toBe(60);
    expect(out.themes.dark).toEqual({ rules: [] });
  });
});

describe("browse result mapping (#100)", () => {
  it("maps the catalogue payload shape", () => {
    // Fixture shaped like GET /api/icons?limit=24&offset=0, verified
    // against the live Generative Icons API on 2026-11-19.
    const payload = {
      total: 1161,
      offset: 0,
      results: [
        {
          id: "star",
          label: "Star",
          category: "Essentials",
          categoryId: "essentials",
          description: "The star is awarded and shines.",
          searchTerms: ["favorite"],
          stateful: false,
          page: "https://generativeicons.com/icons/star/",
          asset: "https://generativeicons.com/assets/star.lottie",
        },
        { id: "bell", label: "Bell", asset: "https://generativeicons.com/assets/bell.lottie" },
        { label: "missing id is dropped" },
        { id: "star", label: "duplicate is dropped" },
      ],
    };
    const mapped = mapGenerativeIconsResponse(payload);
    expect(mapped).toHaveLength(2);
    expect(mapped[0]).toMatchObject({
      id: "star",
      label: "Star",
      category: "Essentials",
      assetUrl: "https://generativeicons.com/assets/star.lottie",
    });
  });

  it("maps the search payload shape (id plus score) with derived fields", () => {
    // Fixture shaped like GET /api/search?q=star, verified live.
    const payload = {
      query: "star",
      results: [
        { id: "file-star", score: 0.693 },
        { id: "star", score: 0.675 },
      ],
    };
    const mapped = mapGenerativeIconsResponse(payload);
    expect(mapped).toEqual([
      {
        id: "file-star",
        label: "File star",
        assetUrl: "https://generativeicons.com/assets/file-star.lottie",
      },
      {
        id: "star",
        label: "Star",
        assetUrl: "https://generativeicons.com/assets/star.lottie",
      },
    ]);
  });

  it("maps junk payloads to an empty list, never invented results", () => {
    expect(mapGenerativeIconsResponse(null)).toEqual([]);
    expect(mapGenerativeIconsResponse({ results: "nope" })).toEqual([]);
    expect(mapGenerativeIconsResponse(42)).toEqual([]);
  });
});
