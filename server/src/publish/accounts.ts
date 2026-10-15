import { createHash, randomBytes } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { PUBLISH_PLATFORM_LABELS, type AccountSettings, type PublishPlatform, type QueueSlot } from '../../../shared/publish';
import { db, newId, now, schema } from '../db';
import { emit } from '../lib/events';
import { badRequest, notFound } from '../lib/http';
import { notify } from '../lib/push';
import { getWorkspace } from '../services/pieces';
import { PlatformError, platforms, type AccountRow } from './platforms';
import { platformUrl } from './platforms/http';
import { publicUrl, redirectUri, requireApp } from './setup';

// A new account's queue: one slot a day, at a typical evening time. Edit it on the Accounts page.
const DEFAULT_SLOTS: QueueSlot[] = [{ time: '18:00', days: [0, 1, 2, 3, 4, 5, 6] }];

export function getAccount(id: string) {
  const row = db.select().from(schema.accounts).where(eq(schema.accounts.id, id)).get();
  if (!row) throw notFound('Account not found');
  return row;
}

export const accountLabel = (a: Pick<AccountRow, 'platform' | 'handle' | 'name'>) => `${PUBLISH_PLATFORM_LABELS[a.platform]} ${a.handle ? `@${a.handle}` : a.name}`.trim();

/** An account as the web app sees it: never the tokens. */
export function publicAccount(a: AccountRow) {
  const { accessToken: _a, refreshToken: _r, ...rest } = a;
  return rest;
}

export function listAccounts(workspaceId: string) {
  return db.select().from(schema.accounts).where(eq(schema.accounts.workspaceId, workspaceId)).orderBy(asc(schema.accounts.createdAt)).all();
}

function announce(a: Pick<AccountRow, 'id' | 'workspaceId'>) {
  emit({ type: 'changed', entity: 'accounts', workspaceId: a.workspaceId, id: a.id });
}

/** The platform stopped accepting this account's sign-in: say so once, and hold its posts until it's reconnected. */
export function markReconnect(a: AccountRow, message: string) {
  if (db.select({ status: schema.accounts.status }).from(schema.accounts).where(eq(schema.accounts.id, a.id)).get()?.status !== 'connected') return;
  db.update(schema.accounts).set({ status: 'reconnect', statusMessage: message, updatedAt: now() }).where(eq(schema.accounts.id, a.id)).run();
  announce(a);
  void notify(`Reconnect ${PUBLISH_PLATFORM_LABELS[a.platform]}`, `${accountLabel(a)}: Content Studio can’t post there until you sign in again.`, `/w/${a.workspaceId}/accounts`);
}

const refreshing = new Map<string, Promise<string>>();

/** A usable access token for the account, refreshed when it's close to expiring (or `force`d). */
export async function accessToken(account: AccountRow, force = false): Promise<string> {
  const current = getAccount(account.id);
  const adapter = platforms[current.platform];
  if (!force && (!current.expiresAt || current.expiresAt - adapter.refreshMarginMs > now())) return current.accessToken;
  // Instagram can't refresh a token less than a day old; it's still valid, so use it.
  if (current.platform === 'instagram' && now() - current.tokenUpdatedAt < 24 * 60 * 60_000 && (current.expiresAt ?? 0) > now()) return current.accessToken;
  const inflight = refreshing.get(current.id);
  if (inflight) return inflight;
  const run = (async () => {
    try {
      const t = await adapter.refresh(requireApp(current.platform), current);
      db.update(schema.accounts)
        .set({
          accessToken: t.accessToken,
          // Some platforms only send a new refresh token sometimes.
          ...(t.refreshToken && { refreshToken: t.refreshToken }),
          ...(t.expiresAt !== undefined && { expiresAt: t.expiresAt }),
          ...(t.refreshExpiresAt !== undefined && { refreshExpiresAt: t.refreshExpiresAt }),
          tokenUpdatedAt: now(),
          status: 'connected',
          statusMessage: null,
          updatedAt: now(),
        })
        .where(eq(schema.accounts.id, current.id))
        .run();
      if (current.status !== 'connected') announce(current);
      void refreshProfile(current.id, t.accessToken);
      return t.accessToken;
    } catch (err) {
      if (err instanceof PlatformError && err.kind === 'auth') markReconnect(current, err.message);
      throw err;
    } finally {
      refreshing.delete(current.id);
    }
  })();
  refreshing.set(current.id, run);
  return run;
}

export function updateAccount(id: string, patch: { settings?: AccountSettings; slots?: QueueSlot[] }) {
  const a = getAccount(id);
  db.update(schema.accounts)
    .set({ ...(patch.settings && { settings: { ...a.settings, ...patch.settings } }), ...(patch.slots && { slots: patch.slots }), updatedAt: now() })
    .where(eq(schema.accounts.id, a.id))
    .run();
  announce(a);
  return getAccount(id);
}

/** Names change and profile pictures are expiring links: pick up the current ones. */
async function refreshProfile(id: string, token: string) {
  const a = getAccount(id);
  try {
    const p = await platforms[a.platform].profile(token);
    if (p.externalId !== a.externalId || (p.name === a.name && p.handle === a.handle && p.avatarUrl === a.avatarUrl)) return;
    db.update(schema.accounts).set({ name: p.name, handle: p.handle || a.handle, avatarUrl: p.avatarUrl, updatedAt: now() }).where(eq(schema.accounts.id, id)).run();
    announce(a);
  } catch {
    /* not important enough to fail anything over */
  }
}

