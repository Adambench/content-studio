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

/** Today and Review gather from everything, so most events touch them; renders report progress often, so at most every 2 s. */
const timers = new Map<string, ReturnType<typeof setTimeout>>();
function refreshSoon(key: readonly unknown[]) {
  const id = JSON.stringify(key);
  if (timers.has(id)) return;
  timers.set(
    id,
    setTimeout(() => {
      timers.delete(id);
      queryClient.invalidateQueries({ queryKey: key });
    }, 2000),
  );
}
/** The board: cards move, render, get comments and go out. */
const BOARD_ENTITIES = ['pieces', 'renders', 'media', 'posts', 'notes', 'workspaces', 'edits'];

function apply(event: LiveEvent) {
  const inv = (key: readonly unknown[]) => queryClient.invalidateQueries({ queryKey: key });
  // The review queue: cards moving in or out of Review, their renders, captions and the campaigns' rules.
  if (event.type === 'changed' && ['pieces', 'renders', 'media', 'campaigns', 'accounts', 'posts'].includes(event.entity)) refreshSoon(keys.review);
  if (event.type === 'branch') refreshSoon(keys.review);
  if (event.type === 'changed' && BOARD_ENTITIES.includes(event.entity)) refreshSoon(keys.boardAll);
  if (event.type === 'changed' && event.entity === 'campaigns') inv(['campaign-links']);
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
        inv(['own-measures']);
        inv(event.pieceId ? keys.edit(event.pieceId) : ['edit']);
        // A card's version strip.
        if (event.pieceId) inv([...keys.renders(event.pieceId), 'versions']);
        break;
      case 'renders':
        if (event.pieceId) inv(keys.renders(event.pieceId));
        break;
      case 'settings':
        inv(keys.settings);
        inv(keys.ai);
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
      case 'devices':
        inv(keys.devices);
        inv(keys.status);
        break;
      case 'sites':
        inv(keys.sites);
        break;
      case 'campaigns':
        inv(keys.campaigns);
        inv(event.id ? keys.campaign(event.id) : ['campaign']);
        break;
      case 'compute':
        inv(keys.compute);
        // A worker may host the model server.
        inv(keys.ai);
        break;
      case 'knowledge':
        inv(keys.knowledge);
        break;
      case 'references':
        inv(keys.references);
        // A page's style (written, or out of date after a mark).
        inv(['style']);
        break;
      case 'toolbox':
        inv(keys.toolbox);
        break;
      case 'notes':
        inv(event.pieceId ? keys.notes(event.pieceId) : ['notes']);
        // A card shows whether its video has comments to fix.
        if (wid) inv(keys.board(wid));
        break;
    }
  } else if (event.type === 'notify') {
    // Phones get web push from the server; the desktop app shows a native notification when it isn't in front.
    if (desktop && !document.hasFocus()) void desktop.notify({ title: event.title, body: event.body, url: event.url });
  } else if (event.type === 'job') {
    if (event.status === 'error' && event.jobType === 'media.transcribe') toast.error('Transcription failed', { description: event.message?.slice(0, 160) });
    if (event.status === 'error' && event.jobType === 'video.render') toast.error('Render failed', { description: event.message?.slice(0, 200) });
    if (event.status === 'done' && event.jobType === 'account.connect') toast.success(event.message ?? 'Account connected');
    if (event.status === 'error' && event.jobType === 'campaign.read') toast.error('Couldn’t read the campaign', { description: event.message?.slice(0, 200) });
    if (event.status === 'done' && event.jobType === 'source.pick') toast.success(event.message ?? 'Moments found');
    if (event.status === 'done' && event.jobType === 'edit.reframe') toast.success(event.message ?? 'Reframed', { description: 'Saved as a new version: undo from History.' });
    if (event.status === 'error' && event.jobType === 'edit.reframe') toast.error('Couldn’t follow the speaker', { description: event.message?.slice(0, 200) });
    if (event.status === 'error' && event.jobType === 'clip.make') toast.error('A clip couldn’t be made', { description: event.message?.slice(0, 200) });
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
