/**
 * videoExport: render a VideoProject to a video blob on the client.
 *
 * Two paths share ONE frame renderer (the #8 parity rule: export frames
 * are the stage frames):
 * - exportVideoProject: real time canvas capture via MediaRecorder
 *   (MP4 where the browser supports it, else WebM).
 * - exportMp4Project: offline WebCodecs render via Mediabunny (issue
 *   #48), producing a real MP4 as fast as frames can be drawn.
 * The server FFmpeg pipeline (#33) remains the path for heavy footage
 * and headless renders.
 *
 * Characters render as the real rigged characters (@finch-studio/
 * characters): each character is pre-rendered as a frame set across its
 * action cycle with viseme lip sync during its speech lines, then
 * composited per frame. Path movement and facing are honored.
 *
 * Multi-scene: scenes render per projectTimeline with their seam transitions.
 * Audio is not mixed on the client paths yet; narration audio joins in
 * the server pipeline and the audio panel work.
 */
import type {
  CharacterObject,
  CourseObject,
  VideoProject,
} from "@finch-studio/core";
import {
  projectTimeline,
  transitionAlpha,
} from "@finch-studio/animation";
import { facingFromAngle, samplePath } from "@finch-studio/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ACTION_NAMES,
  RiggedCharacter,
  characterForLegacyId,
  defWithColors,
  mouthAt,
  visemesFromText,
  type ActionName,
} from "@finch-studio/characters";
import { timelineClipRange } from "./store";
import { getRenderViewport } from "./exportPresets";

const FPS = 30;

function stripHtml(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return (div.textContent ?? "").trim();
}

interface CharFrames {
  frames: HTMLImageElement[];
  frameMs: number;
  aspect: number; // width / height of the character art (200 / 400)
}

export function studioActionFor(name: string | undefined): ActionName {
  if (name && (ACTION_NAMES as string[]).includes(name)) return name as ActionName;
  if (name === "nod") return "talk";
  return "idle";
}

const FRAME_MS = 100;
const CYCLE_MS = 2600;

async function buildCharacterFrames(
  char: CharacterObject,
): Promise<CharFrames | null> {
  const def = defWithColors(characterForLegacyId(char.characterId), char.colors);
  const action = studioActionFor(char.characterAnimation);
  const frames: HTMLImageElement[] = [];
  for (let t = 0; t <= CYCLE_MS; t += FRAME_MS) {
    const line = (char.speech ?? []).find(
      (sp) => t >= sp.start && t < sp.start + sp.duration,
    );
    const mouth = line?.text
      ? mouthAt(visemesFromText(line.text), t - line.start)
      : undefined;
    const markup = renderToStaticMarkup(
      createElement(RiggedCharacter, {
        def,
        action,
        tMs: t,
        ...(mouth ? { mouthOverride: mouth } : {}),
      }),
    );
    const img = new Image();
    img.src =
      "data:image/svg+xml;charset=utf-8," + encodeURIComponent(markup);
    try {
      await img.decode();
    } catch {
      return null;
    }
    frames.push(img);
  }
  return { frames, frameMs: FRAME_MS, aspect: 0.5 };
}

function drawCharacter(
  ctx: CanvasRenderingContext2D,
  sprite: CharFrames,
  char: CharacterObject,
  tMs: number,
): void {
  const pos = char.position ?? {};
  const w = pos.w ?? 140;
  const h = pos.h ?? 280;
  let x = pos.x ?? 0;
  let y = pos.y ?? 0;
  let facing = char.facing ?? "right";

  // Path movement (shared sampler — same math as the live player).
  const path = char.path;
  if (path && path.length > 1) {
    const s = samplePath(path, tMs);
    x = s.x - w / 2;
    y = s.y - h;
    facing = facingFromAngle(s.angleDeg);
  }

  const frame =
    sprite.frames[
      Math.min(sprite.frames.length - 1, Math.floor(tMs / sprite.frameMs))
    ];
  if (!frame) return;
  ctx.save();
  if (facing === "left") {
    ctx.translate(x + w, y);
    ctx.scale(-1, 1);
    ctx.drawImage(frame, 0, 0, w, h);
  } else {
    ctx.drawImage(frame, x, y, w, h);
  }
  ctx.restore();

  // Active speech bubble.
  const line = (char.speech ?? []).find(
    (s) => tMs >= s.start && tMs < s.start + s.duration,
  );
  if (line?.text) {
    drawBubble(ctx, x + w / 2, y - 12, line.text);
  }
}

