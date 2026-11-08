import { Link } from 'react-router';
import { COLUMN_LABELS, type BoardColumn, type BoardItem, type BoardPage } from '@shared/board';
import type { WorkspaceColor } from '@shared/types';
import { uploadSummary, usePieceUploads } from '@/components/AppChrome';
import { WorkspaceDot } from '@/components/WorkspaceDot';
import { cardPath, LIST_ORDER } from '@/lib/nav';
import { cn } from '@/lib/utils';
import { Meta, NewIdea, ordered } from './Board';

/** A card on the phone: like the board's, and how the clips this phone is sending to it are going. */
function Row({ item, color }: { item: BoardItem; color: string }) {
  const sending = uploadSummary(usePieceUploads(item.id));
  return (
    <Link to={cardPath(item.id)} className="relative flex items-start gap-3 overflow-hidden rounded-xl border bg-card px-4 py-3.5 text-base">
      <WorkspaceDot color={color as WorkspaceColor} className="mt-[7px] size-2" />
      <span className="line-clamp-2 min-w-0 flex-1 leading-snug">{item.title}</span>
      {sending ? (
        <>
          <span className={cn('mt-0.5 shrink-0 text-[13px] tabular-nums', sending.failed ? 'text-destructive' : 'text-muted-foreground')}>{sending.text}</span>
          {!sending.failed && (
            <span className="absolute inset-x-0 bottom-0 h-0.5 bg-muted">
              <span className="block h-full bg-brand transition-[width]" style={{ width: `${sending.fraction * 100}%` }} />
            </span>
          )}
        </>
      ) : (
        <Meta item={item} />
      )}
    </Link>
  );
}

/**
 * The board on the phone: the same cards in one list, each column under its name, what waits for me first
 * (LIST_ORDER). A card moves from its own page (the column under its title).
 */
export function BoardList({ items, columns, pages, addTo }: { items: BoardItem[]; columns: readonly BoardColumn[]; pages: BoardPage[]; addTo?: string }) {
  const colorOf = new Map(pages.map((p) => [p.id, p.color]));
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-3 pb-6">
      {addTo && (
        <div className="flex flex-col">
          <NewIdea workspaceId={addTo} />
        </div>
      )}
      {LIST_ORDER.filter((c) => columns.includes(c)).map((column) => {
        const list = ordered(column, items);
        if (!list.length) return null;
        return (
          <section key={column}>
            <h2 className="flex items-center gap-2 px-1 pt-5 pb-2 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
              {COLUMN_LABELS[column]}
              {column === 'review' && <span className="rounded-full bg-destructive px-2 leading-5 tracking-normal text-white">{list.length}</span>}
            </h2>
            <div className="flex flex-col gap-2">
              {list.map((item) => (
                <Row key={item.id} item={item} color={colorOf.get(item.workspaceId) ?? 'violet'} />
              ))}
            </div>
          </section>
        );
      })}
      {!items.length && <p className="pt-10 text-center text-muted-foreground">No videos yet</p>}
    </div>
  );
}
