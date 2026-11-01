import { createHash, randomBytes } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { PUBLISH_PLATFORM_LABELS, type AccountSettings, type PublishPlatform, type QueueSlot } from '../../../shared/publish';
import { db, newId, now, schema } from '../db';
import { emit } from '../lib/events';
import { badRequest, notFound } from '../lib/http';
import { notify } from '../lib/push';
import { getWorkspace } from '../services/pieces';
import { PlatformError, platforms, type AccountRow } from './platforms';
import { platformUrl, sleep, type Profile, type TokenSet } from './platforms/http';
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
    const p = await platforms[a.platform].profile(token, a);
    if (p.externalId !== a.externalId || (p.name === a.name && p.handle === a.handle && p.avatarUrl === a.avatarUrl)) return;
    db.update(schema.accounts).set({ name: p.name, handle: p.handle || a.handle, avatarUrl: p.avatarUrl, updatedAt: now() }).where(eq(schema.accounts.id, id)).run();
    announce(a);
  } catch {
    /* not important enough to fail anything over */
  }
}

const PROFILE_EVERY = 10 * 60_000;
const profileChecked = new Map<string, number>();

/**
 * Instagram's sign-in never renews, so renames and new pictures (and picture links running out) are picked up when
 * the accounts are listed, at most every 10 minutes an account.
 */
