import { describe, expect, it } from "vitest";
import {
  buildPptx,
  buildScenePngZip,
  buildScormPackage,
  buildZip,
  crc32,
  dimensionsForAspect,
  pngInfo,
  readZip,
  sceneNotesText,
  scenePngEntryName,
  scormManifest,
  slideSizeEmu,
  type StandaloneProjectInput,
  type StandaloneVideoInput,
} from "./index.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function u32be(v: number): Uint8Array {
  return new Uint8Array([(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff]);
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes);
  body.set(data, typeBytes.length);
  const out = new Uint8Array(4 + body.length + 4);
  out.set(u32be(data.length));
  out.set(body, 4);
  out.set(u32be(crc32(body)), 4 + body.length);
  return out;
}

/** A real, minimal PNG of the given size (one filtered scanline per row). */
function makePng(width: number, height: number): Uint8Array {
  const ihdr = new Uint8Array(13);
  ihdr.set(u32be(width), 0);
  ihdr.set(u32be(height), 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolor
  const raw = new Uint8Array(height * (1 + width * 3)).fill(120);
  for (let y = 0; y < height; y++) raw[y * (1 + width * 3)] = 0; // filter: none
  // zlib stream with a single stored block (inputs here stay under 65535).
  const zlib = new Uint8Array(2 + 5 + raw.length + 4);
  zlib[0] = 0x78;
  zlib[1] = 0x01;
  zlib[2] = 1;
  zlib[3] = raw.length & 0xff;
  zlib[4] = (raw.length >>> 8) & 0xff;
  zlib[5] = ~raw.length & 0xff;
  zlib[6] = (~raw.length >>> 8) & 0xff;
  zlib.set(raw, 7);
  zlib.set(u32be(adler32(raw)), 7 + raw.length);
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [signature, pngChunk("IHDR", ihdr), pngChunk("IDAT", zlib), pngChunk("IEND", new Uint8Array(0))];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function project(scenes = 2): StandaloneProjectInput {
  const names = ["Intro & Goals", "Deep Dive", "Wrap Up"];
  return {
    name: "Onboarding <Basics>",
    scenes: Array.from({ length: scenes }, (_, i) => ({
      id: `scene-${i + 1}`,
      name: names[i],
      dialogue: i === 1 ? [] : [`Line one of scene ${i + 1}.`, `Line two of scene ${i + 1}.`],
      framePng: makePng(320, 180),
    })),
  };
}

function videoProject(): StandaloneVideoInput {
  return {
    ...project(2),
    videoFileName: "onboarding.mp4",
    videoBytes: new TextEncoder().encode("fake-mp4-bytes-for-packaging-tests"),
  };
}

const decode = (data: Uint8Array) => new TextDecoder().decode(data);

/** Stack-based XML well-formedness check: tags balance, quotes close. */
function expectWellFormedXml(xml: string): void {
  const stack: string[] = [];
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) break;
    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt);
      expect(end).toBeGreaterThan(lt);
      i = end + 3;
      continue;
    }
    if (xml.startsWith("<?", lt)) {
      const end = xml.indexOf("?>", lt);
      expect(end).toBeGreaterThan(lt);
      i = end + 2;
      continue;
    }
    if (xml.startsWith("<!", lt)) {
      const end = xml.indexOf(">", lt);
      expect(end).toBeGreaterThan(lt);
      i = end + 1;
      continue;
    }
    const gt = xml.indexOf(">", lt);
    expect(gt).toBeGreaterThan(lt);
    const inside = xml.slice(lt + 1, gt);
    if (inside.startsWith("/")) {
      expect(stack.pop()).toBe(inside.slice(1).trim());
    } else if (!inside.endsWith("/")) {
      stack.push(inside.split(/\s/)[0]);
    }
    i = gt + 1;
  }
  expect(stack).toEqual([]);
}

