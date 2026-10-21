// The Ideas canvas on the client: the cards as a tree, and every change applied to the cache at once (the server
// answers later), so typing, Tab and Enter never wait. Undo (Ctrl+Z, and the toasts' Undo) replays the opposite.
import { useMemo } from 'react';
import { toast } from 'sonner';
import type { IdeaKind, IdeaNode } from '@shared/ideas';
import { api, errorMessage } from '@/lib/api';
import { keys, queryClient } from '@/lib/queries';

export type Tree = {
  byId: Map<string, IdeaNode>;
  /** Children in order; `null` is the top level (the Saved pile always last). */
  kids: Map<string | null, IdeaNode[]>;
  saved: IdeaNode | undefined;
  labels: string[];
};

export function buildTree(nodes: IdeaNode[]): Tree {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kids = new Map<string | null, IdeaNode[]>();
  for (const n of nodes) {
    const key = n.parentId && byId.has(n.parentId) ? n.parentId : null;
    kids.set(key, [...(kids.get(key) ?? []), n]);
  }
  for (const list of kids.values()) list.sort((a, b) => (a.kind === 'saved' ? 1 : 0) - (b.kind === 'saved' ? 1 : 0) || a.position - b.position);
  const labels = [...new Set(nodes.flatMap((n) => n.labels))].sort();
  return { byId, kids, saved: nodes.find((n) => n.kind === 'saved'), labels };
}

export const useTree = (nodes: IdeaNode[] | undefined) => useMemo(() => buildTree(nodes ?? []), [nodes]);

export const childrenOf = (t: Tree, id: string | null) => t.kids.get(id) ?? [];

/** From the top level down to `id` (not included). */
export function ancestors(t: Tree, id: string | null) {
  const out: IdeaNode[] = [];
  for (let n = id ? t.byId.get(id) : undefined; n?.parentId; ) {
    const p = t.byId.get(n.parentId);
    if (!p) break;
    out.unshift(p);
    n = p;
  }
  return out;
}

export function countUnder(t: Tree, id: string): number {
  return childrenOf(t, id).reduce((sum, c) => sum + 1 + countUnder(t, c.id), 0);
}

export function isInside(t: Tree, id: string, maybeAncestor: string) {
  for (let n = t.byId.get(id); n?.parentId; n = t.byId.get(n.parentId)) if (n.parentId === maybeAncestor) return true;
  return false;
}

/** The series a card is an episode of, and its number. */
export function episodeOf(t: Tree, n: IdeaNode) {
  if (n.kind !== 'idea' || !n.parentId) return null;
  const p = t.byId.get(n.parentId);
  if (p?.kind !== 'series') return null;
  return childrenOf(t, p.id)
    .filter((c) => c.kind === 'idea')
    .findIndex((c) => c.id === n.id) + 1;
}

/** What a card says on the canvas when it has no title of its own. */
export function cardTitle(n: IdeaNode) {
  if (n.title) return n.title;
  if (n.kind === 'link') return n.post?.title || n.url || 'A saved post';
  if (n.kind === 'image') return '';
  if (n.kind === 'saved') return 'Saved';
  return n.body.split('\n').find((l) => l.trim())?.trim() ?? '';
}

export function matches(n: IdeaNode, q: string) {
  const s = q.toLowerCase();
  return [n.title, n.body, n.script, n.post?.title, n.post?.channel, ...n.labels].some((x) => x?.toLowerCase().includes(s));
}

// ---------- changes, applied locally first ----------

// Refetching while a change is still on its way would show the cards without it for a moment (a card being typed
// into would vanish and come back empty): refetches wait until every change has reached the server.
let inflight = 0;
const stale = new Set<string | null>();

/** Refetch a page's cards (or every page's), now or once the changes on their way have arrived. */
export function refreshIdeas(wid: string | null) {
  if (inflight) stale.add(wid);
  else void queryClient.invalidateQueries({ queryKey: wid ? keys.ideas(wid) : ['ideas'] });
}

const setNodes = (wid: string, fn: (nodes: IdeaNode[]) => IdeaNode[]) => {
  // A refetch that started before this change would overwrite it.
  void queryClient.cancelQueries({ queryKey: keys.ideas(wid) });
  queryClient.setQueryData<IdeaNode[]>(keys.ideas(wid), (old) => fn(old ?? []));
};
const resync = (wid: string) => refreshIdeas(wid);

