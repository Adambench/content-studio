import { ChevronRight, FileText, ImageIcon, Inbox, Layers, Lightbulb, Link2, Sparkles } from 'lucide-react';
import { forwardRef } from 'react';
import { labelColor, type IdeaNode } from '@shared/ideas';
import { PlatformIcon } from '@/components/publish/common';
import { Spinner } from '@/components/ui/spinner';
import { mediaThumbUrl } from '@/lib/api';
import { COLOR_DOT, COLOR_SOFT } from '@/lib/colors';
import { compact } from '@/lib/format';
import { cn } from '@/lib/utils';
import { cardTitle } from './model';

/** The video's stage, coloured by how far along it is. */
const STAGE_TONE: Record<string, string> = {
  idea: 'bg-muted text-muted-foreground',
  script: 'bg-muted text-foreground/80',
  film: 'bg-amber-500/15 text-amber-300',
  edit: 'bg-amber-500/15 text-amber-300',
  ready: 'bg-emerald-500/15 text-emerald-300',
  scheduled: 'bg-blue-500/15 text-blue-300',
  posted: 'bg-brand-soft text-brand',
};

export function StatusChip({ node, className }: { node: IdeaNode; className?: string }) {
  if (!node.piece) return null;
  const p = node.piece;
  return (
    <span className={cn('inline-flex h-5 items-center gap-1 rounded px-1.5 text-[11px] font-medium', STAGE_TONE[p.stage] ?? 'bg-muted text-muted-foreground', className)} title={`A video: ${p.title}`}>
      {p.stageName}
      {p.views !== null && <span className="tabular-nums opacity-80">· {compact(p.views)}</span>}
    </span>
  );
}

export function LabelChips({ labels, className }: { labels: string[]; className?: string }) {
  if (!labels.length) return null;
  return (
    <span className={cn('flex min-w-0 flex-wrap gap-1', className)}>
      {labels.map((l) => (
        <span key={l} className={cn('inline-flex h-5 items-center rounded px-1.5 text-[11px]', COLOR_SOFT[labelColor(l)])}>
          {l}
        </span>
      ))}
    </span>
  );
}

export const LabelDot = ({ label }: { label: string }) => <span className={cn('size-1.5 shrink-0 rounded-full', COLOR_DOT[labelColor(label)])} />;

export function hostOf(url: string | null) {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : '';
  } catch {
    return '';
  }
}

function PostLine({ node }: { node: IdeaNode }) {
  const p = node.post;
  if (!p) return <span className="truncate text-[11px] text-muted-foreground">{hostOf(node.url)}</span>;
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
      <PlatformIcon platform={p.platform} className="size-3" />
      <span className="truncate">{p.channel || 'Fetching…'}</span>
      {p.views !== null && <span className="shrink-0 tabular-nums">{compact(p.views)}</span>}
      {p.score !== null && p.score >= 1.5 && <span className={cn('shrink-0 font-semibold tabular-nums', p.score >= 3 ? 'text-emerald-400' : 'text-foreground/80')}>{p.score >= 10 ? Math.round(p.score) : p.score.toFixed(1)}×</span>}
      {p.fetching && <Spinner className="size-3 shrink-0" />}
    </span>
  );
}

