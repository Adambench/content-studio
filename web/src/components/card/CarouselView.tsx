import { ChevronLeft, ChevronRight, Copy, Download, ImageDown, Share2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { BoardItem } from '@shared/board';
import type { CarouselVersion } from '@shared/types';
import { NoteList } from '@/components/package/VideoNotes';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { api, errorMessage, fileUrl, mediaFileUrl } from '@/lib/api';
import { isNative, Studio } from '@/lib/native';
import { keys, queryClient } from '@/lib/queries';
import type { PieceDetail } from '@/lib/types';
import { cn } from '@/lib/utils';
import { PostText, Status } from './ReviewView';
import type { CardDraft } from './useDraft';

const heading = 'text-[13px] font-semibold tracking-widest text-muted-foreground uppercase';
/** The slide's box: 4:5 like Instagram shows it; its height on the laptop, the width on the phone. */
const box = 'aspect-[4/5] w-full md:h-[min(66vh,760px)] md:w-auto';

/** "Day 6 carousel · v3": the folder the slides are saved in, and the start of each file's name. */
const folderName = (title: string, v: CarouselVersion) => `${title.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Carousel'} · v${v.number}`;
const slideName = (folder: string, i: number) => `${folder} · ${String(i + 1).padStart(2, '0')}`;

/** The slides one at a time: swipe (or the arrows, or ← →) to the next, like on Instagram. */
function Slides({ version, index, onIndex }: { version: CarouselVersion; index: number; onIndex: (i: number) => void }) {
  const row = useRef<HTMLDivElement>(null);
  // Where a smooth scroll is headed, so pressing → twice quickly moves two slides.
  const target = useRef(index);
  const count = version.slides.length;
  const go = (i: number) => {
    const el = row.current;
    target.current = Math.max(0, Math.min(count - 1, i));
    if (el) el.scrollTo({ left: target.current * el.clientWidth, behavior: 'smooth' });
  };
  // Another version starts at its first slide.
  useEffect(() => {
    target.current = 0;
    row.current?.scrollTo({ left: 0 });
  }, [version.id]);
  // A comment's slide, or a thumbnail: the parent asks for it through `index`.
  useEffect(() => {
    const el = row.current;
    if (el && Math.round(el.scrollLeft / el.clientWidth) !== index) go(index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);
  // Where a scroll ends (a swipe too) is where the next arrow starts from.
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const end = () => (target.current = Math.round(el.scrollLeft / el.clientWidth));
    el.addEventListener('scrollend', end);
    return () => el.removeEventListener('scrollend', end);
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea, [contenteditable="true"]')) return;
      if (e.key === 'ArrowRight') go(target.current + 1);
      if (e.key === 'ArrowLeft') go(target.current - 1);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  return (
    <div className={cn('relative overflow-hidden rounded-xl bg-muted', box)}>
      <div
        ref={row}
        className="flex h-full snap-x snap-mandatory overflow-x-auto [scrollbar-width:none]"
        onScroll={(e) => {
          const el = e.currentTarget;
          const i = Math.round(el.scrollLeft / el.clientWidth);
          if (i !== index) onIndex(i);
        }}
      >
        {version.slides.map((s, i) => (
          <img key={s.mediaId} src={mediaFileUrl(s.mediaId)} alt={`Slide ${i + 1}`} loading={i < 2 ? 'eager' : 'lazy'} className="h-full w-full shrink-0 snap-center object-contain" draggable={false} />
        ))}
      </div>
      {index > 0 && (
        <Button size="icon" variant="secondary" className="absolute top-1/2 left-3 hidden -translate-y-1/2 rounded-full opacity-80 md:inline-flex" aria-label="Previous slide" onClick={() => go(index - 1)}>
          <ChevronLeft />
        </Button>
      )}
      {index < count - 1 && (
        <Button size="icon" variant="secondary" className="absolute top-1/2 right-3 hidden -translate-y-1/2 rounded-full opacity-80 md:inline-flex" aria-label="Next slide" onClick={() => go(index + 1)}>
          <ChevronRight />
        </Button>
      )}
    </div>
  );
}

/** Every slide small, to jump to one. */
function Thumbs({ version, index, onIndex }: { version: CarouselVersion; index: number; onIndex: (i: number) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {version.slides.map((s, i) => (
        <button key={s.mediaId} type="button" onClick={() => onIndex(i)} aria-label={`Slide ${i + 1}`} className={cn('w-12 overflow-hidden rounded-[5px] ring-offset-2 ring-offset-background', i === index ? 'ring-2 ring-foreground' : 'opacity-60 hover:opacity-100')}>
          <img src={mediaFileUrl(s.mediaId)} alt="" loading="lazy" className="aspect-[4/5] w-full object-cover" />
        </button>
      ))}
    </div>
  );
}

/** A comment on the slide on screen, for Claude to fix. */
function SlideComment({ pieceId, version, index }: { pieceId: string; version: CarouselVersion; index: number }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  async function send() {
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api(`/pieces/${pieceId}/notes`, { method: 'POST', body: { mediaId: version.slides[index].mediaId, at: index, text } });
      setText('');
      void queryClient.invalidateQueries({ queryKey: keys.notes(pieceId) });
      void queryClient.invalidateQueries({ queryKey: keys.boardAll });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void send();
          }
        }}
        rows={2}
        placeholder={`Comment on slide ${index + 1}: what to change?`}
        className="w-full resize-y rounded-lg border bg-card px-3.5 py-3 text-[15px] leading-relaxed outline-none focus:border-foreground/30"
      />
      {text.trim() && (
        <Button size="sm" onClick={send} disabled={busy}>
          {busy && <Spinner />} Comment
        </Button>
      )}
    </div>
  );
}

