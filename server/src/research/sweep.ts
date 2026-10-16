// The daily research sweep, no Claude: each watched account's latest posts with their views, scored against the
// account's own median (skipping the newest few, still gathering views), so the posts doing far better than usual
// stand out. YouTube through yt-dlp (a channel's Shorts tab lists 30 with views; keywords search for Shorts and score
// the busiest new channels too), TikTok and Instagram profiles through the desktop app's window (signed out works).
// The outliers' first spoken words come from YouTube's captions. Then the brief is written (brief.ts).
import { and, eq, inArray, lt, or } from 'drizzle-orm';
import { instagramPostedAt, OUTLIER_AT, parseCount, tiktokPostedAt, watchesAnything, type ChannelSuggestion, type ResearchPlatform } from '../../../shared/research';
import { median } from '../../../shared/analytics';
import { run, youtubeCaptions, ytdlp } from '../campaigns/sources';
import { db, newId, now, schema } from '../db';
import { desktopAvailable, readPage } from '../lib/desktop';
import { enqueue, JobError } from '../jobs/queue';
import { getWorkspace } from '../services/pieces';
import { emitResearch, finishBrief, getBrief, researchSettings } from './research';

const DAY = 86400_000;
/** How many of an account's newest posts are left out of its median (they're still gathering views). */
const SKIP_NEWEST = 3;
/** How many posts after those make the median. */
const MEDIAN_OF = 12;
/** First spoken words are fetched for this many new YouTube outliers a day. */
const HOOKS_PER_SWEEP = 8;
/** Busiest new channels a keyword search scores. */
const CHANNELS_PER_KEYWORD = 4;

export type Post = { platform: ResearchPlatform; externalId: string; url: string; title: string; views: number | null; postedAt: number | null; channel: string; channelUrl: string | null };
type Scored = Post & { median: number; score: number };

/** Posts younger than this are still gathering views: they never count towards an account's usual. */
const SETTLED_AFTER = 2 * DAY;
/** Outliers older than this aren't "working now" (pinned greatest hits, say). */
const OUTLIER_MAX_AGE = 45 * DAY;

/**
 * Score an account's posts (newest first) against its usual: the median views of its latest posts that have had time
 * to gather them — two days old or more when the dates are known (accounts that post ten times a day have many
 * hours-old ones), else after the newest few. Needs a few posts to mean anything.
 */
export function scoreAccount(posts: Post[]): { median: number | null; scored: Scored[] } {
  const counted = posts.filter((p) => p.views !== null);
  const dated = counted.every((p) => p.postedAt !== null);
  const settled = dated ? counted.filter((p) => now() - p.postedAt! >= SETTLED_AFTER).slice(0, MEDIAN_OF) : counted.slice(SKIP_NEWEST, SKIP_NEWEST + MEDIAN_OF);
  const m = settled.length >= 5 ? median(settled.map((p) => p.views!)) : null;
  if (!m) return { median: null, scored: [] };
  return { median: m, scored: counted.filter((p) => p.postedAt === null || now() - p.postedAt <= OUTLIER_MAX_AGE).map((p) => ({ ...p, median: m, score: p.views! / m })) };
}

// ---------- YouTube ----------

type FlatEntry = { id?: string; title?: string; url?: string; view_count?: number | null; duration?: number | null; channel?: string; channel_id?: string; channel_url?: string; uploader_id?: string; uploader_url?: string };

async function ytJson(args: string[]) {
  const y = ytdlp();
  return JSON.parse(await run(y.bin, [...y.args, '-J', '--flat-playlist', ...args], { env: y.env, timeoutMs: 120_000 })) as { title?: string; channel?: string; uploader_id?: string; entries?: FlatEntry[] };
}

/** A channel's 30 newest Shorts (newest first) with their views. */
export async function youtubeShorts(channelUrl: string) {
  const json = await ytJson(['--playlist-end', '30', `${channelUrl.replace(/\/+$/, '').replace(/\/(shorts|videos|featured)$/, '')}/shorts`]);
  const name = json.channel || (json.title ?? '').replace(/ - Shorts$/, '') || channelUrl.split('/').pop()!;
  const posts: Post[] = (json.entries ?? [])
    .filter((e) => e.id)
    .map((e) => ({
      platform: 'youtube' as const,
      externalId: e.id!,
      url: `https://www.youtube.com/shorts/${e.id}`,
      title: (e.title ?? '').slice(0, 500),
      views: typeof e.view_count === 'number' ? e.view_count : null,
      postedAt: null,
      channel: name,
      channelUrl,
    }));
  return { name, posts };
}

