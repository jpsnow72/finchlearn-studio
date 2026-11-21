/**
 * OCF mapping (issue #5): StudioProject <-> OCF VideoProject.
 *
 * Scenes, durations, and transitions map directly. Elements with an OCF
 * scene object equivalent (text, image, footage as video, character, shape,
 * lottie)
 * map to real OCF objects, with element timing carried in OCF Timing
 * (seconds) and position in OCF Position.
 *
 * Cue markers (issue #64): a scene's markers export as structured OCF
 * cue-point metadata so the FinchLearn player can pause at exact
 * timestamps and fire native OCF behavior. The markers land ONCE on the
 * scene's first footage (video) object, never duplicated across footage
 * objects:
 * - every marker becomes a native OCF CuePoint at the marker timestamp;
 * - a knowledge check with an inline question carries a `question` cue
 *   action embedding that question as a native OCF QuestionObject;
 * - a branch marker carries a `branch` cue action with its choices
 *   (jump targets converted back to seconds);
 * - a modal marker additionally adds a `cue-point` trigger on the same
 *   object whose action opens the named popup object (`open-popup`);
 * - a chapter marker is a plain named cue point.
 * The full marker list (with stable ids and any reference-only payloads
 * such as ocfRef) is also stored, normalized, under the host object's
 * extensions["x-finch-studio"].cueMarkers. The host is the first footage
 * object when the scene has one, otherwise the scene's first mapped
 * object (which then carries the extension copy only, since cue points
 * live on media objects in OCF). A scene with no mapped objects carries
 * its markers in the sidecar only. Without a sidecar, ocfToStudio
 * rebuilds markers from the extension copy when present, and otherwise
 * derives them from the native cue points and cue-point triggers.
 *
 * Everything OCF scene objects cannot express (chart elements, audio
 * elements, dialogue lines, expressions, footage trims, brand and caption
 * tracks) travels in a StudioSidecar. When a project is embedded in a
 * course, the sidecar is stored under the video-scene object's
 * extensions["x-finch-studio"], so the round trip is lossless. Without a
 * sidecar, fromOCF still rebuilds a valid studio project from the OCF
 * objects alone, with the unmapped detail absent (documented, not silent:
 * the returned project's scenes simply have no chart or audio elements).
 */
import type {
  CharacterObject,
  ChartObject,
  CourseObject,
  CuePoint,
  ImageObject,
  QuestionObject,
  LottieObject,
  ShapeObject,
  TextObject,
  Trigger,
  VideoObject,
  VideoProject,
  VideoScene,
} from "@finch-studio/core";
import type {
  CharacterElement,
  CueMarker,
  DrawOnStyle,
  FootageElement,
  LottieElement,
  SceneElement,
  StudioProject,
  StudioScene,
  WhiteboardSceneStyle,
} from "./schema.js";
import { STUDIO_SCHEMA_VERSION } from "./schema.js";
import { sanitizeColorCorrection } from "./colorCorrection.js";

export interface StudioSidecar {
  /** Full studio scenes, keyed by scene id, for lossless restore. */
  scenes: Record<string, StudioScene>;
  sceneGroupPresetRefs?: StudioProject["sceneGroupPresetRefs"];
  brandKitRef?: string;
  captions?: StudioProject["captions"];
  globalMusic?: StudioProject["globalMusic"];
  aspect?: StudioProject["aspect"];
}

const msToS = (ms: number) => ms / 1000;
const sToMs = (s: number) => Math.round(s * 1000);

export const CUE_MARKERS_EXTENSION_KEY = "cueMarkers";

/** The id a marker exports under: its own id, or a deterministic fallback. */
export function cueMarkerId(marker: CueMarker, fallbackId: string): string {
  return marker.id ?? fallbackId;
}

/**
 * Convert one Studio cue marker to its native OCF form (issue #64): a
 * cue point, plus a cue-point trigger when the marker opens a modal.
 * Pure and shared with the editor, which applies the same conversion to
 * the editor's project model.
 */
