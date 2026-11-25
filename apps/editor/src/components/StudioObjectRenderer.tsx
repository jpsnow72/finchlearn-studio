/**
 * StudioObjectRenderer — renders scene objects in the video studio canvas.
 *
 * Handles the video-friendly types (character, text, shape, image, and
 * footage video with its issue #25 edits); other types render a
 * placeholder note. Character limb animation + path movement
 * come from @finch-studio/characters' RiggedCharacter (driven by
 * SceneTimeContext), on the standard skeleton and the approved
 * Direction A and B style families.
 */
import { useContext, useEffect, useRef, useState, type CSSProperties } from "react";
import type { CharacterObject, ChartObject, CourseObject, LottieObject, VideoObject } from "@finch-studio/core";
import {
  quantizeMsToFps,
  renderLottieSvg,
  type LottieAnimationData,
} from "../lottie/lottieCore";
import {
  getCachedLottieAnimation,
  lottieLocalMs,
  preloadLottieAnimation,
} from "../lottie/lottieObject";
import { footageSourceAt } from "@finch-studio/schema";
import {
  footageClipStartMs,
  resolveFootageObject,
} from "../footageEditing";
import {
  getMotionMeta,
  isMotionGraphicMeta,
  kineticRevealForObject,
  kineticVisibleText,
  SceneTimeContext,
} from "@finch-studio/animation";
import {
  CustomCharacterFigure,
  RiggedCharacter,
  characterForLegacyId,
  defWithColors,
  mouthAt,
  visemesFromText,
} from "@finch-studio/characters";
import { studioActionFor } from "../videoExport";
import { getStoredIngest } from "@finch-studio/media";
import { previewSourceFor, storedIngestProxyUrl } from "../ingestClient";
import { customDefOfObject } from "../customCharacters";
import { textDirectionOf } from "@finch-studio/translation";
import { feColorMatrixValues } from "@finch-studio/schema";
import {
  getObjectColorCorrection,
  isNeutralColorCorrection,
} from "../colorCorrection";
import { chartProgress, chartSvg } from "../chart";
import { MATTE_HONEST_NOTE, parseHexColor, type RgbaFrame } from "@finch-studio/media";
import {
  drawMattedFrame,
  getBackgroundRemoval,
  loadMatteAlphaProvider,
  matteAlphaProviderFor,
} from "../videoMatting";

/**
 * Stage footage CORS mode (issue #122): the stage composites footage
 * frames through a canvas (drawMattedFrame reads pixels back), so an
 * http(s) preview must load in CORS mode or the canvas is tainted and
 * the readback throws. This mirrors the export path, which sets
 * crossOrigin "anonymous" on its own video elements. When a source
 * refuses CORS the element errors and the caller drops back to a
 * plain no-CORS load so playback still works (compositing then stays
 * unavailable and is reported honestly, never thrown).
 */
export function stageVideoCrossOrigin(
  src: string,
  corsDropped: boolean,
): "anonymous" | undefined {
  if (corsDropped) return undefined;
  return /^https?:\/\//i.test(src) ? "anonymous" : undefined;
}

