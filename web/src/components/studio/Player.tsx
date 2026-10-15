import '@hyperframes/player';
import type { HyperframesPlayer } from '@hyperframes/player';
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { apiFetch, apiUrl, serverOrigin } from '@/lib/api';
import { isApp } from '@/lib/native';
import { cn } from '@/lib/utils';

declare module 'react' {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'hyperframes-player': React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string;
        srcdoc?: string;
        controls?: boolean | '';
        width?: number;
        height?: number;
      };
    }
  }
}

export type PlayerHandle = { seek: (t: number) => void; play: () => void; pause: () => void; readonly paused: boolean };

/**
 * The Android app can't point the player at the server: its pages are on another origin, and the player reaches into
 * its frame. So it fetches the page with its token and plays it as srcdoc (the server makes the page's links absolute,
 * with the token).
 */
function useAppPreview(path: string) {
  const [doc, setDoc] = useState<string | undefined>();
  useEffect(() => {
    if (!isApp) return;
    const ctrl = new AbortController();
    apiFetch(`${path}${path.includes('?') ? '&' : '?'}origin=${encodeURIComponent(serverOrigin())}`, { signal: ctrl.signal })
      .then((res) => (res.ok ? res.text() : undefined))
      .then((html) => html && setDoc(html))
      .catch(() => {});
    return () => ctrl.abort();
  }, [path]);
  return doc;
}

/**
 * The HyperFrames player showing the edit's composition — the same page the render uses, so what plays here is what
 * renders. A new `path` (under /api) reloads it; the playhead is put back where it was.
 */
export const Player = forwardRef<PlayerHandle, { path: string; width: number; height: number; onTime: (t: number) => void; className?: string }>(function Player(
  { path, width, height, onTime, className },
  ref,
) {
  const doc = useAppPreview(path);
  const el = useRef<HyperframesPlayer | null>(null);
  const lastTime = useRef(0);
  const onTimeRef = useRef(onTime);
  onTimeRef.current = onTime;

  useImperativeHandle(ref, () => ({
    seek: (t) => {
      lastTime.current = t;
      onTimeRef.current(t);
      if (el.current?.ready) el.current.seek(t);
    },
    play: () => el.current?.play(),
    pause: () => el.current?.pause(),
    get paused() {
      return el.current?.paused ?? true;
    },
  }));

  useEffect(() => {
    const player = el.current;
    if (!player) return;
    const onUpdate = (e: Event) => {
      const t = (e as CustomEvent<{ currentTime: number }>).detail?.currentTime ?? player.currentTime;
      lastTime.current = t;
      onTimeRef.current(t);
    };
    // After a reload, go back to where we were.
    const onReady = () => {
      if (lastTime.current > 0) player.seek(Math.min(lastTime.current, Math.max(0, player.duration - 0.05)));
    };
    player.addEventListener('timeupdate', onUpdate);
    player.addEventListener('ready', onReady);
    return () => {
      player.removeEventListener('timeupdate', onUpdate);
      player.removeEventListener('ready', onReady);
    };
  }, []);

  return (
    <div className={cn('relative overflow-hidden rounded-lg bg-black', className)}>
      <hyperframes-player
        ref={(node) => {
          el.current = node as HyperframesPlayer | null;
        }}
        {...(isApp ? { srcdoc: doc } : { src: apiUrl(path) })}
        width={width}
        height={height}
        controls=""
        style={{ display: 'block', width: '100%', height: '100%' }}
      />
    </div>
  );
});
