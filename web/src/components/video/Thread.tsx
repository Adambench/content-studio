// The conversation with Claude: my messages, its words, its work (folded: the steps it reported, the commands it
// ran), its questions, the versions it saved, the lessons it learned, and my notes where I left them.

import { BookOpen, Check, ChevronRight, Film, X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Note, ThreadItem, VideoDetail } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { ago, tc } from '@/lib/format';
import { useVideoActions } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { usePlayer } from './player';

type Row = { kind: 'item'; item: ThreadItem } | { kind: 'work'; jobId: string | null; items: ThreadItem[] } | { kind: 'note'; note: Note };

/** Thread and notes in time order, with Claude's steps and tool calls folded into one block per run. */
function rows(detail: VideoDetail): Row[] {
  const merged: ({ at: number; i: number } & ({ item: ThreadItem } | { note: Note }))[] = [
    ...detail.thread.map((item, i) => ({ at: item.createdAt, i, item })),
    ...detail.notes.map((note, i) => ({ at: note.createdAt, i: 1e6 + i, note })),
  ].sort((a, b) => a.at - b.at || a.i - b.i);
  const out: Row[] = [];
  for (const m of merged) {
    if ('note' in m) {
      out.push({ kind: 'note', note: m.note });
      continue;
    }
    const it = m.item;
    if (it.kind === 'step' || it.kind === 'tool') {
      const last = out.at(-1);
      if (last?.kind === 'work' && last.jobId === it.jobId) last.items.push(it);
      else out.push({ kind: 'work', jobId: it.jobId, items: [it] });
    } else out.push({ kind: 'item', item: it });
  }
  return out;
}

export function Thread({ detail }: { detail: VideoDetail }) {
  const list = rows(detail);
  const box = useRef<HTMLDivElement>(null);
  const count = detail.thread.length + detail.notes.length;
  const atEnd = useRef(true);
  // Follow the newest item, scrolling only the thread itself (not the sheet or page around it).
  useLayoutEffect(() => {
    const el = box.current?.parentElement;
    if (el && atEnd.current) el.scrollTop = el.scrollHeight;
  }, [count]);
  useEffect(() => {
    const el = box.current?.parentElement;
    if (!el) return;
    const on = () => (atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120);
    el.addEventListener('scroll', on, { passive: true });
    return () => el.removeEventListener('scroll', on);
  }, []);
  const running = detail.job?.status === 'running' || detail.job?.status === 'queued';

  return (
    <div ref={box} className="flex flex-col gap-3 pb-2">
      {!list.length && <p className="py-6 text-center text-sm text-muted-foreground">Tell Claude what you want, or drop files.</p>}
      {list.map((r, i) => {
        if (r.kind === 'note') return <NoteRow key={r.note.id} note={r.note} detail={detail} />;
        if (r.kind === 'work') return <Work key={`w${i}`} items={r.items} live={running && i === list.length - 1} />;
        return <Item key={r.item.id} item={r.item} detail={detail} />;
      })}
      {running && list.at(-1)?.kind !== 'work' && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-3.5" /> {detail.job?.status === 'queued' ? 'Up next' : detail.job?.step || 'Claude is on it'}
        </div>
      )}
    </div>
  );
}

