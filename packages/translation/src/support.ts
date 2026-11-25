/**
 * support.ts — how far the provider chain carries each language (G-8,
 * issue #123).
 *
 * A language only counts as FULL when the whole chain carries it end to
 * end: Google Cloud Translation can translate its text, a narration
 * voice in the shipped catalogue can speak it (Google Cloud TTS is the
 * voice bottleneck), and its captions generate from the re-voiced
 * dialogue. Character lip sync rides the viseme model driven by
 * dialogue timing, so it regenerates wherever dialogue is re-voiced
 * from measured audio, and has nothing to sync to where no voice
 * exists. A language translation can carry but voice cannot is PARTIAL:
 * on-screen text and captions translate, characters stay unvoiced, and
 * the picker marks the language as partial instead of silently
 * degrading the variant.
 *
 * The support level is COMPUTED here from three data sources, never
 * asserted per language by hand:
 *  1. GOOGLE_TRANSLATE_LANGUAGES: the documented Google Cloud
 *     Translation (NMT) target language codes, from Google's published
 *     language support list as read on 2026-11-24.
 *  2. GOOGLE_TTS_LOCALES: the Google Cloud TTS locales that returned at
 *     least one voice from the live voices API on 2026-11-24.
 *  3. The shipped voice catalogue (@finch-studio/audio), which carries
 *     Google voice rows for the full-chain languages; a language is
 *     voice-supported exactly when the variant builder's own voice
 *     mapping rule finds a voice for it.
 * Tests pin that the three agree: every full language is covered by
 * both provider lists, and every offered language the TTS list covers
 * computes as full.
 */
import { VOICE_CATALOGUE, type NarrationVoice } from "@finch-studio/audio";
import {
  TRANSLATION_LANGUAGES,
  languageByCode,
  primarySubtag,
  type TranslationLanguage,
} from "./languages.js";
import { voicesForLanguage } from "./voices.js";

/** Documented Google Cloud Translation (NMT) target language codes. */
export const GOOGLE_TRANSLATE_LANGUAGES: readonly string[] = [
  "ab", "ace", "ach", "af", "sq", "alz", "am", "ar", "hy", "as", "awa",
  "ay", "az", "ban", "bm", "ba", "eu", "btx", "bts", "bbc", "be", "bem",
  "bn", "bew", "bho", "bik", "bs", "br", "bg", "bua", "yue", "ca", "ceb",
  "ny", "zh-CN", "zh-TW", "cv", "co", "crh", "hr", "cs", "da", "din",
  "dv", "doi", "dov", "nl", "dz", "en", "eo", "et", "ee", "fj", "fil",
  "tl", "fi", "fr", "fr-FR", "fr-CA", "fy", "ff", "gaa", "gl", "lg",
  "ka", "de", "el", "gn", "gu", "ht", "cnh", "ha", "haw", "iw", "he",
  "hil", "hi", "hmn", "hu", "hrx", "is", "ig", "ilo", "id", "ga", "it",
  "ja", "jw", "jv", "kn", "pam", "kk", "km", "cgg", "rw", "ktu", "gom",
  "ko", "kri", "ku", "ckb", "ky", "lo", "ltg", "la", "lv", "lij", "li",
  "ln", "lt", "lmo", "luo", "lb", "mk", "mai", "mak", "mg", "ms",
  "ms-Arab", "ml", "mt", "mi", "mr", "chm", "mni-Mtei", "min", "lus",
  "mn", "my", "nr", "new", "ne", "nso", "no", "nb", "nus", "oc", "or",
  "om", "pag", "pap", "ps", "fa", "pl", "pt", "pt-PT", "pt-BR", "pa",
  "pa-Arab", "qu", "rom", "ro", "rn", "ru", "sm", "sg", "sa", "gd",
  "sr", "st", "crs", "shn", "sn", "scn", "szl", "sd", "si", "sk", "sl",
  "so", "es", "su", "sw", "ss", "sv", "tg", "ta", "tt", "te", "tet",
  "th", "ti", "ts", "tn", "tr", "tk", "ak", "uk", "ur", "ug", "uz",
  "vi", "cy", "xh", "yi", "yo", "yua", "zu",
];

