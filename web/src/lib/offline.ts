import { hashKey } from '@tanstack/react-query';
import { normalizeDraft, type DraftContent } from '@shared/types';
import type { BoardData } from '@shared/board';
import { api, ApiError } from './api';
import { carouselQuery, keys, pieceQuery, queryClient, rendersQuery, versionsQuery } from './queries';
import type { PieceDetail } from './types';
import { createStore, serverReachable } from './ui-state';

/*
 * Offline on the phone. The Android app keeps on the phone (IndexedDB) what it needs to open without the computer:
 * the board, every card on it (script, notes, footage), their versions and a carousel's slides, fetched ahead while the computer answers.
 * What I write meanwhile waits in the outbox and goes when the computer is back. Videos play offline once downloaded
 * (lib/downloads.ts).
 */

const DB = 'cs-offline';
const STORE = 'queries';

/** The queries kept: the board, the pages, settings, and each card with its renders and versions. */
const kept = (key: readonly unknown[]) => ['board-all', 'workspaces', 'settings', 'piece', 'renders'].includes(key[0] as string);

let opening: Promise<IDBDatabase> | null = null;
function open() {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return opening;
}

async function store<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

type Entry = { key: readonly unknown[]; data: unknown };

let watching = false;

/** Put back what the phone kept (marked old, so it's fetched again as soon as the computer answers), then keep what comes. */
export async function restoreOffline() {
  // The first app versions kept two queries in localStorage.
  for (const k of ['cs.cache.workspaces', 'cs.cache.settings']) localStorage.removeItem(k);
  try {
    const entries = await store<Entry[]>('readonly', (s) => s.getAll());
    for (const e of entries) if (queryClient.getQueryData(e.key) === undefined) queryClient.setQueryData(e.key, e.data, { updatedAt: 0 });
  } catch (err) {
    console.warn('Couldn’t read the offline copy', err);
  }
  if (watching) return;
  watching = true;
  queryClient.getQueryCache().subscribe((e) => {
    if (e.type !== 'updated' || e.action.type !== 'success' || !kept(e.query.queryKey)) return;
    const key = e.query.queryKey;
    void store('readwrite', (s) => s.put({ key, data: e.query.state.data } satisfies Entry, hashKey(key))).catch(() => {});
    if (key[0] === 'board-all') aheadSoon(e.query.state.data as BoardData);
  });
}

export async function clearOffline() {
  outbox.set({});
  await store('readwrite', (s) => s.clear()).catch(() => {});
}

// ---------- fetching ahead ----------

let aheadTimer: ReturnType<typeof setTimeout> | null = null;
let fetching = false;

/** Once the board settles, fetch every card on it the phone doesn't have fresh (changed ones were marked by live events), and forget cards that left it. */
function aheadSoon(board: BoardData) {
  if (aheadTimer) clearTimeout(aheadTimer);
  aheadTimer = setTimeout(() => void ahead(board), 2000);
}

async function ahead(board: BoardData) {
  if (fetching) return;
  fetching = true;
  try {
    const ids = new Set(board.items.map((i) => i.id));
    const keysKept = await store<IDBValidKey[]>('readonly', (s) => s.getAllKeys());
    for (const k of keysKept) {
      const key = JSON.parse(String(k)) as unknown[];
      if ((key[0] === 'piece' || key[0] === 'renders') && !ids.has(key[1] as string)) await store('readwrite', (s) => s.delete(k));
    }
    // A few at a time, so what I open isn't kept waiting.
    const fresh = { staleTime: 10 * 60_000 };
    const carousels = new Set(board.items.filter((i) => i.slides).map((i) => i.id));
    for (const id of ids) {
      if (!serverReachable.get()) break;
      await Promise.allSettled([
        queryClient.prefetchQuery({ ...pieceQuery(id), ...fresh }),
        queryClient.prefetchQuery({ ...rendersQuery(id), ...fresh }),
        queryClient.prefetchQuery({ ...versionsQuery(id), ...fresh }),
        // A carousel's slides list (the pictures come when it's opened, then from the WebView's cache).
        ...(carousels.has(id) ? [queryClient.prefetchQuery({ ...carouselQuery(id), ...fresh })] : []),
      ]);
    }
  } catch (err) {
    console.warn('Couldn’t fetch the cards ahead', err);
  } finally {
    fetching = false;
  }
}

// ---------- the outbox ----------

/** A draft written while the computer couldn't be reached. `base`: when the computer's copy last changed before I wrote it. */
export type Pending = { branchId: string; pieceId: string; content: DraftContent; base: number | null; at: number };

/** Drafts waiting for the computer, by branch. Kept in localStorage, so they survive the app closing. */
export const outbox = createStore<Record<string, Pending>>({}, 'cs.outbox');

/** Keep a draft that couldn't be saved; it goes when the computer answers. */
export function keepDraft(p: Omit<Pending, 'at'>) {
  outbox.set((o) => ({ ...o, [p.branchId]: { ...p, base: o[p.branchId]?.base ?? p.base, at: Date.now() } }));
}

/** The draft was saved: nothing waits for it any more. */
export function draftSaved(branchId: string) {
  if (!outbox.get()[branchId]) return;
  outbox.set((o) => {
    const next = { ...o };
    delete next[branchId];
    return next;
  });
}

let sending: Promise<void> | null = null;
let again = false;

/**
 * Send what waits. If the computer's copy changed meanwhile (Claude, the laptop), it's saved as a version first, so
 * nothing is lost; then mine goes on top. Called while it runs, it goes round once more.
 */
export function sendOutbox(): Promise<void> {
  if (sending) {
    again = true;
    return sending;
  }
  sending = (async () => {
    do {
      again = false;
      for (const p of Object.values(outbox.get())) {
        try {
          const piece = await api<PieceDetail>(`/pieces/${p.pieceId}`);
          const branch = piece.branches.find((b) => b.id === p.branchId);
          let saved: number | null = null;
          if (branch && JSON.stringify(normalizeDraft(branch.working)) !== JSON.stringify(normalizeDraft(p.content))) {
            if (p.base !== null && branch.workingUpdatedAt !== p.base) await api(`/branches/${p.branchId}/versions`, { body: { message: 'Before the phone’s offline changes' } });
            saved = (await api<{ workingUpdatedAt: number }>(`/branches/${p.branchId}/working`, { method: 'PUT', body: { content: p.content } })).workingUpdatedAt;
          }
          const now = outbox.get()[p.branchId];
          if (now?.at === p.at) draftSaved(p.branchId);
          // Typed while this was on its way: that one goes next, over mine rather than over theirs.
          else if (now && saved !== null) outbox.set((o) => ({ ...o, [p.branchId]: { ...now, base: saved } }));
          void queryClient.invalidateQueries({ queryKey: keys.piece(p.pieceId) });
        } catch (err) {
          // The card or its draft is gone: nothing to save it to.
          if (err instanceof ApiError && err.status === 404) draftSaved(p.branchId);
          else return;
        }
      }
    } while (again && Object.keys(outbox.get()).length);
  })().finally(() => (sending = null));
  return sending;
}

serverReachable.subscribe(() => {
  if (serverReachable.get() && Object.keys(outbox.get()).length) void sendOutbox();
});
