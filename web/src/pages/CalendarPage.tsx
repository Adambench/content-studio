import { DndContext, DragOverlay, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core';
import { AlertCircle, CalendarDays, ChevronLeft, ChevronRight, Columns3, LayoutList, PanelRight, Plus, Users } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { upcomingSlotTimes } from '@shared/publish';
import { PageHeader } from '@/components/PageHeader';
import { AccountAvatar, firstDayOfWeek, formatTime, needsAttention, PlatformIcon, StatusIcon, statusText } from '@/components/publish/common';
import { PostSheet } from '@/components/publish/PostSheet';
import { ScheduleDialog } from '@/components/publish/ScheduleDialog';
import { useWorkspaceContext } from '@/components/WorkspaceLayout';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { api, errorMessage, mediaThumbUrl } from '@/lib/api';
import { keys, queryClient, useAccounts, useBoard, usePosts } from '@/lib/queries';
import type { Account, BoardCard, Post } from '@/lib/types';
import { createStore, useStore } from '@/lib/ui-state';
import { cn } from '@/lib/utils';

type View = 'week' | 'month' | 'list';
const calendarView = createStore<View | null>(null, 'cs.calendarView');
/** Whether the "Ready to schedule" column is shown; null follows the available width. */
const readyPanel = createStore<boolean | null>(null, 'cs.readyPanel');
const DAY = 86400_000;

const startOfDay = (ms: number) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};
const addDays = (ms: number, n: number) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
};
const startOfWeek = (ms: number, first: number) => addDays(startOfDay(ms), -((new Date(ms).getDay() - first + 7) % 7));
const timeOfDay = (ms: number) => ms - startOfDay(ms);

function rangeFor(view: View, anchor: number, first: number) {
  if (view === 'week') {
    const from = startOfWeek(anchor, first);
    return { from, to: addDays(from, 7), days: Array.from({ length: 7 }, (_, i) => addDays(from, i)) };
  }
  if (view === 'month') {
    const a = new Date(anchor);
    const monthStart = new Date(a.getFullYear(), a.getMonth(), 1).getTime();
    const from = startOfWeek(monthStart, first);
    const monthEnd = new Date(a.getFullYear(), a.getMonth() + 1, 1).getTime();
    const weeks = Math.ceil((monthEnd - from) / (7 * DAY) - 0.01);
    return { from, to: addDays(from, weeks * 7), days: Array.from({ length: weeks * 7 }, (_, i) => addDays(from, i)) };
  }
  const today = startOfDay(Date.now());
  return { from: addDays(today, -7), to: addDays(today, 56), days: [] };
}

/** Each account's queue times in the range that nothing is booked into yet, merged when accounts share a time. */
function freeSlots(accounts: Account[], posts: Post[], from: number, to: number) {
  const byTime = new Map<number, Account[]>();
  const now = Date.now();
  for (const a of accounts) {
    if (a.status !== 'connected' || !a.slots.length) continue;
    const taken = posts.filter((p) => p.accountId === a.id && (p.status === 'scheduled' || p.status === 'publishing')).map((p) => p.scheduledAt);
    for (const t of upcomingSlotTimes(a.slots, Math.max(from, now) - 1, Math.ceil((to - from) / DAY) + 1)) {
      if (t >= to || taken.some((x) => Math.abs(x - t) < 60_000)) continue;
      byTime.set(t, [...(byTime.get(t) ?? []), a]);
    }
  }
  return [...byTime.entries()].map(([at, accs]) => ({ at, accounts: accs })).sort((a, b) => a.at - b.at);
}

const canMove = (p: Post) => p.status === 'scheduled' || p.status === 'failed' || p.status === 'missed';