/**
 * Google Cloud TTS locales with at least one voice, enumerated from the
 * live voices API on 2026-11-24 (66 locales).
 */
export const GOOGLE_TTS_LOCALES: readonly string[] = [
  "af-ZA", "am-ET", "ar-XA", "bg-BG", "bn-IN", "ca-ES", "cmn-CN",
  "cmn-TW", "cs-CZ", "da-DK", "de-DE", "el-GR", "en-AU", "en-GB",
  "en-IN", "en-US", "es-419", "es-ES", "es-MX", "es-US", "et-EE",
  "eu-ES", "fi-FI", "fil-PH", "fr-BE", "fr-CA", "fr-FR", "gl-ES",
  "gu-IN", "he-IL", "hi-IN", "hr-HR", "hu-HU", "id-ID", "is-IS",
  "it-IT", "ja-JP", "kn-IN", "ko-KR", "lt-LT", "lv-LV", "ml-IN",
  "mr-IN", "ms-MY", "nb-NO", "nl-BE", "nl-NL", "pa-IN", "pl-PL",
  "pt-BR", "pt-PT", "ro-RO", "ru-RU", "sk-SK", "sl-SI", "sr-RS",
  "sv-SE", "sw-KE", "ta-IN", "te-IN", "th-TH", "tr-TR", "uk-UA",
  "ur-IN", "vi-VN", "yue-HK",
];

/**
 * TTS locale aliases for Studio language codes whose TTS locale uses a
 * different primary subtag (Google voices Mandarin under "cmn", while
 * Studio and Translation use "zh").
 */
const TTS_LOCALE_ALIASES: Record<string, readonly string[]> = {
  "zh-CN": ["cmn-CN"],
  "zh-TW": ["cmn-TW"],
};

/** True when the Google Cloud TTS voice list covers a Studio language. */
export function googleTtsCoversLanguage(code: string): boolean {
  const aliases = TTS_LOCALE_ALIASES[code];
  if (aliases) {
    return aliases.some((locale) => GOOGLE_TTS_LOCALES.includes(locale));
  }
  const primary = primarySubtag(code);
  return GOOGLE_TTS_LOCALES.some(
    (locale) => primarySubtag(locale) === primary,
  );
}

/** True when the translation provider documents the language as a target. */
export function googleTranslateCoversLanguage(
  language: TranslationLanguage,
): boolean {
  return GOOGLE_TRANSLATE_LANGUAGES.includes(language.translateCode);
}

export type LanguageSupport = "full" | "partial";

export interface LanguageSupportInfo {
  language: TranslationLanguage;
  support: LanguageSupport;
  /** The translation provider can translate this language's text. */
  translateSupported: boolean;
  /** A catalogue voice can narrate this language. */
  voiceSupported: boolean;
  /** Picker-facing explanation; empty for full languages. */
  note: string;
}

export const PARTIAL_LANGUAGE_NOTE =
  "Text and captions only: no narration voice is available for this " +
  "language yet, so characters stay unvoiced in the variant and lip " +
  "sync is not regenerated.";

/**
 * The computed support level for one offered language. `catalogue` is
 * injectable for tests; the default is the shipped voice catalogue, so
 * the answer is exactly what the variant builder will experience.
 */
export function languageSupport(
  code: string,
  catalogue: NarrationVoice[] = VOICE_CATALOGUE,
): LanguageSupportInfo | undefined {
  const language = languageByCode(code);
  if (!language) return undefined;
  const translateSupported = googleTranslateCoversLanguage(language);
  const voiceSupported = voicesForLanguage(code, catalogue).length > 0;
  const support: LanguageSupport =
    translateSupported && voiceSupported ? "full" : "partial";
  return {
    language,
    support,
    translateSupported,
    voiceSupported,
    note: support === "full" ? "" : PARTIAL_LANGUAGE_NOTE,
  };
}

/** Support info for every offered language, in picker order. */
export function supportedLanguages(
  catalogue: NarrationVoice[] = VOICE_CATALOGUE,
): LanguageSupportInfo[] {
  return TRANSLATION_LANGUAGES.map(
    (language) => languageSupport(language.code, catalogue)!,
  );
}