export function cueMarkerToOCF(
  marker: CueMarker,
  fallbackId: string,
): { cuePoint: CuePoint; trigger?: Trigger } {
  const id = cueMarkerId(marker, fallbackId);
  const cuePoint: CuePoint = {
    id,
    name: marker.label,
    at: msToS(marker.atMs),
  };
  if (marker.type === "knowledge-check" && marker.question) {
    const correct = marker.question.correctChoiceIds ?? [];
    const question: QuestionObject = {
      id,
      type: "question",
      interactionType: "choice",
      choiceType: correct.length > 1 ? "multiple" : "single",
      prompt: marker.question.prompt,
      choices: marker.question.choices.map((choice) => ({
        id: choice.id,
        label: choice.label,
      })),
      correctResponses: correct.length ? [...correct] : undefined,
    };
    cuePoint.action = {
      kind: "question",
      question,
      requireCorrect: marker.question.requireCorrect,
    };
  } else if (marker.type === "branch" && marker.branchChoices?.length) {
    cuePoint.action = {
      kind: "branch",
      choices: marker.branchChoices.map((choice) => ({
        id: choice.id,
        label: choice.label,
        jumpTo: choice.jumpToMs !== undefined ? msToS(choice.jumpToMs) : undefined,
        video: choice.videoRef,
        page: choice.pageId,
      })),
    };
  }
  let trigger: Trigger | undefined;
  if (marker.type === "modal") {
    const target = marker.modalRef ?? marker.ocfRef;
    if (target) {
      trigger = {
        id: `trigger-${id}`,
        event: { type: "cue-point", cuePoint: id },
        actions: [{ type: "open-popup", target }],
      };
    }
  }
  return { cuePoint, trigger };
}

/**
 * Rebuild a Studio cue marker from a native OCF cue point and the host
 * object's triggers (issue #64). Used when a project comes back without
 * its sidecar or extension copy: question and branch payloads are
 * recovered from the cue action, a modal from its open-popup cue-point
 * trigger, and anything else is a plain chapter point.
 */
export function cuePointToMarker(
  cuePoint: CuePoint,
  triggers: Trigger[] = [],
): CueMarker {
  const base: CueMarker = {
    id: cuePoint.id,
    atMs: sToMs(cuePoint.at),
    type: "chapter",
    label: cuePoint.name,
  };
  const action = cuePoint.action;
  if (action?.kind === "question") {
    return {
      ...base,
      type: "knowledge-check",
      question: {
        prompt: action.question.prompt,
        choices: (action.question.choices ?? []).map((choice) => ({
          id: choice.id,
          label: choice.label ?? "",
        })),
        correctChoiceIds: action.question.correctResponses?.length
          ? [...action.question.correctResponses]
          : undefined,
        requireCorrect: action.requireCorrect,
      },
    };
  }
  if (action?.kind === "branch") {
    return {
      ...base,
      type: "branch",
      branchChoices: action.choices.map((choice) => ({
        id: choice.id,
        label: choice.label,
        jumpToMs: choice.jumpTo !== undefined ? sToMs(choice.jumpTo) : undefined,
        videoRef: choice.video,
        pageId: choice.page,
      })),
    };
  }
  const modalTrigger = triggers.find(
    (trigger) =>
      trigger.event.type === "cue-point" &&
      trigger.event.cuePoint === cuePoint.id &&
      trigger.actions.some((a) => a.type === "open-popup"),
  );
  const openPopup = modalTrigger?.actions.find((a) => a.type === "open-popup");
  if (openPopup && typeof openPopup.target === "string") {
    return { ...base, type: "modal", modalRef: openPopup.target };
  }
  return base;
}

/** The normalized marker list a scene exports in its extension copy. */
function normalizedMarkers(scene: StudioScene, hostId: string): CueMarker[] {
  return (scene.markers ?? []).map((marker, i) => ({
    ...marker,
    id: cueMarkerId(marker, `cue-${hostId}-${i}`),
  }));
}

/**
 * Attach a scene's cue markers to its mapped OCF objects (issue #64):
 * native cue points and modal triggers on the first footage object, and
 * the lossless extension copy on the host object.
 */
function attachCueMarkers(objects: CourseObject[], scene: StudioScene): void {
  if (!scene.markers?.length || objects.length === 0) return;
  const videoIndex = objects.findIndex((o) => o.type === "video");
  const hostIndex = videoIndex >= 0 ? videoIndex : 0;
  const host = objects[hostIndex];
  const markers = normalizedMarkers(scene, host.id);
  const studioExtension = {
    ...(host.extensions?.["x-finch-studio"] ?? {}),
    [CUE_MARKERS_EXTENSION_KEY]: markers,
  };
  let next: CourseObject = {
    ...host,
    extensions: { ...host.extensions, "x-finch-studio": studioExtension },
  };
  if (videoIndex >= 0) {
    const video = next as VideoObject;
    const cuePoints: CuePoint[] = [];
    const triggers: Trigger[] = [...(video.triggers ?? [])];
    markers.forEach((marker, i) => {
      const converted = cueMarkerToOCF(marker, `cue-${host.id}-${i}`);
      cuePoints.push(converted.cuePoint);
      if (converted.trigger) triggers.push(converted.trigger);
    });
    next = {
      ...video,
      cuePoints,
      triggers: triggers.length ? triggers : undefined,
    };
  }
  objects[hostIndex] = next;
}

