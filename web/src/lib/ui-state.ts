import { useSyncExternalStore } from 'react';

/** Tiny global store for UI state that several distant components share. */
export function createStore<T>(initial: T, persistKey?: string) {
  let state = initial;
  if (persistKey) {
    try {
      const raw = localStorage.getItem(persistKey);
      if (raw !== null) state = JSON.parse(raw) as T;
    } catch {
      /* storage unavailable */
    }
  }
  const subs = new Set<() => void>();
  return {
    get: () => state,
    set(next: T | ((prev: T) => T)) {
      state = typeof next === 'function' ? (next as (p: T) => T)(state) : next;
      if (persistKey) {
        try {
          localStorage.setItem(persistKey, JSON.stringify(state));
        } catch {
          /* storage unavailable */
        }
      }
      subs.forEach((s) => s());
    },
    subscribe(cb: () => void) {
      subs.add(cb);
      return () => void subs.delete(cb);
    },
  };
}

export const claudeDesktopOpen = createStore(true, 'cs.claudePanel');
export const claudeMobileOpen = createStore(false);
/** The chat open in the Claude panel, per workspace. */
export const activeThread = createStore<Record<string, string>>({}, 'cs.activeThread');
/** Text to drop into the Claude composer (e.g. "Ask Claude about this clip"). */
export const composerPrefill = createStore<{ text: string; nonce: number } | null>(null);

/** A message for the open video's Claude chat to send right away (a note pinned to a moment). */
export const outgoingMessage = createStore<{ pieceId: string; text: string } | null>(null);

/** Whether the last request reached the server (the Android app shows a banner when it can't). */
export const serverReachable = createStore(true);

export function useStore<T>(store: ReturnType<typeof createStore<T>>) {
  return useSyncExternalStore(store.subscribe, store.get);
}

export function openClaude(prefill?: string) {
  if (window.matchMedia('(min-width: 1024px)').matches) claudeDesktopOpen.set(true);
  else claudeMobileOpen.set(true);
  if (prefill) composerPrefill.set({ text: prefill, nonce: Date.now() });
}

/** Send a note to a video's own chat and show the chat. */
export function sendToVideoChat(pieceId: string, text: string) {
  outgoingMessage.set({ pieceId, text });
  openClaude();
}
