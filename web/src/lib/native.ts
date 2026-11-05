import { App } from '@capacitor/app';
import { Capacitor, registerPlugin, WebPlugin, type PluginListenerHandle } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { API_VERSION, appLink, type Health } from '@shared/devices';
import { api, setConnection } from './api';
import { keys, queryClient } from './queries';
import { createStore, serverReachable } from './ui-state';

/*
 * The Android app (mobile/, Capacitor): this UI built with `vite --mode app` and bundled in the APK. It talks to the
 * Content Studio server it paired with (desktop Settings → Phone access → QR code) using a device token, and adds
 * what a PWA can't do well through the native "Studio" plugin (mobile/android/…/StudioPlugin.java): the share sheet,
 * background uploads that survive the app closing, voice memos recorded and queued offline, and a fingerprint lock.
 * Like lib/desktop.ts for the desktop app; everything here is a no-op outside the app build.
 */

/** Built for the Android app (`vite --mode app`). */
export const isApp = import.meta.env.MODE === 'app';
/** Inside the Android app, rather than the app build opened in a browser while developing. */
export const isNative = isApp && Capacitor.isNativePlatform();

export type QueuedFile = { path: string; name: string; mime: string; size: number };
export type UploadItem = {
  id: string;
  kind: 'file' | 'text' | 'saved';
  name: string;
  size: number;
  sent: number;
  state: 'waiting' | 'uploading' | 'done' | 'failed';
  error: string | null;
  workspaceId: string;
  /** The video it's going to (absent from apps before 0.3.1). */
  pieceId?: string | null;
  createdAt: number;
};
export type SharePayload = { id: string; files: QueuedFile[]; text: string | null };
export type FirebaseOptions = { applicationId: string; apiKey: string; projectId: string; gcmSenderId: string; storageBucket?: string };
type UploadTarget = { workspaceId: string; pieceId?: string | null; assetType?: string | null; source: 'upload' | 'capture' | 'share' };

type StudioPlugin = {
  getPairing(): Promise<{ server: string | null; token: string | null }>;
  setPairing(p: { server: string; token: string }): Promise<void>;
  clearPairing(): Promise<void>;
  info(): Promise<{ deviceName: string; appVersion: string }>;
  openUrl(o: { url: string }): Promise<void>;
  /** Google's QR scanner (Play services; downloads itself on first use, needs no camera permission). Null if cancelled. */
  scanQrCode(): Promise<{ value: string | null }>;
  /** Android's settings page for this app (to allow notifications after they were blocked). */
  openAppSettings(): Promise<void>;
  /** Starts Firebase with the options from the server (kept for next launches). `restart`: options changed, takes a restart. */
  configureFirebase(o: { options: FirebaseOptions }): Promise<{ ready: boolean; restart: boolean }>;
  /** What was shared to the app (the share sheet), copied into the app's storage; null when nothing is waiting. */
  getShare(): Promise<{ share: SharePayload | null }>;
  discardShare(o: { id: string }): Promise<void>;
  pickFiles(o: { accept: string[]; camera?: boolean }): Promise<{ files: QueuedFile[] }>;
  enqueueFiles(o: UploadTarget & { files: QueuedFile[] }): Promise<void>;
  listUploads(): Promise<{ uploads: UploadItem[] }>;
  retryUpload(o: { id: string }): Promise<void>;
  removeUpload(o: { id: string }): Promise<void>;
  clearFinished(): Promise<void>;
  canLock(): Promise<{ available: boolean }>;
  unlock(o: { title: string; subtitle?: string }): Promise<{ ok: boolean }>;
  addListener(event: 'share', fn: (s: SharePayload) => void): Promise<PluginListenerHandle>;
  addListener(event: 'uploads', fn: (e: { uploads: UploadItem[] }) => void): Promise<PluginListenerHandle>;
};

/** The app build in a browser: pairing lives in localStorage; the native extras aren't there. */
class StudioWeb extends WebPlugin {
  async getPairing() {
    try {
      return JSON.parse(localStorage.getItem('cs.pairing') ?? '') as { server: string; token: string };
    } catch {
      return { server: null, token: null };
    }
  }
  async setPairing(p: { server: string; token: string }) {
    localStorage.setItem('cs.pairing', JSON.stringify(p));
  }
  async clearPairing() {
    localStorage.removeItem('cs.pairing');
  }
  async info() {
    return { deviceName: 'Browser (app build)', appVersion: __APP_VERSION__ };
  }
  async openUrl({ url }: { url: string }) {
    window.open(url, '_blank', 'noopener');
  }
  async getShare() {
    return { share: null };
  }
  async listUploads() {
    return { uploads: [] };
  }
  async canLock() {
    return { available: false };
  }
}

export const Studio = registerPlugin<StudioPlugin>('Studio', { web: () => new StudioWeb() });

// ---------- pairing and the server ----------