/** Read the extension copy of a scene's markers off any of its objects. */
function markersFromExtension(objects: CourseObject[]): CueMarker[] | undefined {
  for (const obj of objects) {
    const stored = obj.extensions?.["x-finch-studio"]?.[CUE_MARKERS_EXTENSION_KEY];
    if (Array.isArray(stored) && stored.length > 0) {
      return (stored as CueMarker[]).map((marker) => ({ ...marker }));
    }
  }
  return undefined;
}

/** Derive a scene's markers from native cue points when no copy exists. */
function markersFromCuePoints(objects: CourseObject[]): CueMarker[] | undefined {
  for (const obj of objects) {
    if (obj.type !== "video" && obj.type !== "audio") continue;
    const cuePoints = (obj as VideoObject).cuePoints;
    if (cuePoints?.length) {
      return cuePoints.map((cuePoint) =>
        cuePointToMarker(cuePoint, obj.triggers ?? []),
      );
    }
  }
  return undefined;
}

/**
 * Whiteboard draw-on (issue #52) rides the object's x-finch-studio
 * extension, the same channel as character metadata, so it survives
 * the OCF round trip even without a sidecar. Only the kinds the
 * whiteboard style supports (text, image, shape) carry it.
 */
function drawOnExtension(el: SceneElement): { "x-finch-studio": { drawOn: DrawOnStyle } } | undefined {
  if (!el.drawOn) return undefined;
  if (el.kind !== "text" && el.kind !== "image" && el.kind !== "shape") return undefined;
  return { "x-finch-studio": { drawOn: { ...el.drawOn } } };
}

/** Image export extension: draw-on (issue #52) and colour correction
 * (issue #46) share the one x-finch-studio record. */
function imageExtension(
  el: SceneElement,
): { "x-finch-studio": Record<string, unknown> } | undefined {
  const studio: Record<string, unknown> = {
    ...(drawOnExtension(el)?.["x-finch-studio"] ?? {}),
  };
  if (el.colorCorrection) {
    studio.colorCorrection = { ...el.colorCorrection };
  }
  return Object.keys(studio).length ? { "x-finch-studio": studio } : undefined;
}

function parseDrawOn(raw: unknown): DrawOnStyle | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const out: DrawOnStyle = {};
  if (typeof r.durationMs === "number" && Number.isFinite(r.durationMs)) out.durationMs = r.durationMs;
  if (r.handStyle === "marker" || r.handStyle === "chalk" || r.handStyle === "pen") out.handStyle = r.handStyle;
  if (typeof r.eraseDelayMs === "number" && Number.isFinite(r.eraseDelayMs)) out.eraseDelayMs = r.eraseDelayMs;
  if (typeof r.eraseDurationMs === "number" && Number.isFinite(r.eraseDurationMs)) out.eraseDurationMs = r.eraseDurationMs;
  return out;
}

function parseWhiteboard(raw: unknown): WhiteboardSceneStyle | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  return typeof r.surface === "string" ? { surface: r.surface } : {};
}

