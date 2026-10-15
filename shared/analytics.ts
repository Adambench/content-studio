// Analytics: the numbers platforms report for posts and accounts, and the weekly review's shape.
import type { QueueSlot } from './publish';

/** One reading of a post's numbers. Null: the platform doesn't report it (or not for this kind of post, or not yet). */
export type PostStats = {
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  /** Accounts that saw it (Instagram). */
  reach: number | null;
  /** Average time watched per view, in seconds (Instagram Reels, YouTube). */
  avgWatchSeconds: number | null;
  /** Average share of the video watched, 0–100 (YouTube). */
  avgViewPercent: number | null;
  /** Followers or subscribers it brought in (YouTube). */
  followsGained: number | null;
};

export const POST_STAT_KEYS = ['views', 'likes', 'comments', 'shares', 'saves', 'reach', 'avgWatchSeconds', 'avgViewPercent', 'followsGained'] as const satisfies readonly (keyof PostStats)[];

export const emptyStats = (): PostStats => ({ views: null, likes: null, comments: null, shares: null, saves: null, reach: null, avgWatchSeconds: null, avgViewPercent: null, followsGained: null });

/** An account's numbers on one day. */
export type AccountStats = { followers: number | null; views: number | null; likes: number | null; posts: number | null };

/** Likes, comments, shares and saves per view. */
export function engagementRate(s: Pick<PostStats, 'views' | 'likes' | 'comments' | 'shares' | 'saves'> | null | undefined): number | null {
  if (!s?.views) return null;
  return ((s.likes ?? 0) + (s.comments ?? 0) + (s.shares ?? 0) + (s.saves ?? 0)) / s.views;
}

const HOUR = 3600_000;

/** How often a published post's numbers are read again, by its age: often while it's new, then less. Null: no more. */
export function statsInterval(ageMs: number): number | null {
  if (ageMs < 48 * HOUR) return 3 * HOUR;
  if (ageMs < 7 * 24 * HOUR) return 12 * HOUR;
  if (ageMs < 30 * 24 * HOUR) return 24 * HOUR;
  if (ageMs < 90 * 24 * HOUR) return 7 * 24 * HOUR;
  return null;
}

/** Posts are compared at the same age, so a post from this morning isn't measured against one from last month. */
export const BENCHMARK_AGE_MS = 24 * HOUR;

/**
 * A value at time `t`, read off sorted readings: linear between the two around it, or null outside them or when
 * they're more than `maxGapMs` apart (too far to guess between).
 */
export function valueAt(points: { at: number; value: number | null }[], t: number, maxGapMs = Infinity): number | null {
  const known = points.filter((p): p is { at: number; value: number } => p.value !== null);
  for (let i = 0; i < known.length; i++) {
    const b = known[i];
    if (b.at === t) return b.value;
    if (b.at < t) continue;
    const a = known[i - 1];
    if (!a || b.at - a.at > maxGapMs) return null;
    return a.value + ((b.value - a.value) * (t - a.at)) / (b.at - a.at);
  }
  return null;
}

export const median = (values: number[]) => {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Parts of the day posts are grouped into when looking for good posting times (local time). */
export const DAY_PARTS = [
  { id: 'morning', label: 'Morning', from: 5, to: 11 },
  { id: 'midday', label: 'Midday', from: 11, to: 15 },
  { id: 'afternoon', label: 'Afternoon', from: 15, to: 19 },
  { id: 'evening', label: 'Evening', from: 19, to: 23 },
  { id: 'night', label: 'Night', from: 23, to: 29 },
] as const;
export type DayPart = (typeof DAY_PARTS)[number]['id'];
export function dayPart(hour: number): DayPart {
  // Small hours count as the night before.
  const h = hour < 5 ? hour + 24 : hour;
  return DAY_PARTS.find((p) => h >= p.from && h < p.to)!.id;
}

// ---------- weekly review ----------

export type ReviewStatus = 'running' | 'done' | 'error';

/** New queue times Claude suggests for an account. Only applied when you click. */
export type ReviewSlotSuggestion = { accountId: string; account: string; slots: QueueSlot[]; reason: string; appliedAt?: number };
export type ReviewIdea = { title: string; hook: string; why: string; pieceId?: string };
export type ReviewWin = { title: string; why: string; pieceId?: string; account?: string };

export type ReviewBody = {
  /** One line: how the week went. */
  headline: string;
  /** A few markdown bullets. */
  summary: string;
  wins: ReviewWin[];
  lessons: string[];
  ideas: ReviewIdea[];
  slots: ReviewSlotSuggestion[];
  /** What changed in the voice memory, in a sentence (empty when nothing did). */
  voiceNote: string;
  voiceUndone?: boolean;
};

export type WeeklyReviewSetting = { enabled: boolean; day: number; time: string };
export const DEFAULT_WEEKLY_REVIEW: WeeklyReviewSetting = { enabled: true, day: 1, time: '09:00' };

/** The most recent time the weekly review was due, at or before `at` (local time). */
export function lastReviewDue(setting: WeeklyReviewSetting, at: number) {
  const d = new Date(at);
  const [h, m] = setting.time.split(':').map(Number);
  const back = (d.getDay() - setting.day + 7) % 7;
  let due = new Date(d.getFullYear(), d.getMonth(), d.getDate() - back, h, m).getTime();
  if (due > at) due = new Date(d.getFullYear(), d.getMonth(), d.getDate() - back - 7, h, m).getTime();
  return due;
}
