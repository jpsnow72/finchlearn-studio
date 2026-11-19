/**
 * translation.ts — editor wiring for project translation (issue #54).
 *
 * Builds the provider from the editor's build configuration and runs
 * the variant flow with the production narration path as the
 * re-voicing hook, so translated lines are generated with the shipped
 * TTS stack and re-timed from the measured audio, exactly like the
 * Dialogue panel's Generate narration flow.
 *
 * The translation API key is read from the build environment variable
 * named VITE_GOOGLE_TRANSLATE_API_KEY (secret name only; no value is
 * stored in this repo). When it is absent the provider reports itself
 * unconfigured and the panel shows the honest not-configured state;
 * no variant is created and nothing is faked.
 */
import type { VideoProject } from "@finch-studio/core";
import {
  createTranslatedVariant,
  googleTranslateProviderFromKey,
  type CreatedVariant,
} from "@finch-studio/translation";
import { characterVoiceId } from "./store";
import { ensureLineAudio } from "./narration";

export function translationProvider() {
  return googleTranslateProviderFromKey(
    () =>
      (import.meta.env.VITE_GOOGLE_TRANSLATE_API_KEY as string | undefined) ??
      null,
  );
}

export function translationConfigured(): boolean {
  return translationProvider().isConfigured;
}

export async function buildTranslatedVariant(
  project: VideoProject,
  targetLanguage: string,
  voiceOverrides?: Record<string, string | null>,
): Promise<CreatedVariant> {
  return createTranslatedVariant(project, {
    provider: translationProvider(),
    targetLanguage,
    voiceOverrides,
    sourceVoiceOf: (object) => characterVoiceId(object) || undefined,
    measureLineMs: async (text, voiceId) => {
      const { durationSec } = await ensureLineAudio(text, voiceId);
      return durationSec * 1000;
    },
  });
}
