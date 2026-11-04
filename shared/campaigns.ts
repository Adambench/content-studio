// Campaigns: clipping marketplaces' campaigns (Content Rewards, Vyro: read from their page) and my businesses' own,
// assigned to the pages they post on, with their rule checklist, halal screen and source videos. Shared by the server
// and the web app.

import type { Moment } from './clipping';
import type { PublishPlatform } from './publish';
import type { SiteId } from './sites';

/** Where a campaign comes from: a marketplace's campaign page (Content Rewards on Whop, Vyro), or one of my businesses (no link). */
export const CAMPAIGN_ORIGINS = ['content_rewards', 'vyro', 'business'] as const;
export type CampaignOrigin = (typeof CAMPAIGN_ORIGINS)[number];

/** The clipping marketplaces: campaigns there are read from their page, joined and submitted to by me on the site. */
export const MARKETS = ['content_rewards', 'vyro'] as const;
export type Market = (typeof MARKETS)[number];
export const isMarket = (origin: CampaignOrigin): origin is Market => (MARKETS as readonly string[]).includes(origin);

export type MarketInfo = {
  label: string;
  /** The signed-in window it's read in (Settings → Connected sites). */
  site: SiteId;
  /** Where my submitted posts are listed with their status, views and earnings. */
  submissionsUrl: string;
  /** What a campaign's link looks like, for the Add dialog. */
  linkExample: string;
  /** The button on a campaign's page where a post's link is submitted. */
  submitButton: string;
};

export const MARKET_INFO: Record<Market, MarketInfo> = {
  content_rewards: {
    label: 'Content Rewards',
    site: 'whop',
    submissionsUrl: 'https://contentrewards.com/c/submissions',
    linkExample: 'https://contentrewards.com/c/campaigns/…',
    submitButton: 'Submit clip',
  },
  vyro: {
    label: 'Vyro',
    site: 'vyro',
    submissionsUrl: 'https://app.vyro.com/earnings',
    linkExample: 'https://app.vyro.com/campaigns?c=…',
    submitButton: 'Submit post',
  },
};

export const originLabel = (origin: CampaignOrigin) => (isMarket(origin) ? MARKET_INFO[origin].label : 'My business');

/**
 * `reading`: the page (or brief) is being read and screened. `to_confirm`: waiting for me to check it and pick its
 * pages (a rejected one stays here until deleted). Then `active`, `paused` or `ended`.
 */
export const CAMPAIGN_STATUSES = ['reading', 'to_confirm', 'active', 'paused', 'ended'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
export const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  reading: 'Reading',
  to_confirm: 'To confirm',
  active: 'Active',
  paused: 'Paused',
  ended: 'Ended',
};

export type HalalVerdict = 'ok' | 'flag' | 'reject';
export const HALAL_LABELS: Record<HalalVerdict, string> = { ok: 'Halal check passed', flag: 'Flagged', reject: 'Rejected' };

/** Platforms a campaign pays for. */
export const CAMPAIGN_PLATFORMS = ['tiktok', 'instagram', 'youtube', 'x'] as const;
export type CampaignPlatform = (typeof CAMPAIGN_PLATFORMS)[number];
export const CAMPAIGN_PLATFORM_LABELS: Record<CampaignPlatform, string> = { tiktok: 'TikTok', instagram: 'Instagram', youtube: 'YouTube', x: 'X' };

/** What a campaign pays on one platform, in dollars. */
export type Payout = { platform: CampaignPlatform; ratePer1k: number | null; minPayout: number | null; maxPayout: number | null; flatFee: number | null };

/**
 * One rule from the brief. `required`: something every clip must do; `forbidden`: something it must never do;
 * `format`: length, shape, quality; `caption`: what the caption must hold. `check` is what the app can test by itself
 * (the rest are tick boxes at review). `by: 'you'` marks rules I added, which a new read of the page keeps.
 */
export const RULE_KINDS = ['required', 'forbidden', 'format', 'caption'] as const;
export type RuleKind = (typeof RULE_KINDS)[number];
export const RULE_KIND_LABELS: Record<RuleKind, string> = { required: 'Must', forbidden: 'Never', format: 'Format', caption: 'Caption' };
export const CHECK_TYPES = ['maxSeconds', 'minSeconds', 'mention', 'hashtag', 'text', 'platform', 'watermark'] as const;
export type CheckType = (typeof CHECK_TYPES)[number];
export type RuleCheck = { type: CheckType; value: string | number };
/** `platforms`: the platforms the rule is about ("tag @x on YouTube"); none = every platform. */
export type RuleItem = { text: string; kind: RuleKind; check: RuleCheck | null; platforms?: CampaignPlatform[]; by?: 'you' };

