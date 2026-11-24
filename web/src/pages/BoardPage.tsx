import { closestCorners, DndContext, DragOverlay, PointerSensor, TouchSensor, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { MessageSquareIcon, PlusIcon, SettingsIcon } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageDot } from '@/components/PageDot';
import { secs } from '@/lib/format';
import { keys, queryClient, useBoard, useCreateCard, useMoveCard, usePages } from '@/lib/queries';
import { usePhone } from '@/lib/usePhone';
import { recipeInfo } from '@shared/recipes';
import { BOARD_STAGES, STAGE_LABEL, type CardSummary, type Page, type Stage } from '@shared/types';

const LAST_PAGE = 'cs.lastPage';

function lastPage(pages: Page[]): string | undefined {
  try {
    const id = localStorage.getItem(LAST_PAGE);
    if (id && pages.some((p) => p.id === id)) return id;
  } catch {
    // Private mode: no memory, the first page.
  }
  return pages[0]?.id;
}

function between(a: number | null, b: number | null) {
  if (a === null && b === null) return 1000;
  if (a === null) return b! - 1000;
  if (b === null) return a + 1000;
  return (a + b) / 2;
}

function Meta({ card }: { card: CardSummary }) {
  const bits: React.ReactNode[] = [];
  if (card.recipe !== 'auto') bits.push(<span key="r">{recipeInfo(card.recipe).label}</span>);
  if (card.latestRender?.status === 'done' && card.latestRender.duration) bits.push(<span key="d">{secs(card.latestRender.duration)}</span>);
  if (card.openComments)
    bits.push(
      <span key="c" className="flex items-center gap-1">
        <MessageSquareIcon className="size-3" />
        {card.openComments}
      </span>,
    );
  if (!bits.length && !card.job) return null;
  return <div className="mt-1.5 flex items-center gap-2.5 text-xs text-muted-foreground">{bits}</div>;
}

function JobBar({ card }: { card: CardSummary }) {
  if (!card.job) return null;
  const waiting = card.job.status === 'queued' || card.job.status === 'waiting';
  return (
    <div className="mt-2">
      <div className="mb-1 truncate text-[11px] text-muted-foreground">{waiting ? (card.job.status === 'waiting' ? 'Waiting' : 'Queued') : (card.job.step ?? 'Working')}</div>
      <div className="h-0.5 overflow-hidden rounded bg-muted">
        <div className={`h-full bg-foreground/60 transition-all ${waiting ? 'w-0' : ''}`} style={waiting ? undefined : { width: `${Math.max(4, card.job.progress * 100)}%` }} />
      </div>
    </div>
  );
}

function Tile({ card, page, dragging }: { card: CardSummary; page?: Page; dragging?: boolean }) {
  return (
    <div className={`rounded-lg border bg-card p-2.5 text-sm transition-colors hover:border-foreground/20 ${dragging ? 'shadow-xl ring-1 ring-foreground/20' : ''}`}>
      <div className="flex items-start gap-2">
        {page && <PageDot color={page.color} className="mt-1.5" />}
        <span className="line-clamp-2 leading-snug">{card.title}</span>
      </div>
      <Meta card={card} />
      <JobBar card={card} />
    </div>
  );
}

function SortableTile({ card, page }: { card: CardSummary; page?: Page }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id });
  return (
    <Link
      to={`/c/${card.id}`}
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.3 : 1 }}
      {...attributes}
      {...listeners}
      className="block outline-none"
    >
      <Tile card={card} page={page} />
    </Link>
  );
}