/**
 * Posting it myself: the caption to paste, and the slides in order. The laptop saves them in one folder in Downloads
 * (the desktop app; a browser saves them side by side); the phone shares them to Instagram or saves them to the
 * gallery (Pictures/Content Studio/<folder>).
 */
function PostIt({ piece, version, draft }: { piece: PieceDetail; version: CarouselVersion; draft: CardDraft }) {
  const [busy, setBusy] = useState<'share' | 'save' | 'download' | null>(null);
  const ig = draft.draft.platforms.instagram;
  const caption = [ig.caption.trim(), ig.hashtags.trim()].filter(Boolean).join('\n\n');
  const folder = folderName(piece.title, version);
  const names = version.slides.map((_, i) => slideName(folder, i));
  const ids = version.slides.map((s) => s.mediaId);

  async function copy(quiet = false) {
    if (!caption) return false;
    try {
      await navigator.clipboard.writeText(caption);
      if (!quiet) toast('Caption copied');
      return true;
    } catch {
      return false;
    }
  }

  async function phone(share: boolean) {
    setBusy(share ? 'share' : 'save');
    try {
      const copied = share && (await copy(true));
      const { saved } = await Studio.shareImages({ mediaIds: ids, names, folder, save: !share, share });
      if (share) toast(copied ? 'Caption copied: paste it in Instagram' : 'Pick Instagram, then Feed');
      else toast(`${saved} slides saved to Pictures/Content Studio`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function download() {
    setBusy('download');
    // One file at a time, in order, so they land numbered (the desktop app puts them in one folder).
    for (const [i, id] of ids.entries()) {
      const a = document.createElement('a');
      a.href = fileUrl(`/media/${id}/file?download=1&name=${encodeURIComponent(names[i])}&folder=${encodeURIComponent(folder)}`);
      a.download = '';
      a.click();
      await new Promise((r) => setTimeout(r, 250));
    }
    setBusy(null);
    toast(`${ids.length} slides saved to Downloads/${folder}`);
  }

  return (
    <section className="space-y-2.5">
      <h2 className={heading}>Post it</h2>
      <div className="flex flex-wrap gap-2">
        {isNative ? (
          <>
            <Button onClick={() => phone(true)} disabled={!!busy}>
              {busy === 'share' ? <Spinner /> : <Share2 />} Share to Instagram
            </Button>
            <Button variant="outline" onClick={() => phone(false)} disabled={!!busy}>
              {busy === 'save' ? <Spinner /> : <ImageDown />} Save to phone
            </Button>
          </>
        ) : (
          <Button onClick={download} disabled={!!busy}>
            {busy === 'download' ? <Spinner /> : <Download />} Download {ids.length} slides
          </Button>
        )}
        <Button variant="outline" onClick={() => void copy()} disabled={!caption}>
          <Copy /> Copy caption
        </Button>
      </div>
    </section>
  );
}

/**
 * A carousel Claude made: its newest version's slides to swipe through, comments pinned to a slide, the other versions
 * a click away, and on the right what it waits for (Approve), the comments, posting it myself and the post's text.
 */
export function CarouselView({ piece, item, draft, versions }: { piece: PieceDetail; item: BoardItem | undefined; draft: CardDraft; versions: CarouselVersion[] }) {
  const newest = versions[0];
  const [shownId, setShownId] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  useEffect(() => setShownId(null), [newest.id]);
  const shown = versions.find((v) => v.id === shownId) ?? newest;
  const now = shown.id === newest.id;
  useEffect(() => setIndex((i) => Math.min(i, shown.slides.length - 1)), [shown]);

  return (
    <div className="grid grid-cols-1 items-start gap-9 md:grid-cols-[auto_minmax(0,34rem)] md:justify-start md:gap-14">
      <div className="min-w-0 space-y-4 md:w-[calc(min(66vh,760px)*4/5)]">
        <Slides version={shown} index={index} onIndex={setIndex} />
        <p className="text-[13px] text-muted-foreground">
          <span className="text-foreground tabular-nums">
            {index + 1} / {shown.slides.length}
          </span>
          {' · '}v{shown.number}
          {now ? ' · now' : ''}
          {shown.message ? ` · ${shown.message}` : ''}
        </p>
        <Thumbs version={shown} index={index} onIndex={setIndex} />
        {now && <SlideComment pieceId={piece.id} version={shown} index={index} />}
        {versions.length > 1 && (
          <div className="space-y-2">
            <h2 className={heading}>Versions</h2>
            <div className="flex flex-wrap gap-1.5">
              {versions.map((v) => (
                <Button key={v.id} size="sm" title={v.message} variant={v.id === shown.id ? 'default' : 'outline'} onClick={() => setShownId(v.id === newest.id ? null : v.id)}>
                  v{v.number}
                </Button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="min-w-0 space-y-9">
        <Status piece={piece} item={item} />
        <NoteList
          pieceId={piece.id}
          video={null}
          mediaId={newest.slides[index]?.mediaId ?? ''}
          version={newest.number}
          place={(n) => `Slide ${Math.round(n.at) + 1}`}
          onPick={(n) => {
            const v = versions.find((x) => x.number === n.version) ?? newest;
            setShownId(v.id === newest.id ? null : v.id);
            setIndex(Math.round(n.at));
          }}
        />
        <PostIt piece={piece} version={shown} draft={draft} />
        <PostText draft={draft} />
      </div>
    </div>
  );
}