/** Platform names a rule may be worded with ("on YouTube", "IG", "Reels"). */
const PLATFORM_WORDS: [CampaignPlatform, RegExp][] = [
  ['youtube', /\b(youtube|yt)\b/i],
  ['instagram', /\b(instagram|insta|ig|reels?)\b/i],
  ['tiktok', /\b(tiktok|tik tok|tt)\b/i],
  ['x', /\b(twitter|on x)\b/i],
];

/**
 * The platforms a rule is about: the ones it was read with, else the ones its words name ("Must tag @a on Youtube"),
 * else none (it applies everywhere). A rule naming the platforms a clip may go to (`platform` check) is about all.
 */
export function ruleScope(rule: RuleItem): CampaignPlatform[] {
  if (rule.check?.type === 'platform') return [];
  if (rule.platforms?.length) return rule.platforms;
  return PLATFORM_WORDS.filter(([, re]) => re.test(rule.text)).map(([p]) => p);
}

/** Whether a rule applies to a clip going to `platforms` (none known yet: every rule does). */
export const ruleApplies = (rule: RuleItem, platforms: readonly string[]) => {
  const scope = ruleScope(rule);
  return !scope.length || !platforms.length || scope.some((p) => platforms.includes(p));
};

/** Where a source video comes from. `link` is any other address (a direct file). */
export const SOURCE_KINDS = ['youtube', 'twitch', 'kick', 'drive', 'file', 'link'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export const SOURCE_KIND_LABELS: Record<SourceKind, string> = { youtube: 'YouTube', twitch: 'Twitch', kick: 'Kick', drive: 'Google Drive', file: 'Upload', link: 'Link' };

/**
 * `found`: listed on the campaign page or in a channel, not downloaded (I pick). Then `queued` → `downloading` →
 * `transcribing` → `scanning` (an active campaign's: the liveliest stretches found, then Claude picks moments) →
 * `ready`, or `error`.
 */
export const SOURCE_STATUSES = ['found', 'queued', 'downloading', 'transcribing', 'scanning', 'ready', 'error'] as const;
export type SourceStatus = (typeof SOURCE_STATUSES)[number];
export const SOURCE_STATUS_LABELS: Record<SourceStatus, string> = {
  found: 'Not downloaded',
  queued: 'Waiting',
  downloading: 'Downloading',
  transcribing: 'Transcribing',
  scanning: 'Finding moments',
  ready: 'Ready',
  error: 'Failed',
};

export type CampaignSource = {
  id: string;
  campaignId: string;
  kind: SourceKind;
  link: string | null;
  title: string;
  durationMs: number | null;
  size: number | null;
  status: SourceStatus;
  /** 0–1 while downloading. */
  progress: number | null;
  /** What it's doing ("1.2 GB of 2.4 GB"), or why it failed. */
  detail: string;
  /** How the transcript was made: the platform's captions or Whisper. */
  transcriptFrom: 'captions' | 'whisper' | null;
  /** The video file is on this computer (it goes some days after the campaign ends; the transcript stays). */
  downloaded: boolean;
  createdAt: number;
};

/** Days after a campaign ends that its downloaded source videos are deleted, by default. */
export const SOURCE_RETENTION_DAYS = 7;

export type Campaign = {
  id: string;
  origin: CampaignOrigin;
  businessWorkspaceId: string | null;
  link: string | null;
  title: string;
  brand: string;
  type: string;
  category: string;
  description: string;
  status: CampaignStatus;
  accepting: boolean | null;
  /** The best rate per 1,000 views across platforms (for lists); `payouts` has each platform's. */
  ratePer1k: number | null;
  payouts: Payout[];
  platforms: CampaignPlatform[];
  budgetTotal: number | null;
  budgetLeft: number | null;
  deadline: number | null;
  rulesText: string;
  /** The page hides the rules and files until you join (or it was read signed out). */
  rulesLocked: boolean;
  checklist: RuleItem[];
  requirements: string;
  halalVerdict: HalalVerdict | null;
  halalReasons: string[];
  readAt: number | null;
  /** Why the last read didn't work, or what it couldn't see. */
  readNote: string | null;
  /** When the budget was last read from the public page (every day while active). */
  budgetCheckedAt: number | null;
  /** When it was ended (its source videos are deleted some days after). */
  endedAt: number | null;
  /** The workspaces (pages) it posts on. */
  pageIds: string[];
  createdAt: number;
  updatedAt: number;
  /** A read of its page is waiting or running. */
  reading?: boolean;
};

/** A video filmed for a campaign (UGC): a card on one of its pages. */
export type UgcPiece = { id: string; title: string; stage: string; workspaceId: string; createdAt: number };

export type CampaignDetail = Campaign & { sources: CampaignSource[]; moments: Moment[]; ugc: UgcPiece[]; submissions: Submission[]; results: CampaignResults };

/**
 * A posted clip's submission to its Content Rewards campaign. `to_submit`: posted, waiting for me to submit it on
 * Content Rewards (the app never submits). `submitted`: waiting for the campaign's review. Then `approved` (earning
 * on its views), `rejected` or `paid`. `skipped`: I chose not to submit it.
 */
export const SUBMISSION_STATUSES = ['to_submit', 'submitted', 'approved', 'rejected', 'paid', 'skipped'] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];
export const SUBMISSION_STATUS_LABELS: Record<SubmissionStatus, string> = {
  to_submit: 'To submit',
  submitted: 'Submitted',
  approved: 'Approved',
  rejected: 'Rejected',
  paid: 'Paid',
  skipped: 'Not submitted',
};

