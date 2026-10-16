import { Clapperboard, Film, MessageSquarePlus, RefreshCw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { clock, type ReviewClip } from '@shared/clipping';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { api, errorMessage } from '@/lib/api';
import { duration } from '@/lib/format';
import { keys, queryClient, useEdit } from '@/lib/queries';
import type { PieceDetail } from '@/lib/types';
import { sendToVideoChat } from '@/lib/ui-state';
import { cn } from '@/lib/utils';
import { ClipPlayer } from './ClipReview';

/** The video itself: its latest render (or how the render is going), and the way into the editor. */
export function VideoPanel({ piece, summary }: { piece: PieceDetail; summary: ReviewClip | undefined }) {
  const edit = useEdit(piece.id);
  const [busy, setBusy] = useState(false);
  const footage = piece.media.filter((m) => m.source !== 'render' && (m.kind === 'video' || m.kind === 'image'));
  const editor = `/w/${piece.workspaceId}/p/${piece.id}/edit`;
  const video = useRef<HTMLVideoElement>(null);
  const [before, setBefore] = useState(false);
  const [note, setNote] = useState('');
  // The moment a note is pinned to: where the player was when the note box got focus.
  const [pinned, setPinned] = useState<number | null>(null);
  const latestId = summary?.render?.mediaId;
  useEffect(() => setBefore(false), [latestId]);
  const previous = summary?.previousRender;
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

  function pin() {
    const v = video.current;
    if (!v) return;
    v.pause();
    setPinned(Math.floor(v.currentTime * 10) / 10);
  }

  function sendNote(e: React.FormEvent) {
    e.preventDefault();
    const text = note.trim();
    if (!text || pinned === null || !summary?.render) return;
    const shownVersion = before ? previous?.version : summary.renderVersion;
    sendToVideoChat(piece.id, `Note at ${clock(pinned)} (${pinned.toFixed(1)} s) on the render${shownVersion ? ` of edit v${shownVersion}` : ''}: ${text}`);
    setNote('');
    setPinned(null);
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
        {summary ? <ClipPlayer clip={summary} empty={empty} videoRef={video} show={before && previous ? previous : undefined} /> : <Skeleton className="size-full" />}
      </div>
      {summary?.render && previous && (
        <div className="flex justify-center gap-1" role="group" aria-label="Which version to watch">
          {[
            { label: previous.version ? `Before (v${previous.version})` : 'Before', value: true },
            { label: summary.renderVersion ? `Now (v${summary.renderVersion})` : 'Now', value: false },
          ].map((o) => (
            <Button key={o.label} size="sm" variant={before === o.value ? 'secondary' : 'ghost'} className={cn('h-7 text-xs')} onClick={() => setBefore(o.value)}>
              {o.label}
            </Button>
          ))}
        </div>
      )}
      {summary?.render && (
        <form onSubmit={sendNote} className="flex items-center gap-1.5">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onFocus={pin}
            placeholder={pinned === null ? 'Note for Claude at this moment' : `At ${clock(pinned)}: what to change?`}
            aria-label="Note for Claude, pinned to the moment you are watching"
            className="h-8 text-sm"
          />
          <Button type="submit" size="icon-sm" variant="secondary" disabled={!note.trim() || pinned === null} aria-label="Send the note to Claude">
            <MessageSquarePlus />
          </Button>
        </form>
      )}
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
