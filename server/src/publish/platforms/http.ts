import { open } from 'node:fs/promises';
import type { AccountStats, PostStats } from '../../../../shared/analytics';
import type { AccountSettings, PostCopy, PostOptions } from '../../../../shared/publish';
import type { schema } from '../../db';
import type { MediaRow } from '../../services/media';

export type AccountRow = typeof schema.accounts.$inferSelect;
export type PostRow = typeof schema.posts.$inferSelect;
/** A platform's developer app. `configId`: the Facebook Login for Business configuration Instagram signs in with. */
export type AppCredentials = { clientId: string; clientSecret: string; configId?: string };
export type TokenSet = { accessToken: string; refreshToken?: string | null; expiresAt?: number | null; refreshExpiresAt?: number | null; scopes?: string };
export type Profile = { externalId: string; name: string; handle: string; avatarUrl: string | null };

/** Everything a platform needs to publish one post; `remote` and `save` let a retry resume where the last attempt stopped. */
export type PublishContext = {
  post: PostRow & { copy: PostCopy; options: PostOptions };
  account: AccountRow & { settings: AccountSettings };
  media: MediaRow[];
  /** A valid access token (refreshed when it's about to expire). */
  token: () => Promise<string>;
  progress: (stage: string) => void;
  remote: Record<string, unknown>;
  save: (patch: Record<string, unknown>) => void;
  /** A short-lived public HTTPS link to a file, for platforms that download media themselves. */
  publicUrl: (m: MediaRow, variant: 'file' | 'instagram' | 'tiktok') => Promise<string>;
};

export type PublishResult = { externalId: string | null; url: string | null; stage: string };

/**
 * What a platform says about one published post now: its numbers (and its real id and link, when those only became
 * known later — a TikTok draft posted from the inbox), or why there are none.
 */
export type PostStatsResult = { stats: PostStats; externalId?: string; url?: string } | { note: string };

/** Numbers for published posts of one account. `note` says why some numbers are missing for the whole account. */
export type StatsBatch = { posts: Map<string, PostStatsResult>; note?: string };

export type PlatformAdapter = {
  /** Refresh access tokens this long before they expire. */
  refreshMarginMs: number;
  authorizeUrl(input: { app: AppCredentials; redirectUri: string; state: string; challenge: string }): string;
  exchangeCode(input: { app: AppCredentials; redirectUri: string; code: string; verifier: string }): Promise<TokenSet>;
  refresh(app: AppCredentials, account: AccountRow): Promise<TokenSet>;
  /** The signed-in account, or (when one token covers several) the given one. */
  profile(accessToken: string, account?: Pick<AccountRow, 'externalId' | 'handle'>): Promise<Profile>;
  /** Every account a token covers, for platforms where one sign-in can share several. */
  profiles?(accessToken: string): Promise<Profile[]>;
  revoke?(app: AppCredentials, account: AccountRow): Promise<void>;
  publish(ctx: PublishContext): Promise<PublishResult>;
  /** Permissions needed to read stats. Accounts connected before they were asked for need reconnecting. */
  statsScopes: string[];
  postStats(token: string, account: AccountRow, posts: PostRow[]): Promise<StatsBatch>;
  accountStats(token: string, account: AccountRow): Promise<AccountStats>;
};

/** Whether the account's sign-in included a permission (platforms list them with commas or spaces). */
export const hasScope = (account: Pick<AccountRow, 'scopes'>, scope: string) => account.scopes.split(/[\s,]+/).includes(scope);

export function chunks<T>(items: T[], size: number) {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, i * size + size));
}

/** A count from an API that may send numbers as strings, or leave them out. */
export const count = (v: unknown) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

/**
 * A failure talking to a platform. `auth`: the token was refused (refresh, or reconnect the account); `retry`: try
 * again soon; `rate`: try again after `delayMs`; `fatal`: trying again won't help until something changes. `code` is
 * the platform's own error code, when it gave one.
 */
export class PlatformError extends Error {
  constructor(
    message: string,
    public kind: 'auth' | 'retry' | 'rate' | 'fatal',
    public delayMs?: number,
    public code?: string,
  ) {
    super(message);
  }
}

// Tests point every platform at a local stand-in: CS_PLATFORM_API=http://127.0.0.1:9911 sends
// https://open.tiktokapis.com/v2/… to http://127.0.0.1:9911/open.tiktokapis.com/v2/….
const override = process.env.CS_PLATFORM_API?.replace(/\/$/, '');

export function platformUrl(url: string) {
  if (!override || url.startsWith(override)) return url;
  const u = new URL(url);
  return `${override}/${u.host}${u.pathname}${u.search}`;
}

export async function request(url: string, init: RequestInit & { timeoutMs?: number } = {}) {
  const { timeoutMs = 60_000, ...rest } = init;
  try {
    return await fetch(platformUrl(url), { ...rest, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    const host = new URL(url).host;
    throw new PlatformError(`Couldn’t reach ${host} (${(err as Error).message}).`, 'retry');
  }
}

export async function readJson(res: Response, transform?: (text: string) => string): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(transform ? transform(text) : text);
  } catch {
    return { raw: text.slice(0, 300) };
  }
}

/** Form-encode the defined values. */
export function form(params: Record<string, string | number | boolean | null | undefined>) {
  return new URLSearchParams(Object.entries(params).flatMap(([k, v]) => (v === undefined || v === null ? [] : [[k, String(v)]])));
}

/** An OAuth token endpoint's error (`{ error, error_description }`): a refused grant means signing in again. */
export function oauthError(platform: string, status: number, body: any) {
  const code = typeof body?.error === 'string' ? body.error : body?.error?.code;
  const message = body?.error_description ?? body?.error?.message ?? body?.raw ?? `HTTP ${status}`;
  if (status >= 500) return new PlatformError(`${platform} sign-in service failed (${message}).`, 'retry');
  if (code === 'invalid_grant' || status === 400 || status === 401) return new PlatformError(`${platform} refused the sign-in (${message}).`, 'auth');
  return new PlatformError(`${platform} sign-in failed (${message}).`, 'fatal');
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Poll `check` (which returns a value once done) with growing pauses, up to `timeoutMs`. */
export async function poll<T>(check: () => Promise<T | undefined>, timeoutMs: number, firstDelayMs = 3000): Promise<T | undefined> {
  const until = Date.now() + timeoutMs;
  let delay = firstDelayMs;
  while (Date.now() < until) {
    const result = await check();
    if (result !== undefined) return result;
    await sleep(Math.min(delay, Math.max(0, until - Date.now())));
    delay = Math.min(delay * 1.5, 20_000);
  }
  return undefined;
}

/** Bytes of a file, `start` to `end` inclusive. */
export async function readRange(file: string, start: number, end: number) {
  const fh = await open(file, 'r');
  try {
    const buf = Buffer.alloc(end - start + 1);
    await fh.read(buf, 0, buf.length, start);
    return buf;
  } finally {
    await fh.close();
  }
}

export const percent = (done: number, total: number) => `${Math.min(100, Math.round((done / total) * 100))}%`;
