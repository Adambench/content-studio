// Signed-in windows: Whop, Vyro, TikTok and Instagram in the user's own sessions, in a browser session of their own
// ("persist:sites", apart from the app's). The server asks for pages through the bridge in main.ts; reads are slow on
// purpose — one page at a time, at least 5 s apart, with a daily cap — and never click, post or submit anything.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BrowserWindow, session, type Cookie, type Session, type WebContents } from 'electron';
import { loginWallAt, SITE_IDS, SITES, siteOfHost, type BridgeErrorCode, type BridgeRequest, type PageRead, type SiteId, type SitesStatus } from '../../shared/sites';

const PARTITION = 'persist:sites';
const GAP_MS = 5000;
const DAILY_CAP = Math.max(1, Number(process.env.CS_SITES_DAILY_CAP) || 200);
const LOAD_TIMEOUT_MS = 45_000;

export class SiteError extends Error {
  constructor(
    message: string,
    public code: BridgeErrorCode = 'failed',
  ) {
    super(message);
  }
}

let opts: { dataDir: string; iconPath: string; onChange: () => void };
let ses: Session | null = null;
const signInWindows = new Map<SiteId, BrowserWindow>();

export function initSites(options: typeof opts) {
  opts = options;
}

export async function handleSiteRequest(req: BridgeRequest) {
  switch (req?.op) {
    case 'read':
      return readPage(req.url, req.waitFor, req.scrolls);
    case 'signin':
      return openSignIn(siteId(req.site));
    case 'open':
      return openPage(req.url);
    case 'signout':
      return signOut(siteId(req.site));
    case 'status':
      return status();
    default:
      throw new SiteError('Unknown request', 'bad-request');
  }
}

function siteId(site: unknown): SiteId {
  if (!SITE_IDS.includes(site as SiteId)) throw new SiteError(`Unknown site “${String(site)}”`, 'bad-request');
  return site as SiteId;
}

function sitesSession() {
  if (ses) return ses;
  ses = session.fromPartition(PARTITION);
  // A plain Chrome user agent: some sites turn away sign-ins from a browser that calls itself an embedded app.
  ses.setUserAgent(`Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome.split('.')[0]}.0.0.0 Safari/537.36`);
  // No camera, microphone, notifications or downloads for these sites.
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.on('will-download', (e) => e.preventDefault());
  // Settings shows the change as soon as a sign-in (or its expiry) lands.
  ses.cookies.on('changed', (_e, cookie) => {
    const site = siteOfHost(cookie.domain ?? '');
    if (site && isSessionCookie(site, cookie)) changed();
  });
  return ses;
}

let changeTimer: ReturnType<typeof setTimeout> | null = null;
function changed() {
  if (changeTimer) clearTimeout(changeTimer);
  changeTimer = setTimeout(() => {
    changeTimer = null;
    opts.onChange();
  }, 500);
}

const isSessionCookie = (site: SiteId, c: Cookie) => (c.httpOnly || !!SITES[site].scriptCookie) && SITES[site].sessionCookie.test(c.name);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- reading pages ----------

type Counter = { day: string; reads: number };
const counterFile = () => join(opts.dataDir, 'site-reads.json');
const today = () => new Date().toLocaleDateString('sv'); // YYYY-MM-DD, local

function readCounter(): Counter {
  try {
    const c = JSON.parse(readFileSync(counterFile(), 'utf8')) as Counter;
    if (c.day === today() && Number.isFinite(c.reads)) return c;
  } catch {
    /* none yet */
  }
  return { day: today(), reads: 0 };
}

let queue: Promise<unknown> = Promise.resolve();
let lastDone = 0;

/** One page at a time, at least GAP_MS after the previous one finished, within the daily cap. */
function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const counter = readCounter();
    if (counter.reads >= DAILY_CAP) throw new SiteError(`The daily limit of ${DAILY_CAP} page reads is used up; it resets at midnight.`, 'cap');
    const wait = lastDone + GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    writeFileSync(counterFile(), JSON.stringify({ day: counter.day, reads: counter.reads + 1 }));
    try {
      return await fn();
    } finally {
      lastDone = Date.now();
    }
  });
  queue = run.catch(() => {});
  return run;
}

