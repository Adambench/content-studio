// Fetching a reference post (Knowledge → References): which platform a link is on, its video and what yt-dlp says about
// it, and Whisper's words. TikTok blocks yt-dlp here, so a TikTok comes from its public embed page instead.
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Transcript } from '../../../shared/types';
import { run, ytdlp } from '../campaigns/sources';
import { runTool } from '../compute/run';
import { JobError } from '../jobs/queue';
import { extractAudio } from '../lib/ffmpeg';
import { getSetting } from '../lib/settings';
import { whisperInstalled } from '../services/media';

/** Which platform a pasted link is on, and the post's id there; null for anything else. */
export function postOf(url: string): { platform: 'youtube' | 'tiktok' | 'instagram'; id: string; url: string } | null {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//.test(url.trim()) ? url.trim() : `https://${url.trim()}`);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  if (host === 'youtu.be' || host === 'youtube.com') {
    const id = host === 'youtu.be' ? u.pathname.slice(1).split('/')[0] : u.pathname === '/watch' ? u.searchParams.get('v') : /^\/(?:shorts|live|embed)\/([\w-]{11})/.exec(u.pathname)?.[1];
    return id && /^[\w-]{11}$/.test(id) ? { platform: 'youtube', id, url: `https://www.youtube.com/shorts/${id}` } : null;
  }
  if (host.endsWith('tiktok.com')) {
    const id = /\/(?:video|photo)\/(\d{8,})/.exec(u.pathname)?.[1];
    // Short share links (vm.tiktok.com/…) are followed by yt-dlp; their own path is the key until then.
    if (id) return { platform: 'tiktok', id, url: `https://www.tiktok.com${u.pathname.replace(/\/+$/, '')}` };
    if (/^(vm|vt)\./.test(u.hostname)) return { platform: 'tiktok', id: u.pathname.replace(/\//g, ''), url: u.toString() };
    return null;
  }
  if (host.endsWith('instagram.com')) {
    const code = /\/(?:reel|reels|p|tv)\/([\w-]{6,})/.exec(u.pathname)?.[1];
    return code ? { platform: 'instagram', id: code, url: `https://www.instagram.com/reel/${code}/` } : null;
  }
  return null;
}

type YtInfo = { title?: string; description?: string; view_count?: number; like_count?: number; comment_count?: number; channel?: string; uploader?: string; uploader_id?: string; channel_url?: string; uploader_url?: string; timestamp?: number; duration?: number };

/** A TikTok from its embed page, when yt-dlp is blocked. */
async function downloadFromEmbed(url: string, dir: string): Promise<{ file: string; info: YtInfo }> {
  const p = await tiktokPost(url);
  const file = await downloadTiktok(p.videoUrl, join(dir, 'video.mp4'));
  return { file, info: { title: p.caption, channel: p.handle ? `@${p.handle}` : p.name, uploader_url: p.handle ? `https://www.tiktok.com/@${p.handle}` : undefined, view_count: p.views ?? undefined, timestamp: p.postedAt ? p.postedAt / 1000 : undefined } };
}

/** A post's video (720p at most) and what yt-dlp says about it, into `dir`. Also used for references. */
export async function downloadPost(url: string, dir: string) {
  const y = ytdlp();
  const out = await run(
    y.bin,
    [...y.args, '-j', '--no-simulate', '--no-playlist', '-f', 'bv*[height<=720]+ba/b[height<=720]/bv*+ba/b', '--merge-output-format', 'mp4', '-o', join(dir, 'video.%(ext)s'), url],
    { env: y.env, timeoutMs: 10 * 60_000 },
  ).catch(async (err: Error) => {
    if (postOf(url)?.platform === 'tiktok') return null;
    throw new JobError(`Couldn’t fetch the video: ${err.message}`, { retry: false });
  });
  if (out === null) return downloadFromEmbed(url, dir).catch((err: Error) => {
    throw new JobError(`Couldn’t fetch the TikTok: ${err.message}`, { retry: false });
  });
  const info = JSON.parse(out.trim().split('\n').filter((l) => l.startsWith('{')).pop() ?? '{}') as YtInfo;
  const file = (await readdir(dir)).find((f) => f.startsWith('video.') && !f.endsWith('.part'));
  if (!file) throw new JobError('yt-dlp finished without a video.', { retry: false });
  return { file: join(dir, file), info };
}

/** What's said in a video, by Whisper (null when it isn't installed). */
export async function whisper(file: string, dir: string, language?: string): Promise<Transcript | null> {
  if (!whisperInstalled()) return null;
  const wav = join(dir, 'audio.wav');
  const out = join(dir, 'transcript.json');
  if (!existsSync(wav)) await extractAudio(file, wav);
  await runTool('transcribe', { audio: wav, json: out }, { model: getSetting('whisperModel') ?? 'small', ...(language && { language }) }, { timeoutMs: 20 * 60_000 });
  return JSON.parse(await readFile(out, 'utf8')) as Transcript;
}




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
