import { ArrowLeft } from 'lucide-react';
import { useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { COLUMN_LABELS, type BoardItem } from '@shared/board';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { api, errorMessage, uploadFiles } from '@/lib/api';
import { writes } from '@/lib/nav';
import { pendingShare, Studio, type QueuedFile } from '@/lib/native';
import { keys, queryClient, useBoardData } from '@/lib/queries';
import { createStore, useStore } from '@/lib/ui-state';

/** Clips picked with "Add footage": the phone's own files (the app), or the browser's. */
export const pickedFiles = createStore<{ native: QueuedFile[] } | { web: File[] } | null>(null);

const ORDER = ['film', 'writing', 'ideas'] as const;

/**
 * "Send N clips to": footage shared to the app (the share sheet) or picked with Add footage goes into the video I
 * pick, uploading in the background. Only clips (video, or voice for a voiceover) come here.
 */
export function SharePage() {
  const share = useStore(pendingShare);
  const picked = useStore(pickedFiles);
  const board = useBoardData();
  const navigate = useNavigate();
  const [sending, setSending] = useState<string | null>(null);
  // Picked in a browser: sent here and now, so show how far it's got.
  const [progress, setProgress] = useState<number | null>(null);
  const leaving = useRef(false);

  const shared = share?.files.filter((f) => f.mime.startsWith('video/') || f.mime.startsWith('audio/')) ?? [];
  const count = share ? shared.length : picked ? ('native' in picked ? picked.native.length : picked.web.length) : 0;
  if (!share && !picked) return leaving.current ? null : <Navigate to="/" replace />;

  async function close() {
    if (share) await Studio.discardShare({ id: share.id }).catch(() => {});
    leaving.current = true;
    pendingShare.set(null);
    pickedFiles.set(null);
    navigate('/', { replace: true });
  }

  async function send(target: BoardItem | 'new') {
    const page = board.data?.pages.find((p) => !p.hidden && writes(p.kind));
    if (!page) return;
    setSending(target === 'new' ? 'new' : target.id);
    try {
      let pieceId: string;
      let workspaceId: string;
      let title: string;
      if (target === 'new') {
        const made = await api<{ id: string; title: string }>(`/workspaces/${page.id}/pieces`, { method: 'POST', body: { title: 'New video', stage: 'film' } });
        pieceId = made.id;
        workspaceId = page.id;
        title = made.title;
      } else {
        pieceId = target.id;
        workspaceId = target.workspaceId;
        title = target.title;
      }
      if (share) {
        await Studio.enqueueFiles({ workspaceId, pieceId, source: 'share', files: shared });
        await Studio.discardShare({ id: share.id });
      } else if (picked && 'native' in picked) {
        await Studio.enqueueFiles({ workspaceId, pieceId, source: 'upload', files: picked.native });
      } else if (picked) {
        await uploadFiles(`/workspaces/${workspaceId}/media?pieceId=${pieceId}`, picked.web, setProgress);
      }
      leaving.current = true;
      pendingShare.set(null);
      pickedFiles.set(null);
      void queryClient.invalidateQueries({ queryKey: keys.boardAll });
      toast.success(`${count} clip${count === 1 ? '' : 's'} sent to ${title}`);
      navigate(`/c/${pieceId}`, { replace: true });
    } catch (err) {
      toast.error(errorMessage(err));
      setSending(null);
      setProgress(null);
    }
  }

  const pages = new Set((board.data?.pages ?? []).filter((p) => !p.hidden && writes(p.kind)).map((p) => p.id));
  const items = (board.data?.items ?? []).filter((i) => pages.has(i.workspaceId));
  return (
    <div className="flex h-full flex-col">
      <header className="pt-safe flex items-center gap-2 px-2">
        <div className="flex h-14 items-center gap-2">
          <Button variant="ghost" size="icon" className="size-10" aria-label="Cancel" onClick={close}>
            <ArrowLeft />
          </Button>
          <h1 className="text-xl font-semibold">{count ? `Send ${count} clip${count === 1 ? '' : 's'} to` : 'Only clips can be sent here'}</h1>
        </div>
      </header>
      {count > 0 && (
        <div className="pb-safe min-h-0 flex-1 overflow-y-auto px-4 pb-6">
          {ORDER.map((c) => {
            const list = items.filter((i) => i.column === c);
            if (!list.length) return null;
            return (
              <section key={c}>
                <h2 className="px-1 pt-5 pb-2 text-xs font-semibold tracking-widest text-muted-foreground uppercase">{COLUMN_LABELS[c]}</h2>
                <div className="flex flex-col gap-2">
                  {list.map((i) => (
                    <button key={i.id} type="button" disabled={!!sending} onClick={() => send(i)} className="flex items-center gap-3 rounded-xl border bg-card px-4 py-3.5 text-left text-base disabled:opacity-60">
                      <span className="min-w-0 flex-1 truncate">{i.title}</span>
                      {sending === i.id ? <Sending progress={progress} /> : i.series ? <span className="text-[13px] text-muted-foreground">Ep {i.series.episode}</span> : null}
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
          <button type="button" disabled={!!sending} onClick={() => send('new')} className="mt-6 flex w-full items-center gap-3 rounded-xl border border-dashed px-4 py-3.5 text-left text-base text-muted-foreground disabled:opacity-60">
            {sending === 'new' ? <Sending progress={progress} /> : '+'} New video
          </button>
        </div>
      )}
    </div>
  );
}

function Sending({ progress }: { progress: number | null }) {
  return progress === null ? <Spinner /> : <span className="text-[13px] text-muted-foreground tabular-nums">{Math.round(progress * 100)}%</span>;
}
