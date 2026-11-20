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
  | "think"
  // Motion library expansion (issues #94 and #96): solo motions.
  | "run"
  | "clap"
  | "nod"
  | "shake"
  | "shrug"
  | "thumbs-up"
  | "celebrate"
  | "laugh"
  | "bow"
  | "look-around"
  // Two character interaction roles (paired by interactions.ts).
  | "handshake-right"
  | "handshake-left"
  | "high-five-right"
  | "high-five-left";

export const ACTION_NAMES: ActionName[] = [
  "idle", "talk", "stand", "sit", "walk", "jump", "point", "explain", "wave", "think",
  "run", "clap", "nod", "shake", "shrug", "thumbs-up", "celebrate", "laugh", "bow",
  "look-around",
  "handshake-right", "handshake-left", "high-five-right", "high-five-left",
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
  // -------------------------------------------------------------------------
  // Motion library expansion (issues #94 and #96). Same data format, same
  // skeleton: every motion below applies to built in characters and to user
  // rigged custom characters unchanged.
  // -------------------------------------------------------------------------
  run: {
    name: "run", durationMs: 560, loop: true,
    keys: {
      legUpperL: [K(0, 38), K(280, -38), K(560, 38)],
      legUpperR: [K(0, -38), K(280, 38), K(560, -38)],
      legLowerL: [K(0, 12), K(140, 68), K(280, 16), K(420, 34), K(560, 12)],
      legLowerR: [K(0, 16), K(140, 34), K(280, 12), K(420, 68), K(560, 16)],
      armUpperL: [K(0, -34), K(280, 34), K(560, -34)],
      armUpperR: [K(0, 34), K(280, -34), K(560, 34)],
      armLowerL: [K(0, -56), K(280, -44), K(560, -56)],
      armLowerR: [K(0, -44), K(280, -56), K(560, -44)],
      root: [K(0, 0, 0, 0), K(140, 0, 0, -6), K(280, 0, 0, 0), K(420, 0, 0, -6), K(560, 0, 0, 0)],
      torso: [K(0, 7), K(560, 7)],
      head: [K(0, -3), K(560, -3)],
    },
  },
  clap: {
    name: "clap", durationMs: 900, loop: true,
    keys: {
      armUpperR: [K(0, -18), K(900, -18)],
      armLowerR: [K(0, 110), K(225, 136), K(450, 110), K(675, 136), K(900, 110)],
      armUpperL: [K(0, 18), K(900, 18)],
      armLowerL: [K(0, -110), K(225, -136), K(450, -110), K(675, -136), K(900, -110)],
      head: [K(0, 0), K(225, 2), K(450, 0), K(675, 2), K(900, 0)],
      torso: [K(0, 1), K(900, 1)],
    },
  },
  nod: {
    name: "nod", durationMs: 900, loop: false,
    keys: {
      head: [K(0, 0, 0, 0), K(300, 2, 0, 6), K(560, 0, 0, 0), K(900, 0, 0, 0)],
      torso: [K(0, 0), K(300, 1), K(560, 0), K(900, 0)],
    },
  },
  shake: {
    name: "shake", durationMs: 1100, loop: false,
    keys: {
      head: [K(0, 0), K(160, -9), K(320, 9), K(480, -9), K(640, 9), K(800, -4), K(1100, 0)],
      torso: [K(0, 0), K(1100, 0)],
    },
  },
  shrug: {
    name: "shrug", durationMs: 1200, loop: false,
    keys: {
      armUpperL: [K(0, 0), K(350, 12), K(900, 12), K(1200, 0)],
      armUpperR: [K(0, 0), K(350, -12), K(900, -12), K(1200, 0)],
      armLowerL: [K(0, 0), K(350, -34), K(900, -34), K(1200, 0)],
      armLowerR: [K(0, 0), K(350, 34), K(900, 34), K(1200, 0)],
      head: [K(0, 0, 0, 0), K(350, 0, 0, 4), K(900, 0, 0, 4), K(1200, 0, 0, 0)],
      root: [K(0, 0, 0, 0), K(350, 0, 0, -3), K(900, 0, 0, -3), K(1200, 0, 0, 0)],
    },
  },
  "thumbs-up": {
    name: "thumbs-up", durationMs: 1000, loop: false,
    keys: {
      armUpperR: [K(0, 0), K(320, -32), K(1000, -32)],
      armLowerR: [K(0, 0), K(320, -146), K(520, -138), K(680, -146), K(1000, -146)],
      armUpperL: [K(0, 2), K(1000, 2)],
      head: [K(0, 0), K(400, 3), K(1000, 3)],
    },
  },
  celebrate: {
    name: "celebrate", durationMs: 1400, loop: true,
    keys: {
      armUpperL: [K(0, 0), K(280, 148), K(1120, 148), K(1400, 0)],
      armUpperR: [K(0, 0), K(280, -148), K(1120, -148), K(1400, 0)],
      armLowerL: [K(0, 0), K(280, 14), K(1120, 14), K(1400, 0)],
      armLowerR: [K(0, 0), K(280, -14), K(1120, -14), K(1400, 0)],
      root: [K(0, 0, 0, 0), K(350, 0, 0, -9), K(700, 0, 0, 0), K(1050, 0, 0, -9), K(1400, 0, 0, 0)],
      head: [K(0, 0, 0, 0), K(280, 0, 0, -3), K(1400, 0, 0, -3)],
    },
  },
  laugh: {
    name: "laugh", durationMs: 1200, loop: true,
    keys: {
      torso: [K(0, 2), K(300, 5), K(600, 2), K(900, 5), K(1200, 2)],
      head: [K(0, -4), K(600, -8), K(1200, -4)],
      armUpperR: [K(0, -22), K(1200, -22)],
      armLowerR: [K(0, -54), K(1200, -54)],
      armUpperL: [K(0, 22), K(1200, 22)],
      armLowerL: [K(0, 54), K(1200, 54)],
      root: [K(0, 0, 0, 0), K(300, 0, 0, 3), K(600, 0, 0, 0), K(900, 0, 0, 3), K(1200, 0, 0, 0)],
    },
  },
  bow: {
    name: "bow", durationMs: 1600, loop: false,
    keys: {
      torso: [K(0, 0, 0, 0), K(550, 0, 0, 9), K(1050, 0, 0, 9), K(1600, 0, 0, 0)],
      head: [K(0, 0, 0, 0), K(550, -6, 0, 13), K(1050, -6, 0, 13), K(1600, 0, 0, 0)],
      armUpperL: [K(0, 0), K(550, -8), K(1050, -8), K(1600, 0)],
      armUpperR: [K(0, 0), K(550, 8), K(1050, 8), K(1600, 0)],
      root: [K(0, 0, 0, 0), K(550, 0, 0, 6), K(1050, 0, 0, 6), K(1600, 0, 0, 0)],
    },
  },
  "look-around": {
    name: "look-around", durationMs: 2000, loop: false,
    keys: {
      head: [K(0, 0), K(450, -11), K(850, -11), K(1300, 11), K(1700, 11), K(2000, 0)],
      torso: [K(0, 0), K(450, -2), K(850, -2), K(1300, 2), K(1700, 2), K(2000, 0)],
      armUpperL: [K(0, 3), K(2000, 3)],
      armUpperR: [K(0, -3), K(2000, -3)],
    },
  },
  // Two character interaction roles. Each role is an ordinary action on the
  // shared skeleton; interactions.ts pairs them with a hand meet anchor and
  // the snap placement for the second character.
  "handshake-right": {
    name: "handshake-right", durationMs: 1600, loop: false,
    keys: {
      armUpperR: [K(0, 0), K(450, -20), K(1400, -20), K(1600, 0)],
      armLowerR: [K(0, 0), K(450, -66), K(1400, -66), K(1600, 0)],
      armUpperL: [K(0, 3), K(1600, 3)],
      armLowerL: [K(0, -6), K(1600, -6)],
      head: [K(0, 0), K(450, 3), K(1600, 0)],
      root: [K(0, 0, 0, 0), K(700, 0, 0, 0), K(880, 0, 0, 4), K(1060, 0, 0, 0), K(1240, 0, 0, 4), K(1420, 0, 0, 0), K(1600, 0, 0, 0)],
    },
  },
  "handshake-left": {
    name: "handshake-left", durationMs: 1600, loop: false,
    keys: {
      armUpperL: [K(0, 0), K(450, 20), K(1400, 20), K(1600, 0)],
      armLowerL: [K(0, 0), K(450, 66), K(1400, 66), K(1600, 0)],
      armUpperR: [K(0, -3), K(1600, -3)],
      armLowerR: [K(0, 6), K(1600, 6)],
      head: [K(0, 0), K(450, -3), K(1600, 0)],
      root: [K(0, 0, 0, 0), K(700, 0, 0, 0), K(880, 0, 0, 4), K(1060, 0, 0, 0), K(1240, 0, 0, 4), K(1420, 0, 0, 0), K(1600, 0, 0, 0)],
    },
  },
  "high-five-right": {
    name: "high-five-right", durationMs: 1100, loop: false,
    keys: {
      armUpperR: [K(0, 0), K(400, -105), K(820, -105), K(1100, 0)],
      armLowerR: [K(0, 0), K(400, -67), K(820, -67), K(1100, 0)],
      armUpperL: [K(0, 5), K(1100, 5)],
      armLowerL: [K(0, -8), K(1100, -8)],
      head: [K(0, 0), K(400, -3), K(1100, 0)],
      root: [K(0, 0, 0, 0), K(400, 0, 0, -4), K(700, 0, 0, -4), K(1100, 0, 0, 0)],
    },
  },
  "high-five-left": {
    name: "high-five-left", durationMs: 1100, loop: false,
    keys: {
      armUpperL: [K(0, 0), K(400, 105), K(820, 105), K(1100, 0)],
      armLowerL: [K(0, 0), K(400, 67), K(820, 67), K(1100, 0)],
      armUpperR: [K(0, -5), K(1100, -5)],
      armLowerR: [K(0, 8), K(1100, 8)],
      head: [K(0, 0), K(400, 3), K(1100, 0)],
      root: [K(0, 0, 0, 0), K(400, 0, 0, -4), K(700, 0, 0, -4), K(1100, 0, 0, 0)],
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

// ---------------------------------------------------------------------------
// Action picker metadata (issues #94 and #96): the full catalogue grouped
// for the editor action picker. Every action belongs to exactly one group.
// ---------------------------------------------------------------------------

export type ActionGroupId = "basics" | "movement" | "reactions" | "two-characters";

export const ACTION_GROUP_ORDER: ActionGroupId[] = [
  "basics", "movement", "reactions", "two-characters",
];

export const ACTION_GROUP_LABELS: Record<ActionGroupId, string> = {
  basics: "Basics",
  movement: "Movement",
  reactions: "Reactions",
  "two-characters": "Two characters",
};

export const ACTION_GROUPS: Record<ActionGroupId, ActionName[]> = {
  basics: ["stand", "idle", "sit", "talk", "explain", "point", "wave"],
  movement: ["walk", "run", "jump", "bow", "look-around"],
  reactions: ["think", "nod", "shake", "shrug", "thumbs-up", "clap", "celebrate", "laugh"],
  "two-characters": ["handshake-right", "handshake-left", "high-five-right", "high-five-left"],
};

export const ACTION_GROUP_OF: Record<ActionName, ActionGroupId> = (() => {
  const out = {} as Record<ActionName, ActionGroupId>;
  for (const group of ACTION_GROUP_ORDER) {
    for (const name of ACTION_GROUPS[group]) out[name] = group;
  }
  return out;
})();

export interface ActionCatalogueEntry {
  name: ActionName;
  label: string;
  hint: string;
  group: ActionGroupId;
  loops: boolean;
}

const CATALOGUE_TEXT: Record<ActionName, { label: string; hint: string }> = {
  stand: { label: "Stand", hint: "Neutral standing pose" },
  idle: { label: "Idle", hint: "Subtle breathing sway" },
  sit: { label: "Sit", hint: "Seated pose" },
  talk: { label: "Talk", hint: "Head bob and one hand gestures" },
  explain: { label: "Explain", hint: "Both hands present and gesture" },
  point: { label: "Point", hint: "Right arm extends and holds" },
  wave: { label: "Wave", hint: "Friendly raised hand wave" },
  walk: { label: "Walk", hint: "Leg and arm swing cycle" },
  run: { label: "Run", hint: "Fast stride with bent arms and bounce" },
  jump: { label: "Jump", hint: "Crouch, leap, and land" },
  bow: { label: "Bow", hint: "Dips forward and rises" },
  "look-around": { label: "Look around", hint: "Head scans left, then right" },
  think: { label: "Think", hint: "Hand to chin, head tilts" },
  nod: { label: "Nod yes", hint: "Single head nod" },
  shake: { label: "Shake head no", hint: "Head shakes side to side" },
  shrug: { label: "Shrug", hint: "Shoulders rise, palms turn up" },
  "thumbs-up": { label: "Thumbs up", hint: "Right forearm raises in approval" },
  clap: { label: "Clap", hint: "Hands meet in front, twice per cycle" },
  celebrate: { label: "Celebrate", hint: "Both arms up with a bounce" },
  laugh: { label: "Laugh", hint: "Shoulders shake, hands on belly" },
  "handshake-right": { label: "Handshake (reach right)", hint: "Right hand reaches to shake; pair with a partner" },
  "handshake-left": { label: "Handshake (reach left)", hint: "Left hand reaches to shake; pair with a partner" },
  "high-five-right": { label: "High five (right)", hint: "Right hand raises for a high five; pair with a partner" },
  "high-five-left": { label: "High five (left)", hint: "Left hand raises for a high five; pair with a partner" },
};

/** The full picker catalogue: every action once, with its group. */
export const ACTION_CATALOGUE: ActionCatalogueEntry[] = ACTION_NAMES.map((name) => ({
  name,
  label: CATALOGUE_TEXT[name].label,
  hint: CATALOGUE_TEXT[name].hint,
  group: ACTION_GROUP_OF[name],
  loops: ACTIONS[name].loop,
}));

/** Catalogue entries grouped in picker order. */
export function groupedActionCatalogue(): { group: ActionGroupId; label: string; entries: ActionCatalogueEntry[] }[] {
  return ACTION_GROUP_ORDER.map((group) => ({
    group,
    label: ACTION_GROUP_LABELS[group],
    entries: ACTION_CATALOGUE.filter((e) => e.group === group),
  }));
}
