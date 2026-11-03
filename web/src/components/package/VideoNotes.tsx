import { Check, MessageSquarePlus, RotateCcw, Sparkles, ThumbsUp, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { clock } from '@shared/clipping';
import type { NoteStatus, VideoNote } from '@shared/notes';
import { reviewState } from '@shared/review';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Kbd } from '@/components/ui/kbd';
import { api, errorMessage } from '@/lib/api';
import { keys, queryClient, useBoard, useNotes } from '@/lib/queries';
import { REVIEW_LOOK } from '@/lib/review';
import type { PieceDetail } from '@/lib/types';
import { sendToVideoChat } from '@/lib/ui-state';
import { cn } from '@/lib/utils';

const span = (n: Pick<VideoNote, 'at' | 'end'>) => (n.end == null ? clock(n.at) : `${clock(n.at)}–${clock(n.end)}`);
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

/** The player's time and length, kept up to date. */
function usePlayhead(video: HTMLVideoElement | null) {
  const [state, setState] = useState({ time: 0, duration: 0, playing: false });
  useEffect(() => {
    if (!video) return;
    const read = () =>
      setState({
        time: video.currentTime,
        duration: Number.isFinite(video.duration) ? video.duration : 0,
        playing: !video.paused,
      });
    read();
    const events = ['timeupdate', 'loadedmetadata', 'durationchange', 'seeked', 'play', 'pause'] as const;
    events.forEach((e) => video.addEventListener(e, read));
    return () => events.forEach((e) => video.removeEventListener(e, read));
  }, [video]);
  return state;
}

/** Comments left on this render: another render's times may not line up. */
const onRender = (n: VideoNote, mediaId: string, version: number | null) => n.mediaId === mediaId || (n.version != null && n.version === version);

function seekTo(video: HTMLVideoElement | null, t: number) {
  if (!video) return;
  video.currentTime = Math.max(0, t - 0.5);
  video.pause();
}

const refresh = (pieceId: string) => queryClient.invalidateQueries({ queryKey: keys.notes(pieceId) });

/**
 * Under the player: a strip with a mark per comment (click to jump there; drag to scrub) and the box that pins a
 * comment to where the player is (C starts one; play on and "to 0:15" makes it a stretch).
 */