type CardProps = {
  node: IdeaNode;
  selected?: boolean;
  dropping?: boolean;
  /** Episode number in its series. */
  episode?: number | null;
  /** Children hidden under it (collapsed or too deep): a count to open it with. */
  folded?: number;
  /** New in the Saved pile since I last looked. */
  fresh?: number;
  total?: number;
  editing?: React.ReactNode;
  onFold?: () => void;
  className?: string;
  style?: React.CSSProperties;
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'style'>;

/** One card on the canvas (and the phone's list uses its parts). Picture cards are their picture. */
export const IdeaCard = forwardRef<HTMLDivElement, CardProps>(function IdeaCard({ node, selected, dropping, episode, folded = 0, fresh = 0, total = 0, editing, onFold, className, style, ...rest }, ref) {
  const title = cardTitle(node);
  const preview = node.kind === 'idea' || node.kind === 'series' ? (node.title ? node.body.split('\n').find((l) => l.trim()) : '') : '';
  return (
    <div
      ref={ref}
      style={style}
      data-card={node.id}
      className={cn(
        'group/card absolute rounded-lg border bg-card text-left shadow-sm transition-[box-shadow,border-color] select-none',
        node.kind === 'series' && 'border-l-[3px] border-l-brand',
        node.kind === 'saved' && 'border-dashed bg-card/60',
        selected && 'border-brand ring-2 ring-brand/40',
        dropping && 'ring-2 ring-emerald-400/70',
        className,
      )}
      {...rest}
    >
      {node.kind === 'image' ? (
        <div className="overflow-hidden rounded-[inherit]">
          {node.hasThumb && node.mediaId ? (
            <img src={mediaThumbUrl(node.mediaId)} alt={title || 'Picture'} draggable={false} className="block max-h-40 w-full object-cover" />
          ) : (
            <div className="grid h-24 place-items-center text-muted-foreground">
              <ImageIcon className="size-5" />
            </div>
          )}
          {(title || editing) && <div className="px-2.5 py-1.5 text-xs">{editing ?? title}</div>}
        </div>
      ) : node.kind === 'link' ? (
        <div className="flex gap-2.5 p-2">
          <div className="grid h-[72px] w-[54px] shrink-0 place-items-center overflow-hidden rounded-md bg-muted">
            {node.hasThumb && node.mediaId ? <img src={mediaThumbUrl(node.mediaId)} alt="" draggable={false} className="size-full object-cover" /> : <Link2 className="size-4 text-muted-foreground" />}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1 py-0.5">
            {editing ?? <span className="line-clamp-2 text-[13px] leading-snug">{title}</span>}
            <PostLine node={node} />
            <LabelChips labels={node.labels} />
          </div>
        </div>
      ) : node.kind === 'saved' ? (
        <div className="flex items-center gap-2.5 px-3 py-3">
          <Inbox className="size-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium">Saved</span>
          <span className="text-xs text-muted-foreground tabular-nums">{total}</span>
          {fresh > 0 && <span className="ml-auto rounded-full bg-brand px-1.5 text-[11px] font-semibold text-white tabular-nums">{fresh} new</span>}
        </div>
      ) : (
        <div className="flex flex-col gap-1 px-3 py-2.5">
          {node.kind === 'series' && (
            <span className="flex items-center gap-1 text-[10px] font-semibold tracking-wider text-brand uppercase">
              <Layers className="size-3" /> Series
            </span>
          )}
          <div className="flex items-start gap-1.5">
            {episode ? <span className="mt-px shrink-0 rounded bg-muted px-1 text-[10px] font-semibold text-muted-foreground tabular-nums">Ep {episode}</span> : null}
            {editing ?? <span className={cn('line-clamp-3 min-w-0 text-[13px] leading-snug font-medium break-words', !title && 'text-muted-foreground italic')}>{title || 'Untitled'}</span>}
          </div>
          {preview && <span className="line-clamp-1 text-xs text-muted-foreground">{preview}</span>}
          {(node.labels.length > 0 || node.script || node.piece || node.by === 'claude') && (
            <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
              <StatusChip node={node} />
              {node.script && !node.piece && (
                <span className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground" title="Has a script draft">
                  <FileText className="size-3" /> Script
                </span>
              )}
              <LabelChips labels={node.labels} />
              {node.by === 'claude' && <Sparkles className="size-3 text-brand/70" aria-label="Suggested by Claude" />}
            </div>
          )}
        </div>
      )}
      {folded > 0 && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onFold?.();
          }}
          className="absolute top-1/2 -right-3 flex h-6 min-w-6 -translate-y-1/2 items-center justify-center gap-0.5 rounded-full border bg-background px-1.5 text-[11px] font-medium text-muted-foreground tabular-nums shadow-sm hover:text-foreground"
          aria-label={`Show ${folded} more under it`}
        >
          {folded}
          <ChevronRight className="size-3" />
        </button>
      )}
    </div>
  );
});

/** The card the canvas grows from: the page itself, or the card opened. */
export const RootCard = forwardRef<HTMLDivElement, { node: IdeaNode | null; pageName: string; selected?: boolean; className?: string; style?: React.CSSProperties } & Omit<React.HTMLAttributes<HTMLDivElement>, 'style'>>(function RootCard(
  { node, pageName, selected, className, style, ...rest },
  ref,
) {
  const title = node ? cardTitle(node) || 'Untitled' : pageName;
  return (
    <div
      ref={ref}
      style={style}
      data-card={node?.id ?? '__root'}
      className={cn('absolute flex items-center gap-2 rounded-xl border bg-sidebar px-3.5 py-2.5 shadow-sm select-none', selected && 'border-brand ring-2 ring-brand/40', className)}
      {...rest}
    >
      {node?.kind === 'series' ? <Layers className="size-4 shrink-0 text-brand" /> : node?.kind === 'saved' ? <Inbox className="size-4 shrink-0 text-muted-foreground" /> : <Lightbulb className="size-4 shrink-0 text-amber-400" />}
      <span className="line-clamp-2 min-w-0 text-sm font-semibold break-words">{title}</span>
    </div>
  );
});
