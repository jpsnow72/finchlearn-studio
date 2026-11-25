import { describe, expect, it } from "vitest";
import type { CharacterObject, VideoProject } from "@finch-studio/core";
import type { NarrationVoice } from "@finch-studio/audio";
import {
  TRANSLATION_LANGUAGES,
  languageByCode,
} from "./languages.js";
import {
  GoogleTranslateProvider,
  TranslationNotConfiguredError,
  TranslationProviderError,
  type TranslationFetchInit,
  type TranslationFetchResponse,
  type TranslationProvider,
} from "./provider.js";
import {
  GOOGLE_TRANSLATE_LANGUAGES,
  GOOGLE_TTS_LOCALES,
  googleTranslateCoversLanguage,
  googleTtsCoversLanguage,
  languageSupport,
  supportedLanguages,
} from "./support.js";
import { mapVoiceForLanguage, voicesForLanguage } from "./voices.js";
import {
  captionCuesForProject,
  collectTranslatableStrings,
  createTranslatedVariant,
  formatVariantCaptions,
  textDirectionOf,
  translationMetaOf,
} from "./variant.js";

/** Deterministic fake binding: prefixes each string with the target. */
class FakeProvider implements TranslationProvider {
  readonly providerId = "fake";
  readonly isConfigured = true;
  readonly calls: { texts: string[]; from: string; to: string }[] = [];
  async translateBatch(
    texts: string[],
    req: { from: string; to: string },
  ): Promise<string[]> {
    this.calls.push({ texts: [...texts], from: req.from, to: req.to });
    return texts.map((t) => `[${req.to}] ${t}`);
  }
}

class UnconfiguredProvider implements TranslationProvider {
  readonly providerId = "unconfigured";
  readonly isConfigured = false;
  async translateBatch(): Promise<string[]> {
    throw new TranslationNotConfiguredError("not configured");
  }
}

function sampleProject(): VideoProject {
  const maya: CharacterObject = {
    id: "char-1",
    type: "character",
    name: "Maya",
    characterId: "businesswoman",
    characterAnimation: "wave",
    speech: [
      { id: "line-1", text: "Hello and welcome.", start: 400, duration: 2000 },
      { id: "line-2", text: "Let us begin.", start: 3000, duration: 1500 },
    ],
    extensions: { "x-finch-studio": { voiceId: "af_heart" } },
  };
  return {
    id: "proj-1",
    name: "Safety Basics",
    scenes: [
      {
        id: "scene-1",
        name: "Intro",
        durationMs: 6000,
        transition: "cut",
        objects: [
          maya,
          {
            id: "text-1",
            type: "text",
            content: "<h1>Stay safe</h1><p>Read the signs.</p>",
          },
          { id: "btn-1", type: "button", label: "Next lesson" },
          {
            id: "group-1",
            type: "group",
            objects: [{ id: "text-2", type: "text", content: "<p>Nested note</p>" }],
          },
        ],
      },
      {
        id: "scene-2",
        name: "Wrap up",
        durationMs: 5000,
        transition: "cut",
        objects: [],
      },
    ],
  };
}

describe("language set", () => {
  it("defines exactly 110 languages with unique codes", () => {
    expect(TRANSLATION_LANGUAGES).toHaveLength(110);
    expect(new Set(TRANSLATION_LANGUAGES.map((l) => l.code)).size).toBe(110);
    for (const l of TRANSLATION_LANGUAGES) {
      expect(l.name.length).toBeGreaterThan(0);
      expect(l.nativeName.length).toBeGreaterThan(0);
      expect(l.translateCode.length).toBeGreaterThan(0);
    }
  });

  it("includes right-to-left languages flagged as rtl", () => {
    const rtl = TRANSLATION_LANGUAGES.filter((l) => l.direction === "rtl");
    expect(rtl.map((l) => l.code)).toContain("ar");
    expect(languageByCode("ar")?.direction).toBe("rtl");
    expect(languageByCode("es")?.direction).toBe("ltr");
  });
});

