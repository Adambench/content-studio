import { stat } from 'node:fs/promises';
import { emptyStats, type PostStats } from '../../../../shared/analytics';
import { splitTags } from '../../../../shared/publish';
import { mediaPath } from '../../services/media';
import {
  chunks,
  count,
  form,
  hasScope,
  oauthError,
  percent,
  PlatformError,
  readJson,
  readRange,
  request,
  type PlatformAdapter,
  type PostStatsResult,
  type PublishContext,
  type PublishResult,
} from './http';

// YouTube Data API v3 with Google OAuth. https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol
// Views, likes and comments come with youtube.readonly; watch time, shares and subscribers gained from the YouTube
// Analytics API (its own scope, and turned on separately in the Cloud project).
const ANALYTICS_SCOPE = 'https://www.googleapis.com/auth/yt-analytics.readonly';
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly', ANALYTICS_SCOPE];
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
// Upload in 8 MB pieces (a multiple of 256 KB, as resumable uploads require) so progress shows and a drop resumes.
const CHUNK = 32 * 256 * 1024;

function apiError(status: number, body: any) {
  const reason: string | undefined = body?.error?.errors?.[0]?.reason;
  const message: string = body?.error?.message ?? body?.raw ?? `HTTP ${status}`;
  if (status === 401) return new PlatformError('YouTube refused the sign-in.', 'auth');
  if (reason === 'quotaExceeded') return new PlatformError('The YouTube API’s daily quota is used up — trying again in a few hours (it resets at midnight Pacific time).', 'rate', 3 * 60 * 60_000);
  if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded' || status === 429) return new PlatformError('YouTube asked us to slow down.', 'rate', 5 * 60_000);
  if (reason === 'uploadLimitExceeded') return new PlatformError('YouTube says this channel has reached its upload limit for now. Try again tomorrow.', 'fatal');
  if (reason === 'youtubeSignupRequired') return new PlatformError('This Google account has no YouTube channel yet. Create one on youtube.com, then reconnect.', 'fatal');
  if (status >= 500) return new PlatformError(`YouTube had a problem (${message}).`, 'retry');
  return new PlatformError(`YouTube said: ${message}`, 'fatal');
}

async function tokenRequest(params: Record<string, string>) {
  const res = await request(TOKEN_URL, { method: 'POST', body: form(params) });
  const json = await readJson(res);
  if (!res.ok || !json.access_token) throw oauthError('Google', res.status, json);
  return { accessToken: json.access_token as string, refreshToken: (json.refresh_token as string | undefined) ?? undefined, expiresAt: Date.now() + Number(json.expires_in ?? 3600) * 1000, scopes: String(json.scope ?? '') };
}

// YouTube refuses angle brackets in titles and descriptions.
const clean = (s: string) => s.replace(/</g, '‹').replace(/>/g, '›');

function done(ctx: PublishContext, video: { id: string; status?: { privacyStatus?: string } }): PublishResult {
  const m = ctx.media[0];
  const short = (m.durationMs ?? 0) <= 180_000 && (m.height ?? 1) >= (m.width ?? 0);
  const wanted = ctx.post.options.youtubePrivacy ?? 'public';
  const got = video.status?.privacyStatus;
  const stage =
    got && got !== wanted
      ? `Uploaded, but YouTube made it ${got} — unaudited API projects can only upload private videos. Change it in YouTube Studio, or once the audit passes.`
      : wanted === 'public'
        ? 'Live on YouTube.'
        : `Uploaded to YouTube as ${wanted}.`;
  return { externalId: video.id, url: short ? `https://youtube.com/shorts/${video.id}` : `https://youtu.be/${video.id}`, stage };
}

