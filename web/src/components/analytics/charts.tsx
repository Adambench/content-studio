import { useCallback, useRef, useState } from 'react';
import { DAY_PARTS } from '@shared/analytics';
import { accountName, DAY_NAMES, platformLabel } from '@/components/publish/common';
import { compact, times } from '@/lib/format';
import type { AccountTiming, PostPerformanceRow } from '@/lib/types';
import { cn } from '@/lib/utils';

/** An element's width, kept current: charts draw in real pixels so marks keep their exact sizes. */
function useWidth() {
  const [width, setWidth] = useState(0);
  const observer = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: HTMLDivElement | null) => {
    observer.current?.disconnect();
    if (!el) return;
    observer.current = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.current.observe(el);
  }, []);
  return [ref, width] as const;
}

/** The hover readout: the value leads, what it is follows. Kept inside the chart's box. */
function Tip({ x, y, width, children }: { x: number; y: number; width: number; children: React.ReactNode }) {
  const w = 208;
  const left = Math.min(Math.max(0, x - w / 2), Math.max(0, width - w));
  // Above the point, so it never hangs off the bottom of its card.
  return (
    <div role="status" className="pointer-events-none absolute z-10 -translate-y-full rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-lg" style={{ left, top: y, width: w }}>
      {children}
    </div>
  );
}

const shortDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const dayMs = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
};

/** One account's followers over the period. */
export function FollowerChart({ series, label }: { series: { day: string; followers: number | null }[]; label: string }) {
  const points = series.filter((s): s is { day: string; followers: number } => s.followers !== null).map((s) => ({ at: dayMs(s.day), value: s.followers }));
  return <TrendChart points={points} unit="followers" label={label} empty="The follower chart fills in after a couple of days of numbers." />;
}

/** One number over time: a 2px line with a wash, the latest value marked, a crosshair readout on hover or arrow keys. */
export function TrendChart({ points, unit, label, empty, withTime }: { points: { at: number; value: number }[]; unit: string; label: string; empty: string; withTime?: boolean }) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  if (points.length < 2) return <p className="text-xs text-muted-foreground">{empty}</p>;

  const H = 96;
  const pad = { t: 8, r: 8, b: 20, l: 40 };
  const values = points.map((p) => p.value);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (lo === hi) [lo, hi] = [lo - 1, hi + 1];
  const span = hi - lo;
  const [y0, y1] = [lo - span * 0.12, hi + span * 0.12];
  const [t0, t1] = [points[0].at, points.at(-1)!.at];
  const x = (at: number) => pad.l + ((at - t0) / (t1 - t0 || 1)) * Math.max(1, width - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - y0) / (y1 - y0)) * (H - pad.t - pad.b);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.at).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  const area = `${line}L${x(t1).toFixed(1)},${H - pad.b}L${x(t0).toFixed(1)},${H - pad.b}Z`;
  const last = points.at(-1)!;
  const hover = active !== null ? points[active] : null;

  const pick = (clientX: number, el: Element) => {
    const px = clientX - el.getBoundingClientRect().left;
    let best = 0;
    for (let i = 1; i < points.length; i++) if (Math.abs(x(points[i].at) - px) < Math.abs(x(points[best].at) - px)) best = i;
    setActive(best);
  };

  return (
    <div ref={ref} className="relative">
      {width > 0 && (
        <svg
          width={width}
          height={H}
          className="block touch-pan-y outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          role="img"
          aria-label={`${label}: ${compact(points[0].value)} ${unit} on ${shortDate(t0)}, ${compact(last.value)} on ${shortDate(t1)}`}
          tabIndex={0}
          onPointerMove={(e) => pick(e.clientX, e.currentTarget)}
          onPointerLeave={() => setActive(null)}
          onBlur={() => setActive(null)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setActive((a) => Math.max(0, (a ?? points.length) - 1));
            if (e.key === 'ArrowRight') setActive((a) => Math.min(points.length - 1, (a ?? -1) + 1));
          }}
        >
          {[lo, hi].map((v) => (
            <g key={v}>
              <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} className="stroke-border" strokeWidth={1} />
              <text x={pad.l - 6} y={y(v)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
                {compact(v)}
              </text>
            </g>
          ))}
          <text x={pad.l} y={H - 4} className="fill-muted-foreground text-[10px]">
            {shortDate(t0)}
          </text>
          <text x={width - pad.r} y={H - 4} textAnchor="end" className="fill-muted-foreground text-[10px]">
            {shortDate(t1)}
          </text>
          <path d={area} className="fill-viz-series" fillOpacity={0.1} />
          <path d={line} fill="none" className="stroke-viz-series" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {hover && <line x1={x(hover.at)} x2={x(hover.at)} y1={pad.t} y2={H - pad.b} className="stroke-muted-foreground/60" strokeWidth={1} />}
          {(hover ? [hover] : [last]).map((p) => (
            <circle key={p.at} cx={x(p.at)} cy={y(p.value)} r={4} className="fill-viz-series stroke-card" strokeWidth={2} />
          ))}
        </svg>
      )}
      {hover && (
        <Tip x={x(hover.at)} y={y(hover.value) - 10} width={width}>
          <p className="font-semibold">
            {hover.value.toLocaleString()} {unit}
          </p>
          <p className="text-muted-foreground">
            {new Date(hover.at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', ...(withTime && { hour: 'numeric', minute: '2-digit' }) })}
          </p>
        </Tip>
      )}
    </div>
  );
}