function drawBubble(
  ctx: CanvasRenderingContext2D,
  cx: number,
  topY: number,
  text: string,
): void {
  const font = "16px system-ui, sans-serif";
  ctx.font = font;
  const maxW = 260;
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  const bw = Math.min(maxW, Math.max(...lines.map((l) => ctx.measureText(l).width))) + 24;
  const bh = lines.length * 22 + 20;
  const bx = Math.max(4, cx - bw / 2);
  const by = Math.max(4, topY - bh);
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.strokeStyle = "#94a3b8";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(bx, by, bw, bh, 10);
  ctx.fill();
  ctx.stroke();
  // Tail.
  ctx.beginPath();
  ctx.moveTo(cx - 8, by + bh - 1);
  ctx.lineTo(cx + 8, by + bh - 1);
  ctx.lineTo(cx, by + bh + 10);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#1e293b";
  ctx.textBaseline = "top";
  lines.forEach((l, i) => ctx.fillText(l, bx + 12, by + 10 + i * 22));
  ctx.restore();
}

function drawObject(
  ctx: CanvasRenderingContext2D,
  sprites: Map<string, CharFrames>,
  o: CourseObject,
  tMs: number,
): void {
  if (o.visible === false) return;
  switch (o.type) {
    case "character": {
      const sprite = sprites.get(o.id);
      if (sprite) drawCharacter(ctx, sprite, o as CharacterObject, tMs);
      break;
    }
    case "text": {
      const pos = o.position ?? {};
      const text = stripHtml((o as { content?: string }).content ?? "");
      if (!text) break;
      ctx.save();
      ctx.font = "22px system-ui, sans-serif";
      ctx.fillStyle = "#1a1a1a";
      ctx.textBaseline = "top";
      const w = pos.w ?? 400;
      const h = pos.h ?? 96;
      const words = text.split(/\s+/);
      const lineH = 30;
      let line = "";
      let ly = pos.y ?? 0;
      const x = pos.x ?? 0;
      for (const word of words) {
        const test = line ? `${line} ${word}` : word;
        if (ctx.measureText(test).width > w && line) {
          ctx.fillText(line, x, ly, w);
          line = word;
          ly += lineH;
          if (ly > (pos.y ?? 0) + h) break;
        } else {
          line = test;
        }
      }
      if (line) ctx.fillText(line, x, ly, w);
      ctx.restore();
      break;
    }
    case "shape": {
      const pos = o.position ?? {};
      const fill = (o as { fill?: string }).fill ?? "#3b82f6";
      ctx.save();
      ctx.fillStyle = fill;
      if ((o as { shape?: string }).shape === "ellipse") {
        ctx.beginPath();
        ctx.ellipse(
          (pos.x ?? 0) + (pos.w ?? 0) / 2,
          (pos.y ?? 0) + (pos.h ?? 0) / 2,
          (pos.w ?? 0) / 2,
          (pos.h ?? 0) / 2,
          0, 0, Math.PI * 2,
        );
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.roundRect(pos.x ?? 0, pos.y ?? 0, pos.w ?? 0, pos.h ?? 0, 8);
        ctx.fill();
      }
      ctx.restore();
      break;
    }
    default:
      break;
  }
}

export interface CaptionOptions {
  captions?: boolean;
}

/** Burned in captions: the active dialogue line, bottom centre. */
function drawCaptionOverlay(
  ctx: CanvasRenderingContext2D,
  scene: { objects: CourseObject[] },
  localT: number,
  width: number,
  height: number,
): void {
  let text = "";
  for (const o of scene.objects) {
    if (o.type !== "character") continue;
    const line = ((o as CharacterObject).speech ?? []).find(
      (sp) => localT >= sp.start && localT < sp.start + sp.duration,
    );
    if (line?.text) {
      text = line.text;
      break;
    }
  }
  if (!text) return;
  const fontPx = Math.max(18, Math.round(height * 0.032));
  ctx.save();
  ctx.font = `${fontPx}px system-ui, sans-serif`;
  const maxW = width * 0.84;
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, 2);
  const lineH = fontPx * 1.3;
  const boxH = shown.length * lineH + 16;
  const boxW = Math.min(maxW, Math.max(...shown.map((l) => ctx.measureText(l).width))) + 28;
  const bx = (width - boxW) / 2;
  const by = height - boxH - Math.round(height * 0.045);
  ctx.fillStyle = "rgba(0,0,0,0.72)";
  ctx.beginPath();
  ctx.roundRect(bx, by, boxW, boxH, 8);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  shown.forEach((l, i) => ctx.fillText(l, width / 2, by + 8 + i * lineH));
  ctx.restore();
}