describe("language support (G-8)", () => {
  it("computes 55 full and 55 partial languages across the widened set", () => {
    const all = supportedLanguages();
    expect(all).toHaveLength(110);
    expect(all.filter((s) => s.support === "full")).toHaveLength(55);
    expect(all.filter((s) => s.support === "partial")).toHaveLength(55);
  });

  it("pins representative full-chain languages", () => {
    for (const code of ["es", "de", "zh-CN", "zh-TW", "fil", "nb", "yue", "ur", "af", "th"]) {
      const info = languageSupport(code);
      expect(info?.support, code).toBe("full");
      expect(info?.translateSupported, code).toBe(true);
      expect(info?.voiceSupported, code).toBe(true);
      expect(info?.note, code).toBe("");
    }
  });

  it("pins representative partial languages as text and captions only", () => {
    for (const code of ["fa", "km", "cy", "jv", "sq", "ka", "uz"]) {
      const info = languageSupport(code);
      expect(info?.support, code).toBe("partial");
      expect(info?.translateSupported, code).toBe(true);
      expect(info?.voiceSupported, code).toBe(false);
      expect(info?.note, code).toContain("Text and captions only");
    }
  });

  it("offers only languages the translation provider documents", () => {
    for (const language of TRANSLATION_LANGUAGES) {
      expect(
        googleTranslateCoversLanguage(language),
        language.code,
      ).toBe(true);
      expect(GOOGLE_TRANSLATE_LANGUAGES).toContain(language.translateCode);
    }
  });

  it("agrees with the TTS enumeration: full exactly where TTS covers", () => {
    expect(GOOGLE_TTS_LOCALES).toHaveLength(66);
    for (const info of supportedLanguages()) {
      expect(
        googleTtsCoversLanguage(info.language.code),
        info.language.code,
      ).toBe(info.support === "full");
    }
  });

  it("returns undefined for a language outside the offered set", () => {
    expect(languageSupport("xx")).toBeUndefined();
  });

  it("builds a partial variant: translated text and captions, unvoiced characters", async () => {
    const { project: variant, report } = await createTranslatedVariant(
      sampleProject(),
      { provider: new FakeProvider(), targetLanguage: "fa" },
    );
    expect(report.support).toBe("partial");
    expect(translationMetaOf(variant)?.support).toBe("partial");
    expect(report.linesPendingVoice).toBe(2);
    expect(report.captionTrack.lang).toBe("fa");
    const maya = variant.scenes[0].objects.find(
      (o) => o.type === "character",
    ) as CharacterObject;
    expect(maya.speech?.map((l) => l.text)).toEqual([
      "[fa] Hello and welcome.",
      "[fa] Let us begin.",
    ]);
    expect(maya.extensions?.["x-finch-studio"]?.["voiceId"]).toBeUndefined();
  });

  it("builds a full variant in a newly wired language with a mapped voice", async () => {
    const { project: variant, report } = await createTranslatedVariant(
      sampleProject(),
      { provider: new FakeProvider(), targetLanguage: "de" },
    );
    expect(report.support).toBe("full");
    expect(translationMetaOf(variant)?.support).toBe("full");
    expect(report.linesPendingVoice).toBe(0);
    expect(report.characters[0].mapping.voiceId).toMatch(/^de-DE-/);
    const maya = variant.scenes[0].objects.find(
      (o) => o.type === "character",
    ) as CharacterObject;
    expect(maya.extensions?.["x-finch-studio"]?.["voiceId"]).toMatch(/^de-DE-/);
  });
});

describe("text collection", () => {
  it("covers titles, text objects, buttons, nested objects, and speech", () => {
    const entries = collectTranslatableStrings(sampleProject());
    const kinds = entries.map((e) => e.kind);
    expect(kinds).toContain("project-title");
    expect(kinds.filter((k) => k === "scene-title")).toHaveLength(2);
    expect(kinds.filter((k) => k === "text")).toHaveLength(2);
    expect(kinds).toContain("button-label");
    expect(kinds.filter((k) => k === "speech")).toHaveLength(2);
    const speech = entries.filter((e) => e.kind === "speech");
    expect(speech.map((e) => e.text)).toEqual([
      "Hello and welcome.",
      "Let us begin.",
    ]);
  });
});