function elementToOCF(el: SceneElement): CourseObject | null {
  const base = {
    id: el.id,
    name: el.name,
    position: { x: el.x, y: el.y, w: el.w, h: el.h },
    timing: { start: msToS(el.startMs), duration: msToS(el.durationMs) },
    animations: el.effects?.length
      ? { presets: el.effects.map((effect) => ({ ...effect })) }
      : undefined,
  };
  switch (el.kind) {
    case "text":
      return { ...base, type: "text", content: el.text, extensions: drawOnExtension(el) } satisfies TextObject;
    case "image":
      return {
        ...base,
        type: "image",
        resource: el.asset.r2Key,
        extensions: imageExtension(el),
      } satisfies ImageObject;
    case "footage": {
      return {
        ...base,
        type: "video",
        resource: el.asset.r2Key,
        controls: true,
        // Footage edits (issue #25) ride the studio extension so a
        // no-sidecar rebuild keeps trim, speed, freeze, crop, and PiP.
        extensions: {
          "x-finch-studio": {
            sourceInMs: el.sourceInMs,
            sourceOutMs: el.sourceOutMs,
            speed: el.speed,
            volume: el.volume,
            ...(el.freeze ? { freeze: { ...el.freeze } } : {}),
            ...(el.crop ? { crop: { ...el.crop } } : {}),
            ...(el.pipLayout ? { pipLayout: el.pipLayout } : {}),
            ...(el.colorCorrection
              ? { colorCorrection: { ...el.colorCorrection } }
              : {}),
          },
        },
      } satisfies VideoObject;
    }
    case "character":
      return {
        ...base,
        type: "character",
        characterId: el.characterRef as CharacterObject["characterId"],
        characterAnimation: (el.action as CharacterObject["characterAnimation"]) ?? "idle",
        speech: [],
        extensions: {
          "x-finch-studio": {
            characterRef: el.characterRef,
            expression: el.expression ?? "",
            dialogueLineId: el.dialogueLineId ?? "",
          },
        },
      } satisfies CharacterObject;
    case "shape":
      return {
        ...base,
        type: "shape",
        shape: el.shape === "arrow" ? "line" : el.shape,
        fill: el.fill,
        extensions: drawOnExtension(el),
      } satisfies ShapeObject;
    case "lottie":
      // Lottie maps to a real OCF object: every field the element
      // carries fits on LottieObject, so the round trip stays lossless
      // even without the sidecar.
      return {
        ...base,
        type: "lottie",
        resource: el.asset?.r2Key ?? el.dataUri,
        packId: el.packId,
        animationData: el.animationData,
        colors: el.colors,
        loop: el.loop,
        speed: el.speed,
      } satisfies LottieObject;
    case "chart":
      return {
        ...base,
        type: "chart",
        chart: {
          chartType: el.chartType,
          csv: el.csv,
          labels: [],
          datasets: [],
        },
      } satisfies ChartObject;
    case "audio":
      return null; // carried by the sidecar only
  }
}

export function studioToOCF(project: StudioProject): {
  project: VideoProject;
  sidecar: StudioSidecar;
} {
  const sidecar: StudioSidecar = {
    scenes: {},
    sceneGroupPresetRefs: project.sceneGroupPresetRefs,
    brandKitRef: project.brandKitRef,
    captions: project.captions,
    globalMusic: project.globalMusic,
    aspect: project.aspect,
  };
  const scenes: VideoScene[] = project.scenes.map((scene) => {
    sidecar.scenes[scene.id] = scene;
    const objects = scene.elements
      .map((el) => elementToOCF(el))
      .filter((o): o is CourseObject => o !== null);
    attachCueMarkers(objects, scene);
    return {
      id: scene.id,
      name: scene.name,
      durationMs: scene.durationMs,
      transition: scene.transition,
      transitionMs: scene.transitionMs,
      animations: scene.effects?.length
        ? { presets: scene.effects.map((effect) => ({ ...effect })) }
        : undefined,
      background:
        scene.background && "color" in scene.background ? scene.background.color : undefined,
      extensions: scene.whiteboard
        ? { "x-finch-studio": { whiteboard: { ...scene.whiteboard } } }
        : undefined,
      objects,
    };
  });
  return {
    project: { id: project.id, name: project.name, scenes, aspect: project.aspect },
    sidecar,
  };
}

