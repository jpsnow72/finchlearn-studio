/**
 * Dialogue engine (SPEC §7.8, rev 27).
 *
 * Schedules spoken lines against the scene clock. Call `update(tMs)` every
 * frame (or on clock ticks); lines whose `[start, start+duration)` window
 * opens get spoken through the configured `TtsProvider`. Each line speaks at
 * most once per playthrough — seeking backwards re-arms it.
 *
 * Speech bubbles are rendered separately (CharacterRenderer reads the same
 * `speech` windows); this module only handles the audio side.
 */
import type { TtsProvider, SpeakOptions } from "./tts.js";

export interface DialogueLine {
  id: string;
  /** Character object id (for future per-character voices). */
  characterId?: string;
  text: string;
  /** Ms from scene start. */
  start: number;
  /** Ms the line is "active" (bubble visible). TTS may run longer. */
  duration: number;
  voiceId?: string;
  rate?: number;
  pitch?: number;
}

export interface DialoguePlayerOptions {
  provider: TtsProvider;
  onLineStart?: (line: DialogueLine) => void;
  onLineEnd?: (line: DialogueLine) => void;
  onError?: (message: string) => void;
}

export class DialoguePlayer {
  private provider: TtsProvider;
  private opts: DialoguePlayerOptions;
  private spoken = new Set<string>();
  private lastT = -1;

  constructor(opts: DialoguePlayerOptions) {
    this.opts = opts;
    this.provider = opts.provider;
  }

  /**
   * Advance the dialogue clock. Speaks any line whose window newly opened
   * since the last update. Call with the scene time in ms.
   */
  update(tMs: number, lines: DialogueLine[]): void {
    // Seek backwards (or restart) → re-arm everything at/after the new time.
    if (tMs < this.lastT) {
      for (const id of [...this.spoken]) {
        const line = lines.find((l) => l.id === id);
        if (line && line.start >= tMs) this.spoken.delete(id);
      }
      this.provider.stop();
    }
    this.lastT = tMs;
    if (!this.provider.isAvailable) return;
    for (const line of lines) {
      if (this.spoken.has(line.id)) continue;
      if (tMs >= line.start && tMs < line.start + line.duration) {
        this.spoken.add(line.id);
        this.opts.onLineStart?.(line);
        const speakOpts: SpeakOptions = {
          onEnd: () => this.opts.onLineEnd?.(line),
          onError: (m) => this.opts.onError?.(m),
        };
        if (line.voiceId !== undefined) speakOpts.voiceId = line.voiceId;
        if (line.rate !== undefined) speakOpts.rate = line.rate;
        if (line.pitch !== undefined) speakOpts.pitch = line.pitch;
        this.provider.speak(line.text, speakOpts);
      }
    }
  }

  /** Stop audio and reset for a fresh playthrough. */
  reset(): void {
    this.spoken.clear();
    this.lastT = -1;
    this.provider.stop();
  }
}
