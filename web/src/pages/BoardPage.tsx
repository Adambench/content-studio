import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlertCircle, CalendarClock, CheckCircle2, Eye, Film, GitBranch, Play, Plus, Search, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { PageHeader } from '@/components/PageHeader';
import { useWorkspaceContext } from '@/components/WorkspaceLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api, errorMessage, mediaThumbUrl } from '@/lib/api';
import { compact, shortAgo, shortWhen } from '@/lib/format';
import { boardLabel } from '@/lib/nav';
import { keys, queryClient, useBoard } from '@/lib/queries';
import type { BoardCard } from '@/lib/types';
import { cn } from '@/lib/utils';

type Columns = Record<string, string[]>;

function toColumns(cards: BoardCard[], stageIds: string[]): Columns {
  const cols: Columns = Object.fromEntries(stageIds.map((s) => [s, []]));
  for (const c of [...cards].sort((a, b) => a.position - b.position)) (cols[c.stage] ?? cols[stageIds[0]]).push(c.id);
  return cols;
}

export function BoardPage() {
  const { workspace } = useWorkspaceContext();
  const board = useBoard(workspace.id);
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState('');
  const stageIds = workspace.stages.map((s) => s.id);
  const cards = board.data ?? [];
  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);

  const [columns, setColumns] = useState<Columns>({});
  const [dragId, setDragId] = useState<string | null>(null);
  // Mirror server order except while dragging, so live updates don't fight the pointer.
  useEffect(() => {
    if (!dragId) setColumns(toColumns(cards, stageIds));
  }, [board.data, workspace.stages, dragId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const captured = Number(params.get('captured') ?? 0);
    if (captured) {
      toast.success('Idea captured', { description: 'Claude is turning it into a card — it will appear in a moment.' });
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findColumn = (id: string) => (id in columns ? id : Object.keys(columns).find((k) => columns[k].includes(id)));

  function onDragStart(e: DragStartEvent) {
    setDragId(String(e.active.id));
  }

  function onDragOver(e: DragOverEvent) {
    const activeId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    if (!overId) return;
    const from = findColumn(activeId);
    const to = findColumn(overId);
    if (!from || !to || from === to) return;
    setColumns((cols) => {
      const target = cols[to].filter((id) => id !== activeId);
      const overIndex = target.indexOf(overId);
      target.splice(overIndex >= 0 ? overIndex : target.length, 0, activeId);
      return { ...cols, [from]: cols[from].filter((id) => id !== activeId), [to]: target };
    });
  }

  async function onDragEnd(e: DragEndEvent) {
    const activeId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    const col = findColumn(activeId);
    if (!col || !overId) return setDragId(null);
    let ids = columns[col];
    const oldIndex = ids.indexOf(activeId);
    const newIndex = overId in columns ? ids.length - 1 : ids.indexOf(overId);
    if (newIndex >= 0 && oldIndex !== newIndex) {
      ids = [...ids];
      ids.splice(newIndex, 0, ...ids.splice(oldIndex, 1));
      setColumns((c) => ({ ...c, [col]: ids }));
    }
    const i = ids.indexOf(activeId);
    const before = byId.get(ids[i - 1])?.position;
    const after = byId.get(ids[i + 1])?.position;
    const position = before !== undefined && after !== undefined ? (before + after) / 2 : before !== undefined ? before + 1 : after !== undefined ? after - 1 : 0;
    const card = byId.get(activeId);
    setDragId(null);
    if (!card || (card.stage === col && card.position === position)) return;
    queryClient.setQueryData(keys.board(workspace.id), (prev: BoardCard[] | undefined) => prev?.map((c) => (c.id === activeId ? { ...c, stage: col, position } : c)));
    try {
      await api(`/pieces/${activeId}`, { method: 'PATCH', body: { stage: col, position } });
    } catch (err) {
      toast.error(errorMessage(err));
      queryClient.invalidateQueries({ queryKey: keys.board(workspace.id) });
    }
  }

  const q = filter.trim().toLowerCase();
  const visible = (id: string) => {
    if (!q) return true;
    const c = byId.get(id);
    return !!c && (c.title.toLowerCase().includes(q) || c.hook.toLowerCase().includes(q) || c.tags.some((t) => t.includes(q)));
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={boardLabel(workspace.kind)}
        description={`${cards.length} ${workspace.kind === 'clipping' ? 'clip' : 'video'}${cards.length === 1 ? '' : 's'} — each one holds its footage, edit, captions and posts`}
        actions={
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter" className="h-8 w-40 pl-8 md:w-56" aria-label="Filter" />
          </div>
        }
      />
      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
        {board.isPending ? (
          <div className="flex gap-3 p-4 md:p-6">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-64 w-72 shrink-0 rounded-xl" />
            ))}
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => setDragId(null)}>
            <div className="flex h-full snap-x snap-mandatory gap-3 p-4 md:snap-none md:p-6">
              {workspace.stages.map((stage) => (
                <Column key={stage.id} wid={workspace.id} stageId={stage.id} name={stage.name} ids={(columns[stage.id] ?? []).filter(visible)} byId={byId} isFirst={stage.id === stageIds[0]} />
              ))}
            </div>
            <DragOverlay>{dragId && byId.get(dragId) ? <CardView card={byId.get(dragId)!} overlay /> : null}</DragOverlay>
          </DndContext>
        )}
      </div>
    </div>
  );
}

