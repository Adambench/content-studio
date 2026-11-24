import { HistoryIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { api } from '@/lib/api';
import { ago } from '@/lib/format';
import { keys, queryClient, useDrafts, useUpdateCard } from '@/lib/queries';
import type { Card, Hook } from '@shared/types';

/** A textarea that grows with its text. */
function Grow({ value, onChange, placeholder, className = '' }: { value: string; onChange: (v: string) => void; placeholder: string; className?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      rows={3}
      className={`w-full resize-none bg-transparent leading-relaxed outline-none placeholder:text-muted-foreground/60 ${className}`}
    />
  );
}

/** My draft as I type: saved half a second after I stop, never overwritten by a refetch while I'm typing. */
function useDraftField(card: Card, field: 'script' | 'notes') {
  const update = useUpdateCard(card.id);
  const [value, setValue] = useState(card[field]);
  const [dirty, setDirty] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => {
    if (!dirty) setValue(card[field]);
  }, [card, field, dirty]);
  const change = (v: string) => {
    setValue(v);
    setDirty(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => update.mutate({ [field]: v }, { onSettled: () => setDirty(false) }), 500);
  };
  return { value, change, saving: dirty };
}

function Drafts({ card }: { card: Card }) {
  const [open, setOpen] = useState(false);
  const drafts = useDrafts(card.id, open).data ?? [];
  const restore = async (id: string) => {
    await api(`/api/cards/${card.id}/drafts/${id}/restore`, { body: {} });
    await queryClient.invalidateQueries({ queryKey: keys.card(card.id) });
    setOpen(false);
    toast('Older draft restored (the current one is in the history)');
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label="Earlier drafts" className="text-muted-foreground">
          <HistoryIcon />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="max-h-96 w-80 overflow-y-auto p-2">
        {drafts.length === 0 && <p className="p-2 text-sm text-muted-foreground">No earlier drafts.</p>}
        {drafts.map((d) => (
          <button key={d.id} onClick={() => void restore(d.id)} className="w-full rounded-md p-2 text-left text-sm hover:bg-accent">
            <div className="text-xs text-muted-foreground">
              {d.note} · {ago(d.createdAt)}
            </div>
            <div className="line-clamp-2">{d.script || d.notes}</div>
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}

export function Doc({ card, hooks }: { card: Card; hooks: Hook[] | null }) {
  const script = useDraftField(card, 'script');
  const notes = useDraftField(card, 'notes');

  // A hook swaps my first line; Undo puts it back.
  const take = (line: string) => {
    const before = script.value;
    const lines = before.split('\n');
    const first = lines.findIndex((l) => l.trim());
    if (first < 0) lines.unshift(line);
    else lines[first] = line;
    script.change(lines.join('\n'));
    toast('First line swapped', { action: { label: 'Undo', onClick: () => script.change(before) } });
  };

  return (
    <div className="flex flex-col gap-6">
      <section>
        <div className="mb-1 flex items-center gap-2">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{card.labels.script}</h3>
          {script.saving && <span className="text-[11px] text-muted-foreground">saving</span>}
          <div className="flex-1" />
          <Drafts card={card} />
        </div>
        <Grow value={script.value} onChange={script.change} placeholder="What I say, line by line. Or press Write." className="min-h-24 text-[15px]" />
        {hooks && hooks.length > 0 && (
          <div className="mt-3 flex flex-col gap-1 rounded-lg border p-2">
            <div className="px-1 pb-1 text-xs text-muted-foreground">Other first lines</div>
            {hooks.map((h) => (
              <button key={h.line} onClick={() => take(h.line)} className="rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent" title={h.why}>
                {h.line}
              </button>
            ))}
          </div>
        )}
      </section>
      <section>
        <div className="mb-1 flex items-center gap-2">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{card.labels.notes}</h3>
          {notes.saving && <span className="text-[11px] text-muted-foreground">saving</span>}
        </div>
        <Grow value={notes.value} onChange={notes.change} placeholder="What I want: the day, the idea, the effects." className="min-h-16 text-sm text-foreground/90" />
      </section>
    </div>
  );
}
