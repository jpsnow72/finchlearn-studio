/**
 * Custom character library (issue #74).
 *
 * User rigged characters persist through the editor's existing user
 * library storage: the same localStorage backed library the media
 * panel uses for uploads and scene groups, under its own key. Records
 * are the characters package shape (CustomCharacterDef), validated on
 * load by the package, so a character saved in one project opens intact
 * in any other project on this browser, and a corrupt record is dropped
 * instead of breaking the picker.
 *
 * Scene placement: a character object keeps a standard legacy
 * characterId (so every existing reader keeps working) and carries the
 * full custom def under its x-finch-studio extension. The def travels
 * with the project JSON, so an exported or shared project renders its
 * custom characters even where the library has never seen them.
 */
import type { CharacterObject, CourseObject } from "@finch-studio/core";
import {
  isValidCustomCharacterDef,
  parseCustomCharacterLibrary,
  type CustomCharacterDef,
} from "@finch-studio/characters";

export const CUSTOM_CHARACTERS_KEY = "finch-studio.user-characters";
export const STUDIO_EXTENSION = "x-finch-studio";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/** Load the saved custom characters from the user library. */
export function loadCustomCharacters(
  storage: StorageLike | null = defaultStorage(),
): CustomCharacterDef[] {
  if (!storage) return [];
  try {
    return parseCustomCharacterLibrary(storage.getItem(CUSTOM_CHARACTERS_KEY) ?? "[]");
  } catch {
    return [];
  }
}

/** Persist the custom character library. Returns false when storage refused. */
export function saveCustomCharacters(
  defs: CustomCharacterDef[],
  storage: StorageLike | null = defaultStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(CUSTOM_CHARACTERS_KEY, JSON.stringify(defs));
    return true;
  } catch {
    return false;
  }
}

/** Insert or replace a character in a library list, newest first. */
export function upsertCustomCharacter(
  defs: CustomCharacterDef[],
  def: CustomCharacterDef,
): CustomCharacterDef[] {
  return [def, ...defs.filter((d) => d.id !== def.id)];
}

/** The custom def carried by a scene object, when it is one. */
export function customDefOfObject(object: CourseObject): CustomCharacterDef | null {
  if (object.type !== "character") return null;
  const meta = object.extensions?.[STUDIO_EXTENSION];
  const def = meta?.customCharacterDef;
  return isValidCustomCharacterDef(def) ? def : null;
}

/** The custom character id referenced by a scene object, when it is one. */
export function customCharacterIdOfObject(object: CourseObject): string | null {
  const meta = object.extensions?.[STUDIO_EXTENSION];
  return typeof meta?.customCharacterId === "string" ? meta.customCharacterId : null;
}

/**
 * Stamp a character object as a custom character placement: legacy id
 * for compatibility, full def in the extension for rendering anywhere.
 */
export function withCustomCharacterDef<T extends CourseObject>(
  object: T,
  def: CustomCharacterDef,
): T {
  return {
    ...object,
    name: def.name,
    extensions: {
      ...object.extensions,
      [STUDIO_EXTENSION]: {
        ...(object.extensions?.[STUDIO_EXTENSION] ?? {}),
        customCharacterId: def.id,
        customCharacterDef: def,
      },
    },
  } as T;
}

export type { CustomCharacterDef };
export type CustomCharacterObject = CharacterObject;