export function NoteComposer({ pieceId, video, mediaId, version }: { pieceId: string; video: HTMLVideoElement | null; mediaId: string; version: number | null }) {
  const notes = useNotes(pieceId);
  const { time, duration, playing } = usePlayhead(video);
  const [text, setText] = useState('');
  const [at, setAt] = useState<number | null>(null);
  const [end, setEnd] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const resume = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const list = notes.data ?? [];
  const here = (n: VideoNote) => onRender(n, mediaId, version);

  // C starts a comment at the current moment, from anywhere on the page but a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'c' || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  function pin() {
    if (!video || at !== null) return;
    resume.current = !video.paused;
    video.pause();
    setAt(Math.floor(video.currentTime * 10) / 10);
  }

  function clear() {
    setText('');
    setAt(null);
    setEnd(null);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body || at === null) return;
    setBusy(true);
    try {
      await api(`/pieces/${pieceId}/notes`, {
        method: 'POST',
        body: { mediaId, at, end, text: body },
      });
      clear();
      input.current?.blur();
      refresh(pieceId);
      // Back to watching where they were.
      if (resume.current) video?.play().catch(() => {});
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function scrub(e: React.PointerEvent<HTMLDivElement>) {
    if (!video || !duration) return;
    const box = e.currentTarget.getBoundingClientRect();
    video.currentTime = Math.min(duration, Math.max(0, ((e.clientX - box.left) / box.width) * duration));
  }

  const pct = (t: number) => `${Math.min(100, Math.max(0, (t / (duration || 1)) * 100))}%`;
  const showing = at ?? time;

  return (
    <div className="space-y-2">
      {duration > 0 && (
        <div
          className="relative h-5 cursor-pointer touch-none"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            scrub(e);
          }}
          onPointerMove={(e) => e.buttons === 1 && scrub(e)}
          role="slider"
          aria-label="Comments along the video"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration)}
          aria-valuenow={Math.round(time)}
          aria-valuetext={clock(time)}
        >
          <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-muted" />
          <div className="absolute top-1/2 left-0 h-1 -translate-y-1/2 rounded-full bg-foreground/30" style={{ width: pct(time) }} />
          {at !== null && (
            <div
              className="absolute top-1/2 h-2 -translate-y-1/2 rounded-full bg-brand/60"
              style={{
                left: pct(at),
                width: end != null ? `calc(${pct(end)} - ${pct(at)})` : '2px',
              }}
            />
          )}
          {list.filter(here).map((n) => (
            <button
              key={n.id}
              type="button"
              title={`${span(n)} ${n.text}`}
              aria-label={`Comment at ${span(n)}: ${n.text}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => seekTo(video, n.at)}
              className="absolute top-1/2 -translate-y-1/2"
              style={{
                left: pct(n.at),
                width: n.end != null ? `calc(${pct(n.end)} - ${pct(n.at)})` : undefined,
              }}
            >
              <span
                className={cn(
                  'block h-3 min-w-3 -translate-x-1.5 rounded-full border-2 border-background',
                  n.status === 'open' ? 'bg-amber-400' : n.status === 'fixed' ? 'bg-emerald-400' : 'bg-muted-foreground/50',
                )}
              />
            </button>
          ))}
          <div className="pointer-events-none absolute top-0 bottom-0 w-px bg-foreground" style={{ left: pct(time) }} />
        </div>
      )}

      <form onSubmit={save} className="space-y-1">
        <div className="flex items-center gap-1.5">
          <Input
            ref={input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={pin}
            onKeyDown={(e) => e.key === 'Escape' && (clear(), e.currentTarget.blur())}
            placeholder={`Comment at ${clock(showing)}${end != null ? `–${clock(end)}` : ''}: what to change?`}
            aria-label="Comment for Claude, pinned to the moment you are watching"
            className="h-8 text-sm"
          />
          <Button type="submit" size="icon-sm" variant="secondary" disabled={!text.trim() || at === null || busy} aria-label="Save the comment">
            <MessageSquarePlus />
          </Button>
        </div>
        <div className="flex min-h-6 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {at === null ? (
            <span className="hidden md:inline">
              Pause anywhere and type, or press <Kbd>C</Kbd>
            </span>
          ) : (
            <>
              <span className="tabular-nums text-foreground">
                At {clock(at)}
                {end != null && `–${clock(end)}`}
              </span>
              {end == null && time > at + 0.4 && (
                <Button type="button" size="sm" variant="ghost" className="h-6 px-1.5 text-xs" onClick={() => setEnd(Math.ceil(time * 10) / 10)}>
                  to {clock(time)}
                </Button>
              )}
              {end == null && time <= at + 0.4 && !playing && <span>Play on to make it a stretch</span>}
              <Button type="button" size="icon-sm" variant="ghost" className="size-6" onClick={clear} aria-label="Drop this comment">
                <X />
              </Button>
            </>
          )}
        </div>
      </form>
    </div>
  );
}

/** The comments and Claude's answers, beside the player: click a time to jump there. */
export function NoteList({
  pieceId,
  video,
  mediaId,
  version,
  className,
}: {
  pieceId: string;
  video: HTMLVideoElement | null;
  mediaId: string;
  version: number | null;
  className?: string;
}) {
  const notes = useNotes(pieceId);
  const list = notes.data ?? [];
  const open = list.filter((n) => n.status === 'open');

  async function setStatus(n: VideoNote, status: NoteStatus) {
    try {
      await api(`/notes/${n.id}`, { method: 'PATCH', body: { status } });
      refresh(pieceId);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function remove(n: VideoNote) {
    try {
      await api(`/notes/${n.id}`, { method: 'DELETE' });
      refresh(pieceId);
      toast('Comment deleted', {
        action: {
          label: 'Undo',
          onClick: () =>
            api(`/pieces/${pieceId}/notes`, {
              method: 'POST',
              body: { mediaId: n.mediaId, at: n.at, end: n.end, text: n.text },
            }).then(
              () => refresh(pieceId),
              (err) => toast.error(errorMessage(err)),
            ),
        },
      });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  if (!list.length) return null;
  return (
    <section id="comments" className={cn('scroll-mt-4 space-y-2 rounded-xl border bg-card p-4', className)} aria-label="Comments">
      <div className="flex flex-wrap items-center justify-between gap-x-2">
        <h2 className="text-sm font-medium">
          Comments
          {open.length ? <span className="font-normal text-muted-foreground"> · {open.length} open</span> : null}
        </h2>
        {open.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => sendToVideoChat(pieceId, `Fix my ${open.length === 1 ? 'open comment' : `${open.length} open comments`} on this video.`)}
          >
            <Sparkles /> Fix with Claude
          </Button>
        )}
      </div>
      <ul className="space-y-0.5">
        {list.map((n) => (
          <li key={n.id} className="group rounded-md px-1.5 py-1 hover:bg-muted/50">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => seekTo(video, n.at)}
                className={cn('text-xs tabular-nums hover:underline', n.status === 'open' ? 'text-amber-400' : 'text-muted-foreground')}
              >
                {span(n)}
              </button>
              {!onRender(n, mediaId, version) && n.version != null && <span className="text-xs text-muted-foreground">on the render of v{n.version}</span>}
              <div className="ml-auto flex shrink-0 opacity-60 group-hover:opacity-100">
                {n.status === 'open' ? (
                  <Button size="icon-sm" variant="ghost" className="size-6" onClick={() => setStatus(n, 'done')} aria-label="Close it: done">
                    <Check />
                  </Button>
                ) : (
                  <>
                    {n.status === 'fixed' && (
                      <Button size="icon-sm" variant="ghost" className="size-6" onClick={() => setStatus(n, 'done')} aria-label="Looks right: close it">
                        <Check />
                      </Button>
                    )}
                    <Button size="icon-sm" variant="ghost" className="size-6" onClick={() => setStatus(n, 'open')} aria-label="Not fixed: open it again">
                      <RotateCcw />
                    </Button>
                  </>
                )}
                <Button size="icon-sm" variant="ghost" className="size-6" onClick={() => remove(n)} aria-label="Delete the comment">
                  <Trash2 />
                </Button>
              </div>
            </div>
            <p className={cn('text-sm break-words', n.status === 'done' && 'text-muted-foreground line-through decoration-muted-foreground/40')}>{n.text}</p>
            {n.reply && <p className={cn('text-xs', n.status === 'fixed' ? 'text-emerald-400/90' : 'text-muted-foreground')}>Claude: {n.reply}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Under the player: whether I've watched the newest render (shared/review.ts), and the click that says it looks
 * good, which closes Claude's fixes with it and offers the next video still to watch.
 */
export function ReviewBar({ piece, renderId }: { piece: Pick<PieceDetail, 'id' | 'workspaceId' | 'reviewedMediaId'>; renderId: string }) {
  const notes = useNotes(piece.id);
  const board = useBoard(piece.workspaceId);
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const list = notes.data;
  if (!list) return null;
  const open = list.filter((n) => n.status === 'open').length;
  const state = reviewState({ renderId, reviewedMediaId: piece.reviewedMediaId, open, comments: list.length });
  if (!state) return null;
  const { icon: Icon, tone } = REVIEW_LOOK[state];
  const text = {
    watch: 'Not watched yet: comment on what to change, or',
    improve: `To improve: ${open} open comment${open === 1 ? '' : 's'}`,
    recheck: 'Changed since your comments: watch it again, then',
    good: 'Watched: it looks good',
  }[state];

  async function mark(good: boolean) {
    setBusy(true);
    try {
      await api(`/pieces/${piece.id}/reviewed`, { method: 'POST', body: { good } });
      queryClient.invalidateQueries({ queryKey: keys.piece(piece.id) });
      if (!good) return;
      const next = board.data?.find((c) => c.id !== piece.id && (c.review === 'watch' || c.review === 'recheck'));
      toast.success('Looks good', next ? { action: { label: 'Next to watch', onClick: () => navigate(`/w/${piece.workspaceId}/p/${next.id}`) } } : undefined);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-lg bg-muted/40 px-2.5 py-1 text-xs">
      <span className={cn('flex items-center gap-1.5', tone)}>
        <Icon className="size-3.5 shrink-0" />
        {text}
      </span>
      {state === 'good' ? (
        <Button size="sm" variant="ghost" className="h-6 px-1.5 text-xs text-muted-foreground" disabled={busy} onClick={() => mark(false)}>
          Not yet
        </Button>
      ) : (
        state !== 'improve' && (
          <Button size="sm" variant="secondary" className="h-6 px-2 text-xs" disabled={busy} onClick={() => mark(true)}>
            <ThumbsUp /> Looks good
          </Button>
        )
      )}
    </div>
  );
}
