// Ctrl K: jump to any video or place, or run a skill (it goes into the message box of the video I'm on).

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useBrain, usePages, useVideos } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { openNewPage } from './NewPage';

type Item = { group: string; label: string; hint: string; run: () => void };

export function Palette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const videos = useVideos();
  const pages = usePages();
  const brain = useBrain();
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);

  const items = useMemo(() => {
    const out: Item[] = [];
    const page = (id: string) => pages.data?.find((b) => b.id === id)?.name ?? '';
    for (const v of videos.data ?? []) out.push({ group: 'Videos', label: v.kind === 'page' ? `Set up ${page(v.pageId)}` : v.title, hint: `${page(v.pageId)} · ${v.reason}`, run: () => navigate(`/v/${v.id}`) });
    out.push({ group: 'Do', label: 'New page', hint: 'set one up with Claude', run: openNewPage });
    out.push({ group: 'Go to', label: 'Inbox', hint: '', run: () => navigate('/') });
    for (const b of pages.data ?? []) out.push({ group: 'Go to', label: b.name, hint: 'page', run: () => navigate(`/p/${b.id}`) });
    for (const [label, to] of [['Brain', '/brain'], ['Terminal', '/terminal'], ['Server', '/server']] as const) out.push({ group: 'Go to', label, hint: '', run: () => navigate(to) });
    for (const s of brain.data?.skills ?? []) out.push({ group: 'Skills', label: `/${s.name}`, hint: s.description, run: () => window.dispatchEvent(new CustomEvent('cs:insert', { detail: `/${s.name} ` })) });
    const l = q.toLowerCase().trim();
    return out.filter((i) => !l || `${i.label} ${i.hint}`.toLowerCase().includes(l)).slice(0, 60);
  }, [videos.data, pages.data, brain.data, q, navigate]);

  const run = (i: Item | undefined) => {
    if (!i) return;
    onOpenChange(false);
    setQ('');
    i.run();
  };

  let group = '';
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setQ('');
      }}
    >
      <DialogContent className="top-[18%] max-w-xl translate-y-0 gap-0 overflow-hidden p-0" showCloseButton={false} aria-describedby={undefined}>
        <DialogTitle className="sr-only">Jump to</DialogTitle>
        <input
          autoFocus
          value={q}
          onChange={(e) => {
            setQ(e.currentTarget.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              setSel((s) => Math.max(0, Math.min(items.length - 1, s + (e.key === 'ArrowDown' ? 1 : -1))));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              run(items[sel]);
            }
          }}
          placeholder="Jump to a video, a page, a place, or a skill…"
          aria-label="Search"
          className="w-full border-b bg-transparent px-4 py-3.5 text-[15px] outline-none"
        />
        <div className="max-h-[50vh] overflow-y-auto p-1.5">
          {!items.length && <div className="p-4 text-center text-sm text-muted-foreground">Nothing found</div>}
          {items.map((it, k) => {
            const head = it.group !== group ? <div className="px-2.5 pt-2 pb-1 text-[11px] tracking-wider text-muted-foreground uppercase">{it.group}</div> : null;
            group = it.group;
            return (
              <div key={`${it.group}${it.label}${k}`}>
                {head}
                <button type="button" onMouseEnter={() => setSel(k)} onClick={() => run(it)} className={cn('flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm', k === sel && 'bg-accent')}>
                  <span className={cn('shrink-0', it.group === 'Skills' && 'font-mono')}>{it.label}</span>
                  <span className="ml-auto truncate text-xs text-muted-foreground">{it.hint}</span>
                </button>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
