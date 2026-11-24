// Under the video: where I am, where my notes are (blue: open, grey: fixed); drag to scrub. For a carousel, a dot per
// slide with its notes.

import type { Note, Version } from '@shared/types';
import { cn } from '@/lib/utils';
import { usePlayer, usePS } from './player';

export function Timeline({ version, notes, compact }: { version: Version | null; notes: Note[]; compact?: boolean }) {
  const p = usePlayer();
  const t = usePS((s) => s.t);
  const duration = usePS((s) => s.duration) || version?.duration || 0;
  const slide = usePS((s) => s.slide);
  if (!version) return null;
  const mine = notes.filter((n) => n.versionN === version.n);

  if (version.kind === 'carousel') {
    return (
      <div className={cn('flex items-center justify-center gap-2', compact ? 'py-1' : 'py-2')}>
        {Array.from({ length: version.slides }, (_, k) => {
          const open = mine.filter((n) => n.slide === k + 1 && n.status !== 'fixed').length;
          return (
            <button key={k} type="button" aria-label={`Slide ${k + 1}`} onClick={() => p.set({ slide: k, pinOn: true })} className={cn('relative grid size-7 place-items-center rounded-md border font-mono text-xs', k === slide ? 'border-foreground text-foreground' : 'text-muted-foreground')}>
              {k + 1}
              {open > 0 && <span className="absolute -top-1 -right-1 size-2.5 rounded-full bg-you" />}
            </button>
          );
        })}
      </div>
    );
  }

  const scrub = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    p.seek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration);
  };
  return (
    <div
      role="slider"
      aria-label="Position"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration)}
      aria-valuenow={Math.round(t)}
      tabIndex={-1}
      className={cn('relative w-full cursor-pointer touch-none rounded-lg select-none', compact ? 'h-7 bg-black/50 backdrop-blur' : 'h-10 border bg-card')}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('[data-pin]')) return;
        p.pause();
        e.currentTarget.setPointerCapture(e.pointerId);
        scrub(e);
      }}
      onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && scrub(e)}
    >
      <div className="absolute inset-y-0 left-0 rounded-l-lg bg-foreground/10" style={{ width: duration ? `${(t / duration) * 100}%` : 0 }} />
      {mine
        .filter((n) => n.at != null)
        .map((n) => (
          <button
            key={n.id}
            type="button"
            data-pin
            title={n.text}
            aria-label={`Note: ${n.text}`}
            onClick={() => {
              p.pause();
              p.seek(n.at!);
            }}
            className={cn('absolute top-1 size-3 -translate-x-1/2 rounded-full border-2 border-background', n.status === 'fixed' ? 'bg-muted-foreground' : 'bg-you')}
            style={{ left: duration ? `${(n.at! / duration) * 100}%` : 0 }}
          />
        ))}
      <div className="pointer-events-none absolute inset-y-0 w-0.5 -translate-x-1/2 bg-foreground" style={{ left: duration ? `${(t / duration) * 100}%` : 0 }} />
    </div>
  );
}
