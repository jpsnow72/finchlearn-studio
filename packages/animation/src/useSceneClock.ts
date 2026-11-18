/**
 * Scene animation clock (Vyond-lite MVP).
 *
 * requestAnimationFrame-driven clock for timeline animation. The scene time
 * `tMs` advances while playing; consumers sample object timelines at `tMs`
 * via `sampleTimeline` from @finch-studio/core. Pure React + rAF — no DOM reads.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface SceneClock {
  /** Current scene time in ms. */
  tMs: number;
  /** Scene duration in ms. */
  durationMs: number;
  playing: boolean;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  /** Jump to a time (clamped to [0, durationMs]); pauses when scrubbing. */
  seek: (ms: number) => void;
  /** Restart from 0 and play. */
  replay: () => void;
}

export function useSceneClock(
  durationMs: number,
  opts: { autoplay?: boolean; loop?: boolean } = {},
): SceneClock {
  const [tMs, setTMs] = useState(0);
  const [playing, setPlaying] = useState(!!opts.autoplay);
  const rafRef = useRef<number>(0);
  const lastRef = useRef<number>(0);
  const tRef = useRef(0);
  const playingRef = useRef(playing);
  const loopRef = useRef(!!opts.loop);
  const durRef = useRef(durationMs);
  playingRef.current = playing;
  loopRef.current = !!opts.loop;
  durRef.current = durationMs;

  // Clamp time when duration shrinks.
  useEffect(() => {
    const c = Math.min(tRef.current, durationMs);
    tRef.current = c;
    setTMs(c);
  }, [durationMs]);

  useEffect(() => {
    if (!playing) return;
    lastRef.current = performance.now();
    const tick = (now: number) => {
      const dt = now - lastRef.current;
      lastRef.current = now;
      const t = tRef.current + dt;
      if (t >= durRef.current) {
        if (loopRef.current && durRef.current > 0) {
          tRef.current = 0;
          setTMs(0);
        } else {
          tRef.current = durRef.current;
          setTMs(durRef.current);
          setPlaying(false);
          return;
        }
      } else {
        tRef.current = t;
        setTMs(t);
      }
      if (playingRef.current) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing]);

  const play = useCallback(() => {
    const v = tRef.current >= durRef.current ? 0 : tRef.current;
    tRef.current = v;
    setTMs(v);
    setPlaying(true);
  }, []);
  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => {
    if (playingRef.current) {
      setPlaying(false);
    } else {
      const v = tRef.current >= durRef.current ? 0 : tRef.current;
      tRef.current = v;
      setTMs(v);
      setPlaying(true);
    }
  }, []);
  const seek = useCallback((ms: number) => {
    setPlaying(false);
    const v = Math.max(0, Math.min(ms, durRef.current));
    tRef.current = v;
    setTMs(v);
  }, []);
  const replay = useCallback(() => {
    tRef.current = 0;
    setTMs(0);
    setPlaying(true);
  }, []);

  return { tMs, durationMs, playing, play, pause, toggle, seek, replay };
}
