/**
 * languages.ts — the Studio translation language set (issue #54, widened
 * by G-8, issue #123).
 *
 * The target languages are DATA. The set is every language the provider
 * chain can carry at all: the full-chain languages (translation, a
 * narration voice, and captions, with character lip sync following the
 * re-voiced dialogue timing) plus the partial languages (translation and
 * captions only, no narration voice yet). Which level each language
 * reaches is NOT asserted here: it is computed in support.ts from the
 * provider enumerations and the shipped voice catalogue, and the picker
 * labels partial languages honestly from that computation.
 *
 * `code` is the BCP-47 tag used across Studio (voice catalogue `lang`,
 * caption track `lang`). `translateCode` is the code the translation
 * provider expects when it differs. `direction` drives text rendering:
 * RTL variants stamp `dir: "rtl"` on their text surfaces so the stage,
 * speech bubbles, and exports lay the text out right-to-left.
 *
 * The original 20 languages keep their order at the head of the list;
 * the G-8 additions follow, full-chain languages first, then partial,
 * each group alphabetical by English name.
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
  // The original 20 (issue #54), order preserved.
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
  // G-8 additions with full-chain support (voice coverage verified
  // against the live Google Cloud TTS voice list; see support.ts).
  lang("af", "Afrikaans", "Afrikaans"),
  lang("am", "Amharic", "አማርኛ"),
  lang("bg", "Bulgarian", "Български"),
  lang("bn", "Bengali", "বাংলা"),
  lang("ca", "Catalan", "Català"),
  lang("yue", "Cantonese", "粵語"),
  lang("zh-TW", "Chinese (Traditional)", "繁體中文"),
  lang("cs", "Czech", "Čeština"),
  lang("da", "Danish", "Dansk"),
  lang("el", "Greek", "Ελληνικά"),
  lang("et", "Estonian", "Eesti"),
  lang("eu", "Basque", "Euskara"),
  lang("fil", "Filipino", "Filipino", { translateCode: "tl" }),
  lang("fi", "Finnish", "Suomi"),
  lang("gl", "Galician", "Galego"),
  lang("gu", "Gujarati", "ગુજરાતી"),
  lang("hr", "Croatian", "Hrvatski"),
  lang("hu", "Hungarian", "Magyar"),
  lang("is", "Icelandic", "Íslenska"),
  lang("kn", "Kannada", "ಕನ್ನಡ"),
  lang("lt", "Lithuanian", "Lietuvių"),
  lang("lv", "Latvian", "Latviešu"),
  lang("ml", "Malayalam", "മലയാളം"),
  lang("mr", "Marathi", "मराठी"),
  lang("ms", "Malay", "Bahasa Melayu"),
  lang("nb", "Norwegian (Bokmål)", "Norsk bokmål", { translateCode: "no" }),
  lang("pa", "Punjabi", "ਪੰਜਾਬੀ"),
  lang("ro", "Romanian", "Română"),
  lang("sk", "Slovak", "Slovenčina"),
  lang("sl", "Slovenian", "Slovenščina"),
  lang("sr", "Serbian", "Српски"),
  lang("sw", "Swahili", "Kiswahili"),
  lang("ta", "Tamil", "தமிழ்"),
  lang("te", "Telugu", "తెలుగు"),
  lang("ur", "Urdu", "اردو", { direction: "rtl" }),
  // G-8 additions with partial support (translation and captions only;
  // the picker marks them from the support.ts computation).
  lang("sq", "Albanian", "Shqip"),
  lang("az", "Azerbaijani", "Azərbaycan"),
  lang("be", "Belarusian", "Беларуская"),
  lang("bs", "Bosnian", "Bosanski"),
  lang("ceb", "Cebuano", "Cebuano"),
  lang("co", "Corsican", "Corsu"),
  lang("cy", "Welsh", "Cymraeg"),
  lang("eo", "Esperanto", "Esperanto"),
  lang("fa", "Persian", "فارسی", { direction: "rtl" }),
  lang("fy", "Frisian", "Frysk"),
  lang("ga", "Irish", "Gaeilge"),
  lang("gd", "Scots Gaelic", "Gàidhlig"),
  lang("ha", "Hausa", "Hausa"),
  lang("haw", "Hawaiian", "ʻŌlelo Hawaiʻi"),
  lang("hmn", "Hmong", "Hmong"),
  lang("ht", "Haitian Creole", "Kreyòl Ayisyen"),
  lang("hy", "Armenian", "Հայերեն"),
  lang("ig", "Igbo", "Igbo"),
  lang("jv", "Javanese", "Basa Jawa", { translateCode: "jw" }),
  lang("ka", "Georgian", "ქართული"),
  lang("kk", "Kazakh", "Қазақша"),
  lang("km", "Khmer", "ខ្មែរ"),
  lang("ku", "Kurdish", "Kurdî"),
  lang("ky", "Kyrgyz", "Кыргызча"),
  lang("la", "Latin", "Latina"),
  lang("lb", "Luxembourgish", "Lëtzebuergesch"),
  lang("ln", "Lingala", "Lingála"),
  lang("lo", "Lao", "ລາວ"),
  lang("mg", "Malagasy", "Malagasy"),
  lang("mi", "Maori", "Te Reo Māori"),
  lang("mk", "Macedonian", "Македонски"),
  lang("mn", "Mongolian", "Монгол"),
  lang("mt", "Maltese", "Malti"),
  lang("my", "Burmese", "မြန်မာ"),
  lang("ne", "Nepali", "नेपाली"),
  lang("ny", "Chichewa", "ChiCheŵa"),
  lang("ps", "Pashto", "پښتو", { direction: "rtl" }),
  lang("rw", "Kinyarwanda", "Kinyarwanda"),
  lang("sa", "Sanskrit", "संस्कृतम्"),
  lang("sd", "Sindhi", "سنڌي", { direction: "rtl" }),
  lang("si", "Sinhala", "සිංහල"),
  lang("sm", "Samoan", "Gagana Samoa"),
  lang("sn", "Shona", "ChiShona"),
  lang("so", "Somali", "Soomaali"),
  lang("st", "Sesotho", "Sesotho"),
  lang("su", "Sundanese", "Basa Sunda"),
  lang("tg", "Tajik", "Тоҷикӣ"),
  lang("tk", "Turkmen", "Türkmen"),
  lang("tt", "Tatar", "Татар"),
  lang("ug", "Uyghur", "ئۇيغۇرچە", { direction: "rtl" }),
  lang("uz", "Uzbek", "Oʻzbek"),
  lang("xh", "Xhosa", "isiXhosa"),
  lang("yi", "Yiddish", "ייִדיש", { direction: "rtl" }),
  lang("yo", "Yoruba", "Yorùbá"),
  lang("zu", "Zulu", "isiZulu"),
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