export type Submission = {
  id: string;
  postId: string;
  campaignId: string;
  workspaceId: string;
  pieceId: string;
  platform: PublishPlatform;
  /** The post's link, what gets submitted. */
  url: string;
  status: SubmissionStatus;
  submittedAt: number | null;
  /** Views the campaign counted, and what it says the clip earned (read from Content Rewards, or typed in). */
  views: number | null;
  earnings: number | null;
  earningsFrom: 'site' | 'you' | null;
  /** The campaign's reason for a rejection or a flag, or a note of mine. */
  note: string;
  /** When Content Rewards was last read for it. */
  checkedAt: number | null;
  createdAt: number;
  updatedAt: number;
  pieceTitle: string;
  accountLabel: string;
  publishedAt: number | null;
  thumbMediaId: string | null;
  /** The post's latest views from the platform (our own stats). */
  postViews: number | null;
  /** Views × the platform's rate within the min and max payout, while the campaign hasn't said what it earned. */
  estimate: number | null;
  /** Why the estimate is what it is ("under the $2 minimum"). */
  estimateNote: string | null;
};

/** A campaign's numbers: its clips, what they did, the campaign's verdicts and what they earned. */
export type CampaignResults = {
  /** Moments made into clips, waiting in Review, approved by me (gone on to Ready or further), rejected by me. */
  clips: { made: number; inReview: number; approved: number; rejected: number };
  /** Videos filmed for it (UGC). */
  filmed: number;
  /** Clips posted (each counted once, however many accounts it went to) and their posts. */
  posted: number;
  posts: number;
  /** Their latest views, from our own stats. */
  views: number | null;
  submissions: Record<SubmissionStatus, number>;
  /** Approved (or paid) over approved, paid and rejected: how often the campaign accepts my clips. */
  approvalRate: number | null;
  /** What the campaign says approved clips earned (or what I typed), and how much of it is paid. */
  earned: number;
  paid: number;
  /** Estimated from views for approved or pending clips without a number from the campaign. */
  estimated: number;
  /** (earned + estimated) per clip posted. */
  perClip: number | null;
  budgetLow: boolean;
};

/** Less than 15% of the budget left (or none): clips posted now may not get paid. */
export function budgetLow(c: Pick<Campaign, 'budgetLeft' | 'budgetTotal'>) {
  if (c.budgetLeft === null) return false;
  return c.budgetLeft <= 0 || (!!c.budgetTotal && c.budgetLeft / c.budgetTotal < 0.15);
}

/**
 * What a post's views should earn on a platform: views ÷ 1,000 × the rate, capped at the max payout. Under the min
 * payout a submission earns nothing. A flat fee is paid per approved clip.
 */
export function estimateEarnings(views: number | null, payout: Payout | undefined): { amount: number | null; note: string | null } {
  if (!payout) return { amount: null, note: 'The campaign doesn’t pay on this platform' };
  if (payout.ratePer1k === null) return payout.flatFee !== null ? { amount: payout.flatFee, note: 'Flat fee' } : { amount: null, note: null };
  if (views === null) return { amount: null, note: 'No views read yet' };
  const raw = (views / 1000) * payout.ratePer1k + (payout.flatFee ?? 0);
  if (payout.maxPayout !== null && raw >= payout.maxPayout) return { amount: payout.maxPayout, note: `Capped at the ${money(payout.maxPayout)} max` };
  if (payout.minPayout !== null && raw < payout.minPayout) return { amount: 0, note: `Under the ${money(payout.minPayout)} minimum` };
  return { amount: Math.round(raw * 100) / 100, note: null };
}

/**
 * One key per post, however its link is spelled, to match my posts with the ones on Content Rewards: the TikTok video
 * id, the Instagram shortcode, the YouTube video id, else the link without its query.
 */
