/**
 * Clean Voice (issue #29): one toggle, one intensity control, and an
 * A/B compare for recorded or imported voice clips.
 *
 * The chain is deliberately modest and honest: rumble removal, a
 * gentle low shelf cut, a noise gate, a small presence lift, a static
 * de-ess cut, and light compression with makeup gain. It is built only
 * from Web Audio primitives (BiquadFilter, DynamicsCompressor, Gain)
 * so the same chain runs in live preview (AudioContext) and in the
 * offline export mix (OfflineAudioContext), which is also what the
 * server render path drives. It does not do spectral noise reduction
 * or echo removal; nothing here claims to.
 *
 * This module stays free of DOM types: the graph builder works
 * against the small structural interfaces below, which both the real
 * Web Audio nodes and plain test fakes satisfy.
 */

export interface CleanVoiceSettings {
  enabled: boolean;
  /** 0..1. Higher means a stronger gate, more EQ shaping, and firmer compression. */
  intensity: number;
}

export const CLEAN_VOICE_MIN_INTENSITY = 0;
export const CLEAN_VOICE_MAX_INTENSITY = 1;
export const CLEAN_VOICE_DEFAULT_INTENSITY = 0.5;

/** Default is OFF: a clip with no Clean Voice setting renders exactly as before. */
export const DEFAULT_CLEAN_VOICE: CleanVoiceSettings = {
  enabled: false,
  intensity: CLEAN_VOICE_DEFAULT_INTENSITY,
};

/** A/B compare state: which version of the clip the user is hearing. */
export type CleanVoiceCompareMode = "original" | "cleaned";

export const DEFAULT_CLEAN_VOICE_COMPARE: CleanVoiceCompareMode = "cleaned";

/** Flip the A/B compare; pure so the panel and tests share the behavior. */
export function toggleCleanVoiceCompare(
  mode: CleanVoiceCompareMode,
): CleanVoiceCompareMode {
  return mode === "cleaned" ? "original" : "cleaned";
}

/**
 * The settings actually applied for a compare mode. Comparing against
 * the original bypasses the chain entirely (identity), whatever the
 * stored intensity is.
 */
export function cleanVoiceSettingsForCompare(
  settings: CleanVoiceSettings,
  mode: CleanVoiceCompareMode,
): CleanVoiceSettings {
  return mode === "original" ? { ...settings, enabled: false } : settings;
}

export function clampCleanVoiceIntensity(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return CLEAN_VOICE_DEFAULT_INTENSITY;
  }
  return Math.min(
    CLEAN_VOICE_MAX_INTENSITY,
    Math.max(CLEAN_VOICE_MIN_INTENSITY, value),
  );
}

/** Validate untrusted stored data into settings; anything odd falls back to OFF. */
export function normalizeCleanVoiceSettings(
  value: unknown,
): CleanVoiceSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ...DEFAULT_CLEAN_VOICE };
  }
  const raw = value as Record<string, unknown>;
  return {
    enabled: raw.enabled === true,
    intensity: clampCleanVoiceIntensity(raw.intensity),
  };
}

export type CleanVoiceFilterKind =
  | "highpass"
  | "lowshelf"
  | "peaking";

export type CleanVoiceStage =
  | {
      kind: "filter";
      role: "rumble" | "mud" | "presence" | "deesser";
      filterType: CleanVoiceFilterKind;
      frequencyHz: number;
      q: number;
      gainDb: number;
    }
  | {
      kind: "gate" | "compressor";
      thresholdDb: number;
      ratio: number;
      attackSec: number;
      releaseSec: number;
      kneeDb: number;
    }
  | { kind: "gain"; role: "makeup"; gainDb: number };

/**
 * The processing chain for a setting, as plain data. Disabled (or an
 * intensity that clamps to the stored default shape) is the contract:
 * disabled returns an empty chain, which callers treat as identity.
 * Stage parameters scale monotonically with intensity.
 */
export function cleanVoiceChain(
  settings: CleanVoiceSettings,
): CleanVoiceStage[] {
  if (!settings.enabled) return [];
  const t = clampCleanVoiceIntensity(settings.intensity);
  return [
    {
      kind: "filter",
      role: "rumble",
      filterType: "highpass",
      frequencyHz: 70 + 50 * t,
      q: 0.7,
      gainDb: 0,
    },
    {
      kind: "filter",
      role: "mud",
      filterType: "lowshelf",
      frequencyHz: 220,
      q: 0.7,
      gainDb: -2 - 4 * t,
    },
    {
      kind: "gate",
      thresholdDb: -50 + 12 * t,
      ratio: 6 + 6 * t,
      attackSec: 0.004,
      releaseSec: 0.25,
      kneeDb: 18,
    },
    {
      kind: "filter",
      role: "presence",
      filterType: "peaking",
      frequencyHz: 3000,
      q: 0.9,
      gainDb: 1.5 + 2.5 * t,
    },
    {
      kind: "filter",
      role: "deesser",
      filterType: "peaking",
      frequencyHz: 6500,
      q: 2,
      gainDb: -1 - 3 * t,
    },
    {
      kind: "compressor",
      thresholdDb: -16 - 6 * t,
      ratio: 2 + 2 * t,
      attackSec: 0.012,
      releaseSec: 0.18,
      kneeDb: 18,
    },
    { kind: "gain", role: "makeup", gainDb: 1 + 2 * t },
  ];
}

