// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it } from "vitest";
import type { AudioObject, CourseObject, VideoObject } from "@finch-studio/core";
import { getAudioClipMetadata } from "../audioEditing";
import {
  applyTranscriptSentenceDeletion,
  applyTranscriptWordDeletion,
  getObjectTranscript,
  roughCutAvailability,
  sentencesForClip,
  sentencesFromTranscript,
  wordRangeToSceneRange,
  type ClipTranscript,
} from "../roughCut";
import { RoughCutPanel } from "../components/RoughCutPanel";
import { useStudioStore } from "../store";

const transcript: ClipTranscript = {
  version: 1,
  status: "ready",
  clipId: "voice-clip",
  contentHash: "hash-1",
  engine: "whisper-api",
  durationMs: 4000,
  words: [
    { word: "Hello", startMs: 0, endMs: 400 },
    { word: "world.", startMs: 400, endMs: 900 },
    { word: "This", startMs: 1000, endMs: 1400 },
    { word: "is", startMs: 1400, endMs: 1600 },
    { word: "a", startMs: 1600, endMs: 1800 },
    { word: "test.", startMs: 1800, endMs: 2400 },
    { word: "Delete", startMs: 2500, endMs: 2900 },
    { word: "me", startMs: 2900, endMs: 3200 },
    { word: "now.", startMs: 3200, endMs: 3800 },
  ],
  segments: [
    { id: "s1", startMs: 0, endMs: 900, text: "Hello world.", wordStartIndex: 0, wordEndIndex: 2 },
    { id: "s2", startMs: 1000, endMs: 2400, text: "This is a test.", wordStartIndex: 2, wordEndIndex: 6 },
    { id: "s3", startMs: 2500, endMs: 3800, text: "Delete me now.", wordStartIndex: 6, wordEndIndex: 9 },
  ],
  text: "Hello world. This is a test. Delete me now.",
  updatedAt: "2026-11-19T00:00:00.000Z",
};

function makeAudio(extra: Partial<AudioObject> = {}): AudioObject {
  return {
    id: "voice-clip",
    type: "audio",
    name: "Voice clip",
    resource: "voice.wav",
    timing: { start: 0, duration: 4 },
    extensions: {
      "x-finch-studio": {
        waveformPeaks: [0.2, 0.5, 0.8, 0.3, 0.6, 0.4, 0.7, 0.2],
        fadeInMs: 100,
        fadeOutMs: 100,
        transcript,
      },
    },
    ...extra,
  };
}

function makeVideo(extra: Partial<VideoObject> = {}): VideoObject {
  return {
    id: "footage",
    type: "video",
    name: "Footage",
    resource: "footage.mp4",
    timing: { start: 0, duration: 4 },
    extensions: { "x-finch-studio": { transcript: { ...transcript, clipId: "footage" } } },
    ...extra,
  };
}

const laterText: CourseObject = {
  id: "title",
  type: "text",
  content: "Later",
  timing: { start: 4.5, duration: 0.5 },
};

describe("rough cut sentence segmentation", () => {
  it("splits a contract shaped transcript into sentences with word ranges and source times", () => {
    const sentences = sentencesFromTranscript(transcript);
    expect(sentences.map((s) => s.text)).toEqual([
      "Hello world.",
      "This is a test.",
      "Delete me now.",
    ]);
    expect(sentences.map((s) => [s.wordStartIndex, s.wordEndIndex])).toEqual([
      [0, 2],
      [2, 6],
      [6, 9],
    ]);
    expect(sentences.map((s) => [s.startMs, s.endMs])).toEqual([
      [0, 900],
      [1000, 2400],
      [2500, 3800],
    ]);
  });

  it("does not split on abbreviations and keeps a trailing fragment as a sentence", () => {
    const abbrev: ClipTranscript = {
      ...transcript,
      words: [
        { word: "Dr.", startMs: 0, endMs: 300 },
        { word: "Smith", startMs: 300, endMs: 700 },
        { word: "left.", startMs: 700, endMs: 1200 },
        { word: "Then", startMs: 1300, endMs: 1600 },
        { word: "silence", startMs: 1600, endMs: 2100 },
      ],
    };
    expect(sentencesFromTranscript(abbrev).map((s) => s.text)).toEqual([
      "Dr. Smith left.",
      "Then silence",
    ]);
  });
});

