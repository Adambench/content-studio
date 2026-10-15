import { stat } from 'node:fs/promises';
import { emptyStats } from '../../../../shared/analytics';
import type { CreatorInfo, TikTokPrivacy } from '../../../../shared/publish';
import { mediaPath } from '../../services/media';
import {
  chunks,
  count,
  form,
  oauthError,
  percent,
  PlatformError,
  poll,
  readJson,
  readRange,
  request,
  type PlatformAdapter,
  type PostStatsResult,
  type PublishContext,
  type PublishResult,
} from './http';

// TikTok Login Kit + Content Posting API (v2). https://developers.tiktok.com/doc/content-posting-api-get-started
const API = 'https://open.tiktokapis.com';
// video.list and user.info.stats are for analytics: a video's views, likes, comments and shares; the account's followers.
const STATS_SCOPES = ['video.list', 'user.info.stats'];
const SCOPES = ['user.info.basic', 'video.upload', 'video.publish', ...STATS_SCOPES];

type Status = { status: 'PROCESSING_UPLOAD' | 'PROCESSING_DOWNLOAD' | 'SEND_TO_USER_INBOX' | 'PUBLISH_COMPLETE' | 'FAILED'; fail_reason?: string; publicaly_available_post_id?: (string | number)[]; uploaded_bytes?: number };

const ERRORS: Record<string, { message: string; kind?: PlatformError['kind']; delayMs?: number }> = {
  access_token_invalid: { message: 'TikTok refused the sign-in.', kind: 'auth' },
  scope_not_authorized: { message: 'This TikTok account didn’t allow posting. Reconnect it and allow every permission.' },
  rate_limit_exceeded: { message: 'TikTok asked us to slow down.', kind: 'rate', delayMs: 2 * 60_000 },
  spam_risk_too_many_posts: { message: 'TikTok’s daily limit of posts through apps is reached for this account. Post it from the TikTok app, or try again tomorrow.' },
  spam_risk_too_many_pending_share: { message: 'TikTok allows 5 unfinished drafts in your inbox per day. Finish or delete some in the TikTok app, then try again.' },
  spam_risk_user_banned_from_posting: { message: 'TikTok has blocked this account from posting.' },
  reached_active_user_cap: { message: 'The TikTok developer app reached its daily limit of posting users. Try again tomorrow.' },
  unaudited_client_can_only_post_to_private_accounts: {
    message: 'Until TikTok audits your developer app it can only post to private accounts. Switch this account to “Send to TikTok inbox” (Accounts page), or make the TikTok account private.',
  },
  url_ownership_unverified: { message: 'TikTok hasn’t verified your public address yet. Verify it in the TikTok developer portal (Settings → Publishing explains how).' },
  privacy_level_option_mismatch: { message: 'That TikTok visibility isn’t available for this account any more. Choose it again.' },
  app_version_check_failed: { message: 'Update the TikTok app on your phone (version 31.8 or later is needed for drafts).' },
};

const FAIL_REASONS: Record<string, string> = {
  file_format_check_failed: 'TikTok can’t read this video’s format.',
  duration_check_failed: 'The video is too long or too short for this TikTok account.',
  frame_rate_check_failed: 'TikTok doesn’t accept this video’s frame rate.',
  picture_size_check_failed: 'TikTok doesn’t accept this video’s or photo’s size.',
  video_pull_failed: 'TikTok couldn’t download the video from your public address.',
  photo_pull_failed: 'TikTok couldn’t download the photos from your public address.',
  publish_cancelled: 'The post was cancelled.',
  auth_removed: 'Content Studio’s access to this TikTok account was removed.',
  spam_risk_too_many_posts: 'TikTok’s daily limit of posts through apps is reached for this account.',
  spam_risk_user_banned_from_posting: 'TikTok has blocked this account from posting.',
  spam_risk_text: 'TikTok flagged the caption as risky.',
  spam_risk: 'TikTok flagged the post as risky.',
};
// Worth another go: TikTok's own hiccups, and downloads that may work once the address is reachable.
const RETRYABLE_FAILS = new Set(['internal', 'video_pull_failed', 'photo_pull_failed']);

