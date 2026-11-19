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
  playbackRate: number;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  setPlaybackRate: (rate: number) => void;
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
  const [playbackRate, setPlaybackRateState] = useState(1);
  const rafRef = useRef<number>(0);
  const lastRef = useRef<number>(0);
  const tRef = useRef(0);
  const playingRef = useRef(playing);
  const rateRef = useRef(playbackRate);
  const loopRef = useRef(!!opts.loop);
  const durRef = useRef(durationMs);
  playingRef.current = playing;
  rateRef.current = playbackRate;
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
      const t = tRef.current + dt * rateRef.current;
      if (t >= durRef.current || t < 0) {
        if (loopRef.current && durRef.current > 0) {
          const wrapped = ((t % durRef.current) + durRef.current) % durRef.current;
          tRef.current = wrapped;
          setTMs(wrapped);
        } else {
          const stoppedAt = Math.max(0, Math.min(t, durRef.current));
          tRef.current = stoppedAt;
          setTMs(stoppedAt);
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
    rateRef.current = 1;
    setPlaybackRateState(1);
    setPlaying(true);
  }, []);
  const pause = useCallback(() => {
    rateRef.current = 0;
    setPlaybackRateState(0);
    setPlaying(false);
  }, []);
  const toggle = useCallback(() => {
    if (playingRef.current) {
      rateRef.current = 0;
      setPlaybackRateState(0);
      setPlaying(false);
    } else {
      const v = tRef.current >= durRef.current ? 0 : tRef.current;
      tRef.current = v;
      setTMs(v);
      rateRef.current = 1;
      setPlaybackRateState(1);
      setPlaying(true);
    }
  }, []);
  const setPlaybackRate = useCallback((rate: number) => {
    const next = Math.max(-4, Math.min(4, rate));
    if (next === 0 || !Number.isFinite(next)) {
      rateRef.current = 0;
      setPlaybackRateState(0);
      setPlaying(false);
      return;
    }
    if (next < 0 && tRef.current <= 0 && loopRef.current) {
      tRef.current = durRef.current;
      setTMs(durRef.current);
    } else if (next > 0 && tRef.current >= durRef.current) {
      tRef.current = 0;
      setTMs(0);
    }
    rateRef.current = next;
    setPlaybackRateState(next);
    setPlaying(true);
  }, []);
  const seek = useCallback((ms: number) => {
    setPlaying(false);
    rateRef.current = 0;
    setPlaybackRateState(0);
    const v = Math.max(0, Math.min(ms, durRef.current));
    tRef.current = v;
    setTMs(v);
  }, []);
  const replay = useCallback(() => {
    tRef.current = 0;
    setTMs(0);
    rateRef.current = 1;
    setPlaybackRateState(1);
    setPlaying(true);
  }, []);

  return { tMs, durationMs, playing, playbackRate, play, pause, toggle, setPlaybackRate, seek, replay };
}
