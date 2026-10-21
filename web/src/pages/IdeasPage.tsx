import { ArrowLeft, ChevronRight, Keyboard, Plus, Search, Tag, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { firstLink, labelColor, type IdeaNode } from '@shared/ideas';
import { IdeaCanvas } from '@/components/ideas/IdeaCanvas';
import { IdeaList } from '@/components/ideas/IdeaList';
import { IdeaPanel } from '@/components/ideas/IdeaPanel';
import { addPicture, ancestors, cardTitle, createCard, isInside, matches, useTree } from '@/components/ideas/model';
import { useWorkspaceContext } from '@/components/WorkspaceLayout';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { useIsDesktop, useMediaQuery } from '@/hooks/useMediaQuery';
import { api, errorMessage } from '@/lib/api';
import { COLOR_DOT } from '@/lib/colors';
import { keys, queryClient, useIdeas } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { useQuery } from '@tanstack/react-query';

const KEYS: [string, string][] = [
  ['Enter', 'Next idea (same level)'],
  ['Tab', 'Sub-idea'],
  ['Shift Tab', 'Up a level, while typing'],
  ['Type / Space', 'Edit the title'],
  ['Shift Enter', 'Open as its own canvas'],
  ['Esc', 'Deselect, then back up a level'],
  ['Arrows', 'Move between cards'],
  ['Alt + Arrows', 'Move the card itself'],
  ['Delete', 'Delete (undo in the toast)'],
  ['Ctrl Z', 'Undo'],
  ['Ctrl V', 'Paste links, lines or screenshots'],
  ['Ctrl scroll', 'Zoom (Ctrl 0 fits)'],
];

/** Lines pasted as cards: one per line, indented lines under the line above; links become saved posts. */
function pasteLines(wid: string, text: string, parentId: string | null, saved: string | null) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const stack: { indent: number; id: string }[] = [];
  let made = 0;
  for (const raw of lines) {
    const indent = (/^[\t ]*/.exec(raw)?.[0] ?? '').replace(/\t/g, '  ').length;
    const line = raw.trim().replace(/^([-*•]|\d+[.)])\s+/, '');
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    const under = stack[stack.length - 1]?.id ?? parentId;
    const url = firstLink(line);
    const id = url ? createCard(wid, { parentId: under ?? saved, url, title: line.replace(url, '').trim() || undefined }) : createCard(wid, { parentId: under, title: line.slice(0, 300) });
    stack.push({ indent, id });
    made++;
  }
  return made;
}

