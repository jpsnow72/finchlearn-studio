/**
 * Video Studio store — project state for the standalone app.
 *
 * Scenes hold inline CourseObjects (characters, text, shapes, images).
 * All project mutations go through the store so scene and timeline edits
 * share one undo history.
 */
import { create } from "zustand";
import type {
  AudioObject,
  CharacterAnimationName,
  CharacterColors,
  CharacterFacing,
  CharacterId,
  CharacterObject,
  CharacterSpeech,
  CharacterWaypoint,
  AnimationPreset,
  CourseObject,
  VideoProject,
  VideoScene,
  VideoSceneTransition,
} from "@finch-studio/core";
import {
  makeVideoProject,
  makeVideoScene,
  sceneContentDurationMs,
} from "@finch-studio/animation";
import {
  addAudioVolumeKeyframe,
  rippleDeleteAudioRegion as rippleDeleteRegion,
  withAudioClipMetadata,
  type AudioClipMetadata,
} from "./audioEditing";
import {
  copyCaptionEditsForScene,
  getCaptionCues,
  withCaptionEdit,
  withCaptionStyle,
  type CaptionEdit,
  type CaptionProject,
  type CaptionStyle,
} from "./captions";
import { characterForLegacyId } from "@finch-studio/characters";
import type { EmbedContext } from "./embed";

export const TIMELINE_LANES = ["main", "overlay", "voice", "music"] as const;
export type TimelineLane = (typeof TIMELINE_LANES)[number];

const HISTORY_LIMIT = 100;
const MIN_CLIP_DURATION_MS = 100;
const STUDIO_EXTENSION = "x-finch-studio";

export function snapTimelineTime(
  timeMs: number,
  candidates: number[],
  toleranceMs: number,
): number {
  let nearest = timeMs;
  let distance = toleranceMs;
  for (const candidate of candidates) {
    const candidateDistance = Math.abs(candidate - timeMs);
    if (candidateDistance <= distance) {
      nearest = candidate;
      distance = candidateDistance;
    }
  }
  return nearest;
}

