// Clipping: moments found in a campaign's source videos, the clips made from them and their review. Shared by the
// server and the web app.

import { ruleApplies, ruleScope, type CampaignPlatform, type HalalVerdict, type RuleItem } from './campaigns';
import type { PublishPlatform } from './publish';
import type { WorkspaceColor } from './types';

/** What makes a moment work (the playbook's `clipping.md`). */
export const MOMENT_KINDS = ['story', 'claim', 'number', 'mistake', 'reaction', 'howto', 'answer', 'other'] as const;
export type MomentKind = (typeof MOMENT_KINDS)[number];
export const MOMENT_KIND_LABELS: Record<MomentKind, string> = {
  story: 'Story',
  claim: 'Strong claim',
  number: 'Number or result',
  mistake: 'Mistake',
  reaction: 'Reaction',
  howto: 'How-to',
  answer: 'Answer',
  other: 'Moment',
};

/**
 * `candidate`: found, not made. `making`: being cut, checked and edited (then it renders on the page's board).
 * `made`: its clip is on the board. `rejected`: I said no, with a reason the next pick learns from. `dropped`: the app
 * said no (music it couldn't remove, something on screen the halal check refused). `failed`: making it broke; it can
 * be tried again.
 */
export const MOMENT_STATUSES = ['candidate', 'making', 'made', 'rejected', 'dropped', 'failed'] as const;
export type MomentStatus = (typeof MOMENT_STATUSES)[number];
export const MOMENT_STATUS_LABELS: Record<MomentStatus, string> = {
  candidate: 'Found',
  making: 'Making',
  made: 'Made',
  rejected: 'Rejected',
  dropped: 'Dropped',
  failed: 'Failed',
};

/** The playbook's standalone score: five points, 0–2 each. Moments under 7 of 10 aren't kept. */
export type StandaloneScores = { opensCold: number; oneIdea: number; endsClean: number; noOutsideReference: number; length: number };
export const SCORE_POINTS: { key: keyof StandaloneScores; label: string }[] = [
  { key: 'opensCold', label: 'Opens cold' },
  { key: 'oneIdea', label: 'One idea' },
  { key: 'endsClean', label: 'Ends clean' },
  { key: 'noOutsideReference', label: 'Needs nothing outside it' },
  { key: 'length', label: 'Length' },
];
export const MIN_SCORE = 7;

/** Captions Claude writes with the moment, per platform (only those the campaign pays for are filled). */
export type MomentCaptions = {
  tiktok: { caption: string; hashtags: string };
  instagram: { caption: string; hashtags: string };
  youtube: { title: string; description: string; tags: string };
};

/**
 * What the music check found. `background`: something other than voice was loud enough to matter (music, most of
 * the time). The clip always keeps only the isolated voice; `verdict` says how sure that is: `none` (nothing in the
 * background), `removed` (there was, and the voice is silent in the pauses), `unverified` (there was, but the speech
 * never pauses long enough to check: listen at review), `left` (the voice isn't silent in the pauses: dropped).
 */
export type MusicCheck = {
  background: boolean;
  verdict: 'none' | 'removed' | 'unverified' | 'left';
  /** Loudness of the voice and of everything else (LUFS). */
  voiceLufs: number | null;
  restLufs: number | null;
  /** Seconds of pauses the voice was checked in. */
  pauseSeconds: number;
};

/**
 * Who mainly talks in a moment, from the source's title and description: their name and a few words on who they are.
 * `known` when most viewers would know them on sight; anyone else is named on screen as the clip starts.
 */
export type MomentSpeaker = { name: string; about: string; known: boolean };

/** The halal look at three frames of the clip. */
/**
 * Text or a logo the source put over its picture near the top or bottom edge that names another brand (a sponsor's
 * logo, an advertiser's name, a ticker): `depth` is how far in from that edge it reaches (a fraction of the height).
 */
export type BurnedIn = { what: string; edge: 'top' | 'bottom'; depth: number };
/** A stretch of the cut (seconds of it) left out of the clip: what it shows can't be shown (a woman, an insert, …). */
export type LeftOut = { start: number; end: number; why: string };
export type FramesCheck = { verdict: HalalVerdict; reasons: string[]; burnedIn?: BurnedIn[]; leftOut?: LeftOut[] };

export type Moment = {
  id: string;
  sourceId: string;
  campaignId: string;
  /** The page it's made for. */
  workspaceId: string;
  /** In and out points in the source, in seconds. */
  start: number;
  end: number;
  firstLine: string;
  /** On screen for the first ~2.5 s; empty when the first line carries the hook. */
  hookCard: string;
  title: string;
  kind: MomentKind;
  why: string;
  score: number;
  scores: StandaloneScores | null;
  captions: MomentCaptions | null;
  halalFlags: string[];
  /** Campaign rules to check by eye for this clip. */
  checkByEye: string[];
  speaker: MomentSpeaker | null;
  music: MusicCheck | null;
  frames: FramesCheck | null;
  status: MomentStatus;
  /** What it's doing while being made, or why it was dropped or failed. */
  detail: string;
  rejectReason: string | null;
  pieceId: string | null;
  /** The clip's card stage, while it has one. */
  pieceStage?: string | null;
  createdAt: number;
  updatedAt: number;
};

export const momentSeconds = (m: Pick<Moment, 'start' | 'end'>) => Math.max(0, m.end - m.start);

