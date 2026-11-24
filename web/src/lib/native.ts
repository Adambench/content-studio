// The Android shell's side: files shared to the app from the gallery, the background upload queue (it goes on with
// the screen off), saving to the gallery, through the app's own plugin (StudioPlugin.java). The page itself comes
// from ai-server. In a browser all of this is a no-op.

import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { api, setConnection } from './api';

export type QueuedFile = { path: string; name: string; mime: string; size: number };
export type Share = { id: string; files: QueuedFile[]; text: string | null };
export type UploadItem = { id: string; kind: string; name: string; size: number; sent: number; state: 'waiting' | 'uploading' | 'done' | 'failed'; error: string | null; pieceId?: string | null; createdAt: number };

// The plugin still says workspace and piece (the first app's words) for page and video; the server takes both.
type Target = { workspaceId: string; pieceId: string; source: 'upload' | 'share' };

type StudioPlugin = {
  getPairing(): Promise<{ server: string | null; token: string | null }>;
  setPairing(v: { server: string; token: string }): Promise<void>;
  getShare(): Promise<{ share: Share | null }>;
  discardShare(v: { id: string }): Promise<void>;
  pickFiles(v: { accept: string[]; camera?: boolean }): Promise<{ files: QueuedFile[] }>;
  enqueueFiles(v: Target & { files: QueuedFile[] }): Promise<void>;
  listUploads(): Promise<{ uploads: UploadItem[] }>;
  download(v: { mediaId: string; name: string }): Promise<void>;
  addListener(event: 'share', fn: (s: Share) => void): Promise<PluginListenerHandle>;
  addListener(event: 'uploads', fn: (e: { uploads: UploadItem[] }) => void): Promise<PluginListenerHandle>;
};

export const isNative = Capacitor.isNativePlatform();
export const Studio = isNative ? registerPlugin<StudioPlugin>('Studio') : null;

/** Before the first render: in the shell, the paired token (if any) rides along with every request. */
export async function connectNative() {
  if (!Studio) return;
  const p = await Studio.getPairing().catch(() => ({ server: null, token: null }));
  if (p.token && p.server === window.location.origin) setConnection({ server: '', token: p.token });
  // The background queue needs to know where to send files. On the tailnet Tailscale says who the phone is, so a
  // pairing code isn't needed: the token is only a placeholder then.
  else await Studio.setPairing({ server: window.location.origin, token: p.token ?? 'tailnet' }).catch(() => undefined);
}

/** Files from the phone's gallery to a video, through the background queue. */
export async function pickToVideo(video: { id: string; pageId: string }): Promise<number> {
  if (!Studio) return 0;
  const { files } = await Studio.pickFiles({ accept: ['video/*', 'image/*', 'audio/*'] });
  if (files.length) await Studio.enqueueFiles({ workspaceId: video.pageId, pieceId: video.id, source: 'upload', files });
  return files.length;
}

/** What I shared from the gallery, to a video. "Add & make": Claude starts once every file is in. */
export async function sendShare(share: Share, video: { id: string; pageId: string }, make: boolean) {
  if (!Studio) return;
  if (make && share.files.length) await api(`/api/videos/${video.id}/make-when-uploaded`, { body: { count: share.files.length } });
  if (share.files.length) await Studio.enqueueFiles({ workspaceId: video.pageId, pieceId: video.id, source: 'share', files: share.files });
  await Studio.discardShare({ id: share.id });
}

/** A version (or one slide: "<versionId>~<k>") saved to the phone's gallery. */
export async function saveToPhone(mediaId: string, name: string) {
  await Studio?.download({ mediaId, name });
}