/** Shorts that a keyword search finds (videos up to three minutes), with their channels. */
async function youtubeSearch(keyword: string, count = 40) {
  const json = await ytJson(['--playlist-end', String(count), `ytsearch${count}:${keyword} #shorts`]);
  return (json.entries ?? []).filter((e) => e.id && (e.duration ?? 0) <= 180 && (e.duration ?? 0) > 0);
}

const channelOf = (e: FlatEntry) => (e.uploader_id?.startsWith('@') ? `https://www.youtube.com/${e.uploader_id}` : (e.channel_url ?? (e.channel_id ? `https://www.youtube.com/channel/${e.channel_id}` : null)));

/** "Find channels for me": channels that keep coming up in Shorts searches for the page's keywords. */
export async function suggestChannels(keywords: string[], skip: string[] = []): Promise<ChannelSuggestion[]> {
  const by = new Map<string, ChannelSuggestion & { views: number[] }>();
  const known = new Set(skip.map((s) => s.toLowerCase()));
  for (const k of keywords.slice(0, 5)) {
    for (const e of await youtubeSearch(k, 50)) {
      const url = channelOf(e);
      if (!url || known.has(url.toLowerCase())) continue;
      // Search entries sometimes carry the result line's extra text ("Name • 270K views • 2 months ago").
      const name = (e.channel ?? '').split('\n')[0].split(' • ')[0].trim() || url.split('/').pop()!;
      const c = by.get(url) ?? { name, url, hits: 0, medianViews: null, sample: (e.title ?? '').slice(0, 120), views: [] };
      c.hits++;
      if (typeof e.view_count === 'number') c.views.push(e.view_count);
      by.set(url, c);
    }
  }
  const all = [...by.values()].map(({ views, ...c }) => ({ ...c, medianViews: views.length ? Math.round(median(views)!) : null }));
  // Channels whose Shorts get some views; tiny ones only when there's little else.
  const established = all.filter((c) => (c.medianViews ?? 0) >= 1000);
  return (established.length >= 3 ? established : all).sort((a, b) => b.hits - a.hits || (b.medianViews ?? 0) - (a.medianViews ?? 0)).slice(0, 12);
}

/** The first few seconds of what's said, from YouTube's captions. */
/** A TikTok or Instagram post's caption (the profile grid doesn't show it), through yt-dlp. */
async function postCaption(url: string) {
  const y = ytdlp();
  const info = JSON.parse(await run(y.bin, [...y.args, '-J', '--no-playlist', url], { env: y.env, timeoutMs: 60_000 })) as { title?: string; description?: string };
  const text = (info.description || info.title || '').replace(/\s+/g, ' ').trim();
  return /^Video by /.test(text) ? '' : text.slice(0, 500);
}

async function spokenHook(url: string) {
  const t = await youtubeCaptions(url).catch(() => null);
  if (!t) return '';
  const words = t.segments.flatMap((s) => s.words ?? []).filter((w) => w.start < 4.5);
  const text = (words.length ? words.map((w) => w.word).join('') : (t.segments[0]?.text ?? '')).replace(/\s+/g, ' ').trim();
  return text.slice(0, 300);
}

// ---------- TikTok and Instagram (the desktop app's window) ----------

export async function tiktokProfile(handle: string): Promise<Post[]> {
  const page = await readPage(`https://www.tiktok.com/@${handle}`, { scrolls: 2, waitFor: 'a[href*="/video/"]' });
  if (page.loginWall) throw new Error('TikTok asked to sign in (Settings → Connected sites)');
  const seen = new Set<string>();
  const posts: Post[] = [];
  for (const l of page.links) {
    const id = /tiktok\.com\/@[^/]+\/(?:video|photo)\/(\d{8,})/.exec(l.href)?.[1];
    if (!id || seen.has(id)) continue;
    seen.add(id);
    posts.push({
      platform: 'tiktok',
      externalId: id,
      url: `https://www.tiktok.com/@${handle}/video/${id}`,
      // The tile's text is its views (after "Pinned" on pinned ones); the picture's alt text is the caption.
      title: (l.alt ?? '').replace(/\s+created by .*$/i, '').slice(0, 500),
      views: parseCount(l.text.replace(/pinned/i, '')),
      postedAt: tiktokPostedAt(id),
      channel: `@${handle}`,
      channelUrl: `https://www.tiktok.com/@${handle}`,
    });
  }
  // Signed out, TikTok sometimes won't show the videos ("Something went wrong").
  if (!posts.length && /something went wrong|try again later/i.test(page.text)) throw new Error('TikTok didn’t show the videos: signing in to TikTok under Settings → Connected sites usually helps');
  // Newest first (pinned posts sit at the top of the grid whatever their age).
  return posts.sort((a, b) => (b.postedAt ?? 0) - (a.postedAt ?? 0));
}