/** Stable, attribute-safe SVG filter id for an object's correction. */
export function colorFilterIdFor(objectId: string): string {
  return `cc-${objectId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

import {
  handStrokeWidth,
  shapeOutlineStrokes,
  visibleStrokes,
  type DrawOnSample,
  type DrawOnTreatment,
} from "@finch-studio/motion";

export interface DrawOnRenderState {
  sample: DrawOnSample;
  treatment: DrawOnTreatment;
}

/**
 * A shape mid draw-on: the outline strokes revealed so far, in the
 * object's own fill colour (the marker colour), with the hand style's
 * stroke width. At full progress the caller renders the filled shape.
 */
function ShapeDrawOnView({
  object,
  drawOn,
}: {
  object: CourseObject;
  drawOn: DrawOnRenderState;
}) {
  const pos = object.position ?? {};
  const w = pos.w ?? 200;
  const h = pos.h ?? 100;
  const shape = (object as { shape?: string }).shape;
  const kind =
    shape === "ellipse" ? "ellipse" : shape === "line" ? "line" : "rect";
  const strokes = visibleStrokes(
    shapeOutlineStrokes(kind, w, h),
    drawOn.sample.progress,
  );
  const stroke = (object as { fill?: string }).fill ?? "#3b82f6";
  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {strokes.map((points, i) => (
        <polyline
          key={i}
          points={points.map((p) => `${p.x},${p.y}`).join(" ")}
          fill="none"
          stroke={stroke}
          strokeWidth={handStrokeWidth(drawOn.treatment.handStyle, 4)}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}

function CharacterView({ object }: { object: CharacterObject }) {
  const tMs = useContext(SceneTimeContext);
  const dir = textDirectionOf(object);
  const customDef = customDefOfObject(object);
  const def = defWithColors(characterForLegacyId(object.characterId), object.colors);
  const now = tMs ?? 0;
  const line = (object.speech ?? []).find(
    (sp) => now >= sp.start && now < sp.start + sp.duration,
  );
  const mouth = line?.text
    ? mouthAt(visemesFromText(line.text), now - line.start)
    : undefined;
  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {customDef ? (
        <CustomCharacterFigure
          def={customDef}
          action={studioActionFor(object.characterAnimation)}
          tMs={now}
          {...(mouth ? { mouthOverride: mouth } : {})}
          style={{ width: "100%", height: "100%" }}
        />
      ) : (
        <RiggedCharacter
          def={def}
          action={studioActionFor(object.characterAnimation)}
          tMs={now}
          {...(mouth ? { mouthOverride: mouth } : {})}
          style={{ width: "100%", height: "100%" }}
        />
      )}
      {line?.text && (
        <div
          className="speech-bubble"
          role="note"
          {...(dir ? { dir } : {})}
          style={dir === "rtl" ? { textAlign: "right" } : undefined}
        >
          {line.text}
        </div>
      )}
    </div>
  );
}

/**
 * Footage (video) object on the stage (issue #25). The shared footage
 * resolver maps the scene clock to a source time; the element plays at
 * the clip's speed and volume, pauses on the frozen frame during a
 * freeze hold, and shows only the crop rectangle when one is set. The
 * browser exports resolve the same mapping onto a canvas.
 */
function FootageView({ object }: { object: VideoObject }) {
  const tMs = useContext(SceneTimeContext);
  const videoRef = useRef<HTMLVideoElement>(null);
  const matteCanvasRef = useRef<HTMLCanvasElement>(null);
  const removal = getBackgroundRemoval(object);
  const matteReady = removal?.status === "ready" && Boolean(removal.matteR2Key);
  const [matteLoad, setMatteLoad] = useState<
    { status: "idle" | "loading" | "ready" | "error"; progress: number; error?: string }
  >({ status: "idle", progress: 0 });

  // Stored matte loader (issue #122): fetch and decode the stored
  // matte asset into the shared alpha provider registry. The export
  // path reads the same registry, so preview and export composite
  // the same matte. A load failure is shown honestly and the plain
  // footage keeps rendering.
  useEffect(() => {
    if (!matteReady || !removal?.matteR2Key) return;
    if (matteAlphaProviderFor(object.id)) {
      setMatteLoad({ status: "ready", progress: 1 });
      return;
    }
    let live = true;
    setMatteLoad({ status: "loading", progress: 0 });
    loadMatteAlphaProvider(
      object.id,
      {
        r2Key: removal.matteR2Key,
        modelVersion: removal.modelVersion,
        jobId: removal.matteJobId,
        jobToken: removal.matteJobToken,
      },
      { onProgress: (progress) => { if (live) setMatteLoad({ status: "loading", progress }); } },
    )
      .then(() => { if (live) setMatteLoad({ status: "ready", progress: 1 }); })
      .catch((err: unknown) => {
        if (live) {
          setMatteLoad({
            status: "error",
            progress: 0,
            error: err instanceof Error ? err.message : "the stored matte could not be loaded",
          });
        }
      });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [object.id, matteReady, removal?.matteR2Key, removal?.matteJobId, removal?.matteJobToken]);

  const resolved = resolveFootageObject(object);
  // Preview prefers the ingest proxy once the job is done (issue #7);
  // the original stays the export source and the fallback here when
  // the proxy artefact can no longer be loaded.
  const storedIngest = getStoredIngest(object);
  const preview = previewSourceFor({
    originalUrl: object.resource ?? "",
    ingestOutputs: storedIngest?.outputs ?? null,
    proxyUrl: storedIngestProxyUrl(object),
  });
  const [proxyFailed, setProxyFailed] = useState(false);
  const [corsDropped, setCorsDropped] = useState(false);
  const previewSrc = proxyFailed ? object.resource : preview.url;
  const stageCrossOrigin = stageVideoCrossOrigin(previewSrc ?? "", corsDropped);
  const localMs = (tMs ?? 0) - footageClipStartMs(object);
  const at = footageSourceAt(resolved, localMs);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.playbackRate = resolved.speed;
    video.volume = resolved.volume;
    const targetSec = at.sourceMs / 1000;
    if (tMs === null || at.frozen || at.ended) {
      video.pause();
      if (Math.abs(video.currentTime - targetSec) > 0.05) {
        try {
          video.currentTime = targetSec;
        } catch {
          // Metadata not loaded yet; the next clock tick retries.
        }
      }
      return;
    }
    if (Math.abs(video.currentTime - targetSec) > 0.35) {
      try {
        video.currentTime = targetSec;
      } catch {
        // Metadata not loaded yet; the next clock tick retries.
      }
    }
    if (video.paused) void video.play().catch(() => {});
  }, [at.sourceMs, at.frozen, at.ended, resolved.speed, resolved.volume, tMs]);
  // DOM stage compositing: draw the current footage frame through
  // the ONE shared drawMattedFrame path with the stored matte and
  // the chosen replacement background, exactly as the export path
  // does, so the stage preview matches the exported composite.
  useEffect(() => {
    if (matteLoad.status !== "ready" || !removal) return;
    const video = videoRef.current;
    const canvas = matteCanvasRef.current;
    const provider = matteAlphaProviderFor(object.id);
    if (!video || !canvas || !provider || video.videoWidth === 0) return;
    const w = Math.max(2, Math.round(object.position?.w ?? 320));
    const h = Math.max(2, Math.round(object.position?.h ?? 180));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const alpha = provider.alphaAt(at.sourceMs, w, h);
    if (!alpha) return;
    let backgroundFrame: RgbaFrame | null = null;
    if (removal.replacement.kind === "scene-background" && removal.replacement.background) {
      const rgb = parseHexColor(removal.replacement.background);
      const data = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = rgb.r; data[i + 1] = rgb.g; data[i + 2] = rgb.b; data[i + 3] = 255;
      }
      backgroundFrame = { width: w, height: h, data };
    }
    try {
      drawMattedFrame(ctx, video, alpha, removal.replacement, backgroundFrame, { x: 0, y: 0, w, h });
    } catch (err: unknown) {
      // Issue #122: a composite readback can throw (a cross-origin
      // frame taints the canvas and getImageData raises a
      // SecurityError). Uncaught, that throw unmounted the whole
      // editor (no error boundary) and left the tab on a blank dark
      // page. Surface the existing honest error state instead; the
      // plain footage keeps rendering.
      setMatteLoad({
        status: "error",
        progress: 0,
        error: err instanceof Error ? err.message : "the background removal preview could not be composited",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matteLoad.status, tMs, object.id]);

  const crop = resolved.crop;
  const videoStyle: CSSProperties = crop
    ? {
        position: "absolute",
        width: `${100 / crop.w}%`,
        height: `${100 / crop.h}%`,
        left: `${(-crop.x / crop.w) * 100}%`,
        top: `${(-crop.y / crop.h) * 100}%`,
        objectFit: "fill",
      }
    : { width: "100%", height: "100%", objectFit: "fill" };
  const matted = matteReady && matteLoad.status === "ready";
  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
      <video
        key={stageCrossOrigin ? "cors" : "plain"}
        ref={videoRef}
        src={previewSrc}
        crossOrigin={stageCrossOrigin}
        style={matted ? { ...videoStyle, visibility: "hidden" } : videoStyle}
        muted={resolved.volume === 0}
        playsInline
        preload="auto"
        onError={() => {
          // A source that refuses CORS fails to load in CORS mode:
          // drop to a plain load so playback still works. Only then
          // fall back from the ingest proxy to the original (issue #7).
          if (stageCrossOrigin && !corsDropped) setCorsDropped(true);
          else if (preview.isProxy) setProxyFailed(true);
        }}
      />
      {matteReady && (
        <canvas
          ref={matteCanvasRef}
          style={videoStyle}
          aria-label="Footage with background removed"
        />
      )}
      {matteReady && matteLoad.status === "loading" && (
        <div className="studio-placeholder" role="status">
          Loading background removal preview ({Math.round(matteLoad.progress * 100)} percent). {MATTE_HONEST_NOTE}
        </div>
      )}
      {matteReady && matteLoad.status === "error" && (
        <div className="studio-placeholder" role="alert">
          Background removal preview could not load: {matteLoad.error}
        </div>
      )}
    </div>
  );
}

function stripHtml(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return (div.textContent ?? "").trim();
}

function TextView({ object }: { object: CourseObject }) {
  const tMs = useContext(SceneTimeContext);
  const style: CSSProperties = {
    width: "100%",
    height: "100%",
    overflow: "hidden",
    fontSize: 22,
    lineHeight: 1.35,
    // Default stage ink (issues #178/#193/#194/#195): text objects carry
    // no color of their own, so without this the content inherited the
    // app chrome's --text (#e8eaf0) and rendered 1.2:1 on the default
    // white scene background, effectively invisible (the starter title).
    // #14161c is the theme's near-black (--bg), 18.08:1 on white. Inline
    // colors inside the content HTML and the motion-graphic textColor
    // override below still win over this default.
    color: "#14161c",
  };
  const dir = textDirectionOf(object);
  const meta = getMotionMeta(object);
  if (isMotionGraphicMeta(meta)) style.color = meta.params.textColor;
  // Kinetic text: render only the units whose reveal window has opened
  // at the current scene time. The export renderer samples the same
  // schedule, so stage and export show the same text at the same time.
  const reveal = tMs !== null ? kineticRevealForObject(object, stripHtml((object as { content?: string }).content ?? "")) : null;
  if (reveal) {
    return (
      <div style={{ ...style, whiteSpace: "pre-wrap" }} {...(dir ? { dir } : {})}>
        {kineticVisibleText(reveal, tMs ?? 0)}
      </div>
    );
  }
  return (
    <div
      style={style}
      {...(dir ? { dir } : {})}
      dangerouslySetInnerHTML={{ __html: (object as { content?: string }).content ?? "" }}
    />
  );
}

/**
 * Lottie view (issues #97, #100): renders the shared deterministic
 * renderer's SVG for the current scene clock time, quantized to the
 * export frame rate (30 fps) so the stage shows exactly the frames the
 * export paths will draw. The animation data loads once through the
 * shared loader; while it loads, or if it fails, the object shows an
 * honest placeholder instead of a fake frame.
 */
export const LOTTIE_EXPORT_FPS = 30;

function LottieView({ object }: { object: LottieObject }) {
  const tMs = useContext(SceneTimeContext);
  const [anim, setAnim] = useState<LottieAnimationData | undefined>(() =>
    getCachedLottieAnimation(object),
  );
  const [failed, setFailed] = useState(false);
  const sourceKey = object.animationData
    ? "inline"
    : (object.packId ?? object.resource ?? "");
  useEffect(() => {
    const cached = getCachedLottieAnimation(object);
    if (cached) {
      setAnim(cached);
      return;
    }
    let live = true;
    preloadLottieAnimation(object)
      .then((loaded) => {
        if (live) setAnim(loaded);
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [object.id, sourceKey]);
  if (failed) return <div className="studio-placeholder">Lottie file could not be loaded</div>;
  if (!anim) return <div className="studio-placeholder">Loading animation</div>;
  const localMs = quantizeMsToFps(lottieLocalMs(object, tMs ?? 0), LOTTIE_EXPORT_FPS);
  const svg = renderLottieSvg(anim, localMs, {
    colors: object.colors,
    loop: object.loop,
    speed: object.speed,
  });
  return (
    <div
      style={{ width: "100%", height: "100%" }}
      aria-label={object.name ?? "Lottie animation"}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

function ChartView({ object }: { object: ChartObject }) {
  const tMs = useContext(SceneTimeContext);
  const progress = chartProgress(object, tMs ?? 0);
  return (
    <div
      style={{ width: "100%", height: "100%" }}
      aria-label={object.name ?? "Chart"}
      dangerouslySetInnerHTML={{ __html: chartSvg(object, progress) }}
    />
  );
}


export function StudioObjectRenderer({
  object,
  drawOn,
}: {
  object: CourseObject;
  drawOn?: DrawOnRenderState;
}) {
  switch (object.type) {
    case "character":
      return <CharacterView object={object} />;
    case "lottie":
      return <LottieView object={object as LottieObject} />;
    case "chart":
      return <ChartView object={object as ChartObject} />;
    case "video":
      return <FootageView object={object as VideoObject} />;
    case "text":
      return <TextView object={object} />;
    case "shape": {
      if (drawOn && drawOn.sample.progress < 1) {
        return <ShapeDrawOnView object={object} drawOn={drawOn} />;
      }
      const isEllipse = object.shape === "ellipse";
      return (
        <div
          style={{
            width: "100%",
            height: "100%",
            background: (object.fill as string) ?? "#3b82f6",
            borderRadius: isEllipse ? "50%" : 8,
          }}
        />
      );
    }
    case "image": {
      const src = (object as { resource?: string }).resource;
      if (!src) return <div className="studio-placeholder">🖼 image</div>;
      const correction = getObjectColorCorrection(object);
      if (isNeutralColorCorrection(correction)) {
        return (
          <img
            src={src}
            alt={object.alt ?? ""}
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
            draggable={false}
          />
        );
      }
      // The stage applies the same canonical colour matrix the exports
      // apply per pixel, via an SVG feColorMatrix filter.
      const filterId = colorFilterIdFor(object.id);
      return (
        <>
          <svg aria-hidden="true" style={{ position: "absolute", width: 0, height: 0 }}>
            <defs>
              <filter id={filterId} colorInterpolationFilters="sRGB">
                <feColorMatrix type="matrix" values={feColorMatrixValues(correction)} />
              </filter>
            </defs>
          </svg>
          <img
            src={src}
            alt={object.alt ?? ""}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              filter: `url(#${filterId})`,
            }}
            draggable={false}
          />
        </>
      );
    }
    default:
      return (
        <div className="studio-placeholder" title={`Type "${object.type}" renders in the course player`}>
          {object.type}
        </div>
      );
  }
}

/** Plain-text for export canvas. */
export function studioTextContent(object: CourseObject): string {
  if (object.type === "text") return stripHtml(object.content ?? "");
  return "";
}