describe("variant creation", () => {
  it("translates everything and leaves the original untouched", async () => {
    const source = sampleProject();
    const before = JSON.stringify(source);
    const provider = new FakeProvider();
    const { project: variant, report } = await createTranslatedVariant(source, {
      provider,
      targetLanguage: "es",
      now: () => "2026-11-19T00:00:00.000Z",
    });
    expect(JSON.stringify(source)).toBe(before);

    expect(variant.id).not.toBe(source.id);
    expect(variant.name).toBe("[es] Safety Basics");
    expect(variant.scenes[0].name).toBe("[es] Intro");
    const objects = variant.scenes[0].objects;
    const text = objects.find((o) => o.id !== "text-1" && o.type === "text");
    expect(text && "content" in text ? text.content : "").toContain("<h1>[es] Stay safe</h1>");
    expect(text && "content" in text ? text.content : "").toContain("<p>[es] Read the signs.</p>");
    const maya = objects.find((o) => o.type === "character") as CharacterObject;
    expect(maya.speech?.map((l) => l.text)).toEqual([
      "[es] Hello and welcome.",
      "[es] Let us begin.",
    ]);
    expect(maya.id).not.toBe("char-1");
    expect(maya.speech?.[0].id).not.toBe("line-1");
    expect(report.stringsTranslated).toBeGreaterThan(0);
    expect(provider.calls[0].from).toBe("en");
    expect(provider.calls[0].to).toBe("es");
  });

  it("records source linkage in the extension metadata", async () => {
    const { project: variant } = await createTranslatedVariant(sampleProject(), {
      provider: new FakeProvider(),
      targetLanguage: "fr",
    });
    const meta = translationMetaOf(variant);
    expect(meta?.kind).toBe("translation-variant");
    expect(meta?.sourceProjectId).toBe("proj-1");
    expect(meta?.language).toBe("fr");
    expect(meta?.sourceLanguage).toBe("en");
    expect(meta?.providerId).toBe("fake");
  });

  it("fails honestly when the provider is not configured", async () => {
    await expect(
      createTranslatedVariant(sampleProject(), {
        provider: new UnconfiguredProvider(),
        targetLanguage: "es",
      }),
    ).rejects.toBeInstanceOf(TranslationNotConfiguredError);
  });

  it("rejects an unknown target language", async () => {
    await expect(
      createTranslatedVariant(sampleProject(), {
        provider: new FakeProvider(),
        targetLanguage: "xx",
      }),
    ).rejects.toThrow(/Unknown target language/);
  });

  it("stamps rtl direction on text surfaces for Arabic", async () => {
    const { project: variant, report } = await createTranslatedVariant(
      sampleProject(),
      { provider: new FakeProvider(), targetLanguage: "ar" },
    );
    expect(report.direction).toBe("rtl");
    const objects = variant.scenes[0].objects;
    const text = objects.find((o) => o.type === "text");
    expect(text && textDirectionOf(text)).toBe("rtl");
    const maya = objects.find((o) => o.type === "character");
    expect(maya && textDirectionOf(maya)).toBe("rtl");
  });

  it("does not stamp direction for ltr languages", async () => {
    const { project: variant } = await createTranslatedVariant(sampleProject(), {
      provider: new FakeProvider(),
      targetLanguage: "de",
    });
    const text = variant.scenes[0].objects.find((o) => o.type === "text");
    expect(text && textDirectionOf(text)).toBeUndefined();
  });
});

