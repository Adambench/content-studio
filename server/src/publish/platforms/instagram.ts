import { emptyStats } from '../../../../shared/analytics';
import { count, form, oauthError, PlatformError, poll, readJson, request, type PlatformAdapter, type PostStatsResult, type PublishContext, type PublishResult } from './http';

// Instagram API with Instagram Login. https://developers.facebook.com/docs/instagram-platform/content-publishing
const GRAPH = 'https://graph.instagram.com';
const VERSION = 'v25.0';
// Insights: views, reach, shares, saves and watch time. Likes, comments and followers come with the basic permission.
const STATS_SCOPES = ['instagram_business_manage_insights'];
const SCOPES = ['instagram_business_basic', 'instagram_business_content_publish', ...STATS_SCOPES];
const INSIGHTS_RECONNECT = 'Reconnect this Instagram account (Accounts page) to let Content Studio read views, reach and saves.';
// Reels also report average watch time (in milliseconds).
const REEL_METRICS = 'views,reach,likes,comments,shares,saved,ig_reels_avg_watch_time';
const FEED_METRICS = 'views,reach,likes,comments,shares,saved';

function graphError(status: number, body: any) {
  const e = body?.error ?? {};
  const message: string = e.error_user_msg || e.message || body?.raw || `HTTP ${status}`;
  const code = e.code === undefined ? undefined : e.error_subcode ? `${e.code}/${e.error_subcode}` : String(e.code);
  if (e.code === 190 || status === 401) return new PlatformError('Instagram refused the sign-in.', 'auth', undefined, code);
  // Rate limits (app, account and the daily publishing cap).
  if ([4, 17, 32, 613, 80002].includes(e.code) || status === 429) return new PlatformError(`Instagram asked us to slow down (${message}).`, 'rate', 15 * 60_000, code);
  // Media not ready yet, or Instagram's own transient trouble.
  if (e.code === 9007 || e.is_transient || e.code === 1 || e.code === 2 || status >= 500) return new PlatformError(`Instagram had a problem (${message}).`, 'retry', 30_000, code);
  return new PlatformError(`Instagram said: ${message}`, 'fatal', undefined, code);
}

// "Permission denied" / "Permissions error": the sign-in didn't include insights.
const isPermissionError = (err: unknown) => err instanceof PlatformError && (err.code === '10' || err.code === '200' || err.code?.startsWith('10/') || err.code?.startsWith('200/'));
// "Object with ID … does not exist": deleted on Instagram.
const isGone = (err: unknown) => err instanceof PlatformError && err.code === '100/33';

async function graph<T = any>(method: 'GET' | 'POST', path: string, token: string, params: Record<string, string | number | boolean | undefined> = {}): Promise<T> {
  const url = `${GRAPH}/${VERSION}${path}`;
  const body = form({ ...params, access_token: token });
  const res = method === 'GET' ? await request(`${url}?${body}`) : await request(url, { method: 'POST', body });
  const json = await readJson(res);
  if (res.ok && !json.error) return json as T;
  throw graphError(res.status, json);
}

async function waitFor(ctx: PublishContext, containerId: string, what: string) {
  const done = await poll(async () => {
    const c = await graph<{ status_code: string; status?: string }>('GET', `/${containerId}`, await ctx.token(), { fields: 'status_code,status' });
    if (c.status_code === 'FINISHED' || c.status_code === 'PUBLISHED') return c.status_code;
    if (c.status_code === 'ERROR' || c.status_code === 'EXPIRED') {
      ctx.save({ containerId: undefined });
      throw new PlatformError(`Instagram couldn’t process the ${what}${c.status ? ` (${c.status})` : ''}.`, c.status_code === 'EXPIRED' ? 'retry' : 'fatal');
    }
    ctx.progress(`Instagram is processing the ${what}…`);
    return undefined;
  }, 10 * 60_000);
  if (!done) throw new PlatformError(`Instagram is still processing the ${what} — checking again shortly.`, 'retry', 60_000);
  return done;
}

