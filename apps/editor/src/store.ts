/**
 * Video Studio store — project state for the standalone app.
 *
 * Scenes hold inline CourseObjects (characters, text, shapes, images).
 * All mutations are plain zustand set() — no undo in the MVP.
 */
import { create } from "zustand";
import type {
  CharacterAnimationName,
  CharacterColors,
  CharacterFacing,
  CharacterId,
  CharacterObject,
  CharacterSpeech,
  CharacterWaypoint,
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

let objCounter = 0;
function newObjId(prefix: string): string {
  objCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${objCounter}`;
}

export function makeStudioCharacter(characterId: CharacterId): CharacterObject {
  return {
    id: newObjId("ch"),
    type: "character",
    name: characterId,
    position: { x: 200 + objCounter * 40, y: 200, w: 140, h: 280 },
    characterId,
    characterAnimation: "idle",
    facing: "right",
  };
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

interface VideoStudioState {
  project: VideoProject;
  currentSceneId: string;
  selectedObjectId: string | null;
  tts: TtsSettings;
  embedObjectId: string | null;

  // project
  newProject: () => void;
  setProjectName: (name: string) => void;
  // scenes
  addScene: () => void;
  duplicateScene: (id: string) => void;
  removeScene: (id: string) => void;
  renameScene: (id: string, name: string) => void;
  setSceneTransition: (id: string, t: VideoSceneTransition) => void;
  moveScene: (id: string, dir: -1 | 1) => void;
  moveSceneTo: (id: string, index: number) => void;
  selectScene: (id: string) => void;
  // objects
  selectObject: (id: string | null) => void;
  addObject: (obj: CourseObject) => void;
  updateObject: (id: string, patch: Partial<CourseObject>) => void;
  removeObject: (id: string) => void;
  moveObject: (id: string, dir: -1 | 1) => void;
  // characters
  setCharAnimation: (id: string, a: CharacterAnimationName) => void;
  setCharFacing: (id: string, f: CharacterFacing) => void;
  setCharColors: (id: string, c: CharacterColors) => void;
  addWaypoint: (id: string, w: CharacterWaypoint) => void;
  updateWaypoint: (id: string, idx: number, patch: Partial<CharacterWaypoint>) => void;
  removeWaypoint: (id: string, idx: number) => void;
  addSpeech: (id: string, s: CharacterSpeech) => void;
  updateSpeech: (id: string, lineId: string, patch: Partial<CharacterSpeech>) => void;
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

function deriveProjectDurations(project: VideoProject): VideoProject {
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

export const useStudioStore = create<VideoStudioState>()((set, get) => {
  const initial = deriveProjectDurations(loadStored() ?? makeVideoProject("Untitled video"));
  const params =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search)
      : null;
  const embedObjectId: string | null = params?.get("embed") ?? null;

  const commit = (project: VideoProject) => {
    const derivedProject = deriveProjectDurations(project);
    persist(derivedProject);
    set({ project: derivedProject });
  };

  return {
    project: initial,
    currentSceneId: initial.scenes[0]?.id ?? "",
    selectedObjectId: null,
    tts: { voiceId: undefined, rate: 1, pitch: 1 },
    embedObjectId,

    newProject: () => {
      const project = makeVideoProject("Untitled video");
      persist(project);
      set({
        project,
        currentSceneId: project.scenes[0].id,
        selectedObjectId: null,
      });
    },
    setProjectName: (name) => commit({ ...get().project, name }),

    addScene: () => {
      const { project } = get();
      const scene = makeVideoScene(`Scene ${project.scenes.length + 1}`);
      commit({ ...project, scenes: [...project.scenes, scene] });
      set({ currentSceneId: scene.id });
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
      commit({ ...project, scenes });
      set({ currentSceneId: duplicate.id, selectedObjectId: null });
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
        });
      }
    },
    renameScene: (id, name) =>
      commit(patchScene(get().project, id, (s) => ({ ...s, name }))),
    setSceneTransition: (id, t) =>
      commit(patchScene(get().project, id, (s) => ({ ...s, transition: t }))),
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
    selectScene: (id) => set({ currentSceneId: id, selectedObjectId: null }),

    selectObject: (id) => set({ selectedObjectId: id }),
    addObject: (obj) => {
      const { project, currentSceneId } = get();
      commit(
        patchScene(project, currentSceneId, (s) => ({
          ...s,
          objects: [...s.objects, obj],
        })),
      );
      set({ selectedObjectId: obj.id });
    },
    updateObject: (id, patch) => {
      const { project, currentSceneId } = get();
      commit(
        patchObject(project, currentSceneId, id, (o) => ({ ...o, ...patch }) as CourseObject),
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
      if (get().selectedObjectId === id) set({ selectedObjectId: null });
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
