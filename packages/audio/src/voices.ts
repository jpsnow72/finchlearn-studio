/**
 * voices.ts — the FinchLearn narration voice catalogue, ported verbatim
 * (data + queries) from @ocf/core voiceCatalogue.ts so Studio and the
 * course editor offer the SAME voices. Keep the two in sync by hand;
 * re-ranking is a data update in both places.
 *
 * Original header: the narration voice catalogue AS DATA (AI Audio
 * Slice 0; consult ai-audio-integration-consult.md §2.6).
 *
 * The picker consumes this list; re-ranking is a data update, never a code
 * change. Ranks were seeded 2026-11-03 from the voice-ranking research
 * (ai-audio-voice-ranking-2026-11-03.md):
 *   - `rank`      — the combined paid-picker Top 20 across BOTH engines
 *                   (1 = most realistic). Only ranked rows carry it.
 *   - `basicRank` — the free/basic ordering inside the Kokoro English set
 *                   (af_heart first). The research's avoid-list voices are
 *                   kept as rows (the catalogue is the full Kokoro English
 *                   set) but flagged `avoid` and basic-ranked last, so the
 *                   free shortlist cap pushes them out first.
 * Google rows began as exactly the Google voices named in the Top 20;
 * the G-8 widening (issue #123) added international rows for every
 * full-chain translation language, enumerated from the live Google
 * Cloud TTS voice list. The picker count below is COMPUTED from rows,
 * per the consult's marketing rule (§2.6/§8.6: advertise only what the
 * picker can actually select).
 */

export type NarrationEngineId = "kokoro" | "google";

export type VoiceGender = "female" | "male";
export type VoiceTier = "basic" | "premium";

export interface NarrationVoice {
  /** Engine-native voice id (Kokoro: "af_heart"; Google: full voice name). */
  id: string;
  engine: NarrationEngineId;
  /** Picker display name. */
  name: string;
  gender: VoiceGender;
  /** BCP-47 language/region the voice speaks. */
  lang: string;
  /** Short accent label for picker rows ("American", "British"). */
  accent: string;
  /** One-line character note for picker rows. */
  descriptor: string;
  /** basic = selectable on the free tier (Kokoro); premium = paid tiers. */
  tier: VoiceTier;
  /** Combined cross-engine realism rank (paid picker's first screen). */
  rank?: number;
  /** Ordering inside the free/basic Kokoro shortlist. */
  basicRank?: number;
  /** Research avoid-list: poor realism/consistency — ranked last, and the
   * first candidates to fall outside the free cap. */
  avoid?: boolean;
}

const kokoro = (
  id: string,
  name: string,
  gender: VoiceGender,
  lang: "en-US" | "en-GB",
  descriptor: string,
  extra: Partial<NarrationVoice> = {},
): NarrationVoice => ({
  id,
  engine: "kokoro",
  name,
  gender,
  lang,
  accent: lang === "en-US" ? "American" : "British",
  descriptor,
  tier: "basic",
  ...extra,
});

const google = (
  id: string,
  name: string,
  gender: VoiceGender,
  lang: "en-US" | "en-GB",
  family: string,
  descriptor: string,
  rank: number,
): NarrationVoice => ({
  id,
  engine: "google",
  name,
  gender,
  lang,
  accent: lang === "en-US" ? "American" : "British",
  descriptor: `${family} — ${descriptor}`,
  tier: "premium",
  rank,
});

/**
 * International Google rows (G-8, issue #123): one female and one male
 * voice per full-chain translation language, enumerated from the live
 * Google Cloud TTS voice list on 2026-11-24 (the first voice of each
 * gender per locale, preferring the Chirp 3 HD family). These rows are
 * what make the widened translation set real: the variant builder maps
 * voices from this catalogue, so a language without rows here stays
 * partial in @finch-studio/translation's support computation. Mandarin
 * voices live under Google's "cmn" locale; their catalogue `lang`
 * carries the BCP-47 tag Studio uses ("zh-CN", "zh-TW"), and the
 * narration path derives the API language code from the voice id, so
 * synthesis still addresses "cmn-CN" / "cmn-TW" correctly. Unranked:
 * `rank` stays the cross-engine English Top 20 only.
 */