describe("voice mapping rule", () => {
  const catalogue: NarrationVoice[] = [
    { id: "es-f-a", engine: "google", name: "ES A", gender: "female", lang: "es-ES", accent: "Spanish", descriptor: "", tier: "premium", rank: 2 },
    { id: "es-f-b", engine: "google", name: "ES B", gender: "female", lang: "es-ES", accent: "Spanish", descriptor: "", tier: "premium", rank: 5 },
    { id: "es-m-a", engine: "google", name: "ES M", gender: "male", lang: "es-MX", accent: "Mexican", descriptor: "", tier: "premium", rank: 1 },
    { id: "es-bad", engine: "google", name: "ES Bad", gender: "female", lang: "es-ES", accent: "Spanish", descriptor: "", tier: "premium", rank: 0, avoid: true },
  ];

  it("prefers exact language, then same gender, then quality rank", () => {
    // af_heart is a female en-US voice in the real catalogue.
    const mapping = mapVoiceForLanguage("af_heart", "es", catalogue);
    expect(mapping.voiceId).toBe("es-f-a");
  });

  it("never auto-maps an avoid-listed voice", () => {
    expect(voicesForLanguage("es", catalogue).map((v) => v.id)).not.toContain("es-bad");
  });

  it("returns an honest null when the catalogue has no voice for the language", () => {
    const mapping = mapVoiceForLanguage("af_heart", "th", catalogue);
    expect(mapping.voiceId).toBeNull();
    expect(mapping.reason).toContain("manual voice assignment");
  });

  it("maps English targets from the shipped catalogue by gender", () => {
    // am_michael is male; the best male en voice by rank is a Google voice.
    const mapping = mapVoiceForLanguage("am_michael", "en-GB");
    expect(mapping.voiceId).not.toBeNull();
  });

  it("variant leaves characters unvoiced and pending when no voice exists", async () => {
    const { project: variant, report } = await createTranslatedVariant(
      sampleProject(),
      { provider: new FakeProvider(), targetLanguage: "fa" },
    );
    expect(report.linesPendingVoice).toBe(2);
    const maya = variant.scenes[0].objects.find(
      (o) => o.type === "character",
    ) as CharacterObject;
    expect(maya.extensions?.["x-finch-studio"]?.["voiceId"]).toBeUndefined();
    expect(maya.extensions?.["x-finch-studio"]?.["translationVoiceStatus"]).toBe(
      "needs-assignment",
    );
    expect(report.characters[0].mapping.voiceId).toBeNull();
  });

  it("honours a per-character voice override", async () => {
    const { project: variant, report } = await createTranslatedVariant(
      sampleProject(),
      {
        provider: new FakeProvider(),
        targetLanguage: "th",
        voiceOverrides: { "char-1": "some-voice" },
      },
    );
    const maya = variant.scenes[0].objects.find(
      (o) => o.type === "character",
    ) as CharacterObject;
    expect(maya.extensions?.["x-finch-studio"]?.["voiceId"]).toBe("some-voice");
    expect(report.characters[0].mapping.reason).toContain("override");
    expect(report.linesPendingVoice).toBe(0);
  });
});

describe("re-voicing durations", () => {
  it("re-derives line durations from measured narration", async () => {
    const { project: variant, report } = await createTranslatedVariant(
      sampleProject(),
      {
        provider: new FakeProvider(),
        targetLanguage: "th",
        voiceOverrides: { "char-1": "voice-x" },
        measureLineMs: async () => 3400,
      },
    );
    const maya = variant.scenes[0].objects.find(
      (o) => o.type === "character",
    ) as CharacterObject;
    expect(maya.speech?.map((l) => l.duration)).toEqual([3400, 3400]);
    expect(report.linesRevoiced).toBe(2);
    // Scene duration grows to cover the re-timed lines.
    expect(variant.scenes[0].durationMs).toBeGreaterThanOrEqual(3000 + 3400);
  });

  it("applies the 600ms floor like the Dialogue panel", async () => {
    const { project: variant } = await createTranslatedVariant(sampleProject(), {
      provider: new FakeProvider(),
      targetLanguage: "th",
      voiceOverrides: { "char-1": "voice-x" },
      measureLineMs: async () => 120,
    });
    const maya = variant.scenes[0].objects.find(
      (o) => o.type === "character",
    ) as CharacterObject;
    expect(maya.speech?.[0].duration).toBe(600);
  });
});