export async function instagramProfile(handle: string): Promise<Post[]> {
  const page = await readPage(`https://www.instagram.com/${handle}/reels/`, { scrolls: 2, waitFor: 'a[href*="/reel/"]' });
  if (page.loginWall) throw new Error('Instagram asked to sign in (Settings → Connected sites)');
  const seen = new Set<string>();
  const posts: Post[] = [];
  for (const l of page.links) {
    const code = /instagram\.com\/(?:[\w.]+\/)?(?:reel|p)\/([\w-]{6,})/.exec(l.href)?.[1];
    if (!code || seen.has(code)) continue;
    seen.add(code);
    posts.push({
      platform: 'instagram',
      externalId: code,
      url: `https://www.instagram.com/reel/${code}/`,
      title: (l.alt ?? '').slice(0, 500),
      views: parseCount(l.text),
      postedAt: instagramPostedAt(code),
      channel: `@${handle}`,
      channelUrl: `https://www.instagram.com/${handle}/`,
    });
  }
  return posts.sort((a, b) => (b.postedAt ?? 0) - (a.postedAt ?? 0));
}

// ---------- saving ----------

function upsert(workspaceId: string, p: Scored, source: 'watch' | 'search', keyword: string | null) {
  const existing = db
    .select()
    .from(schema.researchItems)
    .where(and(eq(schema.researchItems.workspaceId, workspaceId), eq(schema.researchItems.platform, p.platform), eq(schema.researchItems.externalId, p.externalId)))
    .get();
  const values = { views: p.views, channelMedian: Math.round(p.median), score: Math.round(p.score * 100) / 100, lastSeenAt: now(), channel: p.channel, channelUrl: p.channelUrl };
  if (existing) {
    db.update(schema.researchItems)
      .set({ ...values, title: p.title || existing.title, postedAt: existing.postedAt ?? p.postedAt, ...(existing.source === 'search' && source === 'watch' && { source, keyword: null }) })
      .where(eq(schema.researchItems.id, existing.id))
      .run();
    return { id: existing.id, isNew: false, hasHook: !!existing.hook, hasTitle: !!(p.title || existing.title) };
  }
  const id = newId();
  db.insert(schema.researchItems)
    .values({ id, workspaceId, platform: p.platform, externalId: p.externalId, url: p.url, title: p.title, postedAt: p.postedAt, source, keyword, firstSeenAt: now(), ...values })
    .run();
  return { id, isNew: true, hasHook: false, hasTitle: !!p.title };
}

/**
 * The `research.sweep` job: read everything the page watches, keep the outliers, then queue the brief. Accounts that
 * can't be read are noted in the brief's sweep line rather than failing the whole sweep.
 */