/** Where a card lands among its siblings (the server's rule, so the order is right before it answers). */
function positionFor(nodes: IdeaNode[], parentId: string | null, after: string | null | undefined, self?: string) {
  const parent = parentId ? nodes.find((n) => n.id === parentId) : undefined;
  const sibs = nodes
    .filter((n) => n.parentId === parentId && n.id !== self && n.kind !== 'saved')
    .sort((a, b) => a.position - b.position);
  if (!sibs.length) return 0;
  if (after) {
    const i = sibs.findIndex((s) => s.id === after);
    if (i >= 0) return i === sibs.length - 1 ? sibs[i].position + 1 : (sibs[i].position + sibs[i + 1].position) / 2;
  }
  return after === null || (after === undefined && parent?.kind === 'saved') ? sibs[0].position - 1 : sibs[sibs.length - 1].position + 1;
}

type Undo = { label: string; run: () => Promise<unknown> };
const undoStack: Undo[] = [];
const pushUndo = (u: Undo) => {
  undoStack.push(u);
  if (undoStack.length > 50) undoStack.shift();
};

export async function undoLast() {
  const u = undoStack.pop();
  if (!u) return false;
  await u.run().catch((err) => toast.error(errorMessage(err)));
  return true;
}

// One change at a time, in the order made: a sub-idea typed straight after its parent must never reach the server
// before the parent does.
let queue: Promise<unknown> = Promise.resolve();

function send<T>(wid: string, path: string, opts: { method?: string; body?: unknown }): Promise<T> {
  inflight++;
  const run = () =>
    api<T>(path, opts).catch((err) => {
      toast.error(errorMessage(err));
      stale.add(wid);
      throw err;
    });
  const next = queue.then(run, run).finally(() => {
    if (--inflight) return;
    const pages = [...stale];
    stale.clear();
    for (const p of pages) void queryClient.invalidateQueries({ queryKey: p ? keys.ideas(p) : ['ideas'] });
  });
  queue = next.catch(() => {});
  return next;
}

export type NewCard = { parentId: string | null; after?: string | null; title?: string; body?: string; kind?: Extract<IdeaKind, 'idea' | 'series'>; url?: string; by?: 'you' | 'claude' };

/** A new card, shown at once; returns its id (for editing it straight away). */
export function createCard(wid: string, input: NewCard, opts: { undo?: boolean } = {}): string {
  const id = crypto.randomUUID();
  const at = Date.now();
  setNodes(wid, (nodes) => [
    ...nodes,
    {
      id,
      workspaceId: wid,
      parentId: input.parentId,
      position: positionFor(nodes, input.parentId, input.after),
      kind: input.url ? 'link' : (input.kind ?? 'idea'),
      title: input.title ?? '',
      body: input.body ?? '',
      script: '',
      format: '',
      labels: [],
      collapsed: false,
      url: input.url ?? null,
      mediaId: null,
      hasThumb: false,
      pieceId: null,
      piece: null,
      post: null,
      by: input.by ?? 'you',
      assist: null,
      seenAt: null,
      createdAt: at,
      updatedAt: at,
    },
  ]);
  void send(wid, `/workspaces/${wid}/ideas`, { body: { id, ...input } }).then(() => resync(wid), () => {});
  if (opts.undo !== false) pushUndo({ label: 'add', run: () => removeCard(wid, id, { undo: false, quiet: true }) });
  return id;
}

export type CardPatch = Partial<Pick<IdeaNode, 'title' | 'body' | 'script' | 'format' | 'labels' | 'collapsed'>> & { kind?: 'idea' | 'series' };

export function updateCard(wid: string, id: string, patch: CardPatch, opts: { undo?: boolean } = {}) {
  const before = queryClient.getQueryData<IdeaNode[]>(keys.ideas(wid))?.find((n) => n.id === id);
  setNodes(wid, (nodes) => nodes.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n)));
  if (before && opts.undo) {
    const back = Object.fromEntries(Object.keys(patch).map((k) => [k, before[k as keyof CardPatch]])) as CardPatch;
    pushUndo({ label: 'edit', run: () => updateCard(wid, id, back) });
  }
  return send(wid, `/ideas/${id}`, { method: 'PATCH', body: patch });
}