describe("captions", () => {
  it("derives cues from the translated speech with source timing", async () => {
    const { project: variant, report } = await createTranslatedVariant(
      sampleProject(),
      { provider: new FakeProvider(), targetLanguage: "es" },
    );
    const cues = captionCuesForProject(variant);
    expect(cues.map((c) => c.text)).toEqual([
      "[es] Hello and welcome.",
      "[es] Let us begin.",
    ]);
    expect(cues[0].startMs).toBe(400);
    expect(cues[0].endMs).toBe(2400);
    expect(report.captionTrack.lang).toBe("es");
    expect(report.captionTrack.id).toBeTruthy();
  });

  it("formats SRT and VTT from the variant", async () => {
    const { project: variant } = await createTranslatedVariant(sampleProject(), {
      provider: new FakeProvider(),
      targetLanguage: "es",
    });
    expect(formatVariantCaptions(variant, "srt")).toContain(
      "00:00:00,400 --> 00:00:02,400\n[es] Hello and welcome.",
    );
    expect(formatVariantCaptions(variant, "vtt")).toMatch(/^WEBVTT/);
  });
});

describe("Google Translate binding (mocked transport)", () => {
  function jsonResponse(
    body: unknown,
    ok = true,
    status = 200,
  ): TranslationFetchResponse {
    return {
      ok,
      status,
      json: async () => body,
    };
  }

  it("posts the documented v2 shape and decodes entities", async () => {
    let seenUrl = "";
    let seenInit: TranslationFetchInit | undefined;
    const provider = new GoogleTranslateProvider({
      apiKey: "test-key-value-not-a-real-secret",
      fetchFn: async (url, init) => {
        seenUrl = url;
        seenInit = init;
        return jsonResponse({
          data: {
            translations: [
              { translatedText: "Hola &amp; bienvenidos" },
              { translatedText: "Comencemos" },
            ],
          },
        });
      },
    });
    expect(provider.isConfigured).toBe(true);
    const out = await provider.translateBatch(["Hello & welcome", "Let us begin"], {
      from: "en",
      to: "es",
    });
    expect(out).toEqual(["Hola & bienvenidos", "Comencemos"]);
    expect(seenUrl).toContain("translation.googleapis.com/language/translate/v2");
    const body = JSON.parse(String(seenInit?.body)) as Record<string, unknown>;
    expect(body).toEqual({
      q: ["Hello & welcome", "Let us begin"],
      source: "en",
      target: "es",
      format: "text",
    });
    const headers = seenInit?.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("test-key-value-not-a-real-secret");
    // The key travels in a header, never in the URL.
    expect(seenUrl).not.toContain("test-key-value");
  });

  it("throws the honest not-configured error without a key", async () => {
    const provider = new GoogleTranslateProvider({ apiKey: null });
    expect(provider.isConfigured).toBe(false);
    await expect(
      provider.translateBatch(["Hello"], { from: "en", to: "es" }),
    ).rejects.toBeInstanceOf(TranslationNotConfiguredError);
  });

  it("throws a provider error on a failed response, never fakes output", async () => {
    const provider = new GoogleTranslateProvider({
      apiKey: "k",
      fetchFn: async () => jsonResponse({}, false, 403),
    });
    await expect(
      provider.translateBatch(["Hello"], { from: "en", to: "es" }),
    ).rejects.toBeInstanceOf(TranslationProviderError);
  });

  it("throws when the response shape does not match the request", async () => {
    const provider = new GoogleTranslateProvider({
      apiKey: "k",
      fetchFn: async () =>
        jsonResponse({ data: { translations: [{ translatedText: "Hola" }] } }),
    });
    await expect(
      provider.translateBatch(["Hello", "Again"], { from: "en", to: "es" }),
    ).rejects.toBeInstanceOf(TranslationProviderError);
  });
});
