/**
 * Clean Voice A/B preview (issue #29): play one audio clip through
 * the Clean Voice chain (mode "cleaned") or straight through with no
 * processing (mode "original"), so the user can compare before
 * committing to the setting. Uses a live AudioContext and the exact
 * chain builder the export mix uses, so preview and export agree.
 *
 * Only one preview plays at a time; starting a new one (or calling
 * stopCleanVoicePreview, which the panel does when the compare mode
 * flips) stops the previous one.
 */
import {
  cleanVoiceSettingsForCompare,
  connectCleanVoice,
  type CleanVoiceCompareMode,
  type CleanVoiceContext,
  type CleanVoiceSettings,
} from "@finch-studio/audio";

export type { CleanVoiceCompareMode };

export interface CleanVoicePreviewHandle {
  stop: () => void;
  mode: CleanVoiceCompareMode;
}

let active: { stop: () => void } | null = null;

export function stopCleanVoicePreview(): void {
  active?.stop();
  active = null;
}

export async function playCleanVoicePreview(
  resourceUrl: string,
  settings: CleanVoiceSettings,
  mode: CleanVoiceCompareMode,
): Promise<CleanVoicePreviewHandle> {
  stopCleanVoicePreview();
  const Ctx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext: typeof AudioContext })
      .webkitAudioContext;
  const ctx = new Ctx();
  let stopped = false;
  const handle: CleanVoicePreviewHandle = {
    mode,
    stop: () => {
      if (stopped) return;
      stopped = true;
      if (active === handle) active = null;
      void ctx.close().catch(() => {});
    },
  };
  try {
    const res = await fetch(resourceUrl);
    if (!res.ok) throw new Error(`Could not load the clip for preview (${res.status}).`);
    const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
    if (stopped) return handle;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    // Identity when comparing the original: connectCleanVoice creates
    // no nodes and the source wires straight to the destination.
    const chain = connectCleanVoice(
      ctx as unknown as CleanVoiceContext,
      ctx.destination as never,
      cleanVoiceSettingsForCompare(settings, mode),
    );
    if (chain.bypassed) {
      source.connect(ctx.destination);
    } else {
      source.connect(chain.input as unknown as AudioNode);
      (chain.output as unknown as AudioNode).connect(ctx.destination);
    }
    source.onended = () => handle.stop();
    source.start();
    active = handle;
    return handle;
  } catch (error) {
    handle.stop();
    throw error;
  }
}
