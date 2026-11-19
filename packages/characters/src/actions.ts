/**
 * Actions as data (issue #18). Each action is keyframed bone motion over
 * time, sampled through the unified motion engine (@finch-studio/motion).
 * Authoring a new action adds one entry here and EVERY character, in every
 * style family, gains it. Nothing about an action lives in character art.
 */
import { sampleTrack, type KeyframeTrack } from "@finch-studio/motion";
import {
  completePose,
  type BoneId,
  type BoneTransform,
  type Pose,
} from "./skeleton.js";

export type ActionName =
  | "idle"
  | "talk"
  | "stand"
  | "sit"
  | "walk"
  | "jump"
  | "point"
  | "explain"
  | "wave"
  | "think";

export const ACTION_NAMES: ActionName[] = [
  "idle", "talk", "stand", "sit", "walk", "jump", "point", "explain", "wave", "think",
];

interface BoneKey {
  atMs: number;
  rotate?: number;
  dx?: number;
  dy?: number;
}

export interface ActionDef {
  name: ActionName;
  durationMs: number;
  loop: boolean;
  keys: Partial<Record<BoneId, BoneKey[]>>;
}

const K = (atMs: number, rotate = 0, dx = 0, dy = 0): BoneKey => ({ atMs, rotate, dx, dy });

export const ACTIONS: Record<ActionName, ActionDef> = {
  stand: {
    name: "stand", durationMs: 1000, loop: true,
    keys: { torso: [K(0, 0), K(1000, 0)] },
  },
  idle: {
    name: "idle", durationMs: 2600, loop: true,
    keys: {
      torso: [K(0, -2.2), K(1300, 2.2), K(2600, -2.2)],
      head: [K(0, -3), K(1300, 3), K(2600, -3)],
      armUpperL: [K(0, 4), K(1300, -4), K(2600, 4)],
      armUpperR: [K(0, -4), K(1300, 4), K(2600, -4)],
      root: [K(0, 0, 0, 0), K(1300, 0, 0, 3.5), K(2600, 0, 0, 0)],
    },
  },
  talk: {
    name: "talk", durationMs: 1800, loop: true,
    keys: {
      head: [K(0, 0), K(450, 3), K(900, -2), K(1350, 2), K(1800, 0)],
      armUpperR: [K(0, -18), K(600, -30), K(1200, -16), K(1800, -18)],
      armLowerR: [K(0, -24), K(600, -10), K(1200, -30), K(1800, -24)],
      armUpperL: [K(0, 4), K(900, -4), K(1800, 4)],
      torso: [K(0, 0), K(900, 1.5), K(1800, 0)],
    },
  },
  sit: {
    name: "sit", durationMs: 1000, loop: false,
    keys: {
      root: [K(0, 0, 0, 52)],
      legUpperL: [K(0, -88)],
      legUpperR: [K(0, -88)],
      legLowerL: [K(0, 88)],
      legLowerR: [K(0, 88)],
      torso: [K(0, 3)],
      armUpperL: [K(0, -12)],
      armUpperR: [K(0, 12)],
      armLowerL: [K(0, -18)],
      armLowerR: [K(0, -18)],
    },
  },
  walk: {
    name: "walk", durationMs: 840, loop: true,
    keys: {
      legUpperL: [K(0, 24), K(420, -24), K(840, 24)],
      legUpperR: [K(0, -24), K(420, 24), K(840, -24)],
      legLowerL: [K(0, 6), K(210, 26), K(420, 6), K(630, 10), K(840, 6)],
      legLowerR: [K(0, 6), K(210, 10), K(420, 6), K(630, 26), K(840, 6)],
      armUpperL: [K(0, -18), K(420, 18), K(840, -18)],
      armUpperR: [K(0, 18), K(420, -18), K(840, 18)],
      armLowerL: [K(0, -10), K(840, -10)],
      armLowerR: [K(0, -10), K(840, -10)],
      root: [K(0, 0, 0, 0), K(210, 0, 0, -3), K(420, 0, 0, 0), K(630, 0, 0, -3), K(840, 0, 0, 0)],
      torso: [K(0, 2), K(840, 2)],
    },
  },
  jump: {
    name: "jump", durationMs: 720, loop: false,
    keys: {
      root: [K(0, 0, 0, 0), K(180, 0, 0, 14), K(420, 0, 0, -64), K(600, 0, 0, -8), K(720, 0, 0, 0)],
      legUpperL: [K(0, 0), K(180, -18), K(420, -34), K(720, 0)],
      legUpperR: [K(0, 0), K(180, -18), K(420, -28), K(720, 0)],
      legLowerL: [K(0, 0), K(180, 24), K(420, 52), K(720, 0)],
      legLowerR: [K(0, 0), K(180, 24), K(420, 46), K(720, 0)],
      armUpperL: [K(0, 0), K(420, 152), K(720, 0)],
      armUpperR: [K(0, 0), K(420, -152), K(720, 0)],
      torso: [K(0, 0), K(180, 4), K(420, -3), K(720, 0)],
    },
  },
  point: {
    name: "point", durationMs: 1200, loop: false,
    keys: {
      armUpperR: [K(0, 0), K(300, -84), K(1200, -84)],
      armLowerR: [K(0, 0), K(300, -4), K(1200, -4)],
      head: [K(0, 0), K(300, 6), K(1200, 6)],
      torso: [K(0, 0), K(300, 3), K(1200, 3)],
      armUpperL: [K(0, 0), K(1200, 0)],
    },
  },
  explain: {
    name: "explain", durationMs: 2200, loop: true,
    keys: {
      armUpperL: [K(0, 26), K(700, 44), K(1400, 26), K(2200, 26)],
      armLowerL: [K(0, -18), K(700, -30), K(1400, -18), K(2200, -18)],
      armUpperR: [K(0, -26), K(900, -30), K(1600, -48), K(2200, -26)],
      armLowerR: [K(0, 18), K(900, 22), K(1600, 32), K(2200, 18)],
      head: [K(0, -2), K(1100, 2), K(2200, -2)],
      torso: [K(0, 0), K(1100, 1.5), K(2200, 0)],
    },
  },
  wave: {
    name: "wave", durationMs: 1200, loop: true,
    keys: {
      armUpperR: [K(0, -148), K(1200, -148)],
      armLowerR: [K(0, 8), K(300, -26), K(600, 8), K(900, -26), K(1200, 8)],
      head: [K(0, 2), K(1200, 2)],
      armUpperL: [K(0, 2), K(1200, 2)],
    },
  },
  think: {
    name: "think", durationMs: 1600, loop: false,
    keys: {
      armUpperR: [K(0, 0), K(500, 34), K(1600, 34)],
      armLowerR: [K(0, 0), K(500, 128), K(1600, 128)],
      armUpperL: [K(0, 0), K(500, -20), K(1600, -20)],
      armLowerL: [K(0, 0), K(500, -64), K(1600, -64)],
      head: [K(0, 0), K(500, -7), K(1600, -7)],
      torso: [K(0, 0), K(500, 2), K(1600, 2)],
    },
  },
};

