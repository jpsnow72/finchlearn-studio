import { describe, expect, it } from "vitest";
import type { AudioObject, VideoProject, VideoScene } from "@finch-studio/core";
import { planAudioExport } from "@finch-studio/audio";
import {
  audioRoleForObject,
  getAudioClipMetadata,
  isDescriptionObject,
  withAudioClipMetadata,
} from "../audioEditing";
import {
  formatDescriptionTrackVtt,
  projectAudioClips,
  projectHasDescriptionTrack,
} from "../videoExport";

function audioClip(partial: Partial<AudioObject> & { id: string }): AudioObject {
  return {
    type: "audio",
    resource: `${partial.id}.wav`,
    volume: 1,
    timing: { start: 0, duration: 2 },
    ...partial,
  } as AudioObject;
}

const music = audioClip({ id: "music" });
const described = withAudioClipMetadata(
  audioClip({ id: "ad", timing: { start: 1, duration: 2 } }),
  { role: "description", descriptionText: "Maya waves at the camera." },
) as AudioObject;

function scene(objects: VideoScene["objects"]): VideoScene {
  return { id: "s1", name: "Scene 1", durationMs: 5000, transition: "cut", objects };
}

function projectWith(...objects: VideoScene["objects"]): VideoProject {
  return { id: "p", name: "Lesson", scenes: [scene(objects)] };
}

describe("audio description role metadata", () => {
  it("round trips role and description text through the clip metadata", () => {
    const meta = getAudioClipMetadata(described);
    expect(meta.role).toBe("description");
    expect(meta.descriptionText).toBe("Maya waves at the camera.");
    expect(audioRoleForObject(described)).toBe("description");
    expect(isDescriptionObject(described)).toBe(true);
  });

  it("rejects an unknown role and falls back to the lane convention", () => {
    const bogus = audioClip({
      id: "bogus",
      extensions: { "x-finch-studio": { role: "bogus" } },
    });
    expect(getAudioClipMetadata(bogus).role).toBeUndefined();
    expect(audioRoleForObject(bogus)).toBe("voice");
    expect(audioRoleForObject(bogus, "music")).toBe("music");
    expect(isDescriptionObject(music)).toBe(false);
  });

  it("survives a JSON round trip, the way the store persists projects", () => {
    const revived = JSON.parse(JSON.stringify(described)) as AudioObject;
    expect(isDescriptionObject(revived)).toBe(true);
    expect(getAudioClipMetadata(revived).descriptionText).toBe(
      "Maya waves at the camera.",
    );
  });
});

describe("audio description export planning from a real project", () => {
  it("maps project clips to engine clips with scene offsets and roles", () => {
    const project = projectWith(music, described);
    const clips = projectAudioClips(project);
    expect(clips.map((c) => [c.id, c.role, c.startMs, c.durationMs])).toEqual([
      ["music", "voice", 0, 2000],
      ["ad", "description", 1000, 2000],
    ]);
    expect(projectHasDescriptionTrack(project)).toBe(true);
    expect(projectHasDescriptionTrack(projectWith(music))).toBe(false);
  });

  it("mixed mode keeps AD in the mix; secondary mode takes it out and emits its VTT", () => {
    const project = projectWith(music, described);
    const clips = projectAudioClips(project);

    const mixed = planAudioExport(clips, "mixed");
    expect(mixed.mixedClips.map((c) => c.id)).toEqual(["music", "ad"]);
    expect(mixed.secondaryClips).toEqual([]);

    const secondary = planAudioExport(clips, "secondary");
    expect(secondary.mixedClips.map((c) => c.id)).toEqual(["music"]);
    expect(secondary.secondaryClips.map((c) => c.id)).toEqual(["ad"]);
    expect(secondary.descriptionVtt).toBe(
      "WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\nMaya waves at the camera.\n",
    );
    expect(formatDescriptionTrackVtt(project)).toBe(secondary.descriptionVtt);
    expect(formatDescriptionTrackVtt(projectWith(music))).toBeNull();
  });
});