export function CalendarPage() {
  const { workspace } = useWorkspaceContext();
  const wid = workspace.id;
  const isDesktop = useIsDesktop();
  const stored = useStore(calendarView);
  const view: View = !isDesktop && stored === 'week' ? 'list' : (stored ?? (isDesktop ? 'week' : 'list'));
  const [anchor, setAnchor] = useState(() => Date.now());
  const first = useMemo(firstDayOfWeek, []);
  const range = rangeFor(view, anchor, first);
  const posts = usePosts(wid, range.from, range.to);
  const accounts = useAccounts(wid);
  const board = useBoard(wid);
  const [params, setParams] = useSearchParams();
  const openPost = params.get('post');
  const [schedule, setSchedule] = useState<{ pieceId: string; at: number | null } | null>(null);
  const [dragging, setDragging] = useState<{ post?: Post; piece?: BoardCard } | null>(null);
  const [width, setWidth] = useState(0);
  const area = useRef<ResizeObserver | null>(null);
  const measure = useCallback((el: HTMLDivElement | null) => {
    area.current?.disconnect();
    if (!el) return;
    area.current = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    area.current.observe(el);
  }, []);
  const readyPref = useStore(readyPanel);
  const showReady = isDesktop && view !== 'list' && (readyPref ?? width >= 1100);

  const list = posts.data ?? [];
  const slots = useMemo(() => freeSlots(accounts.data ?? [], list, range.from, range.to), [accounts.data, list, range.from, range.to]);
  const attention = list.filter(needsAttention);
  const ready = (board.data ?? [])
    .filter((c) => c.nextPostAt === null && c.postedCount === 0 && c.mediaCount > 0)
    .sort((a, b) => Number(b.stage === 'ready') - Number(a.stage === 'ready') || b.updatedAt - a.updatedAt)
    .slice(0, 30);

  const show = (id: string | null) => setParams(id ? { post: id } : {}, { replace: !id });
  const step = (dir: -1 | 1) => setAnchor((a) => (view === 'month' ? new Date(new Date(a).getFullYear(), new Date(a).getMonth() + dir, 1).getTime() : addDays(a, 7 * dir)));

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }));

  function onDragStart(e: DragStartEvent) {
    const [kind, id] = String(e.active.id).split(':');
    setDragging(kind === 'post' ? { post: list.find((p) => p.id === id) } : { piece: ready.find((c) => c.id === id) });
  }

  async function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    if (!e.over) return;
    const [kind, id] = String(e.active.id).split(':');
    const [target, value] = String(e.over.id).split(':');
    const day = Number(value);
    if (kind === 'piece') {
      // Dropped on a queue time: that time. On a day: its first free queue time, else 6 p.m. (or the next hour today).
      const at = target === 'slot' ? day : (slots.find((s) => startOfDay(s.at) === day)?.at ?? Math.max(day + 18 * 3600_000, Date.now() + 3600_000 - (Date.now() % 3600_000)));
      setSchedule({ pieceId: id, at });
      return;
    }
    const post = list.find((p) => p.id === id);
    if (!post) return;
    const at = target === 'slot' ? day : day + timeOfDay(post.scheduledAt);
    if (at === post.scheduledAt) return;
    if (at < Date.now()) return toast.error('That time has already passed.');
    const key = keys.posts(wid, range.from, range.to);
    const previous = queryClient.getQueryData<Post[]>(key);
    queryClient.setQueryData<Post[]>(key, (old) => old?.map((p) => (p.id === id ? { ...p, scheduledAt: at, status: 'scheduled' } : p)));
    try {
      await api(`/posts/${id}`, { method: 'PATCH', body: { scheduledAt: at } });
      toast.success(`Moved to ${new Date(at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`);
    } catch (err) {
      queryClient.setQueryData(key, previous);
      toast.error(errorMessage(err));
    }
    queryClient.invalidateQueries({ queryKey: ['posts', wid] });
  }

  const title =
    view === 'list'
      ? 'Coming up'
      : view === 'month'
        ? new Date(anchor).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
        : `${new Date(range.from).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${new Date(range.to - DAY).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Calendar"
        description={title}
        actions={
          <>
            {view !== 'list' && (
              <div className="flex items-center">
                <Button variant="ghost" size="icon-sm" onClick={() => step(-1)} aria-label="Previous">
                  <ChevronLeft />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setAnchor(Date.now())}>
                  Today
                </Button>
                <Button variant="ghost" size="icon-sm" onClick={() => step(1)} aria-label="Next">
                  <ChevronRight />
                </Button>
              </div>
            )}
            <ToggleGroup type="single" variant="outline" size="sm" value={view} onValueChange={(v) => v && calendarView.set(v as View)}>
              {isDesktop && (
                <ToggleGroupItem value="week" aria-label="Week">
                  <Columns3 /> <span className="hidden xl:inline">Week</span>
                </ToggleGroupItem>
              )}
              <ToggleGroupItem value="month" aria-label="Month">
                <CalendarDays /> <span className="hidden xl:inline">Month</span>
              </ToggleGroupItem>
              <ToggleGroupItem value="list" aria-label="List">
                <LayoutList /> <span className="hidden xl:inline">List</span>
              </ToggleGroupItem>
            </ToggleGroup>
            {isDesktop && view !== 'list' && (
              <Button variant={showReady ? 'secondary' : 'ghost'} size="sm" onClick={() => readyPanel.set(!showReady)} aria-pressed={showReady}>
                <PanelRight /> <span className="hidden xl:inline">Ready</span>
                {ready.length > 0 && <span className="text-muted-foreground tabular-nums">{ready.length}</span>}
              </Button>
            )}
            <Button variant="outline" size="sm" asChild>
              <Link to={`/w/${wid}/accounts`}>
                <Users /> <span className="hidden sm:inline">Accounts</span>
              </Link>
            </Button>
          </>
        }
      />

      {accounts.data && !accounts.data.length && (
        <div className="flex flex-wrap items-center gap-3 border-b bg-brand-soft px-4 py-3 text-sm md:px-6">
          <span className="mr-auto">Connect your TikTok, Instagram and YouTube accounts to schedule posts.</span>
          <Button size="sm" asChild>
            <Link to={`/w/${wid}/accounts`}>Connect accounts</Link>
          </Button>
        </div>
      )}
      {attention.length > 0 && view !== 'list' && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-destructive/10 px-4 py-2 text-sm md:px-6">
          <AlertCircle className="size-4 text-destructive" />
          <span className="mr-1">
            {attention.length} post{attention.length === 1 ? '' : 's'} need{attention.length === 1 ? 's' : ''} you:
          </span>
          {attention.slice(0, 4).map((p) => (
            <Button key={p.id} size="xs" variant="outline" onClick={() => show(p.id)}>
              <PlatformIcon platform={p.platform} className="size-3" /> {p.pieceTitle.slice(0, 28)} · {statusText(p)}
            </Button>
          ))}
        </div>
      )}

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
        <div ref={measure} className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1 overflow-auto">
            {posts.isPending ? (
              <div className="grid grid-cols-7 gap-2 p-4">
                {Array.from({ length: 7 }, (_, i) => (
                  <Skeleton key={i} className="h-64" />
                ))}
              </div>
            ) : view === 'week' ? (
              <WeekView days={range.days} posts={list} slots={slots} onOpen={show} />
            ) : view === 'month' ? (
              <MonthView days={range.days} month={new Date(anchor).getMonth()} posts={list} onOpen={show} onDay={(d) => {
                  calendarView.set(isDesktop ? 'week' : 'list');
                  setAnchor(d);
                }} />
            ) : (
              <ListView posts={list} slots={slots} onOpen={show} />
            )}
          </div>
          {showReady && <ReadyPanel cards={ready} onPick={(id) => setSchedule({ pieceId: id, at: null })} />}
        </div>
        <DragOverlay dropAnimation={null}>
          {dragging?.post ? <PostChip post={dragging.post} overlay /> : dragging?.piece ? <ReadyCard card={dragging.piece} overlay /> : null}
        </DragOverlay>
      </DndContext>

      <PostSheet postId={openPost} wid={wid} onClose={() => show(null)} />
      <ScheduleDialog open={!!schedule} onOpenChange={(o) => !o && setSchedule(null)} wid={wid} pieceId={schedule?.pieceId ?? null} initialAt={schedule?.at} />
    </div>
  );
}

function DayHeader({ day, compact }: { day: number; compact?: boolean }) {
  const d = new Date(day);
  const today = startOfDay(Date.now()) === day;
  return (
    <div className={cn('flex items-baseline gap-1.5', compact ? 'text-xs' : 'text-sm')}>
      {!compact && <span className="text-muted-foreground">{d.toLocaleDateString(undefined, { weekday: 'short' })}</span>}
      <span className={cn('tabular-nums', today && 'grid size-6 place-items-center rounded-full bg-brand font-medium text-white')}>{d.getDate()}</span>
    </div>
  );
}

function WeekView({ days, posts, slots, onOpen }: { days: number[]; posts: Post[]; slots: { at: number; accounts: Account[] }[]; onOpen: (id: string) => void }) {
  return (
    <div className="grid h-full min-w-[560px] grid-cols-7 divide-x">
      {days.map((day) => {
        const items: { at: number; post?: Post; slot?: { at: number; accounts: Account[] } }[] = [
          ...posts.filter((p) => startOfDay(p.scheduledAt) === day).map((p) => ({ at: p.scheduledAt, post: p })),
          ...slots.filter((s) => startOfDay(s.at) === day).map((s) => ({ at: s.at, slot: s })),
        ].sort((a, b) => a.at - b.at);
        return (
          <DayDrop key={day} day={day} className="flex min-h-full min-w-0 flex-col gap-1.5 p-1.5 @container">
            <div className="flex h-7 items-center px-1">
              <DayHeader day={day} />
            </div>
            {items.map((it) => (it.post ? <DraggablePost key={it.post.id} post={it.post} onOpen={onOpen} /> : <SlotDrop key={`s${it.at}`} slot={it.slot!} />))}
          </DayDrop>
        );
      })}
    </div>
  );
}

function MonthView({ days, month, posts, onOpen, onDay }: { days: number[]; month: number; posts: Post[]; onOpen: (id: string) => void; onDay: (day: number) => void }) {
  const first = days[0];
  return (
    <div className="p-2 md:p-4">
      <div className="grid grid-cols-7 pb-1 text-center text-xs text-muted-foreground">
        {days.slice(0, 7).map((d) => (
          <span key={d}>{new Date(d).toLocaleDateString(undefined, { weekday: 'short' })}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border bg-border">
        {days.map((day) => {
          const own = posts.filter((p) => startOfDay(p.scheduledAt) === day);
          return (
            <DayDrop key={day} day={day} className={cn('flex min-h-20 min-w-0 flex-col gap-1 bg-background p-1 @container md:min-h-28 md:p-1.5', new Date(day).getMonth() !== month && 'text-muted-foreground')}>
              <button type="button" className="self-start rounded px-1 hover:bg-accent" onClick={() => onDay(day)} aria-label={new Date(day).toDateString()}>
                <DayHeader day={day} compact />
              </button>
              {own.slice(0, 3).map((p) => (
                <DraggablePost key={p.id} post={p} onOpen={onOpen} compact />
              ))}
              {own.length > 3 && (
                <button type="button" className="px-1 text-left text-[11px] text-muted-foreground hover:text-foreground" onClick={() => onDay(day)}>
                  +{own.length - 3} more
                </button>
              )}
            </DayDrop>
          );
        })}
      </div>
      {first && <p className="pt-2 text-xs text-muted-foreground">Drag a post to another day to move it (it keeps its time).</p>}
    </div>
  );
}

function ListView({ posts, slots, onOpen }: { posts: Post[]; slots: { at: number; accounts: Account[] }[]; onOpen: (id: string) => void }) {
  const today = startOfDay(Date.now());
  const attention = posts.filter(needsAttention);
  const coming = posts.filter((p) => !needsAttention(p) && (p.status === 'scheduled' || p.status === 'publishing' || p.scheduledAt >= today)).sort((a, b) => a.scheduledAt - b.scheduledAt);
  const recent = posts.filter((p) => p.status === 'published' && p.scheduledAt < today).sort((a, b) => b.scheduledAt - a.scheduledAt);
  const days = [...new Set(coming.map((p) => startOfDay(p.scheduledAt)))];
  const nextFree = slots.slice(0, 3);

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 md:p-6">
      {attention.length > 0 && (
        <section className="space-y-2">
          <h2 className="flex items-center gap-2 text-sm font-medium text-destructive">
            <AlertCircle className="size-4" /> Needs you
          </h2>
          {attention.map((p) => (
            <PostRow key={p.id} post={p} onOpen={onOpen} />
          ))}
        </section>
      )}
      {days.map((day) => (
        <section key={day} className="space-y-2">
          <h2 className="text-sm font-medium">{day === today ? 'Today' : day === addDays(today, 1) ? 'Tomorrow' : new Date(day).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}</h2>
          {coming
            .filter((p) => startOfDay(p.scheduledAt) === day)
            .map((p) => (
              <PostRow key={p.id} post={p} onOpen={onOpen} />
            ))}
        </section>
      ))}
      {!days.length && !attention.length && <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">Nothing scheduled. Open a piece and press Schedule, or drag one onto the calendar on a bigger screen.</p>}
      {nextFree.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Free queue times</h2>
          <div className="flex flex-wrap gap-2">
            {nextFree.map((s) => (
              <span key={s.at} className="flex items-center gap-1.5 rounded-md border border-dashed px-2 py-1 text-xs text-muted-foreground">
                {new Date(s.at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
                {s.accounts.map((a) => (
                  <PlatformIcon key={a.id} platform={a.platform} className="size-3" />
                ))}
              </span>
            ))}
          </div>
        </section>
      )}
      {recent.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-muted-foreground">Posted this past week</h2>
          {recent.map((p) => (
            <PostRow key={p.id} post={p} onOpen={onOpen} />
          ))}
        </section>
      )}
    </div>
  );
}

function PostRow({ post, onOpen }: { post: Post; onOpen: (id: string) => void }) {
  return (
    <button type="button" onClick={() => onOpen(post.id)} className="flex w-full items-center gap-3 rounded-lg border bg-card p-2.5 text-left hover:border-foreground/20">
      {post.thumbMediaId ? <img src={mediaThumbUrl(post.thumbMediaId)} alt="" loading="lazy" className="h-12 w-9 shrink-0 rounded object-cover" /> : <div className="h-12 w-9 shrink-0 rounded bg-muted" />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{post.pieceTitle}</p>
        <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
          <PlatformIcon platform={post.platform} className="size-3" />
          {post.account ? (post.account.handle ? `@${post.account.handle}` : post.account.name) : post.accountLabel}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-xs tabular-nums">{formatTime(post.scheduledAt)}</p>
        <p className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
          <StatusIcon post={post} className="size-3" />
          {statusText(post)}
        </p>
      </div>
    </button>
  );
}

function PostChip({ post, compact, overlay, onOpen }: { post: Post; compact?: boolean; overlay?: boolean; onOpen?: (id: string) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen?.(post.id)}
      title={`${post.pieceTitle} — ${statusText(post)}${post.error ? `: ${post.error}` : ''}`}
      className={cn(
        'flex w-full min-w-0 items-center gap-1.5 rounded-md border bg-card text-left hover:border-foreground/20',
        compact ? 'px-1 py-0.5 text-[11px]' : 'p-1.5 text-xs',
        needsAttention(post) && 'border-destructive/40 bg-destructive/10',
        post.status === 'published' && 'opacity-75',
        overlay && 'w-44 rotate-1 shadow-xl',
      )}
    >
      {!compact && (post.thumbMediaId ? <img src={mediaThumbUrl(post.thumbMediaId)} alt="" loading="lazy" className="hidden h-9 w-7 shrink-0 rounded-sm object-cover @[10rem]:block" /> : null)}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1">
          <PlatformIcon platform={post.platform} className="size-3" />
          {/* In a narrow month cell (a phone) only the platform and status fit. */}
          <span className={cn('truncate whitespace-nowrap tabular-nums', compact && 'hidden @[6rem]:inline')}>{formatTime(post.scheduledAt)}</span>
          <StatusIcon post={post} className="ml-auto size-3" />
        </span>
        <span className={cn('block truncate', compact ? 'hidden @[6rem]:block' : 'text-muted-foreground')}>{post.pieceTitle}</span>
      </span>
    </button>
  );
}

function DraggablePost({ post, onOpen, compact }: { post: Post; onOpen: (id: string) => void; compact?: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `post:${post.id}`, disabled: !canMove(post) });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={cn('touch-manipulation', isDragging && 'opacity-30')}>
      <PostChip post={post} compact={compact} onOpen={onOpen} />
    </div>
  );
}

function DayDrop({ day, className, children }: { day: number; className?: string; children: React.ReactNode }) {
  const past = day < startOfDay(Date.now());
  const { setNodeRef, isOver } = useDroppable({ id: `day:${day}`, disabled: past });
  return (
    <div ref={setNodeRef} className={cn(className, isOver && 'bg-accent/40', past && 'bg-muted/20')}>
      {children}
    </div>
  );
}

function SlotDrop({ slot }: { slot: { at: number; accounts: Account[] } }) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot:${slot.at}` });
  return (
    <div ref={setNodeRef} className={cn('flex min-w-0 items-center gap-1.5 rounded-md border border-dashed px-1.5 py-1 text-[11px] text-muted-foreground', isOver && 'border-brand bg-brand-soft text-foreground')}>
      <span className="truncate whitespace-nowrap tabular-nums">{formatTime(slot.at)}</span>
      <span className="ml-auto hidden -space-x-1 @[7rem]:flex">
        {slot.accounts.slice(0, 3).map((a) => (
          <AccountAvatar key={a.id} account={a} platform={a.platform} className="size-4 [&>span:last-child]:hidden" />
        ))}
      </span>
      <span className="sr-only">free queue time</span>
    </div>
  );
}

