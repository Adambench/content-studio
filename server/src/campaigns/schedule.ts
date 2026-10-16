// Campaign upkeep, checked every half hour: each active Content Rewards campaign's budget once a day (a plain fetch of
// its public page), and my submissions on Content Rewards once a day while any are waiting on a campaign (one page
// read in the signed-in window and one Haiku call).
import { and, eq, isNotNull } from 'drizzle-orm';
import { db, now, schema } from '../db';
import { desktopAvailable } from '../lib/desktop';
import { getSetting } from '../lib/settings';
import { enqueue, hasPendingJob } from '../jobs/queue';
import { awaitingCampaign, createDueSubmissions } from './submissions';

const TICK_MS = 30 * 60_000;
const BUDGET_EVERY = 20 * 3600_000;
const SUBMISSIONS_EVERY = 20 * 3600_000;
let timer: NodeJS.Timeout | undefined;

function budgetsDue() {
  return db
    .select({ checked: schema.campaigns.budgetCheckedAt })
    .from(schema.campaigns)
    .where(and(eq(schema.campaigns.origin, 'content_rewards'), eq(schema.campaigns.status, 'active'), isNotNull(schema.campaigns.link)))
    .all()
    .some((c) => !c.checked || now() - c.checked >= BUDGET_EVERY);
}

function tick() {
  if (!hasPendingJob('campaign.budget') && budgetsDue()) enqueue('campaign.budget', {}, { maxAttempts: 1 });
  const last = getSetting('submissionsSync');
  if (desktopAvailable() && awaitingCampaign() && !hasPendingJob('submissions.sync') && (!last || now() - last.at >= SUBMISSIONS_EVERY)) enqueue('submissions.sync', {}, { maxAttempts: 1 });
}

export function startCampaignUpkeep() {
  // Posts that went out while submissions didn't exist yet (or while the app was off) get theirs.
  void createDueSubmissions().catch((err) => console.warn(`[submissions] ${(err as Error).message}`));
  setTimeout(tick, 2 * 60_000);
  timer = setInterval(tick, TICK_MS);
}

export function stopCampaignUpkeep() {
  clearInterval(timer);
}