/** 754.2 → "12:34". */
export function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** Quick reasons on the reject dialog; any text works. */
export const REJECT_REASONS = ['Needs context to make sense', 'Weak hook', 'Boring or no payoff', 'Ends too early or too late', 'Off-niche for the page', 'Bad framing or crop', 'Wrong captions'];

/** One rule's result for a clip at review: checked by the app (`pass`/`fail`), or a tick box for me (`manual`). */
export type RuleResult = { rule: RuleItem; status: 'pass' | 'fail' | 'manual'; detail: string };

/** What a clip is checked against: its length, where it will go and what its captions say there. */
export type ClipFacts = {
  seconds: number | null;
  /** The platforms it would be posted to. */
  platforms: CampaignPlatform[];
  /** Everything a viewer reads on each platform (caption, hashtags, title, description, tags), by platform. */
  copy: Partial<Record<CampaignPlatform, string>>;
  watermark: boolean;
};

const has = (text: string, value: string) => text.toLowerCase().includes(value.toLowerCase());

/** Check a campaign's rules against a clip. Rules the app can't test become tick boxes. */
export function checkRules(checklist: RuleItem[], clip: ClipFacts): RuleResult[] {
  // Several platform rules mean "only these".
  const allowed = new Set(checklist.flatMap((r) => (r.check?.type === 'platform' ? [String(r.check.value).trim()] : [])));
  // A rule about another platform ("tag @a on YouTube") isn't shown or checked for a clip that doesn't go there.
  return checklist.filter((rule) => ruleApplies(rule, clip.platforms)).map((rule): RuleResult => {
    const c = rule.check;
    if (!c) return { rule, status: 'manual', detail: '' };
    const n = Number(c.value);
    const value = String(c.value).trim();
    switch (c.type) {
      case 'maxSeconds':
        if (clip.seconds === null) return { rule, status: 'manual', detail: 'Not rendered yet' };
        return clip.seconds <= n + 0.5 ? { rule, status: 'pass', detail: `${Math.round(clip.seconds)} s` } : { rule, status: 'fail', detail: `${Math.round(clip.seconds)} s, over ${n} s` };
      case 'minSeconds':
        if (clip.seconds === null) return { rule, status: 'manual', detail: 'Not rendered yet' };
        return clip.seconds >= n - 0.5 ? { rule, status: 'pass', detail: `${Math.round(clip.seconds)} s` } : { rule, status: 'fail', detail: `${Math.round(clip.seconds)} s, under ${n} s` };
      case 'mention':
      case 'hashtag':
      case 'text': {
        const want = c.type === 'mention' ? `@${value.replace(/^@/, '')}` : c.type === 'hashtag' ? `#${value.replace(/^#/, '')}` : value;
        if (!clip.platforms.length) return { rule, status: 'manual', detail: `No account to post on yet: put ${want} in its captions` };
        const scope = ruleScope(rule);
        const missing = clip.platforms.filter((p) => (!scope.length || scope.includes(p)) && !has(clip.copy[p] ?? '', want));
        return missing.length ? { rule, status: 'fail', detail: `${want} missing on ${missing.join(', ')}` } : { rule, status: 'pass', detail: `${want} in every caption` };
      }
      case 'platform': {
        const other = clip.platforms.filter((p) => !allowed.has(p));
        return other.length ? { rule, status: 'fail', detail: `Would also go to ${other.join(', ')}` } : { rule, status: 'pass', detail: clip.platforms.length ? `Goes to ${clip.platforms.join(', ')}` : 'No account to post on yet' };
      }
      case 'watermark':
        if (/^(none|no|false)$/i.test(value)) return clip.watermark ? { rule, status: 'fail', detail: 'The edit has a watermark' } : { rule, status: 'pass', detail: 'No watermark' };
        return { rule, status: 'manual', detail: '' };
      default:
        return { rule, status: 'manual', detail: '' };
    }
  });
}

/** A card in Review, as the review queue shows it. */
export type ReviewClip = {
  pieceId: string;
  title: string;
  hook: string;
  workspace: { id: string; name: string; color: WorkspaceColor };
  stage: string;
  updatedAt: number;
  /** The latest finished render: what gets approved. */
  render: { mediaId: string; durationMs: number | null; width: number | null; height: number | null; hasThumb: boolean } | null;
  /** A carousel's slides (its newest version), in order: posted as a carousel instead of a video. `render` is the first. */
  slides?: string[] | null;
  /** The edit version the latest render shows. */
  renderVersion: number | null;
  /** The render before it, for before/after after Claude changes the edit. */
  previousRender: { mediaId: string; hasThumb: boolean; version: number | null } | null;
  /** A render still going (or the last one, when it failed). */
  rendering: { status: string; progress: number; stage: string; error: string | null } | null;
  moment: Moment | null;
  campaign: { id: string; title: string; brand: string; link: string | null; platforms: CampaignPlatform[] } | null;
  source: { id: string; title: string; link: string | null } | null;
  /** What each platform's post would say, from the card's draft. */
  copy: Partial<Record<PublishPlatform, string>>;
  /** Where approving queues it. */
  accounts: { id: string; platform: PublishPlatform; label: string; tiktokMode: 'inbox' | 'direct'; reconnect: boolean }[];
  /** The campaign's paid platforms the page has no account on. */
  missingPlatforms: PublishPlatform[];
  rules: RuleResult[];
};
