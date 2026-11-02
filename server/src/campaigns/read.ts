// Reading a campaign: its marketplace page (Content Rewards or Vyro; signed in through the desktop bridge when it can,
// so the rules and files of a joined campaign show; a plain fetch otherwise, which Vyro's app doesn't answer) or the
// brief I typed for a business, turned by one Haiku call into the campaign's details, a rule checklist and the halal
// screen.
import { CAMPAIGN_PLATFORMS, CHECK_TYPES, isMarket, MARKET_INFO, RULE_KINDS, sourceKindOf, type CampaignPlatform, type HalalVerdict, type Payout, type RuleItem } from '../../../shared/campaigns';
import { SITES, type PageRead } from '../../../shared/sites';
import { parsePage } from '../claude/extract';
import { playbook } from '../claude/plugin';
import { and, eq } from 'drizzle-orm';
import { budgetLow, money as moneyText } from '../../../shared/campaigns';
import { db, now, schema } from '../db';
import { desktopAvailable, readPage } from '../lib/desktop';
import { emit } from '../lib/events';
import { notify } from '../lib/push';
import { JobError } from '../jobs/queue';
import { getCampaignRow, updateCampaign } from './campaigns';
import { insertSource } from './sources';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };
const decode = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? m),
  );

/** A page as anyone sees it, without the desktop app: its server-rendered HTML as text and links. */
export function htmlToPage(html: string, url: string): PageRead {
  const title = decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').trim();
  const body = html.replace(/<(script|style|noscript|svg|template|head)\b[\s\S]*?<\/\1>/gi, ' ');
  const links: PageRead['links'] = [];
  const seen = new Set<string>();
  for (const m of body.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let href: string;
    try {
      href = new URL(decode(m[1]), url).toString();
    } catch {
      continue;
    }
    if (!/^https?:/.test(href) || seen.has(href)) continue;
    seen.add(href);
    links.push({ href, text: decode(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 200) });
  }
  const text = decode(
    body
      .replace(/<(br|hr)\b[^>]*>/gi, '\n')
      .replace(/<\/(p|div|section|article|header|footer|li|ul|ol|h[1-6]|tr|table|button|label|main|nav|aside)>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
  return { url, title, text: text.slice(0, 300_000), links, loginWall: null };
}

export async function fetchPage(url: string): Promise<PageRead> {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`The page answered ${res.status}.`);
  return htmlToPage(await res.text(), res.url || url);
}

type CampaignRead = {
  isCampaign: boolean;
  title: string;
  brand: string;
  type: string;
  category: string;
  description: string;
  accepting: boolean | null;
  payouts: Payout[];
  budgetUsed: number | null;
  budgetLeft: number | null;
  budgetTotal: number | null;
  deadline: string | null;
  rulesLocked: boolean;
  rules: string[];
  requirements: string;
  sources: { url: string; title: string }[];
  checklist: RuleItem[];
  halal: { verdict: HalalVerdict; reasons: string[] };
};

const money = { type: ['number', 'null'] };
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['isCampaign', 'title', 'brand', 'type', 'category', 'description', 'accepting', 'payouts', 'budgetUsed', 'budgetLeft', 'budgetTotal', 'deadline', 'rulesLocked', 'rules', 'requirements', 'sources', 'checklist', 'halal'],
  properties: {
    isCampaign: { type: 'boolean', description: 'False when this is not one campaign’s page or brief: a list or catalog of campaigns, a home page, a sign-in page or an error' },
    title: { type: 'string', description: 'The campaign’s name as the page gives it, without quotes' },
    brand: { type: 'string', description: 'Who runs the campaign (the brand, creator or clipping agency)' },
    type: { type: 'string', description: 'The kind of campaign as the page says it, e.g. Podcasts, Streamer, UGC, Slideshow' },
    category: { type: 'string', description: 'Its topic category if the page gives one, e.g. Finance, Personal Brand' },
    description: { type: 'string', description: 'The brief: what to clip and how, in the page’s words' },
    accepting: { type: ['boolean', 'null'], description: 'Whether it accepts clips now' },
    payouts: {
      type: 'array',
      description: 'What it pays on each platform, in US dollars',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['platform', 'ratePer1k', 'minPayout', 'maxPayout', 'flatFee'],
        properties: {
          platform: { type: 'string', enum: CAMPAIGN_PLATFORMS },
          ratePer1k: { ...money, description: 'Pay per 1,000 views (a rate per 1M views divided by 1,000)' },
          minPayout: money,
          maxPayout: { ...money, description: 'The most one clip can earn' },
          flatFee: money,
        },
      },
    },
    budgetUsed: { ...money, description: 'Budget already paid out' },
    budgetLeft: { ...money, description: 'Budget remaining' },
    budgetTotal: { ...money, description: 'The whole budget, if stated' },
    deadline: { type: ['string', 'null'], description: 'The end date as YYYY-MM-DD, only if the page gives one' },
    rulesLocked: { type: 'boolean', description: 'True when the page says rules, requirements or files are hidden until you join' },
    rules: { type: 'array', items: { type: 'string' }, description: 'Every rule and content requirement for the clips, one per item, as written' },
    requirements: { type: 'string', description: 'Requirements for the creator or their account (age, followers, country), as written' },
    sources: {
      type: 'array',
      description: 'Links to the videos, channels, folders or files to clip from (reference materials, source files); not the site’s own navigation or social profiles',
      items: { type: 'object', additionalProperties: false, required: ['url', 'title'], properties: { url: { type: 'string' }, title: { type: 'string' } } },
    },
    checklist: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'kind', 'check'],
        properties: {
          text: { type: 'string' },
          kind: { type: 'string', enum: RULE_KINDS },
          check: {
            anyOf: [
              { type: 'null' },
              { type: 'object', additionalProperties: false, required: ['type', 'value'], properties: { type: { type: 'string', enum: CHECK_TYPES }, value: { type: ['string', 'number'] } } },
            ],
          },
        },
      },
    },
    halal: {
      type: 'object',
      additionalProperties: false,
      required: ['verdict', 'reasons'],
      properties: { verdict: { type: 'string', enum: ['ok', 'flag', 'reject'] }, reasons: { type: 'array', items: { type: 'string' } } },
    },
  },
};

