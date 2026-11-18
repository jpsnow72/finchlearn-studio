/**
 * Text-to-speech provider interface (SPEC §7.8, rev 27).
 *
 * The dialogue system speaks through a `TtsProvider` so paid services
 * (ElevenLabs, Google Cloud TTS) can be swapped in later as upgrades.
 * The built-in `BrowserTtsProvider` uses the free `SpeechSynthesis` API —
 * no API key, no backend, zero setup. Quality varies by browser/OS voice.
 */

/** A speakable voice. */
export interface TtsVoice {
  /** Stable identifier (SpeechSynthesisVoice.voiceURI). */
  id: string;
  name: string;
  lang: string;
  /** True for on-device voices (work offline). */
  local: boolean;
  isDefault: boolean;
}

export interface SpeakOptions {
  voiceId?: string;
  /** 0.1–10. Defaults to 1. */
  rate?: number;
  /** 0–2. Defaults to 1. */
  pitch?: number;
  /** 0–1. Defaults to 1. */
  volume?: number;
  onEnd?: () => void;
  onError?: (message: string) => void;
}

/**
 * TTS provider contract. Implementations: `BrowserTtsProvider` (free,
 * built-in). Future: ElevenLabs / Google Cloud TTS as paid upgrades.
 */
export interface TtsProvider {
  readonly providerName: string;
  /** False when the underlying API is unavailable (e.g. no speechSynthesis). */
  readonly isAvailable: boolean;
  voices(): Promise<TtsVoice[]>;
  speak(text: string, opts?: SpeakOptions): void;
  stop(): void;
  /** True while an utterance is playing. */
  readonly speaking: boolean;
}

/**
 * Browser built-in TTS via `window.speechSynthesis`. Completely free —
 * no key, no network. Voice quality depends on the OS/browser.
 */
export class BrowserTtsProvider implements TtsProvider {
  readonly providerName = "browser";
  private cached: TtsVoice[] | null = null;

  get isAvailable(): boolean {
    return (
      typeof window !== "undefined" &&
      typeof window.speechSynthesis !== "undefined"
    );
  }

  get speaking(): boolean {
    return this.isAvailable && window.speechSynthesis.speaking;
  }

  async voices(): Promise<TtsVoice[]> {
    if (!this.isAvailable) return [];
    if (this.cached) return this.cached;
    const synth = window.speechSynthesis;
    const read = (): SpeechSynthesisVoice[] => synth.getVoices();
    let list = read();
    if (list.length === 0) {
      // Chrome loads voices async; wait for the event (with timeout).
      list = await new Promise<SpeechSynthesisVoice[]>((resolve) => {
        const timer = window.setTimeout(() => resolve(read()), 1500);
        const handler = () => {
          window.clearTimeout(timer);
          synth.removeEventListener("voiceschanged", handler);
          resolve(read());
        };
        synth.addEventListener("voiceschanged", handler);
      });
    }
    this.cached = list.map((v) => ({
      id: v.voiceURI,
      name: v.name,
      lang: v.lang,
      local: v.localService,
      isDefault: v.default,
    }));
    return this.cached;
  }

  speak(text: string, opts: SpeakOptions = {}): void {
    if (!this.isAvailable) {
      opts.onError?.("Speech synthesis is not available in this browser.");
      return;
    }
    const synth = window.speechSynthesis;
    synth.cancel(); // one utterance at a time
    const utter = new SpeechSynthesisUtterance(text);
    if (opts.voiceId) {
      const v = synth.getVoices().find((x) => x.voiceURI === opts.voiceId);
      if (v) utter.voice = v;
    }
    if (opts.rate !== undefined) utter.rate = Math.min(10, Math.max(0.1, opts.rate));
    if (opts.pitch !== undefined) utter.pitch = Math.min(2, Math.max(0, opts.pitch));
    if (opts.volume !== undefined) utter.volume = Math.min(1, Math.max(0, opts.volume));
    if (opts.onEnd) utter.onend = opts.onEnd;
    utter.onerror = () => opts.onError?.("Speech synthesis playback failed.");
    synth.speak(utter);
  }

  stop(): void {
    if (this.isAvailable) window.speechSynthesis.cancel();
  }
}

/** Shared singleton for the built-in provider. */
export const browserTts = new BrowserTtsProvider();
