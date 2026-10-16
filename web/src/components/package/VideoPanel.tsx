import { Clapperboard, Film, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import type { ReviewClip } from '@shared/clipping';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { api, errorMessage } from '@/lib/api';
import { duration } from '@/lib/format';
import { keys, queryClient, useEdit } from '@/lib/queries';
import type { PieceDetail } from '@/lib/types';
import { ClipPlayer } from './ClipReview';

/** The video itself: its latest render (or how the render is going), and the way into the editor. */
export function VideoPanel({ piece, summary }: { piece: PieceDetail; summary: ReviewClip | undefined }) {
  const edit = useEdit(piece.id);
  const [busy, setBusy] = useState(false);
  const footage = piece.media.filter((m) => m.source !== 'render' && (m.kind === 'video' || m.kind === 'image'));
  const editor = `/w/${piece.workspaceId}/p/${piece.id}/edit`;
  const rendering = summary?.rendering && (summary.rendering.status === 'queued' || summary.rendering.status === 'running');

  async function render() {
    if (!edit.data) return;
    setBusy(true);
    try {
      await api(`/edits/${edit.data.id}/render`, { method: 'POST' });
      queryClient.invalidateQueries({ queryKey: keys.review });
      toast('Rendering', { description: 'It takes a few minutes on this computer.' });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const empty = (
    <div className="grid size-full place-items-center bg-muted p-6 text-center text-sm text-muted-foreground">
      <div className="flex flex-col items-center gap-3">
        <Film className="size-6" />
        {edit.data ? (
          <p>Edited but not rendered yet.</p>
        ) : footage.length ? (
          <p>
            {footage.length} file{footage.length === 1 ? '' : 's'} ready to edit.
          </p>
        ) : (
          <p>No footage yet. Film it and drop the files under Footage, or ask Claude to make it from words.</p>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-2">
      <div className="mx-auto aspect-[9/16] max-h-[68vh] w-full max-w-[22rem] overflow-hidden rounded-xl border bg-black">
        {summary ? <ClipPlayer clip={summary} empty={empty} /> : <Skeleton className="size-full" />}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button size="sm" variant={summary?.render ? 'outline' : 'default'} asChild>
          <Link to={editor}>
            <Clapperboard /> {edit.data ? 'Open editor' : footage.length ? 'Edit the video' : 'Video editor'}
          </Link>
        </Button>
        {edit.data && !rendering && (
          <Button size="sm" variant="ghost" onClick={render} disabled={busy}>
            {busy ? <Spinner /> : <RefreshCw />} {summary?.render ? 'Render again' : 'Render'}
          </Button>
        )}
      </div>
      {summary?.render?.durationMs != null && <p className="text-center text-xs text-muted-foreground tabular-nums">{duration(summary.render.durationMs)}</p>}
    </div>
  );
}