export type PairingState = { server: string; token: string } | null;
/** The server this app is paired with. `undefined` until it's been read from storage. */
export const pairing = createStore<PairingState | undefined>(isApp ? undefined : null);

/**
 * Whether this app and the server speak the same API: `app-old` means update the app, `server-old` means update
 * Content Studio on the computer.
 */
export const compatibility = createStore<{ state: 'ok' | 'app-old' | 'server-old'; server: Health | null }>({ state: 'ok', server: null });

async function fetchHealth(server: string): Promise<Health | null> {
  try {
    const res = await fetch(`${server}/api/health`, { signal: AbortSignal.timeout(8000) });
    const body = (await res.json()) as Health;
    return body?.ok ? body : null;
  } catch {
    return null;
  }
}

let checking: Promise<Health | null> | null = null;

/** Ask the server for its API version, and so whether it's reachable at all (the offline banner). */
export function checkServer() {
  const p = pairing.get();
  if (!p) return Promise.resolve(null);
  checking ??= fetchHealth(p.server)
    .then((health) => {
      if (health) compatibility.set({ state: health.api > API_VERSION ? 'app-old' : health.api < API_VERSION ? 'server-old' : 'ok', server: health });
      if (serverReachable.get() !== !!health) serverReachable.set(!!health);
      return health;
    })
    .finally(() => (checking = null));
  return checking;
}

