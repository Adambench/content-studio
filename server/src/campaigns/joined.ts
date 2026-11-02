// Marketplace campaigns by link, and the ones I've joined added by themselves: each marketplace's own list of my
// campaigns (Content Rewards' "Your Campaigns", Vyro's "My campaigns") is read in its signed-in window (one page read
// each, no Claude), and every campaign on it that isn't in the app yet is added and read like a pasted link. One key
// per campaign however its link is spelled (`campaignKey`), so nothing is added twice; a campaign I delete isn't added
// back. Checked every 6 hours while the desktop app runs, and when I press "Check joined".
import { campaignKey, MARKET_INFO, MARKETS, parseCampaignLink, type Market } from '../../../shared/campaigns';
import { SITES } from '../../../shared/sites';
import { db, newId, now, schema } from '../db';
import { desktopAvailable, readPage } from '../lib/desktop';
import { emit } from '../lib/events';
import { getSetting, setSetting } from '../lib/settings';
import { enqueue, hasPendingJob, JobError } from '../jobs/queue';
import { emitCampaign, type CampaignRow } from './campaigns';

export const isReading = (id: string) => hasPendingJob('campaign.read', 'campaignId', id);

export function startRead(id: string) {
  if (!isReading(id)) enqueue('campaign.read', { campaignId: id }, { maxAttempts: 2 });
  emitCampaign(id);
}

/** The campaign already in the app for this link (any spelling of it), if any. */
export function findByLink(link: string) {
  const key = campaignKey(link);
  return db
    .select({ id: schema.campaigns.id, link: schema.campaigns.link })
    .from(schema.campaigns)
    .all()
    .find((c) => c.link && campaignKey(c.link) === key);
}

/** Add a marketplace campaign by its link and start reading it; the one already added when it's there. */
export function addCampaignLink(pasted: string): { id: string; added: boolean } {
  const parsed = parseCampaignLink(pasted);
  if (!parsed) throw new Error('Not a campaign link');
  const existing = findByLink(parsed.link);
  if (existing) return { id: existing.id, added: false };
  const id = newId();
  db.insert(schema.campaigns).values({ id, origin: parsed.market, link: parsed.link, status: 'reading' }).run();
  // Added by hand after a delete: the joined check may add it again.
  undismiss(parsed.key);
  startRead(id);
  return { id, added: true };
}

// ---------- deleted ones stay out ----------

const MAX_DISMISSED = 500;

/** A marketplace campaign I deleted: the joined check leaves it out from now on. */
export function dismissCampaign(c: Pick<CampaignRow, 'link'>) {
  if (!c.link || !parseCampaignLink(c.link)) return;
  const key = campaignKey(c.link);
  const list = getSetting('dismissedCampaigns') ?? [];
  if (!list.includes(key)) setSetting('dismissedCampaigns', [...list, key].slice(-MAX_DISMISSED));
}

function undismiss(key: string) {
  const list = getSetting('dismissedCampaigns') ?? [];
  if (list.includes(key)) setSetting('dismissedCampaigns', list.filter((k) => k !== key));
}

// ---------- the joined check ----------

export type JoinedMarketSync = { ok: boolean; found: number; added: number; note: string | null };
export type JoinedSync = { at: number; markets: Partial<Record<Market, JoinedMarketSync>> };

export const JOINED_EVERY = 6 * 3600_000;

// CS_JOINED_URL_CONTENT_REWARDS / CS_JOINED_URL_VYRO point the lists at a local stand-in for testing.
const joinedUrl = (m: Market) => process.env[`CS_JOINED_URL_${m.toUpperCase()}`] || MARKET_INFO[m].joinedUrl;

async function syncMarket(market: Market, have: Set<string>, dismissed: Set<string>): Promise<JoinedMarketSync> {
  const info = MARKET_INFO[market];
  const signIn = `Sign in to ${SITES[info.site].label} under Settings → Connected sites`;
  const page = await readPage(joinedUrl(market), { scrolls: 6 });
  if (page.loginWall) return { ok: false, found: 0, added: 0, note: `${signIn}, then check again.` };
  const found = new Map<string, string>();
  for (const l of page.links) {
    const p = parseCampaignLink(l.href);
    if (p?.market === market && !found.has(p.key)) found.set(p.key, p.link);
  }
  let added = 0;
  for (const [key, link] of found) {
    if (have.has(key) || dismissed.has(key)) continue;
    addCampaignLink(link);
    have.add(key);
    added++;
  }
  if (!found.size) {
    // Kept for tuning: what the list looked like when no campaign link was on it.
    console.warn(`[joined] no campaign links on ${joinedUrl(market)} (${page.url}): ${page.text.slice(0, 400).replace(/\s+/g, ' ')}`);
    return { ok: true, found: 0, added: 0, note: `No joined campaigns found on ${info.label}. If you’ve joined some, check ${SITES[info.site].label} says “Signed in” under Settings → Connected sites.` };
  }
  return { ok: true, found: found.size, added, note: null };
}

/** The `campaigns.joined` job: read every marketplace's list of my campaigns and add the new ones. */
export async function syncJoined({ markets = [...MARKETS] }: { markets?: Market[] } = {}) {
  if (!desktopAvailable()) throw new JobError('Checking joined campaigns needs the desktop app (its signed-in windows).', { retry: false });
  const have = new Set(
    db
      .select({ link: schema.campaigns.link })
      .from(schema.campaigns)
      .all()
      .flatMap((c) => (c.link ? [campaignKey(c.link)] : [])),
  );
  const dismissed = new Set(getSetting('dismissedCampaigns') ?? []);
  const result: JoinedSync['markets'] = { ...getSetting('joinedSync')?.markets };
  for (const m of markets) {
    try {
      result[m] = await syncMarket(m, have, dismissed);
    } catch (err) {
      result[m] = { ok: false, found: 0, added: 0, note: (err as Error).message.slice(0, 300) };
    }
  }
  setSetting('joinedSync', { at: now(), markets: result });
  emitCampaign();
  const added = markets.reduce((n, m) => n + (result[m]?.added ?? 0), 0);
  emit({ type: 'job', jobType: 'campaigns.joined', status: 'done', message: added ? `Added ${added} joined campaign${added === 1 ? '' : 's'}` : 'No new joined campaigns' });
}

export function onJoinedFailed(_payload: unknown, message: string) {
  emitCampaign();
  emit({ type: 'job', jobType: 'campaigns.joined', status: 'error', message });
}

export const joinedState = () => ({ last: getSetting('joinedSync') ?? null, available: desktopAvailable(), running: hasPendingJob('campaigns.joined') });

/** Due for the half-hourly upkeep: the desktop app runs and the last check is 6 hours old. */
export function joinedDue() {
  const last = getSetting('joinedSync');
  return desktopAvailable() && !hasPendingJob('campaigns.joined') && (!last || now() - last.at >= JOINED_EVERY);
}