function ocfToElement(obj: CourseObject): SceneElement | null {
  const timing = obj.timing ?? {};
  const drawOn =
    obj.type === "text" || obj.type === "image" || obj.type === "shape"
      ? parseDrawOn(obj.extensions?.["x-finch-studio"]?.drawOn)
      : undefined;
  const base = {
    id: obj.id,
    name: obj.name,
    startMs: sToMs(timing.start ?? 0),
    durationMs: sToMs(timing.duration ?? 5),
    x: obj.position?.x,
    y: obj.position?.y,
    w: obj.position?.w,
    h: obj.position?.h,
    effects: obj.animations?.presets?.map((effect) => ({ ...effect })),
    drawOn,
  };
  switch (obj.type) {
    case "text":
      return { ...base, kind: "text", text: (obj as TextObject).content ?? "" };
    case "image":
      return {
        ...base,
        kind: "image",
        asset: { r2Key: (obj as ImageObject).resource ?? "", kind: "image" },
        colorCorrection: sanitizeColorCorrection(
          (obj as ImageObject).extensions?.["x-finch-studio"]?.colorCorrection,
        ),
      };
    case "video": {
      const v = obj as VideoObject;
      const ext = v.extensions?.["x-finch-studio"] ?? {};
      const num = (value: unknown): number | undefined =>
        typeof value === "number" && Number.isFinite(value) ? value : undefined;
      const freeze =
        ext["freeze"] && typeof ext["freeze"] === "object"
          ? (ext["freeze"] as FootageElement["freeze"])
          : undefined;
      const crop =
        ext["crop"] && typeof ext["crop"] === "object"
          ? (ext["crop"] as FootageElement["crop"])
          : undefined;
      const pipLayout =
        typeof ext["pipLayout"] === "string"
          ? (ext["pipLayout"] as FootageElement["pipLayout"])
          : undefined;
      const el: FootageElement = {
        ...base,
        kind: "footage",
        asset: { r2Key: v.resource ?? "", kind: "video" },
        // Without studio extension data this is the legacy rebuild:
        // full clip at speed 1, exactly as before issue #25.
        sourceInMs: num(ext["sourceInMs"]) ?? 0,
        sourceOutMs: num(ext["sourceOutMs"]) ?? base.durationMs,
        speed: num(ext["speed"]) ?? 1,
        volume: num(ext["volume"]) ?? 1,
        ...(freeze ? { freeze } : {}),
        ...(crop ? { crop } : {}),
        ...(pipLayout ? { pipLayout } : {}),
        colorCorrection: sanitizeColorCorrection(ext["colorCorrection"]),
      };
      return el;
    }
    case "character": {
      const c = obj as CharacterObject;
      const ext = c.extensions?.["x-finch-studio"] ?? {};
      const el: CharacterElement = {
        ...base,
        kind: "character",
        characterRef: (ext["characterRef"] as string) || c.characterId,
        action: c.characterAnimation,
        expression: (ext["expression"] as string) || undefined,
        dialogueLineId: (ext["dialogueLineId"] as string) || undefined,
      };
      return el;
    }
    case "shape": {
      const s = obj as ShapeObject;
      return {
        ...base,
        kind: "shape",
        shape: s.shape === "polygon" ? "rect" : (s.shape ?? "rect"),
        fill: typeof s.fill === "string" ? s.fill : undefined,
      };
    }
    case "lottie": {
      const l = obj as LottieObject;
      const el: LottieElement = {
        ...base,
        kind: "lottie",
        packId: l.packId,
        dataUri:
          l.resource && (l.resource.startsWith("data:") || l.resource.startsWith("http"))
            ? l.resource
            : undefined,
        asset:
          l.resource && !l.resource.startsWith("data:") && !l.resource.startsWith("http")
            ? { r2Key: l.resource, kind: "lottie" }
            : undefined,
        animationData: l.animationData,
        colors: l.colors,
        loop: l.loop,
        speed: l.speed,
      };
      return el;
    }
    case "chart": {
      const c = obj as ChartObject;
      const chart = c.chart;
      if (!chart) return null;
      return {
        ...base,
        kind: "chart",
        chartType: chart.chartType,
        csv: chart.csv ?? "",
      };
    }
    default:
      return null;
  }
}

export function ocfToStudio(
  project: VideoProject,
  sidecar?: StudioSidecar,
): StudioProject {
  const scenes: StudioScene[] = project.scenes.map((scene) => {
    const saved = sidecar?.scenes[scene.id];
    if (saved) return saved;
    const markers =
      markersFromExtension(scene.objects) ?? markersFromCuePoints(scene.objects);
    return {
      id: scene.id,
      name: scene.name,
      durationMs: scene.durationMs,
      transition: scene.transition ?? "cut",
      transitionMs: scene.transitionMs,
      effects: scene.animations?.presets?.map((effect) => ({ ...effect })),
      background: scene.background ? { color: scene.background } : undefined,
      whiteboard: parseWhiteboard(scene.extensions?.["x-finch-studio"]?.whiteboard),
      elements: scene.objects
        .map(ocfToElement)
        .filter((e): e is SceneElement => e !== null),
      dialogue: [],
      markers,
    };
  });
  return {
    version: STUDIO_SCHEMA_VERSION,
    id: project.id,
    name: project.name,
    scenes,
    sceneGroupPresetRefs: sidecar?.sceneGroupPresetRefs,
    brandKitRef: sidecar?.brandKitRef,
    captions: sidecar?.captions,
    globalMusic: sidecar?.globalMusic,
    aspect: sidecar?.aspect ?? project.aspect ?? "16:9",
  };
}
