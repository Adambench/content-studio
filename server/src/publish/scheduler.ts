import { and, eq, lte } from 'drizzle-orm';
import { DEFAULT_CATCH_UP_HOURS } from '../../../shared/publish';
import { db, now, schema } from '../db';
import { holdSleepLock } from '../lib/inhibit';
import { getSetting } from '../lib/settings';
import { enqueue, hasPendingJob } from '../jobs/queue';
import { accessToken } from './accounts';
import { setPost } from './posts';
import { notifyMissed } from './publisher';

const TICK_MS = 15_000;
// A post this late was never going to be exactly on time anyway (the tick, a slow wake-up): just post it.
const GRACE_MS = 5 * 60_000;
const SOON_MS = 10 * 60_000;
// Five tries: now, then 30 s, 2 min, 8 min and 32 min later.
const ATTEMPTS = 5;

let timer: NodeJS.Timeout | undefined;
let sweepTimer: NodeJS.Timeout | undefined;
let lastTick = now();

/** Start posts that are due. Runs every few seconds, and straight away after "Post now". */
export function tick() {
  const at = now();
  // setInterval doesn't run while the computer sleeps, so a long gap means it just woke up (or was off).
  if (at - lastTick > TICK_MS * 4) console.log(`[schedule] catching up after ${Math.round((at - lastTick) / 60_000)} min asleep`);
  lastTick = at;

  const due = db
    .select()
    .from(schema.posts)
    .where(and(eq(schema.posts.status, 'scheduled'), lte(schema.posts.scheduledAt, at)))
    .all();
  const catchUp = Math.max(GRACE_MS, (getSetting('catchUpHours') ?? DEFAULT_CATCH_UP_HOURS) * 60 * 60_000);
  for (const post of due) {
    if (at - post.scheduledAt > catchUp) {
      // Posting hours late (say, at 3 a.m. when the laptop wakes) is worse than asking.
      setPost(post, { status: 'missed', stage: '' });
      notifyMissed(post);
      continue;
    }
    setPost(post, { status: 'publishing', stage: 'Waiting to start', error: null });
    enqueue('post.publish', { postId: post.id }, { maxAttempts: ATTEMPTS });
  }

  const busy = db
    .select({ id: schema.posts.id })
    .from(schema.posts)
    .where(eq(schema.posts.status, 'publishing'))
    .get();
  const soon = db
    .select({ id: schema.posts.id })
    .from(schema.posts)
    .where(and(eq(schema.posts.status, 'scheduled'), lte(schema.posts.scheduledAt, at + SOON_MS)))
    .get();
  holdSleepLock(!!busy || !!soon, 'A scheduled post is about to go out');
}

export function kickScheduler() {
  setImmediate(tick);
}

/**
 * Keep every account's sign-in alive and find out early when one stops working (so you're asked to reconnect
 * before a post fails): refresh short-lived tokens about daily, Instagram's 60-day ones when they're halfway.
 */
async function sweepTokens() {
  const accounts = db.select().from(schema.accounts).where(eq(schema.accounts.status, 'connected')).all();
  for (const a of accounts) {
    const stale = a.platform !== 'instagram' && now() - a.tokenUpdatedAt > 20 * 60 * 60_000;
    await accessToken(a, stale).catch((err) => console.warn(`[accounts] refresh failed for ${a.platform} ${a.handle}: ${(err as Error).message}`));
  }
}

export function startScheduler() {
  // A post marked as going out whose job is gone (the app stopped at the wrong moment) gets its job back.
  for (const post of db.select().from(schema.posts).where(eq(schema.posts.status, 'publishing')).all()) {
    if (!hasPendingJob('post.publish', 'postId', post.id)) enqueue('post.publish', { postId: post.id }, { maxAttempts: ATTEMPTS });
  }
  timer = setInterval(tick, TICK_MS);
  setTimeout(tick, 2000);
  setTimeout(() => void sweepTokens(), 60_000);
  sweepTimer = setInterval(() => void sweepTokens(), 6 * 60 * 60_000);
}

export function stopScheduler() {
  clearInterval(timer);
  clearInterval(sweepTimer);
  holdSleepLock(false, '');
}