describe("rough cut word range mapping", () => {
  it("maps a word range to scene times through the clip start and source offset", () => {
    const clip = makeAudio({
      timing: { start: 1, duration: 4 },
      extensions: {
        "x-finch-studio": { sourceOffsetMs: 500, transcript },
      },
    });
    // getAudioClipMetadata reads sourceOffsetMs from the same record.
    expect(getAudioClipMetadata(clip).sourceOffsetMs).toBe(500);
    expect(wordRangeToSceneRange(transcript, clip, 2, 6, 8000)).toEqual({
      startMs: 1500,
      endMs: 2900,
      sourceStartMs: 1000,
      sourceEndMs: 2400,
      removedMs: 1400,
    });
  });

  it("clamps a range that runs past the clip end to the visible window", () => {
    const clip = makeAudio({ timing: { start: 0, duration: 2 } });
    expect(wordRangeToSceneRange(transcript, clip, 2, 9, 5000)).toEqual({
      startMs: 1000,
      endMs: 2000,
      sourceStartMs: 1000,
      sourceEndMs: 2000,
      removedMs: 1000,
    });
  });

  it("clamps a range that starts before the clip trim point", () => {
    const clip = makeAudio({
      timing: { start: 0, duration: 1 },
      extensions: { "x-finch-studio": { sourceOffsetMs: 3000, transcript } },
    });
    expect(wordRangeToSceneRange(transcript, clip, 6, 9, 5000)).toEqual({
      startMs: 0,
      endMs: 800,
      sourceStartMs: 3000,
      sourceEndMs: 3800,
      removedMs: 800,
    });
  });

  it("returns null for ranges outside the visible window and for empty ranges", () => {
    const clip = makeAudio({ timing: { start: 0, duration: 2 } });
    expect(wordRangeToSceneRange(transcript, clip, 6, 9, 5000)).toBeNull();
    expect(wordRangeToSceneRange(transcript, clip, 3, 3, 5000)).toBeNull();
    expect(wordRangeToSceneRange(transcript, clip, 5, 2, 5000)).toBeNull();
  });
});

describe("rough cut application", () => {
  it("ripple deletes a sentence from an audio clip, splits it, and closes the gap", () => {
    const result = applyTranscriptSentenceDeletion(
      [makeAudio(), laterText],
      "voice-clip",
      1,
      5000,
    );
    expect(result?.removedMs).toBe(1400);
    const audio = (result?.objects ?? []).filter(
      (o): o is AudioObject => o.type === "audio",
    );
    expect(audio.map((o) => o.timing)).toEqual([
      { start: 0, duration: 1 },
      { start: 1, duration: 1.6 },
    ]);
    expect(getAudioClipMetadata(audio[1]).sourceOffsetMs).toBe(2400);
    expect(result?.objects.find((o) => o.id === "title")?.timing?.start).toBe(3.1);
    // The transcript survives on both pieces, with source times intact.
    expect(audio.map((o) => getObjectTranscript(o)?.clipId)).toEqual([
      "voice-clip",
      "voice-clip",
    ]);
    // Each piece lists only the sentences it still contains.
    expect(sentencesForClip(transcript, audio[0], 5000).map((s) => s.text)).toEqual([
      "Hello world.",
    ]);
    expect(sentencesForClip(transcript, audio[1], 5000).map((s) => s.text)).toEqual([
      "Delete me now.",
    ]);
  });

  it("ripple deletes a word range from video footage and advances its source in", () => {
    const result = applyTranscriptWordDeletion(
      [makeVideo(), laterText],
      "footage",
      2,
      6,
      5000,
    );
    expect(result?.removedMs).toBe(1400);
    const video = (result?.objects ?? []).filter(
      (o): o is VideoObject => o.type === "video",
    );
    expect(video.map((o) => o.timing)).toEqual([
      { start: 0, duration: 1 },
      { start: 1, duration: 1.6 },
    ]);
    expect(video[1].extensions?.["x-finch-studio"]?.sourceInMs).toBe(2400);
    expect(getObjectTranscript(video[1])?.clipId).toBe("footage");
    expect(result?.objects.find((o) => o.id === "title")?.timing?.start).toBe(3.1);
  });

  it("deleting the first sentence of footage leaves one piece starting at the cut", () => {
    const result = applyTranscriptSentenceDeletion([makeVideo()], "footage", 0, 5000);
    const video = (result?.objects ?? []).filter(
      (o): o is VideoObject => o.type === "video",
    );
    expect(video).toHaveLength(1);
    expect(video[0].timing).toEqual({ start: 0, duration: 3.1 });
    expect(video[0].extensions?.["x-finch-studio"]?.sourceInMs).toBe(900);
  });

  it("no-ops for clips without a ready transcript and for out of window ranges", () => {
    const plain = makeAudio({
      id: "plain",
      extensions: { "x-finch-studio": { waveformPeaks: [0.1] } },
    });
    expect(applyTranscriptWordDeletion([plain], "plain", 0, 2, 5000)).toBeNull();
    const queued = makeAudio({
      extensions: {
        "x-finch-studio": {
          transcript: { ...transcript, status: "queued", words: [] },
        },
      },
    });
    expect(applyTranscriptSentenceDeletion([queued], "voice-clip", 0, 5000)).toBeNull();
    const short = makeAudio({ timing: { start: 0, duration: 2 } });
    expect(applyTranscriptWordDeletion([short], "voice-clip", 6, 9, 5000)).toBeNull();
  });
});

