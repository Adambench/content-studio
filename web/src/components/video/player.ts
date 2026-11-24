// The studio's player state, shared by the stage, the timeline, the thread and the message box without re-rendering
// the whole page sixty times a second: a tiny store, read with usePS(selector).

import { createContext, useContext, useSyncExternalStore } from 'react';

export type PlayerState = {
  /** Seconds into the version shown (videos). */
  t: number;
  /** The slide shown, from 0 (carousels). */
  slide: number;
  playing: boolean;
  duration: number;
  /** The version I'm on (approve, notes). */
  ver: number;
  /** Showing the version before it, at the same moment. */
  compare: boolean;
  /** A note typed now pins to this moment (off when I said it's not about the moment). */
  pinOn: boolean;
};

export function createPlayer(ver: number) {
  let s: PlayerState = { t: 0, slide: 0, playing: false, duration: 0, ver, compare: false, pinOn: true };
  const listeners = new Set<() => void>();
  const video = { current: null as HTMLVideoElement | null };
  const dock = { current: null as HTMLTextAreaElement | null };
  const p = {
    video,
    dock,
    get: () => s,
    set(patch: Partial<PlayerState>) {
      s = { ...s, ...patch };
      for (const l of listeners) l();
    },
    sub(l: () => void) {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    play() {
      const v = video.current;
      if (!v) return;
      if (v.ended || (s.duration && s.t >= s.duration - 0.05)) v.currentTime = 0;
      void v.play().catch(() => undefined);
    },
    pause() {
      video.current?.pause();
    },
    toggle() {
      const v = video.current;
      if (!v) return;
      if (v.paused) p.play();
      else p.pause();
    },
    seek(t: number) {
      const v = video.current;
      const d = s.duration || v?.duration || 0;
      const c = Math.max(0, d ? Math.min(t, d) : t);
      if (v) v.currentTime = c;
      p.set({ t: c, pinOn: true });
    },
    /** A frame at 30 fps (or a second with Shift). */
    step(frames: number) {
      p.pause();
      p.seek(s.t + frames / 30);
    },
    focusDock() {
      p.pause();
      p.set({ pinOn: true });
      setTimeout(() => dock.current?.focus(), 30);
    },
  };
  return p;
}

export type Player = ReturnType<typeof createPlayer>;
export const PlayerCtx = createContext<Player | null>(null);
export const usePlayer = () => useContext(PlayerCtx)!;
export function usePS<T>(sel: (s: PlayerState) => T): T {
  const p = usePlayer();
  return useSyncExternalStore(p.sub, () => sel(p.get()));
}