// Reading stats: a missing permission means the account was connected before stats were asked for.
const STATS_RECONNECT = 'Reconnect this TikTok account (Accounts page) to let Content Studio read its stats.';
const STATS_ERRORS = { ...ERRORS, scope_not_authorized: { message: STATS_RECONNECT } };

function apiError(status: number, body: any, errors = ERRORS) {
  const code: string | undefined = body?.error?.code;
  const known = code ? errors[code] : undefined;
  if (known) return new PlatformError(known.message, known.kind ?? 'fatal', known.delayMs, code);
  const detail = body?.error?.message || code || body?.raw || `HTTP ${status}`;
  if (status >= 500 || status === 429) return new PlatformError(`TikTok had a problem (${detail}).`, status === 429 ? 'rate' : 'retry', 60_000, code);
  if (status === 401) return new PlatformError('TikTok refused the sign-in.', 'auth', undefined, code);
  return new PlatformError(`TikTok said: ${detail}`, 'fatal', undefined, code);
}

// Post and video ids are 64-bit integers, too big for JavaScript numbers: read them as strings.
const quoteIds = (text: string) =>
  text
    .replace(/("publicaly_available_post_id"\s*:\s*\[)([^\]]*)\]/g, (_, head: string, ids: string) => `${head}${ids.replace(/\d+/g, '"$&"')}]`)
    .replace(/("id"\s*:\s*)(\d{16,})/g, '$1"$2"');

async function call<T>(token: string, path: string, body?: unknown, method = 'POST', errors = ERRORS): Promise<T> {
  const res = await request(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(method === 'POST' && { 'Content-Type': 'application/json; charset=UTF-8' }) },
    body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
  });
  const json = await readJson(res, quoteIds);
  const code = json?.error?.code;
  if (res.ok && (!code || code === 'ok')) return json.data as T;
  throw apiError(res.status, json, errors);
}

async function tokenRequest(params: Record<string, string>) {
  const res = await request(`${API}/v2/oauth/token/`, { method: 'POST', body: form(params) });
  const json = await readJson(res);
  if (!res.ok || !json.access_token) throw oauthError('TikTok', res.status, json);
  return {
    accessToken: json.access_token as string,
    refreshToken: json.refresh_token as string,
    expiresAt: Date.now() + Number(json.expires_in ?? 86400) * 1000,
    refreshExpiresAt: json.refresh_expires_in ? Date.now() + Number(json.refresh_expires_in) * 1000 : null,
    scopes: String(json.scope ?? ''),
  };
}

export async function creatorInfo(token: string): Promise<CreatorInfo> {
  const d = await call<any>(token, '/v2/post/publish/creator_info/query/', {});
  return {
    nickname: d.creator_nickname ?? '',
    username: d.creator_username ?? '',
    avatarUrl: d.creator_avatar_url ?? '',
    privacyOptions: d.privacy_level_options ?? [],
    commentDisabled: !!d.comment_disabled,
    duetDisabled: !!d.duet_disabled,
    stitchDisabled: !!d.stitch_disabled,
    maxVideoSeconds: Number(d.max_video_post_duration_sec ?? 600),
  };
}

/** TikTok's chunk rules: 5–64 MB chunks (the last may be bigger, up to 128 MB); anything up to 64 MB goes in one. */
export function chunking(size: number) {
  const chunkSize = size <= 64 * 1024 ** 2 ? size : 10 * 1024 ** 2;
  return { chunkSize, count: Math.floor(size / chunkSize) };
}

const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm'];

