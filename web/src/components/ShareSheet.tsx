import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { PageDot } from '@/components/PageDot';
import { api } from '@/lib/api';
import { sendShare, Studio, type Share } from '@/lib/native';
import { useBoard, usePages } from '@/lib/queries';
import { STAGE_LABEL, type Card, type Stage } from '@shared/types';

// Cards that usually want files first.
const ORDER: Stage[] = ['needs_me', 'script', 'idea', 'making', 'review', 'ready'];

/** What another app shares to Content Studio: pick the card it's for (or make one), and it uploads in the background. */
export function ShareSheet() {
  const [share, setShare] = useState<Share | null>(null);
  const [title, setTitle] = useState('');
  const pages = usePages().data ?? [];
  const cards = (useBoard().data ?? []).filter((c) => ORDER.includes(c.stage)).sort((a, b) => ORDER.indexOf(a.stage) - ORDER.indexOf(b.stage) || b.updatedAt - a.updatedAt);
  const [pageId, setPageId] = useState<string | null>(null);

  useEffect(() => {
    if (!Studio) return;
    let handle: { remove: () => void } | null = null;
    void Studio.getShare().then(({ share }) => share && setShare(share));
    void Studio.addListener('share', (s) => setShare(s)).then((h) => (handle = h));
    return () => handle?.remove();
  }, []);

  if (!share) return null;
  const count = share.files.length;
  const send = async (card: { id: string; pageId: string; title: string }) => {
    await sendShare(share, card);
    toast(`${count} file${count === 1 ? '' : 's'} going to ${card.title}`);
    setShare(null);
  };
  const create = async () => {
    const target = pageId ?? pages[0]?.id;
    if (!title.trim() || !target) return;
    const card = await api<Card>('/api/cards', { body: { pageId: target, title: title.trim(), stage: 'needs_me' } });
    await send(card);
  };
  const drop = async () => {
    await Studio?.discardShare({ id: share.id });
    setShare(null);
  };

  return (
    <Sheet open onOpenChange={(open) => !open && void drop()}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto p-4 pb-safe">
        <SheetTitle className="pb-2 text-base">
          {count} file{count === 1 ? '' : 's'} to…
        </SheetTitle>
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <Input placeholder="New card" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void create()} />
            <Button onClick={() => void create()} disabled={!title.trim()}>
              Add
            </Button>
          </div>
          {pages.length > 1 && (
            <div className="flex flex-wrap gap-1">
              {pages.map((p) => (
                <button key={p.id} onClick={() => setPageId(p.id)} className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs ${(pageId ?? pages[0]?.id) === p.id ? 'bg-secondary' : 'text-muted-foreground'}`}>
                  <PageDot color={p.color} /> {p.name}
                </button>
              ))}
            </div>
          )}
          <div className="mt-2 flex flex-col">
            {cards.map((c) => (
              <button key={c.id} onClick={() => void send(c)} className="flex items-center gap-2 rounded-lg p-2.5 text-left text-sm active:bg-accent">
                <PageDot color={pages.find((p) => p.id === c.pageId)?.color ?? '#888'} />
                <span className="min-w-0 flex-1 truncate">{c.title}</span>
                <span className="text-xs text-muted-foreground">{STAGE_LABEL[c.stage]}</span>
              </button>
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
