// Campaigns: Content Rewards campaigns (read from their page) and my businesses' own, assigned to the pages they post
// on, with their rule checklist, halal screen and source videos. Shared by the server and the web app.

import type { Moment } from './clipping';

/** Where a campaign comes from: a Content Rewards (Whop) campaign page, or one of my businesses (no link). */
export const CAMPAIGN_ORIGINS = ['content_rewards', 'business'] as const;
export type CampaignOrigin = (typeof CAMPAIGN_ORIGINS)[number];

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
export type RuleItem = { text: string; kind: RuleKind; check: RuleCheck | null; by?: 'you' };

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
  createdAt: number;
};

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
  /** The workspaces (pages) it posts on. */
  pageIds: string[];
  createdAt: number;
  updatedAt: number;
  /** A read of its page is waiting or running. */
  reading?: boolean;
};

export type CampaignDetail = Campaign & { sources: CampaignSource[]; moments: Moment[] };

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

/** Content Rewards campaign pages (and Whop's own). */
export function isCampaignLink(url: string) {
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) && /(^|\.)(contentrewards\.com|whop\.com)$/.test(u.hostname);
  } catch {
    return false;
  }
}

export const money = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : n >= 1000 ? `$${(n / 1000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, '')}K` : `$${n % 1 ? n.toFixed(2) : n}`;
