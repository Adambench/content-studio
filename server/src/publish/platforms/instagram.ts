import { emptyStats } from '../../../../shared/analytics';
import { count, form, oauthError, PlatformError, poll, readJson, request, sleep, type PlatformAdapter, type PostStatsResult, type Profile, type PublishContext, type PublishResult } from './http';

// Instagram API with Unified Login: new Meta apps no longer get Instagram Login. Sign-in is Facebook Login for Business
// with a configuration (its permissions and the Instagram account picked in the dialog); the token belongs to a system
// user of my business portfolio, covers every account shared with the app, and doesn't expire.
// https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login
const GRAPH = 'https://graph.facebook.com';
const VERSION = 'v26.0';
// Insights: views, reach, shares, saves and watch time. Likes, comments and followers come with instagram_basic.
const STATS_SCOPES = ['instagram_manage_insights'];
const INSIGHTS_RECONNECT = 'Add instagram_manage_insights to the configuration in your Meta app, then reconnect this Instagram account (Accounts page) to let Content Studio read views, reach and saves.';
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

type DebugToken = { type?: string; scopes?: string[]; granular_scopes?: { scope: string; target_ids?: string[] }[]; expires_at?: number };

async function igProfile(token: string, id: string, username = ''): Promise<Profile> {
  const ig = await graph<{ username?: string; name?: string; profile_picture_url?: string }>('GET', `/${id}`, token, { fields: 'username,name,profile_picture_url' }).catch(() => ({ username, name: undefined, profile_picture_url: undefined }));
  const handle = ig.username || username;
  return { externalId: id, name: ig.name || handle, handle, avatarUrl: ig.profile_picture_url ?? null };
}

export const instagram: PlatformAdapter = {
  // The configuration's token doesn't expire, so this only matters if it was set up to.
  refreshMarginMs: 24 * 60 * 60_000,

  authorizeUrl({ app, redirectUri, state }) {
    if (!app.configId) throw new PlatformError('Add the configuration ID of your Meta app in Settings → Publishing → Instagram first.', 'fatal');
    return `https://www.facebook.com/dialog/oauth?${form({ client_id: app.clientId, config_id: app.configId, redirect_uri: redirectUri, response_type: 'code', state })}`;
  },

  async exchangeCode({ app, redirectUri, code }) {
    const res = await request(`${GRAPH}/${VERSION}/oauth/access_token?${form({ client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: redirectUri, code })}`);
    const json = await readJson(res);
    if (!res.ok || !json?.access_token) throw oauthError('Instagram', res.status, json);
    // The token doesn't say what it may do; ask with the app's own token.
    const debug = await graph<{ data?: DebugToken }>('GET', '/debug_token', `${app.clientId}|${app.clientSecret}`, { input_token: json.access_token }).catch((err) => {
      console.warn(`[instagram] debug_token failed: ${(err as Error).message}`);
      return null;
    });
    const d = debug?.data;
    const expiresAt = d?.expires_at ? d.expires_at * 1000 : json.expires_in ? Date.now() + Number(json.expires_in) * 1000 : null;
    // The accounts picked in the dialog, per permission (some of these may be Pages; profiles() drops those).
    const accountIds = [...new Set((d?.granular_scopes ?? []).filter((g) => g.scope.startsWith('instagram_')).flatMap((g) => g.target_ids ?? []).map(String))];
    if (d) console.log(`[instagram] sign-in: ${JSON.stringify({ type: d.type, scopes: d.scopes, granular_scopes: d.granular_scopes, expires_at: d.expires_at })}`);
    return { accessToken: json.access_token, refreshToken: null, expiresAt, scopes: d?.scopes?.join(',') ?? '', accountIds };
  },

  async refresh() {
    throw new PlatformError('Instagram’s sign-in has run out. Reconnect the account (Accounts page).', 'auth');
  },

  async profile(token, account) {
    if (account) return igProfile(token, account.externalId, account.handle);
    const [first] = await instagram.profiles!(token);
    if (!first) throw new PlatformError('Instagram didn’t share any account. Connect again and pick one.', 'fatal');
    return first;
  },

  // One sign-in can share several accounts (all of the business portfolio's that I picked so far). Meta's docs only
  // name /me/assigned_instagram_accounts; the permission grants and (for a configuration that gives a user token) the
  // Pages' linked accounts are fallbacks.
  async profiles(token, accountIds = []) {
    const found = new Map<string, string>();
    const tried: string[] = [];
    // Asked again once after a pause, in case Meta is still assigning what was just shared.
    for (const pause of [0, 4000]) {
      if (found.size) break;
      await sleep(pause);
      try {
        const { data } = await graph<{ data: { id: string; username?: string }[] }>('GET', '/me/assigned_instagram_accounts', token, { fields: 'id,username', limit: 100 });
        for (const a of data) found.set(String(a.id), a.username ?? '');
        tried.push(`assigned_instagram_accounts: ${data.length}`);
      } catch (err) {
        tried.push(`assigned_instagram_accounts: ${(err as Error).message}`);
      }
    }
    for (const id of accountIds) if (!found.has(id)) found.set(id, '');
    if (!found.size) {
      try {
        const { data } = await graph<{ data: { id: string; instagram_business_account?: { id: string; username?: string } }[] }>('GET', '/me/accounts', token, { fields: 'instagram_business_account{id,username}', limit: 100 });
        for (const { instagram_business_account: ig } of data) if (ig) found.set(String(ig.id), ig.username ?? '');
        tried.push(`pages: ${data.length}, with Instagram: ${found.size}`);
      } catch (err) {
        tried.push(`pages: ${(err as Error).message}`);
      }
    }
    // An id that isn't an Instagram account (a Page from the grants) has no username.
    const profiles = (await Promise.all([...found].map(([id, username]) => igProfile(token, id, username)))).filter((p) => p.handle);
    if (!profiles.length) {
      const me = await graph('GET', '/me', token, { fields: 'id,name,client_business_id' }).catch((err) => (err as Error).message);
      console.warn(`[instagram] the sign-in shared no Instagram account (${tried.join('; ')}; granted ids: ${accountIds.join(',') || 'none'}; me: ${JSON.stringify(me)})`);
      throw new PlatformError(
        'Meta’s sign-in worked, but no Instagram account came with it. While the Meta app is unpublished, the account must be an Instagram Tester of it: in the app, Unified login → Generate access tokens → Add account; then on instagram.com, signed in as that account, Settings → Website permissions → Apps and websites → Tester invites → Accept. Then connect again and tick the account.',
        'fatal',
      );
    }
    return profiles;
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

  async accountStats(token, account) {
    const me = await graph<{ followers_count?: number; media_count?: number }>('GET', `/${account.externalId}`, token, { fields: 'followers_count,media_count' });
    return { followers: count(me.followers_count), views: null, likes: null, posts: count(me.media_count) };
  },
};
