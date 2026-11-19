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
 * Audio mixes through buildProjectAudio (shared by both client paths
 * and by the server render host): narration, clips with fades and
 * volume keyframes, music ducking, and per clip Clean Voice (#29).
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
import { timelineClipRange, timelineLaneForObject, characterVoiceId } from "./store";
import {
  audioRoleForObject,
  getAudioClipMetadata,
  getCleanVoiceSettings,
  isDescriptionObject,
} from "./audioEditing";
import {
  connectCleanVoice,
  encodeWav,
  planAudioExport,
  type AudioClip as EngineAudioClip,
  type CleanVoiceContext,
  type DescriptionExportMode,
} from "@finch-studio/audio";
import { ensureLineAudio } from "./narration";
import { getCaptionAt, getCaptionStyle } from "./captions";
import { getRenderViewport } from "./exportPresets";
import { bundledBackgroundFromRef } from "./content/bundledContent";
import type { AudioObject } from "@finch-studio/core";

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


interface ImageSprites {
  /** Image objects by object id (bundled props and placed media). */
  objects: Map<string, HTMLImageElement>;
  /** Bundled background art by scene id (issue #101). */
  backgrounds: Map<string, HTMLImageElement>;
}

async function loadSpriteImage(src: string): Promise<HTMLImageElement | null> {
  const img = new Image();
  img.src = src;
  try {
    await img.decode();
    return img;
  } catch {
    return null;
  }
}

/** Preload every image object and bundled scene background for export. */
async function buildImageSprites(project: VideoProject): Promise<ImageSprites> {
  const objects = new Map<string, HTMLImageElement>();
  const backgrounds = new Map<string, HTMLImageElement>();
  const jobs: Promise<void>[] = [];
  for (const scene of project.scenes) {
    const bg = bundledBackgroundFromRef(scene.background);
    if (bg) {
      jobs.push(loadSpriteImage(bg.dataUri).then((img) => {
        if (img) backgrounds.set(scene.id, img);
      }));
    }
    for (const o of scene.objects) {
      if (o.type !== "image") continue;
      const resource = (o as { resource?: string }).resource;
      if (!resource) continue;
      jobs.push(loadSpriteImage(resource).then((img) => {
        if (img) objects.set(o.id, img);
      }));
    }
  }
  await Promise.all(jobs);
  return { objects, backgrounds };
}

function drawObject(
  ctx: CanvasRenderingContext2D,
  sprites: Map<string, CharFrames>,
  o: CourseObject,
  tMs: number,
  images?: Map<string, HTMLImageElement>,
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
    case "image": {
      const img = images?.get(o.id);
      if (!img) break;
      const pos = o.position ?? {};
      ctx.drawImage(img, pos.x ?? 0, pos.y ?? 0, pos.w ?? 200, pos.h ?? 100);
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
  /**
   * Container for the offline render. "webm" (VP9 + Opus) exists for
   * environments whose WebCodecs has no AAC encoder, notably headless
   * Linux Chrome in the server renderer (#33): the render service
   * transcodes the WebM to a delivery MP4 with FFmpeg.
   */
  container?: "mp4" | "webm";
  /**
   * Audio Description handling (issue #63). "mixed" (the default) mixes
   * the description track into the export with primary audio ducking
   * under it. "secondary" keeps the description out of the main mix;
   * the caller exports it separately with exportDescriptionTrackFiles.
   */
  audioDescriptionMode?: DescriptionExportMode;
}

const MIX_SAMPLE_RATE = 48000;

function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

/**
 * Every audio clip in the project as an audio engine clip (issue #63):
 * scene offsets applied, the engine role resolved from the clip's
 * metadata or timeline lane, and the AD script text carried through.
 * This is the single list the AD export plan is computed from, so the
 * plan the UI shows is the plan the render follows.
 */
export function projectAudioClips(project: VideoProject): EngineAudioClip[] {
  const { scenes: tl } = projectTimeline(project);
  const clips: EngineAudioClip[] = [];
  for (const entry of tl) {
    for (const o of entry.scene.objects) {
      if (o.type !== "audio") continue;
      const ao = o as AudioObject;
      if (!ao.resource) continue;
      const range = timelineClipRange(o, entry.scene.durationMs);
      const meta = getAudioClipMetadata(ao);
      clips.push({
        id: ao.id,
        assetR2Key: ao.resource,
        role: audioRoleForObject(ao, timelineLaneForObject(o)),
        startMs: entry.startMs + range.startMs,
        durationMs: range.durationMs,
        sourceInMs: meta.sourceOffsetMs ?? 0,
        gain: ao.volume ?? 1,
        fadeInMs: meta.fadeInMs ?? 0,
        fadeOutMs: meta.fadeOutMs ?? 0,
        descriptionText: meta.descriptionText,
      });
    }
  }
  return clips;
}

/** True when the project carries a dedicated Audio Description track. */
export function projectHasDescriptionTrack(project: VideoProject): boolean {
  return planAudioExport(projectAudioClips(project), "secondary").hasDescription;
}

/** The VTT contents for the description track, or null when there is no AD. */
export function formatDescriptionTrackVtt(project: VideoProject): string | null {
  return planAudioExport(projectAudioClips(project), "secondary").descriptionVtt;
}

/**
 * The project's full audio mix, rendered offline: narration lines
 * (production voices, generated on demand) at their scene offsets,
 * plus audio clips with fades, volume keyframes, and music ducking
 * under speech. Returns null when the project has no audio content.
 * Throws when a narration line cannot be generated, because a silent
 * training video is worse than a clear retry prompt.
 *
 * Audio Description (issue #63): in "mixed" mode (default) description
 * clips are part of the mix and every primary source (narration, music,
 * sfx) ducks under them. In "secondary" mode description clips are left
 * out of this mix entirely; exportDescriptionTrackFiles renders them
 * as their own track.
 */
export async function buildProjectAudio(
  project: VideoProject,
  audioDescriptionMode: DescriptionExportMode = "mixed",
): Promise<AudioBuffer | null> {
  return renderProjectAudio(project, { audioDescriptionMode, onlyDescription: false });
}

/** The description track on its own, for the secondary export. */
export async function buildDescriptionAudio(project: VideoProject): Promise<AudioBuffer | null> {
  return renderProjectAudio(project, { audioDescriptionMode: "mixed", onlyDescription: true });
}

/**
 * The secondary AD export files (issue #63): the description track as a
 * WAV audio file plus its timed VTT track, ready to sit alongside the
 * main export and the captions file. Null when the project has no AD.
 */
export async function exportDescriptionTrackFiles(
  project: VideoProject,
): Promise<{ wav: Blob; vtt: string } | null> {
  const vtt = formatDescriptionTrackVtt(project);
  if (vtt === null) return null;
  const buffer = await buildDescriptionAudio(project);
  if (!buffer) return null;
  const wavBytes = encodeWav(buffer);
  return {
    wav: new Blob([wavBytes.buffer as ArrayBuffer], { type: "audio/wav" }),
    vtt,
  };
}

async function renderProjectAudio(
  project: VideoProject,
  mode: { audioDescriptionMode: DescriptionExportMode; onlyDescription: boolean },
): Promise<AudioBuffer | null> {
  const { scenes: tl, totalMs } = projectTimeline(project);
  if (tl.length === 0) return null;
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil((totalMs / 1000) * MIX_SAMPLE_RATE)), MIX_SAMPLE_RATE);
  let scheduled = 0;

  const speechWindows: { start: number; end: number }[] = [];
  for (const entry of tl) {
    for (const o of entry.scene.objects) {
      if (o.type !== "character") continue;
      for (const line of (o as CharacterObject).speech ?? []) {
        speechWindows.push({
          start: (entry.startMs + line.start) / 1000,
          end: (entry.startMs + line.start + line.duration) / 1000,
        });
      }
    }
  }

  // Audio Description windows (seconds, project time). Primary audio
  // ducks under these in mixed mode; in secondary mode and in the
  // description only render there is nothing to duck.
  const descriptionWindows: { start: number; end: number }[] = [];
  for (const entry of tl) {
    for (const o of entry.scene.objects) {
      if (o.type !== "audio") continue;
      if (!isDescriptionObject(o as AudioObject, timelineLaneForObject(o))) continue;
      const range = timelineClipRange(o, entry.scene.durationMs);
      descriptionWindows.push({
        start: (entry.startMs + range.startMs) / 1000,
        end: (entry.startMs + range.startMs + range.durationMs) / 1000,
      });
    }
  }
  const adDuckWindows =
    mode.audioDescriptionMode === "mixed" && !mode.onlyDescription
      ? descriptionWindows
      : [];

  const DUCK = 0.3;
  const DUCK_RAMP = 0.15;
  const automateDuck = (
    param: AudioParam,
    startSec: number,
    durSec: number,
    windows: { start: number; end: number }[],
  ) => {
    if (windows.length === 0) return;
    param.setValueAtTime(1, startSec);
    for (const w of windows) {
      const ws = Math.max(startSec, w.start - 0.1);
      const we = Math.min(startSec + durSec, w.end + 0.2);
      if (we <= ws) continue;
      param.linearRampToValueAtTime(DUCK, Math.max(startSec, ws - DUCK_RAMP));
      param.setValueAtTime(DUCK, we);
      param.linearRampToValueAtTime(1, Math.min(startSec + durSec, we + DUCK_RAMP));
    }
  };

  // Narration. A scene with a chosen recorded voiceover (#31) speaks
  // with the recording instead: its lines are not generated here, and
  // the voiceover clip itself is scheduled in the audio clips loop
  // below like any other audio clip.
  for (const entry of tl) {
    if (mode.onlyDescription) break;
    const hasVoiceover = entry.scene.objects.some(
      (o) => o.type === "audio" && getAudioClipMetadata(o as AudioObject).voiceover,
    );
    if (hasVoiceover) continue;

    for (const o of entry.scene.objects) {
      if (o.type !== "character") continue;
      const voice = characterVoiceId(o);
      if (!voice) continue;
      for (const line of (o as CharacterObject).speech ?? []) {
        if (!line.text.trim()) continue;
        const { blob } = await ensureLineAudio(line.text, voice);
        const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const narrationGain = ctx.createGain();
        src.connect(narrationGain);
        narrationGain.connect(ctx.destination);
        const startSec = (entry.startMs + line.start) / 1000;
        automateDuck(narrationGain.gain, startSec, buf.duration, adDuckWindows);
        src.start(startSec);
        scheduled++;
      }
    }
  }

  // Audio clips (music / sfx / uploaded audio).
  for (const entry of tl) {
    for (const o of entry.scene.objects) {
      if (o.type !== "audio") continue;
      const ao = o as AudioObject;
      if (!ao.resource) continue;
      const descriptionClip = isDescriptionObject(ao, timelineLaneForObject(o));
      if (mode.onlyDescription && !descriptionClip) continue;
      if (!mode.onlyDescription && mode.audioDescriptionMode === "secondary" && descriptionClip) {
        continue; // Secondary mode: AD exports as its own track, not in this mix.
      }
      const range = timelineClipRange(o, entry.scene.durationMs);
      const meta = getAudioClipMetadata(ao);
      let buf: AudioBuffer;
      try {
        const res = await fetch(ao.resource);
        if (!res.ok) continue;
        buf = await ctx.decodeAudioData(await res.arrayBuffer());
      } catch {
        continue; // A dead clip URL must not kill the whole export.
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const fadeGain = ctx.createGain();
      const keyGain = ctx.createGain();
      const duckGain = ctx.createGain();
      // Clean Voice (#29) sits between the keyframe gain and the duck
      // gain. When the clip has it off, connectCleanVoice creates no
      // nodes and the wiring is exactly the pre Clean Voice chain.
      // Both client export paths and the server render path share
      // this mix (the render host drives exportMp4Project), so the
      // cleanup is identical everywhere.
      const clean = connectCleanVoice(
        ctx as unknown as CleanVoiceContext,
        duckGain as never,
        getCleanVoiceSettings(ao),
      );
      src.connect(fadeGain);
      fadeGain.connect(keyGain);
      keyGain.connect(clean.input as unknown as AudioNode);
      if (!clean.bypassed) (clean.output as unknown as AudioNode).connect(duckGain);
      duckGain.connect(ctx.destination);
      const startSec = (entry.startMs + range.startMs) / 1000;
      const durSec = Math.min(range.durationMs / 1000, buf.duration - (meta.sourceOffsetMs ?? 0) / 1000);
      if (durSec <= 0) continue;
      // Fades.
      const fadeIn = Math.min((meta.fadeInMs ?? 0) / 1000, durSec / 2);
      const fadeOut = Math.min((meta.fadeOutMs ?? 0) / 1000, durSec / 2);
      fadeGain.gain.setValueAtTime(fadeIn > 0 ? 0 : 1, startSec);
      if (fadeIn > 0) fadeGain.gain.linearRampToValueAtTime(1, startSec + fadeIn);
      if (fadeOut > 0) {
        fadeGain.gain.setValueAtTime(1, startSec + durSec - fadeOut);
        fadeGain.gain.linearRampToValueAtTime(0, startSec + durSec);
      }
      // Volume keyframes (dB offsets over the clip).
      const keys = [...(meta.volumeKeyframes ?? [])].sort((a, b) => a.timeMs - b.timeMs);
      if (keys.length > 0) {
        keyGain.gain.setValueAtTime(dbToGain(keys[0]!.decibels), startSec);
        for (const k of keys) {
          keyGain.gain.linearRampToValueAtTime(dbToGain(k.decibels), startSec + k.timeMs / 1000);
        }
      }
      // Ducking: music under narration (standing behaviour), and every
      // primary clip under the Audio Description track in mixed mode
      // (issue #63). Description clips themselves never duck.
      const duckWindows = descriptionClip
        ? []
        : [
            ...adDuckWindows,
            ...(timelineLaneForObject(o) === "music" ? speechWindows : []),
          ];
      automateDuck(duckGain.gain, startSec, durSec, duckWindows);
      src.start(startSec, (meta.sourceOffsetMs ?? 0) / 1000, durSec);
      scheduled++;
    }
  }

  if (scheduled === 0) return null;
  return ctx.startRendering();
}

/** Burned in captions use the project caption list and its global style. */
function drawCaptionOverlay(
  ctx: CanvasRenderingContext2D,
  project: VideoProject,
  scene: { id: string; objects: CourseObject[] },
  localT: number,
  width: number,
  height: number,
): void {
  const text = getCaptionAt(project, scene.id, localT) ?? "";
  if (!text) return;
  const style = getCaptionStyle(project);
  const fontFamily = style.font === "serif"
    ? "Georgia, serif"
    : style.font === "monospace"
      ? "ui-monospace, monospace"
      : "system-ui, sans-serif";
  const fontPx = Math.max(12, Math.round(style.size * height / 720));
  ctx.save();
  ctx.font = `${fontPx}px ${fontFamily}`;
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
  const margin = Math.round(height * 0.045);
  const by = style.position === "top"
    ? margin
    : style.position === "center"
      ? (height - boxH) / 2
      : height - boxH - margin;
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

export interface SceneFramePng {
  sceneId: string;
  png: Uint8Array;
}

/**
 * One representative PNG frame per scene, drawn with the exact same
 * renderer the video paths use (background, viewport transform, clip
 * ranges, drawObject, pre-rendered character sprites), so standalone
 * exports (issue #56: SCORM poster, PowerPoint slides, PNG scenes) can
 * never drift from the exported video frames. The representative moment
 * is the scene's first spoken line when it has one, else its start.
 */
export async function renderProjectSceneFrames(
  project: VideoProject,
  dimensions: { width: number; height: number } = { width: 1280, height: 720 },
): Promise<SceneFramePng[]> {
  const { width, height } = dimensions;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("The selected video preset has invalid dimensions. Choose another preset.");
  }
  if (project.scenes.length === 0) throw new Error("Project has no scenes.");
  const viewport = getRenderViewport(width, height);

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

  const frames: SceneFramePng[] = [];
  for (const scene of project.scenes) {
    let localT = 0;
    for (const o of scene.objects) {
      if (o.type !== "character") continue;
      const first = ((o as CharacterObject).speech ?? [])
        .filter((line) => line.text.trim())
        .sort((a, b) => a.start - b.start)[0];
      if (first) {
        localT = first.start;
        break;
      }
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = scene.background ?? "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.setTransform(
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
        drawObject(ctx, sprites, o, localT);
      }
    }
    ctx.restore();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error(`Could not render a PNG frame for scene "${scene.name}".`);
    frames.push({ sceneId: scene.id, png: new Uint8Array(await blob.arrayBuffer()) });
  }
  return frames;
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
  const imageSprites = await buildImageSprites(project);

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

  const audioBuffer = await buildProjectAudio(project, options.audioDescriptionMode ?? "mixed");
  let stream: MediaStream;
  try {
    stream = canvas.captureStream(FPS);
  } catch {
    throw new Error("Canvas capture could not start. Refresh the editor and try again.");
  }
  // Mix the rendered project audio into the capture when there is any.
  let audioCtx: AudioContext | null = null;
  let audioSrc: AudioBufferSourceNode | null = null;
  if (audioBuffer) {
    audioCtx = new AudioContext();
    const dest = audioCtx.createMediaStreamDestination();
    audioSrc = audioCtx.createBufferSource();
    audioSrc.buffer = audioBuffer;
    audioSrc.connect(dest);
    stream = new MediaStream([
      ...stream.getVideoTracks(),
      ...dest.stream.getAudioTracks(),
    ]);
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
    const bgImage = imageSprites.backgrounds.get(scene.id);
    if (bgImage) target.drawImage(bgImage, 0, 0, width, height);
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
        drawObject(target, sprites, o, localT, imageSprites.objects);
      }
    }
    target.restore();
  };

  try {
    rec.start(200);
    if (audioCtx && audioSrc) {
      void audioCtx.resume();
      audioSrc.start();
    }

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
      if (options.captions) drawCaptionOverlay(ctx, project, seg.scene, localT, width, height);

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
  const {
    Output, Mp4OutputFormat, WebMOutputFormat, BufferTarget, CanvasSource, AudioBufferSource,
  } = await import("mediabunny");
  const webm = options.container === "webm";
  const audioBuffer = await buildProjectAudio(project, options.audioDescriptionMode ?? "mixed");
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
  const imageSprites = await buildImageSprites(project);

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
    const bgImage = imageSprites.backgrounds.get(scene.id);
    if (bgImage) target.drawImage(bgImage, 0, 0, width, height);
    target.setTransform(
      viewport.scale, 0, 0, viewport.scale, viewport.offsetX, viewport.offsetY,
    );
    for (const o of scene.objects) {
      const range = timelineClipRange(o, scene.durationMs);
      if (localT >= range.startMs && localT < range.startMs + range.durationMs) {
        drawObject(target, sprites, o, localT, imageSprites.objects);
      }
    }
    target.restore();
  };

  const output = new Output({
    format: webm ? new WebMOutputFormat() : new Mp4OutputFormat(),
    target: new BufferTarget(),
  });
  const source = new CanvasSource(canvas, {
    codec: webm ? "vp9" : "avc",
    bitrate: 8_000_000,
  });
  output.addVideoTrack(source);
  let audioSource: InstanceType<typeof AudioBufferSource> | null = null;
  if (audioBuffer) {
    audioSource = new AudioBufferSource({
      codec: webm ? "opus" : "aac",
      bitrate: 128_000,
    });
    output.addAudioTrack(audioSource);
  }
  await output.start();
  if (audioSource && audioBuffer) {
    await audioSource.add(audioBuffer);
    audioSource.close();
  }

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
    if (options.captions) drawCaptionOverlay(ctx, project, seg.scene, localT, width, height);
    await source.add(f / FPS, 1 / FPS);
    onProgress?.((f + 1) / totalFrames);
  }

  await output.finalize();
  const buffer = (output.target as InstanceType<typeof BufferTarget>).buffer;
  if (!buffer) throw new Error("The MP4 encoder produced no output.");
  return new Blob([buffer], { type: webm ? "video/webm" : "video/mp4" });
}
