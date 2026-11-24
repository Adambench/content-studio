// One video: the version in the middle, the thread with Claude beside it (Thread, Script, Files, Terminal), one box
// for notes and messages. On the phone the video fills the screen and the thread slides up.

import { ArrowLeft, Check, Columns2, Layers, MessageSquare, PenLine, Share2, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { KIND_LABEL, type VideoDetail } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { Dock } from '@/components/video/Dock';
import { PostSheet } from '@/components/video/PostSheet';
import { createPlayer, PlayerCtx, usePlayer, usePS } from '@/components/video/player';
import { shownVersion, Stage } from '@/components/video/Stage';
import { BriefTab, FilesTab, ScriptTab, TerminalTab } from '@/components/video/Tabs';
import { Thread } from '@/components/video/Thread';
import { Timeline } from '@/components/video/Timeline';
import { tc } from '@/lib/format';
import { isNative, pickToVideo } from '@/lib/native';
import { usePages, useUpdatePage, useVideo, useVideoActions } from '@/lib/queries';
import { uploadFiles } from '@/lib/uploads';
import { usePhone } from '@/lib/usePhone';
import { cn } from '@/lib/utils';

type Tab = 'thread' | 'script' | 'brief' | 'files' | 'terminal';

export function VideoPage() {
  const { videoId = '' } = useParams();
  const q = useVideo(videoId);
  if (q.isPending)
    return (
      <div className="grid h-full place-items-center">
        <Spinner />
      </div>
    );
  if (!q.data) return <div className="grid h-full place-items-center text-sm text-muted-foreground">This video isn’t here any more.</div>;
  return <Studio key={videoId} detail={q.data} />;
}

function Studio({ detail }: { detail: VideoDetail }) {
  const latest = detail.versions.at(-1)?.n ?? 0;
  const player = useMemo(() => createPlayer(detail.video.status === 'ready' || detail.video.status === 'posted' ? (detail.video.approvedN ?? latest) : latest), []); // eslint-disable-line react-hooks/exhaustive-deps
  // A new version shows itself.
  const seen = useRef(latest);
  useEffect(() => {
    if (latest > seen.current) player.set({ ver: latest, compare: false, t: 0, slide: 0 });
    seen.current = latest;
  }, [latest, player]);
  return (
    <PlayerCtx.Provider value={player}>
      <StudioBody detail={detail} />
    </PlayerCtx.Provider>
  );
}

function StudioBody({ detail }: { detail: VideoDetail }) {
  const v = detail.video;
  const phone = usePhone();
  const navigate = useNavigate();
  const p = usePlayer();
  const act = useVideoActions(v.id);
  const pages = usePages();
  const page = pages.data?.find((b) => b.id === v.pageId);
  // A page's setup: the same studio, but what's made is the page (its brief and look), approved once, never posted.
  const isPage = v.kind === 'page';
  const updatePage = useUpdatePage();
  const home = isPage ? `/p/${v.pageId}` : '/';
  const [tab, setTab] = useState<Tab>('thread');
  const [rail, setRail] = useState(false);
  const [post, setPost] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const ver = usePS((s) => s.ver);
  const compare = usePS((s) => s.compare);
  const version = shownVersion(detail.versions, ver, false);
  const open = detail.notes.filter((n) => n.status === 'open' || n.status === 'sent').length;

  // Opening it (and anything new arriving while it's open) counts as seen.
  const lastId = detail.thread.at(-1)?.id;
  useEffect(() => {
    if (v.unseen) act.seen.mutate();
  }, [lastId]); // eslint-disable-line react-hooks/exhaustive-deps

  const attach = async () => {
    if (isNative) {
      const n = await pickToVideo(v);
      if (n) toast(`${n} file${n > 1 ? 's' : ''} uploading`);
    } else fileInput.current?.click();
  };
  const approve = () => {
    if (!version || v.status === 'done') return;
    if (v.status === 'ready' || v.status === 'posted') return setPost(true);
    if (open) return toast('Fix or drop the open notes first');
    act.approve.mutate(version.n, { onSuccess: () => (isPage ? toast(`${page?.name ?? 'The page'} is set up: new videos follow it`) : setPost(true)) });
  };
  const flip = () => {
    const i = detail.versions.findIndex((x) => x.n === ver);
    if (i < 1) return toast('No earlier version to compare with');
    p.set({ compare: !p.get().compare });
  };
  const focusNote = () => {
    p.focusDock();
    setTab('thread');
    if (phone) setRail(true);
  };

  // Keys: Space/K play, J/L 5 s, arrows a frame (Shift: a second), C note, F fix, A approve, V compare.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.closest('input, textarea, [contenteditable="true"], [data-terminal], [role="dialog"]')) return;
      const k = e.key.toLowerCase();
      if (k === ' ' || k === 'k') p.toggle();
      else if (k === 'arrowleft' || k === 'arrowright') {
        if (version?.kind === 'carousel') p.set({ slide: Math.max(0, Math.min(version.slides - 1, p.get().slide + (k === 'arrowright' ? 1 : -1))) });
        else p.step((k === 'arrowright' ? 1 : -1) * (e.shiftKey ? 30 : 1));
      } else if (k === 'j' || k === 'l') p.seek(p.get().t + (k === 'l' ? 5 : -5));
      else if (k === 'c') focusNote();
      else if (k === 'f') detail.notes.some((n) => n.status === 'open') ? act.fix.mutate() : toast('No open notes');
      else if (k === 'a') approve();
      else if (k === 'v') flip();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const drop = {
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: (e: React.DragEvent) => e.currentTarget === e.target && setDragging(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const files = [...e.dataTransfer.files];
      if (files.length) uploadFiles(v.id, files);
    },
  };

  const tabs = (
    <div className="flex gap-1 border-b px-2">
      {(isPage ? (['thread', 'brief', 'files', 'terminal'] as const) : (['thread', 'script', 'files', 'terminal'] as const)).map((k) => (
        <button key={k} type="button" onClick={() => setTab(k)} className={cn('-mb-px border-b-2 px-2.5 py-2 text-sm capitalize', tab === k ? 'border-foreground text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
          {k === 'script' && version?.kind === 'carousel' ? 'Script' : k}
          {k === 'files' && detail.inputs.length > 0 && <span className="ml-1 text-xs text-muted-foreground">{detail.inputs.length}</span>}
        </button>
      ))}
    </div>
  );
  const body = (
    <div className={cn('min-h-0 flex-1 p-3', tab === 'terminal' || tab === 'script' || tab === 'brief' ? 'flex flex-col' : 'overflow-y-auto')}>
      {tab === 'thread' && <Thread detail={detail} />}
      {tab === 'script' && <ScriptTab videoId={v.id} />}
      {tab === 'brief' && <BriefTab detail={detail} />}
      {tab === 'files' && <FilesTab detail={detail} onAttach={() => void attach()} />}
      {tab === 'terminal' && <TerminalTab detail={detail} />}
    </div>
  );
  const dock = tab !== 'terminal' && <Dock detail={detail} onAttach={() => void attach()} />;
  const hidden = <input ref={fileInput} type="file" multiple hidden accept="video/*,audio/*,image/*" onChange={(e) => (e.currentTarget.files?.length ? uploadFiles(v.id, [...e.currentTarget.files]) : undefined)} />;
  const approveLabel = v.status === 'ready' || v.status === 'posted' ? 'Post' : `Approve v${version?.n ?? ''}`;

  if (phone)
    return (
      <div className="relative h-full overflow-hidden bg-black" {...drop}>
        {hidden}
        <div className="absolute inset-0">
          <Stage detail={detail} onGo={() => act.go.mutate()} fill />
        </div>
        <div className="pt-safe absolute inset-x-0 top-0 z-10 flex items-center gap-2 bg-gradient-to-b from-black/80 to-transparent px-2 pb-6">
          <Button size="icon" variant="ghost" className="text-white" onClick={() => navigate(home)} aria-label="Back">
            <ArrowLeft />
          </Button>
          <div className="min-w-0 flex-1 truncate text-sm font-medium text-white">{isPage ? `Set up ${page?.name ?? ''}` : v.title}</div>
          {compare && <span className="rounded bg-you px-1.5 font-mono text-xs text-black">compare</span>}
        </div>
        {version && (
          <div className="absolute right-2 bottom-20 z-10 flex flex-col items-center gap-4">
            <Side icon={PenLine} label="Note" onClick={focusNote} />
            <Side icon={MessageSquare} label="Thread" onClick={() => setRail(true)} badge={open || undefined} />
            {detail.versions.length > 1 && <Side icon={Layers} label={`v${ver}`} onClick={() => p.set({ ver: detail.versions[(detail.versions.findIndex((x) => x.n === ver) + 1) % detail.versions.length]!.n, compare: false })} />}
            {v.status !== 'posted' && v.status !== 'done' && <Side icon={v.status === 'ready' ? Share2 : Check} label={v.status === 'ready' ? 'Post' : 'Approve'} onClick={approve} />}
          </div>
        )}
        {!version && (
          <div className="absolute inset-x-0 bottom-6 z-10 flex justify-center">
            <Button variant="secondary" onClick={() => setRail(true)}>
              <MessageSquare /> Thread
            </Button>
          </div>
        )}
        <div className="pb-safe absolute inset-x-3 bottom-3 z-10 mr-14">
          <Timeline version={version} notes={detail.notes} compact />
        </div>
        <Sheet open={rail} onOpenChange={setRail}>
          <SheetContent side="bottom" className="flex flex-col gap-0 rounded-t-2xl p-0 data-[side=bottom]:h-[78%]" aria-describedby={undefined}>
            <SheetTitle className="sr-only">Thread</SheetTitle>
            <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-muted" />
            {tabs}
            {body}
            <div className="pb-safe">{dock}</div>
          </SheetContent>
        </Sheet>
        {!isPage && <PostSheet detail={detail} open={post} onOpenChange={setPost} />}
      </div>
    );

  return (
    <div className="relative grid h-full grid-cols-[minmax(0,1fr)_minmax(340px,400px)] grid-rows-[auto_minmax(0,1fr)]" {...drop}>
      {hidden}
      <header className="col-span-2 flex min-w-0 items-center gap-2 border-b px-3 py-2">
        <Button size="icon" variant="ghost" onClick={() => navigate(home)} aria-label={isPage ? 'Back to the page' : 'Back to the inbox'}>
          <ArrowLeft />
        </Button>
        <span className="size-2 shrink-0 rounded-full" style={{ background: page?.color }} />
        {isPage ? (
          page && <Title key={page.name} value={page.name} onSave={(name) => updatePage.mutate({ id: page.id, name })} />
        ) : (
          <>
            <span className="shrink-0 text-sm text-muted-foreground">{page?.name}</span>
            <span className="text-muted-foreground">/</span>
            <Title value={v.title} onSave={(title) => act.update.mutate({ title })} />
          </>
        )}
        <span className="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">{KIND_LABEL[v.kind]}</span>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {detail.versions.length > 0 && (
            <div className="flex rounded-lg border p-0.5" role="group" aria-label="Versions">
              {detail.versions.map((x) => (
                <button key={x.id} type="button" onClick={() => p.set({ ver: x.n, compare: false })} className={cn('rounded-md px-2 py-0.5 font-mono text-xs', x.n === ver ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground')}>
                  v{x.n}
                </button>
              ))}
            </div>
          )}
          {version && v.status !== 'posted' && v.status !== 'done' && (
            <Button size="sm" onClick={approve} disabled={act.approve.isPending}>
              {v.status === 'ready' ? <Share2 /> : <Check />} {approveLabel} {v.status !== 'ready' && <Kbd className="ml-0.5">A</Kbd>}
            </Button>
          )}
          {v.status === 'posted' && (
            <Button size="sm" variant="outline" onClick={() => setPost(true)}>
              Posted
            </Button>
          )}
          {v.status === 'done' && (
            <span className="flex items-center gap-1 px-2 text-sm text-muted-foreground">
              <Check className="size-4" /> Set up
            </span>
          )}
          {confirmDelete ? (
            <Button size="sm" variant="destructive" onClick={() => act.remove.mutate(undefined, { onSuccess: () => navigate(home) })}>
              {isPage ? 'Delete the setup and its folder' : 'Delete it and its folder'}
            </Button>
          ) : (
            <Button size="icon" variant="ghost" aria-label={isPage ? 'Delete this setup' : 'Delete this video'} onClick={() => setConfirmDelete(true)} onBlur={() => setTimeout(() => setConfirmDelete(false), 200)}>
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      </header>
      <section className="flex min-h-0 min-w-0 flex-col gap-3 p-4">
        <div className="min-h-0 flex-1">
          <Stage detail={detail} onGo={() => act.go.mutate()} />
        </div>
        {version && version.kind === 'video' && <Transport onCompare={flip} onNote={focusNote} canCompare={detail.versions.length > 1} />}
        <Timeline version={version} notes={detail.notes} />
      </section>
      <aside className="flex min-h-0 flex-col border-l">
        {tabs}
        {body}
        {dock}
      </aside>
      {dragging && <div className="pointer-events-none absolute inset-0 z-30 grid place-items-center rounded-lg border-2 border-dashed border-you bg-background/70 text-sm">{isPage ? 'Drop to add to the page’s setup' : 'Drop to add to this video'}</div>}
      {!isPage && <PostSheet detail={detail} open={post} onOpenChange={setPost} />}
    </div>
  );
}

function Transport({ onCompare, onNote, canCompare }: { onCompare: () => void; onNote: () => void; canCompare: boolean }) {
  const p = usePlayer();
  const t = usePS((s) => s.t);
  const d = usePS((s) => s.duration);
  const playing = usePS((s) => s.playing);
  const compare = usePS((s) => s.compare);
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="ghost" onClick={() => p.toggle()} className="w-16 justify-start">
        {playing ? 'Pause' : 'Play'}
      </Button>
      <span className="font-mono text-xs text-muted-foreground tabular-nums">
        <span className="text-foreground">{tc(t)}</span> / {tc(d)}
      </span>
      <span className="ml-auto" />
      {canCompare && (
        <Button size="sm" variant={compare ? 'secondary' : 'ghost'} onClick={onCompare}>
          <Columns2 /> Compare <Kbd>V</Kbd>
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={onNote}>
        <PenLine /> Note <Kbd>C</Kbd>
      </Button>
    </div>
  );
}

function Title({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  return (
    <span
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      className="min-w-0 truncate rounded px-1 text-sm font-semibold outline-none focus:bg-secondary"
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      onBlur={(e) => {
        const next = e.currentTarget.textContent?.trim();
        if (next && next !== value) onSave(next);
        else e.currentTarget.textContent = value;
      }}
    >
      {value}
    </span>
  );
}

function Side({ icon: Icon, label, onClick, badge }: { icon: typeof Check; label: string; onClick: () => void; badge?: number }) {
  return (
    <button type="button" onClick={onClick} className="flex flex-col items-center gap-1 text-[11px] text-white [text-shadow:0_1px_6px_#000]">
      <span className="relative grid size-11 place-items-center rounded-full bg-black/55 backdrop-blur">
        <Icon className="size-5" />
        {badge && <span className="absolute -top-0.5 -right-0.5 grid size-4 place-items-center rounded-full bg-you text-[10px] font-semibold text-black">{badge}</span>}
      </span>
      {label}
    </button>
  );
}