function channelTrack(keys: BoneKey[], pick: (k: BoneKey) => number): KeyframeTrack {
  return {
    property: "x",
    keyframes: keys.map((k) => ({ atMs: k.atMs, value: pick(k), easing: "ease-in-out" as const })),
  };
}

/** Sample an action at tMs into a complete pose. Loops or clamps by def. */
export function sampleAction(action: ActionDef, tMs: number): Record<BoneId, BoneTransform> {
  const t = action.loop
    ? ((tMs % action.durationMs) + action.durationMs) % action.durationMs
    : Math.min(Math.max(tMs, 0), action.durationMs);
  const pose: Pose = {};
  (Object.keys(action.keys) as BoneId[]).forEach((bone) => {
    const keys = action.keys[bone];
    if (!keys || keys.length === 0) return;
    const sorted = [...keys].sort((a, b) => a.atMs - b.atMs);
    const held: BoneKey[] =
      sorted[sorted.length - 1].atMs < action.durationMs && !action.loop
        ? sorted
        : sorted;
    pose[bone] = {
      rotate: sampleTrack(channelTrack(held, (k) => k.rotate ?? 0), t),
      dx: sampleTrack(channelTrack(held, (k) => k.dx ?? 0), t),
      dy: sampleTrack(channelTrack(held, (k) => k.dy ?? 0), t),
    } satisfies BoneTransform;
  });
  return completePose(pose);
}