const INSTRUCTIONS = [
  'You read clipping campaigns for a creator who runs niche pages on TikTok, Instagram and YouTube Shorts. On the marketplaces (Content Rewards on Whop, Vyro) a campaign pays creators per 1,000 views for short clips cut from its videos (or for videos they film, UGC).',
  'Checklist: one item per rule for the clips. `text` is short and says what to do, in the page’s words when they are short. `kind`: required (every clip must do it), forbidden (a clip must never do it), format (length, shape, quality, language), caption (what the caption or on-screen text must hold).',
  '`check` is set only when the app can test the rule itself: maxSeconds or minSeconds (a number of seconds), mention (the @handle, with @), hashtag (with #), text (exact words or a link the caption must contain), platform (tiktok, instagram, youtube or x, when clips may only go there), watermark ("none" when watermarks are banned, otherwise the watermark required). Otherwise null.',
  'Never invent rules. Requirements about the creator’s account go in `requirements`, not the checklist. A rule asking for music, a song or a trending sound can never be followed: leave it out of the checklist and name it in the halal reasons.',
  'Halal screen, by the halal rules above: look at the brand, the product, what the source videos are and the rules. `reject` when it promotes music (a song, an artist, an album, a music app) or anything on the never-promoted list; `flag` for the gray areas or when you can’t tell; `ok` only when nothing applies.',
  'Halal reasons are read by the creator deciding whether to take the campaign, on a small card. One per thing they must judge, at most 14 words, plain words, speaking to them (“you”, never “the user”), quoting the page’s exact words when there are some, shaped like “Names “<brand>”, a <what it is>, as a style to copy.” or “Promises money: “<their words>”.” (fill in from this page; only what this page says). Never list what the app does by itself: it takes music out of every source and drops clips where it can’t, never adds music, and checks every clip before it goes out. Never list what you couldn’t see (locked or unopened files). A rule asking for music gets one reason: “Asks for a trending sound: your clips go out without one.” `ok` has no reasons; at most 4.',
].join('\n\n');

const day = (iso: string | null) => {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const d = new Date(`${iso}T23:59:59`);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
};

const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null);

/** Keep only rules with a known kind and a check that makes sense. */
function cleanChecklist(items: RuleItem[]): RuleItem[] {
  return items
    .filter((r) => r?.text?.trim() && RULE_KINDS.includes(r.kind))
    .map((r) => {
      let check = r.check && CHECK_TYPES.includes(r.check.type) ? r.check : null;
      if (check && (check.type === 'maxSeconds' || check.type === 'minSeconds')) check = num(Number(check.value)) ? { type: check.type, value: Number(check.value) } : null;
      if (check && check.type === 'platform' && !CAMPAIGN_PLATFORMS.includes(String(check.value) as CampaignPlatform)) check = null;
      return { text: r.text.trim().slice(0, 300), kind: r.kind, check };
    })
    .slice(0, 40);
}

