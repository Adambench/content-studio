import { ArrowLeft, Clapperboard, History, Save, Sparkles } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { EDIT_FORMATS, SHORT_MAX_SECONDS, editDuration, type EditSpec } from '@shared/edit';
import { CaptionsPanel } from '@/components/studio/CaptionsPanel';
import { ClipsPanel } from '@/components/studio/ClipsPanel';
import { StudioContext, type Selection, type StudioState } from '@/components/studio/context';
import { preciseClock } from '@/components/studio/controls';
import { EditHistory } from '@/components/studio/EditHistory';
import { LookPanel } from '@/components/studio/LookPanel';
import { OverlaysPanel } from '@/components/studio/OverlaysPanel';
import { Player, type PlayerHandle } from '@/components/studio/Player';
import { RenderButton, RendersPanel } from '@/components/studio/RendersPanel';
import { SoundPanel } from '@/components/studio/SoundPanel';
import { Timeline } from '@/components/studio/Timeline';
import { useWorkspaceContext } from '@/components/WorkspaceLayout';
import { ScriptPanel } from '@/components/studio/ScriptPanel';
import { Button } from '@/components/ui/button';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, errorMessage } from '@/lib/api';
import { onLiveEvent } from '@/lib/live';
import { keys, queryClient, useEdit, useMedia, usePiece } from '@/lib/queries';
import type { EditDetail, Media, PieceDetail } from '@/lib/types';
import { cn } from '@/lib/utils';

type SaveState = 'saved' | 'dirty' | 'saving' | 'error';
type Tab = 'script' | 'clips' | 'captions' | 'text' | 'sound' | 'look' | 'renders';
const TAB_FOR: Record<NonNullable<Selection>['kind'], Tab> = { clip: 'clips', overlay: 'text', sfx: 'sound' };
const same = (a: EditSpec, b: EditSpec) => JSON.stringify(a) === JSON.stringify(b);

export function StudioPage() {
  const { pid = '' } = useParams();
  const { workspace } = useWorkspaceContext();
  const piece = usePiece(pid);
  const edit = useEdit(pid);
  const navigate = useNavigate();
  const [starting, setStarting] = useState(false);

  if (edit.isError || piece.isError) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">This piece doesn’t exist any more.</p>
          <Button variant="outline" size="sm" onClick={() => navigate(`/w/${workspace.id}/board`)}>
            Back to board
          </Button>
        </div>
      </div>
    );
  }
  if (edit.isPending)
    return (
      <div className="flex gap-6 p-6">
        <Skeleton className="aspect-[9/16] h-[60dvh] rounded-lg" />
        <Skeleton className="h-60 flex-1" />
      </div>
    );

  if (!edit.data) {
    const footage = (piece.data?.media ?? []).filter((m) => (m.kind === 'video' || m.kind === 'image') && m.source !== 'render').length;
    return (
      <div className="flex h-full flex-col">
        <StudioHeader pieceId={pid} title={piece.data?.title} />
        <Empty className="m-6 border border-dashed">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Clapperboard />
            </EmptyMedia>
            <EmptyTitle>Edit this video</EmptyTitle>
            <EmptyDescription>
              {footage
                ? `Starts with the ${footage} clip${footage === 1 ? '' : 's'} attached to this piece, in your brand’s look. Then tighten the pauses, style the captions, add sound effects and render.`
                : 'Attach footage to the piece first (or add clips once you’re in). You get captions from what’s said, sound effects, text, b-roll and a branded look.'}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              disabled={starting}
              onClick={async () => {
                setStarting(true);
                try {
                  const detail = await api<EditDetail>(`/pieces/${pid}/edit`, { body: {} });
                  queryClient.setQueryData(keys.edit(pid), detail);
                } catch (err) {
                  toast.error(errorMessage(err));
                } finally {
                  setStarting(false);
                }
              }}
            >
              {starting ? <Spinner /> : <Clapperboard />} Start editing
            </Button>
          </EmptyContent>
        </Empty>
      </div>
    );
  }
  return <Studio key={edit.data.id} edit={edit.data} piece={piece.data} />;
}

function StudioHeader({ pieceId, title, children }: { pieceId: string; title?: string; children?: React.ReactNode }) {
  const { workspace } = useWorkspaceContext();
  return (
    <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2.5 md:px-4">
      <Button variant="ghost" size="icon-sm" asChild aria-label="Back to the video">
        <Link to={`/w/${workspace.id}/p/${pieceId}`}>
          <ArrowLeft />
        </Link>
      </Button>
      <div className="mr-auto min-w-0">
        <h1 className="truncate text-sm font-semibold tracking-tight">{title ?? 'Video'}</h1>
        <p className="text-xs text-muted-foreground">Video editor</p>
      </div>
      {children}
    </header>
  );
}

