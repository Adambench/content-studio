// A post saved to Ideas, filled in on its own with no Claude (`ideas.details`): its caption, account, views and
// thumbnail (TikTok's embed page, else yt-dlp, else the desktop window for Instagram), how far above the account's usual
// it did (the same median the research sweep uses, kept a week per account), and what's said in it (YouTube's
// captions, else Whisper on its sound). The breakdown (why it works) is Research's analysis, on my click.
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { ResearchPlatform } from '../../../shared/research';
import type { Transcript } from '../../../shared/types';
import { run, youtubeCaptions, ytdlp } from '../campaigns/sources';
import { config } from '../config';
import { db, now, schema } from '../db';
import { desktopAvailable, readPage } from '../lib/desktop';
import { extractAudio } from '../lib/ffmpeg';
import { getSetting, setSetting } from '../lib/settings';
import { runTool } from '../compute/run';
import { emitResearch } from '../research/research';
import { instagramProfile, scoreAccount, tiktokProfile, youtubeShorts, type Post } from '../research/sweep';
import { downloadTiktok, tiktokPost } from '../research/tiktok';
import { adoptFile, whisperInstalled } from '../services/media';
import { emitIdeas } from './ideas';

const DAY = 86400_000;
/** An account's usual views are read again after this long. */
const MEDIAN_FOR = 7 * DAY;
/** Longer posts aren't transcribed here (it's for shorts; Whisper on a laptop is slow). */
const TRANSCRIBE_UP_TO = 4 * 60;

type Info = {
  title?: string;
  description?: string;
  channel?: string;
  uploader?: string;
  uploader_id?: string;
  channel_url?: string;
  uploader_url?: string;
  view_count?: number;
  timestamp?: number;
  duration?: number;
  thumbnail?: string;
  /** A TikTok's video file, from its embed page. */
  videoUrl?: string | null;
};

async function ytJson(url: string): Promise<Info> {
  const y = ytdlp();
  return JSON.parse(await run(y.bin, [...y.args, '-J', '--no-playlist', '--skip-download', url], { env: y.env, timeoutMs: 90_000 })) as Info;
}

/** A TikTok from its embed page (yt-dlp is blocked by TikTok here). */
async function tiktokInfo(url: string): Promise<Info> {
  const p = await tiktokPost(url);
  return {
    title: p.caption,
    uploader: p.handle ? `@${p.handle}` : p.name,
    uploader_url: p.handle ? `https://www.tiktok.com/@${p.handle}` : undefined,
    view_count: p.views ?? undefined,
    timestamp: p.postedAt ? p.postedAt / 1000 : undefined,
    duration: p.seconds ?? undefined,
    thumbnail: p.cover ?? undefined,
    videoUrl: p.videoUrl,
  };
}

/** Instagram's post page in the desktop window (signed in or not): its title carries the account and caption. */
async function instagramPage(url: string): Promise<Info> {
  if (!desktopAvailable()) throw new Error('Needs the desktop app');
  const page = await readPage(url, { waitFor: 3000 });
  const handle = /\(@([\w.]+)\)/.exec(page.title)?.[1] ?? /instagram\.com\/([\w.]+)\/?$/.exec(page.links.find((l) => /instagram\.com\/[\w.]+\/?$/.test(l.href))?.href ?? '')?.[1];
  const caption = /on Instagram: “?"?([\s\S]+?)”?"?$/.exec(page.title)?.[1] ?? '';
  return { title: caption, uploader: handle ? `@${handle}` : undefined, uploader_url: handle ? `https://www.instagram.com/${handle}/` : undefined };
}

async function readInfo(platform: ResearchPlatform, url: string): Promise<Info> {
  if (platform === 'tiktok') return tiktokInfo(url).catch(() => ytJson(url));
  try {
    return await ytJson(url);
  } catch (err) {
    if (platform === 'instagram') return instagramPage(url);
    throw err;
  }
}

const handleOf = (s: string | null | undefined) => (s ? (/@([\w.-]+)/.exec(s)?.[1] ?? null) : null);

/** The account's usual views, from a read of its latest posts at most once a week. */
async function usualViews(platform: ResearchPlatform, account: { url: string | null; handle: string | null }) {
  const key = `${platform}:${(platform === 'youtube' ? account.url : account.handle)?.toLowerCase() ?? ''}`;
  if (key.endsWith(':')) return null;
  const cache = getSetting('channelMedians') ?? {};
  const hit = cache[key];
  if (hit && now() - hit.at < MEDIAN_FOR) return hit.median;
  let posts: Post[] = [];
  try {
    if (platform === 'youtube' && account.url) posts = (await youtubeShorts(account.url)).posts;
    else if (platform === 'tiktok' && account.handle && desktopAvailable()) posts = await tiktokProfile(account.handle);
    else if (platform === 'instagram' && account.handle && desktopAvailable()) posts = await instagramProfile(account.handle);
    else return null;
  } catch {
    return null;
  }
  const median = scoreAccount(posts).median;
  // Keep the cache small: the newest 300 accounts.
  const kept = Object.fromEntries(
    Object.entries({ ...cache, [key]: { median, at: now() } })
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, 300),
  );
  setSetting('channelMedians', kept);
  return median;
}

