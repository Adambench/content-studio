// The one-button finder on a clipping page ("Find clips"): campaigns worth joining, the creators' videos worth
// clipping, moments other clippers already got big, then the usual scan, pick and make, ending in Review.

/** A stretch of a source video that another clipper's clip of it already got big views on. */
export type ViralHint = {
  /** In the source, seconds. */
  start: number;
  end: number;
  /** The clip that went viral: its link, title and views. */
  link: string;
  title: string;
  views: number;
  /** How much of that clip's words were found in the source (0–1). */
  match: number;
};

export type FinderStepId = 'campaigns' | 'videos' | 'viral' | 'clips';
export type FinderStep = { id: FinderStepId; label: string; status: 'waiting' | 'running' | 'done' | 'skipped' | 'error'; detail: string };

export const FINDER_STEPS: Record<FinderStepId, string> = {
  campaigns: 'Looking for campaigns',
  videos: 'Finding the creators’ videos',
  viral: 'Finding moments that already went viral',
  clips: 'Making clips',
};

export type FinderRun = {
  status: 'idle' | 'running' | 'done' | 'error';
  startedAt: number;
  finishedAt: number | null;
  steps: FinderStep[];
  /** One line at the end: what it found and started. */
  summary: string;
};

/** A campaign found on Content Rewards that isn't added yet (joining it on Whop stays the creator's click). */
export type CampaignLead = {
  link: string;
  title: string;
  brand: string;
  /** Best rate per 1,000 views in US dollars. */
  ratePer1k: number | null;
  budgetLeft: number | null;
  category: string;
  halal: 'ok' | 'flag' | 'reject';
  halalNote: string;
  /** 0–100, from pay, budget left and halal. */
  score: number;
};

export type CampaignLeads = { at: number; items: CampaignLead[]; note: string };

export const emptyRun = (): FinderRun => ({ status: 'idle', startedAt: 0, finishedAt: null, steps: [], summary: '' });

/** A source video as the finder ranks it. */
export type RankInput = { id: string; title: string; views: number | null; uploadedAt: number | null; durationMs: number | null; moments: number };

const DAY = 86_400_000;

/** Higher is better: well viewed, recent, a length worth mining, and not mined already. null = skip it. */
export function videoScore(v: RankInput, now: number): number | null {
  const minutes = v.durationMs ? v.durationMs / 60_000 : null;
  if (minutes !== null && (minutes < 4 || minutes > 240)) return null;
  const views = Math.log10((v.views ?? 0) + 10);
  const ageDays = v.uploadedAt ? Math.max(0, (now - v.uploadedAt) / DAY) : 365;
  const fresh = ageDays <= 30 ? 1 : Math.max(0.4, 1 - (ageDays - 30) / 450);
  const long = minutes === null ? 0.9 : Math.min(1, 0.6 + minutes / 60);
  const mined = v.moments > 0 ? 0.35 : 1;
  return Math.round(views * fresh * long * mined * 100) / 100;
}

export function rankVideos<T extends RankInput>(videos: T[], now = Date.now()): T[] {
  return videos
    .map((v) => ({ v, s: videoScore(v, now) }))
    .filter((x): x is { v: T; s: number } => x.s !== null)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.v);
}

/** Campaign leads: pay per 1,000 views, enough budget left, halal screened (rejects never make the list). */
export function leadScore(l: Pick<CampaignLead, 'ratePer1k' | 'budgetLeft' | 'halal'>): number {
  if (l.halal === 'reject') return 0;
  const pay = Math.min(1, (l.ratePer1k ?? 0) / 3);
  const budget = l.budgetLeft === null ? 0.5 : Math.min(1, Math.log10(l.budgetLeft + 1) / 4.5);
  return Math.round((pay * 0.6 + budget * 0.4) * (l.halal === 'flag' ? 0.7 : 1) * 100);
}
