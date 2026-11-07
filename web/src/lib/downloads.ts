import { useEffect } from 'react';
import { fileUrl } from './api';
import { isNative, Studio, type DownloadItem } from './native';
import { createStore, useStore } from './ui-state';

/*
 * Saving a video to this device. The laptop (desktop app or browser) gets the file in Downloads; the phone saves it to
 * the gallery (Movies/Content Studio) through Android's downloads, and plays it from there afterwards, offline too
 * (StudioWebViewClient serves it at /_studio_download_/<mediaId>).
 */

/** The phone's saved videos and the ones on their way. */
export const downloads = createStore<DownloadItem[]>([]);

export async function refreshDownloads() {
  if (!isNative) return;
  const { downloads: list } = await Studio.listDownloads().catch(() => ({ downloads: [] as DownloadItem[] }));
  downloads.set(list);
}

/** The file's name: the card's title and the version, like the server names its renders. */
export const videoName = (title: string, version: number | null | undefined) => `${title.replace(/[\\/:*?"<>|]+/g, '-').trim() || 'Video'} · v${version ?? 1}.mp4`;

export async function downloadVideo(mediaId: string, name: string) {
  if (!isNative) {
    const a = document.createElement('a');
    a.href = fileUrl(`/media/${mediaId}/file?download=1`);
    a.download = name;
    a.click();
    return;
  }
  await Studio.download({ mediaId, name });
  await refreshDownloads();
}

/** Where the phone plays a saved video from: its own copy, served by the app. */
export const savedVideoUrl = (mediaId: string) => `${window.location.origin}/_studio_download_/${encodeURIComponent(mediaId)}`;

/** A video's download on the phone (none on the laptop), looked at again every second while one is on its way. */
export function useDownload(mediaId: string | null | undefined) {
  const list = useStore(downloads);
  const running = list.some((d) => d.state === 'running');
  useEffect(() => {
    if (!isNative) return;
    void refreshDownloads();
    if (!running) return;
    const timer = setInterval(() => void refreshDownloads(), 1000);
    return () => clearInterval(timer);
  }, [running, mediaId]);
  return mediaId ? list.find((d) => d.mediaId === mediaId) : undefined;
}
