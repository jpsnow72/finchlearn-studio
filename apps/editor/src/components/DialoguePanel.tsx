/**
 * DialoguePanel — text-to-speech voice settings.
 *
 * Browser SpeechSynthesis is the default provider: free, no key, no backend.
 * The `TtsProvider` interface (in @finch-studio/animation) lets paid providers
 * (ElevenLabs/Google) slot in later without touching this UI.
 */
import { useEffect, useState } from "react";
import { browserTts, type SpeakOptions, type TtsVoice } from "@finch-studio/animation";
import { useStudioStore } from "../store";

export function DialoguePanel() {
  const tts = useStudioStore((s) => s.tts);
  const setTts = useStudioStore((s) => s.setTts);
  const [voices, setVoices] = useState<TtsVoice[]>([]);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    if (!browserTts.isAvailable) return;
    const refresh = () => {
      void browserTts.voices().then(setVoices);
    };
    refresh();
    const synth = window.speechSynthesis;
    synth.addEventListener("voiceschanged", refresh);
    const onPreview = (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      browserTts.stop();
      const opts: SpeakOptions = {
        rate: tts.rate,
        pitch: tts.pitch,
        onEnd: () => setSpeaking(false),
      };
      if (tts.voiceId !== undefined) opts.voiceId = tts.voiceId;
      browserTts.speak(text, opts);
      setSpeaking(true);
    };
    window.addEventListener("ocf:preview-line", onPreview);
    return () => {
      window.removeEventListener("ocf:preview-line", onPreview);
      synth.removeEventListener("voiceschanged", refresh);
    };
  }, []);

  if (!browserTts.isAvailable) {
    return (
      <div className="panel dialogue-panel">
        <div className="panel-title">🔊 Dialogue voice</div>
        <p className="muted">
          Speech synthesis isn't available in this browser — dialogue lines
          will show as bubbles only.
        </p>
      </div>
    );
  }

  return (
    <div className="panel dialogue-panel">
      <div className="panel-title">🔊 Dialogue voice</div>
      <label className="field">
        <span>Voice</span>
        <select
          value={tts.voiceId ?? ""}
          onChange={(e) => setTts({ voiceId: e.target.value || undefined })}
        >
          <option value="">Default</option>
          {voices.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name} ({v.lang})
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Rate: {tts.rate.toFixed(1)}×</span>
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.1}
          value={tts.rate}
          onChange={(e) => setTts({ rate: parseFloat(e.target.value) })}
        />
      </label>
      <label className="field">
        <span>Pitch: {tts.pitch.toFixed(1)}</span>
        <input
          type="range"
          min={0.5}
          max={2}
          step={0.1}
          value={tts.pitch}
          onChange={(e) => setTts({ pitch: parseFloat(e.target.value) })}
        />
      </label>
      <div className="field-row">
        <button
          type="button"
          onClick={() => {
            browserTts.stop();
            setSpeaking(false);
          }}
          disabled={!speaking}
        >
          ⏹ Stop
        </button>
        <span className="muted">
          {speaking ? "Speaking…" : `${voices.length} voices`}
        </span>
      </div>
      <p className="muted small">
        Free browser TTS — no key needed. Premium voices can plug into the same
        interface later.
      </p>
    </div>
  );
}
