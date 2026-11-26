/**
 * RiggingWizard: guided custom character rigging (issue #74).
 *
 * Tier 2 pin rigging: upload one transparent PNG in a spread pose (or
 * separate PNGs per part), check the detected pins against the ghost
 * skeleton, drag pins to fine tune, adjust proportions, and preview the
 * character walking, pointing, and sitting before saving it to the
 * user library. Tier 3: an SVG matching the named layer template rigs
 * itself with zero pins. The generated source is bound to the AI asset
 * generation service (../generatedCharacterSource): when that service
 * is configured on the build it generates a spread pose image that
 * lands in this same pin flow; until then it reports that honestly.
 *
 * Quality is stated plainly either way: segmented art bends cleanly,
 * single image art uses mesh deformation and can stretch at joints.
 * The wizard says which one a given upload gets, and why.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  PIN_IDS,
  PIN_LABELS,
  PIN_SEGMENTS,
  RigPosePreview,
  SVG_TEMPLATE_SVG,
  boneMapFromPins,
  buildCharacter,
  buildFacePack,
  buildRig,
  decideRigMode,
  detectJoints,
  jointSeparationScore,
  matchSvgTemplate,
  rederiveRig,
  rigFromSvgTemplate,
  withProportions,
  type ActionName,
  type BoneId,
  type CustomCharacterDef,
  type CustomRig,
  type PinId,
  type PinSet,
  type StyleFamilyId,
} from "@finch-studio/characters";
import { useStudioStore, makeStudioCustomCharacter } from "../store";
import { AiAssetsGeneratedSource } from "../generatedCharacterSource";
import {
  probeGenerationService,
  projectStyleContext,
  sceneStyleContext,
} from "../aiAssets";
import { BUILT_IN_STYLE_FAMILIES } from "@finch-studio/ai-assets";

const PART_SLOTS_FOR_UPLOAD = [
  "head", "torso",
  "armUpperL", "armLowerL", "armUpperR", "armLowerR",
  "legUpperL", "legLowerL", "legUpperR", "legLowerR",
] as const;

interface LoadedImage {
  dataUrl: string;
  width: number;
  height: number;
}

interface PartFile {
  slot: string;
  ref: string;
  name: string;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

interface Measure {
  content: { left: number; top: number; right: number; bottom: number };
  separation: number;
  hasTransparency: boolean;
}

/** Measure alpha bounds and joint separation from the loaded PNG. */
function measureImage(img: HTMLImageElement, pins: PinSet): Measure | null {
  try {
    const w = Math.min(img.naturalWidth, 480);
    const h = Math.max(1, Math.round((w * img.naturalHeight) / img.naturalWidth));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    let left = w, top = h, right = -1, bottom = -1, anyAlpha = false, anyClear = false;
    for (let y = 0; y < h; y += 2) {
      for (let x = 0; x < w; x += 2) {
        const a = data[(y * w + x) * 4 + 3];
        if (a > 16) {
          anyAlpha = true;
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        } else {
          anyClear = true;
        }
      }
    }
    if (!anyAlpha || right < 0) return null;
    const fractions: number[] = [];
    const jointPins: PinId[] = ["neck", "elbowL", "elbowR", "kneeL", "kneeR"];
    for (const id of jointPins) {
      const p = pins[id];
      const y = Math.min(h - 1, Math.max(0, Math.round(p.y * h)));
      const half = Math.round(0.14 * w);
      const cx = Math.round(p.x * w);
      let visible = 0, total = 0;
      for (let x = Math.max(0, cx - half); x <= Math.min(w - 1, cx + half); x += 1) {
        total += 1;
        if (data[(y * w + x) * 4 + 3] > 16) visible += 1;
      }
      if (total > 0) fractions.push(visible / total);
    }
    return {
      content: { left: left / w, top: top / h, right: right / w, bottom: bottom / h },
      separation: jointSeparationScore(fractions),
      hasTransparency: anyClear,
    };
  } catch {
    return null;
  }
}

let wizardCounter = 0;

