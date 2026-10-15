import { useEffect } from 'react';
import { toast } from 'sonner';
import type { LiveEvent } from '@shared/types';
import { fileUrl } from './api';
import { desktop } from './desktop';
import { checkServer, isApp } from './native';
import { keys, queryClient } from './queries';
import { serverReachable } from './ui-state';

type Listener = (event: LiveEvent) => void;
const listeners = new Set<Listener>();

/** Subscribe to raw live events (e.g. the editor watching its branch). */
export function onLiveEvent(listener: Listener) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Today gathers from everything, so most events touch it; renders report progress often, so at most every 2 s. */
let todayTimer: ReturnType<typeof setTimeout> | null = null;
function refreshToday() {
  if (todayTimer) return;
  todayTimer = setTimeout(() => {
    todayTimer = null;
    queryClient.invalidateQueries({ queryKey: keys.today });
  }, 2000);
}

function apply(event: LiveEvent) {
  const inv = (key: readonly unknown[]) => queryClient.invalidateQueries({ queryKey: key });
  if (event.type === 'changed' || event.type === 'job') refreshToday();
  if (event.type === 'changed') {
    const wid = event.workspaceId;
    switch (event.entity) {
      case 'workspaces':
        inv(keys.workspaces);
        if (wid) inv(keys.workspace(wid));
        break;
      case 'pieces':
        if (wid) {
          inv(keys.board(wid));
          inv(keys.tags(wid));
        }
        if (event.id) inv(keys.piece(event.id));
        inv(keys.workspaces);
        break;
      case 'media':
        if (wid) inv(['media', wid]);
        if (event.id) inv(keys.mediaItem(event.id));
        // Edits list their files (and whether preview copies are ready).
        inv(['edit']);
        break;
      case 'edits':
        inv(event.pieceId ? keys.edit(event.pieceId) : ['edit']);
        break;
      case 'renders':
        if (event.pieceId) inv(keys.renders(event.pieceId));
        break;
      case 'threads':
        if (wid) inv(keys.threads(wid));
        if (event.id) inv(keys.messages(event.id));
        break;
      case 'settings':
        inv(keys.settings);
        inv(keys.status);
        inv(keys.publishingSetup);
        inv(keys.fcm);
        break;
      case 'accounts':
        if (wid) inv(keys.accounts(wid));
        break;
      case 'posts':
        if (wid) inv(['posts', wid]);
        if (event.pieceId) inv(keys.piecePosts(event.pieceId));
        else inv(['piece-posts']);
        inv(event.id ? keys.post(event.id) : ['post']);
        // Board cards show when a piece is scheduled.
        if (wid) inv(keys.board(wid));
        break;
      case 'stats':
        // New numbers: the analytics page, posts (which carry their latest numbers) and board cards (views).
        if (wid) {
          inv(['analytics', wid]);
          inv(['posts', wid]);
          inv(keys.board(wid));
        }
        inv(['post-stats']);
        inv(['piece-posts']);
        inv(['post']);
        break;
      case 'reviews':
        if (wid) inv(keys.reviews(wid));
        break;
      case 'devices':
        inv(keys.devices);
        inv(keys.status);
        break;
      case 'sites':
        inv(keys.sites);
        break;
    }
  } else if (event.type === 'notify') {
    // Phones get web push from the server; the desktop app shows a native notification when it isn't in front.
    if (desktop && !document.hasFocus()) void desktop.notify({ title: event.title, body: event.body, url: event.url });
  } else if (event.type === 'job') {
    if (event.status === 'done' && event.jobType === 'voice.learn') toast.success(event.message ?? 'Voice memory updated');
    if (event.status === 'error' && event.jobType === 'media.transcribe') toast.error('Transcription failed', { description: event.message?.slice(0, 160) });
    if (event.status === 'error' && event.jobType === 'capture.structure') toast.warning('Idea saved as a raw note', { description: 'Claude was unavailable, so it wasn’t tidied up.' });
    if (event.status === 'error' && event.jobType === 'video.render') toast.error('Render failed', { description: event.message?.slice(0, 200) });
    if (event.status === 'done' && event.jobType === 'account.connect') toast.success(event.message ?? 'Account connected');
    if (event.status === 'done' && event.jobType === 'stats.sync') toast.success('Stats are up to date');
    if (event.status === 'done' && event.jobType === 'analytics.review') toast.success('Claude’s review is ready', { description: event.message?.slice(0, 160) });
    if (event.status === 'error' && event.jobType === 'analytics.review') toast.error('The review didn’t finish', { description: event.message?.slice(0, 200) });
  }
  for (const l of listeners) l(event);
}

/** One EventSource per tab; reconnects on its own and refreshes everything after a gap. */
export function useLiveEvents(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    let source: EventSource | null = null;
    let wasDown = false;
    const connect = () => {
      source = new EventSource(fileUrl('/events'));
      source.onopen = () => {
        if (wasDown) queryClient.invalidateQueries();
        wasDown = false;
        if (!serverReachable.get()) serverReachable.set(true);
      };
      source.onerror = () => {
        wasDown = true;
        // The app shows when the computer can't be reached; the stream dropping is the first sign.
        if (isApp) void checkServer();
      };
      source.onmessage = (e) => {
        try {
          apply(JSON.parse(e.data) as LiveEvent);
        } catch {
          /* ignore malformed */
        }
      };
    };
    connect();
    return () => source?.close();
  }, [enabled]);
}
