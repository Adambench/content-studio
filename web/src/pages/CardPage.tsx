import { MoreHorizontal } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { COLUMN_LABELS, columnOf, isWritingColumn, VIDEO_COLUMNS, WRITING_COLUMNS, type BoardItem } from '@shared/board';
import { ReviewView } from '@/components/card/ReviewView';
import { WriteView } from '@/components/card/WriteView';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import { api, errorMessage } from '@/lib/api';
import { pagePath, sectionOf, sectionsFor, writes } from '@/lib/nav';
import { keys, queryClient, useBoardData, usePiece } from '@/lib/queries';
import { cn } from '@/lib/utils';

/** The cards of the same page and section, to jump between them (Ready to film first while writing). */
function Sidebar({ items, current }: { items: BoardItem[]; current: BoardItem }) {
  const columns = isWritingColumn(current.column) ? [...WRITING_COLUMNS].reverse() : VIDEO_COLUMNS;
  return (
    <aside className="min-h-0 overflow-y-auto border-r px-2.5 pt-2 pb-8">
      {columns.map((c) => {
        const list = items.filter((i) => i.column === c);
        if (!list.length) return null;
        return (
          <div key={c}>
            <h2 className="px-2.5 pt-5 pb-1.5 text-xs font-semibold tracking-widest text-muted-foreground uppercase">{COLUMN_LABELS[c]}</h2>
            {list.map((i) => (
              <Link
                key={i.id}
                to={`/c/${i.id}`}
                title={i.title}
                className={cn('block truncate rounded-md px-2.5 py-2 text-sm text-muted-foreground hover:bg-muted/60 hover:text-foreground', i.id === current.id && 'bg-muted text-foreground')}
              >
                {i.title}
              </Link>
            ))}
          </div>
        );
      })}
    </aside>
  );
}

/** A card on its own page: the script while it's being written, the video once Claude has made it. */
export function CardPage() {
  const { id = '' } = useParams();
  const piece = usePiece(id);
  const board = useBoardData();
  const navigate = useNavigate();
  const [deleting, setDeleting] = useState(false);

  if (piece.isError) return <p className="p-10 text-muted-foreground">This card is gone.</p>;
  if (!piece.data || !board.data)
    return (
      <div className="grid h-full place-items-center">
        <Spinner />
      </div>
    );
  const p = piece.data;
  const page = board.data.pages.find((w) => w.id === p.workspaceId);
  const item = board.data.items.find((i) => i.id === p.id) ?? ({ id: p.id, workspaceId: p.workspaceId, title: p.title, stage: p.stage, column: columnOf(p.stage), position: p.position, updatedAt: p.updatedAt, durationMs: null, rendering: false, openComments: 0, nextPostAt: null, failed: null, postedAt: null, series: null, footage: 0 } satisfies BoardItem);
  const kind = page?.kind ?? 'personal';
  const section = sectionOf(kind, item.column);
  const sectionLabel = sectionsFor(kind).find((s) => s.id === section)?.label ?? 'Home';
  const siblings = board.data.items.filter((i) => i.workspaceId === p.workspaceId && sectionOf(kind, i.column) === section);
  const back = pagePath(p.workspaceId, section);
  const writing = isWritingColumn(item.column) && writes(kind);

  async function remove() {
    try {
      await api(`/pieces/${p.id}`, { method: 'DELETE' });
      void queryClient.invalidateQueries({ queryKey: keys.boardAll });
      toast(`“${p.title}” deleted`);
      navigate(back, { replace: true });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="grid h-full min-h-0 grid-cols-[18rem_minmax(0,1fr)]">
      <Sidebar items={siblings} current={item} />
      <div className="min-h-0 overflow-y-auto">
        <div className="flex items-center px-12 pt-5">
          <Link to={back} className="text-sm text-muted-foreground hover:text-foreground">
            ← {sectionLabel}
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="ml-auto" aria-label="More">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        {writing ? <WriteView key={p.id} piece={p} column={item.column} series={item.series} /> : <ReviewView key={p.id} piece={p} item={item} />}
      </div>
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{p.title}”?</AlertDialogTitle>
            <AlertDialogDescription>Its script, notes, footage and renders go too.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
