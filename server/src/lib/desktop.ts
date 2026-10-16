// The desktop bridge, server side: the desktop app spawns us with an IPC channel and reads pages for us in its
// signed-in windows (desktop/src/sites.ts). Outside the desktop app (`npm run dev`, `dev:web`) there's no channel,
// and these say so.
import { SITE_IDS, type BridgeErrorCode, type BridgeReply, type BridgeRequest, type PageRead, type ReadOptions, type SiteId, type SitesStatus } from '../../../shared/sites';
import { emit } from './events';
import { HttpError } from './http';

export const NEEDS_DESKTOP = 'This needs the Content Studio desktop app: sign-in windows and page reading run inside it.';

/** True when the desktop app started this server with the bridge. */
export const desktopAvailable = () => !!process.env.CS_DESKTOP_BRIDGE && typeof process.send === 'function' && !!process.connected;

type Pending = { resolve: (value: unknown) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> };
const pending = new Map<number, Pending>();
let nextId = 1;
let listening = false;

const STATUS_FOR: Record<BridgeErrorCode, number> = { cap: 429, 'bad-request': 400, failed: 502 };

function listen() {
  if (listening) return;
  listening = true;
  process.on('message', (msg: unknown) => {
    if (!msg || typeof msg !== 'object') return;
    if ('event' in msg) {
      if (msg.event === 'sites') emit({ type: 'changed', entity: 'sites' });
      return;
    }
    const reply = msg as BridgeReply;
    const p = pending.get(reply.id);
    if (!p) return;
    pending.delete(reply.id);
    clearTimeout(p.timer);
    if (reply.ok) p.resolve(reply.result);
    else p.reject(new HttpError(STATUS_FOR[reply.code] ?? 502, reply.error));
  });
  process.on('disconnect', () => {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new HttpError(503, 'The desktop app went away before it answered.'));
    }
    pending.clear();
  });
}

function call<T>(request: BridgeRequest, timeoutMs: number): Promise<T> {
  if (!desktopAvailable()) return Promise.reject(new HttpError(409, NEEDS_DESKTOP));
  listen();
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new HttpError(504, 'The desktop app didn’t answer in time.'));
    }, timeoutMs);
    pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
    process.send!({ id, ...request }, (err: Error | null) => {
      if (!err) return;
      clearTimeout(timer);
      pending.delete(id);
      reject(new HttpError(503, `Couldn’t reach the desktop app: ${err.message}`));
    });
  });
}

/**
 * Read a page in the user's signed-in session: its title, visible text and links, after it settles and (optionally)
 * scrolls. Pages are read one at a time, at least 5 s apart, within a daily cap, so this can wait in line.
 * `loginWall` is set when the page sent us to the site's sign-in instead.
 */
export function readPage(url: string, opts: ReadOptions = {}) {
  // Settings shows how many reads are left today.
  return call<PageRead>({ op: 'read', url, ...opts }, 15 * 60_000).finally(() => emit({ type: 'changed', entity: 'sites' }));
}

/** Open (or bring forward) a window on the site's sign-in page, on the computer. */
export function openSignIn(site: SiteId) {
  return call<{ ok: true }>({ op: 'signin', site }, 30_000);
}

/** Open one of the sites' pages in a visible signed-in window on the computer (I act there; the app doesn't). */
export function openSitePage(url: string) {
  return call<{ ok: true }>({ op: 'open', url }, 30_000);
}

/** Sign out of a site: clears everything it stored in the signed-in session. */
export function signOutSite(site: SiteId) {
  return call<{ ok: true }>({ op: 'signout', site }, 30_000);
}

export async function sitesStatus(): Promise<SitesStatus> {
  if (!desktopAvailable()) return { available: false, sites: SITE_IDS.map((id) => ({ id, signedIn: false, windowOpen: false })), reads: { today: 0, cap: 0 } };
  return { available: true, ...(await call<Omit<SitesStatus, 'available'>>({ op: 'status' }, 30_000)) };
}