/** Make the containers Instagram publishes from; it downloads the media from our public links. */
async function createContainer(ctx: PublishContext) {
  const token = await ctx.token();
  const ig = `/${ctx.account.externalId}/media`;
  const { caption } = ctx.post.copy;
  if (ctx.post.format === 'video') {
    ctx.progress('Sending the video to Instagram');
    const url = await ctx.publicUrl(ctx.media[0], 'file');
    return (await graph<{ id: string }>('POST', ig, token, { media_type: 'REELS', video_url: url, caption, share_to_feed: ctx.post.options.shareToFeed ?? true })).id;
  }
  const urls = await Promise.all(ctx.media.map((m) => ctx.publicUrl(m, 'instagram')));
  if (urls.length === 1) {
    ctx.progress('Sending the photo to Instagram');
    return (await graph<{ id: string }>('POST', ig, token, { image_url: urls[0], caption })).id;
  }
  ctx.progress('Sending the photos to Instagram');
  const children: string[] = [];
  for (const image_url of urls) children.push((await graph<{ id: string }>('POST', ig, token, { is_carousel_item: true, image_url })).id);
  for (const id of children) await waitFor(ctx, id, 'photos');
  return (await graph<{ id: string }>('POST', ig, token, { media_type: 'CAROUSEL', children: children.join(','), caption })).id;
}

async function finish(ctx: PublishContext, mediaId: string): Promise<PublishResult> {
  const { permalink } = await graph<{ permalink?: string }>('GET', `/${mediaId}`, await ctx.token(), { fields: 'permalink' }).catch(() => ({ permalink: undefined }));
  return { externalId: mediaId, url: permalink ?? (ctx.account.handle ? `https://www.instagram.com/${ctx.account.handle}/` : null), stage: 'Live on Instagram.' };
}