// ---------- connecting ----------

type PendingSignIn = { workspaceId: string; platform: PublishPlatform; verifier: string; redirectUri: string; expires: number };
const pending = new Map<string, PendingSignIn>();

/** The platform's sign-in page for connecting an account to this workspace. */
export function startConnect(workspaceId: string, platform: PublishPlatform) {
  getWorkspace(workspaceId);
  let app;
  try {
    app = requireApp(platform);
  } catch (err) {
    throw badRequest((err as Error).message);
  }
  const uri = redirectUri(platform);
  if (!uri) throw badRequest(`${PUBLISH_PLATFORM_LABELS[platform]} sends you back to Content Studio over HTTPS, so it needs your public address first (Settings → Publishing).`);
  for (const [key, p] of pending) if (p.expires < now()) pending.delete(key);
  const state = randomBytes(24).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  pending.set(state, { workspaceId, platform, verifier, redirectUri: uri, expires: now() + 20 * 60_000 });
  return { url: platformUrl(platforms[platform].authorizeUrl({ app, redirectUri: uri, state, challenge })) };
}

/**
 * The platform sent the browser back with a code. The browser may not be signed in to Content Studio (it's
 * usually the system browser, not the app), so the one-time `state` from startConnect is what proves the request.
 */
export async function finishConnect(platform: PublishPlatform, query: { code?: string; state?: string; error?: string; error_description?: string; error_reason?: string }) {
  const sign = query.state ? pending.get(query.state) : undefined;
  if (!sign || sign.platform !== platform || sign.expires < now()) throw badRequest('This sign-in link has expired. Start again from Content Studio.');
  pending.delete(query.state!);
  if (query.error || !query.code) {
    const denied = /denied|cancel/i.test(`${query.error} ${query.error_reason}`);
    throw badRequest(denied ? 'You cancelled the sign-in, so nothing was connected.' : `${PUBLISH_PLATFORM_LABELS[platform]} said: ${query.error_description ?? query.error ?? 'no code was returned'}`);
  }
  const adapter = platforms[platform];
  const tokens = await adapter.exchangeCode({ app: requireApp(platform), redirectUri: sign.redirectUri, code: query.code, verifier: sign.verifier });
  const profile = await adapter.profile(tokens.accessToken);

  const existing = db
    .select()
    .from(schema.accounts)
    .where(and(eq(schema.accounts.workspaceId, sign.workspaceId), eq(schema.accounts.platform, platform), eq(schema.accounts.externalId, profile.externalId)))
    .get();
  const values = {
    name: profile.name,
    handle: profile.handle,
    avatarUrl: profile.avatarUrl,
    accessToken: tokens.accessToken,
    // Reconnecting without a new refresh token (Google omits it sometimes) keeps the old one.
    ...(tokens.refreshToken || !existing ? { refreshToken: tokens.refreshToken ?? null } : {}),
    expiresAt: tokens.expiresAt ?? null,
    refreshExpiresAt: tokens.refreshExpiresAt ?? null,
    scopes: tokens.scopes ?? '',
    tokenUpdatedAt: now(),
    status: 'connected' as const,
    statusMessage: null,
    updatedAt: now(),
  };
  const id = existing?.id ?? newId();
  if (existing) db.update(schema.accounts).set(values).where(eq(schema.accounts.id, id)).run();
  else db.insert(schema.accounts).values({ id, workspaceId: sign.workspaceId, platform, externalId: profile.externalId, slots: DEFAULT_SLOTS, settings: {}, ...values }).run();
  const account = getAccount(id);
  announce(account);
  emit({ type: 'job', jobType: 'account.connect', status: 'done', workspaceId: account.workspaceId, message: `Connected ${accountLabel(account)}` });
  return account;
}

/** Forget the account (and ask the platform to revoke our access). Its scheduled posts can't go out any more. */
export async function disconnectAccount(id: string) {
  const a = getAccount(id);
  const app = (() => {
    try {
      return requireApp(a.platform);
    } catch {
      return null;
    }
  })();
  if (app) await platforms[a.platform].revoke?.(app, a).catch(() => {});
  const held = db
    .select({ id: schema.posts.id, pieceId: schema.posts.pieceId })
    .from(schema.posts)
    .where(and(eq(schema.posts.accountId, a.id), inArray(schema.posts.status, ['scheduled', 'missed'])))
    .all();
  db.transaction((tx) => {
    if (held.length) {
      tx.update(schema.posts)
        .set({ status: 'failed', error: `${accountLabel(a)} was disconnected.`, stage: '', updatedAt: now() })
        .where(inArray(schema.posts.id, held.map((p) => p.id)))
        .run();
    }
    tx.delete(schema.accounts).where(eq(schema.accounts.id, a.id)).run();
  });
  announce(a);
  if (held.length) emit({ type: 'changed', entity: 'posts', workspaceId: a.workspaceId });
}

export const hasPublicUrl = () => !!publicUrl();
