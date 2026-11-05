// Claude's room. Every model call names its task (shared/ai.ts); all of them run on Claude (the Pro login). Background
// jobs leave the last ~20 % of the 5-hour window for what I click for and wait on.
import { setSetting } from '../lib/settings';

/** Background jobs wait once the 5-hour usage passes this share. */
export const BACKGROUND_FIVE_HOUR = 0.8;

/** Claude said no for usage (or the login's plan is out). */
export const isUsageError = (err: unknown) => /usage limit|rate.?limit|429|hit your limit|out of (extra )?usage|limit reached/i.test(err instanceof Error ? err.message : String(err));

/** Claude refused for usage: background jobs leave it alone for an hour. */
export function markClaudeLimited(ms = 60 * 60_000) {
  setSetting('claudeLimitedUntil', Date.now() + ms);
}