const googleIntl = (
  id: string,
  name: string,
  gender: VoiceGender,
  lang: string,
  accent: string,
  family: string,
  descriptor: string,
): NarrationVoice => ({
  id,
  engine: "google",
  name,
  gender,
  lang,
  accent,
  descriptor: `${family} — ${descriptor}`,
  tier: "premium",
});

/** The seeded catalogue: Kokoro's full English set + the ranked Google
 * voices + the international Google rows for translation (G-8). */
export const VOICE_CATALOGUE: NarrationVoice[] = [
  // --- Kokoro, American English (free/basic shortlist order = basicRank) ---
  kokoro("af_heart", "Heart", "female", "en-US", "Warm, natural narrator — Kokoro's flagship voice.", { rank: 3, basicRank: 1 }),
  kokoro("af_bella", "Bella", "female", "en-US", "Bright, expressive, and easy to listen to.", { rank: 5, basicRank: 2 }),
  kokoro("af_nicole", "Nicole", "female", "en-US", "Clear, calm, professional delivery.", { rank: 14, basicRank: 4 }),
  kokoro("af_sarah", "Sarah", "female", "en-US", "Soft, steady, unhurried pace.", { rank: 16, basicRank: 5 }),
  kokoro("af_aoede", "Aoede", "female", "en-US", "Smooth, melodic reading voice.", { basicRank: 6 }),
  kokoro("af_kore", "Kore", "female", "en-US", "Youthful, friendly, conversational.", { basicRank: 7 }),
  kokoro("am_michael", "Michael", "male", "en-US", "Warm, confident male narrator.", { rank: 6, basicRank: 8 }),
  kokoro("am_fenrir", "Fenrir", "male", "en-US", "Deep, resonant, deliberate.", { rank: 18, basicRank: 9 }),
  kokoro("am_puck", "Puck", "male", "en-US", "Light, playful, quick.", { basicRank: 10 }),
  kokoro("af_alloy", "Alloy", "female", "en-US", "Neutral, even, understated.", { basicRank: 14 }),
  kokoro("af_nova", "Nova", "female", "en-US", "Crisp, modern, energetic.", { basicRank: 15 }),
  kokoro("am_liam", "Liam", "male", "en-US", "Relaxed, approachable, mid-tempo.", { basicRank: 19 }),
  kokoro("am_adam", "Adam", "male", "en-US", "Plain-spoken, matter-of-fact.", { basicRank: 20 }),
  kokoro("af_river", "River", "female", "en-US", "Gentle, flowing delivery.", { basicRank: 21 }),
  kokoro("af_sky", "Sky", "female", "en-US", "Airy and light; realism varies by text.", { basicRank: 23, avoid: true }),
  kokoro("af_jessica", "Jessica", "female", "en-US", "Casual; consistency varies on long passages.", { basicRank: 25, avoid: true }),
  kokoro("am_santa", "Santa", "male", "en-US", "Character voice; not suited to narration.", { basicRank: 22, avoid: true }),
  kokoro("am_echo", "Echo", "male", "en-US", "Flat affect; ranked last by the research.", { basicRank: 26, avoid: true }),
  kokoro("am_eric", "Eric", "male", "en-US", "Dry delivery; ranked last by the research.", { basicRank: 27, avoid: true }),
  kokoro("am_onyx", "Onyx", "male", "en-US", "Dark timbre; ranked last by the research.", { basicRank: 28, avoid: true }),
  // --- Kokoro, British English ---
  kokoro("bf_emma", "Emma", "female", "en-GB", "Polished British narrator — best of the British set.", { rank: 9, basicRank: 3 }),
  kokoro("bf_isabella", "Isabella", "female", "en-GB", "Formal, precise, measured.", { basicRank: 13 }),
  kokoro("bf_lily", "Lily", "female", "en-GB", "Soft-spoken, gentle pace.", { basicRank: 18 }),
  kokoro("bm_george", "George", "male", "en-GB", "Classic British male narrator.", { rank: 12, basicRank: 11 }),
  kokoro("bm_fable", "Fable", "male", "en-GB", "Storyteller warmth, lightly theatrical.", { rank: 20, basicRank: 12 }),
  kokoro("bm_lewis", "Lewis", "male", "en-GB", "Reserved, scholarly tone.", { basicRank: 16 }),
  kokoro("bm_daniel", "Daniel", "male", "en-GB", "Even, neutral delivery.", { basicRank: 17 }),
  kokoro("bf_alice", "Alice", "female", "en-GB", "Light; consistency varies, ranked last by the research.", { basicRank: 24, avoid: true }),

  // --- Google voices named in the combined Top 20 (premium) ---
  google("en-US-Chirp3-HD-Kore", "Kore", "female", "en-US", "Chirp 3 HD", "Firm, clear — the ranking's #1 narration voice.", 1),
  google("en-US-Chirp3-HD-Charon", "Charon", "male", "en-US", "Chirp 3 HD", "Informative, easygoing male narrator.", 2),
  google("en-US-Chirp3-HD-Sadaltager", "Sadaltager", "male", "en-US", "Chirp 3 HD", "Knowledgeable, steady explainer.", 4),
  google("en-GB-Chirp3-HD-Kore", "Kore", "female", "en-GB", "Chirp 3 HD", "Firm, clear British delivery.", 7),
  google("en-US-Studio-O", "Studio O", "female", "en-US", "Studio", "Studio-recorded warmth and polish.", 8),
  google("en-US-Chirp3-HD-Rasalgethi", "Rasalgethi", "male", "en-US", "Chirp 3 HD", "Informative, measured pace.", 10),
  google("en-US-Chirp3-HD-Aoede", "Aoede", "female", "en-US", "Chirp 3 HD", "Breezy, natural, conversational.", 11),
  google("en-US-Chirp3-HD-Iapetus", "Iapetus", "male", "en-US", "Chirp 3 HD", "Clear, straightforward delivery.", 13),
  google("en-GB-Chirp3-HD-Charon", "Charon", "male", "en-GB", "Chirp 3 HD", "Informative British male narrator.", 15),
  google("en-US-Neural2-F", "Neural2 F", "female", "en-US", "Neural2", "Reliable, natural workhorse voice.", 17),
  google("en-GB-Studio-C", "Studio C", "female", "en-GB", "Studio", "Polished British studio voice.", 19),

  // --- Google, international rows for translation languages (G-8, #123) ---
  googleIntl("af-ZA-Standard-A", "Standard A", "female", "af-ZA", "South Africa", "Standard", "Narration voice for Afrikaans (South Africa)."),
  googleIntl("am-ET-Wavenet-A", "Wavenet A", "female", "am-ET", "Ethiopia", "Wavenet", "Narration voice for Amharic (Ethiopia)."),
  googleIntl("am-ET-Wavenet-B", "Wavenet B", "male", "am-ET", "Ethiopia", "Wavenet", "Narration voice for Amharic (Ethiopia)."),
  googleIntl("ar-XA-Chirp3-HD-Achernar", "Achernar", "female", "ar-XA", "Modern Standard", "Chirp 3 HD", "Narration voice for Arabic (Modern Standard)."),
  googleIntl("ar-XA-Chirp3-HD-Achird", "Achird", "male", "ar-XA", "Modern Standard", "Chirp 3 HD", "Narration voice for Arabic (Modern Standard)."),
  googleIntl("bg-BG-Chirp3-HD-Achernar", "Achernar", "female", "bg-BG", "Bulgaria", "Chirp 3 HD", "Narration voice for Bulgarian (Bulgaria)."),
  googleIntl("bg-BG-Chirp3-HD-Achird", "Achird", "male", "bg-BG", "Bulgaria", "Chirp 3 HD", "Narration voice for Bulgarian (Bulgaria)."),
  googleIntl("bn-IN-Chirp3-HD-Achernar", "Achernar", "female", "bn-IN", "India", "Chirp 3 HD", "Narration voice for Bengali (India)."),
  googleIntl("bn-IN-Chirp3-HD-Achird", "Achird", "male", "bn-IN", "India", "Chirp 3 HD", "Narration voice for Bengali (India)."),
  googleIntl("ca-ES-Standard-B", "Standard B", "female", "ca-ES", "Spain", "Standard", "Narration voice for Catalan (Spain)."),
  googleIntl("cmn-CN-Chirp3-HD-Achernar", "Achernar", "female", "zh-CN", "China", "Chirp 3 HD", "Narration voice for Chinese (Simplified) (China)."),
  googleIntl("cmn-CN-Chirp3-HD-Achird", "Achird", "male", "zh-CN", "China", "Chirp 3 HD", "Narration voice for Chinese (Simplified) (China)."),
  googleIntl("cmn-TW-Wavenet-A", "Wavenet A", "female", "zh-TW", "Taiwan", "Wavenet", "Narration voice for Chinese (Traditional) (Taiwan)."),
  googleIntl("cmn-TW-Wavenet-B", "Wavenet B", "male", "zh-TW", "Taiwan", "Wavenet", "Narration voice for Chinese (Traditional) (Taiwan)."),
  googleIntl("cs-CZ-Chirp3-HD-Achernar", "Achernar", "female", "cs-CZ", "Czechia", "Chirp 3 HD", "Narration voice for Czech (Czechia)."),
  googleIntl("cs-CZ-Chirp3-HD-Achird", "Achird", "male", "cs-CZ", "Czechia", "Chirp 3 HD", "Narration voice for Czech (Czechia)."),
  googleIntl("da-DK-Chirp3-HD-Achernar", "Achernar", "female", "da-DK", "Denmark", "Chirp 3 HD", "Narration voice for Danish (Denmark)."),
  googleIntl("da-DK-Chirp3-HD-Achird", "Achird", "male", "da-DK", "Denmark", "Chirp 3 HD", "Narration voice for Danish (Denmark)."),
  googleIntl("de-DE-Chirp3-HD-Achernar", "Achernar", "female", "de-DE", "Germany", "Chirp 3 HD", "Narration voice for German (Germany)."),
  googleIntl("de-DE-Chirp3-HD-Achird", "Achird", "male", "de-DE", "Germany", "Chirp 3 HD", "Narration voice for German (Germany)."),
  googleIntl("el-GR-Chirp3-HD-Achernar", "Achernar", "female", "el-GR", "Greece", "Chirp 3 HD", "Narration voice for Greek (Greece)."),
  googleIntl("el-GR-Chirp3-HD-Achird", "Achird", "male", "el-GR", "Greece", "Chirp 3 HD", "Narration voice for Greek (Greece)."),
  googleIntl("es-ES-Chirp3-HD-Achernar", "Achernar", "female", "es-ES", "Spain", "Chirp 3 HD", "Narration voice for Spanish (Spain)."),
  googleIntl("es-ES-Chirp3-HD-Achird", "Achird", "male", "es-ES", "Spain", "Chirp 3 HD", "Narration voice for Spanish (Spain)."),
  googleIntl("et-EE-Chirp3-HD-Achernar", "Achernar", "female", "et-EE", "Estonia", "Chirp 3 HD", "Narration voice for Estonian (Estonia)."),
  googleIntl("et-EE-Chirp3-HD-Achird", "Achird", "male", "et-EE", "Estonia", "Chirp 3 HD", "Narration voice for Estonian (Estonia)."),
  googleIntl("eu-ES-Standard-B", "Standard B", "female", "eu-ES", "Spain", "Standard", "Narration voice for Basque (Spain)."),
  googleIntl("fi-FI-Chirp3-HD-Achernar", "Achernar", "female", "fi-FI", "Finland", "Chirp 3 HD", "Narration voice for Finnish (Finland)."),
  googleIntl("fi-FI-Chirp3-HD-Achird", "Achird", "male", "fi-FI", "Finland", "Chirp 3 HD", "Narration voice for Finnish (Finland)."),
  googleIntl("fil-ph-Neural2-A", "Neural2 A", "female", "fil-PH", "Philippines", "Neural2", "Narration voice for Filipino (Philippines)."),
  googleIntl("fil-ph-Neural2-D", "Neural2 D", "male", "fil-PH", "Philippines", "Neural2", "Narration voice for Filipino (Philippines)."),
  googleIntl("fr-FR-Chirp3-HD-Achernar", "Achernar", "female", "fr-FR", "France", "Chirp 3 HD", "Narration voice for French (France)."),
  googleIntl("fr-FR-Chirp3-HD-Achird", "Achird", "male", "fr-FR", "France", "Chirp 3 HD", "Narration voice for French (France)."),
  googleIntl("gl-ES-Standard-B", "Standard B", "female", "gl-ES", "Spain", "Standard", "Narration voice for Galician (Spain)."),
  googleIntl("gu-IN-Chirp3-HD-Achernar", "Achernar", "female", "gu-IN", "India", "Chirp 3 HD", "Narration voice for Gujarati (India)."),
  googleIntl("gu-IN-Chirp3-HD-Achird", "Achird", "male", "gu-IN", "India", "Chirp 3 HD", "Narration voice for Gujarati (India)."),
  googleIntl("he-IL-Chirp3-HD-Achernar", "Achernar", "female", "he-IL", "Israel", "Chirp 3 HD", "Narration voice for Hebrew (Israel)."),
  googleIntl("he-IL-Chirp3-HD-Achird", "Achird", "male", "he-IL", "Israel", "Chirp 3 HD", "Narration voice for Hebrew (Israel)."),
  googleIntl("hi-IN-Chirp3-HD-Achernar", "Achernar", "female", "hi-IN", "India", "Chirp 3 HD", "Narration voice for Hindi (India)."),
  googleIntl("hi-IN-Chirp3-HD-Achird", "Achird", "male", "hi-IN", "India", "Chirp 3 HD", "Narration voice for Hindi (India)."),
  googleIntl("hr-HR-Chirp3-HD-Achernar", "Achernar", "female", "hr-HR", "Croatia", "Chirp 3 HD", "Narration voice for Croatian (Croatia)."),
  googleIntl("hr-HR-Chirp3-HD-Achird", "Achird", "male", "hr-HR", "Croatia", "Chirp 3 HD", "Narration voice for Croatian (Croatia)."),
  googleIntl("hu-HU-Chirp3-HD-Achernar", "Achernar", "female", "hu-HU", "Hungary", "Chirp 3 HD", "Narration voice for Hungarian (Hungary)."),
  googleIntl("hu-HU-Chirp3-HD-Achird", "Achird", "male", "hu-HU", "Hungary", "Chirp 3 HD", "Narration voice for Hungarian (Hungary)."),
  googleIntl("id-ID-Chirp3-HD-Achernar", "Achernar", "female", "id-ID", "Indonesia", "Chirp 3 HD", "Narration voice for Indonesian (Indonesia)."),
  googleIntl("id-ID-Chirp3-HD-Achird", "Achird", "male", "id-ID", "Indonesia", "Chirp 3 HD", "Narration voice for Indonesian (Indonesia)."),
  googleIntl("is-IS-Standard-B", "Standard B", "female", "is-IS", "Iceland", "Standard", "Narration voice for Icelandic (Iceland)."),
  googleIntl("it-IT-Chirp3-HD-Achernar", "Achernar", "female", "it-IT", "Italy", "Chirp 3 HD", "Narration voice for Italian (Italy)."),
  googleIntl("it-IT-Chirp3-HD-Achird", "Achird", "male", "it-IT", "Italy", "Chirp 3 HD", "Narration voice for Italian (Italy)."),
  googleIntl("ja-JP-Chirp3-HD-Achernar", "Achernar", "female", "ja-JP", "Japan", "Chirp 3 HD", "Narration voice for Japanese (Japan)."),
  googleIntl("ja-JP-Chirp3-HD-Achird", "Achird", "male", "ja-JP", "Japan", "Chirp 3 HD", "Narration voice for Japanese (Japan)."),
  googleIntl("kn-IN-Chirp3-HD-Achernar", "Achernar", "female", "kn-IN", "India", "Chirp 3 HD", "Narration voice for Kannada (India)."),
  googleIntl("kn-IN-Chirp3-HD-Achird", "Achird", "male", "kn-IN", "India", "Chirp 3 HD", "Narration voice for Kannada (India)."),
  googleIntl("ko-KR-Chirp3-HD-Achernar", "Achernar", "female", "ko-KR", "Korea", "Chirp 3 HD", "Narration voice for Korean (Korea)."),
  googleIntl("ko-KR-Chirp3-HD-Achird", "Achird", "male", "ko-KR", "Korea", "Chirp 3 HD", "Narration voice for Korean (Korea)."),
  googleIntl("lt-LT-Chirp3-HD-Achernar", "Achernar", "female", "lt-LT", "Lithuania", "Chirp 3 HD", "Narration voice for Lithuanian (Lithuania)."),
  googleIntl("lt-LT-Chirp3-HD-Achird", "Achird", "male", "lt-LT", "Lithuania", "Chirp 3 HD", "Narration voice for Lithuanian (Lithuania)."),
  googleIntl("lv-LV-Chirp3-HD-Achernar", "Achernar", "female", "lv-LV", "Latvia", "Chirp 3 HD", "Narration voice for Latvian (Latvia)."),
  googleIntl("lv-LV-Chirp3-HD-Achird", "Achird", "male", "lv-LV", "Latvia", "Chirp 3 HD", "Narration voice for Latvian (Latvia)."),
  googleIntl("ml-IN-Chirp3-HD-Achernar", "Achernar", "female", "ml-IN", "India", "Chirp 3 HD", "Narration voice for Malayalam (India)."),
  googleIntl("ml-IN-Chirp3-HD-Achird", "Achird", "male", "ml-IN", "India", "Chirp 3 HD", "Narration voice for Malayalam (India)."),
  googleIntl("mr-IN-Chirp3-HD-Achernar", "Achernar", "female", "mr-IN", "India", "Chirp 3 HD", "Narration voice for Marathi (India)."),
  googleIntl("mr-IN-Chirp3-HD-Achird", "Achird", "male", "mr-IN", "India", "Chirp 3 HD", "Narration voice for Marathi (India)."),
  googleIntl("ms-MY-Wavenet-A", "Wavenet A", "female", "ms-MY", "Malaysia", "Wavenet", "Narration voice for Malay (Malaysia)."),
  googleIntl("ms-MY-Wavenet-B", "Wavenet B", "male", "ms-MY", "Malaysia", "Wavenet", "Narration voice for Malay (Malaysia)."),
  googleIntl("nb-NO-Chirp3-HD-Achernar", "Achernar", "female", "nb-NO", "Norway", "Chirp 3 HD", "Narration voice for Norwegian (Norway)."),
  googleIntl("nb-NO-Chirp3-HD-Achird", "Achird", "male", "nb-NO", "Norway", "Chirp 3 HD", "Narration voice for Norwegian (Norway)."),
  googleIntl("nl-NL-Chirp3-HD-Achernar", "Achernar", "female", "nl-NL", "Netherlands", "Chirp 3 HD", "Narration voice for Dutch (Netherlands)."),
  googleIntl("nl-NL-Chirp3-HD-Achird", "Achird", "male", "nl-NL", "Netherlands", "Chirp 3 HD", "Narration voice for Dutch (Netherlands)."),
  googleIntl("pa-IN-Chirp3-HD-Achernar", "Achernar", "female", "pa-IN", "India", "Chirp 3 HD", "Narration voice for Punjabi (India)."),
  googleIntl("pa-IN-Chirp3-HD-Achird", "Achird", "male", "pa-IN", "India", "Chirp 3 HD", "Narration voice for Punjabi (India)."),
  googleIntl("pl-PL-Chirp3-HD-Achernar", "Achernar", "female", "pl-PL", "Poland", "Chirp 3 HD", "Narration voice for Polish (Poland)."),
  googleIntl("pl-PL-Chirp3-HD-Achird", "Achird", "male", "pl-PL", "Poland", "Chirp 3 HD", "Narration voice for Polish (Poland)."),
  googleIntl("pt-BR-Chirp3-HD-Achernar", "Achernar", "female", "pt-BR", "Brazil", "Chirp 3 HD", "Narration voice for Portuguese (Brazil)."),
  googleIntl("pt-BR-Chirp3-HD-Achird", "Achird", "male", "pt-BR", "Brazil", "Chirp 3 HD", "Narration voice for Portuguese (Brazil)."),
  googleIntl("ro-RO-Chirp3-HD-Achernar", "Achernar", "female", "ro-RO", "Romania", "Chirp 3 HD", "Narration voice for Romanian (Romania)."),
  googleIntl("ro-RO-Chirp3-HD-Achird", "Achird", "male", "ro-RO", "Romania", "Chirp 3 HD", "Narration voice for Romanian (Romania)."),
  googleIntl("ru-RU-Chirp3-HD-Aoede", "Aoede", "female", "ru-RU", "Russia", "Chirp 3 HD", "Narration voice for Russian (Russia)."),
  googleIntl("ru-RU-Chirp3-HD-Charon", "Charon", "male", "ru-RU", "Russia", "Chirp 3 HD", "Narration voice for Russian (Russia)."),
  googleIntl("sk-SK-Chirp3-HD-Achernar", "Achernar", "female", "sk-SK", "Slovakia", "Chirp 3 HD", "Narration voice for Slovak (Slovakia)."),
  googleIntl("sk-SK-Chirp3-HD-Achird", "Achird", "male", "sk-SK", "Slovakia", "Chirp 3 HD", "Narration voice for Slovak (Slovakia)."),
  googleIntl("sl-SI-Chirp3-HD-Achernar", "Achernar", "female", "sl-SI", "Slovenia", "Chirp 3 HD", "Narration voice for Slovenian (Slovenia)."),
  googleIntl("sl-SI-Chirp3-HD-Achird", "Achird", "male", "sl-SI", "Slovenia", "Chirp 3 HD", "Narration voice for Slovenian (Slovenia)."),
  googleIntl("sr-RS-Chirp3-HD-Achernar", "Achernar", "female", "sr-RS", "Serbia", "Chirp 3 HD", "Narration voice for Serbian (Serbia)."),
  googleIntl("sr-RS-Chirp3-HD-Achird", "Achird", "male", "sr-RS", "Serbia", "Chirp 3 HD", "Narration voice for Serbian (Serbia)."),
  googleIntl("sv-SE-Chirp3-HD-Achernar", "Achernar", "female", "sv-SE", "Sweden", "Chirp 3 HD", "Narration voice for Swedish (Sweden)."),
  googleIntl("sv-SE-Chirp3-HD-Achird", "Achird", "male", "sv-SE", "Sweden", "Chirp 3 HD", "Narration voice for Swedish (Sweden)."),
  googleIntl("sw-KE-Chirp3-HD-Achernar", "Achernar", "female", "sw-KE", "Kenya", "Chirp 3 HD", "Narration voice for Swahili (Kenya)."),
  googleIntl("sw-KE-Chirp3-HD-Achird", "Achird", "male", "sw-KE", "Kenya", "Chirp 3 HD", "Narration voice for Swahili (Kenya)."),
  googleIntl("ta-IN-Chirp3-HD-Achernar", "Achernar", "female", "ta-IN", "India", "Chirp 3 HD", "Narration voice for Tamil (India)."),
  googleIntl("ta-IN-Chirp3-HD-Achird", "Achird", "male", "ta-IN", "India", "Chirp 3 HD", "Narration voice for Tamil (India)."),
  googleIntl("te-IN-Chirp3-HD-Achernar", "Achernar", "female", "te-IN", "India", "Chirp 3 HD", "Narration voice for Telugu (India)."),
  googleIntl("te-IN-Chirp3-HD-Achird", "Achird", "male", "te-IN", "India", "Chirp 3 HD", "Narration voice for Telugu (India)."),
  googleIntl("th-TH-Chirp3-HD-Achernar", "Achernar", "female", "th-TH", "Thailand", "Chirp 3 HD", "Narration voice for Thai (Thailand)."),
  googleIntl("th-TH-Chirp3-HD-Achird", "Achird", "male", "th-TH", "Thailand", "Chirp 3 HD", "Narration voice for Thai (Thailand)."),
  googleIntl("tr-TR-Chirp3-HD-Achernar", "Achernar", "female", "tr-TR", "Türkiye", "Chirp 3 HD", "Narration voice for Turkish (Türkiye)."),
  googleIntl("tr-TR-Chirp3-HD-Achird", "Achird", "male", "tr-TR", "Türkiye", "Chirp 3 HD", "Narration voice for Turkish (Türkiye)."),
  googleIntl("uk-UA-Chirp3-HD-Achernar", "Achernar", "female", "uk-UA", "Ukraine", "Chirp 3 HD", "Narration voice for Ukrainian (Ukraine)."),
  googleIntl("uk-UA-Chirp3-HD-Achird", "Achird", "male", "uk-UA", "Ukraine", "Chirp 3 HD", "Narration voice for Ukrainian (Ukraine)."),
  googleIntl("ur-IN-Chirp3-HD-Achernar", "Achernar", "female", "ur-IN", "India", "Chirp 3 HD", "Narration voice for Urdu (India)."),
  googleIntl("ur-IN-Chirp3-HD-Achird", "Achird", "male", "ur-IN", "India", "Chirp 3 HD", "Narration voice for Urdu (India)."),
  googleIntl("vi-VN-Chirp3-HD-Achernar", "Achernar", "female", "vi-VN", "Vietnam", "Chirp 3 HD", "Narration voice for Vietnamese (Vietnam)."),
  googleIntl("vi-VN-Chirp3-HD-Achird", "Achird", "male", "vi-VN", "Vietnam", "Chirp 3 HD", "Narration voice for Vietnamese (Vietnam)."),
  googleIntl("yue-HK-Chirp3-HD-Achernar", "Achernar", "female", "yue-HK", "Hong Kong", "Chirp 3 HD", "Narration voice for Cantonese (Hong Kong)."),
  googleIntl("yue-HK-Chirp3-HD-Achird", "Achird", "male", "yue-HK", "Hong Kong", "Chirp 3 HD", "Narration voice for Cantonese (Hong Kong)."),
];

