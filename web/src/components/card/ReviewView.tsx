import { Copy } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { BoardItem } from '@shared/board';
import { NoteComposer, NoteList } from '@/components/package/VideoNotes';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { api, errorMessage, mediaFileUrl } from '@/lib/api';
import { postWhen } from '@/lib/format';
import { keys, queryClient, useApprovePlan, useNotes, usePackage, usePiecePosts, useRenders, useVersions } from '@/lib/queries';
import type { PieceDetail, RenderRow, VersionRow } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useDraft } from './useDraft';

const FIX = 'fix my comments';

export function copyFix() {
  void navigator.clipboard?.writeText(FIX).catch(() => {});
  toast(`Copied “${FIX}”: paste it in Claude Code`);
}

export function Player({ mediaId, label, onVideo, className }: { mediaId: string; label: string; onVideo?: (v: HTMLVideoElement | null) => void; className?: string }) {
  return (
    <figure className={cn('space-y-2', className)}>
      <video ref={onVideo} src={mediaFileUrl(mediaId)} controls playsInline preload="metadata" className="aspect-[9/16] h-[min(66vh,760px)] rounded-xl bg-black" />
      <figcaption className="text-[13px] text-muted-foreground">{label}</figcaption>
    </figure>
  );
}

/** What a video waits for, and its one button: Approve in Review, else where it is. */
function Status({ piece, item }: { piece: PieceDetail; item: BoardItem | undefined }) {
  const pack = usePackage(piece.id);
  const notes = useNotes(piece.id);
  const posts = usePiecePosts(piece.id);
  const column = item?.column;
  const plan = useApprovePlan(piece.id, column === 'review');
  const [busy, setBusy] = useState(false);
  const open = (notes.data ?? []).filter((n) => n.status === 'open').length;
  const failing = pack.data?.rules.find((r) => r.status === 'fail');

  async function approve() {
    setBusy(true);
    try {
      const res = await api<{ from: string; scheduled: { at: number }[]; note: string | null }>(`/review/${piece.id}/approve`, { method: 'POST' });
      const first = res.scheduled.map((s) => s.at).sort((a, b) => a - b)[0];
      toast(first ? `Scheduled ${postWhen(first)}` : (res.note ?? 'Approved'), {
        duration: 10_000,
        action: {
          label: 'Undo',
          onClick: () =>
            api(`/review/${piece.id}/undo`, { method: 'POST', body: { stage: res.from } }).then(
              () => queryClient.invalidateQueries({ queryKey: keys.boardAll }),
              (err) => toast.error(errorMessage(err)),
            ),
        },
      });
      void queryClient.invalidateQueries({ queryKey: keys.boardAll });
      void queryClient.invalidateQueries({ queryKey: keys.piecePosts(piece.id) });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    const failed = (posts.data ?? []).filter((p) => p.status === 'failed' || p.status === 'missed');
    try {
      await Promise.all(failed.map((p) => api(`/posts/${p.id}/publish-now`, { method: 'POST' })));
      toast('Trying again');
      void queryClient.invalidateQueries({ queryKey: keys.boardAll });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const fixButton = (
    <Button variant="outline" onClick={copyFix}>
      <Copy /> Copy “{FIX}”
    </Button>
  );

  if (column === 'review') {
    const at = plan.data?.targets.map((t) => t.at).filter((t): t is number => !!t).sort((a, b) => a - b)[0];
    return (
      <div className="space-y-3">
        {failing && (
          <p className="text-[15px] text-destructive">
            {failing.rule.text}: {failing.detail}
          </p>
        )}
        <Button size="lg" className="h-13 w-full text-base" disabled={busy || !!open || !!failing || !pack.data?.render} onClick={approve}>
          {busy && <Spinner />} Approve
        </Button>
        <p className="text-sm text-muted-foreground">{open ? `${open} open comment${open === 1 ? '' : 's'}` : at ? `Goes out ${postWhen(at)}` : plan.data?.error ?? ''}</p>
        {open > 0 && fixButton}
      </div>
    );
  }
  if (column === 'editing') {
    const r = pack.data?.rendering;
    return (
      <div className="space-y-3">
        <p className="text-[17px]">{open ? `${open} open comment${open === 1 ? '' : 's'}` : r ? `Rendering${r.status === 'running' ? ` ${Math.round(r.progress * 100)}%` : ''}` : 'Claude is editing it'}</p>
        {open > 0 && fixButton}
      </div>
    );
  }
  if (column === 'scheduled') {
    if (item?.failed)
      return (
        <div className="space-y-3">
          <p className="text-[15px] text-destructive">{item.failed}</p>
          {item.failed !== 'Not queued' && <Button onClick={retry}>Retry</Button>}
        </div>
      );
    return <p className="text-[17px]">{item?.nextPostAt ? `Goes out ${postWhen(item.nextPostAt)}` : 'Scheduled'}</p>;
  }
  if (column === 'posted') {
    const done = (posts.data ?? []).find((p) => p.status === 'published');
    return (
      <div className="space-y-2">
        <p className="text-[17px]">Posted {item?.postedAt ? postWhen(item.postedAt) : ''}</p>
        {done?.url && (
          <a href={done.url} target="_blank" rel="noreferrer" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
            Open on Instagram
          </a>
        )}
      </div>
    );
  }
  return null;
}

/** Claude's 2–3 looks for a video, the one it edited in first; another one goes to Claude as a comment. */
function Looks({ piece }: { piece: PieceDetail }) {
  const d = piece.directions;
  if (!d?.options.length) return null;
  async function pick(id: string, name: string) {
    try {
      await api(`/pieces/${piece.id}/directions/choose`, { method: 'POST', body: { optionId: id } });
      await api(`/pieces/${piece.id}/notes`, { method: 'POST', body: { at: 0, text: `Switch to the “${name}” look.` } });
      void queryClient.invalidateQueries({ queryKey: keys.piece(piece.id) });
      void queryClient.invalidateQueries({ queryKey: keys.notes(piece.id) });
      toast(`“${name}” is a comment now: say “${FIX}” in Claude Code`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }
  return (
    <section className="space-y-2.5">
      <h2 className="text-[13px] font-semibold tracking-widest text-muted-foreground uppercase">Look</h2>
      <div className="flex flex-wrap gap-2">
        {d.options.map((o) => (
          <Button key={o.id} variant={d.chosen?.id === o.id ? 'default' : 'outline'} onClick={() => d.chosen?.id !== o.id && void pick(o.id, o.name)}>
            {o.name}
          </Button>
        ))}
      </div>
    </section>
  );
}

/** The post's caption and hashtags (Instagram), saved as I type. */
function PostText({ piece }: { piece: PieceDetail }) {
  const { draft, change } = useDraft(piece);
  const ig = draft.platforms.instagram;
  const set = (patch: Partial<typeof ig>) => change((d) => ({ ...d, platforms: { ...d.platforms, instagram: { ...d.platforms.instagram, ...patch } } }));
  return (
    <section className="space-y-2.5">
      <h2 className="text-[13px] font-semibold tracking-widest text-muted-foreground uppercase">Post text</h2>
      <textarea value={ig.caption} onChange={(e) => set({ caption: e.target.value })} rows={4} className="w-full resize-y rounded-lg border bg-card px-3.5 py-3 text-[15px] leading-relaxed outline-none focus:border-foreground/30" />
      <input value={ig.hashtags} onChange={(e) => set({ hashtags: e.target.value })} placeholder="#hashtags" className="w-full rounded-lg border bg-card px-3.5 py-2.5 text-[15px] outline-none focus:border-foreground/30" />
    </section>
  );
}

export type Version = VersionRow & { render: RenderRow | undefined };

/**
 * Every version of a card's edit Claude saved, newest first, with its render (one per version, the newest), and the
 * newest finished render: the video now. Older renders are dated with their version, so they never count as now.
 */
export function useVideoVersions(pieceId: string) {
  const renders = useRenders(pieceId);
  const versions = useVersions(pieceId);
  return useMemo(() => {
    const all = [...(renders.data ?? [])].sort((a, b) => b.createdAt - a.createdAt);
    const done = all.filter((r) => r.status === 'done' && r.mediaId);
    const pick = (v: VersionRow) =>
      done.find((r) => r.versionId === v.id) ?? all.find((r) => r.versionId === v.id && (r.status === 'queued' || r.status === 'running')) ?? done.find((r) => !r.versionId && r.versionNumber === v.number);
    const list: Version[] = (versions.data ?? []).filter((v) => v.footage).map((v) => ({ ...v, render: pick(v) }));
    // Renders of versions no longer listed (an edit started over) still show.
    for (const r of done) if (!list.some((v) => v.render?.id === r.id) && !list.some((v) => v.number === r.versionNumber))
      list.push({ id: r.versionId ?? r.id, number: r.versionNumber ?? 0, author: 'claude', message: '', createdAt: r.createdAt, footage: true, render: r });
    list.sort((a, b) => b.number - a.number);
    return { versions: list, current: done[0], loading: renders.isLoading };
  }, [renders.data, renders.isLoading, versions.data]);
}

/**
 * The version strip: one button per version. A rendered one plays (`onPick`), one being rendered shows how far it
 * is, and one never rendered renders on a click (`render`; on the laptop only).
 */
export function VersionStrip({ versions, current, selected, onPick, render }: { versions: Version[]; current: RenderRow | undefined; selected: string | null; onPick: (mediaId: string | null) => void; render?: boolean }) {
  const shown = render ? versions : versions.filter((v) => v.render?.status === 'done');
  if (shown.length < 2) return null;
  async function start(v: Version) {
    try {
      await api(`/edit-versions/${v.id}/render`, { method: 'POST' });
      void queryClient.invalidateQueries({ queryKey: keys.renders(current?.pieceId ?? '') });
      toast(`Rendering v${v.number}`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }
  return (
    <div className="space-y-2">
      <h2 className="text-[13px] font-semibold tracking-widest text-muted-foreground uppercase">Versions</h2>
      <div className="flex flex-wrap gap-1.5">
        {shown.map((v) => {
          const r = v.render;
          const now = !!r && r.id === current?.id;
          const label = `v${v.number}`;
          if (r?.status === 'done' && r.mediaId)
            return (
              <Button key={v.id} size="sm" title={v.message} variant={now || r.mediaId === selected ? 'default' : 'outline'} onClick={() => !now && onPick(r.mediaId === selected ? null : r.mediaId)}>
                {label}
              </Button>
            );
          if (r)
            return (
              <Button key={v.id} size="sm" variant="ghost" disabled title={v.message}>
                <Spinner /> {label}
                {r.status === 'running' && <span className="tabular-nums">{Math.round(r.progress * 100)}%</span>}
              </Button>
            );
          return (
            <Button key={v.id} size="sm" variant="ghost" title={`${v.message ? `${v.message}. ` : ''}Not rendered: click to render`} className="text-muted-foreground" onClick={() => void start(v)}>
              {label}
            </Button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * A video Claude made: the newest render (an older one beside it to compare), comments pinned to moments under it,
 * and on the right what it waits for, its look, the comments and the post's text.
 */
export function ReviewView({ piece, item }: { piece: PieceDetail; item: BoardItem | undefined }) {
  const { versions, current, loading } = useVideoVersions(piece.id);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [older, setOlder] = useState<string | null>(null);
  useEffect(() => setOlder(null), [current?.mediaId]);
  const olderRender = versions.find((v) => v.render?.mediaId === older)?.render;

  return (
    <div className="space-y-6 px-12 pt-5 pb-16">
      <h1 className="text-3xl font-semibold tracking-tight">{piece.title}</h1>
      <div className="grid grid-cols-[auto_minmax(0,34rem)] items-start justify-start gap-14">
        <div className="space-y-4">
          {current?.mediaId ? (
            <>
              <div className="flex gap-4">
                {olderRender?.mediaId && <Player mediaId={olderRender.mediaId} label={`v${olderRender.versionNumber ?? '?'}`} />}
                <Player mediaId={current.mediaId} label={`v${current.versionNumber ?? '?'} · now`} onVideo={setVideo} />
              </div>
              <div className="max-w-[min(66vh,760px)]" style={{ width: 'calc(min(66vh, 760px) * 9 / 16)' }}>
                <NoteComposer pieceId={piece.id} video={video} mediaId={current.mediaId} version={current.versionNumber} />
              </div>
              <VersionStrip versions={versions} current={current} selected={older} onPick={setOlder} render />
            </>
          ) : (
            <div className="grid aspect-[9/16] h-[min(66vh,760px)] place-items-center rounded-xl bg-muted text-muted-foreground">{loading ? <Spinner /> : 'No render yet'}</div>
          )}
        </div>
        <div className="space-y-9">
          <Status piece={piece} item={item} />
          {piece.workspaceId && <Looks piece={piece} />}
          {current?.mediaId && <NoteList pieceId={piece.id} video={video} mediaId={current.mediaId} version={current.versionNumber} />}
          <PostText piece={piece} />
        </div>
      </div>
    </div>
  );
}