function hrefs(xml: string): string[] {
  return [...xml.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
}

// ---------------------------------------------------------------------------
// ZIP + PNG primitives
// ---------------------------------------------------------------------------

describe("zip", () => {
  it("crc32 matches the standard check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
  });
  it("round trips entries and is deterministic", () => {
    const entries = [
      { name: "a.txt", data: new TextEncoder().encode("hello") },
      { name: "dir/b.bin", data: new Uint8Array([1, 2, 3, 4]) },
    ];
    const zip = buildZip(entries);
    expect(buildZip(entries)).toEqual(zip);
    const back = readZip(zip);
    expect(back.map((e) => e.name)).toEqual(["a.txt", "dir/b.bin"]);
    expect(decode(back[0].data)).toBe("hello");
    expect(back[1].data).toEqual(new Uint8Array([1, 2, 3, 4]));
  });
});

describe("png", () => {
  it("reads real PNG dimensions and rejects non-PNG bytes", () => {
    expect(pngInfo(makePng(320, 180))).toMatchObject({ width: 320, height: 180 });
    expect(() => pngInfo(new TextEncoder().encode("not a png at all......"))).toThrow(/Not a PNG/);
  });
  it("maps project aspects to even PNG dimensions", () => {
    expect(dimensionsForAspect("16:9")).toEqual({ width: 1280, height: 720 });
    expect(dimensionsForAspect("9:16")).toEqual({ width: 720, height: 1280 });
    expect(dimensionsForAspect("1:1")).toEqual({ width: 1280, height: 1280 });
    expect(dimensionsForAspect("16:9", 1920)).toEqual({ width: 1920, height: 1080 });
  });
});

// ---------------------------------------------------------------------------
// SCORM
// ---------------------------------------------------------------------------

