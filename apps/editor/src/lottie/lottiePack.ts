/**
 * lottiePack: the built in Lottie pack (issue #100).
 *
 * 26 animated icons from the Generative Icons library
 * (https://generativeicons.com), LottieFiles' open animated icon set,
 * vendored as .lottie files under apps/editor/public/lottie/ with the
 * per icon license record in licenses.json beside them (MIT, per the
 * library's API metadata). Every icon is 32 by 32, 60 fps, 144 frames,
 * and shares the single color slot "color.primary", so one inspector
 * color recolors any icon in the pack.
 *
 * Pack objects reference their entry by packId and resolve the
 * animation data from the bundled asset at render time; the stage and
 * both export paths resolve through the same loader, so a placed icon
 * renders identically in preview and in exports.
 */
import type { CourseObject } from "@finch-studio/core";
import type { LottieColorSlot } from "./lottieCore";
import { loadLottieFromSource } from "./dotLottie";
import type { LottieAnimationData } from "./lottieCore";

export interface LottiePackEntry {
  id: string;
  name: string;
  tags: string[];
  /** Public path of the vendored .lottie asset. */
  assetPath: string;
  /** Animation id inside the container (the manifest initial). */
  animationId: string;
  license: string;
  source: string;
  colorSlots: LottieColorSlot[];
}

const PRIMARY_SLOT: LottieColorSlot = {
  id: "color.primary",
  label: "primary",
  defaultColor: "#00ddb3",
};

function entry(id: string, name: string, tags: string[]): LottiePackEntry {
  return {
    id,
    name,
    tags,
    assetPath: `/lottie/${id}.lottie`,
    animationId: `${id}-strong`,
    license: "MIT",
    source: `https://generativeicons.com/assets/${id}.lottie`,
    colorSlots: [PRIMARY_SLOT],
  };
}

export const LOTTIE_PACK: LottiePackEntry[] = [
  entry("play-pause", "Play pause", ["play", "pause", "media", "controls", "video"]),
  entry("download", "Download", ["download", "save", "arrow", "file", "import"]),
  entry("export-file", "Export file", ["export", "share", "file", "upload", "publish"]),
  entry("arrow-up", "Arrow up", ["arrow", "up", "direction", "next"]),
  entry("arrow-right", "Arrow right", ["arrow", "right", "direction", "next", "forward"]),
  entry("arrow-left", "Arrow left", ["arrow", "left", "direction", "back", "previous"]),
  entry("star", "Star", ["star", "favorite", "rating", "award", "featured"]),
  entry("star-rating", "Star rating", ["star", "rating", "review", "score", "feedback"]),
  entry("trophy", "Trophy", ["trophy", "award", "win", "achievement", "prize"]),
  entry("microphone", "Microphone", ["microphone", "audio", "voice", "record", "speak"]),
  entry("camera", "Camera", ["camera", "photo", "picture", "capture"]),
  entry("video-call", "Video call", ["video", "call", "camera", "meeting", "chat"]),
  entry("message", "Message", ["message", "chat", "comment", "talk", "mail"]),
  entry("chat-widget", "Chat widget", ["chat", "widget", "message", "support", "help"]),
  entry("calendar", "Calendar", ["calendar", "date", "schedule", "event", "plan"]),
  entry("clock", "Clock", ["clock", "time", "schedule", "duration"]),
  entry("alarm-clock", "Alarm clock", ["alarm", "clock", "time", "reminder", "deadline"]),
  entry("warning", "Warning", ["warning", "alert", "caution", "attention", "safety"]),
  entry("banner-alert", "Banner alert", ["banner", "alert", "notice", "announcement"]),
  entry("lightbulb", "Lightbulb", ["lightbulb", "idea", "tip", "insight", "hint"]),
  entry("brainstorm", "Brainstorm", ["brainstorm", "idea", "thinking", "creative", "plan"]),
  entry("ask-question", "Ask question", ["question", "ask", "help", "support", "faq"]),
  entry("quiz", "Quiz", ["quiz", "question", "test", "check", "assessment"]),
  entry("confetti", "Confetti", ["confetti", "celebration", "party", "success", "done"]),
  entry("heart", "Heart", ["heart", "like", "favorite", "love", "thanks"]),
  entry("bell", "Bell", ["bell", "notification", "alert", "reminder", "ring"]),
];

/**
 * Requested pack icons that could not be bundled, with the exact
 * blocker. receipt-confirmed does not exist in the Generative Icons
 * catalogue: the asset URL returns 404 and the API answers not_found
 * for the id (the catalogue's nearest matches are "receipt" and
 * "order-confirmed", which are different icons, so neither was
 * substituted silently).
 */
export const LOTTIE_PACK_BLOCKED: { id: string; reason: string }[] = [
  {
    id: "receipt-confirmed",
    reason:
      "Not in the Generative Icons catalogue: GET /assets/receipt-confirmed.lottie returns 404 and GET /api/icons/receipt-confirmed returns not_found. Nearest catalogue ids are receipt and order-confirmed.",
  },
];

export function lottiePackEntry(id: string): LottiePackEntry | undefined {
  return LOTTIE_PACK.find((item) => item.id === id);
}

export function searchLottiePack(query: string): LottiePackEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return LOTTIE_PACK;
  return LOTTIE_PACK.filter((item) =>
    [item.name, item.id, ...item.tags].some((value) => value.toLowerCase().includes(q)),
  );
}

/** Resolve a pack entry's animation data through the shared loader. */
export function loadPackAnimation(item: LottiePackEntry): Promise<LottieAnimationData> {
  return loadLottieFromSource(item.assetPath);
}

let packCounter = 0;

/**
 * Create the stage object for a bundled pack icon: a lottie object
 * carrying the pack id, the shared color slot at its default, and
 * provenance in the studio extension metadata, following the bundled
 * prop pattern from issue #101.
 */
export function makeBundledLottieObject(item: LottiePackEntry): CourseObject {
  packCounter += 1;
  return {
    id: `lot-${Date.now().toString(36)}-${packCounter}`,
    type: "lottie",
    name: `${item.name} (Generative Icons)`,
    position: { x: 560, y: 260, w: 160, h: 160 },
    packId: item.id,
    colors: { [PRIMARY_SLOT.id]: PRIMARY_SLOT.defaultColor },
    loop: true,
    speed: 1,
    extensions: {
      "x-finch-studio": {
        bundledAssetId: item.id,
        bundledKind: "lottie",
        provenance: "generative-icons",
        license: item.license,
      },
    },
  } as unknown as CourseObject;
}