function Column({ wid, stageId, name, ids, byId, isFirst }: { wid: string; stageId: string; name: string; ids: string[]; byId: Map<string, BoardCard>; isFirst: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: stageId });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return setAdding(false);
    setTitle('');
    try {
      await api(`/workspaces/${wid}/pieces`, { body: { title: t, stage: stageId } });
      queryClient.invalidateQueries({ queryKey: keys.board(wid) });
      inputRef.current?.focus();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <section className="flex w-[82vw] max-w-72 shrink-0 snap-start flex-col rounded-xl bg-card/50 md:w-72" aria-label={name}>
      <div className="flex h-10 items-center gap-2 px-3">
        <h2 className="text-sm font-medium">{name}</h2>
        <span className="text-xs text-muted-foreground tabular-nums">{ids.length}</span>
        <Button variant="ghost" size="icon-xs" className="ml-auto text-muted-foreground" onClick={() => setAdding(true)} aria-label={`Add to ${name}`}>
          <Plus />
        </Button>
      </div>
      <div ref={setNodeRef} className={cn('flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 transition-colors', isOver && 'bg-accent/30')}>
        {adding && (
          <form onSubmit={add}>
            <Input
              ref={inputRef}
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => !title.trim() && setAdding(false)}
              onKeyDown={(e) => e.key === 'Escape' && setAdding(false)}
              placeholder="Title, then Enter"
              className="h-9 bg-background"
            />
          </form>
        )}
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {ids.map((id) => {
            const card = byId.get(id);
            return card ? <SortableCard key={id} card={card} onOpen={() => navigate(`/w/${wid}/p/${id}`)} /> : null;
          })}
        </SortableContext>
        {!ids.length && !adding && (
          <button type="button" onClick={() => setAdding(true)} className="rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground hover:bg-accent/40">
            {isFirst ? 'Make an idea a video from Ideas, add one here, or use Capture to talk one in' : 'Drag cards here'}
          </button>
        )}
      </div>
    </section>
  );
}

function SortableCard({ card, onOpen }: { card: BoardCard; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn('touch-manipulation', isDragging && 'opacity-30')}
      {...attributes}
      {...listeners}
      onClick={onOpen}
      onKeyDown={(e) => {
        listeners?.onKeyDown?.(e);
        if (e.key === 'Enter' && !e.defaultPrevented) onOpen();
      }}
    >
      <CardView card={card} />
    </div>
  );
}

function CardView({ card, overlay }: { card: BoardCard; overlay?: boolean }) {
  return (
    <article className={cn('group cursor-pointer rounded-lg border bg-card p-3 text-left shadow-xs transition-colors hover:border-foreground/20', overlay && 'rotate-1 cursor-grabbing shadow-xl')}>
      <div className="flex gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          {card.series && (
            <p className="truncate text-[10px] font-semibold tracking-wide text-brand uppercase">
              {card.series.name} · Ep {card.series.episode}
            </p>
          )}
          <h3 className="text-sm leading-snug font-medium">{card.title}</h3>
          {card.hook && <p className="line-clamp-2 text-xs text-muted-foreground">{card.hook}</p>}
        </div>
        {card.thumbMediaId && (
          <span className="relative h-16 w-9 shrink-0 overflow-hidden rounded">
            <img src={mediaThumbUrl(card.thumbMediaId)} alt="" loading="lazy" className="size-full object-cover" />
            {card.rendered && (
              <span className="absolute inset-0 grid place-items-center bg-black/25" title="Has a finished video">
                <Play className="size-3.5 fill-white text-white" />
              </span>
            )}
          </span>
        )}
      </div>
      <div className="mt-2.5 flex items-center gap-2 text-[11px] text-muted-foreground">
        {card.tags.slice(0, 2).map((t) => (
          <span key={t} className="rounded bg-muted px-1.5 py-0.5">
            #{t}
          </span>
        ))}
        <span className="ml-auto flex items-center gap-2">
          {card.postAttention ? (
            <span className="flex items-center gap-0.5 text-destructive" title="A post needs attention">
              <AlertCircle className="size-3" />
            </span>
          ) : card.nextPostAt ? (
            <span className="flex items-center gap-0.5 text-foreground/80" title={`Next post ${new Date(card.nextPostAt).toLocaleString()}`}>
              <CalendarClock className="size-3" />
              {shortWhen(card.nextPostAt)}
            </span>
          ) : card.postedCount > 0 ? (
            card.views !== null ? (
              <span className="flex items-center gap-0.5 text-foreground/80" title={`${card.views.toLocaleString()} views across ${card.postedCount} post${card.postedCount === 1 ? '' : 's'}`}>
                <Eye className="size-3" />
                {compact(card.views)}
              </span>
            ) : (
              <span className="flex items-center gap-0.5 text-emerald-400" title={`Posted to ${card.postedCount} account${card.postedCount === 1 ? '' : 's'}`}>
                <CheckCircle2 className="size-3" />
              </span>
            )
          ) : null}
          {card.lastAuthor === 'claude' && <Sparkles className="size-3 text-brand" aria-label="Last edited by Claude" />}
          {card.alternatives > 1 && (
            <span className="flex items-center gap-0.5" title={`${card.alternatives} alternatives`}>
              <GitBranch className="size-3" />
              {card.alternatives}
            </span>
          )}
          {card.mediaCount > 0 && (
            <span className="flex items-center gap-0.5" title={`${card.mediaCount} files`}>
              <Film className="size-3" />
              {card.mediaCount}
            </span>
          )}
          <span title={new Date(card.updatedAt).toLocaleString()}>{shortAgo(card.updatedAt)}</span>
        </span>
      </div>
    </article>
  );
}

