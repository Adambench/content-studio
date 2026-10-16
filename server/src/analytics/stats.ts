import { and, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import { statsInterval, type AccountStats } from '../../../shared/analytics';
import { db, newId, now, schema } from '../db';
import { emit } from '../lib/events';
import { submissionsAfterPosting } from '../campaigns/submissions';
import { accessToken } from '../publish/accounts';
import { hasScope, PlatformError, platforms, type AccountRow, type PostRow, type PostStatsResult } from '../publish/platforms';

const DAY = 86400_000;
// After this, a post's numbers stop being read (statsInterval says when).
const MAX_AGE = 90 * DAY;

/** A local date, yyyy-mm-dd: account numbers are kept once a day. */
export function localDay(ms = now()) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isDue(p: PostRow) {
  const interval = statsInterval(now() - (p.publishedAt ?? now()));
  // A few minutes' slack, so a check that comes round slightly early doesn't skip a whole round.
  return interval !== null && (!p.statsAt || now() - p.statsAt >= interval - 10 * 60_000);
}

function duePosts(filter: { workspaceId?: string; postIds?: string[]; force?: boolean }) {
  return db
    .select()
    .from(schema.posts)
    .where(
      and(
        eq(schema.posts.status, 'published'),
        isNotNull(schema.posts.accountId),
        gte(schema.posts.publishedAt, now() - MAX_AGE),
        filter.workspaceId ? eq(schema.posts.workspaceId, filter.workspaceId) : undefined,
        filter.postIds ? inArray(schema.posts.id, filter.postIds) : undefined,
      ),
    )
    .all()
    .filter((p) => filter.force || isDue(p));
}

function connectedAccounts(workspaceId?: string) {
  return db
    .select()
    .from(schema.accounts)
    .where(and(eq(schema.accounts.status, 'connected'), workspaceId ? eq(schema.accounts.workspaceId, workspaceId) : undefined))
    .all();
}

const hasAccountStats = (a: AccountRow, day: string) =>
  !!db
    .select({ id: schema.accountStats.id })
    .from(schema.accountStats)
    .where(and(eq(schema.accountStats.workspaceId, a.workspaceId), eq(schema.accountStats.platform, a.platform), eq(schema.accountStats.externalId, a.externalId), eq(schema.accountStats.day, day)))
    .get();

/** Whether anything is due a read: cheap enough to ask every few minutes. */
export function statsDue() {
  const day = localDay();
  return duePosts({}).length > 0 || connectedAccounts().some((a) => !hasAccountStats(a, day));
}

function saveAccountStats(a: AccountRow, s: AccountStats, day: string) {
  const values = { at: now(), followers: s.followers, views: s.views, likes: s.likes, posts: s.posts };
  db.insert(schema.accountStats)
    .values({ id: newId(), workspaceId: a.workspaceId, platform: a.platform, externalId: a.externalId, day, ...values })
    .onConflictDoUpdate({ target: [schema.accountStats.workspaceId, schema.accountStats.platform, schema.accountStats.externalId, schema.accountStats.day], set: values })
    .run();
}

function savePostStats(posts: PostRow[], results: Map<string, PostStatsResult>) {
  const at = now();
  db.transaction((tx) => {
    for (const p of posts) {
      const r = results.get(p.id);
      if (!r || 'note' in r) {
        // Keep the last numbers it had (a post deleted on the platform still shows how it did).
        tx.update(schema.posts).set({ statsAt: at, statsNote: r?.note ?? null }).where(eq(schema.posts.id, p.id)).run();
        continue;
      }
      tx.insert(schema.postStats).values({ id: newId(), postId: p.id, workspaceId: p.workspaceId, at, ...r.stats }).run();
      tx.update(schema.posts)
        .set({ stats: r.stats, statsAt: at, statsNote: null, ...(r.externalId && { externalId: r.externalId }), ...(r.url && { url: r.url }) })
        .where(eq(schema.posts.id, p.id))
        .run();
    }
  });
}

const RECONNECT = 'Reconnect this account (Accounts page) to let Content Studio read all of its stats.';

/**
 * The `stats.sync` job: read the numbers of published posts that are due (or all of them, `force`), and each
 * connected account's followers once a day. Mechanical — no Claude involved.
 */
export async function syncStats({ workspaceId, postIds, force = false }: { workspaceId?: string; postIds?: string[]; force?: boolean; manual?: boolean }) {
  const posts = duePosts({ workspaceId, postIds, force });
  const day = localDay();
  const touched = new Set<string>();

  for (const account of connectedAccounts(workspaceId)) {
    const due = posts.filter((p) => p.accountId === account.id);
    const wantAccount = !postIds && (force || !hasAccountStats(account, day));
    if (!due.length && !wantAccount) continue;
    let token: string;
    try {
      token = await accessToken(account);
    } catch (err) {
      console.warn(`[stats] no token for ${account.platform} ${account.handle}: ${(err as Error).message}`);
      continue;
    }
    const adapter = platforms[account.platform];
    const notes: string[] = [];
    touched.add(account.workspaceId);

    if (wantAccount) {
      try {
        saveAccountStats(account, await adapter.accountStats(token, account), day);
      } catch (err) {
        notes.push((err as Error).message);
      }
    }
    if (due.length) {
      try {
        const batch = await adapter.postStats(token, account, due);
        if (batch.note) notes.push(batch.note);
        savePostStats(due, batch.posts);
      } catch (err) {
        notes.push((err as Error).message);
        // Network trouble or a rate limit: these posts come round again at the next check rather than next interval.
        if (!(err instanceof PlatformError && (err.kind === 'retry' || err.kind === 'rate'))) savePostStats(due, new Map(due.map((p) => [p.id, { note: (err as Error).message }])));
      }
    }

    // Accounts connected before stats were asked for are missing permissions: that's the thing to fix first.
    const missing = !!account.scopes && adapter.statsScopes.some((s) => !hasScope(account, s));
    const statsNote = missing ? RECONNECT : (notes[0] ?? null);
    if (statsNote !== account.statsNote) {
      db.update(schema.accounts).set({ statsNote }).where(eq(schema.accounts.id, account.id)).run();
      emit({ type: 'changed', entity: 'accounts', workspaceId: account.workspaceId, id: account.id });
    }
  }
  for (const id of touched) emit({ type: 'changed', entity: 'stats', workspaceId: id });
  // A TikTok inbox draft's link turns up once it's posted: its campaign submission can be made then.
  if (touched.size) submissionsAfterPosting();
}