/** Render the whole project to a browser-supported MP4 or WebM blob. */
export async function exportVideoProject(
  project: VideoProject,
  onProgress?: (fraction: number) => void,
  dimensions: { width: number; height: number } = { width: 1280, height: 720 },
  options: CaptionOptions = {},
): Promise<Blob> {
  if (
    typeof MediaRecorder === "undefined" ||
    !HTMLCanvasElement.prototype.captureStream
  ) {
    throw new Error(
      "Video export needs MediaRecorder + canvas.captureStream (use Chrome or Edge).",
    );
  }

  const { width, height } = dimensions;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("The selected video preset has invalid dimensions. Choose another preset.");
  }
  const viewport = getRenderViewport(width, height);
  const { scenes: tl, totalMs } = projectTimeline(project);
  if (tl.length === 0) throw new Error("Project has no scenes.");
  const totalFrames = Math.max(1, Math.round((totalMs / 1000) * FPS));

  // Pre-render character frame sets.
  const sprites = new Map<string, CharFrames>();
  const chars: CharacterObject[] = [];
  for (const scene of project.scenes) {
    for (const o of scene.objects) {
      if (o.type === "character") chars.push(o as CharacterObject);
    }
  }
  await Promise.all(
    chars.map(async (c) => {
      const sprite = await buildCharacterFrames(c);
      if (sprite) sprites.set(c.id, sprite);
    }),
  );

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D canvas context.");

  // Offscreen canvas per scene for transition compositing.
  const sceneCanvas = document.createElement("canvas");
  sceneCanvas.width = width;
  sceneCanvas.height = height;
  const sctx = sceneCanvas.getContext("2d");
  if (!sctx) throw new Error("Could not create the transition-compositing canvas. Try another browser.");
  const previousCanvas = document.createElement("canvas");
  previousCanvas.width = width;
  previousCanvas.height = height;
  const pctx = previousCanvas.getContext("2d");
  if (!pctx) throw new Error("Could not create the transition-compositing canvas. Try another browser.");

  let stream: MediaStream;
  try {
    stream = canvas.captureStream(FPS);
  } catch {
    throw new Error("Canvas capture could not start. Refresh the editor and try again.");
  }
  const mimeTypes = [
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm",
  ];
  const mimeType = mimeTypes.find((type) => MediaRecorder.isTypeSupported(type));
  if (!mimeType) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("This browser cannot encode MP4 or WebM. Try Chrome or Edge.");
  }
  let rec: MediaRecorder;
  try {
    rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
  } catch {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error("The browser could not start the video encoder. Try Chrome or Edge.");
  }
  const chunks: BlobPart[] = [];
  const done = new Promise<Blob>((resolve, reject) => {
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => {
      if (chunks.length === 0) {
        reject(new Error("The browser produced an empty video. Try another preset or browser."));
        return;
      }
      resolve(new Blob(chunks, { type: rec.mimeType || mimeType }));
    };
    rec.onerror = () =>
      reject(new Error("The browser video encoder failed. Try a shorter project or another preset."));
  });

  const frameMs = 1000 / FPS;
  const renderSceneFrame = (
    target: CanvasRenderingContext2D,
    scene: (typeof tl)[number]["scene"],
    localT: number,
  ) => {
    target.save();
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.fillStyle = scene.background ?? "#ffffff";
    target.fillRect(0, 0, width, height);
    target.setTransform(
      viewport.scale,
      0,
      0,
      viewport.scale,
      viewport.offsetX,
      viewport.offsetY,
    );
    for (const o of scene.objects) {
      const range = timelineClipRange(o, scene.durationMs);
      if (localT >= range.startMs && localT < range.startMs + range.durationMs) {
        drawObject(target, sprites, o, localT);
      }
    }
    target.restore();
  };

  try {
    rec.start(200);

    for (let f = 0; f < totalFrames; f++) {
      const tMs = Math.min(totalMs, (f * 1000) / FPS);
      // Active scene: later scene wins during a transition overlap.
      let segIdx = tl.length - 1;
      for (let i = tl.length - 1; i >= 0; i--) {
        if (tMs >= tl[i].startMs && tMs < tl[i].endMs) {
          segIdx = i;
          break;
        }
      }
      const seg = tl[segIdx];
      const localT = Math.min(seg.scene.durationMs, tMs - seg.startMs);

      const progress = transitionAlpha(project, tMs);
      const transition = seg.scene.transition ?? "cut";
      if (segIdx > 0 && progress < 1 && transition !== "cut") {
        const prev = tl[segIdx - 1];
        const prevLocal = Math.min(
          prev.scene.durationMs,
          tMs - prev.startMs,
        );
        renderSceneFrame(sctx, seg.scene, localT);
        if (transition === "fade") {
          renderSceneFrame(pctx, prev.scene, Math.max(0, prevLocal));
          ctx.drawImage(previousCanvas, 0, 0);
          ctx.globalAlpha = progress;
          ctx.drawImage(sceneCanvas, 0, 0);
          ctx.globalAlpha = 1;
        } else if (transition === "push") {
          renderSceneFrame(pctx, prev.scene, Math.max(0, prevLocal));
          ctx.drawImage(previousCanvas, -progress * width, 0);
          ctx.drawImage(sceneCanvas, (1 - progress) * width, 0);
        } else if (transition === "slide") {
          renderSceneFrame(ctx, prev.scene, Math.max(0, prevLocal));
          ctx.drawImage(sceneCanvas, (1 - progress) * width, 0);
        } else if (transition === "wipe") {
          renderSceneFrame(ctx, prev.scene, Math.max(0, prevLocal));
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, 0, progress * width, height);
          ctx.clip();
          ctx.drawImage(sceneCanvas, 0, 0);
          ctx.restore();
        } else {
          renderSceneFrame(ctx, prev.scene, Math.max(0, prevLocal));
          const scale = 0.8 + progress * 0.2;
          const offsetX = (width * (1 - scale)) / 2;
          const offsetY = (height * (1 - scale)) / 2;
          ctx.drawImage(sceneCanvas, offsetX, offsetY, width * scale, height * scale);
        }
      } else {
        renderSceneFrame(ctx, seg.scene, localT);
      }
      if (options.captions) drawCaptionOverlay(ctx, seg.scene, localT, width, height);

      onProgress?.((f + 1) / totalFrames);
      await new Promise((r) => setTimeout(r, frameMs));
    }

    rec.stop();
    return await done;
  } catch (error) {
    if (rec.state !== "inactive") rec.stop();
    throw error;
  } finally {
    stream.getTracks().forEach((track) => track.stop());
  }
}

