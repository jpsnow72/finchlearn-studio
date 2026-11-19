/**
 * languages.ts — the Studio translation language set (issue #54).
 *
 * The 20 target languages are DATA, chosen by one documented rule: the
 * languages that cover the largest share of course-authoring demand
 * worldwide (the languages e-learning content is most commonly localized
 * into), spanning the major scripts and including right-to-left
 * languages. English is the usual source language and is not a target.
 *
 * `code` is the BCP-47 tag used across Studio (voice catalogue `lang`,
 * caption track `lang`). `translateCode` is the code the translation
 * provider expects when it differs. `direction` drives text rendering:
 * RTL variants stamp `dir: "rtl"` on their text surfaces so the stage,
 * speech bubbles, and exports lay the text out right-to-left.
 */

export type TextDirection = "ltr" | "rtl";

export interface TranslationLanguage {
  /** BCP-47 language tag, for example "es" or "zh-CN". */
  code: string;
  /** English display name for pickers. */
  name: string;
  /** The language's own name for itself, for pickers. */
  nativeName: string;
  direction: TextDirection;
  /** Provider language code when it differs from `code`. */
  translateCode: string;
}

const lang = (
  code: string,
  name: string,
  nativeName: string,
  extra: Partial<TranslationLanguage> = {},
): TranslationLanguage => ({
  code,
  name,
  nativeName,
  direction: "ltr",
  translateCode: code,
  ...extra,
});

export const TRANSLATION_LANGUAGES: TranslationLanguage[] = [
  lang("es", "Spanish", "Español"),
  lang("fr", "French", "Français"),
  lang("de", "German", "Deutsch"),
  lang("pt", "Portuguese", "Português"),
  lang("it", "Italian", "Italiano"),
  lang("nl", "Dutch", "Nederlands"),
  lang("pl", "Polish", "Polski"),
  lang("sv", "Swedish", "Svenska"),
  lang("ru", "Russian", "Русский"),
  lang("uk", "Ukrainian", "Українська"),
  lang("tr", "Turkish", "Türkçe"),
  lang("ar", "Arabic", "العربية", { direction: "rtl" }),
  lang("he", "Hebrew", "עברית", { direction: "rtl" }),
  lang("hi", "Hindi", "हिन्दी"),
  lang("zh-CN", "Chinese (Simplified)", "简体中文"),
  lang("ja", "Japanese", "日本語"),
  lang("ko", "Korean", "한국어"),
  lang("vi", "Vietnamese", "Tiếng Việt"),
  lang("id", "Indonesian", "Bahasa Indonesia"),
  lang("th", "Thai", "ไทย"),
];

/** The default source language for Studio projects. */
export const SOURCE_LANGUAGE = "en";

export function languageByCode(code: string): TranslationLanguage | undefined {
  return TRANSLATION_LANGUAGES.find((l) => l.code === code);
}

/** Primary language subtag, lowercased: "zh-CN" -> "zh", "en-US" -> "en". */
export function primarySubtag(tag: string): string {
  return tag.split("-")[0]?.toLowerCase() ?? tag.toLowerCase();
}

export function isRtlLanguage(code: string): boolean {
  return languageByCode(code)?.direction === "rtl";
}
