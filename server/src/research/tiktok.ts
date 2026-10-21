// A single TikTok without yt-dlp (which TikTok blocks here) or a sign-in: its public embed page carries the caption,
// account, cover, views, date and a link to the video file. Used for posts saved to Ideas and analyses of TikToks.
import { writeFile } from 'node:fs/promises';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export type TikTokPost = {
  id: string;
  caption: string;
  handle: string;
  name: string;
  cover: string | null;
  views: number | null;
  postedAt: number | null;
  videoUrl: string | null;
  seconds: number | null;
};

/** The video id, following a short share link (vm.tiktok.com/…) to the post it points at. */
async function videoId(url: string) {
  const direct = /\/(?:video|photo)\/(\d{8,})/.exec(url)?.[1];
  if (direct) return direct;
  const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20_000) });
  await res.body?.cancel();
  return /\/(?:video|photo)\/(\d{8,})/.exec(res.url)?.[1] ?? null;
}

type EmbedData = {
  itemInfos?: { text?: string; createTime?: string; covers?: string[]; coversOrigin?: string[]; playCount?: number; video?: { urls?: string[]; videoMeta?: { duration?: number } } };
  authorInfos?: { uniqueId?: string; nickName?: string };
};

export async function tiktokPost(url: string): Promise<TikTokPost> {
  const id = await videoId(url);
  if (!id) throw new Error('Not a TikTok video link');
  const res = await fetch(`https://www.tiktok.com/embed/v2/${id}`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`TikTok answered ${res.status}`);
  const html = await res.text();
  const json = /<script id="__FRONTITY_CONNECT_STATE__"[^>]*>([\s\S]*?)<\/script>/.exec(html)?.[1];
  if (!json) throw new Error('TikTok’s embed page changed');
  const state = JSON.parse(json) as { source?: { data?: Record<string, { videoData?: EmbedData }> } };
  const v = Object.values(state.source?.data ?? {}).find((d) => d.videoData)?.videoData;
  if (!v?.itemInfos) throw new Error('TikTok didn’t show the post (deleted or private?)');
  const i = v.itemInfos;
  return {
    id,
    caption: (i.text ?? '').trim(),
    handle: v.authorInfos?.uniqueId ?? '',
    name: v.authorInfos?.nickName ?? '',
    cover: i.coversOrigin?.[0] ?? i.covers?.[0] ?? null,
    views: typeof i.playCount === 'number' ? i.playCount : null,
    postedAt: i.createTime ? Number(i.createTime) * 1000 : null,
    videoUrl: i.video?.urls?.[0] ?? null,
    seconds: i.video?.videoMeta?.duration ?? null,
  };
}

/** The video file itself (its link needs TikTok as the referrer). */
export async function downloadTiktok(videoUrl: string | null, file: string) {
  if (!videoUrl) throw new Error('TikTok gave no video file (a photo post?)');
  const res = await fetch(videoUrl, { headers: { 'user-agent': UA, referer: 'https://www.tiktok.com/' }, signal: AbortSignal.timeout(5 * 60_000) });
  if (!res.ok) throw new Error(`The video file answered ${res.status}`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  return file;
}
