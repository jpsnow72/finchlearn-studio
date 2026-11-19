/**
 * RoughCutPanel: text based rough cut (issue #45). For each audio or
 * video clip in the scene, a ready transcript is shown as sentences
 * with their words; deleting a sentence, or a selected range of words,
 * ripple deletes that media from the clip through the store, as one
 * undoable edit per deletion. Clips without a ready transcript show a
 * short explanation instead: the surface is unavailable for them,
 * never an error. Styling reuses the existing panel classes only.
 */
import { useState } from "react";
import {
  roughCutAvailability,
  sentencesForClip,
  type ClipTranscript,
} from "../roughCut";
import { useStudioStore, useCurrentScene } from "../store";

interface WordSelection {
  start: number;
  end: number;
}

export function RoughCutPanel() {
  const scene = useCurrentScene();
  const deleteTranscriptWords = useStudioStore((s) => s.deleteTranscriptWords);
  const deleteTranscriptSentence = useStudioStore((s) => s.deleteTranscriptSentence);
  const [selections, setSelections] = useState<Record<string, WordSelection | null>>({});

  const clips = (scene?.objects ?? []).filter(
    (o) => o.type === "audio" || o.type === "video",
  );

  const pickWord = (clipId: string, wordIndex: number) => {
    setSelections((current) => {
      const selection = current[clipId];
      // First click (or a click at or before the current start) starts
      // a new selection; a later click extends it to that word.
      if (!selection || wordIndex <= selection.start) {
        return { ...current, [clipId]: { start: wordIndex, end: wordIndex } };
      }
      return { ...current, [clipId]: { start: selection.start, end: wordIndex } };
    });
  };

  return (
    <div className="panel">
      <div className="panel-title">Rough cut</div>
      {clips.length === 0 && (
        <p className="muted">No audio or video clips in this scene yet.</p>
      )}
      {clips.map((clip) => {
        const availability = roughCutAvailability(clip);
        if (!availability.available) {
          return (
            <div key={clip.id} className="audio-clip">
              <div className="audio-clip-name">{clip.name ?? "Clip"}</div>
              <p className="muted">{availability.message}</p>
            </div>
          );
        }
        const transcript: ClipTranscript = availability.transcript;
        const sentences = sentencesForClip(transcript, clip, scene?.durationMs ?? 0);
        const selection = selections[clip.id] ?? null;
        const selectedCount = selection ? selection.end - selection.start + 1 : 0;
        return (
          <div key={clip.id} className="audio-clip">
            <div className="audio-clip-name">{clip.name ?? "Clip"}</div>
            {sentences.length === 0 && (
              <p className="muted">No spoken sentences in the part of this clip on the timeline.</p>
            )}
            {sentences.map((sentence) => (
              <div key={sentence.wordStartIndex} className="rough-cut-sentence">
                <p>
                  {transcript.words
                    .slice(sentence.wordStartIndex, sentence.wordEndIndex)
                    .map((word, offset) => {
                      const wordIndex = sentence.wordStartIndex + offset;
                      const selected =
                        selection !== null &&
                        wordIndex >= selection.start &&
                        wordIndex <= selection.end;
                      return (
                        <button
                          key={wordIndex}
                          type="button"
                          className={selected ? "active" : ""}
                          aria-pressed={selected}
                          onClick={() => pickWord(clip.id, wordIndex)}
                        >
                          {word.word}
                        </button>
                      );
                    })}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    deleteTranscriptSentence(clip.id, sentence.index);
                    setSelections((current) => ({ ...current, [clip.id]: null }));
                  }}
                >
                  Delete sentence
                </button>
              </div>
            ))}
            {sentences.length > 0 && (
              <div className="audio-kf-row">
                <button
                  type="button"
                  disabled={!selection}
                  onClick={() => {
                    if (!selection) return;
                    deleteTranscriptWords(clip.id, selection.start, selection.end + 1);
                    setSelections((current) => ({ ...current, [clip.id]: null }));
                  }}
                >
                  {selection
                    ? `Delete selected words (${selectedCount})`
                    : "Delete selected words"}
                </button>
                <p className="muted">Click a word, then a later word, to select a range.</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
