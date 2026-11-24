// The middle of a video's page: the version I'm on (a video or a carousel), or what's happening before there is one.

import { ChevronLeft, ChevronRight, Play } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { Version, VideoDetail } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { mediaUrl } from '@/lib/api';
import { cn } from '@/lib/utils';
import { usePlayer, usePS } from './player';

/** The version shown: the one I'm on, or in Compare the one before it. */
export function shownVersion(versions: Version[], ver: number, compare: boolean): Version | null {
  const i = versions.findIndex((v) => v.n === ver);
  const cur = versions[i] ?? versions.at(-1) ?? null;
  if (!cur) return null;
  return compare && i > 0 ? versions[i - 1]! : cur;
}

export function Stage({ detail, onGo, fill }: { detail: VideoDetail; onGo: () => void; fill?: boolean }) {
  const ver = usePS((s) => s.ver);
  const compare = usePS((s) => s.compare);
  const shown = shownVersion(detail.versions, ver, compare);
  if (!shown) return <Before detail={detail} onGo={onGo} />;
  return shown.kind === 'carousel' ? <Carousel version={shown} compareOf={compare ? ver : null} fill={fill} /> : <VideoPlayer version={shown} compareOf={compare ? ver : null} fill={fill} />;
}

function VideoPlayer({ version, compareOf, fill }: { version: Version; compareOf: number | null; fill?: boolean }) {
  const p = usePlayer();
  const playing = usePS((s) => s.playing);
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    p.video.current = ref.current;
    return () => {
      if (p.video.current === ref.current) p.video.current = null;
    };
  }, [p, version.id]);

  // While playing, the playhead follows every frame.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const v = ref.current;
      if (v) p.set({ t: v.currentTime });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, p]);

  return (
    <div className={cn('relative mx-auto h-full overflow-hidden bg-black', fill ? 'w-full' : 'aspect-[9/16] max-w-full rounded-xl border')}>
      <video
        key={version.id}
        ref={ref}
        src={mediaUrl(`/media/version/${version.id}`)}
        poster={mediaUrl(`/media/poster/${version.id}`)}
        className={cn('size-full', fill ? 'object-contain' : 'object-cover')}
        playsInline
        preload="auto"
        onClick={() => p.toggle()}
        onLoadedMetadata={(e) => {
          const v = e.currentTarget;
          p.set({ duration: v.duration });
          // Switching versions (or Compare) keeps the moment.
          const t = p.get().t;
          if (t > 0) v.currentTime = Math.min(t, v.duration);
        }}
        onPlay={() => p.set({ playing: true })}
        onPause={(e) => p.set({ playing: false, t: e.currentTarget.currentTime, pinOn: true })}
        onEnded={() => p.set({ playing: false })}
        onSeeked={(e) => p.set({ t: e.currentTarget.currentTime })}
      />
      {!playing && (
        <button type="button" aria-label="Play" onClick={() => p.toggle()} className="absolute inset-0 grid place-items-center">
          <span className="grid size-16 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm">
            <Play className="size-7 fill-current" />
          </span>
        </button>
      )}
      {compareOf != null && <span className="absolute top-3 right-3 rounded-md bg-you px-2 py-0.5 font-mono text-xs font-semibold text-black">v{version.n} · V to go back to v{compareOf}</span>}
    </div>
  );
}

function Carousel({ version, compareOf, fill }: { version: Version; compareOf: number | null; fill?: boolean }) {
  const p = usePlayer();
  const slide = Math.min(usePS((s) => s.slide), version.slides - 1);
  const go = (k: number) => p.set({ slide: Math.max(0, Math.min(version.slides - 1, k)), pinOn: true });
  useEffect(() => {
    p.video.current = null;
    p.set({ duration: 0 });
  }, [p]);
  return (
    <div className={cn('relative mx-auto flex h-full items-center justify-center', fill ? 'w-full bg-black' : '')}>
      <div className={cn('relative aspect-[4/5] max-h-full max-w-full overflow-hidden bg-black', fill ? 'w-full' : 'h-full rounded-xl border')}>
        <img src={mediaUrl(`/media/slide/${version.id}/${Math.max(0, slide)}`)} alt={`Slide ${slide + 1}`} className="size-full object-contain" />
        <Button size="icon" variant="secondary" className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-black/55 text-white" onClick={() => go(slide - 1)} disabled={slide <= 0} aria-label="Previous slide">
          <ChevronLeft />
        </Button>
        <Button size="icon" variant="secondary" className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-black/55 text-white" onClick={() => go(slide + 1)} disabled={slide >= version.slides - 1} aria-label="Next slide">
          <ChevronRight />
        </Button>
        <span className="absolute top-3 left-3 rounded-md bg-black/60 px-2 py-0.5 font-mono text-xs text-white">
          {slide + 1}/{version.slides}
        </span>
        {compareOf != null && <span className="absolute top-3 right-3 rounded-md bg-you px-2 py-0.5 font-mono text-xs font-semibold text-black">v{version.n} · V to go back</span>}
      </div>
    </div>
  );
}

/** No version yet: Claude at work, or files waiting for my go, or nothing yet. */
function Before({ detail, onGo }: { detail: VideoDetail; onGo: () => void }) {
  const job = detail.job;
  const files = detail.inputs.length;
  return (
    <div className="mx-auto flex aspect-[9/16] h-full max-w-full flex-col items-center justify-center gap-4 rounded-xl border bg-card p-8 text-center">
      {job ? (
        <>
          <Spinner className="size-7" />
          <div className="text-sm font-medium text-balance">{job.status === 'waiting' ? 'Waiting for Claude’s usage window' : job.step || 'Claude is on it'}</div>
          <div className="h-1 w-2/3 overflow-hidden rounded bg-muted">
            <div className="h-full bg-foreground transition-[width] duration-700" style={{ width: `${Math.round(job.progress * 100)}%` }} />
          </div>
          <p className="max-w-[28ch] text-xs text-muted-foreground">You can close this. It goes on, and shows up in the inbox when it’s your turn.</p>
        </>
      ) : files ? (
        <>
          <div className="text-sm">{files === 1 ? '1 file is in' : `${files} files are in`}</div>
          <Button onClick={onGo}>Make it</Button>
          <p className="max-w-[28ch] text-xs text-muted-foreground">Or tell Claude what you want first.</p>
        </>
      ) : (
        <p className="max-w-[26ch] text-sm text-muted-foreground">Drop takes, your voice or photos here, or tell Claude what to make.</p>
      )}
    </div>
  );
}
