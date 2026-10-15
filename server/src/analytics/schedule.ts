import { emit } from '../lib/events';
import { enqueue, hasPendingJob } from '../jobs/queue';
import { checkWeeklyReviews } from './review';
import { statsDue, syncStats } from './stats';

const TICK_MS = 15 * 60_000;
let timer: NodeJS.Timeout | undefined;

/** The `stats.sync` job; "Refresh stats" (manual) says when it's done. */
export async function statsJob(payload: { workspaceId?: string; postIds?: string[]; force?: boolean; manual?: boolean }) {
  await syncStats(payload);
  if (payload.manual) emit({ type: 'job', jobType: 'stats.sync', status: 'done', workspaceId: payload.workspaceId });
}

/** Read posts' numbers when they're due, and start weekly reviews when their time comes. */
function tick() {
  if (!hasPendingJob('stats.sync') && statsDue()) enqueue('stats.sync', {}, { maxAttempts: 1 });
  checkWeeklyReviews();
}

export function startAnalytics() {
  // Give the app a moment to start (and the token sweep to run) first.
  setTimeout(tick, 90_000);
  timer = setInterval(tick, TICK_MS);
}

export function stopAnalytics() {
  clearInterval(timer);
}
