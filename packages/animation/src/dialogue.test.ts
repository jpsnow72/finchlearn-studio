/**
 * DialoguePlayer (SPEC §7.8): lines speak once per playthrough, seeking
 * backwards re-arms them. Uses a fake TtsProvider — no browser needed.
 */
import { describe, expect, it, vi } from "vitest";
import { DialoguePlayer, type DialogueLine } from "./dialogue.js";
import type { TtsProvider, SpeakOptions } from "./tts.js";

function fakeProvider(): TtsProvider & { spoken: string[] } {
  const spoken: string[] = [];
  return {
    providerName: "fake",
    isAvailable: true,
    speaking: false,
    spoken,
    voices: async () => [],
    speak: (text: string, _opts?: SpeakOptions) => {
      spoken.push(text);
      _opts?.onEnd?.();
    },
    stop: () => {},
  };
}

const line = (id: string, start: number, duration = 2000): DialogueLine => ({
  id,
  text: `Line ${id}`,
  start,
  duration,
});

describe("DialoguePlayer", () => {
  it("speaks each line once when its window opens", () => {
    const p = fakeProvider();
    const d = new DialoguePlayer({ provider: p });
    const lines = [line("a", 1000), line("b", 3000)];
    d.update(0, lines);
    expect(p.spoken).toEqual([]);
    d.update(1000, lines);
    expect(p.spoken).toEqual(["Line a"]);
    d.update(1500, lines); // still in window — no repeat
    expect(p.spoken).toEqual(["Line a"]);
    d.update(3000, lines);
    expect(p.spoken).toEqual(["Line a", "Line b"]);
  });

  it("re-arms lines on backward seek", () => {
    const p = fakeProvider();
    const d = new DialoguePlayer({ provider: p });
    const lines = [line("a", 1000)];
    d.update(1200, lines);
    expect(p.spoken).toEqual(["Line a"]);
    d.update(500, lines); // seek back
    d.update(1100, lines);
    expect(p.spoken).toEqual(["Line a", "Line a"]);
  });

  it("reset clears spoken state", () => {
    const p = fakeProvider();
    const d = new DialoguePlayer({ provider: p });
    const lines = [line("a", 1000)];
    d.update(1200, lines);
    d.reset();
    d.update(1100, lines);
    expect(p.spoken).toEqual(["Line a", "Line a"]);
  });

  it("does nothing when the provider is unavailable", () => {
    const p = fakeProvider();
    (p as { isAvailable: boolean }).isAvailable = false;
    const d = new DialoguePlayer({ provider: p });
    d.update(5000, [line("a", 1000)]);
    expect(p.spoken).toEqual([]);
  });

  it("fires onLineStart/onLineEnd callbacks", () => {
    const p = fakeProvider();
    const started: string[] = [];
    const ended: string[] = [];
    const d = new DialoguePlayer({
      provider: p,
      onLineStart: (l) => started.push(l.id),
      onLineEnd: (l) => ended.push(l.id),
    });
    d.update(1200, [line("a", 1000)]);
    expect(started).toEqual(["a"]);
    expect(ended).toEqual(["a"]);
    void vi;
  });
});
