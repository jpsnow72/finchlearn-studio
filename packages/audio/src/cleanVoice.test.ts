import { describe, expect, it } from "vitest";
import {
  applyCleanVoiceToVoiceClips,
  cleanVoiceChain,
  cleanVoiceSettingsForCompare,
  clampCleanVoiceIntensity,
  connectCleanVoice,
  DEFAULT_CLEAN_VOICE,
  normalizeCleanVoiceSettings,
  toggleCleanVoiceCompare,
  type CleanVoiceContext,
  type CleanVoiceNode,
} from "./cleanVoice.js";
import type { AudioClip } from "./audio.js";

describe("clean voice settings", () => {
  it("defaults OFF so clips render exactly as before", () => {
    expect(DEFAULT_CLEAN_VOICE.enabled).toBe(false);
    expect(cleanVoiceChain(DEFAULT_CLEAN_VOICE)).toEqual([]);
    expect(normalizeCleanVoiceSettings(undefined)).toEqual(DEFAULT_CLEAN_VOICE);
    expect(normalizeCleanVoiceSettings({ enabled: "yes" }).enabled).toBe(false);
  });

  it("clamps intensity into 0..1 and keeps stored values round trippable", () => {
    expect(clampCleanVoiceIntensity(-2)).toBe(0);
    expect(clampCleanVoiceIntensity(7)).toBe(1);
    expect(clampCleanVoiceIntensity(0.35)).toBeCloseTo(0.35);
    expect(clampCleanVoiceIntensity(Number.NaN)).toBe(0.5);
    const stored = normalizeCleanVoiceSettings({ enabled: true, intensity: 0.8 });
    expect(normalizeCleanVoiceSettings(JSON.parse(JSON.stringify(stored)))).toEqual(stored);
  });
});

describe("clean voice chain construction", () => {
  it("is empty (identity) when the toggle is off, at any intensity", () => {
    expect(cleanVoiceChain({ enabled: false, intensity: 0 })).toEqual([]);
    expect(cleanVoiceChain({ enabled: false, intensity: 1 })).toEqual([]);
  });

  it("builds the full cleanup chain when on", () => {
    const chain = cleanVoiceChain({ enabled: true, intensity: 0.5 });
    expect(chain.map((s) => s.kind)).toEqual([
      "filter",
      "filter",
      "gate",
      "filter",
      "filter",
      "compressor",
      "gain",
    ]);
    const roles = chain.flatMap((s) => ("role" in s ? [s.role] : []));
    expect(roles).toEqual(["rumble", "mud", "presence", "deesser", "makeup"]);
  });

  it("scales gate, EQ, and compression monotonically with intensity", () => {
    const low = cleanVoiceChain({ enabled: true, intensity: 0 });
    const high = cleanVoiceChain({ enabled: true, intensity: 1 });
    const gateLow = low.find((s) => s.kind === "gate");
    const gateHigh = high.find((s) => s.kind === "gate");
    if (gateLow?.kind !== "gate" || gateHigh?.kind !== "gate") throw new Error("gate missing");
    expect(gateHigh.thresholdDb).toBeGreaterThan(gateLow.thresholdDb);
    expect(gateHigh.ratio).toBeGreaterThan(gateLow.ratio);
    const compLow = low.find((s) => s.kind === "compressor");
    const compHigh = high.find((s) => s.kind === "compressor");
    if (compLow?.kind !== "compressor" || compHigh?.kind !== "compressor") throw new Error("compressor missing");
    expect(compHigh.thresholdDb).toBeLessThan(compLow.thresholdDb);
    expect(compHigh.ratio).toBeGreaterThan(compLow.ratio);
    const presence = (chain: typeof low) =>
      chain.find((s) => s.kind === "filter" && s.role === "presence");
    const pLow = presence(low);
    const pHigh = presence(high);
    if (pLow?.kind !== "filter" || pHigh?.kind !== "filter") throw new Error("presence missing");
    expect(pHigh.gainDb).toBeGreaterThan(pLow.gainDb);
  });
});

