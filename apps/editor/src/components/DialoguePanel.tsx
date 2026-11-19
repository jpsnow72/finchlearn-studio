/**
 * DialoguePanel — production narration voices.
 *
 * Each character in the scene gets a voice from the FinchLearn
 * catalogue (Basic = Kokoro, self-hosted; Premium = Google, needs
 * sign-in). "Generate narration" renders every line with the real
 * service and caches it (IndexedDB): playback and export then use the
 * generated audio, and each line's duration is set to the measured
 * audio length so bubbles, lip sync and the timeline match the speech.
 * The free browser voice remains as a per-character fallback option.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CharacterObject } from "@finch-studio/core";
import { VOICE_CATALOGUE, voiceById } from "@finch-studio/audio";
import { useStudioStore, useCurrentScene, characterVoiceId } from "../store";
import { ensureLineAudio, hasCachedLineAudio, lineAudioUrl } from "../narration";
import { narrationTts } from "../narrationProvider";

interface LineRef {
  character: CharacterObject;
  lineId: string;
  text: string;
  voiceId: string;
}

export function DialoguePanel() {
  const scene = useCurrentScene();
  const setCharacterVoice = useStudioStore((s) => s.setCharacterVoice);
  const updateSpeech = useStudioStore((s) => s.updateSpeech);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [generated, setGenerated] = useState<Record<string, boolean>>({});

  const characters = useMemo(
    () => (scene?.objects.filter((o) => o.type === "character") as CharacterObject[] | undefined) ?? [],
    [scene],
  );

  const lines: LineRef[] = useMemo(
    () =>
      characters.flatMap((c) =>
        (c.speech ?? []).map((l) => ({
          character: c,
          lineId: l.id,
          text: l.text,
          voiceId: characterVoiceId(c),
        })),
      ),
    [characters],
  );

  const refreshStatus = useCallback(async () => {
    const out: Record<string, boolean> = {};
    for (const l of lines) {
      out[l.lineId] = l.voiceId ? await hasCachedLineAudio(l.text, l.voiceId) : false;
    }
    setGenerated(out);
  }, [lines]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  // Speech preview from the Properties speech editor: play the real
  // generated audio when the selected character has a production voice.
  useEffect(() => {
    const onPreview = (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      const selected = useStudioStore.getState().selectedObjectId;
      const c = characters.find((x) => x.id === selected) ?? characters[0];
      const voiceId = c ? characterVoiceId(c) : "";
      if (c && voiceId) {
        narrationTts.speak(text, { voiceId });
      } else {
        narrationTts.speak(text, {});
      }
    };
    window.addEventListener("ocf:preview-line", onPreview);
    return () => window.removeEventListener("ocf:preview-line", onPreview);
  }, [characters]);

  const generateAll = async () => {
    if (busy || lines.length === 0) return;
    setBusy(true);
    let done = 0;
    let failed = 0;
    for (const l of lines) {
      if (!l.voiceId) continue;
      try {
        const { durationSec } = await ensureLineAudio(l.text, l.voiceId);
        updateSpeech(l.character.id, l.lineId, {
          duration: Math.max(600, Math.round(durationSec * 1000)),
        });
        done++;
      } catch {
        failed++;
      }
      setStatus(`Generating narration… ${done + failed}/${lines.length}`);
    }
    setBusy(false);
    setStatus(
      failed === 0
        ? `Narration ready: ${done} line(s) generated and cached.`
        : `Generated ${done} line(s); ${failed} failed. Premium voices need sign-in; check the line and retry.`,
    );
    void refreshStatus();
  };

  const previewLine = async (l: LineRef) => {
    if (!l.voiceId) {
      narrationTts.speak(l.text, {});
      return;
    }
    try {
      const url = await lineAudioUrl(l.text, l.voiceId);
      const el = new Audio(url);
      void el.play();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    }
  };

  const basic = VOICE_CATALOGUE.filter((v) => v.tier === "basic" && !v.avoid);
  const premium = VOICE_CATALOGUE.filter((v) => v.tier === "premium");

  return (
    <div className="panel dialogue-panel">
      <div className="panel-title">🔊 Dialogue voice</div>
      {characters.length === 0 && <p className="muted">Add a character to assign voices.</p>}
      {characters.map((c) => {
        const voice = characterVoiceId(c);
        const info = voice ? voiceById(voice) : undefined;
        return (
          <label key={c.id} className="field">
            <span>
              {c.name}
              {info ? ` · ${info.accent} ${info.gender}` : ""}
            </span>
            <select
              value={voice}
              onChange={(e) => setCharacterVoice(c.id, e.target.value)}
            >
              <option value="">Browser voice (free, varies by device)</option>
              <optgroup label="Basic voices (Kokoro)">
                {basic.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} · {v.accent} {v.gender}
                  </option>
                ))}
              </optgroup>
              <optgroup label="Premium voices (Google)">
                {premium.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} · {v.accent} {v.gender}
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
        );
      })}
      {lines.length > 0 && (
        <>
          <button type="button" className="primary" onClick={() => void generateAll()} disabled={busy}>
            {busy ? "Generating…" : `Generate narration (${lines.length} line${lines.length === 1 ? "" : "s"})`}
          </button>
          <ul className="narration-lines">
            {lines.map((l) => (
              <li key={l.lineId}>
                <button type="button" onClick={() => void previewLine(l)} title="Preview line">
                  ▶
                </button>
                <span className="narration-line-text">{l.text}</span>
                <span className="narration-line-state">
                  {!l.voiceId ? "browser" : generated[l.lineId] ? "✓ ready" : "not generated"}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {status && (
        <p className="muted" role="status">
          {status}
        </p>
      )}
      <p className="muted small">
        Exports generate any missing narration automatically and mix it into the video.
      </p>
    </div>
  );
}
