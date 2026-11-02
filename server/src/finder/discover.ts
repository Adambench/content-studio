// Campaign discovery: Content Rewards' list of campaigns, read in the signed-in window, turned by one Haiku call into
// leads (pay, budget left, category, a halal screen), ranked. Joining a campaign on Whop stays the creator's click;
// "Add" only reads the campaign into the app (campaign.read) like pasting its link.
import { campaignKey, parseCampaignLink } from '../../../shared/campaigns';
import { leadScore, type CampaignLead } from '../../../shared/finder';
import { parsePage } from '../claude/extract';
import { playbook } from '../claude/plugin';
import { db, schema } from '../db';
import { desktopAvailable, readPage } from '../lib/desktop';
import { getSetting, setSetting } from '../lib/settings';

/** Where Content Rewards lists the open campaigns. A guess until it's tried with a real login (PLAN.md, Waiting on me). */
export const DISCOVER_URL = 'https://contentrewards.com/campaigns';

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['campaigns'],
  properties: {
    campaigns: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['link', 'title', 'brand', 'ratePer1k', 'budgetLeft', 'category', 'accepting', 'halal', 'halalNote'],
        properties: {
          link: { type: 'string', description: 'The campaign’s own page, from the links' },
          title: { type: 'string' },
          brand: { type: 'string' },
          ratePer1k: { type: ['number', 'null'], description: 'The best pay per 1,000 views in US dollars, if shown' },
          budgetLeft: { type: ['number', 'null'], description: 'Budget remaining in US dollars, if shown' },
          category: { type: 'string' },
          accepting: { type: ['boolean', 'null'], description: 'false only if the card says it is full, paused or ended' },
          halal: { type: 'string', enum: ['ok', 'flag', 'reject'] },
          halalNote: { type: 'string', description: 'One short line when flagged or rejected, else empty' },
        },
      },
    },
  },
};

const INSTRUCTIONS =
  'This is the list of campaigns on Content Rewards. List every campaign card with its own link. Screen each one by the halal rules above from what the card shows (brand, category, title): `reject` when it promotes music (a song, an artist, an album, a music app) or anything on the never-promoted list, `flag` for gray areas or when you cannot tell, `ok` only when nothing applies.';

type Read = { campaigns: (Omit<CampaignLead, 'score'> & { accepting: boolean | null })[] };

/** Read the list, drop what is added already, full or rejected, rank, and keep the result for the Find page. */
export async function discoverCampaigns() {
  if (!desktopAvailable()) throw new Error('Reading Content Rewards needs the desktop app (it uses the signed-in window).');
  const page = await readPage(DISCOVER_URL, { scrolls: 6 });
  const out = await parsePage<Read>(page, { system: playbook('halal'), what: INSTRUCTIONS, schema: SCHEMA });
  const have = new Set(db.select({ link: schema.campaigns.link }).from(schema.campaigns).all().flatMap((c) => (c.link ? [campaignKey(c.link)] : [])));
  const seen = new Set<string>();
  const items: CampaignLead[] = [];
  for (const c of out.campaigns ?? []) {
    const parsed = parseCampaignLink(c.link);
    if (!parsed || c.accepting === false) continue;
    const link = parsed.link;
    if (have.has(parsed.key) || seen.has(parsed.key) || c.halal === 'reject') continue;
    seen.add(parsed.key);
    const lead = { link, title: c.title, brand: c.brand, ratePer1k: c.ratePer1k, budgetLeft: c.budgetLeft, category: c.category, halal: c.halal, halalNote: c.halalNote };
    items.push({ ...lead, score: leadScore(lead) });
  }
  items.sort((a, b) => b.score - a.score);
  const note = items.length ? '' : out.campaigns?.length ? 'Nothing new: the rest are added already, full, or not halal.' : 'No campaigns found on the page. Is Whop signed in (Settings → Connected sites)?';
  setSetting('campaignLeads', { at: Date.now(), items: items.slice(0, 30), note });
  return items.length;
}

export const campaignLeads = () => getSetting('campaignLeads') ?? { at: 0, items: [], note: '' };

/** A lead the creator added (or removed some other way): it leaves the list. */
export function dropLead(link: string) {
  const leads = campaignLeads();
  setSetting('campaignLeads', { ...leads, items: leads.items.filter((l) => l.link !== link) });
}