function Item({ item, detail }: { item: ThreadItem; detail: VideoDetail }) {
  const p = usePlayer();
  const act = useVideoActions(detail.video.id);
  switch (item.kind) {
    case 'you':
      return (
        <div className="ml-8 self-end rounded-2xl rounded-br-md bg-secondary px-3 py-2 text-sm whitespace-pre-wrap" title={ago(item.createdAt)}>
          {item.text}
        </div>
      );
    case 'claude':
      return <div className="text-sm leading-relaxed whitespace-pre-wrap">{item.text}</div>;
    case 'question': {
      const options = (item.data.options as string[]) ?? [];
      const picked = item.data.picked as number | null;
      return (
        <div className="flex flex-col gap-2 rounded-xl border p-3">
          <div className="text-sm font-medium">{item.text}</div>
          <div className="flex flex-wrap gap-2">
            {options.map((o, k) => (
              <Button key={k} size="sm" variant={picked === k ? 'default' : 'outline'} disabled={picked != null || act.answer.isPending} onClick={() => act.answer.mutate({ itemId: item.id, option: k })} className="h-auto py-1.5 whitespace-normal">
                {o}
              </Button>
            ))}
          </div>
        </div>
      );
    }
    case 'version': {
      const n = item.data.n as number;
      return (
        <button type="button" onClick={() => p.set({ ver: n, compare: false, t: 0, slide: 0 })} className="flex items-center gap-3 rounded-xl border bg-card px-3 py-2 text-left text-sm hover:bg-accent">
          <Film className="size-4 text-muted-foreground" />
          <span className="font-mono font-medium">v{n}</span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{(item.data.note as string) || 'Ready to watch'}</span>
        </button>
      );
    }
    case 'lesson':
      return (
        <div className="flex items-start gap-2 self-start rounded-lg border border-dashed px-2.5 py-1.5 text-xs text-muted-foreground">
          <BookOpen className="mt-0.5 size-3.5 shrink-0" /> <span>Lesson: {item.text}</span>
        </div>
      );
    case 'error':
      return <div className="text-sm text-destructive">Stopped: {item.text}</div>;
    default:
      return <div className="text-center text-xs text-muted-foreground">{item.text}</div>;
  }
}

/** One run's work, folded: the last step it reported, opened to every step and command. */
function Work({ items, live }: { items: ThreadItem[]; live: boolean }) {
  const [open, setOpen] = useState(false);
  const steps = items.filter((i) => i.kind === 'step');
  const head = steps.at(-1)?.text ?? (live ? 'Working' : 'Worked');
  return (
    <div className="rounded-xl border bg-card/60">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm">
        {live ? <Spinner className="size-3.5" /> : <Check className="size-3.5 text-muted-foreground" />}
        <span className="min-w-0 flex-1 truncate">{head}</span>
        <span className="text-xs text-muted-foreground">{steps.length ? `${steps.length} step${steps.length > 1 ? 's' : ''}` : `${items.length} action${items.length > 1 ? 's' : ''}`}</span>
        <ChevronRight className={cn('size-3.5 text-muted-foreground transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <ul className="flex flex-col gap-1 px-3 pb-3 pl-8">
          {items.map((i) => (
            <li key={i.id} className={cn('text-xs break-words', i.kind === 'tool' ? 'font-mono text-muted-foreground' : 'text-foreground/90')}>
              {i.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NoteRow({ note, detail }: { note: Note; detail: VideoDetail }) {
  const p = usePlayer();
  const act = useVideoActions(detail.video.id);
  const where = note.slide ? `Slide ${note.slide}` : tc(note.at);
  return (
    <div className={cn('flex items-start gap-2.5 rounded-xl border px-3 py-2', note.status === 'fixed' && 'opacity-70')}>
      <button
        type="button"
        onClick={() => {
          p.pause();
          p.set({ ver: note.versionN, compare: false, slide: note.slide ? note.slide - 1 : p.get().slide });
          if (note.at != null) setTimeout(() => p.seek(note.at!), 50);
        }}
        className={cn('rounded-md px-1.5 py-0.5 font-mono text-xs whitespace-nowrap', note.status === 'fixed' ? 'bg-muted text-muted-foreground' : 'bg-you/15 text-you')}
      >
        v{note.versionN} {where}
      </button>
      <div className="min-w-0 flex-1">
        <div className="text-sm">{note.text}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{note.status === 'open' ? 'Open' : note.status === 'sent' ? 'With Claude' : `Fixed in v${note.fixedIn}${note.reply ? `: ${note.reply}` : ''}`}</div>
      </div>
      {note.status === 'open' && (
        <button type="button" aria-label="Drop this note" onClick={() => act.dropNote.mutate(note.id)} className="text-muted-foreground hover:text-foreground">
          <X className="size-4" />
        </button>
      )}
    </div>
  );
}