function ReadyPanel({ cards, onPick }: { cards: BoardCard[]; onPick: (id: string) => void }) {
  return (
    <aside className="w-52 shrink-0 overflow-y-auto border-l p-3" aria-label="Ready to schedule">
      <h2 className="text-sm font-medium">Ready to schedule</h2>
      <p className="mb-3 text-xs text-muted-foreground">Drag onto a day or a free time, or click.</p>
      <div className="space-y-2">
        {cards.map((c) => (
          <DraggableReady key={c.id} card={c} onPick={onPick} />
        ))}
        {!cards.length && <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">Pieces with footage or a finished video that aren’t scheduled yet show up here.</p>}
      </div>
    </aside>
  );
}

function DraggableReady({ card, onPick }: { card: BoardCard; onPick: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `piece:${card.id}` });
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className={cn(isDragging && 'opacity-30')}>
      <ReadyCard card={card} onPick={onPick} />
    </div>
  );
}

function ReadyCard({ card, onPick, overlay }: { card: BoardCard; onPick?: (id: string) => void; overlay?: boolean }) {
  return (
    <button type="button" onClick={() => onPick?.(card.id)} className={cn('flex w-full items-center gap-2 rounded-lg border bg-card p-2 text-left text-xs hover:border-foreground/20', overlay && 'w-52 rotate-1 shadow-xl')}>
      {card.thumbMediaId ? <img src={mediaThumbUrl(card.thumbMediaId)} alt="" loading="lazy" className="h-10 w-8 shrink-0 rounded-sm object-cover" /> : <div className="h-10 w-8 shrink-0 rounded-sm bg-muted" />}
      <span className="line-clamp-2 min-w-0 flex-1">{card.title}</span>
      <Plus className="size-3.5 shrink-0 text-muted-foreground" />
    </button>
  );
}