/* Minimal fake Web Audio nodes: they record parameters and wiring. */
function fakeNode(extra: Record<string, { value: number }> = {}) {
  const node = {
    connectedTo: [] as CleanVoiceNode[],
    ...Object.fromEntries(Object.entries(extra).map(([k]) => [k, { value: 0 }])),
    type: "",
    connect(dest: CleanVoiceNode) {
      node.connectedTo.push(dest);
      return dest;
    },
  };
  return node;
}

function fakeContext(): CleanVoiceContext & { created: ReturnType<typeof fakeNode>[] } {
  const created: ReturnType<typeof fakeNode>[] = [];
  const make = (params: string[]) => () => {
    const node = fakeNode(Object.fromEntries(params.map((p) => [p, { value: 0 }])));
    created.push(node);
    return node as never;
  };
  return {
    created,
    createBiquadFilter: make(["frequency", "Q", "gain"]),
    createDynamicsCompressor: make(["threshold", "ratio", "attack", "release", "knee"]),
    createGain: make(["gain"]),
  };
}

describe("clean voice graph wiring", () => {
  it("creates no nodes and passes the through node straight back when off", () => {
    const ctx = fakeContext();
    const through = fakeNode();
    const conn = connectCleanVoice(ctx, through as never, { enabled: false, intensity: 1 });
    expect(conn.bypassed).toBe(true);
    expect(conn.nodes).toEqual([]);
    expect(conn.input).toBe(through);
    expect(conn.output).toBe(through);
    expect(ctx.created).toHaveLength(0);
  });

  it("wires the chain in order with the stage parameters when on", () => {
    const ctx = fakeContext();
    const through = fakeNode();
    const conn = connectCleanVoice(ctx, through as never, { enabled: true, intensity: 1 });
    expect(conn.bypassed).toBe(false);
    expect(conn.nodes).toHaveLength(7);
    expect(conn.input).toBe(conn.nodes[0]);
    expect(conn.output).toBe(conn.nodes[6]);
    for (let i = 0; i < conn.nodes.length - 1; i++) {
      const node = conn.nodes[i] as unknown as ReturnType<typeof fakeNode>;
      expect(node.connectedTo).toEqual([conn.nodes[i + 1]]);
    }
    const highpass = ctx.created[0] as unknown as { type: string; frequency: { value: number } };
    expect(highpass.type).toBe("highpass");
    expect(highpass.frequency.value).toBeCloseTo(120);
    const gate = ctx.created[2] as unknown as { threshold: { value: number }; ratio: { value: number } };
    expect(gate.threshold.value).toBeCloseTo(-38);
    expect(gate.ratio.value).toBeCloseTo(12);
    const makeup = ctx.created[6] as unknown as { gain: { value: number } };
    expect(makeup.gain.value).toBeCloseTo(Math.pow(10, 3 / 20), 5);
  });
});

describe("A/B compare", () => {
  it("flips between original and cleaned", () => {
    expect(toggleCleanVoiceCompare("cleaned")).toBe("original");
    expect(toggleCleanVoiceCompare("original")).toBe("cleaned");
  });

  it("original compare forces the chain off without losing the stored setting", () => {
    const stored = { enabled: true, intensity: 0.9 };
    const effective = cleanVoiceSettingsForCompare(stored, "original");
    expect(cleanVoiceChain(effective)).toEqual([]);
    expect(stored).toEqual({ enabled: true, intensity: 0.9 });
    expect(cleanVoiceChain(cleanVoiceSettingsForCompare(stored, "cleaned"))).not.toEqual([]);
  });
});

describe("apply to all voice clips", () => {
  const base = { startMs: 0, durationMs: 1000, sourceInMs: 0, gain: 1, fadeInMs: 0, fadeOutMs: 0, assetR2Key: "a/x.mp3" };
  it("sets Clean Voice on voice clips only and never mutates the inputs", () => {
    const clips: AudioClip[] = [
      { ...base, id: "v", role: "voice" },
      { ...base, id: "m", role: "music" },
      { ...base, id: "d", role: "description" },
    ];
    const next = applyCleanVoiceToVoiceClips(clips, { enabled: true, intensity: 2 });
    expect(next[0]?.cleanVoice).toEqual({ enabled: true, intensity: 1 });
    expect(next[1]).toBe(clips[1]);
    expect(next[2]).toBe(clips[2]);
    expect(clips[0]?.cleanVoice).toBeUndefined();
  });
});