export function RiggingWizard() {
  const customCharacters = useStudioStore((s) => s.customCharacters);
  const saveCustomCharacter = useStudioStore((s) => s.saveCustomCharacter);
  const removeCustomCharacter = useStudioStore((s) => s.removeCustomCharacter);
  const addObject = useStudioStore((s) => s.addObject);
  const project = useStudioStore((s) => s.project);
  const currentSceneId = useStudioStore((s) => s.currentSceneId);

  const [tab, setTab] = useState<"single" | "parts" | "svg" | "generated">("single");
  const [name, setName] = useState("");
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [generatedArt, setGeneratedArt] = useState(false);
  const [detected, setDetected] = useState<PinSet | null>(null);
  const [pins, setPins] = useState<PinSet | null>(null);
  const [separation, setSeparation] = useState(0);
  const [hasTransparency, setHasTransparency] = useState(true);
  const [dragging, setDragging] = useState<PinId | null>(null);
  const [partFiles, setPartFiles] = useState<PartFile[]>([]);
  const [partSlot, setPartSlot] = useState<string>("head");
  const [svgText, setSvgText] = useState("");
  const [propScales, setPropScales] = useState({ legs: 1, arms: 1, height: 1 });
  const [previewAction, setPreviewAction] = useState<ActionName>("walk");
  const [previewT, setPreviewT] = useState(0);
  const [editing, setEditing] = useState<CustomCharacterDef | null>(null);
  const [genPrompt, setGenPrompt] = useState("");
  const [genError, setGenError] = useState("");
  const [genStylePick, setGenStylePick] = useState<"auto" | StyleFamilyId>("auto");
  const [genServiceOff, setGenServiceOff] = useState(false);

  // The generated source resolves style from this scene, then the
  // project (issue #362); the service probe keeps the tab honest when
  // the build carries the endpoint but the service is not switched on.
  const currentScene = project.scenes.find((s) => s.id === currentSceneId);
  const generatedSource = useMemo(
    () =>
      new AiAssetsGeneratedSource(undefined, undefined, {
        scene: sceneStyleContext(currentScene),
        project: projectStyleContext(project),
      }),
    [project, currentScene],
  );
  const generationReady = generatedSource.isConfigured && !genServiceOff;

  useEffect(() => {
    void probeGenerationService().then((configured) =>
      setGenServiceOff(configured === false),
    );
  }, []);
  const [note, setNote] = useState("");

  const singleRef = useRef<HTMLInputElement>(null);
  const partRef = useRef<HTMLInputElement>(null);
  const svgRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const timer = setInterval(() => setPreviewT((t) => (t + 60) % 3200), 60);
    return () => clearInterval(timer);
  }, []);

  const sourceKind = tab === "parts" ? "parts" : tab === "svg" ? "svg-template" : "single";
  const decision = useMemo(() => {
    if (sourceKind === "svg-template") {
      return decideRigMode({ sourceKind: "svg-template", partCount: 10, hasTransparency: true });
    }
    if (sourceKind === "parts") {
      return decideRigMode({ sourceKind: "parts", partCount: partFiles.length });
    }
    return decideRigMode({
      sourceKind: "single",
      partCount: 0,
      jointSeparation: separation,
      hasTransparency,
    });
  }, [sourceKind, partFiles.length, separation, hasTransparency]);

  const expandedProportions = useMemo(() => {
    const out: Partial<Record<BoneId, number>> = {};
    if (propScales.legs !== 1) {
      out.legUpperL = propScales.legs;
      out.legUpperR = propScales.legs;
      out.legLowerL = propScales.legs;
      out.legLowerR = propScales.legs;
    }
    if (propScales.arms !== 1) {
      out.armUpperL = propScales.arms;
      out.armUpperR = propScales.arms;
      out.armLowerL = propScales.arms;
      out.armLowerR = propScales.arms;
    }
    if (propScales.height !== 1) out.neck = propScales.height;
    return out;
  }, [propScales]);

  const boneMap = useMemo(() => {
    if (!pins) return null;
    return withProportions(boneMapFromPins(pins), expandedProportions);
  }, [pins, expandedProportions]);

  const adjustedPins = useMemo(() => {
    if (!pins || !detected) return [] as PinId[];
    return PIN_IDS.filter(
      (id) => Math.abs(pins[id].x - detected[id].x) > 0.001 || Math.abs(pins[id].y - detected[id].y) > 0.001,
    );
  }, [pins, detected]);

  /** Shared intake for a whole figure image: uploads and generated art
   * land in the same pin flow. */
  const acceptImage = (loaded: LoadedImage, img: HTMLImageElement) => {
    const firstPass = detectJoints({ width: loaded.width, height: loaded.height });
    const measured = measureImage(img, firstPass);
    const det = measured
      ? detectJoints({ width: loaded.width, height: loaded.height, content: measured.content })
      : firstPass;
    setImage(loaded);
    setDetected(det);
    setPins(det);
    setSeparation(measured?.separation ?? 0);
    setHasTransparency(measured?.hasTransparency ?? true);
    setEditing(null);
    setNote(
      measured
        ? "First pass pins are placed from the figure outline. Drag any pin that sits off its joint."
        : "First pass pins use standard proportions. Drag any pin that sits off its joint.",
    );
  };

  const onSingleFile = async (file: File) => {
    const dataUrl = await readAsDataUrl(file);
    const img = await loadImage(dataUrl);
    setGeneratedArt(false);
    acceptImage({ dataUrl, width: img.naturalWidth, height: img.naturalHeight }, img);
  };

  const onReplaceBase = async (file: File) => {
    if (!editing) return;
    const dataUrl = await readAsDataUrl(file);
    const img = await loadImage(dataUrl);
    const firstPass = detectJoints({ width: img.naturalWidth, height: img.naturalHeight });
    const measured = measureImage(img, firstPass);
    const det = measured
      ? detectJoints({ width: img.naturalWidth, height: img.naturalHeight, content: measured.content })
      : firstPass;
    const nextDecision = decideRigMode({
      sourceKind: "single",
      partCount: 0,
      jointSeparation: measured?.separation ?? 0,
      hasTransparency: measured?.hasTransparency ?? true,
    });
    const rig = rederiveRig(editing.customRig, {
      detected: det,
      decision: nextDecision,
      baseImageRef: dataUrl,
      imageSize: { width: img.naturalWidth, height: img.naturalHeight },
      derivedAt: new Date().toISOString(),
    });
    const updated: CustomCharacterDef = { ...editing, customRig: rig };
    saveCustomCharacter(updated);
    setEditing(updated);
    setImage({ dataUrl, width: img.naturalWidth, height: img.naturalHeight });
    setDetected(rig.detectedPins);
    setPins(rig.pins);
    setSeparation(measured?.separation ?? 0);
    setHasTransparency(measured?.hasTransparency ?? true);
    setNote("Base image replaced and the rig was re-derived. Pins you had fine tuned kept their offsets on the new art.");
  };

  const onPartFile = async (file: File) => {
    const dataUrl = await readAsDataUrl(file);
    setPartFiles((prev) => [
      ...prev.filter((p) => p.slot !== partSlot),
      { slot: partSlot, ref: dataUrl, name: file.name },
    ]);
    if (!detected) {
      const det = detectJoints({ width: 200, height: 400 });
      setDetected(det);
      setPins(det);
    }
    setNote(`Added the ${partSlot} part. Add at least six parts for a full part rig.`);
  };

  const onSvgFile = async (file: File) => {
    setSvgText(await file.text());
  };

  const svgMatch = useMemo(() => (svgText ? matchSvgTemplate(svgText) : null), [svgText]);

  const startEdit = (def: CustomCharacterDef) => {
    setEditing(def);
    setName(def.name);
    setDetected(def.customRig.detectedPins);
    setPins(def.customRig.pins);
    if (def.customRig.baseImageRef && def.customRig.sourceKind === "single-png") {
      setTab("single");
      setImage({
        dataUrl: def.customRig.baseImageRef,
        width: def.customRig.imageSize?.width ?? 200,
        height: def.customRig.imageSize?.height ?? 400,
      });
    } else if (def.customRig.sourceKind === "svg-template") {
      setTab("svg");
      setSvgText(def.customRig.baseImageRef ?? "");
    } else {
      setTab("parts");
      setPartFiles((def.customRig.parts ?? []).map((p) => ({ slot: p.slot, ref: p.ref, name: p.slot })));
    }
    setNote(`Editing "${def.name}". Nudge pins, adjust proportions, or replace the base image, then save.`);
  };

  const saveWizard = () => {
    const trimmed = name.trim() || "My character";
    if (tab === "svg") {
      const rig = rigFromSvgTemplate(svgText, new Date().toISOString());
      if (!rig) {
        setNote("That SVG does not match the template yet. Fix the missing groups listed below and try again.");
        return;
      }
      const id = editing?.id ?? `custom-${Date.now().toString(36)}-${++wizardCounter}`;
      const def: CustomCharacterDef = { ...buildCharacter(id, trimmed, {}), customRig: rig };
      saveCustomCharacter(def);
      setEditing(def);
      setNote(`Saved "${trimmed}" to your character library at full part quality.`);
      return;
    }
    if (!pins || !detected || !boneMap) {
      setNote("Upload art and place the pins first.");
      return;
    }
    const id = editing?.id ?? `custom-${Date.now().toString(36)}-${++wizardCounter}`;
    const rig: CustomRig = buildRig({
      sourceKind: tab === "parts" ? "part-pngs" : generatedArt ? "generated" : "single-png",
      pins,
      detectedPins: detected,
      userAdjustedPins: adjustedPins,
      decision,
      derivedAt: new Date().toISOString(),
      ...(tab === "parts"
        ? { parts: partFiles.map((p) => ({ slot: p.slot, ref: p.ref })) }
        : image
          ? { baseImageRef: image.dataUrl, imageSize: { width: image.width, height: image.height } }
          : {}),
    });
    const finalRig: CustomRig = {
      ...rig,
      boneMap,
      facePack: { ...buildFacePack(pins, boneMap), ...(rig.facePack.expressionOverrides ? { expressionOverrides: rig.facePack.expressionOverrides } : {}) },
    };
    const def: CustomCharacterDef = { ...buildCharacter(id, trimmed, {}), customRig: finalRig };
    saveCustomCharacter(def);
    setEditing(def);
    setNote(`Saved "${trimmed}" to your character library. It is available in every project.`);
  };

  const tryGenerate = async () => {
    setGenError("");
    try {
      const material = await generatedSource.produce({
        kind: "generated",
        prompt: genPrompt.trim(),
        template: "spread-pose",
        ...(genStylePick !== "auto" ? { styleFamily: genStylePick } : {}),
      });
      if (material.kind !== "upload") {
        setGenError("Generation returned an unexpected result. Nothing was created.");
        return;
      }
      const img = await loadImage(material.imageRef);
      setGeneratedArt(true);
      acceptImage(
        {
          dataUrl: material.imageRef,
          width: img.naturalWidth || material.width,
          height: img.naturalHeight || material.height,
        },
        img,
      );
      // Land in the pin flow so the generated art is checked and saved
      // exactly like an upload.
      setTab("single");
    } catch (err) {
      setGenError(err instanceof Error ? err.message : "Generation is not available. Nothing was created.");
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob([SVG_TEMPLATE_SVG], { type: "image/svg+xml" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "finch-studio-character-template.svg";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const onStagePointerMove = (e: React.PointerEvent) => {
    if (!dragging || !pins || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    setPins({ ...pins, [dragging]: { x, y } });
  };

  const stageW = image?.width ?? 200;
  const stageH = image?.height ?? 400;

  return (
    <div className="panel rigging-wizard">
      <div className="panel-title">Custom character rigging</div>
      <div className="seg" role="tablist" aria-label="Character source">
        <button type="button" className={tab === "single" ? "active" : ""} onClick={() => setTab("single")}>One PNG</button>
        <button type="button" className={tab === "parts" ? "active" : ""} onClick={() => setTab("parts")}>Part PNGs</button>
        <button type="button" className={tab === "svg" ? "active" : ""} onClick={() => setTab("svg")}>SVG template</button>
        <button type="button" className={tab === "generated" ? "active" : ""} onClick={() => setTab("generated")}>AI generate</button>
      </div>

      {tab === "single" && (
        <div>
          <p className="muted small">
            Upload one transparent PNG, full body, front facing, arms spread. Studio places a first
            pass of pins from the figure outline; you drag them onto the joints.
          </p>
          <div className="lib-row">
            <button type="button" onClick={() => singleRef.current?.click()}>
              {image ? "Choose a different PNG" : "Upload PNG"}
            </button>
            <input
              ref={singleRef}
              type="file"
              accept="image/png,image/*"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onSingleFile(f);
                e.target.value = "";
              }}
            />
          </div>
        </div>
      )}

      {tab === "parts" && (
        <div>
          <p className="muted small">
            Upload one PNG per body part. Six or more parts rig at full part quality, with the
            parts overlapping at the joints.
          </p>
          <div className="lib-row">
            <select value={partSlot} onChange={(e) => setPartSlot(e.target.value)} aria-label="Part slot">
              {PART_SLOTS_FOR_UPLOAD.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <button type="button" onClick={() => partRef.current?.click()}>Upload part PNG</button>
            <input
              ref={partRef}
              type="file"
              accept="image/png,image/*"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onPartFile(f);
                e.target.value = "";
              }}
            />
          </div>
          {partFiles.length > 0 && (
            <p className="muted small">
              Parts so far: {partFiles.map((p) => p.slot).join(", ")} ({partFiles.length} of 6 needed)
            </p>
          )}
        </div>
      )}

      {tab === "svg" && (
        <div>
          <p className="muted small">
            Download the template, draw inside each named group in your design tool, and upload
            the SVG. A matching file rigs itself at full part quality with zero pins.
          </p>
          <div className="lib-row">
            <button type="button" onClick={downloadTemplate}>Download template SVG</button>
            <button type="button" onClick={() => svgRef.current?.click()}>Upload SVG</button>
            <input
              ref={svgRef}
              type="file"
              accept="image/svg+xml,.svg"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void onSvgFile(f);
                e.target.value = "";
              }}
            />
          </div>
          <textarea
            value={svgText}
            onChange={(e) => setSvgText(e.target.value)}
            placeholder="Or paste SVG markup here"
            rows={4}
            style={{ width: "100%" }}
            aria-label="SVG markup"
          />
          {svgMatch && (
            svgMatch.matches ? (
              <p className="small">Template match: all {svgMatch.present.length} named groups found. This character rigs itself.</p>
            ) : (
              <p className="small">
                Template match: missing {svgMatch.missing.join(", ")}. Rename those groups in
                your design tool and upload again, or use the pin wizard instead.
              </p>
            )
          )}
        </div>
      )}

      {tab === "generated" && (
        <div>
          <p className="muted small">
            Describe a character and Studio will generate a spread pose image through the AI
            asset generation service and rig it. When the generation endpoint is not configured
            on this build, this entry point reports that honestly instead of pretending to
            create one.
          </p>
          <label className="field">
            Character description
            <input
              type="text"
              value={genPrompt}
              onChange={(e) => setGenPrompt(e.target.value)}
              placeholder="A friendly fox teacher in a cardigan"
            />
          </label>
          <label className="field">
            Style
            <select
              aria-label="Character style"
              value={genStylePick}
              onChange={(e) => setGenStylePick(e.target.value as "auto" | StyleFamilyId)}
            >
              <option value="auto">Match this project (automatic)</option>
              {BUILT_IN_STYLE_FAMILIES.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={() => void tryGenerate()} disabled={!genPrompt.trim() || !generationReady}>
            Generate character
          </button>
          <p className="muted small">
            Each generation counts once against your FinchLearn AI allowance.
            Generating again counts again.
          </p>
          {!generatedSource.isConfigured && (
            <p className="muted small">
              AI generation is not configured on this build yet, so no character can be
              generated here. Upload a PNG or use the SVG template instead.
            </p>
          )}
          {generatedSource.isConfigured && genServiceOff && (
            <p className="muted small">
              AI generation is not switched on yet on the generation service, so no
              character can be generated here. Upload a PNG or use the SVG template
              instead.
            </p>
          )}
          {genError && <p className="small">{genError}</p>}
        </div>
      )}

      {tab !== "generated" && tab !== "svg" && pins && (
        <div>
          <div className="sub-title">Pins and ghost skeleton</div>
          <svg
            ref={stageRef}
            className="rig-stage"
            viewBox={`0 0 ${stageW} ${stageH}`}
            onPointerMove={onStagePointerMove}
            onPointerUp={() => setDragging(null)}
            onPointerLeave={() => setDragging(null)}
            role="application"
            aria-label="Pin editor. Drag each pin onto its joint."
          >
            {image && tab === "single" && (
              <image href={image.dataUrl} x={0} y={0} width={stageW} height={stageH} />
            )}
            {PIN_SEGMENTS.map(([a, b]) => (
              <line
                key={`${a}-${b}`}
                x1={pins[a].x * stageW}
                y1={pins[a].y * stageH}
                x2={pins[b].x * stageW}
                y2={pins[b].y * stageH}
                stroke="var(--accent)"
                strokeWidth={Math.max(2, stageW * 0.006)}
                opacity={0.65}
              />
            ))}
            {PIN_IDS.map((id) => (
              <g key={id}>
                <circle
                  cx={pins[id].x * stageW}
                  cy={pins[id].y * stageH}
                  r={Math.max(5, stageW * 0.016)}
                  fill={dragging === id ? "var(--accent)" : "var(--bg2)"}
                  stroke="var(--accent)"
                  strokeWidth={2}
                  style={{ cursor: "grab" }}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    setDragging(id);
                  }}
                >
                  <title>{PIN_LABELS[id]}</title>
                </circle>
              </g>
            ))}
          </svg>
          <p className="muted small">
            Drag the pins onto the joints. {adjustedPins.length} pin{adjustedPins.length === 1 ? "" : "s"} fine tuned so far.
          </p>

          <div className="sub-title">Proportions</div>
          {(
            [
              ["legs", "Leg length"],
              ["arms", "Arm length"],
              ["height", "Torso height"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="field">
              {label}: {propScales[key].toFixed(2)}x
              <input
                type="range"
                min={0.7}
                max={1.4}
                step={0.05}
                value={propScales[key]}
                onChange={(e) => setPropScales({ ...propScales, [key]: Number(e.target.value) })}
              />
            </label>
          ))}

          <div className="sub-title">Rig quality</div>
          <p className="small">{decision.reason}</p>
          <p className="muted small">{decision.qualityNote}</p>

          {boneMap && (
            <div>
              <div className="sub-title">Action preview</div>
              <div className="seg" role="group" aria-label="Preview action">
                {(["walk", "point", "sit", "idle"] as ActionName[]).map((a) => (
                  <button
                    key={a}
                    type="button"
                    className={previewAction === a ? "active" : ""}
                    onClick={() => setPreviewAction(a)}
                  >
                    {a}
                  </button>
                ))}
              </div>
              <div className="rig-preview">
                <RigPosePreview map={boneMap} action={previewAction} tMs={previewT} style={{ width: 90, height: 180 }} />
              </div>
              <p className="muted small">Nudge a pin and the preview updates, so you can retest before saving.</p>
            </div>
          )}
        </div>
      )}

      {tab !== "generated" && (
        <div>
          <label className="field">
            Character name
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="My character" />
          </label>
          <div className="lib-row">
            <button type="button" className="primary" onClick={saveWizard}>
              {editing ? "Save changes" : "Save to library"}
            </button>
            {editing && editing.customRig.sourceKind === "single-png" && (
              <>
                <button type="button" onClick={() => replaceRef.current?.click()}>Replace base image</button>
                <input
                  ref={replaceRef}
                  type="file"
                  accept="image/png,image/*"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onReplaceBase(f);
                    e.target.value = "";
                  }}
                />
              </>
            )}
          </div>
          {editing && (
            <p className="muted small">
              The base image stays editable: replacing it re-derives the rig and keeps your pin
              fine tuning as offsets on the new art. Face data for lip sync, blink, and
              expressions is attached automatically.
            </p>
          )}
        </div>
      )}

      {note && <p className="muted">{note}</p>}

      <div className="sub-title">Your character library</div>
      {customCharacters.length === 0 && (
        <p className="muted small">No custom characters yet. Rig one above and it will live here, in every project.</p>
      )}
      {customCharacters.map((def) => (
        <div key={def.id} className="lib-snap">
          <span>
            {def.name}{" "}
            <span className="muted">
              {def.customRig.mode === "segmented" ? "full part quality" : "mesh deformation"}
            </span>
          </span>
          <span>
            <button type="button" onClick={() => addObject(makeStudioCustomCharacter(def))}>Add to scene</button>
            <button type="button" onClick={() => startEdit(def)}>Edit rig</button>
            <button type="button" onClick={() => removeCustomCharacter(def.id)}>Delete</button>
          </span>
        </div>
      ))}
    </div>
  );
}