/** What's said: YouTube's captions, else Whisper on the post's sound. */
async function spokenWords(platform: ResearchPlatform, url: string, info: Info, dir: string): Promise<string> {
  if (platform === 'youtube') {
    const t = await youtubeCaptions(url).catch(() => null);
    if (t) return t.segments.map((s) => s.text.trim()).join(' ');
  }
  if (!whisperInstalled() || (info.duration && info.duration > TRANSCRIBE_UP_TO)) return '';
  try {
    if (info.videoUrl) await downloadTiktok(info.videoUrl, join(dir, 'sound.mp4'));
    else {
      const y = ytdlp();
      await run(y.bin, [...y.args, '--no-playlist', '-f', 'ba/b[height<=480]/b', '-o', join(dir, 'sound.%(ext)s'), url], { env: y.env, timeoutMs: 5 * 60_000 });
    }
  } catch {
    return '';
  }
  const file = (await readdir(dir)).find((f) => f.startsWith('sound.') && !f.endsWith('.part'));
  if (!file) return '';
  const wav = join(dir, 'sound.wav');
  const out = join(dir, 'transcript.json');
  await extractAudio(join(dir, file), wav);
  await runTool('transcribe', { audio: wav, json: out }, { model: getSetting('whisperModel') ?? 'small' }, { timeoutMs: 20 * 60_000 });
  const t = JSON.parse(await readFile(out, 'utf8')) as Transcript;
  return t.text.trim();
}

/** The thumbnail as the card's picture (a media row of its own, never in the Inbox). */
async function saveThumb(workspaceId: string, url: string, dir: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) return null;
  const type = res.headers.get('content-type') ?? 'image/jpeg';
  if (!type.startsWith('image/')) return null;
  const ext = type.includes('png') ? '.png' : type.includes('webp') ? '.webp' : '.jpg';
  const file = join(dir, `thumb${ext}`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  return adoptFile(workspaceId, file, `thumbnail${ext}`, type, { source: 'idea' });
}

/** The `ideas.details` job. */
export async function fetchDetails({ ideaId }: { ideaId: string }) {
  const idea = db.select().from(schema.ideas).where(eq(schema.ideas.id, ideaId)).get();
  if (!idea || idea.deletedAt || !idea.researchItemId) return;
  const item = db.select().from(schema.researchItems).where(eq(schema.researchItems.id, idea.researchItemId)).get();
  if (!item || item.platform === 'file') return;
  const platform = item.platform;
  const dir = join(config.tmpDir, `idea-${ideaId}`);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  try {
    const info = await readInfo(platform, item.url).catch(() => ({}) as Info);
    const caption = (info.title && !/^Video by /.test(info.title) ? info.title : info.description || '').replace(/\s+/g, ' ').trim();
    const channelUrl = info.channel_url || info.uploader_url || item.channelUrl;
    const handle = handleOf(info.uploader_id) ?? handleOf(info.uploader) ?? handleOf(channelUrl) ?? handleOf(item.url);
    const channel = info.channel || info.uploader || (handle ? `@${handle}` : '') || item.channel;
    const views = info.view_count ?? item.views;
    const values: Partial<typeof schema.researchItems.$inferInsert> = {
      title: (caption || item.title).slice(0, 500),
      channel,
      channelUrl: channelUrl ?? null,
      views: views ?? null,
      postedAt: info.timestamp ? info.timestamp * 1000 : item.postedAt,
      lastSeenAt: now(),
    };
    db.update(schema.researchItems).set(values).where(eq(schema.researchItems.id, item.id)).run();
    emitIdeas(idea.workspaceId, ideaId);

    if (info.thumbnail && !idea.mediaId) {
      const thumb = await saveThumb(idea.workspaceId, info.thumbnail, dir).catch(() => null);
      if (thumb) db.update(schema.ideas).set({ mediaId: thumb.id }).where(eq(schema.ideas.id, ideaId)).run();
      emitIdeas(idea.workspaceId, ideaId);
    }

    if (item.score === null && views !== null && views !== undefined) {
      const median = await usualViews(platform, { url: channelUrl ?? null, handle });
      if (median) db.update(schema.researchItems).set({ channelMedian: Math.round(median), score: views / median }).where(eq(schema.researchItems.id, item.id)).run();
      emitIdeas(idea.workspaceId, ideaId);
    }

    if (!item.transcript) {
      const words = await spokenWords(platform, item.url, info, dir).catch(() => '');
      if (words) {
        const hook = words.split(/\s+/).slice(0, 14).join(' ');
        db.update(schema.researchItems).set({ transcript: words.slice(0, 20_000), hook: item.hook || hook }).where(eq(schema.researchItems.id, item.id)).run();
      }
    }
    emitResearch(idea.workspaceId);
    emitIdeas(idea.workspaceId, ideaId);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