/**
 * Offline MP4 export via WebCodecs + Mediabunny (issue #48). Draws the
 * same frames as the real time path into a canvas and encodes them as
 * fast as they render. Throws a clear error when WebCodecs is missing
 * so the UI can fall back to the real time path.
 */
export async function exportMp4Project(
  project: VideoProject,
  onProgress?: (fraction: number) => void,
  dimensions: { width: number; height: number } = { width: 1280, height: 720 },
  options: CaptionOptions = {},
): Promise<Blob> {
  if (typeof VideoEncoder === "undefined") {
    throw new Error(
      "MP4 export needs WebCodecs (use Chrome or Edge), or pick the WebM export instead.",
    );
  }
  const { Output, Mp4OutputFormat, BufferTarget, CanvasSource } =
    await import("mediabunny");
  const { width, height } = dimensions;
  const viewport = getRenderViewport(width, height);
  const { scenes: tl, totalMs } = projectTimeline(project);
  if (tl.length === 0) throw new Error("Project has no scenes.");
  const totalFrames = Math.max(1, Math.round((totalMs / 1000) * FPS));

  const sprites = new Map<string, CharFrames>();
  const chars: CharacterObject[] = [];
  for (const scene of project.scenes) {
    for (const o of scene.objects) {
      if (o.type === "character") chars.push(o as CharacterObject);
    }
  }
  await Promise.all(
    chars.map(async (c) => {
      const frames = await buildCharacterFrames(c);
      if (frames) sprites.set(c.id, frames);
    }),
  );

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D canvas context.");
  const sceneCanvas = document.createElement("canvas");
  sceneCanvas.width = width;
  sceneCanvas.height = height;
  const sctx = sceneCanvas.getContext("2d");
  if (!sctx) throw new Error("Could not create the transition-compositing canvas.");
  const previousCanvas = document.createElement("canvas");
  previousCanvas.width = width;
  previousCanvas.height = height;
  const pctx = previousCanvas.getContext("2d");
  if (!pctx) throw new Error("Could not create the transition-compositing canvas.");

  const renderSceneFrame = (
    target: CanvasRenderingContext2D,
    scene: (typeof tl)[number]["scene"],
    localT: number,
  ) => {
    target.save();
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.fillStyle = scene.background ?? "#ffffff";
    target.fillRect(0, 0, width, height);
    target.setTransform(
      viewport.scale, 0, 0, viewport.scale, viewport.offsetX, viewport.offsetY,
    );
    for (const o of scene.objects) {
      const range = timelineClipRange(o, scene.durationMs);
      if (localT >= range.startMs && localT < range.startMs + range.durationMs) {
        drawObject(target, sprites, o, localT);
      }
    }
    target.restore();
  };

  const output = new Output({
    format: new Mp4OutputFormat(),
    target: new BufferTarget(),
  });
  const source = new CanvasSource(canvas, {
    codec: "avc",
    bitrate: 8_000_000,
  });
  output.addVideoTrack(source);
  await output.start();

  for (let f = 0; f < totalFrames; f++) {
    const tMs = Math.min(totalMs, (f * 1000) / FPS);
    let segIdx = tl.length - 1;
    for (let i = tl.length - 1; i >= 0; i--) {
      if (tMs >= tl[i].startMs && tMs < tl[i].endMs) {
        segIdx = i;
        break;
      }
    }
    const seg = tl[segIdx];
    const localT = Math.min(seg.scene.durationMs, tMs - seg.startMs);
    const progress = transitionAlpha(project, tMs);
    const transition = seg.scene.transition ?? "cut";
    if (segIdx > 0 && progress < 1 && transition !== "cut") {
      const prev = tl[segIdx - 1];
      const prevLocal = Math.min(prev.scene.durationMs, tMs - prev.startMs);
      renderSceneFrame(sctx, seg.scene, localT);
      if (transition === "fade") {
        renderSceneFrame(pctx, prev.scene, Math.max(0, prevLocal));
        ctx.drawImage(previousCanvas, 0, 0);
        ctx.globalAlpha = progress;
        ctx.drawImage(sceneCanvas, 0, 0);
        ctx.globalAlpha = 1;
      } else if (transition === "push") {
        renderSceneFrame(pctx, prev.scene, Math.max(0, prevLocal));
        ctx.drawImage(previousCanvas, -progress * width, 0);
        ctx.drawImage(sceneCanvas, (1 - progress) * width, 0);
      } else if (transition === "slide") {
        renderSceneFrame(ctx, prev.scene, Math.max(0, prevLocal));
        ctx.drawImage(sceneCanvas, (1 - progress) * width, 0);
      } else if (transition === "wipe") {
        renderSceneFrame(ctx, prev.scene, Math.max(0, prevLocal));
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, progress * width, height);
        ctx.clip();
        ctx.drawImage(sceneCanvas, 0, 0);
        ctx.restore();
      } else {
        renderSceneFrame(ctx, prev.scene, Math.max(0, prevLocal));
        const scale = 0.8 + progress * 0.2;
        const offsetX = (width * (1 - scale)) / 2;
        const offsetY = (height * (1 - scale)) / 2;
        ctx.drawImage(sceneCanvas, offsetX, offsetY, width * scale, height * scale);
      }
    } else {
      renderSceneFrame(ctx, seg.scene, localT);
    }
    if (options.captions) drawCaptionOverlay(ctx, seg.scene, localT, width, height);
    await source.add(f / FPS, 1 / FPS);
    onProgress?.((f + 1) / totalFrames);
  }

  await output.finalize();
  const buffer = (output.target as InstanceType<typeof BufferTarget>).buffer;
  if (!buffer) throw new Error("The MP4 encoder produced no output.");
  return new Blob([buffer], { type: "video/mp4" });
}
