/**
 * GenerateAssetPanel: describe an asset in plain words and generate it
 * (issues #93 and #95), inside the media panel.
 *
 * Style handling is automatic: generation targets the style family of
 * the current scene or project by default, and the user can pick a
 * different family (or the custom character set in use) explicitly.
 * Output defaults are baked in and never asked: flat vector look,
 * transparent background for props, a full bleed rectangle for
 * backgrounds, sized for the stage. Every generated asset saves into
 * the user media library with its style tag and provenance, and lands
 * on the stage as a normal movable object that works with the motion
 * and effects system like any stock placement.
 *
 * Honest states: when generation is not configured the panel says so
 * up front and the generate button stays disabled. Generation counts
 * against the existing FinchLearn AI allowance; no new credits.
 */
import { useMemo, useState } from "react";
import {
  BUILT_IN_STYLE_FAMILIES,
  makeGeneratedAssetObject,
  resolveStyleFamily,
  type AssetKind,
  type ExplicitStyle,
  type GeneratedLibraryAsset,
} from "@finch-studio/ai-assets";
import { useStudioStore } from "../store";
import {
  assetGenerationConfigured,
  generateAssetForScene,
  loadGeneratedAssets,
  projectCustomStyleSet,
  projectStyleContext,
  sceneStyleContext,
} from "../aiAssets";

type StylePick = "auto" | "A" | "B" | "D" | "custom";

export function GenerateAssetPanel() {
  const project = useStudioStore((s) => s.project);
  const currentSceneId = useStudioStore((s) => s.currentSceneId);
  const addObject = useStudioStore((s) => s.addObject);
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<AssetKind>("prop");
  const [stylePick, setStylePick] = useState<StylePick>("auto");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [saved, setSaved] = useState<GeneratedLibraryAsset[]>(loadGeneratedAssets);
  const configured = assetGenerationConfigured();

  const scene = project.scenes.find((s) => s.id === currentSceneId);
  const customSet = useMemo(() => projectCustomStyleSet(project), [project]);

  const explicitStyle: ExplicitStyle | undefined =
    stylePick === "auto"
      ? undefined
      : stylePick === "custom"
        ? customSet
          ? { customSet }
          : undefined
        : { family: stylePick };

  const targetStyle = useMemo(
    () =>
      resolveStyleFamily({
        explicit: explicitStyle,
        scene: sceneStyleContext(scene),
        project: projectStyleContext(project),
      }),
    // explicitStyle is rebuilt each render; its inputs are the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [project, scene, stylePick, customSet],
  );

  const generate = async () => {
    if (busy || !configured || !description.trim()) return;
    setBusy(true);
    setStatus("Generating your asset. This can take a moment.");
    try {
      const { asset, object, report } = await generateAssetForScene({
        project,
        sceneId: currentSceneId,
        description,
        kind,
        explicitStyle,
      });
      addObject(object);
      setSaved(loadGeneratedAssets());
      setStatus(
        `Added "${asset.name}" to the scene and saved it to your media library. ` +
          `Style: ${report.style.familyName}. ${report.credit}.`,
      );
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const placeSaved = (asset: GeneratedLibraryAsset) => {
    addObject(makeGeneratedAssetObject(asset));
    setStatus(`Added "${asset.name}" to the scene.`);
  };

  return (
    <div>
      <p className="muted small">
        Describe a prop, object, or background in plain words. It is generated in a
        flat vector look to match your project style, saved to your media library,
        and placed on the stage. Generation counts against your FinchLearn AI
        allowance.
      </p>
      {!configured && (
        <p className="muted" role="status">
          AI asset generation is not configured on this build. An administrator
          needs to set the VITE_FINCH_AI_ASSET_ENDPOINT build secret before
          assets can be generated.
        </p>
      )}
      <label className="field">
        <span>Description</span>
        <input
          type="text"
          placeholder="A brass desk lamp with a green shade"
          aria-label="Asset description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </label>
      <label className="field">
        <span>Asset kind</span>
        <select
          aria-label="Asset kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as AssetKind)}
        >
          <option value="prop">Prop or object (transparent background)</option>
          <option value="background">Background (full bleed, fills the stage)</option>
        </select>
      </label>
      <label className="field">
        <span>Style</span>
        <select
          aria-label="Asset style"
          value={stylePick}
          onChange={(e) => setStylePick(e.target.value as StylePick)}
        >
          <option value="auto">Match this project (automatic)</option>
          {BUILT_IN_STYLE_FAMILIES.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
          {customSet && <option value="custom">{customSet.name} (custom character set)</option>}
        </select>
      </label>
      <p className="muted small">
        Target style: {targetStyle.familyName}
        {targetStyle.source === "scene"
          ? " (from this scene)"
          : targetStyle.source === "project"
            ? " (from this project)"
            : targetStyle.source === "explicit"
              ? " (your pick)"
              : " (the launch family)"}
        . Props are generated on a transparent background; backgrounds fill the
        whole stage.
      </p>
      <button
        type="button"
        className="primary"
        onClick={() => void generate()}
        disabled={busy || !configured || !description.trim()}
      >
        {busy ? "Generating..." : "Generate asset"}
      </button>
      {status && (
        <p className="muted" role="status">
          {status}
        </p>
      )}
      {saved.length > 0 && (
        <div className="media-grid">
          {saved.map((asset) => (
            <button
              key={asset.id}
              type="button"
              className="media-thumb"
              title={asset.credit ?? asset.name}
              onClick={() => placeSaved(asset)}
            >
              {asset.remoteUrl && (
                <img src={asset.remoteUrl} alt={asset.name} loading="lazy" />
              )}
              <span>
                {asset.name} ({asset.generated.styleName})
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