export const instagram: PlatformAdapter = {
  // Long-lived tokens last 60 days and can be refreshed once they're a day old.
  refreshMarginMs: 30 * 24 * 60 * 60_000,

  authorizeUrl({ app, redirectUri, state }) {
    return `https://www.instagram.com/oauth/authorize?${form({ client_id: app.clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.join(','), state, enable_fb_login: 'false' })}`;
  },

  async exchangeCode({ app, redirectUri, code }) {
    // Instagram appends "#_" to the code in the redirect.
    const res = await request('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      body: form({ client_id: app.clientId, client_secret: app.clientSecret, grant_type: 'authorization_code', redirect_uri: redirectUri, code: code.replace(/#_$/, '') }),
    });
    const json = await readJson(res);
    const short = json?.data?.[0] ?? json;
    if (!res.ok || !short?.access_token) throw oauthError('Instagram', res.status, json?.error_message ? { error_description: json.error_message } : json);
    // Swap the one-hour token for a 60-day one.
    const long = await request(`${GRAPH}/access_token?${form({ grant_type: 'ig_exchange_token', client_secret: app.clientSecret, access_token: short.access_token })}`);
    const lj = await readJson(long);
    if (!long.ok || !lj.access_token) throw oauthError('Instagram', long.status, lj);
    const scopes = Array.isArray(short.permissions) ? short.permissions.join(',') : String(short.permissions ?? '');
    return { accessToken: lj.access_token, refreshToken: null, expiresAt: Date.now() + Number(lj.expires_in ?? 5_184_000) * 1000, scopes };
  },

  async refresh(_app, account) {
    const res = await request(`${GRAPH}/refresh_access_token?${form({ grant_type: 'ig_refresh_token', access_token: account.accessToken })}`);
    const json = await readJson(res);
    if (!res.ok || !json.access_token) throw json?.error?.code === 190 ? new PlatformError('Instagram refused the sign-in.', 'auth') : oauthError('Instagram', res.status, json);
    return { accessToken: json.access_token, expiresAt: Date.now() + Number(json.expires_in ?? 5_184_000) * 1000 };
  },

  async profile(token) {
    const me = await graph<{ user_id: string; username: string; name?: string; profile_picture_url?: string; account_type?: string }>('GET', '/me', token, {
      fields: 'user_id,username,name,profile_picture_url,account_type',
    });
    return { externalId: String(me.user_id), name: me.name || me.username, handle: me.username, avatarUrl: me.profile_picture_url ?? null };
  },

  async publish(ctx) {
    const remote = ctx.remote as { containerId?: string; mediaId?: string; startedAt?: number };
    if (remote.mediaId) return finish(ctx, remote.mediaId);
    const ig = ctx.account.externalId;

    if (remote.containerId) {
      const status = await waitFor(ctx, remote.containerId, ctx.post.format === 'video' ? 'video' : 'photos').catch((err) => {
        if (err instanceof PlatformError && err.kind === 'fatal') return null;
        throw err;
      });
      // The last attempt published it but didn't hear back: find the post rather than posting again.
      if (status === 'PUBLISHED') {
        const recent = await graph<{ data: { id: string; timestamp: string }[] }>('GET', `/${ig}/media`, await ctx.token(), { fields: 'id,timestamp', limit: 5 });
        const mine = recent.data.find((m) => Date.parse(m.timestamp) >= (remote.startedAt ?? 0) - 60_000) ?? recent.data[0];
        if (mine) {
          ctx.save({ mediaId: mine.id });
          return finish(ctx, mine.id);
        }
      }
      if (status !== 'FINISHED') ctx.save({ containerId: undefined });
    }

    if (!ctx.remote.containerId) {
      const containerId = await createContainer(ctx);
      ctx.save({ containerId, startedAt: Date.now() });
      await waitFor(ctx, containerId, ctx.post.format === 'video' ? 'video' : 'photos');
    }

    const limit = await graph<{ data: { quota_usage: number; config?: { quota_total: number } }[] }>('GET', `/${ig}/content_publishing_limit`, await ctx.token(), { fields: 'quota_usage,config' }).catch(() => null);
    const quota = limit?.data?.[0];
    if (quota?.config && quota.quota_usage >= quota.config.quota_total) {
      throw new PlatformError(`Instagram’s limit of ${quota.config.quota_total} posts a day through apps is used up — trying again in an hour.`, 'rate', 60 * 60_000);
    }

    ctx.progress('Publishing on Instagram');
    const { id } = await graph<{ id: string }>('POST', `/${ig}/media_publish`, await ctx.token(), { creation_id: ctx.remote.containerId as string });
    ctx.save({ mediaId: id });
    return finish(ctx, id);
  },

  statsScopes: STATS_SCOPES,

  async postStats(token, _account, posts) {
    const out = new Map<string, PostStatsResult>();
    let note: string | undefined;
    for (const p of posts) {
      if (!p.externalId) {
        out.set(p.id, { note: 'Instagram didn’t say which post this became.' });
        continue;
      }
      try {
        const m = await graph<{ like_count?: number; comments_count?: number; permalink?: string }>('GET', `/${p.externalId}`, token, { fields: 'like_count,comments_count,permalink' });
        const stats = { ...emptyStats(), likes: count(m.like_count), comments: count(m.comments_count) };
        if (note !== INSIGHTS_RECONNECT) {
          try {
            const { data } = await graph<{ data: { name: string; values?: { value: unknown }[]; total_value?: { value: unknown } }[] }>('GET', `/${p.externalId}/insights`, token, {
              metric: p.format === 'video' ? REEL_METRICS : FEED_METRICS,
            });
            const v = Object.fromEntries(data.map((d) => [d.name, count(d.values?.[0]?.value ?? d.total_value?.value)]));
            const watchMs = v.ig_reels_avg_watch_time;
            Object.assign(stats, {
              views: v.views ?? null,
              reach: v.reach ?? null,
              likes: v.likes ?? stats.likes,
              comments: v.comments ?? stats.comments,
              shares: v.shares ?? null,
              saves: v.saved ?? null,
              avgWatchSeconds: watchMs == null ? null : watchMs / 1000,
            });
          } catch (err) {
            if (!isPermissionError(err)) throw err;
            note = INSIGHTS_RECONNECT;
          }
        }
        out.set(p.id, m.permalink && m.permalink !== p.url ? { stats, url: m.permalink } : { stats });
      } catch (err) {
        out.set(p.id, { note: isGone(err) ? 'Instagram doesn’t have this post any more — it may have been deleted.' : (err as Error).message });
      }
    }
    return { posts: out, note };
  },

  async accountStats(token) {
    const me = await graph<{ followers_count?: number; media_count?: number }>('GET', '/me', token, { fields: 'followers_count,media_count' });
    return { followers: count(me.followers_count), views: null, likes: null, posts: count(me.media_count) };
  },
};