describe.each(["1.2", "2004"] as const)("scorm %s", (version) => {
  it("builds a package whose manifest references all resolve", () => {
    const input = videoProject();
    const entries = readZip(buildScormPackage(input, version));
    const names = entries.map((e) => e.name);
    expect(names).toContain("imsmanifest.xml");
    expect(names).toContain("index.html");
    expect(names).toContain("media/video.mp4");
    const manifest = decode(entries.find((e) => e.name === "imsmanifest.xml")!.data);
    expectWellFormedXml(manifest);
    for (const href of hrefs(manifest)) expect(names).toContain(href);
    const resourceFiles = [...manifest.matchAll(/<file href="([^"]+)"/g)].map((m) => m[1]);
    expect(resourceFiles.sort()).toEqual([...names].filter((n) => n !== "imsmanifest.xml").sort());
    const video = entries.find((e) => e.name === "media/video.mp4")!;
    expect(video.data).toEqual(input.videoBytes);
  });

  it("marks the resource as a SCO with the right schema version", () => {
    const manifest = scormManifest(videoProject(), version);
    if (version === "1.2") {
      expect(manifest).toContain("<schemaversion>1.2</schemaversion>");
      expect(manifest).toContain('adlcp:scormtype="sco"');
    } else {
      expect(manifest).toContain("<schemaversion>2004 4th Edition</schemaversion>");
      expect(manifest).toContain('adlcp:scormType="sco"');
      expect(manifest).toContain("imsss:sequencing");
    }
    expect(manifest).toContain("Onboarding &lt;Basics&gt;");
  });

  it("player implements the documented completion rule with no external calls", () => {
    const entries = readZip(buildScormPackage(videoProject(), version));
    const player = decode(entries.find((e) => e.name === "index.html")!.data);
    expect(player).not.toMatch(/https?:\/\//);
    expect(player).toContain('addEventListener("ended", reportComplete)');
    expect(player).toContain("0.95");
    if (version === "1.2") {
      expect(player).toContain('"API"');
      expect(player).toContain('LMSSetValue("cmi.core.lesson_status", "completed")');
    } else {
      expect(player).toContain('"API_1484_11"');
      expect(player).toContain('SetValue("cmi.completion_status", "completed")');
      expect(player).toContain('SetValue("cmi.success_status", "passed")');
    }
  });

  it("is deterministic and fails clearly without a video", () => {
    const input = videoProject();
    expect(buildScormPackage(input, version)).toEqual(buildScormPackage(input, version));
    expect(() => buildScormPackage({ ...input, videoBytes: new Uint8Array(0) }, version)).toThrow(/video is missing/);
  });
});

// ---------------------------------------------------------------------------
// PowerPoint
// ---------------------------------------------------------------------------

describe("pptx", () => {
  it("opens as a valid zip with one slide and one notes part per scene", () => {
    const input = project(3);
    const entries = readZip(buildPptx(input));
    const byName = new Map(entries.map((e) => [e.name, e.data]));
    const slides = entries.filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.name));
    const notes = entries.filter((e) => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(e.name));
    expect(slides).toHaveLength(3);
    expect(notes).toHaveLength(3);
    for (const part of [...slides, ...notes]) expectWellFormedXml(decode(part.data));
    // Slide images are the exact scene frames.
    input.scenes.forEach((scene, i) => {
      expect(byName.get(`ppt/media/image${i + 1}.png`)).toEqual(scene.framePng);
    });
    // Every relationship target resolves to a real part.
    const resolveRel = (relsName: string, target: string): string => {
      const sourceDir = relsName.replace(/_rels\/[^/]*$/, "");
      const out: string[] = [];
      for (const part of `${sourceDir}${target}`.split("/")) {
        if (part === "..") out.pop();
        else if (part && part !== ".") out.push(part);
      }
      return out.join("/");
    };
    for (const relsPart of entries.filter((e) => e.name.includes("_rels/"))) {
      for (const target of [...decode(relsPart.data).matchAll(/Target="([^"]+)"/g)].map((m) => m[1])) {
        expect(byName.has(resolveRel(relsPart.name, target)), `${relsPart.name} -> ${target}`).toBe(true);
      }
    }
    // Content types declare every slide and notes part.
    const types = decode(byName.get("[Content_Types].xml")!);
    for (let i = 1; i <= 3; i++) {
      expect(types).toContain(`/ppt/slides/slide${i}.xml`);
      expect(types).toContain(`/ppt/notesSlides/notesSlide${i}.xml`);
    }
    const presentation = decode(byName.get("ppt/presentation.xml")!);
    expect(presentation).toContain(`cx="${320 * 9525}"`);
    expect(slideSizeEmu(input.scenes[0].framePng)).toEqual({ cx: 320 * 9525, cy: 180 * 9525 });
  });

  it("maps each scene to its slide notes: title first, then the script", () => {
    const input = project(3);
    expect(sceneNotesText(input.scenes[0], 0, 3)).toBe(
      "Intro & Goals (scene 1 of 3)\n\nScript:\nLine one of scene 1.\nLine two of scene 1.",
    );
    expect(sceneNotesText(input.scenes[1], 1, 3)).toContain("No dialogue in this scene.");
    const entries = readZip(buildPptx(input));
    const notes1 = decode(entries.find((e) => e.name === "ppt/notesSlides/notesSlide1.xml")!.data);
    expect(notes1).toContain("Intro &amp; Goals (scene 1 of 3)");
    expect(notes1).toContain("Line one of scene 1.");
    const notes2 = decode(entries.find((e) => e.name === "ppt/notesSlides/notesSlide2.xml")!.data);
    expect(notes2).toContain("Deep Dive (scene 2 of 3)");
  });

  it("is deterministic", () => {
    const input = project(2);
    expect(buildPptx(input)).toEqual(buildPptx(input));
  });
});

// ---------------------------------------------------------------------------
// PNG scenes
// ---------------------------------------------------------------------------

describe("png scene export", () => {
  it("zips one real PNG per scene at the frame dimensions", () => {
    const input = project(3);
    const entries = readZip(buildScenePngZip(input));
    expect(entries.map((e) => e.name)).toEqual([
      "scenes/scene-01-intro-goals.png",
      "scenes/scene-02-deep-dive.png",
      "scenes/scene-03-wrap-up.png",
    ]);
    expect(scenePngEntryName(input.scenes[0], 0)).toBe("scenes/scene-01-intro-goals.png");
    for (const entry of entries) {
      expect(pngInfo(entry.data)).toMatchObject({ width: 320, height: 180 });
    }
  });

  it("rejects empty projects and non-PNG frames", () => {
    expect(() => buildScenePngZip({ name: "X", scenes: [] })).toThrow(/no scenes/);
    const bad = project(1);
    bad.scenes[0].framePng = new TextEncoder().encode("definitely not a png.....");
    expect(() => buildScenePngZip(bad)).toThrow(/Not a PNG/);
    expect(() => buildPptx(bad)).toThrow(/Not a PNG/);
  });
});
