import { ChevronLeft, Paperclip, Plus, Settings } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, Navigate, Outlet, useMatch, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { COLUMN_LABELS, isWritingColumn, type BoardItem } from '@shared/board';
import { useVideoVersions, VersionStrip } from '@/components/card/ReviewView';
import { useDraft } from '@/components/card/useDraft';
import { WriteView } from '@/components/card/WriteView';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { api, errorMessage, mediaFileUrl } from '@/lib/api';
import { duration } from '@/lib/format';
import { LIST_ORDER, writes } from '@/lib/nav';
import { isNative, Studio } from '@/lib/native';
import { keys, queryClient, useBoardData, usePiece } from '@/lib/queries';
import type { PieceDetail } from '@/lib/types';
import { createStore, useStore } from '@/lib/ui-state';
import { cn } from '@/lib/utils';
import { pickedFiles } from '@/pages/SharePage';
import { uploadSummary, UploadsButton, usePieceUploads } from './AppChrome';

/** The page the phone's list shows (the first page I write for until I pick one), kept when I open a card and come back. */
const phonePage = createStore('', 'cs.phonePage');

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
  const sending = uploadSummary(usePieceUploads(item.id));
  return (
    <Link to={`/c/${item.id}`} className="relative flex items-center gap-3 overflow-hidden rounded-xl border bg-card px-4 py-3.5 text-base">
      <span className="min-w-0 flex-1 truncate">{item.title}</span>
      {sending ? (
        <>
          <span className={cn('shrink-0 text-[13px] tabular-nums', sending.failed ? 'text-destructive' : 'text-muted-foreground')}>{sending.text}</span>
          {!sending.failed && (
            <span className="absolute inset-x-0 bottom-0 h-0.5 bg-muted">
              <span className="block h-full bg-brand transition-[width]" style={{ width: `${sending.fraction * 100}%` }} />
            </span>
          )}
        </>
      ) : item.durationMs && !isWritingColumn(item.column) ? (
        <span className="shrink-0 text-[13px] text-muted-foreground tabular-nums">{duration(item.durationMs)}</span>
      ) : item.footage ? (
        <span className="shrink-0 text-[13px] text-muted-foreground">
          {item.footage} clip{item.footage === 1 ? '' : 's'}
        </span>
      ) : item.series ? (
        <span className="shrink-0 text-[13px] text-muted-foreground">Ep {item.series.episode}</span>
      ) : null}
    </Link>
  );
}

/** The phone's one list, like the laptop's Videos board: a page's cards from idea to posted, Review first. */
function Videos() {
  const board = useBoardData();
  const wid = useStore(phonePage);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const pages = (board.data?.pages ?? []).filter((p) => !p.hidden);
  const page = pages.find((p) => p.id === wid) ?? pages.find((p) => writes(p.kind)) ?? pages[0];
  const writer = !!page && writes(page.kind);

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
  const items = board.data.items.filter((i) => i.workspaceId === page?.id);
  return (
    <>
      <header className="pt-safe flex items-center gap-2 px-4 pb-2">
        <div className="flex h-14 min-w-0 flex-1 items-center gap-2">
          {pages.length > 1 ? (
            <select value={page?.id} onChange={(e) => phonePage.set(e.target.value)} className="min-w-0 truncate bg-transparent text-2xl font-semibold outline-none">
              {pages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : (
            <h1 className="text-2xl font-semibold">Videos</h1>
          )}
        </div>
        <UploadsButton />
        <AddFootage />
        {writer && (
          <Button size="icon" className="size-10 rounded-full" aria-label="New idea" onClick={() => setAdding(true)}>
            <Plus />
          </Button>
        )}
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
        {LIST_ORDER.map((c) => {
          const list = items.filter((i) => i.column === c).sort((a, b) => (isWritingColumn(c) ? a.position - b.position : b.updatedAt - a.updatedAt));
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
        {!items.length && !adding && <p className="pt-10 text-center text-muted-foreground">No videos yet</p>}
      </div>
    </>
  );
}

/** A card's video on the phone, to watch: the newest render, and a tap on an older version plays that one instead. */
function PhoneVideo({ piece }: { piece: PieceDetail }) {
  const { versions, current, loading } = useVideoVersions(piece.id);
  const [picked, setPicked] = useState<string | null>(null);
  const mediaId = picked ?? current?.mediaId;
  const playing = versions.find((v) => v.render?.mediaId === mediaId)?.render ?? current;
  return (
    <div className="space-y-4">
      {mediaId ? (
        <>
          <video key={mediaId} src={mediaFileUrl(mediaId)} controls playsInline preload="metadata" className="mx-auto aspect-[9/16] max-h-[72vh] w-full rounded-xl bg-black" />
          <p className="text-[13px] text-muted-foreground">
            v{playing?.versionNumber ?? '?'}
            {playing?.id === current?.id && ' · now'}
          </p>
          <VersionStrip versions={versions} current={current} selected={picked} onPick={setPicked} />
        </>
      ) : (
        <div className="grid aspect-[9/16] max-h-[72vh] w-full place-items-center rounded-xl bg-muted text-muted-foreground">{loading ? <Spinner /> : 'No render yet'}</div>
      )}
    </div>
  );
}

/**
 * A card on a page I write for, at any stage, as on the laptop: the document and the video, the one the stage needs
 * first. While I write, the video shows once one was made.
 */
function PhoneDoc({ piece, item }: { piece: PieceDetail; item: BoardItem }) {
  const draft = useDraft(piece);
  const { current } = useVideoVersions(piece.id);
  const writing = isWritingColumn(item.column);
  const video = <PhoneVideo piece={piece} />;
  return <WriteView piece={piece} draft={draft} phone={{ column: item.column, series: item.series, above: writing ? undefined : video, below: writing && current ? video : undefined }} />;
}

/** A clip (a clipping page's card): its video to watch. */
function PhoneClip({ piece }: { piece: PieceDetail }) {
  return (
    <div className="pb-safe h-full space-y-4 overflow-y-auto px-4 pb-8">
      <h1 className="text-xl font-semibold">{piece.title}</h1>
      <PhoneVideo piece={piece} />
    </div>
  );
}

/** One card on the phone. */
function PhoneCard({ id }: { id: string }) {
  const piece = usePiece(id);
  const board = useBoardData();
  const item = board.data?.items.find((i) => i.id === id);
  const kind = board.data?.pages.find((p) => p.id === item?.workspaceId)?.kind ?? 'personal';
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
        ) : writes(kind) ? (
          <PhoneDoc key={id} piece={piece.data} item={item} />
        ) : (
          <PhoneClip key={id} piece={piece.data} />
        )}
      </div>
    </>
  );
}

/**
 * The phone (PLAN.md Phase 14): write scripts, send footage to a video, and watch the videos. Settings (pairing,
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
      {home ? <Videos /> : card?.params.id ? <PhoneCard id={card.params.id} /> : passthrough ? <Outlet /> : <Navigate to="/" replace />}
    </div>
  );
}
