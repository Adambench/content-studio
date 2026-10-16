import { ArrowRight, Check, Inbox, Plus, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { MediaCard } from '@/components/MediaCard';
import { MediaDialog } from '@/components/MediaDialog';
import { PageHeader } from '@/components/PageHeader';
import { UploadButton, UploadZone } from '@/components/UploadZone';
import { useWorkspaceContext } from '@/components/WorkspaceLayout';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { useNativePick, useUpload } from '@/hooks/useUpload';
import { api, errorMessage } from '@/lib/api';
import { boardLabel } from '@/lib/nav';
import { keys, queryClient, useBoard, useMedia } from '@/lib/queries';
import type { Media } from '@/lib/types';

const ACCEPT = 'video/*,image/*,audio/*';
const NEW = '__new__';

/**
 * Footage that isn't in a video yet: shared from the phone, the camera, uploads made outside a video. Claude guesses
 * where each file goes; one click files it there, or starts a new video with it.
 */
export function InboxPage() {
  const { workspace } = useWorkspaceContext();
  const [params, setParams] = useSearchParams();
  const media = useMedia(workspace.id, { scope: 'inbox' });
  const upload = useUpload(workspace.id);
  const pick = useNativePick(workspace.id);
  const [openId, setOpenId] = useState<string | null>(null);
  const [sorting, setSorting] = useState(false);
  const items = media.data ?? [];
  const guessed = items.filter((m) => m.suggestion);

  useEffect(() => {
    const shared = Number(params.get('shared') ?? 0);
    if (shared) {
      toast.success(`Added ${shared} file${shared === 1 ? '' : 's'} from your phone`, { description: 'Claude suggests where each goes once it’s transcribed.' });
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  async function sortAgain() {
    setSorting(true);
    try {
      await api(`/workspaces/${workspace.id}/inbox/sort`, { body: { again: true } });
      toast('Claude is looking through them');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSorting(false);
    }
  }

  async function fileAll() {
    for (const m of guessed) await file(workspace.id, m, m.suggestion!.pieceId ?? NEW, m.suggestion!.title, true);
    toast.success(`Filed ${guessed.length} file${guessed.length === 1 ? '' : 's'}`);
  }

  return (
    <UploadZone onFiles={upload} accept={ACCEPT} className="flex h-full flex-col">
      <PageHeader
        title="Inbox"
        description="Footage that isn’t in a video yet. Claude suggests where each file goes."
        actions={
          <>
            {items.length > 0 && (
              <Button size="sm" variant="ghost" onClick={sortAgain} disabled={sorting} title="Ask Claude again where each file goes">
                {sorting ? <Spinner /> : <RefreshCw />} <span className="hidden sm:inline">Suggest again</span>
              </Button>
            )}
            {guessed.length > 1 && (
              <Button size="sm" variant="outline" onClick={fileAll}>
                <Check /> File all {guessed.length}
              </Button>
            )}
            <UploadButton onFiles={upload} onPick={pick} accept={ACCEPT} />
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!media.data ? (
          <div className="mx-auto max-w-4xl space-y-3 p-4 md:p-6">
            <Skeleton className="h-28 rounded-xl" />
            <Skeleton className="h-28 rounded-xl" />
          </div>
        ) : !items.length ? (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Inbox />
              </EmptyMedia>
              <EmptyTitle>Nothing loose</EmptyTitle>
              <EmptyDescription>
                Every file is in a video. What you share from your phone or upload here waits in the Inbox until it’s filed; uploads made inside a video go straight into it.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="mx-auto max-w-4xl space-y-3 p-4 md:p-6">
            {items.map((m) => (
              <InboxRow key={m.id} media={m} onOpen={() => setOpenId(m.id)} />
            ))}
          </ul>
        )}
      </div>
      <MediaDialog wid={workspace.id} mediaId={openId} onClose={() => setOpenId(null)} />
    </UploadZone>
  );
}

/** File a loose file into a video, or start a new one with it. */
async function file(wid: string, m: Media, target: string, title: string, quiet = false) {
  try {
    if (target === NEW) await api(`/media/${m.id}/new-piece`, { body: { title } });
    else await api(`/media/${m.id}`, { method: 'PATCH', body: { pieceId: target } });
    queryClient.invalidateQueries({ queryKey: ['media', wid] });
    queryClient.invalidateQueries({ queryKey: keys.board(wid) });
    if (!quiet) toast.success(target === NEW ? `Started “${title}”` : 'Filed');
  } catch (err) {
    toast.error(errorMessage(err));
  }
}

function InboxRow({ media: m, onOpen }: { media: Media; onOpen: () => void }) {
  const { workspace } = useWorkspaceContext();
  const board = useBoard(workspace.id);
  const navigate = useNavigate();
  const s = m.suggestion;
  const [target, setTarget] = useState<string>(s ? (s.pieceId ?? NEW) : '');
  const [title, setTitle] = useState(s && !s.pieceId ? s.title : m.originalName.replace(/\.[^.]+$/, ''));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!s) return;
    setTarget(s.pieceId ?? NEW);
    if (!s.pieceId) setTitle(s.title);
  }, [s?.at]); // eslint-disable-line react-hooks/exhaustive-deps
  const pieces = (board.data ?? []).filter((p) => !['posted', 'scheduled'].includes(p.stage));
  const waiting = m.transcriptStatus === 'queued' || m.transcriptStatus === 'running';

  async function go() {
    setBusy(true);
    await file(workspace.id, m, target, title.trim() || m.originalName);
    setBusy(false);
  }

  async function remove() {
    await api(`/media/${m.id}`, { method: 'DELETE' }).catch((err) => toast.error(errorMessage(err)));
    queryClient.invalidateQueries({ queryKey: ['media', workspace.id] });
  }

  return (
    <li className="flex gap-3 rounded-xl border bg-card p-3">
      <div className="w-20 shrink-0 sm:w-24">
        <MediaCard media={m} onClick={onOpen} />
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-medium">{m.originalName}</p>
          <Button size="icon-sm" variant="ghost" aria-label="Delete the file" title="Delete the file" onClick={remove}>
            <Trash2 />
          </Button>
        </div>
        {m.transcriptText && <p className="line-clamp-2 text-xs text-muted-foreground">“{m.transcriptText.trim()}”</p>}
        {s ? (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Sparkles className="mt-0.5 size-3.5 shrink-0 text-brand" />
            <span>
              {s.pieceId ? `Belongs in “${s.title}”` : `A new video: “${s.title}”`}
              {s.why && <span className="text-muted-foreground/80"> — {s.why}</span>}
            </span>
          </p>
        ) : (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Spinner className="size-3" /> {waiting ? 'Transcribing, then Claude suggests where it goes' : 'Claude is looking at it'}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger size="sm" className="w-full min-w-0 sm:w-64" aria-label="Where it goes">
              <SelectValue placeholder="Put it in…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NEW}>
                <Plus /> A new video
              </SelectItem>
              {pieces.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {target === NEW && <Input value={title} onChange={(e) => setTitle(e.target.value)} className="h-8 w-full min-w-0 sm:w-56" aria-label="New video title" />}
          <Button size="sm" disabled={!target || busy} onClick={go}>
            {busy ? <Spinner /> : <ArrowRight />} File
          </Button>
          {target && target !== NEW && (
            <Button size="sm" variant="ghost" onClick={() => navigate(`/w/${workspace.id}/p/${target}`)}>
              Open
            </Button>
          )}
        </div>
        {!pieces.length && target !== NEW && <p className="text-xs text-muted-foreground">No {boardLabel(workspace.kind).toLowerCase()} in progress: start a new one.</p>}
      </div>
    </li>
  );
}
