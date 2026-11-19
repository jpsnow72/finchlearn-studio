/**
 * OCF mapping (issue #5): StudioProject <-> OCF VideoProject.
 *
 * Scenes, durations, and transitions map directly. Elements with an OCF
 * scene object equivalent (text, image, footage as video, character, shape)
 * map to real OCF objects, with element timing carried in OCF Timing
 * (seconds) and position in OCF Position. Studio cue markers on a scene map
 * onto the scene's first footage object as OCF cue points (issue #64), and
 * also stay in the sidecar.
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
  CourseObject,
  CuePoint,
  ImageObject,
  ShapeObject,
  TextObject,
  VideoObject,
  VideoProject,
  VideoScene,
} from "@finch-studio/core";
import type {
  CharacterElement,
  CueMarker,
  FootageElement,
  SceneElement,
  StudioProject,
  StudioScene,
} from "./schema.js";
import { STUDIO_SCHEMA_VERSION } from "./schema.js";

export interface StudioSidecar {
  /** Full studio scenes, keyed by scene id, for lossless restore. */
  scenes: Record<string, StudioScene>;
  brandKitRef?: string;
  captions?: StudioProject["captions"];
  globalMusic?: StudioProject["globalMusic"];
  aspect?: StudioProject["aspect"];
}

const msToS = (ms: number) => ms / 1000;
const sToMs = (s: number) => Math.round(s * 1000);

function elementToOCF(el: SceneElement, markers: CueMarker[] | undefined): CourseObject | null {
  const base = {
    id: el.id,
    name: el.name,
    position: { x: el.x, y: el.y, w: el.w, h: el.h },
    timing: { start: msToS(el.startMs), duration: msToS(el.durationMs) },
  };
  switch (el.kind) {
    case "text":
      return { ...base, type: "text", content: el.text } satisfies TextObject;
    case "image":
      return { ...base, type: "image", resource: el.asset.r2Key } satisfies ImageObject;
    case "footage": {
      const cuePoints: CuePoint[] = (markers ?? []).map((m, i) => ({
        id: `cue-${el.id}-${i}`,
        name: m.label ?? m.type,
        at: msToS(m.atMs),
      }));
      return {
        ...base,
        type: "video",
        resource: el.asset.r2Key,
        controls: true,
        cuePoints: cuePoints.length ? cuePoints : undefined,
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
      } satisfies ShapeObject;
    case "chart":
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
    brandKitRef: project.brandKitRef,
    captions: project.captions,
    globalMusic: project.globalMusic,
    aspect: project.aspect,
  };
  const scenes: VideoScene[] = project.scenes.map((scene) => {
    sidecar.scenes[scene.id] = scene;
    const objects = scene.elements
      .map((el) => elementToOCF(el, scene.markers))
      .filter((o): o is CourseObject => o !== null);
    return {
      id: scene.id,
      name: scene.name,
      durationMs: scene.durationMs,
      transition: scene.transition,
      transitionMs: scene.transitionMs,
      background:
        scene.background && "color" in scene.background ? scene.background.color : undefined,
      objects,
    };
  });
  return { project: { id: project.id, name: project.name, scenes }, sidecar };
}

function ocfToElement(obj: CourseObject): SceneElement | null {
  const timing = obj.timing ?? {};
  const base = {
    id: obj.id,
    name: obj.name,
    startMs: sToMs(timing.start ?? 0),
    durationMs: sToMs(timing.duration ?? 5),
    x: obj.position?.x,
    y: obj.position?.y,
    w: obj.position?.w,
    h: obj.position?.h,
  };
  switch (obj.type) {
    case "text":
      return { ...base, kind: "text", text: (obj as TextObject).content ?? "" };
    case "image":
      return {
        ...base,
        kind: "image",
        asset: { r2Key: (obj as ImageObject).resource ?? "", kind: "image" },
      };
    case "video": {
      const v = obj as VideoObject;
      const el: FootageElement = {
        ...base,
        kind: "footage",
        asset: { r2Key: v.resource ?? "", kind: "video" },
        sourceInMs: 0,
        sourceOutMs: base.durationMs,
        speed: 1,
        volume: 1,
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
    return {
      id: scene.id,
      name: scene.name,
      durationMs: scene.durationMs,
      transition: scene.transition ?? "cut",
      transitionMs: scene.transitionMs,
      background: scene.background ? { color: scene.background } : undefined,
      elements: scene.objects
        .map(ocfToElement)
        .filter((e): e is SceneElement => e !== null),
      dialogue: [],
    };
  });
  return {
    version: STUDIO_SCHEMA_VERSION,
    id: project.id,
    name: project.name,
    scenes,
    brandKitRef: sidecar?.brandKitRef,
    captions: sidecar?.captions,
    globalMusic: sidecar?.globalMusic,
    aspect: sidecar?.aspect ?? "16:9",
  };
}
