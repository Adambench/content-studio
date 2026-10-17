// Who answers each AI task (shared/ai.ts): Claude, or the self-hosted model. Auto stays on Claude while its usage has
// room and moves to the local model when it doesn't (or when Claude refused for usage), if the local model is ready.
import { AI_TASKS, normalizeRouting, type AiRouteNow, type AiRouting, type AiTask } from '../../../shared/ai';
import { getSetting, setSetting } from '../lib/settings';
import { localReady } from './local';

export const aiRouting = (): AiRouting => normalizeRouting(getSetting('aiRouting'));

/** Background jobs leave the last ~20 % of Claude's 5-hour window for the chat. */
export const BACKGROUND_FIVE_HOUR = 0.8;

/** Why Claude shouldn't take more work now, or null when it has room. */
export function claudeBusy(task: AiTask, r = aiRouting()): string | null {
  const now = Date.now();
  if ((getSetting('claudeLimitedUntil') ?? 0) > now) return 'Claude refused for usage';
  const usage = getSetting('claudeUsage');
  const live = (w?: { utilization: number; resetsAt: number }) => (w && w.resetsAt > now ? w.utilization : 0);
  if (usage?.status === 'rejected' && (live(usage.fiveHour) || live(usage.sevenDay))) return 'Claude’s usage limit is reached';
  const week = live(usage?.sevenDay);
  if (week >= r.weeklyAt) return `Claude’s weekly usage is at ${Math.round(week * 100)} %`;
  const five = live(usage?.fiveHour);
  const fiveAt = task === 'chat' ? r.fiveHourAt : Math.min(r.fiveHourAt, BACKGROUND_FIVE_HOUR);
  if (five >= fiveAt) return `Claude’s 5-hour usage is at ${Math.round(five * 100)} %`;
  return null;
}

export async function routeFor(task: AiTask): Promise<AiRouteNow> {
  const r = aiRouting();
  if (r.localOnly) return { provider: 'local', reason: 'Local only is on' };
  const mode = r.tasks[task];
  if (mode === 'claude') return { provider: 'claude', reason: 'Set to Claude' };
  if (mode === 'local') return { provider: 'local', reason: 'Set to local' };
  const busy = claudeBusy(task, r);
  if (!busy) return { provider: 'claude', reason: 'Claude has room' };
  if (await localReady()) return { provider: 'local', reason: busy };
  return { provider: 'claude', reason: `${busy}, and the local model isn’t ready` };
}

export async function routesNow(): Promise<Record<AiTask, AiRouteNow>> {
  return Object.fromEntries(await Promise.all(AI_TASKS.map(async (t) => [t, await routeFor(t)] as const))) as Record<AiTask, AiRouteNow>;
}

/** Claude said no for usage (or the login's plan is out): it's skipped for an hour on the tasks set to auto. */
export const isUsageError = (err: unknown) => /usage limit|rate.?limit|429|hit your limit|out of (extra )?usage|limit reached/i.test(err instanceof Error ? err.message : String(err));

export function markClaudeLimited(ms = 60 * 60_000) {
  setSetting('claudeLimitedUntil', Date.now() + ms);
}

/** Whether a Claude failure on this task should be answered by the local model instead. */
export async function canFallBack(task: AiTask, err: unknown) {
  if (!isUsageError(err)) return false;
  markClaudeLimited();
  const r = aiRouting();
  return r.tasks[task] === 'auto' && (await localReady());
}
