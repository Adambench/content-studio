import { MessageSquare } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { COLUMN_LABELS, POSTED_DAYS, type BoardColumn, type BoardItem, type BoardPage } from '@shared/board';
import type { WorkspaceColor } from '@shared/types';
import { WorkspaceDot } from '@/components/WorkspaceDot';
import { api, errorMessage } from '@/lib/api';
import { dayText, duration, postTime } from '@/lib/format';
import { moveCard } from '@/lib/move';
import { cardPath } from '@/lib/nav';
import { keys, queryClient } from '@/lib/queries';
import { cn } from '@/lib/utils';

/** The order a column lists its cards in. */
export function ordered(column: BoardColumn, items: BoardItem[]) {
  const list = items.filter((i) => i.column === column);
  switch (column) {
    case 'posted': {
      const since = Date.now() - POSTED_DAYS * 864e5;
      return list.filter((i) => (i.postedAt ?? i.updatedAt) >= since).sort((a, b) => (b.postedAt ?? b.updatedAt) - (a.postedAt ?? a.updatedAt));
    }
    case 'scheduled':
      return list.sort((a, b) => Number(!!b.failed) - Number(!!a.failed) || (a.nextPostAt ?? Infinity) - (b.nextPostAt ?? Infinity));
    case 'review':
      return list.sort((a, b) => a.updatedAt - b.updatedAt);
    case 'editing':
      return list.sort((a, b) => b.updatedAt - a.updatedAt);
    default:
      return list.sort((a, b) => a.position - b.position);
  }
}

/** What a card says on the right: its length, when it goes out, its comments, or its episode. */
export function Meta({ item }: { item: BoardItem }) {
  const m = 'mt-0.5 shrink-0 text-[13px] text-muted-foreground tabular-nums';
  switch (item.column) {
    case 'editing':
      return item.openComments ? (
        <span className={cn(m, 'inline-flex items-center gap-1')} title={`${item.openComments} open comment${item.openComments === 1 ? '' : 's'}`}>
          <MessageSquare className="size-3.5" />
          {item.openComments}
        </span>
      ) : item.rendering ? (
        <span className={m}>rendering</span>
      ) : null;
    case 'review':
      if (item.slides) return <span className={m}>{item.slides} slides</span>;
      return item.durationMs ? <span className={m}>{duration(item.durationMs)}</span> : null;
    case 'scheduled':
      return item.failed ? (
        <span className={cn(m, 'font-semibold text-destructive')} title={item.failed}>
          Failed
        </span>
      ) : item.nextPostAt ? (
        <span className={m}>{postTime(item.nextPostAt)}</span>
      ) : null;
    case 'posted':
      return <span className={m}>{dayText(item.postedAt ?? item.updatedAt)}</span>;
    default:
      if (item.footage) return <span className={m}>{item.footage} clip{item.footage === 1 ? '' : 's'}</span>;
      return item.series ? <span className={m}>Ep {item.series.episode}</span> : null;
  }
}

function Card({ item, color }: { item: BoardItem; color: string }) {
  return (
    <Link
      to={cardPath(item.id)}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/card', item.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      title={item.title}
      className="flex items-start gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-[15px] transition-colors hover:bg-muted/60"
    >
      <WorkspaceDot color={color as WorkspaceColor} className="mt-[7px] size-2" />
      <span className="line-clamp-2 min-w-0 flex-1 leading-snug">{item.title}</span>
      <Meta item={item} />
    </Link>
  );
}

export function NewIdea({ workspaceId }: { workspaceId: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');

  async function add() {
    const t = title.trim();
    if (!t) return;
    setTitle('');
    try {
      await api(`/workspaces/${workspaceId}/pieces`, { method: 'POST', body: { title: t, stage: 'idea' } });
      void queryClient.invalidateQueries({ queryKey: keys.boardAll });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-lg border border-dashed px-3 py-2.5 text-left text-[15px] text-muted-foreground hover:text-foreground">
        + New idea
      </button>
    );
  return (
    <input
      autoFocus
      value={title}
      onChange={(e) => setTitle(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') void add();
        if (e.key === 'Escape') setOpen(false);
      }}
      onBlur={() => !title.trim() && setOpen(false)}
      placeholder="Title, then Enter"
      className="rounded-lg border bg-muted/40 px-3 py-2.5 text-[15px] outline-none focus:border-foreground/30"
    />
  );
}

/**
 * Columns of cards. On Home every page's cards; on a page's section its own. Any card drags to any column (moveCard:
 * onto Scheduled approves it, off it cancels its posts); they also move by themselves (Claude edits, I approve, it
 * goes out).
 */
export function Board({ items, columns, pages, addTo }: { items: BoardItem[]; columns: readonly BoardColumn[]; pages: BoardPage[]; addTo?: string }) {
  const [over, setOver] = useState<BoardColumn | null>(null);
  const colorOf = new Map(pages.map((p) => [p.id, p.color]));
  return (
    <div className="grid min-h-0 flex-1 gap-3.5 overflow-x-auto px-5 pt-3 pb-5" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(13rem, 1fr))` }}>
      {columns.map((column) => {
        const list = ordered(column, items);
        return (
          <section
            key={column}
            className="flex min-h-0 flex-col"
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes('text/card')) return;
              e.preventDefault();
              setOver(column);
            }}
            onDragLeave={() => setOver((c) => (c === column ? null : c))}
            onDrop={(e) => {
              setOver(null);
              const item = items.find((i) => i.id === e.dataTransfer.getData('text/card'));
              if (item) void moveCard(item, column);
            }}
          >
            <h2 className="flex items-center gap-2 px-1 py-2.5 text-sm font-semibold text-muted-foreground">
              {COLUMN_LABELS[column]}
              {list.length > 0 &&
                (column === 'review' ? (
                  <span className="rounded-full bg-destructive px-2 text-xs leading-5 font-semibold text-white">{list.length}</span>
                ) : (
                  <span className="font-normal">{list.length}</span>
                ))}
            </h2>
            <div className={cn('flex min-h-12 flex-col gap-1.5 overflow-y-auto rounded-lg pb-1.5', over === column && 'outline-2 outline-offset-2 outline-dashed outline-foreground/20')}>
              {list.map((item) => (
                <Card key={item.id} item={item} color={colorOf.get(item.workspaceId) ?? 'violet'} />
              ))}
              {column === 'ideas' && addTo && <NewIdea workspaceId={addTo} />}
            </div>
          </section>
        );
      })}
    </div>
  );
}
