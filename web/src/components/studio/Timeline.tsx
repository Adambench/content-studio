import { AudioLines, Video } from 'lucide-react';
import { useRef } from 'react';
import { TRANSITION_INFO, clipLength, clipStarts, editDuration, transitionWindows } from '@shared/edit';
import { mediaThumbUrl } from '@/lib/api';
import { sfxName } from '@/lib/sfx';
import { cn } from '@/lib/utils';
import { useStudio } from './context';
import { OVERLAY_ICONS, overlayName } from './OverlaysPanel';

const STEPS = [1, 2, 5, 10, 15, 30, 60, 120];

/** The whole edit at a glance: click or drag to move the playhead, click a block to select it. */
export function Timeline({ className }: { className?: string }) {
  const { spec, time, seek, selection, select, media } = useStudio();
  const duration = Math.max(editDuration(spec), 0.5);
  const starts = clipStarts(spec);
  const area = useRef<HTMLDivElement>(null);
  const pct = (t: number) => `${(Math.max(0, Math.min(t, duration)) / duration) * 100}%`;
  const step = STEPS.find((s) => duration / s <= 10) ?? 300;

  const timeAt = (clientX: number) => {
    const r = area.current!.getBoundingClientRect();
    return Math.max(0, Math.min(duration, ((clientX - r.left) / r.width) * duration));
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    seek(timeAt(e.clientX));
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) seek(timeAt(e.clientX));
  };

  return (
    <div className={cn('border-t bg-sidebar px-3 pt-1 pb-2 select-none', className)}>
      <div ref={area} className="relative touch-none" onPointerDown={onPointerDown} onPointerMove={onPointerMove} role="slider" aria-label="Timeline" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={time}>
        {/* ruler */}
        <div className="relative h-4 text-[10px] text-muted-foreground tabular-nums">
          {Array.from({ length: Math.floor(duration / step) + 1 }, (_, i) => i * step).map((t) => (
            <span key={t} className="absolute top-0 -translate-x-1/2 first:translate-x-0" style={{ left: pct(t) }}>
              {Math.floor(t / 60)}:{String(Math.round(t % 60)).padStart(2, '0')}
            </span>
          ))}
        </div>

        {/* main track */}
        <div className="relative h-12 overflow-hidden rounded-md bg-muted/40">
          {spec.clips.map((c, i) => {
            const m = media.get(c.mediaId);
            const selected = selection?.kind === 'clip' && selection.id === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onPointerDown={() => select({ kind: 'clip', id: c.id })}
                className={cn(
                  'absolute inset-y-0 overflow-hidden border-r-2 border-sidebar bg-secondary bg-cover bg-center text-left',
                  selected && 'z-10 ring-2 ring-brand ring-inset',
                )}
                style={{ left: pct(starts[i]), width: pct(clipLength(c)), backgroundImage: m?.hasThumb ? `url(${mediaThumbUrl(m.id)})` : undefined }}
                aria-label={`Clip ${i + 1}: ${m?.originalName ?? 'missing file'}`}
              >
                <span className="absolute bottom-0.5 left-1 rounded bg-black/60 px-1 text-[10px] text-white tabular-nums">{clipLength(c).toFixed(1)}s</span>
              </button>
            );
          })}
          {/* transitions: the stretch where the two shots overlap, over the cut */}
          {transitionWindows(spec).map((w) => (
            <span
              key={`tr${w.index}`}
              className="pointer-events-none absolute inset-y-2 z-10 rounded-sm border border-white/70 bg-brand/50"
              style={{ left: pct(w.start), width: pct(w.end - w.start), minWidth: 6 }}
              title={TRANSITION_INFO[w.type].label}
            />
          ))}
        </div>

        {/* overlays */}
        <div className="relative mt-1 h-5">
          {spec.overlays.map((o) => {
            const Icon = o.type === 'broll' ? Video : OVERLAY_ICONS[o.type];
            const selected = selection?.kind === 'overlay' && selection.id === o.id;
            return (
              <button
                key={o.id}
                type="button"
                onPointerDown={() => select({ kind: 'overlay', id: o.id })}
                className={cn(
                  'absolute inset-y-0 flex items-center gap-1 overflow-hidden rounded px-1 text-[10px] whitespace-nowrap',
                  o.type === 'text'
                    ? 'bg-sky-500/25 text-sky-200'
                    : o.type === 'image'
                      ? 'bg-emerald-500/25 text-emerald-200'
                      : o.type === 'graphic' || o.type === 'scene'
                        ? 'bg-amber-500/25 text-amber-200'
                        : 'bg-violet-500/30 text-violet-200',
                  selected && 'ring-2 ring-brand',
                )}
                style={{ left: pct(o.start), width: pct(o.end - o.start) }}
              >
                <Icon className="size-3 shrink-0" />
                <span className="truncate">{overlayName(o, (id) => media.get(id)?.originalName)}</span>
              </button>
            );
          })}
        </div>

        {/* sound */}
        <div className="relative mt-1 h-3">
          {spec.audio.nasheed && (
            <div className="absolute inset-y-0 right-0 left-0 flex items-center gap-1 rounded bg-emerald-500/20 px-1 text-[9px] text-emerald-200">
              <AudioLines className="size-2.5" />
              <span className="truncate">{media.get(spec.audio.nasheed.mediaId)?.originalName ?? 'Nasheed'}</span>
            </div>
          )}
          {spec.audio.sfx.map((s) => (
            <button
              key={s.id}
              type="button"
              onPointerDown={() => select({ kind: 'sfx', id: s.id })}
              className={cn('absolute top-0 z-10 size-3 -translate-x-1/2 rounded-full border border-sidebar bg-orange-400', selection?.kind === 'sfx' && selection.id === s.id && 'ring-2 ring-brand')}
              style={{ left: pct(s.at) }}
              title={sfxName(s.mediaId, media)}
              aria-label={`Sound effect: ${sfxName(s.mediaId, media)}`}
            />
          ))}
        </div>

        {/* where the payoff lands (the edit's story) */}
        {spec.story.payoffAt !== null && (
          <div className="pointer-events-none absolute inset-y-0 z-10 w-px bg-emerald-400/70" style={{ left: pct(spec.story.payoffAt) }} title="Payoff">
            <span className="absolute -top-0.5 left-1 rounded bg-emerald-500/30 px-1 text-[9px] leading-tight text-emerald-200">Payoff</span>
          </div>
        )}

        {/* playhead */}
        <div className="pointer-events-none absolute inset-y-0 z-20 w-px bg-brand" style={{ left: pct(time) }}>
          <div className="absolute -top-0.5 -left-1 size-2 rotate-45 bg-brand" />
        </div>
      </div>
    </div>
  );
}