// A post with no views at all sits at the bottom of the scale rather than at minus infinity.
const log2 = (v: number) => Math.log(Math.max(v, 1 / 64)) / Math.LN2;

/** A bar path with a 4px rounded end away from the baseline and a square end on it. */
function barPath(x0: number, x1: number, base: number, end: number) {
  const up = end < base;
  const r = Math.min(4, (x1 - x0) / 2, Math.abs(base - end));
  if (up) return `M${x0},${base}V${end + r}Q${x0},${end} ${x0 + r},${end}H${x1 - r}Q${x1},${end} ${x1},${end + r}V${base}Z`;
  return `M${x0},${base}V${end - r}Q${x0},${end} ${x0 + r},${end}H${x1 - r}Q${x1},${end} ${x1},${end - r}V${base}Z`;
}

/**
 * Each post's views after 24 hours against its account's typical post, oldest to newest: up (blue) for better than
 * typical, down (red) for worse, on a doubling scale centred on 1×. The posts table below lists the same numbers.
 */
export function ScoreChart({ posts, onOpen }: { posts: PostPerformanceRow[]; onOpen: (id: string) => void }) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const scored = posts.filter((p): p is PostPerformanceRow & { score: number } => p.score !== null).sort((a, b) => a.publishedAt - b.publishedAt);
  if (!scored.length) return null;

  const H = 200;
  const pad = { t: 22, r: 4, b: 10, l: 40 };
  // Doublings either side of typical, enough to fit the biggest hit or flop (at most 16× / ¹⁄₁₆×).
  const lim = Math.min(4, Math.max(1, Math.ceil(Math.max(...scored.map((p) => Math.abs(log2(p.score)))))));
  const y = (l: number) => pad.t + ((lim - Math.max(-lim, Math.min(lim, l))) / (2 * lim)) * (H - pad.t - pad.b);
  const slot = Math.max(1, width - pad.l - pad.r) / scored.length;
  const barW = Math.max(2, Math.min(24, slot - 2, slot * 0.7));
  const cx = (i: number) => pad.l + slot * (i + 0.5);
  const base = y(0);
  const best = scored.reduce((b, p, i) => (p.score > scored[b].score ? i : b), 0);
  const hover = active !== null ? scored[active] : null;
  const ticks = Array.from({ length: 2 * lim + 1 }, (_, i) => lim - i);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-hidden>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-viz-above" /> Above typical
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px] bg-viz-below" /> Below typical
        </span>
      </div>
      <div ref={ref} className="relative">
        {width > 0 && (
          <svg width={width} height={H} className="block" role="group" aria-label="Each post’s views after 24 hours compared with its account’s typical post" onPointerLeave={() => setActive(null)}>
            {ticks.map((k) => (
              <g key={k}>
                <line x1={pad.l} x2={width - pad.r} y1={y(k)} y2={y(k)} className={k === 0 ? 'stroke-muted-foreground/50' : 'stroke-border'} strokeWidth={1} />
                <text x={pad.l - 6} y={y(k)} dy="0.32em" textAnchor="end" className="fill-muted-foreground text-[10px] tabular-nums">
                  {k >= 0 ? `${2 ** k}×` : `${(2 ** k).toString().replace(/^0/, '')}×`}
                </text>
              </g>
            ))}
            {scored.map((p, i) => {
              const l = log2(p.score);
              const end = y(l);
              const x0 = cx(i) - barW / 2;
              const above = l >= 0;
              return (
                <g
                  key={p.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`${p.pieceTitle}, ${platformLabel(p.platform)}, ${shortDate(p.publishedAt)}: ${times(p.score)} typical`}
                  className="cursor-pointer outline-none [&:focus-visible>rect]:fill-accent/40"
                  onPointerEnter={() => setActive(i)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  onClick={() => onOpen(p.id)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    onOpen(p.id);
                  }}
                >
                  {/* The whole column is the hit target, not just the painted bar. */}
                  <rect x={pad.l + slot * i} y={pad.t} width={slot} height={H - pad.t - pad.b} className={cn('fill-transparent', active === i && 'fill-accent/40')} />
                  <path d={barPath(x0, x0 + barW, base, Math.abs(end - base) < 1 ? base + (above ? -1 : 1) : end)} className={above ? 'fill-viz-above' : 'fill-viz-below'} />
                  {i === best && p.score >= 1.5 && (
                    <text x={cx(i)} y={end - 6} textAnchor="middle" className="fill-foreground text-[11px] font-medium">
                      {times(p.score)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
        {hover && (
          <Tip x={cx(active!)} y={Math.min(y(log2(hover.score)), base) - 8} width={width}>
            <p className="font-semibold">{times(hover.score)} typical</p>
            <p className="truncate">{hover.pieceTitle}</p>
            <p className="text-muted-foreground">
              {platformLabel(hover.platform)} {accountName(hover.account, hover.accountLabel.replace(/^\S+ /, ''))} · {shortDate(hover.publishedAt)}
            </p>
            <p className="text-muted-foreground">
              {compact(hover.views24h)} views after 24 h (typical {compact(hover.typical)})
            </p>
          </Tip>
        )}
      </div>
    </div>
  );
}

/** When an account's posts do best: median "× typical" by part of the day and weekday, as bars either side of 1×. */
export function TimingBars({ timing }: { timing: AccountTiming }) {
  const rows = [
    ...timing.byPart.map((b) => ({ key: b.part, label: DAY_PARTS.find((d) => d.id === b.part)!.label, ...b })),
    ...timing.byDay.map((b) => ({ key: `d${b.day}`, label: DAY_NAMES[b.day], ...b })),
  ];
  if (!rows.length) return <p className="text-xs text-muted-foreground">Needs a few more posts with numbers — at least two at the same time of day.</p>;
  const lim = 2; // ¼× to 4×
  const pct = (score: number) => (Math.min(lim, Math.abs(log2(score))) / lim) * 50;
  const block = (title: string, list: typeof rows) =>
    list.length > 0 && (
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">{title}</p>
        {list.map((r) => {
          const above = r.score >= 1;
          return (
            <div key={r.key} className="grid grid-cols-[4.5rem_1fr_5.5rem] items-center gap-2 text-xs" title={`${r.label}: ${times(r.score)} typical over ${r.posts} posts`}>
              <span>{r.label}</span>
              <span className="relative h-2.5">
                <span className="absolute inset-y-[-3px] left-1/2 w-px bg-muted-foreground/50" />
                <span
                  className={cn('absolute inset-y-0', above ? 'left-1/2 rounded-r-[4px] bg-viz-above' : 'right-1/2 rounded-l-[4px] bg-viz-below')}
                  style={{ width: `max(2px, ${pct(r.score)}%)` }}
                />
              </span>
              <span className="text-right text-muted-foreground tabular-nums">
                <span className="text-foreground">{times(r.score)}</span> · {r.posts}
              </span>
            </div>
          );
        })}
      </div>
    );
  return (
    <div className="space-y-3">
      {block('Time of day', rows.filter((r) => !r.key.startsWith('d')))}
      {block('Weekday', rows.filter((r) => r.key.startsWith('d')))}
    </div>
  );
}
