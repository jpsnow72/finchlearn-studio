/**
 * lottieObject: stage object plumbing for Lottie objects (issues #97,
 * #99, #100).
 *
 * Resolution order for an object's animation data: inline
 * animationData (user imports and Browse inserts, self contained),
 * then the bundled pack by packId, then the resource locator. Loaded
 * animations are cached per object so the stage, the inspector, and
 * both export paths share one copy and one load.
 */
import type { CourseObject, LottieObject } from "@finch-studio/core";
import {
  discoverColorSlots,
  isLottieAnimationData,
  type LottieAnimationData,
  type LottieColorSlot,
} from "./lottieCore";
import { loadLottieFromSource } from "./dotLottie";
import { loadPackAnimation, lottiePackEntry } from "./lottiePack";

export function isLottieObject(obj: CourseObject): obj is LottieObject {
  return obj.type === "lottie";
}

export function asLottieObject(obj: CourseObject): LottieObject | null {
  return isLottieObject(obj) ? obj : null;
}

/** Local playback time for an object at a scene time, in ms. */
export function lottieLocalMs(obj: LottieObject, sceneTMs: number): number {
  const startMs = (obj.timing?.start ?? 0) * 1000;
  return Math.max(0, sceneTMs - startMs);
}

const resolvedCache = new Map<string, LottieAnimationData>();

function cacheKey(obj: LottieObject): string {
  if (obj.animationData) return `${obj.id}:inline`;
  if (obj.packId) return `pack:${obj.packId}`;
  if (obj.resource) return `src:${obj.resource}`;
  return `${obj.id}:none`;
}

/** The already loaded animation for an object, if any. */
export function getCachedLottieAnimation(obj: LottieObject): LottieAnimationData | undefined {
  if (obj.animationData && isLottieAnimationData(obj.animationData)) {
    return obj.animationData;
  }
  return resolvedCache.get(cacheKey(obj));
}

/** Load (once) and cache the animation for an object. */
export async function preloadLottieAnimation(obj: LottieObject): Promise<LottieAnimationData> {
  const cached = getCachedLottieAnimation(obj);
  if (cached) return cached;
  let anim: LottieAnimationData;
  if (obj.packId) {
    const packEntry = lottiePackEntry(obj.packId);
    if (!packEntry) throw new Error(`Unknown bundled Lottie icon "${obj.packId}".`);
    anim = await loadPackAnimation(packEntry);
  } else if (obj.resource) {
    anim = await loadLottieFromSource(obj.resource);
  } else {
    throw new Error(`Lottie object "${obj.name ?? obj.id}" has no animation source.`);
  }
  resolvedCache.set(cacheKey(obj), anim);
  return anim;
}

/** Color slots to show in the inspector for an object. */
export function lottieSlotsForObject(
  obj: LottieObject,
  anim?: LottieAnimationData,
): LottieColorSlot[] {
  if (obj.packId) {
    const packEntry = lottiePackEntry(obj.packId);
    if (packEntry) return packEntry.colorSlots;
  }
  const data = anim ?? getCachedLottieAnimation(obj);
  return data ? discoverColorSlots(data) : [];
}

let importCounter = 0;

/**
 * Create a stage object from a parsed animation: a user import
 * (.json or .lottie, issue #99) or a Browse insert (issue #100). The
 * parsed animation rides inline so the project stays self contained,
 * and the discovered color slots are seeded at their defaults so the
 * inspector can recolor immediately.
 */
export function makeImportedLottieObject(
  anim: LottieAnimationData,
  name: string,
  provenance: "import" | "generative-icons",
): CourseObject {
  importCounter += 1;
  const slots = discoverColorSlots(anim);
  const colors: Record<string, string> = {};
  for (const slot of slots) colors[slot.id] = slot.defaultColor;
  return {
    id: `lot-${Date.now().toString(36)}-${importCounter}`,
    type: "lottie",
    name,
    position: { x: 480, y: 220, w: 240, h: 240 },
    animationData: anim,
    colors: Object.keys(colors).length > 0 ? colors : undefined,
    loop: true,
    speed: 1,
    extensions: {
      "x-finch-studio": {
        bundledKind: "lottie",
        provenance,
        license: provenance === "generative-icons" ? "MIT" : "user supplied",
      },
    },
  } as unknown as CourseObject;
}
