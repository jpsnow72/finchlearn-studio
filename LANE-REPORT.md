# G-8 lane report: Studio video translation at scale (finchlearn-studio #123)

Build-only lane. Branch lane/p6-g8 on squiggles at ~/lane-p6-g8, based on
finchlearn-studio dev-polish 0b0d0be0 (verified from GitHub at lane start).
No gate, no PR, no merge, no ship from this lane.

## What was built

Route per the Nov 22 decision: widen the existing Google Translate plus
Google Cloud TTS chain, no new account, no paid dubbing service.

1. Provider enumeration (packages/translation/src/support.ts, new):
   - GOOGLE_TRANSLATE_LANGUAGES: the documented Google Cloud Translation
     (NMT) target codes, from Google's published language support list as
     read on 2026-11-24.
   - GOOGLE_TTS_LOCALES: the 66 Google Cloud TTS locales that returned at
     least one voice from the live voices API on 2026-11-24 (2,066 voices
     total at enumeration time). Surprising zeros were re-verified
     individually (fa-IR, si-LK, ne-NP, km-KH, az-AZ, ka-GE and others
     genuinely return no voices right now, so those languages compute as
     partial; the computation follows the data if Google adds voices and
     catalogue rows land).
   - Support is COMPUTED, never asserted per language: full when the
     language is translation-supported AND the shipped voice catalogue
     gives the variant builder's own mapping rule a voice for it;
     partial otherwise. Lip sync rides the viseme model driven by
     dialogue timing, so it regenerates exactly where dialogue is
     re-voiced (full) and has nothing to sync to where no voice exists
     (partial). Partial carries a picker-facing note
     (PARTIAL_LANGUAGE_NOTE).

2. Language set widened from 20 to 110 (packages/translation/src/languages.ts):
   - 55 full: the original 20 plus Afrikaans, Amharic, Bulgarian,
     Bengali, Catalan, Cantonese, Chinese (Traditional), Czech, Danish,
     Greek, Estonian, Basque, Filipino (translateCode tl), Finnish,
     Galician, Gujarati, Croatian, Hungarian, Icelandic, Kannada,
     Lithuanian, Latvian, Malayalam, Marathi, Malay, Norwegian Bokmal
     (translateCode no), Punjabi, Romanian, Slovak, Slovenian, Serbian,
     Swahili, Tamil, Telugu, Urdu.
   - 55 partial, all translation-documented: Albanian, Azerbaijani,
     Belarusian, Bosnian, Cebuano, Corsican, Welsh, Esperanto, Persian,
     Frisian, Irish, Scots Gaelic, Hausa, Hawaiian, Hmong, Haitian
     Creole, Armenian, Igbo, Javanese (translateCode jw), Georgian,
     Kazakh, Khmer, Kurdish, Kyrgyz, Latin, Luxembourgish, Lingala, Lao,
     Malagasy, Maori, Macedonian, Mongolian, Maltese, Burmese, Nepali,
     Chichewa, Pashto, Kinyarwanda, Sanskrit, Sindhi, Sinhala, Samoan,
     Shona, Somali, Sesotho, Sundanese, Tajik, Turkmen, Tatar, Uyghur,
     Uzbek, Xhosa, Yiddish, Yoruba, Zulu.

3. Voice catalogue rows (packages/audio/src/voices.ts): 105 new Google
   rows via a new googleIntl factory: one female and one male voice per
   full language (one female only for af, ca, eu, gl, is, where the live
   list has a single voice), taken from the actual live voice list,
   preferring Chirp 3 HD, then Neural2, Studio, Wavenet, Standard.
   Mandarin rows carry catalogue lang zh-CN / zh-TW with cmn voice ids;
   the narration path derives the API language code from the voice id,
   so synthesis still addresses cmn-CN / cmn-TW. Rows are unranked, so
   the English cross-engine Top 20 is untouched.

4. Variant builder (packages/translation/src/variant.ts): each variant
   now records its computed support level in its extension metadata and
   in VariantReport.support. Partial variants build the existing honest
   unvoiced shape (translated text and captions, characters flagged
   needs-assignment). One-click flow shape unchanged.

5. Picker (apps/editor/src/components/TranslatePanel.tsx): options come
   from supportedLanguages(); partial options are suffixed "text and
   captions only", and selecting a partial language shows the
   explanation note under the picker. Existing classes and theme tokens
   only; no look changes.

6. Package description updated (packages/translation/package.json).

## Files

- packages/translation/src/support.ts (new, +236)
- packages/translation/src/languages.ts (widened set, header rewritten)
- packages/translation/src/variant.ts (support on meta and report)
- packages/translation/src/index.ts (export support)
- packages/translation/src/translation.test.ts (counts, support pins,
  partial and full variant builds; the old no-voice tests moved from
  Thai, which is now full, to Persian, which is partial)
- packages/translation/package.json (description)
- packages/audio/src/voices.ts (googleIntl factory, 105 rows, header)
- apps/editor/src/components/TranslatePanel.tsx (picker labelling)

## Verification (firsthand, in the lane tree)

- @finch-studio/translation tests: 31 passed, 0 failed (includes pins:
  110 offered, 55 full, 55 partial; representative full and partial
  languages; every offered language translation-documented; full
  exactly where the TTS enumeration covers; a partial Persian variant
  and a full German variant built end to end with a mapped de-DE voice).
- @finch-studio/audio tests: 37 passed, 0 failed.
- Full workspace test run: 754 tests passed across 12 workspace suites,
  0 failed.
- Root typecheck across all workspaces: exit 0.

## Honest gaps and what remains

- This lane does not close #123. Still owed by the ship line: gate
  (gate-studio.sh), blob-SHA sweep, dev deploy, and live verification on
  devstudio.finchlearn.com (create a variant in a newly wired full
  language and confirm narration, captions, and the partial marking in
  the picker). The issue closes only after that live pass.
- Live verification needs the editor build to carry a Google Translate
  key (VITE_GOOGLE_TRANSLATE_API_KEY); without it the panel honestly
  reports not configured, as before. That is a build configuration item
  for the ship line, not new code.
- Native-name spellings for the 90 added languages are data written for
  this lane; codes, support levels, and voice ids are the pinned,
  provider-verified parts.
- Five full languages (Afrikaans, Catalan, Basque, Galician, Icelandic)
  have exactly one voice in the live list today (female), so male
  characters fall back to that voice under the existing mapping rule
  (same-gender preference, then best available). Marked here rather
  than hidden; the support level stays full because narration, captions,
  and lip sync all carry.
- No new user setting was added, so the admin-defaults rule has no
  application in this lane.