export async function researchSweep({ workspaceId, briefId }: { workspaceId: string; briefId: string }) {
  getBrief(briefId);
  const ws = getWorkspace(workspaceId);
  const settings = researchSettings(ws.id);
  if (!watchesAnything(settings)) {
    finishBrief(briefId, { status: 'error', error: 'This page doesn’t watch anything yet: add keywords or accounts under Research.' });
    throw new JobError('Nothing to watch.', { retry: false });
  }
  const notes: string[] = [];
  const outliers: { id: string; post: Scored; isNew: boolean; hasHook: boolean; hasTitle: boolean }[] = [];
  let accounts = 0;
  let posts = 0;
  // Outliers are saved; a post saved before that's no longer one gets its new score (and so leaves the list).
  const keep = (list: Scored[], source: 'watch' | 'search', keyword: string | null = null) => {
    for (const p of list) {
      if (p.score >= OUTLIER_AT) outliers.push({ ...upsert(ws.id, p, source, keyword), post: p });
      else
        db.update(schema.researchItems)
          .set({ views: p.views, channelMedian: Math.round(p.median), score: Math.round(p.score * 100) / 100 })
          .where(and(eq(schema.researchItems.workspaceId, ws.id), eq(schema.researchItems.platform, p.platform), eq(schema.researchItems.externalId, p.externalId)))
          .run();
    }
  };

  const watchedUrls = new Set(settings.youtube.map((c) => c.url.toLowerCase()));
  for (const c of settings.youtube) {
    try {
      const { posts: list } = await youtubeShorts(c.url);
      const { scored } = scoreAccount(list);
      accounts++;
      posts += list.length;
      keep(scored, 'watch');
      if (!scored.length) notes.push(`${c.name}: too few Shorts with views to compare`);
    } catch (err) {
      notes.push(`${c.name}: ${(err as Error).message.slice(0, 120)}`);
    }
  }

  // Keyword searches: the Shorts that come up, scored against their own channel's median (the busiest new channels).
  for (const k of settings.keywords) {
    try {
      const hits = await youtubeSearch(k);
      const channels = new Map<string, number>();
      for (const e of hits) {
        const url = channelOf(e);
        if (url && !watchedUrls.has(url.toLowerCase())) channels.set(url, (channels.get(url) ?? 0) + (e.view_count ?? 0));
      }
      const hitIds = new Set(hits.map((e) => e.id));
      for (const [url] of [...channels].sort((a, b) => b[1] - a[1]).slice(0, CHANNELS_PER_KEYWORD)) {
        const { posts: list } = await youtubeShorts(url).catch(() => ({ posts: [] as Post[] }));
        const { scored } = scoreAccount(list);
        posts += list.length;
        // Only the posts the search found, so the brief stays on the keyword.
        keep(
          scored.filter((p) => hitIds.has(p.externalId)),
          'search',
          k,
        );
      }
    } catch (err) {
      notes.push(`“${k}”: ${(err as Error).message.slice(0, 120)}`);
    }
  }

  const profiles = [...settings.tiktok.map((h) => ['tiktok', h] as const), ...settings.instagram.map((h) => ['instagram', h] as const)];
  if (profiles.length && !desktopAvailable()) notes.push('TikTok and Instagram accounts are read by the desktop app: open Content Studio on the computer');
  else
    for (const [platform, handle] of profiles) {
      try {
        const list = platform === 'tiktok' ? await tiktokProfile(handle) : await instagramProfile(handle);
        const { scored } = scoreAccount(list);
        accounts++;
        posts += list.length;
        keep(scored, 'watch');
        if (!list.length) notes.push(`@${handle} on ${platform === 'tiktok' ? 'TikTok' : 'Instagram'}: no posts could be read`);
      } catch (err) {
        notes.push(`@${handle}: ${(err as Error).message.slice(0, 120)}`);
      }
    }

  // First spoken words for new YouTube outliers, best first.
  const needHooks = outliers
    .filter((o) => o.post.platform === 'youtube' && !o.hasHook)
    .sort((a, b) => b.post.score - a.post.score)
    .slice(0, HOOKS_PER_SWEEP);
  for (const o of needHooks) {
    const hook = await spokenHook(o.post.url);
    if (hook) db.update(schema.researchItems).set({ hook }).where(eq(schema.researchItems.id, o.id)).run();
  }
  // Captions for new TikTok and Instagram outliers, which the profile grid doesn't show.
  const needCaptions = outliers
    .filter((o) => o.post.platform !== 'youtube' && !o.hasTitle)
    .sort((a, b) => b.post.score - a.post.score)
    .slice(0, HOOKS_PER_SWEEP);
  for (const o of needCaptions) {
    const title = await postCaption(o.post.url).catch(() => '');
    if (title) db.update(schema.researchItems).set({ title }).where(eq(schema.researchItems.id, o.id)).run();
  }

  // Outliers nobody has seen for two months, or posted too long ago to count as working now, go (analyses stay).
  db.delete(schema.researchItems)
    .where(
      and(
        eq(schema.researchItems.workspaceId, ws.id),
        inArray(schema.researchItems.source, ['watch', 'search']),
        or(lt(schema.researchItems.lastSeenAt, now() - 60 * DAY), lt(schema.researchItems.postedAt, now() - OUTLIER_MAX_AGE)),
      ),
    )
    .run();

  const fresh = outliers.filter((o) => o.isNew).length;
  const sweep = [
    `${accounts} account${accounts === 1 ? '' : 's'}${settings.keywords.length ? ` and ${settings.keywords.length} keyword${settings.keywords.length === 1 ? '' : 's'}` : ''}, ${posts} posts: ${outliers.length} outlier${outliers.length === 1 ? '' : 's'}${fresh ? ` (${fresh} new)` : ''}`,
    ...notes.slice(0, 6),
  ].join(' · ');
  finishBrief(briefId, { status: 'running', sweep });
  emitResearch(ws.id);
  enqueue('research.brief', { workspaceId: ws.id, briefId }, { maxAttempts: 2 });
}

export function onSweepFailed({ briefId }: { briefId: string }, message: string) {
  try {
    finishBrief(briefId, { status: 'error', error: message.slice(0, 300) });
  } catch {
    /* deleted with its workspace */
  }
}
