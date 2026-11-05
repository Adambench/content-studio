import { ChevronLeft, Paperclip, Plus, Settings } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, Navigate, Outlet, useMatch, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { COLUMN_LABELS, isWritingColumn, WRITING_COLUMNS, type BoardItem } from '@shared/board';
import { WriteView } from '@/components/card/WriteView';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { api, errorMessage } from '@/lib/api';
import { writes } from '@/lib/nav';
import { isNative, Studio } from '@/lib/native';
import { keys, queryClient, useBoardData, usePiece } from '@/lib/queries';
import { pickedFiles } from '@/pages/SharePage';
import { UploadsButton } from './AppChrome';

/** The pages I write videos for (only those are on the phone). */
function useWriterPages() {
  const board = useBoardData();
  const pages = (board.data?.pages ?? []).filter((p) => !p.hidden && writes(p.kind));
  return { board, pages };
}

/** Pick clips (Android's picker, or the browser's), then say which video they're for. */
function AddFootage() {
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  async function pick() {
    if (!isNative) return input.current?.click();
    try {
      const { files } = await Studio.pickFiles({ accept: ['video/*', 'audio/*'] });
      if (!files.length) return;
      pickedFiles.set({ native: files });
      navigate('/share');
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }
  return (
    <>
      <Button variant="outline" className="h-10 px-3.5 text-[15px]" onClick={pick}>
        <Paperclip /> Add footage
      </Button>
      <input
        ref={input}
        type="file"
        accept="video/*,audio/*"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (!files.length) return;
          pickedFiles.set({ web: files });
          navigate('/share');
        }}
      />
    </>
  );
}

function Row({ item }: { item: BoardItem }) {
  return (
    <Link to={`/c/${item.id}`} className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3.5 text-base">
      <span className="min-w-0 flex-1 truncate">{item.title}</span>
      {item.footage ? (
        <span className="shrink-0 text-[13px] text-muted-foreground">
          {item.footage} clip{item.footage === 1 ? '' : 's'}
        </span>
      ) : item.series ? (
        <span className="shrink-0 text-[13px] text-muted-foreground">Ep {item.series.episode}</span>
      ) : null}
    </Link>
  );
}

/** The phone's one screen: my scripts, Ready to film first. */
function Scripts() {
  const { board, pages } = useWriterPages();
  const [wid, setWid] = useState('');
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const page = pages.find((p) => p.id === wid) ?? pages[0];

  async function add() {
    const t = title.trim();
    if (!t || !page) return;
    setTitle('');
    setAdding(false);
    try {
      await api(`/workspaces/${page.id}/pieces`, { method: 'POST', body: { title: t, stage: 'idea' } });
      void queryClient.invalidateQueries({ queryKey: keys.boardAll });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  if (!board.data)
    return (
      <div className="grid flex-1 place-items-center">
        <Spinner />
      </div>
    );
  const items = board.data.items.filter((i) => i.workspaceId === page?.id && isWritingColumn(i.column));
  return (
    <>
      <header className="pt-safe flex items-center gap-2 px-4 pb-2">
        <div className="flex h-14 min-w-0 flex-1 items-center gap-2">
          {pages.length > 1 ? (
            <select value={page?.id} onChange={(e) => setWid(e.target.value)} className="min-w-0 truncate bg-transparent text-2xl font-semibold outline-none">
              {pages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : (
            <h1 className="text-2xl font-semibold">Scripts</h1>
          )}
        </div>
        <UploadsButton />
        <AddFootage />
        <Button size="icon" className="size-10 rounded-full" aria-label="New idea" onClick={() => setAdding(true)}>
          <Plus />
        </Button>
        <Button variant="ghost" size="icon" className="size-10" aria-label="Settings" asChild>
          <Link to="/settings">
            <Settings />
          </Link>
        </Button>
      </header>
      <div className="pb-safe min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {adding && (
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void add()}
            onBlur={() => !title.trim() && setAdding(false)}
            placeholder="Title, then Enter"
            className="mb-3 w-full rounded-xl border bg-muted/40 px-4 py-3.5 text-base outline-none"
          />
        )}
        {[...WRITING_COLUMNS].reverse().map((c) => {
          const list = items.filter((i) => i.column === c).sort((a, b) => a.position - b.position);
          if (!list.length) return null;
          return (
            <section key={c}>
              <h2 className="px-1 pt-5 pb-2 text-xs font-semibold tracking-widest text-muted-foreground uppercase">{COLUMN_LABELS[c]}</h2>
              <div className="flex flex-col gap-2">
                {list.map((i) => (
                  <Row key={i.id} item={i} />
                ))}
              </div>
            </section>
          );
        })}
        {!items.length && !adding && <p className="pt-10 text-center text-muted-foreground">No scripts yet</p>}
      </div>
    </>
  );
}

/** One script on the phone: the same document as on the laptop. */
function PhoneCard({ id }: { id: string }) {
  const piece = usePiece(id);
  const board = useBoardData();
  const item = board.data?.items.find((i) => i.id === id);
  return (
    <>
      <header className="pt-safe flex items-center gap-2 px-2">
        <div className="flex h-14 flex-1 items-center">
          <Button variant="ghost" size="icon" className="size-10" aria-label="Back" asChild>
            <Link to="/">
              <ChevronLeft className="size-6" />
            </Link>
          </Button>
        </div>
        {item && <span className="mr-3 rounded-full bg-muted px-3 py-1 text-[13px] text-muted-foreground">{COLUMN_LABELS[item.column]}</span>}
      </header>
      <div className="min-h-0 flex-1">
        {!piece.data || !item ? (
          <div className="grid h-full place-items-center">{piece.isError ? <p className="text-muted-foreground">This card is gone.</p> : <Spinner />}</div>
        ) : isWritingColumn(item.column) ? (
          <WriteView key={id} piece={piece.data} column={item.column} series={item.series} phone />
        ) : (
          <p className="px-6 pt-10 text-center text-muted-foreground">Open this video on the laptop.</p>
        )}
      </div>
    </>
  );
}

/**
 * The phone does two things (PLAN.md Phase 14): write scripts, and send footage to a video. Settings (pairing,
 * notifications, the lock) and the share screen come through as they are.
 */
export function PhoneShell() {
  const home = useMatch('/');
  const card = useMatch('/c/:id');
  const share = useMatch('/share');
  const settings = useMatch('/settings/*');
  const passthrough = share || settings;
  return (
    <div className="flex h-full flex-col">
      {home ? <Scripts /> : card?.params.id ? <PhoneCard id={card.params.id} /> : passthrough ? <Outlet /> : <Navigate to="/" replace />}
    </div>
  );
}