export function IdeasPage() {
  const { workspace } = useWorkspaceContext();
  const wid = workspace.id;
  const ideas = useIdeas(wid);
  const tree = useTree(ideas.data);
  const [params, setParams] = useSearchParams();
  const wide = useMediaQuery('(min-width: 768px)');
  const roomy = useIsDesktop();
  const focus = params.get('focus') && tree.byId.has(params.get('focus')!) ? params.get('focus') : null;
  const open = params.get('open') && tree.byId.has(params.get('open')!) ? params.get('open') : null;
  const [editing, setEditing] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [labels, setLabels] = useState<string[]>([]);
  const fromBoard = useQuery({ queryKey: ['ideas-from-board', wid], queryFn: () => api<{ count: number }>(`/workspaces/${wid}/ideas/from-board`) });
  const [moving, setMoving] = useState(false);

  const setParam = useCallback(
    (next: { focus?: string | null; open?: string | null }, push = false) => {
      setParams(
        (p) => {
          const q = new URLSearchParams(p);
          for (const [k, v] of Object.entries(next)) {
            if (v) q.set(k, v);
            else q.delete(k);
          }
          q.delete('move');
          return q;
        },
        { replace: !push },
      );
    },
    [setParams],
  );
  const select = useCallback((id: string | null) => setParam({ open: id }), [setParam]);
  const dive = useCallback(
    (id: string | null) => {
      setEditing(null);
      setParam({ focus: id, open: null }, true);
    },
    [setParam],
  );

  // Opening the Saved pile: what's in it isn't new any more.
  const seenFor = useRef<string | null>(null);
  useEffect(() => {
    if (focus && tree.byId.get(focus)?.kind === 'saved' && seenFor.current !== focus) {
      seenFor.current = focus;
      void api(`/ideas/${focus}/seen`, { method: 'POST' }).catch(() => {});
    }
    if (!focus) seenFor.current = null;
  }, [focus, tree]);

  // A label filter: the cards with one of the labels, and the cards above them, under the card being looked at.
  const only = useMemo(() => {
    if (!labels.length) return null;
    const keep = new Set<string>();
    for (const n of tree.byId.values()) {
      if (!n.labels.some((l) => labels.includes(l))) continue;
      if (focus && !isInside(tree, n.id, focus)) continue;
      keep.add(n.id);
      for (const a of ancestors(tree, n.id)) keep.add(a.id);
    }
    return keep;
  }, [labels, tree, focus]);

  const found = useMemo(() => (query.trim().length > 1 ? [...tree.byId.values()].filter((n) => n.kind !== 'saved' && matches(n, query.trim())).slice(0, 10) : []), [query, tree]);
  const jump = (n: IdeaNode) => {
    setQuery('');
    setParam({ focus: n.parentId && tree.byId.get(n.parentId)?.kind === 'saved' ? n.parentId : focus && isInside(tree, n.id, focus) ? focus : null, open: n.id }, true);
  };

  // Paste anywhere on the page (outside a text box): links, lines, screenshots.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('textarea, input, [contenteditable="true"]')) return;
      const sel = open ? tree.byId.get(open) : undefined;
      const parent = sel && sel.kind !== 'image' && sel.kind !== 'link' ? sel.id : focus;
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
      if (files.length) {
        e.preventDefault();
        void addPicture(wid, parent ?? tree.saved?.id ?? null, files).then(() => toast.success(files.length === 1 ? 'Picture added' : `${files.length} pictures added`));
        return;
      }
      const text = e.clipboardData?.getData('text/plain') ?? '';
      if (!text.trim()) return;
      e.preventDefault();
      const n = pasteLines(wid, text, parent, tree.saved?.id ?? null);
      if (n > 1) toast.success(`${n} cards added`);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [wid, open, focus, tree]);

  // Pictures dropped from the computer: onto the card under the pointer, else the level being looked at.
  const onDrop = (e: React.DragEvent) => {
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    const id = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-card]')?.dataset.card;
    const target = id && tree.byId.has(id) && tree.byId.get(id)!.kind !== 'image' ? id : (focus ?? tree.saved?.id ?? null);
    void addPicture(wid, target, files).then(() => toast.success('Added'));
  };

  const addTop = () => {
    const id = createCard(wid, { parentId: focus });
    setParam({ open: id });
    setEditing(id);
  };

  const moveFromBoard = async () => {
    setMoving(true);
    try {
      const r = await api<{ moved: number }>(`/workspaces/${wid}/ideas/from-board`, { method: 'POST' });
      toast.success(`${r.moved} idea${r.moved === 1 ? '' : 's'} moved onto the canvas`);
      void queryClient.invalidateQueries({ queryKey: keys.ideas(wid) });
      void queryClient.invalidateQueries({ queryKey: ['ideas-from-board', wid] });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setMoving(false);
    }
  };

  const trail = focus ? [...ancestors(tree, focus), tree.byId.get(focus)!] : [];
  const panel = open ? (
    <IdeaPanel
      key={open}
      wid={wid}
      tree={tree}
      id={open}
      onClose={() => select(null)}
      onSelect={(id) => select(id)}
      onDive={(id) => dive(id)}
      moveFirst={params.get('move') === '1'}
    />
  ) : null;

  return (
    <div className="flex h-full min-h-0 flex-col" onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()} onDrop={onDrop}>
      <header className="flex min-h-12 flex-wrap items-center gap-2 border-b px-3 py-1.5 md:px-4">
        {focus && (
          <Button variant="ghost" size="icon-sm" onClick={() => dive(tree.byId.get(focus)?.parentId ?? null)} aria-label="Up a level">
            <ArrowLeft />
          </Button>
        )}
        <nav className="flex min-w-0 flex-1 items-center gap-0.5 text-sm" aria-label="Where you are">
          <button type="button" data-crumb="" onClick={() => dive(null)} className={cn('shrink-0 rounded px-1.5 py-0.5 hover:bg-accent', !focus ? 'font-semibold' : 'text-muted-foreground')}>
            Ideas
          </button>
          {trail.map((n, i) => (
            <span key={n.id} className="flex min-w-0 items-center gap-0.5">
              <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
              <button type="button" data-crumb={n.id} onClick={() => dive(n.id)} className={cn('min-w-0 truncate rounded px-1.5 py-0.5 hover:bg-accent', i === trail.length - 1 ? 'font-semibold' : 'max-w-40 text-muted-foreground')}>
                {cardTitle(n) || 'Untitled'}
              </button>
            </span>
          ))}
        </nav>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && found[0]) jump(found[0]);
              if (e.key === 'Escape') setQuery('');
            }}
            placeholder="Find a card"
            className="h-8 w-36 rounded-lg border bg-transparent pr-2 pl-8 text-sm outline-none focus-visible:border-ring md:w-52"
            aria-label="Find a card"
          />
          {found.length > 0 && (
            <ul className="absolute top-9 right-0 z-30 w-72 overflow-hidden rounded-lg border bg-popover p-1 shadow-lg">
              {found.map((n) => (
                <li key={n.id}>
                  <button type="button" onClick={() => jump(n)} className="w-full rounded px-2 py-1.5 text-left text-sm hover:bg-accent">
                    <span className="line-clamp-1">{cardTitle(n) || 'Untitled'}</span>
                    {n.parentId && <span className="line-clamp-1 text-xs text-muted-foreground">in {ancestors(tree, n.id).map((a) => cardTitle(a) || 'Untitled').join(' › ')}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {tree.labels.length > 0 && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant={labels.length ? 'secondary' : 'ghost'} size="sm" aria-label="Filter by label">
                <Tag /> {labels.length ? labels.length : <span className="hidden md:inline">Labels</span>}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-56 p-1">
              {tree.labels.map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLabels(labels.includes(l) ? labels.filter((x) => x !== l) : [...labels, l])}
                  className={cn('flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent', labels.includes(l) && 'bg-accent')}
                >
                  <span className={cn('size-2 rounded-full', COLOR_DOT[labelColor(l)])} /> {l}
                </button>
              ))}
              {labels.length > 0 && (
                <button type="button" onClick={() => setLabels([])} className="mt-1 flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent">
                  <X className="size-3" /> Show everything
                </button>
              )}
            </PopoverContent>
          </Popover>
        )}
        {wide && (
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Keyboard">
                <Keyboard />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72">
              <ul className="space-y-1.5 text-sm">
                {KEYS.map(([k, what]) => (
                  <li key={k} className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">{what}</span>
                    <Kbd>{k}</Kbd>
                  </li>
                ))}
              </ul>
            </PopoverContent>
          </Popover>
        )}
        {wide && (
          <Button size="sm" onClick={addTop}>
            <Plus /> Idea
          </Button>
        )}
      </header>

      {!!fromBoard.data?.count && !focus && (
        <div className="flex flex-wrap items-center gap-2 border-b bg-brand-soft px-4 py-2 text-sm">
          <span className="min-w-0 flex-1">
            {fromBoard.data.count} idea{fromBoard.data.count === 1 ? '' : 's'} you wrote on the Videos board {fromBoard.data.count === 1 ? 'is' : 'are'} only words so far. Brainstorm {fromBoard.data.count === 1 ? 'it' : 'them'} here instead?
          </span>
          <Button size="sm" variant="secondary" onClick={moveFromBoard} disabled={moving}>
            {moving && <Spinner />} Move {fromBoard.data.count === 1 ? 'it' : 'them'} here
          </Button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1">
          {ideas.isLoading ? (
            <div className="grid h-full place-items-center">
              <Spinner className="size-5 text-muted-foreground" />
            </div>
          ) : wide ? (
            <IdeaCanvas wid={wid} pageName={workspace.name} tree={tree} focus={focus} selected={open} onSelect={select} onDive={dive} only={only} editing={editing} onEdit={setEditing} />
          ) : (
            <IdeaList wid={wid} tree={tree} focus={focus} only={only} onOpen={(id) => select(id)} onDive={dive} />
          )}
        </div>
        {roomy && panel && (
          <aside className="w-[400px] shrink-0 border-l" aria-label="The card">
            {panel}
          </aside>
        )}
      </div>
      {!roomy && (
        <Sheet open={!!panel} onOpenChange={(o) => !o && select(null)}>
          <SheetContent side={wide ? 'right' : 'bottom'} showCloseButton={false} className={cn('gap-0 overflow-hidden p-0', wide ? 'w-[420px] sm:max-w-[420px]' : 'rounded-t-2xl data-[side=bottom]:h-[94dvh]')}>
            <SheetTitle className="sr-only">The card</SheetTitle>
            <SheetDescription className="sr-only">Its notes, script draft and what Claude can do with it</SheetDescription>
            {panel}
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