function Studio({ edit, piece }: { edit: EditDetail; piece: PieceDetail | undefined }) {
  const { workspace } = useWorkspaceContext();
  const [spec, setSpec] = useState<EditSpec>(edit.working);
  const [state, setState] = useState<SaveState>('saved');
  const [remoteChange, setRemoteChange] = useState(false);
  const [rev, setRev] = useState(edit.workingUpdatedAt);
  const synced = useRef<EditSpec>(edit.working);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [time, setTime] = useState(0);
  const [selection, setSelection] = useState<Selection>(null);
  // A format video opens on its words.
  const [tab, setTab] = useState<Tab>(edit.working.recipe ? 'script' : 'clips');
  const [historyOpen, setHistoryOpen] = useState(false);
  const player = useRef<PlayerHandle>(null);
  const footage = useMedia(workspace.id, { scope: 'footage' });
  const assets = useMedia(workspace.id, { scope: 'assets' });

  // Take the server's edit (Claude, another device, tighten…) unless I have unsaved changes.
  useEffect(() => {
    if (same(edit.working, synced.current)) return;
    if (state === 'saved') {
      setSpec(edit.working);
      synced.current = edit.working;
      setRev(edit.workingUpdatedAt);
    } else setRemoteChange(true);
  }, [edit.working]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(
    () =>
      onLiveEvent((e) => {
        if (e.type === 'edit' && e.editId === edit.id && e.by === 'claude') toast('Claude updated the video', { icon: <Sparkles className="size-4 text-brand" /> });
      }),
    [edit.id],
  );

  const flush = useCallback(
    async (next: EditSpec) => {
      clearTimeout(timer.current);
      if (same(next, synced.current)) return setState('saved');
      setState('saving');
      try {
        const r = await api<{ workingUpdatedAt: number }>(`/edits/${edit.id}/working`, { method: 'PUT', body: { spec: next } });
        synced.current = next;
        setRev(r.workingUpdatedAt);
        setState((s) => (s === 'saving' ? 'saved' : s));
      } catch (err) {
        setState('error');
        toast.error(errorMessage(err));
      }
    },
    [edit.id],
  );

  const latest = useRef(spec);
  latest.current = spec;
  useEffect(() => () => void flush(latest.current), [flush]);

  const update = useCallback(
    (fn: (s: EditSpec) => EditSpec) => {
      setSpec((s) => {
        const next = fn(s);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => flush(next), 600);
        return next;
      });
      setState('dirty');
    },
    [flush],
  );

  const serverAction = useCallback(
    async <T,>(fn: () => Promise<T>) => {
      await flush(latest.current);
      setState('saved');
      setRemoteChange(false);
      const result = await fn();
      await queryClient.invalidateQueries({ queryKey: keys.edit(edit.pieceId) });
      return result;
    },
    [flush, edit.pieceId],
  );

  async function saveVersion() {
    clearTimeout(timer.current);
    setState('saving');
    try {
      const r = await api<{ number: number; unchanged: boolean }>(`/edits/${edit.id}/versions`, { body: { spec } });
      synced.current = spec;
      setState('saved');
      setRemoteChange(false);
      toast.success(r.unchanged ? 'No changes since the last version' : `Saved v${r.number}`);
      queryClient.invalidateQueries({ queryKey: keys.edit(edit.pieceId) });
    } catch (err) {
      setState('error');
      toast.error(errorMessage(err));
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void saveVersion();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const media = useMemo(() => {
    const map = new Map<string, Media>();
    for (const m of [...(footage.data ?? []), ...(assets.data ?? []), ...edit.media]) map.set(m.id, m);
    return map;
  }, [footage.data, assets.data, edit.media]);

  const seek = useCallback((t: number) => {
    setTime(t);
    player.current?.seek(t);
  }, []);
  const select = useCallback((s: Selection) => {
    setSelection(s);
    if (s) setTab(TAB_FOR[s.kind]);
  }, []);

  const preparing = edit.media.filter((m) => m.proxyStatus === 'queued' || m.proxyStatus === 'running').length;
  const failed = edit.media.filter((m) => m.proxyStatus === 'error');
  const ready = edit.media.filter((m) => m.proxyStatus === 'done').length;
  const previewPath = `/edits/${edit.id}/preview.html?v=${rev}-${ready}`;
  const box = EDIT_FORMATS[spec.format];
  const total = editDuration(spec);

  const ctx: StudioState = { edit, piece, spec, update, serverAction, time, seek, selection, select, media, footage: footage.data ?? [], assets: assets.data ?? [], showTab: setTab };

  return (
    <StudioContext.Provider value={ctx}>
      <div className="flex h-full flex-col">
        <StudioHeader pieceId={edit.pieceId} title={piece?.title}>
          <SaveIndicator state={state} />
          <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
            <History /> <span className="hidden sm:inline">History</span>
            {edit.versions.length > 0 && <span className="text-muted-foreground tabular-nums">{edit.versions.length}</span>}
          </Button>
          <Button variant="ghost" size="sm" onClick={saveVersion} className="hidden sm:inline-flex">
            <Save /> Save version
          </Button>
          <RenderButton onShow={() => setTab('renders')} />
        </StudioHeader>

        {remoteChange && (
          <div className="flex flex-wrap items-center gap-2 border-b border-brand/30 bg-brand-soft px-4 py-2 text-sm">
            <Sparkles className="size-4 text-brand" />
            <span className="mr-auto">The edit changed elsewhere (probably Claude) while you were working.</span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                clearTimeout(timer.current);
                setSpec(edit.working);
                synced.current = edit.working;
                setRev(edit.workingUpdatedAt);
                setState('saved');
                setRemoteChange(false);
              }}
            >
              Load latest
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRemoteChange(false)}>
              Keep mine
            </Button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto lg:flex lg:overflow-hidden">
          <div className="flex flex-col items-center gap-2 p-3 lg:min-h-0 lg:min-w-0 lg:flex-1">
            <FitBox ratio={box.width / box.height} className="h-[42dvh] w-full lg:h-auto lg:min-h-0 lg:flex-1">
              <Player ref={player} path={previewPath} width={box.width} height={box.height} onTime={setTime} className="size-full" />
            </FitBox>
            <div className="flex w-full max-w-sm flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="tabular-nums">
                {preciseClock(time)} / {preciseClock(total)}
              </span>
              {preparing > 0 && (
                <span className="flex items-center gap-1">
                  <Spinner className="size-3" /> Preparing {preparing} clip{preparing === 1 ? '' : 's'} for preview
                </span>
              )}
              {failed.length > 0 && <span className="text-destructive">Couldn’t prepare {failed.map((m) => m.originalName).join(', ')}</span>}
              {total > SHORT_MAX_SECONDS && <span className="text-amber-400">Over {SHORT_MAX_SECONDS / 60} min — too long for Reels and Shorts</span>}
            </div>
          </div>

          <div className="lg:min-h-0 lg:w-[min(26rem,48%)] lg:shrink-0 lg:overflow-y-auto lg:border-l">
            <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="gap-0">
              <TabsList className="sticky top-0 z-10 w-full justify-start overflow-x-auto rounded-none border-b bg-background px-2 [scrollbar-width:none]">
                {spec.recipe && (
                  <TabsTrigger value="script" className="flex-none">
                    Script
                  </TabsTrigger>
                )}
                <TabsTrigger value="clips" className="flex-none">
                  Clips
                </TabsTrigger>
                <TabsTrigger value="captions" className="flex-none">
                  Captions
                </TabsTrigger>
                <TabsTrigger value="text" className="flex-none">
                  Text & images
                </TabsTrigger>
                <TabsTrigger value="sound" className="flex-none">
                  Sound
                </TabsTrigger>
                <TabsTrigger value="look" className="flex-none">
                  Look
                </TabsTrigger>
                <TabsTrigger value="renders" className="flex-none">
                  Renders
                </TabsTrigger>
              </TabsList>
              <div className="p-4">
                <TabsContent value="script">
                  <ScriptPanel />
                </TabsContent>
                <TabsContent value="clips">
                  <ClipsPanel />
                </TabsContent>
                <TabsContent value="captions">
                  <CaptionsPanel />
                </TabsContent>
                <TabsContent value="text">
                  <OverlaysPanel />
                </TabsContent>
                <TabsContent value="sound">
                  <SoundPanel />
                </TabsContent>
                <TabsContent value="look">
                  <LookPanel />
                </TabsContent>
                <TabsContent value="renders">
                  <RendersPanel />
                </TabsContent>
              </div>
            </Tabs>
          </div>
        </div>

        <Timeline />
      </div>
      <EditHistory open={historyOpen} onOpenChange={setHistoryOpen} />
    </StudioContext.Provider>
  );
}

/** Holds its child at `ratio` (width / height), as large as fits. */
function FitBox({ ratio, className, children }: { ratio: number; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const { width, height } = el.getBoundingClientRect();
      if (!width || !height) return;
      setSize(width / height > ratio ? { width: height * ratio, height } : { width, height: width / ratio });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, [ratio]);
  return (
    <div ref={ref} className={cn('grid place-items-center', className)}>
      <div style={size ?? { width: 0, height: 0 }}>{children}</div>
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  const text = { saved: 'Saved', dirty: 'Editing…', saving: 'Saving…', error: 'Couldn’t save' }[state];
  return (
    <span className={cn('hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex', state === 'error' && 'text-destructive')} aria-live="polite">
      {state === 'saving' && <Spinner className="size-3" />}
      {text}
    </span>
  );
}