function readPage(url: unknown, waitFor: unknown, scrolls: unknown): Promise<PageRead> {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) throw new SiteError('Give a web address (https://…)', 'bad-request');
  try {
    new URL(url);
  } catch {
    throw new SiteError('That isn’t a valid web address', 'bad-request');
  }
  const screens = Math.max(0, Math.min(20, Math.floor(Number(scrolls) || 0)));
  return throttled(() => read(url, typeof waitFor === 'string' || typeof waitFor === 'number' ? waitFor : undefined, screens));
}

async function read(url: string, waitFor: string | number | undefined, scrolls: number): Promise<PageRead> {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 1600,
    webPreferences: {
      partition: PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Hidden windows still lay out, run timers and load what scrolls into view.
      backgroundThrottling: false,
      autoplayPolicy: 'user-gesture-required',
      spellcheck: false,
    },
  });
  const wc = win.webContents;
  // Never a sound from these pages (TikTok and Instagram autoplay video, often with music).
  wc.setAudioMuted(true);
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-prevent-unload', (e) => e.preventDefault());
  try {
    await withTimeout(load(wc, url), LOAD_TIMEOUT_MS, 'The page took too long to load.');
    await settle(wc, 12_000);
    if (typeof waitFor === 'string' && waitFor.trim()) await waitForSelector(wc, waitFor, 15_000);
    else if (typeof waitFor === 'number' && waitFor > 0) await sleep(Math.min(waitFor, 20_000));
    for (let i = 0; i < scrolls; i++) {
      await wc.executeJavaScript(SCROLL_JS);
      await sleep(700);
      await settle(wc, 5000);
    }
    const page = (await wc.executeJavaScript(EXTRACT_JS)) as Omit<PageRead, 'loginWall'>;
    return { ...page, loginWall: loginWallAt(page.url) };
  } finally {
    win.destroy();
  }
}

async function load(wc: WebContents, url: string) {
  try {
    await wc.loadURL(url);
  } catch (err) {
    // ERR_ABORTED: the page sent itself somewhere else while loading. What it landed on is still readable.
    const landed = wc.getURL();
    if (!/ERR_ABORTED/.test((err as Error).message) || !landed || landed === 'about:blank') {
      const reason = /ERR_[A-Z_]+/.exec((err as Error).message)?.[0] ?? (err as Error).message;
      throw new SiteError(`Couldn’t open ${url} (${reason}).`);
    }
  }
  if (wc.isLoading()) await new Promise<void>((resolve) => wc.once('did-stop-loading', () => resolve()));
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string) {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([promise, new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new SiteError(message)), ms)))]).finally(() => clearTimeout(timer));
}

/** Wait until the page's text stops changing (apps render after `load`), at most `maxMs`. */
async function settle(wc: WebContents, maxMs: number) {
  const until = Date.now() + maxMs;
  let last = -1;
  let stable = 0;
  await sleep(600);
  while (Date.now() < until) {
    const length = (await wc.executeJavaScript('document.readyState === "complete" && document.body ? document.body.innerText.length : -1').catch(() => -1)) as number;
    stable = length > 0 && length === last ? stable + 1 : 0;
    if (stable >= 2) return;
    last = length;
    await sleep(500);
  }
}

async function waitForSelector(wc: WebContents, selector: string, maxMs: number) {
  const until = Date.now() + maxMs;
  const check = `(() => { try { return !!document.querySelector(${JSON.stringify(selector)}); } catch { return true; } })()`;
  while (Date.now() < until) {
    if (await wc.executeJavaScript(check).catch(() => false)) return;
    await sleep(400);
  }
}

// Scrolls the window and the biggest scrolling box (apps often scroll an inner panel instead of the page).
const SCROLL_JS = `(() => {
  const boxes = [...document.querySelectorAll('body *')].filter((el) => el.scrollHeight > el.clientHeight + 40 && el.clientHeight > 200 && /(auto|scroll)/.test(getComputedStyle(el).overflowY));
  boxes.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight);
  if (boxes[0]) boxes[0].scrollBy(0, boxes[0].clientHeight * 0.9);
  window.scrollBy(0, window.innerHeight * 0.9);
})()`;

const EXTRACT_JS = `(() => {
  const clean = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const text = (document.body ? document.body.innerText : '').replace(/[ \\t]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
  const seen = new Set();
  const links = [];
  for (const a of document.querySelectorAll('a[href]')) {
    const href = a.href;
    if (!/^https?:/.test(href) || seen.has(href)) continue;
    seen.add(href);
    const alt = clean(a.querySelector('img[alt]')?.getAttribute('alt')).slice(0, 300);
    links.push({ href, text: clean(a.innerText || a.getAttribute('aria-label') || a.title).slice(0, 200), ...(alt && { alt }) });
    if (links.length >= 1000) break;
  }
  return { url: location.href, title: document.title, text: text.slice(0, 300000), links };
})()`;

