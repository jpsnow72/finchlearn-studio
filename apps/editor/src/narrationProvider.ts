/**
 * narrationProvider.ts — the TtsProvider the dialogue engine speaks
 * through. Production voices (Kokoro/Google, see narration.ts) play
 * their generated audio; the empty voice id keeps the free browser
 * voice as the fallback. Generation happens lazily on first speak and
 * is cached, so pressing play just works; the Dialogue panel's
 * Generate button pre-warms the cache and fixes line durations.
 */
import { browserTts, type SpeakOptions, type TtsProvider, type TtsVoice } from "@finch-studio/animation";
import { VOICE_CATALOGUE } from "@finch-studio/audio";
import { lineAudioUrl } from "./narration";

export class NarrationAudioProvider implements TtsProvider {
  readonly providerName = "finch-narration";
  private audio: HTMLAudioElement | null = null;

  get isAvailable(): boolean {
    return true;
  }

  get speaking(): boolean {
    return this.audio ? !this.audio.paused : browserTts.speaking;
  }

  async voices(): Promise<TtsVoice[]> {
    return VOICE_CATALOGUE.map((v) => ({
      id: v.id,
      name: `${v.name} (${v.engine === "google" ? "Premium" : "Basic"})`,
      lang: v.lang,
      local: false,
      isDefault: false,
    }));
  }

  speak(text: string, opts?: SpeakOptions): void {
    const voiceId = opts?.voiceId;
    if (!voiceId) {
      browserTts.speak(text, opts);
      return;
    }
    this.stop();
    void lineAudioUrl(text, voiceId)
      .then((url) => {
        const el = new Audio(url);
        this.audio = el;
        el.onended = () => {
          if (this.audio === el) this.audio = null;
          opts?.onEnd?.();
        };
        void el.play().catch((err) => opts?.onError?.(String(err)));
      })
      .catch((err: unknown) => {
        opts?.onError?.(err instanceof Error ? err.message : String(err));
      });
  }

  stop(): void {
    if (this.audio) {
      this.audio.pause();
      this.audio = null;
    }
    browserTts.stop();
  }
}

export const narrationTts = new NarrationAudioProvider();