/** The links written out in pasted text, as a page's links. */
const linksIn = (text: string) => [...new Set(text.match(/https?:\/\/[^\s<>"'）)\]]+/g) ?? [])].map((href) => ({ href: href.replace(/[.,;:!?]+$/, ''), text: '' }));

/**
 * The `campaign.read` job: read the page or brief, then fill in the campaign. A new campaign then waits for my OK.
 * `text`: the campaign page's text, copied by me, read instead of the page.
 */
export async function readCampaign({ campaignId, text }: { campaignId: string; text?: string }) {
  const c = getCampaignRow(campaignId);
  const market = isMarket(c.origin) ? MARKET_INFO[c.origin] : null;
  const signIn = market && `sign in to ${SITES[market.site].label} under Settings → Connected sites`;
  let page: PageRead;
  let note: string | null = null;
  if (!market || !c.link) {
    page = { url: '', title: c.title, text: c.pageText, links: [], loginWall: null };
  } else if (text) {
    page = { url: c.link, title: '', text, links: linksIn(text), loginWall: null };
  } else if (desktopAvailable()) {
    // Vyro opens a campaign over its catalog once the catalog has loaded: give it a few seconds more.
    page = await readPage(c.link, { scrolls: 4, ...(c.origin === 'vyro' && { waitFor: 5000 }) });
  } else if (c.origin === 'vyro') {
    // Vyro's pages are drawn by its app: a plain fetch gets an empty shell.
    throw new JobError('Reading a Vyro campaign needs the desktop app (its signed-in window).', { retry: false });
  } else {
    page = await fetchPage(c.link);
    note = 'Read without the desktop app, so only what anyone can see. Open Content Studio on the computer and read it again for the rules.';
  }
  if (page.loginWall) note = `The page asked to sign in: ${signIn}, then read it again.`;

  const out = await parsePage<CampaignRead>(page, {
    system: [playbook('halal'), INSTRUCTIONS].filter(Boolean).join('\n\n'),
    what:
      !market
        ? `This is the brief for a campaign of my own business${c.title ? ` (“${c.title}”)` : ''}, written by me. Fill in the campaign from it (leave payouts and budget empty unless it states them), make the checklist and screen it.`
        : `This is a campaign page on ${market.label}. Fill in the campaign from it, make the checklist from its rules and screen it.`,
    schema: SCHEMA,
  });
  if (!out.isCampaign && !page.loginWall) {
    const where = market ? `${market.label} showed ${/^https?:/.test(page.url) && page.url !== c.link ? page.url : 'another page'} instead of the campaign` : 'The brief doesn’t read as a campaign';
    throw new JobError(market ? `${where}. Open the link to check it’s the campaign’s own, or paste the campaign page’s text to read instead.` : `${where}.`, { retry: false });
  }

  // Only links that are really on the page (or in the brief) become sources.
  const onPage = new Set(page.links.map((l) => l.href));
  const found = out.sources.filter((s) => /^https?:\/\//.test(s.url) && (onPage.has(s.url) || page.text.includes(s.url)));
  const payouts = out.payouts.filter((p) => CAMPAIGN_PLATFORMS.includes(p.platform)).map((p) => ({ platform: p.platform, ratePer1k: num(p.ratePer1k), minPayout: num(p.minPayout), maxPayout: num(p.maxPayout), flatFee: num(p.flatFee) }));
  const rates = payouts.map((p) => p.ratePer1k).filter((r): r is number => r !== null);
  const used = num(out.budgetUsed);
  const left = num(out.budgetLeft);
  const total = num(out.budgetTotal) ?? (used !== null && left !== null ? used + left : null);
  const mine = c.checklist.filter((r) => r.by === 'you');
  const locked = !!out.rulesLocked && !!market;
  if (locked && !note) note = `The rules and source files are locked: join the campaign on ${market!.label}, ${signIn}, then read it again.`;

  updateCampaign(campaignId, {
    title:
      out.title
        .replace(/\s*[|·–-]\s*(Content Rewards|Vyro)\s*$/i, '')
        .replace(/^["'“”‘’\s]+|["'“”‘’\s]+$/g, '')
        .trim() || c.title.replace(/^["'“”]+$/, '') || 'Untitled campaign',
    brand: out.brand.trim(),
    type: out.type.trim(),
    category: out.category.trim(),
    description: out.description.trim() || (!market ? c.pageText : ''),
    accepting: out.accepting,
    payouts,
    platforms: [...new Set(payouts.map((p) => p.platform))],
    ratePer1k: rates.length ? Math.max(...rates) : null,
    budgetTotal: total,
    budgetLeft: left,
    deadline: day(out.deadline),
    rulesText: out.rules.map((r) => r.trim()).filter(Boolean).join('\n'),
    rulesLocked: locked,
    checklist: [...cleanChecklist(out.checklist), ...mine],
    requirements: out.requirements.trim(),
    halalVerdict: out.halal.verdict,
    halalReasons: out.halal.reasons.map((r) => r.trim()).filter(Boolean).slice(0, 10),
    pageText: !market ? c.pageText : page.text.slice(0, 200_000),
    readAt: Date.now(),
    readNote: note ?? (text ? 'Read from the page’s text you pasted.' : null),
    status: c.status === 'reading' ? 'to_confirm' : c.status,
  });

  for (const s of found) insertSource(campaignId, { kind: sourceKindOf(s.url), link: s.url, title: s.title.slice(0, 200) });
  emit({ type: 'job', jobType: 'campaign.read', status: 'done', message: `Read “${out.title || c.title}”` });
}

export function onReadFailed({ campaignId }: { campaignId: string }, message: string) {
  try {
    const c = getCampaignRow(campaignId);
    updateCampaign(campaignId, { status: c.status === 'reading' ? 'to_confirm' : c.status, readNote: `Couldn’t read it: ${message.slice(0, 300)}` });
  } catch {
    /* deleted meanwhile */
  }
  emit({ type: 'job', jobType: 'campaign.read', status: 'error', message });
}

// ---------- the budget, every day ----------

const amount = (n: string, unit?: string) => {
  const v = Number(n.replace(/,/g, ''));
  if (!Number.isFinite(v)) return null;
  return unit?.toUpperCase() === 'M' ? v * 1e6 : unit?.toUpperCase() === 'K' ? v * 1000 : v;
};

/**
 * The budget and whether it takes clips, from a campaign page's text as anyone sees it ("Budget $1,711 $18,289
 * remaining", "Accepting clips"). Mechanical, so it can run every day without Claude. Null where the page doesn't say.
 */
export function parseBudget(text: string) {
  const t = text.replace(/[\u2066-\u2069\u200e\u200f]/g, '');
  const left = /\$\s*([\d,]+(?:\.\d+)?)\s*([KM])?\s*remaining/i.exec(t);
  const used = /Budget\s*\$\s*([\d,]+(?:\.\d+)?)\s*([KM])?/i.exec(t);
  const budgetLeft = left ? amount(left[1], left[2]) : null;
  const budgetUsed = used && (!left || used.index !== left.index) ? amount(used[1], used[2]) : null;
  const accepting = /accepting clips/i.test(t) && !/not accepting|no longer accepting/i.test(t) ? true : /not accepting|no longer accepting|campaign (has )?ended|budget (is )?(spent|exhausted)/i.test(t) ? false : null;
  return { budgetLeft, budgetTotal: budgetLeft !== null && budgetUsed !== null ? budgetLeft + budgetUsed : null, accepting };
}

/**
 * The `campaign.budget` job: read each active Content Rewards campaign's public page (a plain fetch, no Claude, no
 * page read used up) for its budget left and whether it takes clips, and say once when one runs low.
 */
export async function refreshBudgets() {
  const active = db
    .select()
    .from(schema.campaigns)
    .where(and(eq(schema.campaigns.origin, 'content_rewards'), eq(schema.campaigns.status, 'active')))
    .all()
    .filter((c) => c.link);
  for (const c of active) {
    try {
      const b = parseBudget((await fetchPage(c.link!)).text);
      const next = {
        budgetCheckedAt: now(),
        ...(b.budgetLeft !== null && { budgetLeft: b.budgetLeft }),
        ...(b.budgetTotal !== null && { budgetTotal: b.budgetTotal }),
        ...(b.accepting !== null && { accepting: b.accepting }),
      };
      const after = { ...c, ...next };
      const low = budgetLow(after) || after.accepting === false;
      updateCampaign(c.id, { ...next, budgetWarnedAt: low ? (c.budgetWarnedAt ?? now()) : null });
      if (low && !c.budgetWarnedAt)
        await notify(
          after.accepting === false ? `${c.title} stopped taking clips` : `${c.title} is running out of budget`,
          after.accepting === false ? 'Its page says it isn’t accepting clips. Pause it so no more clips are made for it.' : `${moneyText(after.budgetLeft)} left. Clips posted when it runs out may not be paid.`,
          `/campaigns/${c.id}`,
        );
    } catch (err) {
      console.warn(`[campaigns] budget of ${c.title}: ${(err as Error).message}`);
      updateCampaign(c.id, { budgetCheckedAt: now() });
    }
  }
}
