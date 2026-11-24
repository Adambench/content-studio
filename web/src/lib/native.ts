// The Android app's side: which server the phone is paired with (and its token), files shared to the app, and the
// background upload queue, through the app's own plugin (StudioPlugin.java). In the browser all of this is a no-op.

import { registerPlugin } from '@capacitor/core';
import { isApp, setConnection } from './api';

type Pairing = { server: string | null; token: string | null };
type SharedFile = { path: string; name: string; mime: string; size: number };
export type Share = { id: string; files: SharedFile[]; text: string | null };
export type QueuedUpload = { id: string; name: string; size: number; sent: number; state: string; error?: string };

type StudioPlugin = {
  getPairing(): Promise<Pairing>;
  setPairing(v: { server: string; token: string }): Promise<void>;
  clearPairing(): Promise<void>;
  scanQrCode(): Promise<{ text: string }>;
  getShare(): Promise<{ share: Share | null }>;
  discardShare(v: { id: string }): Promise<void>;
  enqueueFiles(v: { items: { path?: string; uri?: string; name: string; mime: string; size: number; pieceId: string; workspaceId: string; source: string }[] }): Promise<void>;
  listUploads(): Promise<{ items: QueuedUpload[] }>;
  download(v: { url: string; name: string; mime: string }): Promise<void>;
  addListener(event: 'share', fn: (share: Share) => void): Promise<{ remove: () => void }>;
};

export const Studio = isApp ? registerPlugin<StudioPlugin>('Studio') : null;

export let paired = !isApp;

/** Before the first render: in the app, the paired server and token become the API's connection. */
export async function connectNative() {
  if (!Studio) return;
  const p = await Studio.getPairing().catch(() => ({ server: null, token: null }));
  if (p.server) {
    setConnection({ server: p.server, token: p.token });
    paired = true;
  }
}

/** Pair from the code shown on the laptop (Settings → Phone): "<server>#<code>" in the QR, or typed. */
export async function pairWith(server: string, code: string) {
  const res = await fetch(`${server.replace(/\/$/, '')}/api/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, name: 'Phone' }) });
  const data = (await res.json()) as { token?: string; error?: string };
  if (!res.ok || !data.token) throw new Error(data.error ?? 'Pairing failed');
  await Studio?.setPairing({ server, token: data.token });
  setConnection({ server, token: data.token });
  paired = true;
}