/** Move a card under `parentId` (null: the top level), after `after` (null: first; undefined: the end). */
export function moveCard(wid: string, id: string, parentId: string | null, after?: string | null, opts: { undo?: boolean } = {}) {
  const nodes = queryClient.getQueryData<IdeaNode[]>(keys.ideas(wid)) ?? [];
  const before = nodes.find((n) => n.id === id);
  if (!before) return;
  const prevSib = nodes
    .filter((n) => n.parentId === before.parentId && n.id !== id && n.position < before.position)
    .sort((a, b) => b.position - a.position)[0];
  setNodes(wid, (all) => all.map((n) => (n.id === id ? { ...n, parentId, position: positionFor(all, parentId, after, id) } : n)));
  if (opts.undo !== false) pushUndo({ label: 'move', run: async () => moveCard(wid, id, before.parentId, prevSib?.id ?? null, { undo: false }) });
  return send(wid, `/ideas/${id}`, { method: 'PATCH', body: { parentId, after } }).then(() => resync(wid));
}

export function removeCard(wid: string, id: string, opts: { undo?: boolean; quiet?: boolean } = {}) {
  const nodes = queryClient.getQueryData<IdeaNode[]>(keys.ideas(wid)) ?? [];
  const tree = buildTree(nodes);
  const gone = new Set([id, ...nodes.filter((n) => isInside(tree, n.id, id)).map((n) => n.id)]);
  setNodes(wid, (all) => all.filter((n) => !gone.has(n.id)));
  const restore = () => send(wid, `/ideas/${id}/restore`, { method: 'POST' }).then(() => resync(wid));
  if (opts.undo !== false) pushUndo({ label: 'delete', run: restore });
  const done = send(wid, `/ideas/${id}`, { method: 'DELETE' });
  if (!opts.quiet) {
    const n = tree.byId.get(id);
    const extra = gone.size - 1;
    toast(`Deleted${n && cardTitle(n) ? ` “${cardTitle(n).slice(0, 40)}”` : ''}${extra ? ` and ${extra} under it` : ''}`, { action: { label: 'Undo', onClick: () => void restore() } });
  }
  return done;
}

export async function addChildren(wid: string, parentId: string, items: { title: string; body?: string }[], by: 'you' | 'claude' = 'you') {
  await send(wid, `/ideas/${parentId}/children`, { body: { items: items.map((i) => ({ title: i.title, body: i.body ?? '' })), by } });
  await resync(wid);
}

/** A picture onto a card (or the Saved pile). */
export async function addPicture(wid: string, parentId: string | null, files: File[]) {
  const form = new FormData();
  if (parentId) form.append('parentId', parentId);
  for (const f of files) form.append('file', f, f.name || 'picture.png');
  await send(wid, `/workspaces/${wid}/ideas/image`, { body: form });
  await resync(wid);
}

// ---------- moving with the keyboard ----------

const siblingsOf = (t: Tree, n: IdeaNode) => childrenOf(t, n.parentId && t.byId.has(n.parentId) ? n.parentId : null).filter((c) => c.kind !== 'saved');

/** Under the card above it (Tab on an empty new card, Alt+→). */
export function indentCard(wid: string, t: Tree, id: string) {
  const n = t.byId.get(id);
  if (!n) return false;
  const sibs = siblingsOf(t, n);
  const prev = sibs[sibs.findIndex((s) => s.id === id) - 1];
  if (!prev || prev.kind === 'image') return false;
  if (prev.collapsed) void updateCard(wid, prev.id, { collapsed: false });
  void moveCard(wid, id, prev.id);
  return true;
}

/** Out to its parent's level, just after it (Shift+Tab, Alt+←); never above the card being looked at. */
export function outdentCard(wid: string, t: Tree, id: string, focus: string | null) {
  const n = t.byId.get(id);
  if (!n?.parentId || n.parentId === focus) return false;
  const parent = t.byId.get(n.parentId);
  if (!parent || parent.kind === 'saved') return false;
  void moveCard(wid, id, parent.parentId && t.byId.has(parent.parentId) ? parent.parentId : null, parent.id);
  return true;
}

/** Up or down among its siblings (Alt+↑/↓). */
export function shiftCard(wid: string, t: Tree, id: string, dir: -1 | 1) {
  const n = t.byId.get(id);
  if (!n) return false;
  const sibs = siblingsOf(t, n);
  const i = sibs.findIndex((s) => s.id === id);
  if (dir < 0 ? i <= 0 : i < 0 || i >= sibs.length - 1) return false;
  void moveCard(wid, id, n.parentId, dir < 0 ? (sibs[i - 2]?.id ?? null) : sibs[i + 1].id);
  return true;
}