let objCounter = 0;
function newObjId(prefix: string): string {
  objCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${objCounter}`;
}

export function makeStudioCharacter(characterId: CharacterId): CharacterObject {
  return {
    id: newObjId("ch"),
    type: "character",
    name: characterForLegacyId(characterId).name,
    position: { x: 200 + objCounter * 40, y: 200, w: 140, h: 280 },
    characterId,
    characterAnimation: "idle",
    facing: "right",
  };
}

export function makeStudioImage(resource: string, name = "Image"): CourseObject {
  return {
    id: newObjId("im"),
    type: "image",
    name,
    position: { x: 320, y: 120, w: 320, h: 200 },
    resource,
  } as CourseObject;
}

/**
 * A footage object (issue #26 recordings land through here, like any
 * uploaded video): a normal video object on the main timeline lane, so
 * it trims, splits, and plays back exactly like other footage. The clip
 * duration becomes its timeline duration when known.
 */
export function makeStudioVideo(
  resource: string,
  name = "Video",
  durationMs?: number,
): CourseObject {
  return {
    id: newObjId("vd"),
    type: "video",
    name,
    position: { x: 80, y: 60, w: 640, h: 360 },
    resource,
    controls: true,
    ...(durationMs && durationMs > 0
      ? { timing: { start: 0, duration: Math.max(0.5, durationMs / 1000) } }
      : {}),
  } as CourseObject;
}

export function makeStudioAudio(resource: string, name = "Audio"): CourseObject {
  return {
    id: newObjId("au"),
    type: "audio",
    name,
    position: { x: 40, y: 40, w: 220, h: 48 },
    resource,
  } as CourseObject;
}

export function makeStarterProject(name = "Untitled video"): VideoProject {
  const project = makeVideoProject(name);
  const host = makeStudioCharacter("businesswoman");
  host.characterAnimation = "wave";
  host.speech = [
    {
      id: "starter-line",
      text: "Hi, I am Maya. Add your own dialogue, drag in media, and export when you are ready.",
      start: 400,
      duration: 4200,
    },
  ];
  const title = makeStudioText();
  (title as { content?: string }).content = "<h1>Your title here</h1>";
  const scene = project.scenes[0];
  if (scene) {
    scene.objects = [host, title];
    scene.durationMs = 6000;
  }
  return project;
}

export function makeStudioText(): CourseObject {
  return {
    id: newObjId("tx"),
    type: "text",
    name: "Text",
    position: { x: 300, y: 100, w: 480, h: 96 },
    content: "<p>Edit this text</p>",
  } as CourseObject;
}

export function makeStudioShape(): CourseObject {
  return {
    id: newObjId("sh"),
    type: "shape",
    name: "Shape",
    position: { x: 300, y: 300, w: 240, h: 160 },
    shape: "rect",
    fill: "#3b82f6",
  } as CourseObject;
}

const STORAGE_KEY = "ocf.video-studio.project.v1";

function loadStored(): VideoProject | null {
  try {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("fresh")) {
      return null;
    }
  } catch {
    // ignore
  }
  try {
    // Embedded-from-course bridge: ?embed=<objectId> loads the stashed project.
    const params = new URLSearchParams(window.location.search);
    const embedId = params.get("embed");
    if (embedId) {
      const raw = localStorage.getItem(`ocf.video-studio.embed.${embedId}`);
      if (raw) {
        const p = JSON.parse(raw) as VideoProject;
        if (p && Array.isArray(p.scenes)) return p;
      }
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as VideoProject;
      if (p && Array.isArray(p.scenes) && p.scenes.length > 0) return p;
    }
  } catch {
    // ignore
  }
  return null;
}

function persist(project: VideoProject): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  } catch {
    // storage full / unavailable — non-fatal
  }
}

interface TtsSettings {
  voiceId: string | undefined;
  rate: number;
  pitch: number;
}

interface TimelineClipPatch {
  startMs?: number;
  durationMs?: number;
  lane?: TimelineLane;
  trimEdge?: "start" | "end";
}

interface VideoStudioState {
  project: CaptionProject;
  pastProjects: CaptionProject[];
  futureProjects: CaptionProject[];
  timelineEditOrigin: CaptionProject | null;
  currentSceneId: string;
  selectedObjectId: string | null;
  selectedObjectIds: string[];
  selectedTimelineClipId: string | null;
  timelineSnapEnabled: boolean;
  tts: TtsSettings;
  embedObjectId: string | null;
  /** Verified FinchLearn handoff context (issue #49); null standalone. */
  embedContext: EmbedContext | null;
  setEmbedContext: (context: EmbedContext | null) => void;

  // project
  newProject: () => void;
  loadProject: (p: VideoProject) => void;
  undo: () => void;
  redo: () => void;
  setProjectName: (name: string) => void;
  updateCaption: (sceneId: string, lineId: string, patch: CaptionEdit) => void;
  setCaptionStyle: (patch: Partial<CaptionStyle>) => void;
  // scenes
  addScene: () => void;
  duplicateScene: (id: string) => void;
  removeScene: (id: string) => void;
  renameScene: (id: string, name: string) => void;
  setSceneTransition: (id: string, t: VideoSceneTransition) => void;
  setSceneBackground: (id: string, background: string | undefined) => void;
  setScenePresets: (id: string, presets: AnimationPreset[]) => void;
  moveScene: (id: string, dir: -1 | 1) => void;
  moveSceneTo: (id: string, index: number) => void;
  selectScene: (id: string) => void;
  // objects
  selectObject: (id: string | null, additive?: boolean) => void;
  addObject: (obj: CourseObject) => void;
  insertObjectGroup: (objects: CourseObject[]) => void;
  updateObject: (id: string, patch: Partial<CourseObject>) => void;
  setObjectPresets: (id: string, presets: AnimationPreset[]) => void;
  removeObject: (id: string) => void;
  moveObject: (id: string, dir: -1 | 1) => void;
  selectTimelineClip: (id: string | null) => void;
  beginTimelineEdit: () => void;
  endTimelineEdit: () => void;
  toggleTimelineSnap: () => void;
  updateTimelineClip: (id: string, patch: TimelineClipPatch, recordHistory?: boolean) => void;
  splitTimelineClip: (id: string, atMs: number) => void;
  splitTimelineAt: (atMs: number) => void;
  rippleDeleteTimelineClip: (id: string) => void;
  rippleDeleteGapAt: (atMs: number) => void;
  updateAudioMetadata: (id: string, patch: Partial<AudioClipMetadata>) => void;
  addAudioVolumeKeyframe: (id: string, timeMs: number, decibels: number) => void;
  rippleDeleteAudioRegion: (startMs: number, endMs: number) => void;
  // characters
  setCharAnimation: (id: string, a: CharacterAnimationName) => void;
  setCharFacing: (id: string, f: CharacterFacing) => void;
  setCharColors: (id: string, c: CharacterColors) => void;
  addWaypoint: (id: string, w: CharacterWaypoint) => void;
  updateWaypoint: (id: string, idx: number, patch: Partial<CharacterWaypoint>) => void;
  removeWaypoint: (id: string, idx: number) => void;
  addSpeech: (id: string, s: CharacterSpeech) => void;
  updateSpeech: (id: string, lineId: string, patch: Partial<CharacterSpeech>) => void;
  setCharacterVoice: (id: string, voiceId: string | undefined) => void;
  removeSpeech: (id: string, lineId: string) => void;
  // tts
  setTts: (patch: Partial<TtsSettings>) => void;
}

function patchScene(
  project: VideoProject,
  sceneId: string,
  fn: (s: VideoScene) => VideoScene,
): VideoProject {
  return {
    ...project,
    scenes: project.scenes.map((s) => (s.id === sceneId ? fn(s) : s)),
  };
}

function patchObject(
  project: VideoProject,
  sceneId: string,
  objectId: string,
  fn: (o: CourseObject) => CourseObject,
): VideoProject {
  return patchScene(project, sceneId, (s) => ({
    ...s,
    objects: s.objects.map((o) => (o.id === objectId ? fn(o) : o)),
  }));
}

function asCharacter(o: CourseObject): CharacterObject | null {
  return o.type === "character" ? (o as CharacterObject) : null;
}

function deriveProjectDurations(project: CaptionProject): CaptionProject {
  return {
    ...project,
    scenes: project.scenes.map((scene) => ({
      ...scene,
      durationMs: sceneContentDurationMs(scene),
    })),
  };
}

function duplicateObject(object: CourseObject): CourseObject {
  const copy = JSON.parse(JSON.stringify(object)) as CourseObject & {
    objects?: CourseObject[];
    speech?: CharacterSpeech[];
  };
  copy.id = newObjId("obj");
  if (Array.isArray(copy.objects)) {
    copy.objects = copy.objects.map(duplicateObject);
  }
  if (Array.isArray(copy.speech)) {
    copy.speech = copy.speech.map((line) => ({ ...line, id: newObjId("speech") }));
  }
  return copy;
}

function studioMetadata(object: CourseObject): Record<string, unknown> {
  return object.extensions?.[STUDIO_EXTENSION] ?? {};
}

/** Default production voice per studio character (all basic/Kokoro, so
 * narration works signed out; users can reassign per character). */
const DEFAULT_VOICE_BY_DEF: Record<string, string> = {
  maya: "af_heart",
  leo: "am_michael",
  rosa: "bf_emma",
  walter: "bm_george",
};

/** The production voice assigned to a character object (metadata first,
 * then the per-character default). Empty string means browser voice. */
export function characterVoiceId(object: CourseObject): string {
  const meta = studioMetadata(object);
  if (typeof meta.voiceId === "string") return meta.voiceId;
  if (object.type === "character") {
    const def = characterForLegacyId((object as CharacterObject).characterId);
    return DEFAULT_VOICE_BY_DEF[def.id] ?? "af_heart";
  }
  return "af_heart";
}

export function timelineLaneForObject(object: CourseObject): TimelineLane {
  const savedLane = studioMetadata(object).timelineLane;
  if (TIMELINE_LANES.includes(savedLane as TimelineLane)) {
    return savedLane as TimelineLane;
  }
  if (object.type === "audio") return "voice";
  if (object.type === "video") return "main";
  return "overlay";
}

export function timelineClipRange(
  object: CourseObject,
  sceneDurationMs: number,
): { startMs: number; durationMs: number } {
  const startMs = Math.min(
    Math.max(0, (object.timing?.start ?? 0) * 1000),
    Math.max(0, sceneDurationMs - MIN_CLIP_DURATION_MS),
  );
  const durationMs = Math.min(
    sceneDurationMs - startMs,
    Math.max(
      MIN_CLIP_DURATION_MS,
      (object.timing?.duration ??
        Math.max(0.1, sceneDurationMs / 1000 - startMs / 1000)) * 1000,
    ),
  );
  return { startMs, durationMs };
}

function withTimelineClip(
  object: CourseObject,
  startMs: number,
  durationMs: number,
  lane = timelineLaneForObject(object),
  sourceInDeltaMs = 0,
): CourseObject {
  const metadata: Record<string, unknown> = {
    ...studioMetadata(object),
    timelineLane: lane,
  };
  if ((object.type === "video" || object.type === "audio") && sourceInDeltaMs !== 0) {
    metadata.sourceInMs = Math.max(
      0,
      (typeof metadata.sourceInMs === "number" ? metadata.sourceInMs : 0) + sourceInDeltaMs,
    );
  }
  return {
    ...object,
    timing: { ...object.timing, start: startMs / 1000, duration: durationMs / 1000 },
    extensions: { ...object.extensions, [STUDIO_EXTENSION]: metadata },
  } as CourseObject;
}

function rippleObjects(
  objects: CourseObject[],
  fromMs: number,
  toMs: number,
  sceneDurationMs: number,
  excludedId?: string,
): CourseObject[] {
  const amount = toMs - fromMs;
  const result: CourseObject[] = [];
  for (const object of objects) {
    if (object.id === excludedId) continue;
    const { startMs, durationMs } = timelineClipRange(object, sceneDurationMs);
    const endMs = startMs + durationMs;
    if (endMs <= fromMs) {
      result.push(object);
      continue;
    }
    if (startMs >= toMs) {
      result.push(withTimelineClip(object, startMs - amount, durationMs));
      continue;
    }

    const beforeMs = Math.max(0, Math.min(endMs, fromMs) - startMs);
    const afterMs = Math.max(0, endMs - Math.max(startMs, toMs));
    if (beforeMs >= MIN_CLIP_DURATION_MS) {
      result.push(withTimelineClip(object, startMs, beforeMs));
    }
    if (afterMs >= MIN_CLIP_DURATION_MS) {
      const after = withTimelineClip(
        object,
        fromMs,
        afterMs,
        timelineLaneForObject(object),
        Math.max(0, toMs - startMs),
      );
      if (beforeMs >= MIN_CLIP_DURATION_MS) {
        result.push({ ...after, id: newObjId("clip") } as CourseObject);
      } else {
        result.push(after);
      }
    }
  }
  return result;
}

export const useStudioStore = create<VideoStudioState>()((set, get) => {
  const initial = deriveProjectDurations(
    (loadStored() ?? makeVideoProject("Untitled video")) as CaptionProject,
  );
  const params =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search)
      : null;
  const embedObjectId: string | null = params?.get("embed") ?? null;

  const commit = (project: CaptionProject) => {
    const state = get();
    const previous = state.project;
    if (project === previous) return;
    const derivedProject = deriveProjectDurations(project);
    persist(derivedProject);
    if (state.timelineEditOrigin) {
      set({ project: derivedProject });
    } else {
      set((current) => ({
        project: derivedProject,
        pastProjects: [...current.pastProjects, previous].slice(-HISTORY_LIMIT),
        futureProjects: [],
      }));
    }
  };

  return {
    project: initial,
    pastProjects: [],
    futureProjects: [],
    timelineEditOrigin: null,
    currentSceneId: initial.scenes[0]?.id ?? "",
    selectedObjectId: null,
    selectedObjectIds: [],
    selectedTimelineClipId: null,
    timelineSnapEnabled: true,
    tts: { voiceId: undefined, rate: 1, pitch: 1 },
    embedObjectId,
    embedContext: null,
    setEmbedContext: (context) =>
      set({
        embedContext: context,
        // The badge and legacy copy-back key off the block id too.
        embedObjectId: context ? context.blockId : get().embedObjectId,
      }),

    loadProject: (p) => {
      const project = deriveProjectDurations(p as CaptionProject);
      set({
        project,
        pastProjects: [],
        futureProjects: [],
        timelineEditOrigin: null,
        currentSceneId: project.scenes[0]?.id ?? "",
        selectedObjectId: null,
        selectedObjectIds: [],
        selectedTimelineClipId: null,
      });
    },

    newProject: () => {
      const project = deriveProjectDurations(makeVideoProject("Untitled video") as CaptionProject);
      persist(project);
      set({
        project,
        pastProjects: [],
        futureProjects: [],
        timelineEditOrigin: null,
        currentSceneId: project.scenes[0].id,
        selectedObjectId: null,
        selectedObjectIds: [],
        selectedTimelineClipId: null,
      });
    },
    undo: () => {
      const { project, pastProjects, futureProjects, currentSceneId, selectedObjectId, selectedObjectIds, selectedTimelineClipId } = get();
      const previous = pastProjects[pastProjects.length - 1];
      if (!previous) return;
      persist(previous);
      const scene =
        previous.scenes.find((item) => item.id === currentSceneId) ?? previous.scenes[0];
      set({
        project: previous,
        pastProjects: pastProjects.slice(0, -1),
        futureProjects: [project, ...futureProjects],
        currentSceneId: scene.id,
        selectedObjectId: scene.objects.some((item) => item.id === selectedObjectId)
          ? selectedObjectId
          : null,
        selectedObjectIds: selectedObjectIds.filter((id) =>
          scene.objects.some((item) => item.id === id),
        ),
        selectedTimelineClipId: scene.objects.some((item) => item.id === selectedTimelineClipId)
          ? selectedTimelineClipId
          : null,
      });
    },
    redo: () => {
      const { project, pastProjects, futureProjects, currentSceneId, selectedObjectId, selectedObjectIds, selectedTimelineClipId } = get();
      const next = futureProjects[0];
      if (!next) return;
      persist(next);
      const scene = next.scenes.find((item) => item.id === currentSceneId) ?? next.scenes[0];
      set({
        project: next,
        pastProjects: [...pastProjects, project].slice(-HISTORY_LIMIT),
        futureProjects: futureProjects.slice(1),
        currentSceneId: scene.id,
        selectedObjectId: scene.objects.some((item) => item.id === selectedObjectId)
          ? selectedObjectId
          : null,
        selectedObjectIds: selectedObjectIds.filter((id) =>
          scene.objects.some((item) => item.id === id),
        ),
        selectedTimelineClipId: scene.objects.some((item) => item.id === selectedTimelineClipId)
          ? selectedTimelineClipId
          : null,
      });
    },
    setProjectName: (name) => commit({ ...get().project, name }),
    updateCaption: (sceneId, lineId, patch) => {
      const { project } = get();
      const scene = project.scenes.find((item) => item.id === sceneId);
      const cue = getCaptionCues(project).find(
        (item) => item.sceneId === sceneId && item.lineId === lineId,
      );
      if (!scene || !cue) return;
      const duration = Math.max(100, scene.durationMs);
      const requestedStart = Number.isFinite(patch.startMs) ? patch.startMs! : cue.startMs;
      const startMs = Math.min(duration - 100, Math.max(0, requestedStart));
      const requestedDuration = Number.isFinite(patch.durationMs)
        ? patch.durationMs!
        : cue.durationMs;
      const durationMs = Math.min(
        duration - startMs,
        Math.max(100, requestedDuration),
      );
      commit(withCaptionEdit(project, sceneId, lineId, { ...patch, startMs, durationMs }));
    },
    setCaptionStyle: (patch) =>
      commit(withCaptionStyle(get().project, patch)),

    addScene: () => {
      const { project } = get();
      const scene = makeVideoScene(`Scene ${project.scenes.length + 1}`);
      commit({ ...project, scenes: [...project.scenes, scene] });
      set({
        currentSceneId: scene.id,
        selectedObjectId: null,
        selectedObjectIds: [],
        selectedTimelineClipId: null,
      });
    },
    duplicateScene: (id) => {
      const { project } = get();
      const index = project.scenes.findIndex((scene) => scene.id === id);
      if (index < 0) return;
      const source = project.scenes[index];
      const duplicate = {
        ...source,
        id: makeVideoScene().id,
        name: `${source.name} copy`,
        transition: "cut" as const,
        objects: source.objects.map(duplicateObject),
      };
      const scenes = [...project.scenes];
      scenes.splice(index + 1, 0, duplicate);
      commit(copyCaptionEditsForScene({ ...project, scenes }, source, duplicate));
      set({
        currentSceneId: duplicate.id,
        selectedObjectId: null,
        selectedObjectIds: [],
        selectedTimelineClipId: null,
      });
    },
    removeScene: (id) => {
      const { project, currentSceneId } = get();
      if (project.scenes.length <= 1) return;
      const removedIndex = project.scenes.findIndex((scene) => scene.id === id);
      if (removedIndex < 0) return;
      const scenes = project.scenes.filter((s) => s.id !== id);
      commit({ ...project, scenes });
      if (currentSceneId === id) {
        set({
          currentSceneId: scenes[Math.min(removedIndex, scenes.length - 1)].id,
          selectedObjectId: null,
          selectedObjectIds: [],
          selectedTimelineClipId: null,
        });
      }
    },
    renameScene: (id, name) =>
      commit(patchScene(get().project, id, (s) => ({ ...s, name }))),
    setSceneTransition: (id, t) =>
      commit(patchScene(get().project, id, (s) => ({ ...s, transition: t }))),
    setSceneBackground: (id, background) =>
      commit(
        patchScene(get().project, id, (s) => {
          const next = { ...s };
          if (background === undefined) delete next.background;
          else next.background = background;
          return next;
        }),
      ),
    setScenePresets: (id, presets) =>
      commit(
        patchScene(get().project, id, (s) => ({
          ...s,
          animations: { ...s.animations, presets: presets.map((preset) => ({ ...preset })) },
        })),
      ),
    moveScene: (id, dir) => {
      const i = get().project.scenes.findIndex((scene) => scene.id === id);
      get().moveSceneTo(id, i + dir);
    },
    moveSceneTo: (id, j) => {
      const { project } = get();
      const i = project.scenes.findIndex((s) => s.id === id);
      if (i < 0 || j < 0 || j >= project.scenes.length) return;
      const scenes = [...project.scenes];
      const [moved] = scenes.splice(i, 1);
      scenes.splice(j, 0, moved);
      commit({ ...project, scenes });
    },
    selectScene: (id) =>
      set({
        currentSceneId: id,
        selectedObjectId: null,
        selectedObjectIds: [],
        selectedTimelineClipId: null,
      }),

    selectObject: (id, additive = false) => {
      if (id === null) {
        set({ selectedObjectId: null, selectedObjectIds: [] });
        return;
      }
      if (!additive) {
        set({ selectedObjectId: id, selectedObjectIds: [id] });
        return;
      }
      const selectedObjectIds = get().selectedObjectIds.includes(id)
        ? get().selectedObjectIds.filter((selectedId) => selectedId !== id)
        : [...get().selectedObjectIds, id];
      set({
        selectedObjectId: selectedObjectIds.at(-1) ?? null,
        selectedObjectIds,
      });
    },
    addObject: (obj) => {
      const { project, currentSceneId } = get();
      commit(
        patchScene(project, currentSceneId, (s) => ({
          ...s,
          objects: [...s.objects, obj],
        })),
      );
      set({ selectedObjectId: obj.id, selectedObjectIds: [obj.id] });
    },
    insertObjectGroup: (objects) => {
      if (objects.length === 0) return;
      const { project, currentSceneId } = get();
      const copies = objects.map(duplicateObject);
      commit(
        patchScene(project, currentSceneId, (scene) => ({
          ...scene,
          objects: [...scene.objects, ...copies],
        })),
      );
      set({
        selectedObjectId: copies.at(-1)?.id ?? null,
        selectedObjectIds: copies.map((object) => object.id),
      });
    },
    updateObject: (id, patch) => {
      const { project, currentSceneId } = get();
      commit(
        patchObject(project, currentSceneId, id, (o) => ({ ...o, ...patch }) as CourseObject),
      );
    },
    setObjectPresets: (id, presets) => {
      const { project, currentSceneId } = get();
      commit(
        patchObject(project, currentSceneId, id, (o) => ({
          ...o,
          animations: {
            ...o.animations,
            presets: presets.map((preset) => ({ ...preset })),
          },
        }) as CourseObject),
      );
    },
    removeObject: (id) => {
      const { project, currentSceneId } = get();
      commit(
        patchScene(project, currentSceneId, (s) => ({
          ...s,
          objects: s.objects.filter((o) => o.id !== id),
        })),
      );
      const selectedObjectIds = get().selectedObjectIds.filter((selectedId) => selectedId !== id);
      if (get().selectedObjectId === id || selectedObjectIds.length !== get().selectedObjectIds.length) {
        set({
          selectedObjectId: selectedObjectIds.at(-1) ?? null,
          selectedObjectIds,
        });
      }
    },
    moveObject: (id, dir) => {
      const { project, currentSceneId } = get();
      const scene = project.scenes.find((s) => s.id === currentSceneId);
      if (!scene) return;
      const i = scene.objects.findIndex((o) => o.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= scene.objects.length) return;
      const objects = [...scene.objects];
      [objects[i], objects[j]] = [objects[j], objects[i]];
      commit(patchScene(project, currentSceneId, (s) => ({ ...s, objects })));
    },
    selectTimelineClip: (id) => set({ selectedTimelineClipId: id }),
    beginTimelineEdit: () => {
      if (!get().timelineEditOrigin) set({ timelineEditOrigin: get().project });
    },
    endTimelineEdit: () => {
      const { project, timelineEditOrigin } = get();
      if (!timelineEditOrigin) return;
      set((state) => ({
        pastProjects:
          project === timelineEditOrigin
            ? state.pastProjects
            : [...state.pastProjects, timelineEditOrigin].slice(-HISTORY_LIMIT),
        futureProjects: project === timelineEditOrigin ? state.futureProjects : [],
        timelineEditOrigin: null,
      }));
    },
    toggleTimelineSnap: () => set((state) => ({ timelineSnapEnabled: !state.timelineSnapEnabled })),
    updateTimelineClip: (id, patch, recordHistory = true) => {
      const { project, currentSceneId, timelineEditOrigin } = get();
      const scene = project.scenes.find((s) => s.id === currentSceneId);
      const object = scene?.objects.find((item) => item.id === id);
      if (!scene || !object) return;
      const sceneDurationMs =
        timelineEditOrigin?.scenes.find((item) => item.id === currentSceneId)?.durationMs ??
        scene.durationMs;
      const current = timelineClipRange(object, sceneDurationMs);
      const startMs = Math.min(
        sceneDurationMs - MIN_CLIP_DURATION_MS,
        Math.max(0, patch.startMs ?? current.startMs),
      );
      const durationMs = Math.min(
        sceneDurationMs - startMs,
        Math.max(MIN_CLIP_DURATION_MS, patch.durationMs ?? current.durationMs),
      );
      const next = patchScene(project, currentSceneId, (currentScene) => ({
        ...currentScene,
        objects: currentScene.objects.map((item) =>
          item.id === id
            ? withTimelineClip(
                item,
                startMs,
                durationMs,
                patch.lane ?? timelineLaneForObject(item),
                patch.trimEdge === "start" ? startMs - current.startMs : 0,
              )
            : item,
        ),
      }));
      if (!recordHistory && !get().timelineEditOrigin) get().beginTimelineEdit();
      commit(next);
    },
    splitTimelineClip: (id, atMs) => {
      const { project, currentSceneId } = get();
      const scene = project.scenes.find((s) => s.id === currentSceneId);
      const object = scene?.objects.find((item) => item.id === id);
      if (!scene || !object) return;
      const { startMs, durationMs } = timelineClipRange(object, scene.durationMs);
      const endMs = startMs + durationMs;
      if (atMs - startMs < MIN_CLIP_DURATION_MS || endMs - atMs < MIN_CLIP_DURATION_MS) return;
      const left = withTimelineClip(object, startMs, atMs - startMs);
      const right = withTimelineClip(
        { ...object, id: newObjId("clip") } as CourseObject,
        atMs,
        endMs - atMs,
        timelineLaneForObject(object),
        atMs - startMs,
      );
      commit(
        patchScene(project, currentSceneId, (currentScene) => ({
          ...currentScene,
          objects: currentScene.objects.flatMap((item) =>
            item.id === id ? [left, right] : [item],
          ),
        })),
      );
      set({ selectedTimelineClipId: right.id });
    },
    splitTimelineAt: (atMs) => {
      const state = get();
      const scene = state.project.scenes.find((s) => s.id === state.currentSceneId);
      if (!scene) return;
      const selected = scene.objects.find((object) => object.id === state.selectedTimelineClipId);
      const range = selected ? timelineClipRange(selected, scene.durationMs) : null;
      const clip =
        selected && range && atMs > range.startMs && atMs < range.startMs + range.durationMs
          ? selected
          : scene.objects.find((object) => {
              const objectRange = timelineClipRange(object, scene.durationMs);
              return atMs > objectRange.startMs && atMs < objectRange.startMs + objectRange.durationMs;
            });
      if (clip) get().splitTimelineClip(clip.id, atMs);
    },
    rippleDeleteTimelineClip: (id) => {
      const { project, currentSceneId } = get();
      const scene = project.scenes.find((s) => s.id === currentSceneId);
      const clip = scene?.objects.find((object) => object.id === id);
      if (!scene || !clip) return;
      const { startMs, durationMs } = timelineClipRange(clip, scene.durationMs);
      const endMs = startMs + durationMs;
      commit(
        patchScene(project, currentSceneId, (currentScene) => ({
          ...currentScene,
          objects: rippleObjects(
            currentScene.objects,
            startMs,
            endMs,
            scene.durationMs,
            id,
          ),
          durationMs: Math.max(500, currentScene.durationMs - durationMs),
        })),
      );
      set({ selectedTimelineClipId: null });
    },
    rippleDeleteGapAt: (atMs) => {
      const { project, currentSceneId } = get();
      const scene = project.scenes.find((s) => s.id === currentSceneId);
      if (!scene) return;
      const ranges = scene.objects
        .map((object) => {
          const range = timelineClipRange(object, scene.durationMs);
          return { startMs: range.startMs, endMs: range.startMs + range.durationMs };
        })
        .sort((a, b) => a.startMs - b.startMs);
      let endMs = 0;
      for (const range of ranges) {
        if (range.startMs > endMs && atMs >= endMs && atMs <= range.startMs) {
          commit(
            patchScene(project, currentSceneId, (currentScene) => ({
              ...currentScene,
              objects: rippleObjects(
                currentScene.objects,
                endMs,
                range.startMs,
                scene.durationMs,
              ),
              durationMs: Math.max(500, currentScene.durationMs - (range.startMs - endMs)),
            })),
          );
          return;
        }
        endMs = Math.max(endMs, range.endMs);
      }
      if (endMs < scene.durationMs && atMs >= endMs) {
        commit(
          patchScene(project, currentSceneId, (currentScene) => ({
            ...currentScene,
            objects: rippleObjects(
              currentScene.objects,
              endMs,
              scene.durationMs,
              scene.durationMs,
            ),
            durationMs: Math.max(500, currentScene.durationMs - (scene.durationMs - endMs)),
          })),
        );
      }
    },
    updateAudioMetadata: (id, patch) => {
      const { project, currentSceneId } = get();
      commit(
        patchObject(project, currentSceneId, id, (object) =>
          object.type === "audio"
            ? withAudioClipMetadata(object as AudioObject, patch)
            : object,
        ),
      );
    },
    addAudioVolumeKeyframe: (id, timeMs, decibels) => {
      const { project, currentSceneId } = get();
      const scene = project.scenes.find((item) => item.id === currentSceneId);
      if (!scene) return;
      commit(
        patchObject(project, currentSceneId, id, (object) => {
          if (object.type !== "audio") return object;
          const durationMs = (object.timing?.duration ?? scene.durationMs / 1000) * 1000;
          return addAudioVolumeKeyframe(
            object as AudioObject,
            timeMs,
            decibels,
            durationMs,
          );
        }),
      );
    },
    rippleDeleteAudioRegion: (startMs, endMs) => {
      const { project, currentSceneId } = get();
      const scene = project.scenes.find((item) => item.id === currentSceneId);
      if (!scene) return;
      const start = Math.max(0, Math.min(startMs, endMs));
      const end = Math.min(scene.durationMs, Math.max(startMs, endMs));
      const removedDuration = Math.max(0, end - start);
      commit(
        patchScene(project, currentSceneId, (current) => ({
          ...current,
          durationMs: Math.max(500, current.durationMs - removedDuration),
          objects: rippleDeleteRegion(
            current.objects,
            startMs,
            endMs,
            scene.durationMs,
          ),
        })),
      );
    },

    setCharAnimation: (id, a) => {
      const { project, currentSceneId } = get();
      commit(
        patchObject(project, currentSceneId, id, (o) => {
          const c = asCharacter(o);
          return c ? { ...c, characterAnimation: a } : o;
        }),
      );
    },
    setCharFacing: (id, f) => {
      const { project, currentSceneId } = get();
      commit(
        patchObject(project, currentSceneId, id, (o) => {
          const c = asCharacter(o);
          return c ? { ...c, facing: f } : o;
        }),
      );
    },
    setCharColors: (id, c) => {
      const { project, currentSceneId } = get();
      commit(
        patchObject(project, currentSceneId, id, (o) => {
          const ch = asCharacter(o);
          return ch ? { ...ch, colors: { ...(ch.colors ?? {}), ...c } } : o;
        }),
      );
    },
    addWaypoint: (id, w) => {
      const { project, currentSceneId } = get();
      commit(
        patchObject(project, currentSceneId, id, (o) => {
          const c = asCharacter(o);
          return c ? { ...c, path: [...(c.path ?? []), { ...w }] } : o;
        }),
      );
    },
    updateWaypoint: (id, idx, patch) => {
      const { project, currentSceneId } = get();
      commit(
        patchObject(project, currentSceneId, id, (o) => {
          const c = asCharacter(o);
          if (!c?.path?.[idx]) return o;
          const path = c.path.map((wp, i) => (i === idx ? { ...wp, ...patch } : wp));
          return { ...c, path };
        }),
      );
    },
    removeWaypoint: (id, idx) => {
      const { project, currentSceneId } = get();
      commit(
        patchObject(project, currentSceneId, id, (o) => {
          const c = asCharacter(o);
          if (!c?.path) return o;
          const path = c.path.filter((_, i) => i !== idx);
          const next = { ...c } as CharacterObject;
          if (path.length === 0) delete next.path;
          else next.path = path;
          return next;
        }),
      );
    },
    addSpeech: (id, s) => {
      const { project, currentSceneId } = get();
      commit(
        patchObject(project, currentSceneId, id, (o) => {
          const c = asCharacter(o);
          return c ? { ...c, speech: [...(c.speech ?? []), { ...s }] } : o;
        }),
      );
    },
    setCharacterVoice: (id, voiceId) => {
      const { project, currentSceneId } = get();
      commit(
        patchObject(project, currentSceneId, id, (object) => {
          if (object.type !== "character") return object;
          const meta = { ...studioMetadata(object) };
          if (voiceId === undefined) delete meta.voiceId;
          else meta.voiceId = voiceId;
          return {
            ...object,
            extensions: { ...object.extensions, [STUDIO_EXTENSION]: meta },
          } as CourseObject;
        }),
      );
    },
    updateSpeech: (id, lineId, patch) => {
      const { project, currentSceneId } = get();
      commit(
        patchObject(project, currentSceneId, id, (o) => {
          const c = asCharacter(o);
          if (!c?.speech) return o;
          return {
            ...c,
            speech: c.speech.map((s) => (s.id === lineId ? { ...s, ...patch } : s)),
          };
        }),
      );
    },
    removeSpeech: (id, lineId) => {
      const { project, currentSceneId } = get();
      commit(
        patchObject(project, currentSceneId, id, (o) => {
          const c = asCharacter(o);
          if (!c?.speech) return o;
          const speech = c.speech.filter((s) => s.id !== lineId);
          const next = { ...c } as CharacterObject;
          if (speech.length === 0) delete next.speech;
          else next.speech = speech;
          return next;
        }),
      );
    },

    setTts: (patch) => set((s) => ({ tts: { ...s.tts, ...patch } })),
  };
});

/** Currently selected scene + object (convenience selector). */
export function useCurrentScene(): VideoScene | undefined {
  const project = useStudioStore((s) => s.project);
  const currentSceneId = useStudioStore((s) => s.currentSceneId);
  return project.scenes.find((s) => s.id === currentSceneId);
}

export function useSelectedObject(): CourseObject | null {
  const scene = useCurrentScene();
  const selectedObjectId = useStudioStore((s) => s.selectedObjectId);
  return scene?.objects.find((o) => o.id === selectedObjectId) ?? null;
}