// ---------------------------------------------------------------------------
// Catalogue queries (all computed from the rows — no hard-coded counts)
// ---------------------------------------------------------------------------

/** Free-tier cap: at most this many basic voices per language (consult §8.4:
 * the cap is a per-language shortlist, so non-English authors aren't starved). */
export const BASIC_VOICE_CAP_PER_LANGUAGE = 20;

export function voiceById(id: string): NarrationVoice | undefined {
  return VOICE_CATALOGUE.find((v) => v.id === id);
}

export function voicesForEngine(engine: NarrationEngineId): NarrationVoice[] {
  return VOICE_CATALOGUE.filter((v) => v.engine === engine);
}

/**
 * The free/basic shortlist: basic-tier voices in basicRank order, capped
 * per language. This is what a free account's picker offers.
 */
export function basicVoices(lang?: string): NarrationVoice[] {
  const byLang = new Map<string, NarrationVoice[]>();
  for (const v of VOICE_CATALOGUE) {
    if (v.tier !== "basic") continue;
    if (lang && v.lang !== lang) continue;
    const list = byLang.get(v.lang) ?? [];
    list.push(v);
    byLang.set(v.lang, list);
  }
  const out: NarrationVoice[] = [];
  for (const list of byLang.values()) {
    list.sort((a, b) => (a.basicRank ?? 999) - (b.basicRank ?? 999));
    out.push(...list.slice(0, BASIC_VOICE_CAP_PER_LANGUAGE));
  }
  return out.sort((a, b) => (a.basicRank ?? 999) - (b.basicRank ?? 999));
}

/** The paid picker's first screen: the cross-engine Top N by realism rank. */
export function rankedTopVoices(limit = 20): NarrationVoice[] {
  return VOICE_CATALOGUE.filter((v) => v.rank !== undefined)
    .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))
    .slice(0, limit);
}

/**
 * The selectable-voice count for marketing copy (consult §2.6/§8.6):
 * computed from catalogue rows, never a vendor headline. `premium: true`
 * counts the paid catalogue (all rows); otherwise the free shortlist.
 */
export function pickerVoiceCount(opts?: { premium?: boolean }): number {
  return opts?.premium ? VOICE_CATALOGUE.length : basicVoices().length;
}