export function postKey(url: string) {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return url.trim().toLowerCase();
  }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  if (host.endsWith('tiktok.com')) {
    const id = /\/(?:video|photo)\/(\d{6,})/.exec(u.pathname)?.[1];
    if (id) return `tiktok:${id}`;
  }
  if (host.endsWith('instagram.com')) {
    const code = /\/(?:p|reel|reels|tv)\/([\w-]+)/.exec(u.pathname)?.[1];
    if (code) return `instagram:${code}`;
  }
  if (host === 'youtube.com' || host === 'youtu.be') {
    const id = host === 'youtu.be' ? u.pathname.slice(1).split('/')[0] : u.pathname === '/watch' ? u.searchParams.get('v') : /^\/(?:shorts|live|embed)\/([\w-]{11})/.exec(u.pathname)?.[1];
    if (id) return `youtube:${id}`;
  }
  return `${host}${u.pathname.replace(/\/+$/, '')}`.toLowerCase();
}

/** What a link points at, by its address. */
export function sourceKindOf(url: string): SourceKind {
  let host = '';
  try {
    host = new URL(url).hostname.replace(/^www\.|^m\./, '');
  } catch {
    return 'link';
  }
  if (host === 'youtube.com' || host === 'youtu.be' || host === 'music.youtube.com') return 'youtube';
  if (host.endsWith('twitch.tv')) return 'twitch';
  if (host === 'kick.com') return 'kick';
  if (host === 'drive.google.com' || host === 'drive.usercontent.google.com') return 'drive';
  return 'link';
}

/**
 * One spelling per video, so the same one pasted twice (from a playlist, youtu.be, Shorts, with a start time) is
 * found again: YouTube videos become `https://www.youtube.com/watch?v=<id>`; other links lose their #fragment.
 */
export function canonicalLink(url: string) {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return url.trim();
  }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  const id =
    host === 'youtu.be'
      ? u.pathname.slice(1).split('/')[0]
      : host === 'youtube.com' || host === 'music.youtube.com'
        ? u.pathname === '/watch'
          ? u.searchParams.get('v')
          : /^\/(shorts|live|embed)\/([\w-]{11})/.exec(u.pathname)?.[2]
        : null;
  if (id && /^[\w-]{11}$/.test(id)) return `https://www.youtube.com/watch?v=${id}`;
  u.hash = '';
  return u.toString();
}

const CR_CAMPAIGN = /^\/c\/campaigns\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;
const VYRO_NOT_CAMPAIGN = new Set(['new', 'add-clips']);

/**
 * A campaign's own page on a marketplace, and one key for it however the link is spelled (a Vyro slug changes with
 * the title, its last 8 characters don't). Content Rewards: contentrewards.com/c/campaigns/<uuid> (?group=1 and the
 * like dropped). Vyro: app.vyro.com/campaigns?c=<slug-id>, or /campaigns/<slug-id> (from My campaigns). Null when it
 * isn't one: whop.com's own pages don't say which campaign is open, so they aren't campaign links.
 */
export function parseCampaignLink(url: string): { market: Market; link: string; key: string } | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'contentrewards.com') {
    const id = CR_CAMPAIGN.exec(u.pathname)?.[1]?.toLowerCase();
    return id ? { market: 'content_rewards', link: `https://contentrewards.com/c/campaigns/${id}`, key: `content_rewards:${id}` } : null;
  }
  if (host === 'app.vyro.com' || host === 'vyro.com') {
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts[0] !== 'campaigns') return null;
    const slug = u.searchParams.get('c') ?? (parts.length === 2 && !VYRO_NOT_CAMPAIGN.has(parts[1]) ? parts[1] : parts.length === 3 && parts[1] === 'add-clips' ? parts[2] : null);
    if (!slug || !/^[\w-]{4,200}$/.test(slug)) return null;
    return { market: 'vyro', link: `https://app.vyro.com/campaigns?c=${slug}`, key: `vyro:${slug.slice(-8)}` };
  }
  return null;
}

/** A marketplace campaign's page (Content Rewards or Vyro). */
/**
 * The campaign's preview picture as its marketplace draws it (banner, name, brand, budget and pay: what I recognise
 * it by on Whop). Content Rewards makes one per campaign from its id; null where there's none.
 */
export function campaignPicture(link: string | null) {
  const p = link ? parseCampaignLink(link) : null;
  const id = p?.market === 'content_rewards' ? /\/campaigns\/([0-9a-f-]{36})/i.exec(p.link)?.[1] : null;
  return id ? `https://contentrewards.com/c/api/og/campaigns/${id.toLowerCase()}` : null;
}

export const isCampaignLink = (url: string) => !!parseCampaignLink(url);

/** The key a stored campaign link dedupes by (see parseCampaignLink); the link itself when it isn't one. */
export const campaignKey = (url: string) => parseCampaignLink(url)?.key ?? url.trim().replace(/[?#].*$/, '');

export const money = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : n >= 1000 ? `$${(n / 1000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, '')}K` : `$${n % 1 ? n.toFixed(2) : n}`;
