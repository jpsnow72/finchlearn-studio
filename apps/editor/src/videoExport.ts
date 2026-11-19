/**
 * videoExport: legacy quick export, render a VideoProject to WebM (canvas
 * plus MediaRecorder). This is the fast preview grade path kept from the
 * extracted video studio app. The production render paths are the client
 * WebCodecs export and the server FFmpeg pipeline (issues #48 and #33),
 * which must match the stage canvas frame for frame (issue #8 parity rule).
 *
 * Characters export as placeholder silhouettes drawn on an offscreen canvas:
 * the real rigged characters are a design-first workstream (issue #16) and
 * plug into the CharacterFigure seam. Path movement and facing are honored.
 *
 * Multi-scene: scenes render per projectTimeline with their seam transitions.
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

const FPS = 30;

function stripHtml(html: string): string {
  const div = document.createElement("div");
  div.innerHTML = html;
  return (div.textContent ?? "").trim();
}

interface CharSprite {
  img: HTMLCanvasElement;
  aspect: number; // width / height of the placeholder silhouette
}

async function renderCharacterSprite(
  char: CharacterObject,
): Promise<CharSprite | null> {
  const canvas = document.createElement("canvas");
  canvas.width = 120;
  canvas.height = 240;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = "#9aa7b4";
  ctx.beginPath();
  ctx.ellipse(60, 52, 26, 30, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(28, 96);
  ctx.quadraticCurveTo(60, 78, 92, 96);
  ctx.lineTo(98, 226);
  ctx.quadraticCurveTo(60, 238, 22, 226);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(char.name ?? "Character", 60, 140, 100);
  return { img: canvas, aspect: 0.5 };
}

function drawCharacter(
  ctx: CanvasRenderingContext2D,
  sprite: CharSprite,
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

  ctx.save();
  if (facing === "left") {
    ctx.translate(x + w, y);
    ctx.scale(-1, 1);
    ctx.drawImage(sprite.img, 0, 0, w, h);
  } else {
    ctx.drawImage(sprite.img, x, y, w, h);
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
  sprites: Map<string, CharSprite>,
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

/** Render the whole project to a WebM blob. */
export async function exportVideoProject(
  project: VideoProject,
  onProgress?: (fraction: number) => void,
): Promise<Blob> {
  if (
    typeof MediaRecorder === "undefined" ||
    !HTMLCanvasElement.prototype.captureStream
  ) {
    throw new Error(
      "Video export needs MediaRecorder + canvas.captureStream (use Chrome or Edge).",
    );
  }

  const width = 1280;
  const height = 720;
  const { scenes: tl, totalMs } = projectTimeline(project);
  if (tl.length === 0) throw new Error("Project has no scenes.");
  const totalFrames = Math.max(1, Math.round((totalMs / 1000) * FPS));

  // Pre-render character sprites.
  const sprites = new Map<string, CharSprite>();
  const chars: CharacterObject[] = [];
  for (const scene of project.scenes) {
    for (const o of scene.objects) {
      if (o.type === "character") chars.push(o as CharacterObject);
    }
  }
  await Promise.all(
    chars.map(async (c) => {
      const sprite = await renderCharacterSprite(c);
      if (sprite) sprites.set(c.id, sprite);
    }),
  );

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get 2D canvas context.");

  const stream = canvas.captureStream(FPS);
  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
    ? "video/webm;codecs=vp9"
    : "video/webm";
  const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
  const chunks: BlobPart[] = [];
  const done = new Promise<Blob>((resolve, reject) => {
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => resolve(new Blob(chunks, { type: "video/webm" }));
    rec.onerror = () => reject(new Error("MediaRecorder error during video export."));
  });
  rec.start(200);

  // Offscreen canvases for transition compositing.
  const sceneCanvas = document.createElement("canvas");
  sceneCanvas.width = width;
  sceneCanvas.height = height;
  const sctx = sceneCanvas.getContext("2d");
  if (!sctx) throw new Error("Could not get 2D canvas context.");
  const previousCanvas = document.createElement("canvas");
  previousCanvas.width = width;
  previousCanvas.height = height;
  const pctx = previousCanvas.getContext("2d");
  if (!pctx) throw new Error("Could not get 2D canvas context.");

  const frameMs = 1000 / FPS;
  const renderSceneFrame = (
    target: CanvasRenderingContext2D,
    scene: (typeof tl)[number]["scene"],
    localT: number,
  ) => {
    target.fillStyle = scene.background ?? "#ffffff";
    target.fillRect(0, 0, width, height);
    for (const o of scene.objects) drawObject(target, sprites, o, localT);
  };

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

    onProgress?.((f + 1) / totalFrames);
    await new Promise((r) => setTimeout(r, frameMs));
  }

  rec.stop();
  return done;
}
