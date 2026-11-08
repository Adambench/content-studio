import { GripVertical, MoreHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { COLUMN_LABELS, type Series } from '@shared/board';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import { api, errorMessage } from '@/lib/api';
import { cardPath, pagePath, seriesPath } from '@/lib/nav';
import { keys, queryClient, useOneSeries, useSeries } from '@/lib/queries';
import { cn } from '@/lib/utils';

const refresh = () => {
  void queryClient.invalidateQueries({ queryKey: ['series'] });
  void queryClient.invalidateQueries({ queryKey: keys.boardAll });
};

/** "+ New …": a dashed line that turns into a title input; Enter adds it. */
function AddLine({ label, onAdd }: { label: string; onAdd: (title: string) => Promise<unknown> }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  async function add() {
    const t = title.trim();
    if (!t) return;
    setTitle('');
    try {
      await onAdd(t);
    } catch (err) {
      setTitle(t);
      toast.error(errorMessage(err));
    }
  }
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="w-full rounded-lg border border-dashed px-3.5 py-3 text-left text-[15px] text-muted-foreground hover:text-foreground">
        + {label}
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
      placeholder="Name, then Enter"
      className="w-full rounded-lg border bg-muted/40 px-3.5 py-3 text-[15px] outline-none focus:border-foreground/30"
    />
  );
}

/** A page's series: each opens with what it follows and its episodes. */
export function SeriesList({ wid }: { wid: string }) {
  const list = useSeries(wid);
  const navigate = useNavigate();
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-3 px-4 py-6 md:px-6 md:py-8">
        {list.data?.length ? (
          <ul>
            {list.data.map((s) => (
              <li key={s.id}>
                <Link to={seriesPath(wid, s.id)} className="flex items-baseline gap-4 border-b px-1 py-3.5 hover:bg-muted/40">
                  <span className="min-w-0 flex-1 truncate text-[15px]">{s.name}</span>
                  <span className="text-[13px] text-muted-foreground tabular-nums">
                    {s.episodes.length} episode{s.episodes.length === 1 ? '' : 's'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          list.data && <p className="pb-2 text-[15px] text-muted-foreground">None yet</p>
        )}
        {list.data && (
          <AddLine
            label="New series"
            onAdd={async (name) => {
              const s = await api<Series>(`/workspaces/${wid}/series`, { method: 'POST', body: { name } });
              refresh();
              navigate(seriesPath(wid, s.id));
            }}
          />
        )}
      </div>
    </div>
  );
}

/** A textarea that grows with its text and saves when I leave it. */
function About({ series }: { series: Series }) {
  const [text, setText] = useState(series.about);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => setText(series.about), [series.about]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== series.about && void save(series.id, { about: text })}
      placeholder="What every episode follows"
      aria-label="About"
      spellCheck
      className="w-full resize-none overflow-hidden bg-transparent text-[17px] leading-relaxed outline-none placeholder:text-muted-foreground/60"
    />
  );
}

async function save(id: string, body: { name?: string; about?: string }) {
  try {
    await api(`/series/${id}`, { method: 'PATCH', body });
    refresh();
  } catch (err) {
    toast.error(errorMessage(err));
  }
}

/** Where in the list a drag at height `y` would drop: before that row, or at the end. */
function overAt(list: HTMLElement, y: number) {
  const rows = [...list.querySelectorAll('li')];
  const i = rows.findIndex((r) => y < r.getBoundingClientRect().top + r.offsetHeight / 2);
  return i < 0 ? rows.length : i;
}

/** The episodes in order: dragging one moves it (by its grip on a touchscreen), and the numbers follow. */
function Episodes({ series }: { series: Series }) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const list = useRef<HTMLOListElement>(null);

  async function drop(at: number) {
    const id = dragging;
    setDragging(null);
    setOver(null);
    if (!id) return;
    const ids = series.episodes.map((e) => e.id).filter((x) => x !== id);
    const from = series.episodes.findIndex((e) => e.id === id);
    ids.splice(at > from ? at - 1 : at, 0, id);
    if (ids.every((x, i) => x === series.episodes[i].id)) return;
    const byId = new Map(series.episodes.map((e) => [e.id, e]));
    queryClient.setQueryData<Series>(keys.oneSeries(series.id), (s) => s && { ...s, episodes: ids.map((x, i) => ({ ...byId.get(x)!, episode: i + 1 })) });
    try {
      await api(`/series/${series.id}/order`, { method: 'PUT', body: { pieceIds: ids } });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      refresh();
    }
  }

  return (
    <ol
      ref={list}
      onDragOver={(e) => {
        if (!dragging) return;
        e.preventDefault();
        setOver(overAt(e.currentTarget, e.clientY));
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(null)}
      onDrop={(e) => {
        e.preventDefault();
        void drop(over ?? series.episodes.length);
      }}
    >
      {series.episodes.map((ep, i) => (
        <li
          key={ep.id}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move';
            setDragging(ep.id);
          }}
          onDragEnd={() => {
            setDragging(null);
            setOver(null);
          }}
          className={cn('group flex items-center gap-3 border-b border-t border-t-transparent', over === i && 'border-t-foreground/40', over === series.episodes.length && i === series.episodes.length - 1 && 'border-b-foreground/40', dragging === ep.id && 'opacity-40')}
        >
          {/* HTML drag and drop is the mouse's; a finger drags the grip. */}
          <span
            className="-my-1 shrink-0 touch-none p-2 md:m-0 md:p-0"
            onPointerDown={(e) => {
              if (e.pointerType === 'mouse') return;
              e.currentTarget.setPointerCapture(e.pointerId);
              setDragging(ep.id);
            }}
            onPointerMove={(e) => dragging && e.pointerType !== 'mouse' && list.current && setOver(overAt(list.current, e.clientY))}
            onPointerUp={(e) => e.pointerType !== 'mouse' && dragging && void drop(over ?? series.episodes.length)}
            onPointerCancel={() => {
              setDragging(null);
              setOver(null);
            }}
          >
            <GripVertical className="size-4 cursor-grab text-muted-foreground/40 group-hover:text-muted-foreground" aria-hidden />
          </span>
          <span className="w-6 shrink-0 text-[13px] text-muted-foreground tabular-nums">{ep.episode}</span>
          <Link to={cardPath(ep.id)} draggable={false} className="min-w-0 flex-1 truncate py-3.5 text-[15px] hover:underline hover:underline-offset-4">
            {ep.title}
          </Link>
          <span className="shrink-0 text-[13px] text-muted-foreground">{COLUMN_LABELS[ep.column]}</span>
        </li>
      ))}
    </ol>
  );
}

