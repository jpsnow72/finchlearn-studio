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
 * Google rows seeded so far are exactly the Google voices named in the
 * Top 20; the full Google catalogue lands as more rows later — the picker
 * count below is COMPUTED from rows, per the consult's marketing rule
 * (§2.6/§8.6: advertise only what the picker can actually select).
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

/** The seeded catalogue: Kokoro's full English set + the ranked Google voices. */
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