function AddCard({ pageId, pages, stage, onDone }: { pageId?: string; pages: Page[]; stage: Stage; onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [target, setTarget] = useState(pageId ?? lastPage(pages));
  const create = useCreateCard();
  const add = () => {
    if (!title.trim() || !target) return;
    try {
      localStorage.setItem(LAST_PAGE, target);
    } catch {
      // Not remembered; fine.
    }
    create.mutate({ pageId: target, title: title.trim(), stage }, { onSuccess: () => setTitle('') });
  };
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border bg-card p-2">
      <Input autoFocus placeholder="Title, then Enter" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => (e.key === 'Enter' ? add() : e.key === 'Escape' && onDone())} className="h-8" />
      {!pageId && pages.length > 1 && (
        <Select value={target} onValueChange={setTarget}>
          <SelectTrigger size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pages.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                <PageDot color={p.color} /> {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

function Column({ stage, cards, pages, pageId }: { stage: Stage; cards: CardSummary[]; pages: Page[]; pageId?: string }) {
  const { setNodeRef } = useDroppable({ id: `col:${stage}` });
  const [adding, setAdding] = useState(false);
  const canAdd = stage === 'idea' || stage === 'script';
  return (
    <section className="flex w-64 min-w-56 flex-1 flex-col">
      <div className="flex h-9 items-center gap-2 px-1 text-sm">
        <span className="font-medium">{STAGE_LABEL[stage]}</span>
        <span className="text-muted-foreground">{cards.length || ''}</span>
        <div className="flex-1" />
        {canAdd && pages.length > 0 && (
          <Button variant="ghost" size="icon-xs" aria-label="New card" onClick={() => setAdding((a) => !a)} className="text-muted-foreground">
            <PlusIcon />
          </Button>
        )}
      </div>
      <div ref={setNodeRef} className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-1 pb-6">
        {adding && <AddCard pageId={pageId} pages={pages} stage={stage} onDone={() => setAdding(false)} />}
        <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
          {cards.map((c) => (
            <SortableTile key={c.id} card={c} page={pageId ? undefined : pages.find((p) => p.id === c.pageId)} />
          ))}
        </SortableContext>
      </div>
    </section>
  );
}

/** The phone: one list, what needs me first. */
const PHONE_ORDER: Stage[] = ['review', 'needs_me', 'making', 'script', 'idea', 'ready', 'posted'];

function BoardList({ cards, pages, pageId }: { cards: CardSummary[]; pages: Page[]; pageId?: string }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="flex flex-col gap-5 p-3 pb-safe">
      {pages.length > 0 &&
        (adding ? (
          <AddCard pageId={pageId} pages={pages} stage="idea" onDone={() => setAdding(false)} />
        ) : (
          <Button variant="secondary" onClick={() => setAdding(true)}>
            <PlusIcon /> New idea
          </Button>
        ))}
      {PHONE_ORDER.map((stage) => {
        const group = cards.filter((c) => c.stage === stage);
        if (!group.length) return null;
        return (
          <section key={stage} className="flex flex-col gap-2">
            <h2 className="px-1 text-sm font-medium text-muted-foreground">
              {STAGE_LABEL[stage]} <span className="ml-1">{group.length}</span>
            </h2>
            {group.map((c) => (
              <Link key={c.id} to={`/c/${c.id}`}>
                <Tile card={c} page={pageId ? undefined : pages.find((p) => p.id === c.pageId)} />
              </Link>
            ))}
          </section>
        );
      })}
    </div>
  );
}

export function BoardPage() {
  const { pageId } = useParams();
  const phone = usePhone();
  const navigate = useNavigate();
  const pages = usePages().data ?? [];
  const board = useBoard(pageId);
  const cards = board.data ?? [];
  const move = useMoveCard();
  const [dragging, setDragging] = useState<CardSummary | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }));

  if (!pages.length && !board.isLoading)
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-muted-foreground">No pages yet.</p>
        <p className="text-sm text-muted-foreground">Add one with + in the top bar.</p>
      </div>
    );

  if (phone) return <BoardList cards={cards} pages={pages} pageId={pageId} />;

  const onDragStart = (e: DragStartEvent) => setDragging(cards.find((c) => c.id === e.active.id) ?? null);

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const card = cards.find((c) => c.id === e.active.id);
    if (!card || !e.over) return;
    const overId = String(e.over.id);
    const overCard = cards.find((c) => c.id === overId);
    const stage = overId.startsWith('col:') ? (overId.slice(4) as Stage) : (overCard?.stage ?? card.stage);
    const column = cards.filter((c) => c.stage === stage);
    let ordered: CardSummary[];
    if (stage === card.stage) {
      const from = column.findIndex((c) => c.id === card.id);
      const to = overCard ? column.findIndex((c) => c.id === overCard.id) : column.length - 1;
      if (from === to) return;
      ordered = arrayMove(column, from, to);
    } else {
      const at = overCard ? column.findIndex((c) => c.id === overCard.id) : column.length;
      ordered = [...column.slice(0, at), card, ...column.slice(at)];
    }
    const i = ordered.findIndex((c) => c.id === card.id);
    const before = ordered[i - 1] ?? null;
    const after = ordered[i + 1] ?? null;
    // Shown at once; the server agrees on the same position.
    queryClient.setQueryData<CardSummary[]>(keys.board(pageId), (old) =>
      (old ?? []).map((c) => (c.id === card.id ? { ...c, stage, position: between(before?.position ?? null, after?.position ?? null) } : c)).sort((a, b) => a.position - b.position),
    );
    move.mutate({ id: card.id, stage, between: [before?.id ?? null, after?.id ?? null] });
  };

  return (
    <div className="flex h-full flex-col">
      {pageId && (
        <div className="flex h-10 shrink-0 items-center justify-end px-4">
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => navigate(`/p/${pageId}/settings`)}>
            <SettingsIcon /> Page settings
          </Button>
        </div>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
        <div className={`flex min-h-0 flex-1 gap-3 overflow-x-auto px-3 ${pageId ? '' : 'pt-3'}`}>
          {BOARD_STAGES.map((stage) => (
            <Column key={stage} stage={stage} cards={cards.filter((c) => c.stage === stage)} pages={pages} pageId={pageId} />
          ))}
        </div>
        <DragOverlay>{dragging && <Tile card={dragging} page={pageId ? undefined : pages.find((p) => p.id === dragging.pageId)} dragging />}</DragOverlay>
      </DndContext>
    </div>
  );
}
