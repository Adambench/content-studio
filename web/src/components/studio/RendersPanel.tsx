import { AlertCircle, CheckCircle2, ChevronDown, Clapperboard, Download, Play, RotateCcw, X } from 'lucide-react';
import { QUALITY_BAR } from '@shared/quality';
import { useState } from 'react';
import { toast } from 'sonner';
import { MediaDialog } from '@/components/MediaDialog';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import { api, errorMessage, fileUrl } from '@/lib/api';
import { duration, timeAgo } from '@/lib/format';
import { keys, queryClient, useRenders, useSystemStatus } from '@/lib/queries';
import type { RenderRow } from '@/lib/types';
import { useStudio } from './context';
import { PanelEmpty } from './controls';

export const isActive = (r: RenderRow) => r.status === 'queued' || r.status === 'running';

/** Header button: render the edit, or show how far the current render has got. */
export function RenderButton({ onShow }: { onShow: () => void }) {
  const { edit, spec, serverAction } = useStudio();
  const renders = useRenders(edit.pieceId);
  const active = renders.data?.find(isActive);
  const [busy, setBusy] = useState(false);

  if (active) {
    return (
      <Button size="sm" variant="secondary" onClick={onShow} className="tabular-nums">
        <Spinner /> {active.status === 'queued' ? (checkingStage(active) ? 'Checking…' : 'Waiting…') : `${Math.round(active.progress * 100)}%`}
      </Button>
    );
  }
  async function render(check: boolean) {
    setBusy(true);
    try {
      const r = await serverAction(() => api<RenderRow>(`/edits/${edit.id}/render`, { body: { check } }));
      queryClient.invalidateQueries({ queryKey: keys.renders(edit.pieceId) });
      if (r) toast.success(check ? `Checking v${r.versionNumber}, then rendering` : `Rendering v${r.versionNumber}`, { description: check ? `Below ${QUALITY_BAR}/100 Claude fixes it first. Keep editing — you’ll be told when it’s ready.` : 'Keep editing — you’ll be told when it’s ready.' });
      onShow();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex">
      <Button size="sm" className="rounded-r-none" disabled={busy || !spec.clips.length} onClick={() => render(true)}>
        {busy ? <Spinner /> : <Clapperboard />} Render
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" className="rounded-l-none border-l border-primary-foreground/20 px-1.5" disabled={busy || !spec.clips.length} aria-label="More ways to render">
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => render(false)}>
            <Clapperboard /> Render without the check
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** A waiting render that's still in its quality check (or Claude's fix). */
const checkingStage = (r: RenderRow) => r.status === 'queued' && r.stage !== 'Waiting' && !r.stage.includes('waiting for the renderer');

export function RendersPanel() {
  const { edit } = useStudio();
  const renders = useRenders(edit.pieceId);
  const status = useSystemStatus();
  const [playing, setPlaying] = useState<string | null>(null);
  const list = renders.data ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.renders(edit.pieceId) });

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn();
      refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="space-y-3">
      {status.data && !status.data.renderer && (
        <p className="text-xs text-muted-foreground">
          {status.data.rendererInstall.state === 'installing' ? status.data.rendererInstall.message : 'The first render downloads the video renderer (about 100 MB, once).'}
        </p>
      )}
      {list.length ? (
        <ol className="space-y-2">
          {list.map((r) => (
            <li key={r.id} className="space-y-2 rounded-lg border p-3">
              <div className="flex items-center gap-2">
                {isActive(r) ? <Spinner className="size-4" /> : r.status === 'done' ? <CheckCircle2 className="size-4 text-emerald-400" /> : r.status === 'error' ? <AlertCircle className="size-4 text-destructive" /> : <X className="size-4 text-muted-foreground" />}
                <span className="text-sm font-medium">v{r.versionNumber}</span>
                <span className="text-xs text-muted-foreground">
                  {timeAgo(r.createdAt)}
                  {r.durationMs ? ` · ${duration(r.durationMs)} video` : ''}
                  {r.status === 'done' && r.elapsedMs ? ` · took ${duration(r.elapsedMs)}` : ''}
                </span>
                <span className="ml-auto flex items-center gap-1">
                  {r.status === 'done' && r.mediaId && (
                    <>
                      <Button size="icon-sm" variant="ghost" aria-label="Play" onClick={() => setPlaying(r.mediaId)}>
                        <Play />
                      </Button>
                      <Button size="icon-sm" variant="ghost" aria-label="Download" asChild>
                        <a href={fileUrl(`/media/${r.mediaId}/file?download=1`)}>
                          <Download />
                        </a>
                      </Button>
                    </>
                  )}
                  {isActive(r) ? (
                    <Button size="sm" variant="ghost" onClick={() => act(() => api(`/renders/${r.id}/cancel`, { body: {} }))}>
                      Cancel
                    </Button>
                  ) : (
                    <Button size="icon-sm" variant="ghost" aria-label="Remove from the list" onClick={() => act(() => api(`/renders/${r.id}`, { method: 'DELETE' }))}>
                      <X />
                    </Button>
                  )}
                </span>
              </div>
              {isActive(r) && (
                <div className="space-y-1">
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${Math.max(2, r.progress * 100)}%` }} />
                  </div>
                  <p className="text-xs text-muted-foreground">{r.status === 'queued' && r.stage === 'Waiting' ? 'Waiting for the renderer…' : r.stage}</p>
                </div>
              )}
              {r.status === 'error' && (
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 text-xs break-words text-destructive">{r.error}</p>
                  <Button size="sm" variant="outline" onClick={() => act(() => api(`/edits/${edit.id}/render`, { body: {} }))}>
                    <RotateCcw /> Try again
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <PanelEmpty>Rendered videos show up here and in the piece’s footage, ready to post.</PanelEmpty>
      )}
      <MediaDialog wid={edit.workspaceId} mediaId={playing} onClose={() => setPlaying(null)} />
    </div>
  );
}