// ---------- signing in and out ----------

function openSignIn(site: SiteId) {
  return openWindow(site, SITES[site].signInUrl, `Sign in to ${SITES[site].label}`, false);
}

/** One of the sites' pages in a visible signed-in window, for me to act on (the app itself never clicks there). */
function openPage(url: unknown) {
  let u: URL;
  try {
    u = new URL(String(url));
  } catch {
    throw new SiteError('That isn’t a valid web address', 'bad-request');
  }
  const site = siteOfHost(u.hostname);
  if (u.protocol !== 'https:' || !site) throw new SiteError('Only Content Rewards, Whop, Vyro, TikTok and Instagram pages open here.', 'bad-request');
  return openWindow(site, u.toString(), /(^|\.)contentrewards\.com$/.test(u.hostname) ? 'Content Rewards' : SITES[site].label, true);
}

/** Bring the site's window forward (going to `url` when asked), or open one. */
function openWindow(site: SiteId, url: string, title: string, navigate: boolean) {
  const existing = signInWindows.get(site);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore();
    if (navigate) void existing.loadURL(url).catch(() => {});
    existing.show();
    existing.focus();
    return { ok: true };
  }
  const webPreferences = { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, autoplayPolicy: 'user-gesture-required' as const };
  const win = new BrowserWindow({
    width: 1100,
    height: 860,
    title: `${title} · Content Studio`,
    icon: opts.iconPath,
    autoHideMenuBar: true,
    webPreferences,
  });
  const wc = win.webContents;
  wc.setAudioMuted(true);
  // Sign-in pop-ups ("Continue with Google") stay in the same session, also muted.
  wc.setWindowOpenHandler(({ url }) => (/^https?:/.test(url) ? { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, icon: opts.iconPath, webPreferences } } : { action: 'deny' }));
  wc.on('did-create-window', (child) => child.webContents.setAudioMuted(true));
  // Keep our title, so it's clear this window belongs to Content Studio.
  win.on('page-title-updated', (e) => e.preventDefault());
  win.on('closed', () => {
    signInWindows.delete(site);
    changed();
  });
  signInWindows.set(site, win);
  sitesSession();
  void win.loadURL(url).catch(() => {
    /* the window shows Chromium's own error page */
  });
  changed();
  return { ok: true };
}

const origins = (site: SiteId) => [...SITES[site].domains.flatMap((d) => [`https://${d}`, `https://www.${d}`]), ...(SITES[site].appOrigins ?? [])];
const cookieUrl = (c: Cookie) => `${c.secure ? 'https' : 'http'}://${(c.domain ?? '').replace(/^\./, '')}${c.path ?? '/'}`;

/**
 * The cookies a site's pages get. Asked per address: listing every cookie (`get({})`) waits for the whole cookie
 * database to load, which can take 20 s, while one site's load at once.
 */
async function siteCookies(site: SiteId) {
  const lists = await Promise.all(origins(site).map((url) => sitesSession().cookies.get({ url })));
  const seen = new Set<string>();
  return lists.flat().filter((c) => {
    const key = `${c.domain}|${c.path}|${c.name}`;
    return !seen.has(key) && !!seen.add(key);
  });
}

/** Clear everything the site stored: cookies (for its whole domain), local storage, caches, service workers. */
async function signOut(site: SiteId) {
  const win = signInWindows.get(site);
  if (win && !win.isDestroyed()) win.destroy();
  const s = sitesSession();
  await s.clearData({ origins: origins(site) });
  for (const c of await siteCookies(site)) await s.cookies.remove(cookieUrl(c), c.name);
  await s.cookies.flushStore();
  changed();
  return { ok: true };
}

async function status(): Promise<Omit<SitesStatus, 'available'>> {
  const now = Date.now() / 1000;
  const signedIn = await Promise.all(
    SITE_IDS.map(async (id) => (await siteCookies(id)).some((c) => isSessionCookie(id, c) && (!c.expirationDate || c.expirationDate > now))),
  );
  return {
    sites: SITE_IDS.map((id, i) => ({ id, signedIn: signedIn[i], windowOpen: !!signInWindows.get(id) && !signInWindows.get(id)!.isDestroyed() })),
    reads: { today: readCounter().reads, cap: DAILY_CAP },
  };
}
