/**
 * voices.ts — the voice mapping rule for translated variants (#54).
 *
 * Rule (deterministic, computed from the shipped voice catalogue):
 *  1. Candidates are catalogue voices whose language matches the target
 *     language: an exact BCP-47 match first (for example a target of
 *     "en-GB" prefers "en-GB" voices), then voices sharing the primary
 *     subtag (a target of "es" matches "es-ES" and "es-MX" voices).
 *  2. Voices flagged `avoid` in the catalogue are never auto-mapped.
 *  3. Within the candidates, a voice with the same gender as the
 *     character's source voice wins, so a character keeps its gender
 *     across languages.
 *  4. Remaining ties break by catalogue quality order: combined realism
 *     `rank`, then the basic shortlist `basicRank`, then voice id.
 *
 * The catalogue is data: as same-language voices are added to it, this
 * rule picks them up with no code change. When the catalogue has NO
 * voice for the target language the mapper returns `voiceId: null`
 * with an explicit reason. The variant then leaves that character
 * unvoiced (flagged for assignment) instead of narrating translated
 * text in a wrong-language voice; the user assigns a voice per
 * character in the variant's Dialogue panel, which is also where any
 * automatic mapping can be overridden.
 */
import { VOICE_CATALOGUE, voiceById, type NarrationVoice } from "@finch-studio/audio";
import { primarySubtag } from "./languages.js";

export interface VoiceMapping {
  voiceId: string | null;
  /** Human-readable account of the decision, shown in the report. */
  reason: string;
}

function quality(a: NarrationVoice, b: NarrationVoice): number {
  return (
    (a.rank ?? 999) - (b.rank ?? 999) ||
    (a.basicRank ?? 999) - (b.basicRank ?? 999) ||
    a.id.localeCompare(b.id)
  );
}

/** Catalogue voices that can speak `lang`, best first per the rule. */
export function voicesForLanguage(
  lang: string,
  catalogue: NarrationVoice[] = VOICE_CATALOGUE,
): NarrationVoice[] {
  const exact = catalogue.filter((v) => v.lang === lang && !v.avoid);
  const samePrimary = catalogue.filter(
    (v) => v.lang !== lang && primarySubtag(v.lang) === primarySubtag(lang) && !v.avoid,
  );
  return [...exact.sort(quality), ...samePrimary.sort(quality)];
}

/**
 * Map one character's source voice to a voice for the target language.
 * `sourceVoiceId` may be undefined (browser voice / unassigned), in
 * which case the best voice for the language is chosen on gender-free
 * quality order.
 */
export function mapVoiceForLanguage(
  sourceVoiceId: string | undefined,
  targetLang: string,
  catalogue: NarrationVoice[] = VOICE_CATALOGUE,
): VoiceMapping {
  const candidates = voicesForLanguage(targetLang, catalogue);
  if (candidates.length === 0) {
    return {
      voiceId: null,
      reason: `No voice in the catalogue speaks ${targetLang} yet, so this character is left for manual voice assignment in the variant.`,
    };
  }
  const source = sourceVoiceId ? voiceById(sourceVoiceId) : undefined;
  const sameGender = source
    ? candidates.filter((v) => v.gender === source.gender)
    : [];
  const pick = (sameGender.length > 0 ? sameGender : candidates)[0];
  return {
    voiceId: pick.id,
    reason: source
      ? `Mapped ${source.name} (${source.lang}) to ${pick.name} (${pick.lang}) as the best ${pick.gender} voice for ${targetLang}.`
      : `Assigned ${pick.name} (${pick.lang}) as the best voice for ${targetLang}.`,
  };
}