describe("rough cut availability", () => {
  it("explains each non-ready state and never treats it as an error", () => {
    const none = roughCutAvailability(makeAudio({ extensions: {} }));
    expect(none.available).toBe(false);
    if (!none.available) {
      expect(none.status).toBe("none");
      expect(none.message).toContain("has not been transcribed yet");
    }
    const queued = roughCutAvailability(
      makeAudio({
        extensions: {
          "x-finch-studio": { transcript: { ...transcript, status: "queued", words: [] } },
        },
      }),
    );
    expect(queued.available).toBe(false);
    if (!queued.available) expect(queued.message).toContain("queued");
    const failed = roughCutAvailability(
      makeAudio({
        extensions: {
          "x-finch-studio": {
            transcript: { ...transcript, status: "failed", words: [], error: "Engine timed out." },
          },
        },
      }),
    );
    expect(failed.available).toBe(false);
    if (!failed.available) {
      expect(failed.message).toContain("Transcription failed");
      expect(failed.message).toContain("Engine timed out.");
    }
    expect(roughCutAvailability(makeAudio()).available).toBe(true);
  });
});

describe("rough cut store actions", () => {
  it("deletes a sentence as one commit and undo restores the clip exactly", () => {
    const store = useStudioStore.getState();
    store.newProject();
    store.addObject(makeAudio());
    const before = JSON.parse(
      JSON.stringify(useStudioStore.getState().project.scenes[0]),
    ) as { objects: CourseObject[]; durationMs: number };
    const pastBefore = useStudioStore.getState().pastProjects.length;

    store.deleteTranscriptSentence("voice-clip", 0);
    const state = useStudioStore.getState();
    expect(state.pastProjects.length).toBe(pastBefore + 1);
    const scene = state.project.scenes[0];
    expect(scene.durationMs).toBe(3100);
    expect(scene.objects).toHaveLength(1);
    expect(scene.objects[0].timing).toEqual({ start: 0, duration: 3.1 });
    expect(getAudioClipMetadata(scene.objects[0] as AudioObject).sourceOffsetMs).toBe(900);

    store.undo();
    const restored = useStudioStore.getState().project.scenes[0];
    expect(restored.objects).toEqual(before.objects);
    expect(restored.durationMs).toBe(before.durationMs);
  });

  it("deletes a selected word range through the store", () => {
    const store = useStudioStore.getState();
    store.newProject();
    store.addObject(makeAudio());
    store.deleteTranscriptWords("voice-clip", 6, 9);
    const scene = useStudioStore.getState().project.scenes[0];
    expect(scene.objects).toHaveLength(1);
    expect(scene.objects[0].timing).toEqual({ start: 0, duration: 2.5 });
    expect(scene.durationMs).toBe(2500);
  });

  it("adds no undo step for a clip with no transcript", () => {
    const store = useStudioStore.getState();
    store.newProject();
    const plain = makeAudio({ id: "plain", extensions: {} });
    store.addObject(plain);
    const pastBefore = useStudioStore.getState().pastProjects.length;
    store.deleteTranscriptSentence("plain", 0);
    store.deleteTranscriptWords("plain", 0, 2);
    const state = useStudioStore.getState();
    expect(state.pastProjects.length).toBe(pastBefore);
    expect(state.project.scenes[0].objects).toEqual([plain]);
  });
});

describe("RoughCutPanel", () => {
  function renderPanel() {
    const container = document.createElement("div");
    document.body.append(container);
    let root: Root;
    act(() => {
      root = createRoot(container);
      root.render(<RoughCutPanel />);
    });
    return { container, root: root! };
  }

  it("shows an explanation and no delete controls for a clip with no transcript", () => {
    useStudioStore.getState().newProject();
    useStudioStore.getState().addObject(makeAudio({ id: "plain", extensions: {} }));
    const { container, root } = renderPanel();
    expect(container.textContent).toContain("Rough cut needs a transcript.");
    expect(container.textContent).toContain("has not been transcribed yet");
    const deleteButtons = Array.from(container.querySelectorAll("button")).filter((b) =>
      b.textContent?.startsWith("Delete"),
    );
    expect(deleteButtons).toHaveLength(0);
    act(() => root.unmount());
    container.remove();
  });

  it("lists sentences for a transcribed clip and deletes a selected word range", () => {
    useStudioStore.getState().newProject();
    useStudioStore.getState().addObject(makeAudio());
    const { container, root } = renderPanel();
    const deleteSentenceButtons = Array.from(container.querySelectorAll("button")).filter(
      (b) => b.textContent === "Delete sentence",
    );
    expect(deleteSentenceButtons).toHaveLength(3);
    expect(container.textContent).toContain("Hello");
    expect(container.textContent).toContain("test.");

    const wordButton = (text: string) =>
      Array.from(container.querySelectorAll("button")).find((b) => b.textContent === text);
    act(() => wordButton("This")?.click());
    act(() => wordButton("test.")?.click());
    const deleteWords = Array.from(container.querySelectorAll("button")).find((b) =>
      b.textContent?.startsWith("Delete selected words"),
    );
    expect(deleteWords?.textContent).toContain("(4)");
    act(() => deleteWords?.click());

    const scene = useStudioStore.getState().project.scenes[0];
    const audio = scene.objects.filter((o): o is AudioObject => o.type === "audio");
    expect(audio.map((o) => o.timing)).toEqual([
      { start: 0, duration: 1 },
      { start: 1, duration: 1.6 },
    ]);
    act(() => root.unmount());
    container.remove();
  });
});