async function upload(url: string, file: string, mime: string, size: number, progress: (s: string) => void) {
  const { chunkSize, count } = chunking(size);
  for (let i = 0; i < count; i++) {
    const start = i * chunkSize;
    const end = i === count - 1 ? size - 1 : start + chunkSize - 1;
    const res = await request(url, {
      method: 'PUT',
      headers: { 'Content-Type': VIDEO_TYPES.includes(mime) ? mime : 'video/mp4', 'Content-Range': `bytes ${start}-${end}/${size}` },
      body: await readRange(file, start, end),
      timeoutMs: 15 * 60_000,
    });
    if (res.status === 403 || res.status === 404) throw new PlatformError('TikTok’s upload link expired; starting the upload again.', 'retry', 5000);
    if (res.status !== 201 && res.status !== 206) throw new PlatformError(`TikTok rejected part of the upload (HTTP ${res.status}).`, res.status >= 500 ? 'retry' : 'fatal');
    progress(`Uploading to TikTok ${percent(end + 1, size)}`);
  }
}

const profileUrl = (handle: string) => (handle ? `https://www.tiktok.com/@${handle}` : null);
const videoUrl = (handle: string, id: string) => (handle ? `https://www.tiktok.com/@${handle}/video/${id}` : null);

/** TikTok video ids are long numbers; publish ids (what a draft or a post still in review has) aren't. */
export const isVideoId = (id: string | null | undefined): id is string => !!id && /^\d{6,}$/.test(id);

/** Why a publish has no public video (yet), from its status. */
function unpublishedNote(s: Status) {
  if (s.status === 'SEND_TO_USER_INBOX') return 'Still in your TikTok inbox — stats start once you post it from the TikTok app.';
  if (s.status === 'PUBLISH_COMPLETE') return 'TikTok only shares stats for public videos, once it has reviewed them. If it’s public, paste its link here.';
  if (s.status === 'FAILED') return `TikTok says it didn’t post (${s.fail_reason ?? 'no reason given'}).`;
  return 'TikTok is still processing it.';
}

/** Wait for TikTok to finish with a publish: the draft lands in the inbox, or the post goes live. */
async function settle(ctx: PublishContext, publishId: string, inbox: boolean): Promise<PublishResult> {
  const handle = ctx.account.handle;
  const final = await poll(async () => {
    const s = await call<Status>(await ctx.token(), '/v2/post/publish/status/fetch/', { publish_id: publishId });
    if (s.status === 'FAILED') {
      const reason = s.fail_reason ?? 'unknown';
      ctx.save({ publishId: undefined });
      throw new PlatformError(FAIL_REASONS[reason] ?? `TikTok couldn’t post it (${reason}).`, RETRYABLE_FAILS.has(reason) ? 'retry' : 'fatal');
    }
    if (s.status === 'SEND_TO_USER_INBOX' || s.status === 'PUBLISH_COMPLETE') return s;
    ctx.progress('TikTok is processing it…');
    return undefined;
  }, 10 * 60_000);
  if (!final) throw new PlatformError('TikTok is still processing it — checking again shortly.', 'retry', 60_000);

  if (final.status === 'SEND_TO_USER_INBOX') {
    const finish = ctx.post.format === 'video' ? 'open TikTok, paste the caption and post it' : 'open TikTok to finish and post it';
    return { externalId: publishId, url: profileUrl(handle), stage: `In your TikTok inbox — ${finish}.` };
  }
  const postId = final.publicaly_available_post_id?.[0];
  if (postId && handle) return { externalId: String(postId), url: videoUrl(handle, String(postId)), stage: 'Live on TikTok.' };
  return { externalId: publishId, url: profileUrl(handle), stage: inbox ? 'Posted from your TikTok inbox.' : 'Posted — it can take a few minutes to show on your TikTok profile.' };
}

function postInfo(ctx: PublishContext, info: CreatorInfo, photo: boolean) {
  const o = ctx.post.options;
  if (!o.tiktokPrivacy || !info.privacyOptions.includes(o.tiktokPrivacy)) throw new PlatformError(ERRORS.privacy_level_option_mismatch.message, 'fatal');
  return {
    privacy_level: o.tiktokPrivacy as TikTokPrivacy,
    // Interactions are only allowed where the creator's own TikTok settings allow them.
    disable_comment: !o.allowComments || info.commentDisabled,
    ...(!photo && { disable_duet: !o.allowDuet || info.duetDisabled, disable_stitch: !o.allowStitch || info.stitchDisabled }),
    brand_organic_toggle: !!(o.discloseContent && o.yourBrand),
    brand_content_toggle: !!(o.discloseContent && o.brandedContent),
  };
}