/** One series: its name, what every episode follows, and its episodes. */
export function SeriesView({ wid, id }: { wid: string; id: string }) {
  const series = useOneSeries(id);
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [deleting, setDeleting] = useState(false);
  useEffect(() => setName(series.data?.name ?? ''), [series.data?.name]);

  if (series.isError) return <Navigate to={pagePath(wid, 'series')} replace />;
  if (!series.data)
    return (
      <div className="grid flex-1 place-items-center">
        <Spinner />
      </div>
    );
  const s = series.data;

  async function remove() {
    try {
      await api(`/series/${s.id}`, { method: 'DELETE' });
      refresh();
      navigate(pagePath(wid, 'series'), { replace: true });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-4xl space-y-8 px-4 pt-4 pb-20 md:px-6 md:pt-5">
        <div className="flex items-center">
          <Link to={pagePath(wid, 'series')} className="text-sm text-muted-foreground hover:text-foreground">
            ← Series
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="ml-auto" aria-label="More">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
                Delete series
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="space-y-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => (name.trim() && name.trim() !== s.name ? void save(s.id, { name: name.trim() }) : setName(s.name))}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            aria-label="Name"
            className="w-full bg-transparent text-2xl font-semibold tracking-tight outline-none md:text-3xl"
          />
          <About series={s} />
        </div>
        <div className="space-y-3">
          <Episodes series={s} />
          <AddLine
            label="New episode"
            onAdd={async (title) => {
              await api(`/series/${s.id}/episodes`, { method: 'POST', body: { title } });
              refresh();
            }}
          />
        </div>
      </div>
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{s.name}”?</AlertDialogTitle>
            <AlertDialogDescription>Its episodes stay on the board as cards.</AlertDialogDescription>
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

/** `/p/:wid/series/:sid`. */
export function SeriesPage() {
  const { wid = '', sid = '' } = useParams();
  return <SeriesView key={sid} wid={wid} id={sid} />;
}
