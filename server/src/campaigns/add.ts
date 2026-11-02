// Marketplace campaigns by link, each on the page I add it from. One key per campaign however its link is spelled
// (`campaignKey`), so pasting a link again never makes a second one: on another page it's added to that page too.
// (Reading the marketplaces' "joined" lists was tried and dropped, 2026-11-02: Content Rewards' cards carry no links.)
import { campaignKey, parseCampaignLink } from '../../../shared/campaigns';
import { db, newId, schema } from '../db';
import { enqueue, hasPendingJob } from '../jobs/queue';
import { emitCampaign, pagesOf, setPages } from './campaigns';

export const isReading = (id: string) => hasPendingJob('campaign.read', 'campaignId', id);

/** Read the campaign's page again, or `text` I pasted from it (when the page can't be read as it should). */
export function startRead(id: string, text?: string) {
  if (!isReading(id)) enqueue('campaign.read', { campaignId: id, ...(text && { text }) }, { maxAttempts: text ? 1 : 2 });
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

/** Add a marketplace campaign to a page by its link and start reading it; the one already added when it's there. */
export function addCampaignLink(pasted: string, pageId: string): { id: string; added: boolean } {
  const parsed = parseCampaignLink(pasted);
  if (!parsed) throw new Error('Not a campaign link');
  const existing = findByLink(parsed.link);
  if (existing) {
    const pages = pagesOf([existing.id]).get(existing.id) ?? [];
    if (!pages.includes(pageId)) {
      setPages(existing.id, [...pages, pageId]);
      emitCampaign(existing.id);
    }
    return { id: existing.id, added: false };
  }
  const id = newId();
  db.insert(schema.campaigns).values({ id, origin: parsed.market, link: parsed.link, status: 'reading' }).run();
  setPages(id, [pageId]);
  startRead(id);
  return { id, added: true };
}