/** Where a resumable upload got to: the next byte to send, or the finished video. */
async function uploadStatus(sessionUrl: string, token: string, size: number): Promise<{ next: number } | { video: any } | null> {
  const res = await request(sessionUrl, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Range': `bytes */${size}` } });
  if (res.status === 200 || res.status === 201) return { video: await readJson(res) };
  if (res.status === 308) return { next: rangeEnd(res) };
  if (res.status === 401) throw apiError(401, null);
  if (res.status >= 500) throw apiError(res.status, await readJson(res));
  // 404/410: the session expired before the upload finished, so nothing was posted.
  return null;
}

async function getJson(url: string, token: string) {
  const res = await request(url, { headers: { Authorization: `Bearer ${token}` } });
  const json = await readJson(res);
  if (!res.ok) throw apiError(res.status, json);
  return json;
}

const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Watch time, shares and subscribers gained per video, from YouTube Analytics (a day or two behind). */
async function analyticsReport(token: string, videoIds: string[], since: number) {
  const rows = new Map<string, Record<string, number | null>>();
  for (const ids of chunks(videoIds, 200)) {
    const params = form({
      ids: 'channel==MINE',
      startDate: ymd(since - 2 * 86400_000),
      endDate: ymd(Date.now()),
      metrics: 'views,averageViewDuration,averageViewPercentage,shares,subscribersGained',
      dimensions: 'video',
      filters: `video==${ids.join(',')}`,
      sort: '-views',
      maxResults: 200,
    });
    const json = await getJson(`https://youtubeanalytics.googleapis.com/v2/reports?${params}`, token);
    const names: string[] = (json.columnHeaders ?? []).map((h: { name: string }) => h.name);
    for (const row of json.rows ?? []) {
      const r = Object.fromEntries(names.map((n, i) => [n, n === 'video' ? row[i] : count(row[i])]));
      rows.set(String(r.video), r);
    }
  }
  return rows;
}

const rangeEnd = (res: Response) => {
  const range = res.headers.get('range');
  return range ? Number(range.split('-')[1]) + 1 : 0;
};

export const youtube: PlatformAdapter = {
  refreshMarginMs: 5 * 60_000,

  authorizeUrl({ app, redirectUri, state, challenge }) {
    return `https://accounts.google.com/o/oauth2/v2/auth?${form({
      client_id: app.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES.join(' '),
      // A refresh token, every time (Google only sends one on consent).
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    })}`;
  },

  exchangeCode: ({ app, redirectUri, code, verifier }) =>
    tokenRequest({ code, client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier }),

  refresh(app, account) {
    if (!account.refreshToken) throw new PlatformError('No Google refresh token.', 'auth');
    return tokenRequest({ client_id: app.clientId, client_secret: app.clientSecret, refresh_token: account.refreshToken, grant_type: 'refresh_token' });
  },

  async profile(token) {
    const res = await request('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: `Bearer ${token}` } });
    const json = await readJson(res);
    if (!res.ok) throw apiError(res.status, json);
    const channel = json.items?.[0];
    if (!channel) throw new PlatformError('This Google account has no YouTube channel. Create one on youtube.com, then connect again.', 'fatal');
    const handle = String(channel.snippet?.customUrl ?? '').replace(/^@/, '');
    return { externalId: channel.id, name: channel.snippet?.title ?? handle, handle, avatarUrl: channel.snippet?.thumbnails?.default?.url ?? null };
  },

  async revoke(_app, account) {
    await request('https://oauth2.googleapis.com/revoke', { method: 'POST', body: form({ token: account.refreshToken ?? account.accessToken }) });
  },

  async publish(ctx) {
    const remote = ctx.remote as { sessionUrl?: string; videoId?: string };
    if (remote.videoId) return done(ctx, { id: remote.videoId });
    const file = mediaPath(ctx.media[0]);
    const { size } = await stat(file);
    let next = 0;

    if (remote.sessionUrl) {
      const status = await uploadStatus(remote.sessionUrl, await ctx.token(), size);
      if (status && 'video' in status) {
        ctx.save({ videoId: status.video.id });
        return done(ctx, status.video);
      }
      if (status) next = status.next;
      else ctx.save({ sessionUrl: undefined });
    }

    if (!ctx.remote.sessionUrl) {
      const { copy, options } = ctx.post;
      ctx.progress('Starting the YouTube upload');
      const res = await request('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await ctx.token()}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Length': String(size),
          'X-Upload-Content-Type': ctx.media[0].mime.startsWith('video/') ? ctx.media[0].mime : 'video/mp4',
        },
        body: JSON.stringify({
          // 22 = People & Blogs, YouTube's default category.
          snippet: { title: clean(copy.title), description: clean(copy.caption), tags: splitTags(copy.tags), categoryId: '22' },
          status: { privacyStatus: options.youtubePrivacy ?? 'public', selfDeclaredMadeForKids: !!options.madeForKids },
        }),
      });
      const location = res.headers.get('location');
      if (!res.ok || !location) throw apiError(res.status, await readJson(res));
      ctx.save({ sessionUrl: location });
      next = 0;
    }

    const sessionUrl = ctx.remote.sessionUrl as string;
    while (next < size) {
      const end = Math.min(next + CHUNK, size) - 1;
      const res = await request(sessionUrl, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${await ctx.token()}`, 'Content-Range': `bytes ${next}-${end}/${size}` },
        body: await readRange(file, next, end),
        timeoutMs: 15 * 60_000,
      });
      if (res.status === 200 || res.status === 201) {
        const video = await readJson(res);
        ctx.save({ videoId: video.id });
        return done(ctx, video);
      }
      if (res.status !== 308) throw apiError(res.status, await readJson(res));
      const before = next;
      next = rangeEnd(res);
      if (next <= before) throw new PlatformError('YouTube didn’t take part of the upload — trying again shortly.', 'retry');
      ctx.progress(`Uploading to YouTube ${percent(next, size)}`);
    }
    // Every byte is there but YouTube hasn't said so: ask it.
    const status = await uploadStatus(sessionUrl, await ctx.token(), size);
    if (status && 'video' in status) {
      ctx.save({ videoId: status.video.id });
      return done(ctx, status.video);
    }
    throw new PlatformError('YouTube didn’t confirm the upload — checking again shortly.', 'retry');
  },

  statsScopes: [ANALYTICS_SCOPE],

  async postStats(token, account, posts) {
    const out = new Map<string, PostStatsResult>();
    const byVideo = new Map(posts.filter((p) => p.externalId).map((p) => [p.externalId!, p]));
    for (const p of posts) if (!p.externalId) out.set(p.id, { note: 'YouTube didn’t say which video this became.' });
    for (const ids of chunks([...byVideo.keys()], 50)) {
      const json = await getJson(`https://www.googleapis.com/youtube/v3/videos?${form({ part: 'statistics', id: ids.join(','), maxResults: 50 })}`, token);
      const found = new Map<string, Record<string, unknown>>((json.items ?? []).map((v: { id: string; statistics?: Record<string, unknown> }) => [v.id, v.statistics ?? {}]));
      for (const id of ids) {
        const st = found.get(id);
        const post = byVideo.get(id)!;
        if (!st) out.set(post.id, { note: 'YouTube doesn’t have this video any more — it may have been deleted.' });
        else out.set(post.id, { stats: { ...emptyStats(), views: count(st.viewCount), likes: count(st.likeCount), comments: count(st.commentCount) } });
      }
    }

    let note: string | undefined;
    const live = [...byVideo].filter(([, p]) => 'stats' in (out.get(p.id) ?? {})).map(([id]) => id);
    if (live.length && !hasScope(account, ANALYTICS_SCOPE)) note = 'Reconnect this YouTube account (Accounts page) to let Content Studio read watch time and shares.';
    else if (live.length) {
      try {
        const since = Math.min(...live.map((id) => byVideo.get(id)!.publishedAt ?? Date.now()));
        const report = await analyticsReport(token, live, since);
        for (const id of live) {
          const r = report.get(id);
          const result = out.get(byVideo.get(id)!.id) as { stats: PostStats };
          if (r) Object.assign(result.stats, { shares: r.shares, avgWatchSeconds: r.averageViewDuration, avgViewPercent: r.averageViewPercentage, followsGained: r.subscribersGained });
        }
      } catch (err) {
        if (!(err instanceof PlatformError) || err.kind === 'retry' || err.kind === 'rate') throw err;
        // Usually the YouTube Analytics API isn't turned on in the Google Cloud project.
        note = `Watch time and shares need the YouTube Analytics API turned on in your Google Cloud project (${err.message.replace(/^YouTube said: /, '').replace(/\.$/, '')}).`;
      }
    }
    return { posts: out, note };
  },

  async accountStats(token) {
    const json = await getJson('https://www.googleapis.com/youtube/v3/channels?part=statistics&mine=true', token);
    const st = json.items?.[0]?.statistics ?? {};
    return { followers: st.hiddenSubscriberCount ? null : count(st.subscriberCount), views: count(st.viewCount), likes: null, posts: count(st.videoCount) };
  },
};