/** Trade a pairing code for a device token and remember the server. */
export async function pair(server: string, code: string) {
  const health = await fetchHealth(server);
  if (!health) throw new Error(`Couldn’t reach Content Studio at ${server.replace(/^https?:\/\//, '')}. Is it running on your computer, with Tailscale Funnel on?`);
  const { deviceName } = await Studio.info();
  const res = await fetch(`${server}/api/auth/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, name: deviceName }) });
  const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
  if (!res.ok || !body.token) throw new Error(body.error ?? `Pairing failed (${res.status}).`);
  await Studio.setPairing({ server, token: body.token });
  queryClient.clear();
  clearOfflineCache();
  restoreOfflineCache();
  setConnection(server, body.token);
  pairing.set({ server, token: body.token });
  compatibility.set({ state: health.api > API_VERSION ? 'app-old' : health.api < API_VERSION ? 'server-old' : 'ok', server: health });
  void syncPush({ ask: true });
}

/** Forget the server. `revoked`: the server already dropped this device, so don't tell it. */
export async function unpair({ revoked = false } = {}) {
  if (!revoked) {
    await disablePush().catch(() => {});
    await api('/auth/logout', { body: {} }).catch(() => {});
  }
  await Studio.clearPairing();
  setConnection('', null);
  pairing.set(null);
  queryClient.clear();
  clearOfflineCache();
}

// ---------- notifications (FCM) ----------

export type PushState = 'checking' | 'unavailable' | 'off' | 'denied' | 'on' | 'restart' | 'failed';
export const pushState = createStore<PushState>('checking');
const PUSH_TOKEN_KEY = 'cs.fcmToken';

/**
 * Turn on notifications if the computer has Firebase set up (Settings → Notifications there): start Firebase with
 * its options, ask for permission (only if `ask`), and register; the token goes to the server when it arrives.
 */
export async function syncPush({ ask }: { ask: boolean }): Promise<PushState> {
  if (!isNative) return 'unavailable';
  const set = (s: PushState) => (pushState.set(s), s);
  try {
    const { firebase } = await api<{ firebase: FirebaseOptions | null }>('/push/app-config');
    if (!firebase) return set('unavailable');
    const { ready } = await Studio.configureFirebase({ options: firebase });
    if (!ready) return set('restart');
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive !== 'granted' && ask) perm = await PushNotifications.requestPermissions();
    if (perm.receive !== 'granted') return set(perm.receive === 'denied' ? 'denied' : 'off');
    await PushNotifications.createChannel({ id: 'alerts', name: 'Alerts', description: 'Posts going live or failing, renders, ideas captured', importance: 4 });
    await PushNotifications.register();
    return set('on');
  } catch (err) {
    console.warn('Push setup failed', err);
    return set('off');
  }
}

export async function disablePush() {
  if (!isNative) return;
  const token = localStorage.getItem(PUSH_TOKEN_KEY);
  if (token) await api('/push/unsubscribe', { body: { token } });
  localStorage.removeItem(PUSH_TOKEN_KEY);
  await PushNotifications.unregister().catch(() => {});
  pushState.set('off');
}

// ---------- share sheet, uploads ----------

/** Something shared to the app, waiting for a workspace to go to. */
export const pendingShare = createStore<SharePayload | null>(null);
export const uploads = createStore<UploadItem[]>([]);
/** Where the app wants to go: a push notification's link, a launcher shortcut, a share. AuthGate follows it. */
export const nativeRoute = createStore<{ path: string; at: number } | null>(null);
/** A pairing link opened from outside (scanned with the camera app), for the pairing screen. */
export const pendingPairLink = createStore<string | null>(null);
/** Why the pairing screen is showing (the computer unpaired this phone). */
export const unpairedReason = createStore<string | null>(null);

const goTo = (path: string) => nativeRoute.set({ path, at: Date.now() });

function receiveShare(share: SharePayload | null) {
  if (!share) return;
  pendingShare.set(share);
  goTo('/share');
}

/** Pick files with Android's picker and upload them in the background. */
export async function pickAndUpload(target: Omit<UploadTarget, 'source'>, accept: string[], camera = false) {
  const { files } = await Studio.pickFiles({ accept, camera });
  if (files.length) await Studio.enqueueFiles({ ...target, source: 'upload', files });
  return files.length;
}

// ---------- fingerprint lock ----------

export const lockEnabled = createStore(false, 'cs.lock');
export const locked = createStore(false);
// Locks again after this long in the background.
const LOCK_AFTER_MS = 60_000;

export const openExternal = (url: string) => (isNative ? Studio.openUrl({ url }) : void window.open(url, '_blank', 'noopener'));

// ---------- start-up ----------

// Kept on the phone so capture and the share sheet can pick a workspace while the computer is out of reach.
const OFFLINE_QUERIES = [keys.workspaces, keys.settings];
const cacheKey = (key: readonly unknown[]) => `cs.cache.${key.join('.')}`;

let persisting = false;

function restoreOfflineCache() {
  for (const key of OFFLINE_QUERIES) {
    try {
      const raw = localStorage.getItem(cacheKey(key));
      // Marked as old, so it's refetched as soon as the computer answers.
      if (raw) queryClient.setQueryData(key, JSON.parse(raw), { updatedAt: 0 });
    } catch {
      /* ignore */
    }
  }
  if (persisting) return;
  persisting = true;
  queryClient.getQueryCache().subscribe((e) => {
    if (e.type !== 'updated' || e.action.type !== 'success') return;
    const key = OFFLINE_QUERIES.find((k) => cacheKey(k) === cacheKey(e.query.queryKey));
    if (key) localStorage.setItem(cacheKey(key), JSON.stringify(e.query.state.data));
  });
}

const clearOfflineCache = () => OFFLINE_QUERIES.forEach((k) => localStorage.removeItem(cacheKey(k)));

/** Runs once before the UI renders in the app build. */
export async function startApp() {
  if (!isApp) return;
  const stored = await Studio.getPairing().catch(() => ({ server: null, token: null }));
  if (stored.server && stored.token) {
    setConnection(stored.server, stored.token);
    pairing.set({ server: stored.server, token: stored.token });
    restoreOfflineCache();
    if (lockEnabled.get()) locked.set(true);
    void checkServer();
  } else pairing.set(null);
  if (!isNative) return;

  // Launcher shortcuts and pairing links arrive as contentstudio:// links.
  const openLink = (url: string) => {
    const link = appLink(url);
    if (link?.target === 'pair') pendingPairLink.set(url);
    else if (link?.target === 'capture') goTo(link.params.has('record') ? '/capture?record=1' : '/capture');
    // The "Saved to …" notification: the card, or its move menu.
    else if (link?.target === 'open' && link.params.get('path')?.startsWith('/')) goTo(link.params.get('path')!);
  };
  const launch = await App.getLaunchUrl();
  if (launch?.url) openLink(launch.url);
  void App.addListener('appUrlOpen', ({ url }) => openLink(url));

  // Android's back button: close a dialog if one's open, else go back, else leave the app.
  void App.addListener('backButton', ({ canGoBack }) => {
    if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [data-radix-popper-content-wrapper]')) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return;
    }
    if (canGoBack) window.history.back();
    else void App.minimizeApp();
  });

  let pausedAt = 0;
  void App.addListener('pause', () => (pausedAt = Date.now()));
  void App.addListener('resume', () => {
    if (lockEnabled.get() && pairing.get() && pausedAt && Date.now() - pausedAt > LOCK_AFTER_MS) locked.set(true);
    void checkServer();
    queryClient.invalidateQueries();
  });

  void PushNotifications.addListener('registration', ({ value }) => {
    localStorage.setItem(PUSH_TOKEN_KEY, value);
    void api('/push/subscribe', { body: { kind: 'fcm', token: value } }).catch((err) => console.warn('Couldn’t register for notifications', err));
  });
  void PushNotifications.addListener('registrationError', ({ error }) => {
    console.warn('FCM registration failed:', error);
    pushState.set('failed');
  });
  // Tapping a notification opens what it's about.
  void PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
    const url = (notification.data as { url?: string } | undefined)?.url;
    if (url?.startsWith('/')) goTo(url);
  });
  if (pairing.get()) void syncPush({ ask: false });

  void Studio.addListener('share', receiveShare);
  receiveShare((await Studio.getShare().catch(() => ({ share: null }))).share);
  void Studio.addListener('uploads', (e) => uploads.set(e.uploads));
  uploads.set((await Studio.listUploads().catch(() => ({ uploads: [] }))).uploads);
}
