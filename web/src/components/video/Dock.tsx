// One box for everything said to Claude: paused on a moment, it's a note pinned there (they collect until Fix);
// otherwise a message that starts Claude. "/" lists the skills, "@" the files.

import { ArrowUp, Paperclip, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { VideoDetail } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { tc } from '@/lib/format';
import { useBrain, useVideoActions } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { usePlayer, usePS } from './player';

type Pick = { label: string; hint: string; insert: string };

export function Dock({ detail, onAttach }: { detail: VideoDetail; onAttach: () => void }) {
  const p = usePlayer();
  const act = useVideoActions(detail.video.id);
  const brain = useBrain();
  const [text, setText] = useState('');
  const [pop, setPop] = useState<{ list: Pick[]; token: string; sel: number } | null>(null);
  const ta = useRef<HTMLTextAreaElement | null>(null);

  // A skill picked in Ctrl K lands here.
  useEffect(() => {
    const on = (e: Event) => {
      const add = String((e as CustomEvent).detail ?? '');
      setText((cur) => (cur ? `${cur.trimEnd()} ${add}` : add));
      requestAnimationFrame(() => ta.current?.focus());
    };
    window.addEventListener('cs:insert', on);
    return () => window.removeEventListener('cs:insert', on);
  }, []);

  const playing = usePS((s) => s.playing);
  const pinOn = usePS((s) => s.pinOn);
  const t = usePS((s) => s.t);
  const slide = usePS((s) => s.slide);
  const ver = usePS((s) => s.ver);
  const version = detail.versions.find((v) => v.n === ver) ?? detail.versions.at(-1) ?? null;
  const pinned = !!version && !playing && pinOn && detail.video.status !== 'posted';
  const where = version?.kind === 'carousel' ? `Slide ${slide + 1}` : tc(t);
  const open = detail.notes.filter((n) => n.status === 'open').length;
  const job = detail.job;

  const send = () => {
    const v = text.trim();
    if (!v) return;
    if (pinned && version && !v.startsWith('/')) act.addNote.mutate({ versionN: version.n, text: v, ...(version.kind === 'carousel' ? { slide: slide + 1 } : { at: Math.round(t * 10) / 10 }) });
    else act.say.mutate(v);
    setText('');
    setPop(null);
    requestAnimationFrame(() => size(ta.current));
  };

  const onChange = (el: HTMLTextAreaElement) => {
    setText(el.value);
    size(el);
    const m = el.value.slice(0, el.selectionStart).match(/(^|\s)([/@])([\w.-]*)$/);
    if (!m) return setPop(null);
    const q = m[3]!.toLowerCase();
    const list: Pick[] =
      m[2] === '/'
        ? (brain.data?.skills ?? []).filter((s) => s.name.includes(q)).slice(0, 8).map((s) => ({ label: `/${s.name}`, hint: s.description, insert: `/${s.name} ` }))
        : detail.inputs.filter((i) => i.name.toLowerCase().includes(q)).slice(0, 8).map((i) => ({ label: `@${i.name}`, hint: i.role ?? '', insert: `@${i.name} ` }));
    setPop(list.length ? { list, token: m[2]! + m[3]!, sel: 0 } : null);
  };

  const pick = (k: number) => {
    const el = ta.current;
    const it = pop?.list[k];
    if (!el || !it || !pop) return;
    const pos = el.selectionStart;
    const start = pos - pop.token.length;
    const next = el.value.slice(0, start) + it.insert + el.value.slice(pos);
    setText(next);
    setPop(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + it.insert.length, start + it.insert.length);
    });
  };

  return (
    <div className="relative flex flex-col gap-2 border-t p-3">
      {job && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/60 px-3 py-1.5 text-xs text-muted-foreground">
          <span className="truncate">{job.status === 'queued' ? 'Claude starts in a moment' : job.status === 'waiting' ? 'Waiting for Claude’s usage window' : job.step || 'Claude is working'}</span>
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => act.stop.mutate()}>
            Stop
          </Button>
        </div>
      )}
      {open > 0 && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-you/30 bg-you/10 py-1.5 pr-1.5 pl-3 text-sm">
          <span>{open === 1 ? '1 open note' : `${open} open notes`}</span>
          <Button size="sm" onClick={() => act.fix.mutate()} disabled={act.fix.isPending}>
            Fix {open > 1 ? 'them' : 'it'} <Kbd className="ml-1 hidden md:inline-flex">F</Kbd>
          </Button>
        </div>
      )}
      {pop && (
        <div className="absolute right-3 bottom-[calc(100%-0.5rem)] left-3 z-20 max-h-64 overflow-auto rounded-xl border bg-popover p-1 shadow-xl">
          {pop.list.map((it, k) => (
            <button key={it.label} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => pick(k)} className={cn('flex w-full items-center gap-3 rounded-lg px-2.5 py-1.5 text-left text-sm', k === pop.sel && 'bg-accent')}>
              <span className="font-mono">{it.label}</span>
              <span className="ml-auto truncate text-xs text-muted-foreground">{it.hint}</span>
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-1.5 rounded-2xl border bg-card px-3 pt-2 pb-1.5 focus-within:border-foreground/25">
        {pinned && (
          <span className="flex items-center gap-1 self-start rounded-md bg-you/15 py-0.5 pr-0.5 pl-2 font-mono text-xs text-you">
            Note at v{version!.n} {where}
            <button type="button" aria-label="Not about this moment" onClick={() => p.set({ pinOn: false })} className="grid size-4 place-items-center rounded">
              <X className="size-3" />
            </button>
          </span>
        )}
        <textarea
          ref={(el) => {
            ta.current = el;
            p.dock.current = el;
          }}
          id="dock"
          rows={1}
          value={text}
          aria-label="Message to Claude"
          placeholder={pinned ? 'Note on this moment…' : version ? 'Tell Claude what to change…' : 'Tell Claude what to make…'}
          className="max-h-32 min-h-6 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          onChange={(e) => onChange(e.currentTarget)}
          onKeyDown={(e) => {
            if (pop) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                setPop({ ...pop, sel: Math.max(0, Math.min(pop.list.length - 1, pop.sel + (e.key === 'ArrowDown' ? 1 : -1))) });
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                pick(pop.sel);
                return;
              }
              if (e.key === 'Escape') return setPop(null);
            }
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            } else if (e.key === 'Escape') e.currentTarget.blur();
          }}
        />
        <div className="flex items-center gap-1">
          <span className="mr-auto text-[11px] text-muted-foreground">/ skills · @ files</span>
          <Button size="icon" variant="ghost" className="size-8" onClick={onAttach} aria-label="Add files">
            <Paperclip className="size-4" />
          </Button>
          <Button size="icon" className="size-8 rounded-lg" onClick={send} disabled={!text.trim()} aria-label="Send">
            <ArrowUp className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function size(el: HTMLTextAreaElement | null) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
}