export function isCleanVoiceActive(settings: CleanVoiceSettings): boolean {
  return cleanVoiceChain(settings).length > 0;
}

/* ------------------------------------------------------------------ */
/* Graph construction against structural Web Audio interfaces.         */
/* ------------------------------------------------------------------ */

export interface CleanVoiceParam {
  value: number;
}

export interface CleanVoiceNode {
  connect(destination: CleanVoiceNode): CleanVoiceNode;
  disconnect?: () => void;
}

export interface CleanVoiceFilterNode extends CleanVoiceNode {
  type: string;
  frequency: CleanVoiceParam;
  Q: CleanVoiceParam;
  gain: CleanVoiceParam;
}

export interface CleanVoiceDynamicsNode extends CleanVoiceNode {
  threshold: CleanVoiceParam;
  ratio: CleanVoiceParam;
  attack: CleanVoiceParam;
  release: CleanVoiceParam;
  knee: CleanVoiceParam;
}

export interface CleanVoiceGainNode extends CleanVoiceNode {
  gain: CleanVoiceParam;
}

export interface CleanVoiceContext {
  createBiquadFilter(): CleanVoiceFilterNode;
  createDynamicsCompressor(): CleanVoiceDynamicsNode;
  createGain(): CleanVoiceGainNode;
}

export interface CleanVoiceConnection {
  /** Connect the source here. */
  input: CleanVoiceNode;
  /** Connect this to the next stage or the destination. */
  output: CleanVoiceNode;
  /** Nodes created for the chain, in signal order. Empty when bypassed. */
  nodes: CleanVoiceNode[];
  bypassed: boolean;
}

/**
 * Build the chain for a context and return its input and output ends.
 * When Clean Voice is off (or forced off by the A/B compare), no nodes
 * are created and input === output === the node the caller passes as
 * `through`, so the caller can wire source -> through unchanged.
 */
export function connectCleanVoice(
  context: CleanVoiceContext,
  through: CleanVoiceNode,
  settings: CleanVoiceSettings,
): CleanVoiceConnection {
  const stages = cleanVoiceChain(settings);
  if (stages.length === 0) {
    return { input: through, output: through, nodes: [], bypassed: true };
  }
  const nodes: CleanVoiceNode[] = [];
  for (const stage of stages) {
    if (stage.kind === "filter") {
      const node = context.createBiquadFilter();
      node.type = stage.filterType;
      node.frequency.value = stage.frequencyHz;
      node.Q.value = stage.q;
      node.gain.value = stage.gainDb;
      nodes.push(node);
    } else if (stage.kind === "gain") {
      const node = context.createGain();
      // Stage gains are stored in dB for readability; GainNode wants linear.
      node.gain.value = Math.pow(10, stage.gainDb / 20);
      nodes.push(node);
    } else {
      const node = context.createDynamicsCompressor();
      node.threshold.value = stage.thresholdDb;
      node.ratio.value = stage.ratio;
      node.attack.value = stage.attackSec;
      node.release.value = stage.releaseSec;
      node.knee.value = stage.kneeDb;
      nodes.push(node);
    }
  }
  for (let i = 0; i < nodes.length - 1; i++) {
    nodes[i]!.connect(nodes[i + 1]!);
  }
  return {
    input: nodes[0]!,
    output: nodes[nodes.length - 1]!,
    nodes,
    bypassed: false,
  };
}

/**
 * Apply Clean Voice to every voice clip in a list (the "apply to all
 * voice clips" acceptance path). Pure: returns new clip objects for
 * the clips it changes and the same objects for everything else.
 * Music, sfx, and description clips are never touched.
 */
export function applyCleanVoiceToVoiceClips<
  T extends { role: string; cleanVoice?: CleanVoiceSettings },
>(clips: readonly T[], settings: CleanVoiceSettings): T[] {
  const normalized = normalizeCleanVoiceSettings(settings);
  return clips.map((clip) =>
    clip.role === "voice" ? { ...clip, cleanVoice: { ...normalized } } : clip,
  );
}
