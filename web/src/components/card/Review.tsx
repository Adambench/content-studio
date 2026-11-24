import { CheckIcon, DownloadIcon, RotateCcwIcon, XIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { mediaUrl } from '@/lib/api';
import { ago, secs } from '@/lib/format';
import { useComment } from '@/lib/queries';
import type { CardDetail, Comment, Render } from '@shared/types';

/** The render to show: the one picked, else the newest finished one, else the newest. */
export function pickRender(detail: CardDetail, picked: string | null): Render | null {
  return detail.renders.find((r) => r.id === picked) ?? detail.renders.find((r) => r.status === 'done') ?? detail.renders[0] ?? null;
}

function CommentRow({ c, cardId, seek }: { c: Comment; cardId: string; seek: (t: number) => void }) {
  const { update, remove } = useComment(cardId);
  const done = c.status !== 'open';
  return (
    <div className={`group flex gap-2 rounded-lg p-2 text-sm ${done ? 'text-muted-foreground' : ''}`}>
      {c.at != null ? (
        <button onClick={() => seek(c.at!)} className="h-5 shrink-0 rounded bg-secondary px-1.5 text-xs tabular-nums hover:bg-accent">
          {secs(c.at)}
          {c.end != null ? `–${secs(c.end)}` : ''}
        </button>
      ) : c.slide != null ? (
        <span className="h-5 shrink-0 rounded bg-secondary px-1.5 text-xs">{c.slide + 1}</span>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className={done ? 'line-through decoration-foreground/30' : ''}>{c.text}</div>
        {c.reply && <div className="mt-1 text-xs text-muted-foreground">Claude: {c.reply}</div>}
      </div>
      <div className="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100 max-md:opacity-100">
        {done ? (
          <Button size="icon-xs" variant="ghost" aria-label="Reopen" onClick={() => update.mutate({ id: c.id, status: 'open' })}>
            <RotateCcwIcon />
          </Button>
        ) : (
          <Button size="icon-xs" variant="ghost" aria-label="Done" onClick={() => update.mutate({ id: c.id, status: 'closed' })}>
            <CheckIcon />
          </Button>
        )}
        <Button size="icon-xs" variant="ghost" aria-label="Delete" onClick={() => remove.mutate(c.id)}>
          <XIcon />
        </Button>
      </div>
    </div>
  );
}

export function Review({ detail, render }: { detail: CardDetail; render: Render | null }) {
  const video = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLInputElement>(null);
  const [time, setTime] = useState(0);
  const [text, setText] = useState('');
  const [from, setFrom] = useState<number | null>(null);
  const { add } = useComment(detail.card.id);
  const job = detail.jobs.find((j) => ['queued', 'waiting', 'running'].includes(j.status));

  // C: comment here, from anywhere on the page but a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key.toLowerCase() !== 'c' || e.metaKey || e.ctrlKey || t.closest('input, textarea, select, [contenteditable]')) return;
      e.preventDefault();
      box.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const seek = (t: number) => {
    if (!video.current) return;
    video.current.currentTime = t;
    void video.current.play();
  };

  const comments = detail.comments.filter((c) => !render || c.renderId === render.id || c.renderId === null).sort((a, b) => (a.at ?? 1e9) - (b.at ?? 1e9) || a.createdAt - b.createdAt);
  const duration = render?.duration ?? 0;

  const submit = () => {
    if (!text.trim() || !render) return;
    const end = video.current?.currentTime ?? time;
    const at = from ?? end;
    add.mutate({ renderId: render.id, versionId: render.versionId, at, end: from != null && end > from + 0.3 ? end : null, text: text.trim() }, { onSuccess: () => setText('') });
    setFrom(null);
  };

  if (!render)
    return (
      <div className="flex aspect-[9/16] max-h-[70vh] w-full items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">
        {job ? `${job.step ?? 'Working'}…` : 'No video yet'}
      </div>
    );

  return (
    <div className="flex flex-col gap-3">
      <div className="relative mx-auto w-full max-w-[min(100%,calc(70vh*9/16))]">
        {render.status === 'done' ? (
          <video
            ref={video}
            key={render.id}
            src={mediaUrl(`/media/render/${render.id}`)}
            poster={mediaUrl(`/media/poster/${render.id}`)}
            controls
            playsInline
            preload="metadata"
            onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
            className="aspect-[9/16] w-full rounded-xl bg-black"
          />
        ) : (
          <div className="flex aspect-[9/16] w-full flex-col items-center justify-center gap-2 rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">
            {render.status === 'failed' ? (
              <>
                <span className="text-destructive">Render failed</span>
                <span className="line-clamp-6 text-xs">{render.error}</span>
              </>
            ) : render.status === 'cancelled' ? (
              'Cancelled'
            ) : (
              `${job?.step ?? 'Rendering'}… ${job ? Math.round(job.progress * 100) + ' %' : ''}`
            )}
          </div>
        )}
        {render.status === 'done' && duration > 0 && (
          <div className="relative mt-2 h-3">
            <div className="absolute inset-x-0 top-1.5 h-px bg-border" />
            {comments
              .filter((c) => c.at != null)
              .map((c) => (
                <button
                  key={c.id}
                  title={c.text}
                  onClick={() => seek(c.at!)}
                  className={`absolute top-0 h-3 rounded-full ${c.status === 'open' ? 'bg-foreground' : 'bg-muted-foreground/40'}`}
                  style={{ left: `${(c.at! / duration) * 100}%`, width: c.end != null ? `max(0.75rem, ${((c.end - c.at!) / duration) * 100}%)` : '0.75rem', marginLeft: '-0.375rem' }}
                />
              ))}
          </div>
        )}
      </div>

      {render.status === 'done' && (
        <div className="flex items-center gap-2">
          <input
            ref={box}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onFocus={() => video.current?.pause()}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder={from != null ? `Comment ${secs(from)}–${secs(time)}` : `Comment at ${secs(time)}  (C)`}
            className="h-9 min-w-0 flex-1 rounded-lg border bg-transparent px-3 text-sm outline-none focus:border-ring"
          />
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setFrom(from == null ? (video.current?.currentTime ?? time) : null)} title="Comment on a stretch: mark where it starts, play on, then write">
            {from == null ? 'From here' : 'Moment'}
          </Button>
          <Button asChild variant="ghost" size="icon-sm" aria-label="Download">
            <a href={mediaUrl(`/media/render/${render.id}?download=1`)}>
              <DownloadIcon />
            </a>
          </Button>
        </div>
      )}

      {comments.length > 0 && (
        <div className="flex flex-col">
          {comments.map((c) => (
            <CommentRow key={c.id} c={c} cardId={detail.card.id} seek={seek} />
          ))}
        </div>
      )}
      <div className="text-center text-xs text-muted-foreground">
        v{render.n} · {ago(render.createdAt)}
      </div>
    </div>
  );
}
