import { Clapperboard, NotebookPen, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type { WorkspaceColor } from '@shared/types';
import { MediaIcon } from '@/components/MediaCard';
import { WorkspaceDot } from '@/components/WorkspaceDot';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';
import { Spinner } from '@/components/ui/spinner';
import { mediaThumbUrl } from '@/lib/api';
import { duration } from '@/lib/format';
import { useSearch, useWorkspaces } from '@/lib/queries';
import { createStore, useStore } from '@/lib/ui-state';
import { cn } from '@/lib/utils';

export const searchOpen = createStore(false);

type Hit = { key: string; href: string; title: string; detail: string; thumb: string | null; icon: React.ReactNode; color?: WorkspaceColor };

/** Ctrl K: one search over every page's videos, footage (titles, scripts, what's said) and Notes. */
export function SearchDialog() {
  const open = useStore(searchOpen);
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const { data: workspaces = [] } = useWorkspaces();
  const search = useSearch(debounced);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchOpen.set(!searchOpen.get());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 200);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const hits = useMemo<Hit[]>(() => {
    if (debounced.length < 2 || !search.data) return [];
    const ws = new Map(workspaces.map((w) => [w.id, w]));
    const stageName = (wid: string, stage: string) => ws.get(wid)?.stages.find((s) => s.id === stage)?.name ?? stage;
    return [
      ...search.data.pieces.map((p) => ({
        key: `p${p.id}`,
        href: `/w/${p.workspaceId}/p/${p.id}`,
        title: p.title,
        detail: [ws.get(p.workspaceId)?.name, stageName(p.workspaceId, p.stage), p.snippet].filter(Boolean).join(' · '),
        thumb: p.thumbMediaId,
        icon: <Clapperboard className="size-4" />,
        color: ws.get(p.workspaceId)?.color,
      })),
      ...(search.data.notes ?? []).map((n) => ({
        key: `n${n.id}`,
        href: `/w/${n.workspaceId}/notes?n=${n.id}`,
        title: n.title || 'Untitled note',
        detail: [ws.get(n.workspaceId)?.name, 'Notes', n.snippet].filter(Boolean).join(' · '),
        thumb: null,
        icon: <NotebookPen className="size-4" />,
        color: ws.get(n.workspaceId)?.color,
      })),
      ...search.data.media.map((m) => ({
        key: `m${m.id}`,
        href: m.pieceId ? `/w/${m.workspaceId}/p/${m.pieceId}` : `/w/${m.workspaceId}/inbox`,
        title: m.originalName,
        detail: [ws.get(m.workspaceId)?.name, m.pieceId ? 'in a video' : 'Inbox', m.durationMs ? duration(m.durationMs) : '', m.snippet].filter(Boolean).join(' · '),
        thumb: m.hasThumb ? m.id : null,
        icon: <MediaIcon media={{ kind: m.kind, assetType: null }} className="size-4" />,
        color: ws.get(m.workspaceId)?.color,
      })),
    ];
  }, [search.data, debounced, workspaces]);

  useEffect(() => setActive(0), [hits.length, debounced]);

  const go = (hit: Hit | undefined) => {
    if (!hit) return;
    searchOpen.set(false);
    navigate(hit.href);
  };

  return (
    <Dialog open={open} onOpenChange={searchOpen.set}>
      <DialogContent showCloseButton={false} className="top-[15%] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogTitle className="sr-only">Search</DialogTitle>
        <DialogDescription className="sr-only">Search every video and file</DialogDescription>
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(hits.length - 1, a + 1)));
              if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(0, a - 1)));
              if (e.key === 'Enter') go(hits[active]);
            }}
            placeholder="Search videos, scripts, notes, footage, what's said…"
            className="h-12 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            aria-label="Search"
          />
          {search.isFetching && <Spinner className="size-4 text-muted-foreground" />}
        </div>
        <div className="max-h-[60dvh] overflow-y-auto p-1.5" role="listbox" aria-label="Results">
          {debounced.length < 2 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Find any video, note or file on every page. <Kbd>Ctrl</Kbd> <Kbd>K</Kbd> opens this anywhere.
            </p>
          ) : !hits.length && !search.isFetching ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">Nothing matches “{debounced}”.</p>
          ) : (
            hits.map((h, i) => (
              <button
                key={h.key}
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseMove={() => setActive(i)}
                onClick={() => go(h)}
                className={cn('flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left', i === active && 'bg-accent')}
              >
                <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded bg-muted text-muted-foreground">
                  {h.thumb ? <img src={mediaThumbUrl(h.thumb)} alt="" loading="lazy" className="size-full object-cover" /> : h.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{h.title}</span>
                  <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                    {h.color && <WorkspaceDot color={h.color} className="size-1.5 shrink-0" />}
                    <span className="truncate">{h.detail}</span>
                  </span>
                </span>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
