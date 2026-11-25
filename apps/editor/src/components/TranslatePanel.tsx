/**
 * TranslatePanel — create a translated variant of the open project
 * (issue #54, widened by G-8, issue #123). Pick from the full offered
 * language set, optionally override the mapped voice per character,
 * and the panel builds a full variant project (translated text,
 * re-voiced dialogue, translated captions) and opens it. The original
 * project is never changed.
 *
 * Honest states: when translation is not configured the panel says so
 * up front and the create button stays disabled; languages the chain
 * can only carry partially (text and captions, no narration voice) are
 * marked in the picker and explained when selected, never silently
 * degraded; characters with no voice in the target language are
 * reported by name after creation so a voice can be assigned in the
 * Dialogue panel.
 */
import { useMemo, useState } from "react";
import type { CharacterObject } from "@finch-studio/core";
import {
  mapVoiceForLanguage,
  supportedLanguages,
  voicesForLanguage,
  type VariantReport,
} from "@finch-studio/translation";
import { useStudioStore, characterVoiceId } from "../store";
import { buildTranslatedVariant, translationConfigured } from "../translation";

export function TranslatePanel() {
  const project = useStudioStore((s) => s.project);
  const loadProject = useStudioStore((s) => s.loadProject);
  const [target, setTarget] = useState("es");
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [report, setReport] = useState<VariantReport | null>(null);
  const configured = translationConfigured();

  const characters = useMemo(() => {
    const seen = new Map<string, CharacterObject>();
    for (const scene of project.scenes) {
      for (const object of scene.objects) {
        if (object.type === "character" && !seen.has(object.id)) {
          seen.set(object.id, object as CharacterObject);
        }
      }
    }
    return [...seen.values()];
  }, [project]);

  const targetVoices = useMemo(() => voicesForLanguage(target), [target]);
  const languageOptions = useMemo(() => supportedLanguages(), []);
  const targetInfo = languageOptions.find((s) => s.language.code === target);

  const create = async () => {
    if (busy || !configured) return;
    setBusy(true);
    setReport(null);
    setStatus("Translating text and re-voicing dialogue. This can take a moment.");
    try {
      const voiceOverrides: Record<string, string | null> = {};
      for (const [id, value] of Object.entries(overrides)) {
        if (value === "auto") continue;
        voiceOverrides[id] = value === "none" ? null : value;
      }
      const { project: variant, report: created } = await buildTranslatedVariant(
        project,
        target,
        voiceOverrides,
      );
      setReport(created);
      loadProject(variant);
      setStatus(
        `Variant created and opened. The original project was not changed. ` +
          `${created.stringsTranslated} strings translated, ${created.linesRevoiced} line(s) re-voiced, ` +
          `captions ready in the variant language.`,
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const unvoiced = report?.characters.filter((c) => !c.mapping.voiceId) ?? [];

  return (
    <div className="panel translate-panel">
      <div className="panel-title">🌐 Translate project</div>
      <p className="muted small">
        Creates a translated copy of this project in the language you pick:
        on-screen text, dialogue re-voiced in the new language, and captions
        in that language. The original stays as it is.
      </p>
      {!configured && (
        <p className="muted" role="status">
          Translation is not configured on this build. An administrator needs
          to set the VITE_GOOGLE_TRANSLATE_API_KEY build secret before
          variants can be created.
        </p>
      )}
      <label className="field">
        <span>Target language</span>
        <select value={target} onChange={(e) => setTarget(e.target.value)}>
          {languageOptions.map(({ language: l, support }) => (
            <option key={l.code} value={l.code}>
              {l.name} · {l.nativeName}
              {l.direction === "rtl" ? " · right-to-left" : ""}
              {support === "partial" ? " · text and captions only" : ""}
            </option>
          ))}
        </select>
      </label>
      {targetInfo?.support === "partial" && (
        <p className="muted small" role="status">
          {targetInfo.language.name} is a partial language. {targetInfo.note}
        </p>
      )}
      {characters.map((c) => {
        const mapped = mapVoiceForLanguage(characterVoiceId(c) || undefined, target);
        return (
          <label key={c.id} className="field">
            <span>
              {c.name} voice
              {mapped.voiceId
                ? ` · auto: ${mapped.voiceId}`
                : " · no voice in this language yet"}
            </span>
            <select
              value={overrides[c.id] ?? "auto"}
              onChange={(e) =>
                setOverrides((prev) => ({ ...prev, [c.id]: e.target.value }))
              }
            >
              <option value="auto">Automatic mapping</option>
              <option value="none">Leave unvoiced</option>
              {targetVoices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name} · {v.lang} {v.gender}
                </option>
              ))}
            </select>
          </label>
        );
      })}
      <button
        type="button"
        className="primary"
        onClick={() => void create()}
        disabled={busy || !configured}
      >
        {busy ? "Creating variant…" : "Create translated variant"}
      </button>
      {status && (
        <p className="muted" role="status">
          {status}
        </p>
      )}
      {unvoiced.length > 0 && (
        <p className="muted" role="status">
          No catalogue voice speaks this language yet, so these characters
          are unvoiced in the variant: {unvoiced.map((c) => c.name ?? "Character").join(", ")}.
          Assign a voice per character in the Dialogue panel above.
        </p>
      )}
    </div>
  );
}