export function refreshProfiles(workspaceId: string) {
  for (const a of listAccounts(workspaceId)) {
    if (a.status !== 'connected' || (profileChecked.get(a.id) ?? 0) > now() - PROFILE_EVERY) continue;
    profileChecked.set(a.id, now());
    void accessToken(a).then((token) => refreshProfile(a.id, token), () => {});
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
 * Returns the connected accounts, and a `pick` key when the user can (or, with none connected, has to) name the
 * accounts the sign-in was for.
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
  const app = requireApp(platform);
  let tokens: TokenSet | undefined;
  for (let attempt = 1; !tokens; attempt++) {
    try {
      tokens = await adapter.exchangeCode({ app, redirectUri: sign.redirectUri, code: query.code, verifier: sign.verifier });
    } catch (err) {
      // A dropped connection: the code still works if the platform never saw it, so try again, and keep the
      // sign-in so reloading the page tries once more.
      if (!(err instanceof PlatformError && err.kind === 'retry')) throw err;
      if (attempt === 3) {
        pending.set(query.state!, sign);
        throw new PlatformError(`${err.message} Reload this page to try again.`, 'retry');
      }
      await sleep(2000 * attempt);
    }
  }
  if (!adapter.profiles) return { accounts: saveAccounts(sign.workspaceId, platform, [await adapter.profile(tokens.accessToken)], tokens), pick: undefined };

  // A token that covers several accounts (Instagram) also covers the ones already connected (here or in other
  // workspaces), which the platform doesn't always list: give them the new sign-in too. It adds here the listed
  // accounts not connected anywhere yet; with none new, it's a reconnect of this workspace's ones, or (if it has
  // none) all the listed ones. With none listed, the user says which.
  const listed = await adapter.profiles(tokens.accessToken, tokens.accountIds);
  const known = db.select().from(schema.accounts).where(eq(schema.accounts.platform, platform)).all();
  const unlisted = [...new Set(known.map((k) => k.externalId))].filter((id) => !listed.some((p) => p.externalId === id));
  const covered = [...listed, ...(unlisted.length && adapter.lookup ? (await adapter.lookup(tokens.accessToken, unlisted, [])).found : [])];
  const values = tokenValues(tokens);
  for (const k of known) {
    if (!covered.some((p) => p.externalId === k.externalId)) continue;
    db.update(schema.accounts).set(values).where(eq(schema.accounts.id, k.id)).run();
    announce(k);
  }
  const fresh = listed.filter((p) => !known.some((k) => k.externalId === p.externalId));
  const here = covered.filter((p) => known.some((k) => k.externalId === p.externalId && k.workspaceId === sign.workspaceId));
  const picked = fresh.length ? fresh : here.length ? here : listed;
  // None listed: the user can name accounts (another one for this workspace, after a reconnect).
  let pick: string | undefined;
  if (!listed.length && adapter.lookup) {
    for (const [key, p] of picks) if (p.expires < now()) picks.delete(key);
    pick = randomBytes(24).toString('base64url');
    picks.set(pick, { workspaceId: sign.workspaceId, platform, tokens, roots: covered.map((p) => p.externalId), expires: now() + 20 * 60_000 });
  }
  if (!picked.length && !pick) throw badRequest(`${PUBLISH_PLATFORM_LABELS[platform]} didn’t share any account. Connect again and pick one.`);
  return { accounts: saveAccounts(sign.workspaceId, platform, picked, tokens), pick };
}

// Sign-ins waiting for the user to say which accounts they're for. The token stays in memory only.
type PendingPick = { workspaceId: string; platform: PublishPlatform; tokens: TokenSet; roots: string[]; expires: number };
const picks = new Map<string, PendingPick>();

export const pickOpen = (platform: PublishPlatform, key?: string) => {
  const p = key ? picks.get(key) : undefined;
  return !!p && p.platform === platform && p.expires >= now();
};

/** The accounts the user named for a sign-in whose platform listed none; each must be one the token can use. */
export async function pickAccounts(platform: PublishPlatform, key: string | undefined, input: string | undefined) {
  if (!pickOpen(platform, key)) throw badRequest('This sign-in link has expired. Start again from Content Studio.');
  const pick = picks.get(key!)!;
  const wanted = [...new Set((input ?? '').split(/[\s,]+/).filter(Boolean))].slice(0, 20);
  if (!wanted.length) throw badRequest('Paste the account’s ID first.');
  const { found, missing } = await platforms[platform].lookup!(pick.tokens.accessToken, wanted, pick.roots);
  if (missing.length) throw badRequest(`This sign-in can’t reach ${missing.join(', ')}. Check the ID, or connect again and tick that account in Meta’s window.`);
  picks.delete(key!);
  return saveAccounts(pick.workspaceId, platform, found, pick.tokens);
}

function tokenValues(tokens: TokenSet) {
  return {
    accessToken: tokens.accessToken,
    expiresAt: tokens.expiresAt ?? null,
    refreshExpiresAt: tokens.refreshExpiresAt ?? null,
    scopes: tokens.scopes ?? '',
    tokenUpdatedAt: now(),
    status: 'connected' as const,
    statusMessage: null,
    updatedAt: now(),
  };
}

/** Connect the accounts to the workspace (or update them, if they already are). */
function saveAccounts(workspaceId: string, platform: PublishPlatform, profiles: Profile[], tokens: TokenSet) {
  return profiles.map((profile) => {
    const existing = db
      .select()
      .from(schema.accounts)
      .where(and(eq(schema.accounts.workspaceId, workspaceId), eq(schema.accounts.platform, platform), eq(schema.accounts.externalId, profile.externalId)))
      .get();
    const values = {
      ...tokenValues(tokens),
      name: profile.name,
      handle: profile.handle,
      avatarUrl: profile.avatarUrl,
      // Reconnecting without a new refresh token (Google omits it sometimes) keeps the old one.
      ...(tokens.refreshToken || !existing ? { refreshToken: tokens.refreshToken ?? null } : {}),
    };
    const id = existing?.id ?? newId();
    if (existing) db.update(schema.accounts).set(values).where(eq(schema.accounts.id, id)).run();
    else db.insert(schema.accounts).values({ id, workspaceId, platform, externalId: profile.externalId, slots: DEFAULT_SLOTS, settings: {}, ...values }).run();
    const account = getAccount(id);
    announce(account);
    emit({ type: 'job', jobType: 'account.connect', status: 'done', workspaceId: account.workspaceId, message: `Connected ${accountLabel(account)}` });
    return account;
  });
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
