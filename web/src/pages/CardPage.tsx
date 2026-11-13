import { ChevronLeft, MoreHorizontal } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { BOARD_COLUMNS, COLUMN_LABELS, columnOf, isWritingColumn, VIDEO_COLUMNS, type BoardColumn, type BoardItem } from '@shared/board';
import { CarouselView } from '@/components/card/CarouselView';
import { ReviewView, useVideoVersions } from '@/components/card/ReviewView';
import { useDraft } from '@/components/card/useDraft';
import { CardHeader, WriteView } from '@/components/card/WriteView';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import { usePhone } from '@/hooks/useMediaQuery';
import { api, ApiError, errorMessage } from '@/lib/api';
import { LIST_ORDER, pagePath, sectionOf, sectionsFor, writes } from '@/lib/nav';
import { keys, queryClient, useBoardData, useCarousel, usePiece } from '@/lib/queries';
import type { PieceDetail } from '@/lib/types';
import { cn } from '@/lib/utils';

/** The cards of the same page, to jump between them. */
function Sidebar({ items, current, columns }: { items: BoardItem[]; current: BoardItem; columns: readonly BoardColumn[] }) {
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

/**
 * Everything on a card, whatever its stage: on a page I write for, its document (Script, Notes, footage) and its video
 * (renders, comments, Approve), whichever the stage needs first; a clip has only its video. While I write, the video
 * shows once one was made (a card sent back keeps its renders). A carousel shows its slides there (CarouselView).
 */
function CardBody({ piece, item, writer }: { piece: PieceDetail; item: BoardItem; writer: boolean }) {
  const draft = useDraft(piece);
  const { current } = useVideoVersions(piece.id);
  const carousel = useCarousel(piece.id).data ?? [];
  const writing = writer && isWritingColumn(item.column);
  const doc = writer && <WriteView piece={piece} draft={draft} />;
  // A carousel shows its slides where a video would play.
  const video = carousel.length ? <CarouselView piece={piece} item={item} draft={draft} versions={carousel} /> : (!writing || !!current) && <ReviewView piece={piece} item={item} draft={draft} />;
  const [first, second] = writing ? [doc, video] : [video, doc];
  return (
    <div className="space-y-8 px-4 pt-2 pb-10 md:px-12 md:pt-5 md:pb-20">
      <CardHeader piece={piece} column={item.column} columns={writer ? BOARD_COLUMNS : VIDEO_COLUMNS} series={item.series} />
      {first}
      {second && <div className="border-t pt-8 md:pt-10">{second}</div>}
    </div>
  );
}

/** A card on its own page, with the page's other cards beside it; on the phone with a bar to go back. */
export function CardPage() {
  const { id = '' } = useParams();
  const piece = usePiece(id);
  const board = useBoardData();
  const navigate = useNavigate();
  const location = useLocation();
  const phone = usePhone();
  const [deleting, setDeleting] = useState(false);

  // Gone: deleted, even while open. Out of reach, the phone shows its own copy of the card (lib/offline.ts), or says so.
  const gone = (piece.error instanceof ApiError && piece.error.status === 404) || (!phone && piece.isError);
  if (gone || !piece.data || !board.data)
    return (
      <div className="grid h-full place-items-center text-muted-foreground">{gone ? 'This card is gone.' : piece.isError || piece.isPaused || board.isPaused ? 'Can’t reach your computer' : <Spinner />}</div>
    );
  const p = piece.data;
  const page = board.data.pages.find((w) => w.id === p.workspaceId);
  const item = board.data.items.find((i) => i.id === p.id) ?? ({ id: p.id, workspaceId: p.workspaceId, title: p.title, stage: p.stage, column: columnOf(p.stage), position: p.position, updatedAt: p.updatedAt, durationMs: null, slides: null, rendering: false, openComments: 0, nextPostAt: null, failed: null, postedAt: null, series: null, footage: 0 } satisfies BoardItem);
  const kind = page?.kind ?? 'personal';
  const section = sectionOf(kind);
  const sectionLabel = sectionsFor(kind).find((s) => s.id === section)?.label ?? 'Home';
  const siblings = board.data.items.filter((i) => i.workspaceId === p.workspaceId);
  const back = pagePath(p.workspaceId, section);

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

  const more = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className={phone ? 'ml-auto size-10' : 'ml-auto'} aria-label="More">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const body = <CardBody key={p.id} piece={p} item={item} writer={writes(kind)} />;
  const confirm = (
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
  );

  // The phone: back where I came from (the list, the calendar, a series), else to the page's cards.
  if (phone)
    return (
      <div className="flex h-full min-h-0 flex-col">
        <header className="flex h-14 shrink-0 items-center px-2">
          <Button variant="ghost" size="icon" className="size-10" aria-label={`Back to ${sectionLabel}`} onClick={() => (location.key !== 'default' ? navigate(-1) : navigate(back))}>
            <ChevronLeft className="size-6" />
          </Button>
          {more}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
        {confirm}
      </div>
    );

  return (
    <div className="grid h-full min-h-0 grid-cols-[18rem_minmax(0,1fr)]">
      <Sidebar items={siblings} current={item} columns={writes(kind) ? LIST_ORDER : VIDEO_COLUMNS} />
      <div className="min-h-0 overflow-y-auto">
        <div className="flex items-center px-12 pt-5">
          <Link to={back} className="text-sm text-muted-foreground hover:text-foreground">
            ← {sectionLabel}
          </Link>
          {more}
        </div>
        {body}
      </div>
      {confirm}
    </div>
  );
}