async function publishVideo(ctx: PublishContext, direct: boolean): Promise<PublishResult> {
  const remote = ctx.remote as { publishId?: string; uploaded?: boolean; size?: number };
  const video = ctx.media[0];
  const file = mediaPath(video);
  const { size } = await stat(file);

  if (remote.publishId) {
    const s = await call<Status>(await ctx.token(), '/v2/post/publish/status/fetch/', { publish_id: remote.publishId });
    const uploaded = remote.uploaded || (remote.size !== undefined && (s.uploaded_bytes ?? 0) >= remote.size);
    // An unfinished upload never posts, so starting again can't double-post.
    if (s.status === 'FAILED' || (s.status === 'PROCESSING_UPLOAD' && !uploaded)) ctx.save({ publishId: undefined, uploaded: false });
    else return settle(ctx, remote.publishId, !direct);
  }

  const token = await ctx.token();
  let post_info: Record<string, unknown> | undefined;
  if (direct) {
    const info = await creatorInfo(token);
    const seconds = (video.durationMs ?? 0) / 1000;
    if (seconds > info.maxVideoSeconds) throw new PlatformError(`This TikTok account can post videos up to ${Math.floor(info.maxVideoSeconds / 60)} min ${info.maxVideoSeconds % 60} s.`, 'fatal');
    post_info = { title: ctx.post.copy.caption, ...postInfo(ctx, info, false), is_aigc: !!ctx.post.options.aiGenerated };
  }
  const { chunkSize, count } = chunking(size);
  ctx.progress('Starting the TikTok upload');
  const init = await call<{ publish_id: string; upload_url: string }>(token, direct ? '/v2/post/publish/video/init/' : '/v2/post/publish/inbox/video/init/', {
    ...(post_info && { post_info }),
    source_info: { source: 'FILE_UPLOAD', video_size: size, chunk_size: chunkSize, total_chunk_count: count },
  });
  ctx.save({ publishId: init.publish_id, uploaded: false, size });
  await upload(init.upload_url, file, video.mime, size, ctx.progress);
  ctx.save({ uploaded: true });
  return settle(ctx, init.publish_id, !direct);
}

async function publishPhotos(ctx: PublishContext, direct: boolean): Promise<PublishResult> {
  const remote = ctx.remote as { publishId?: string };
  if (remote.publishId) return settle(ctx, remote.publishId, !direct);
  const token = await ctx.token();
  const { copy, options } = ctx.post;
  const images = await Promise.all(ctx.media.map((m) => ctx.publicUrl(m, 'tiktok')));
  ctx.progress('Sending the photos to TikTok');
  const init = await call<{ publish_id: string }>(token, '/v2/post/publish/content/init/', {
    media_type: 'PHOTO',
    post_mode: direct ? 'DIRECT_POST' : 'MEDIA_UPLOAD',
    post_info: { title: copy.title, description: copy.caption, ...(direct && { ...postInfo(ctx, await creatorInfo(token), true), auto_add_music: !!options.autoAddMusic }) },
    source_info: { source: 'PULL_FROM_URL', photo_cover_index: 0, photo_images: images },
    ...(direct && options.aiGenerated && { is_aigc: true }),
  });
  ctx.save({ publishId: init.publish_id });
  return settle(ctx, init.publish_id, !direct);
}

