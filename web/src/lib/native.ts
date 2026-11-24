// The Android app's side: which server the phone is paired with (and its token), files shared to the app, the
// background upload queue and downloads, through the app's own plugin (StudioPlugin.java). In a browser all of this
// is a no-op.

import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { isApp, setConnection } from './api';

export type QueuedFile = { path: string; name: string; mime: string; size: number };
export type Share = { id: string; files: QueuedFile[]; text: string | null };
export type UploadItem = { id: string; kind: string; name: string; size: number; sent: number; state: 'waiting' | 'uploading' | 'done' | 'failed'; error: string | null; pieceId?: string | null; createdAt: number };

// The plugin still says workspace and piece (the old app's words) for page and card; the server takes both.
type Target = { workspaceId: string; pieceId: string; source: 'upload' | 'share' };

type StudioPlugin = {
  getPairing(): Promise<{ server: string | null; token: string | null }>;
  setPairing(v: { server: string; token: string }): Promise<void>;
  clearPairing(): Promise<void>;
  scanQrCode(): Promise<{ text: string | null }>;
  getShare(): Promise<{ share: Share | null }>;
  discardShare(v: { id: string }): Promise<void>;
  pickFiles(v: { accept: string[]; camera?: boolean }): Promise<{ files: QueuedFile[] }>;
  enqueueFiles(v: Target & { files: QueuedFile[] }): Promise<void>;
  listUploads(): Promise<{ uploads: UploadItem[] }>;
  download(v: { mediaId: string; name: string }): Promise<void>;
  addListener(event: 'share', fn: (s: Share) => void): Promise<PluginListenerHandle>;
  addListener(event: 'uploads', fn: (e: { uploads: UploadItem[] }) => void): Promise<PluginListenerHandle>;
};

export const isNative = isApp && Capacitor.isNativePlatform();
export const Studio = isNative ? registerPlugin<StudioPlugin>('Studio') : null;

/** Before the first render: in the app, the paired server and token become the API's connection. */
export async function connectNative() {
  if (!Studio) return;
  const p = await Studio.getPairing().catch(() => ({ server: null, token: null }));
  if (p.server) setConnection({ server: p.server, token: p.token });
}

/** Pair with the code shown on the laptop (Settings → Phone): the QR holds "<server>#<code>". */
export async function pairWith(server: string, code: string) {
  const base = server.trim().replace(/\/$/, '');
  const res = await fetch(`${base}/api/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: code.trim(), name: 'Phone' }) });
  const data = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
  if (!res.ok || !data.token) throw new Error(data.error ?? 'Pairing failed');
  await Studio?.setPairing({ server: base, token: data.token });
  setConnection({ server: base, token: data.token });
}

/** Files from the phone (gallery or camera) to a card, through the background queue: it goes on with the app closed. */
export async function pickToCard(card: { id: string; pageId: string }) {
  if (!Studio) return 0;
  const { files } = await Studio.pickFiles({ accept: ['video/*', 'image/*', 'audio/*'] });
  if (files.length) await Studio.enqueueFiles({ workspaceId: card.pageId, pieceId: card.id, source: 'upload', files });
  return files.length;
}

export async function sendShare(share: Share, card: { id: string; pageId: string }) {
  if (!Studio) return;
  if (share.files.length) await Studio.enqueueFiles({ workspaceId: card.pageId, pieceId: card.id, source: 'share', files: share.files });
  await Studio.discardShare({ id: share.id });
}