export const tiktok: PlatformAdapter = {
  refreshMarginMs: 10 * 60_000,

  authorizeUrl({ app, redirectUri, state }) {
    return `https://www.tiktok.com/v2/auth/authorize/?${form({ client_key: app.clientId, response_type: 'code', scope: SCOPES.join(','), redirect_uri: redirectUri, state })}`;
  },

  exchangeCode: ({ app, redirectUri, code }) =>
    tokenRequest({ client_key: app.clientId, client_secret: app.clientSecret, code, grant_type: 'authorization_code', redirect_uri: redirectUri }),

  refresh: (app, account) => {
    if (!account.refreshToken) throw new PlatformError('No TikTok refresh token.', 'auth');
    return tokenRequest({ client_key: app.clientId, client_secret: app.clientSecret, grant_type: 'refresh_token', refresh_token: account.refreshToken });
  },

  async profile(token) {
    const { user } = await call<{ user: { open_id: string; display_name?: string; avatar_url?: string } }>(token, '/v2/user/info/?fields=open_id,display_name,avatar_url', undefined, 'GET');
    // The @username comes with the posting permission; without it the display name has to do.
    const username = await creatorInfo(token).then(
      (i) => i.username,
      () => '',
    );
    return { externalId: user.open_id, name: user.display_name ?? username, handle: username, avatarUrl: user.avatar_url ?? null };
  },

  async revoke(app, account) {
    await request(`${API}/v2/oauth/revoke/`, { method: 'POST', body: form({ client_key: app.clientId, client_secret: app.clientSecret, token: account.accessToken }) });
  },

  publish(ctx) {
    const direct = ctx.account.settings.tiktokMode === 'direct';
    return ctx.post.format === 'photo' ? publishPhotos(ctx, direct) : publishVideo(ctx, direct);
  },

  statsScopes: STATS_SCOPES,

  async postStats(token, account, posts) {
    const out = new Map<string, PostStatsResult>();
    const byVideo = new Map<string, (typeof posts)[number]>();
    for (const p of posts) {
      if (isVideoId(p.externalId)) {
        byVideo.set(p.externalId, p);
        continue;
      }
      // An inbox draft, or a post TikTok hadn't finished reviewing: ask what became of it.
      const publishId = (p.remote as { publishId?: string }).publishId ?? p.externalId;
      if (!publishId) {
        out.set(p.id, { note: 'TikTok didn’t say which video this became. Paste its link here to see its stats.' });
        continue;
      }
      try {
        const s = await call<Status>(token, '/v2/post/publish/status/fetch/', { publish_id: publishId });
        const videoId = s.publicaly_available_post_id?.[0];
        if (videoId) byVideo.set(String(videoId), p);
        else out.set(p.id, { note: unpublishedNote(s) });
      } catch (err) {
        out.set(p.id, { note: (err as Error).message });
      }
    }
    let note: string | undefined;
    for (const ids of chunks([...byVideo.keys()], 20)) {
      try {
        const data = await call<{ videos?: Record<string, unknown>[] }>(token, '/v2/video/query/?fields=id,view_count,like_count,comment_count,share_count,share_url', { filters: { video_ids: ids } }, 'POST', STATS_ERRORS);
        const found = new Map((data.videos ?? []).map((v) => [String(v.id), v]));
        for (const id of ids) {
          const p = byVideo.get(id)!;
          const v = found.get(id);
          if (!v) {
            out.set(p.id, { note: 'TikTok doesn’t return this video — it may be private or deleted.' });
            continue;
          }
          const stats = { ...emptyStats(), views: count(v.view_count), likes: count(v.like_count), comments: count(v.comment_count), shares: count(v.share_count) };
          out.set(p.id, p.externalId === id ? { stats } : { stats, externalId: id, url: videoUrl(account.handle, id) ?? String(v.share_url ?? '') });
        }
      } catch (err) {
        if (err instanceof PlatformError && err.code === 'scope_not_authorized') note = STATS_RECONNECT;
        for (const id of ids) out.set(byVideo.get(id)!.id, { note: (err as Error).message });
      }
    }
    return { posts: out, note };
  },

  async accountStats(token) {
    const { user } = await call<{ user: Record<string, unknown> }>(token, '/v2/user/info/?fields=follower_count,likes_count,video_count', undefined, 'GET', STATS_ERRORS);
    return { followers: count(user.follower_count), views: null, likes: count(user.likes_count), posts: count(user.video_count) };
  },
};
