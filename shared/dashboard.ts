// The dashboard (Today): one column per page with where every video is, what each page posts and how it does.
import type { PublishPlatform, AccountStatus } from './publish';
import type { WorkspaceColor, WorkspaceKind } from './types';

/**
 * Where a video is in the loop: I watch it (`watch`, or `recheck` once Claude changed it after my comments), my
 * comments go to Claude (`improve`), I approve it and it goes out. `ready`: approved but not scheduled (no account
 * could take it).
 */
export type FlowStep = 'review' | 'claude' | 'approved' | 'scheduled' | 'posted';
export const FLOW_STEPS: { id: FlowStep; label: string }[] = [
  { id: 'review', label: 'Your review' },
  { id: 'claude', label: 'With Claude' },
  { id: 'approved', label: 'Approved' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'posted', label: 'Posted' },
];

/** Posts a week each page aims for, by kind (PLAN.md *Pages*), until I set my own. */
export const DEFAULT_GOALS: Record<WorkspaceKind, number> = { personal: 3, business: 3, islamic: 7, clipping: 14 };
export const GOAL_CHOICES = [1, 2, 3, 4, 5, 7, 10, 14];
export const goalText = (perWeek: number) => (perWeek >= 7 && perWeek % 7 === 0 ? `${perWeek / 7} a day` : `${perWeek} a week`);

export type DashVideo = {
  id: string;
  title: string;
  thumbMediaId: string | null;
  durationMs: number | null;
  /** watch | recheck (my turn), improve (Claude's), ready (approved, not scheduled). */
  state: 'watch' | 'recheck' | 'improve' | 'ready';
  open: number;
  version: number | null;
  /** A render on its way (Claude's fixes), with how far it is. */
  rendering: { status: 'queued' | 'running'; progress: number; stage: string } | null;
  campaign: string | null;
  updatedAt: number;
};

export type DashPost = {
  id: string;
  pieceId: string;
  title: string;
  thumbMediaId: string | null;
  platform: PublishPlatform;
  account: string;
  at: number;
  status: 'scheduled' | 'publishing' | 'published' | 'failed' | 'missed';
  views: number | null;
  error: string | null;
};

export type DashAttention = { id: string; tone: 'red' | 'amber'; text: string; to: string | null; postId?: string };

export type PageColumn = {
  id: string;
  name: string;
  color: WorkspaceColor;
  kind: WorkspaceKind;
  accounts: { id: string; platform: PublishPlatform; label: string; status: AccountStatus; times: string[] }[];
  goal: number;
  /** This week (Monday on): out and still to go out. */
  week: { posted: number; scheduled: number };
  today: { posted: number; scheduled: number };
  /** The day the last scheduled post goes out (null: nothing scheduled). */
  coveredUntil: number | null;
  stats: { views: number | null; posts: number; followers: number | null; followersChange: number | null; typical: number | null };
  yourTurn: DashVideo[];
  withClaude: DashVideo[];
  /** Clips being made (moments) for it, and earlier stages' cards (ideas, scripts, filming) by stage. */
  making: number;
  earlier: { id: string; name: string; count: number }[];
  goingOut: DashPost[];
  posted: DashPost[];
  attention: DashAttention[];
};

/** Where an approval would put a video, before the click. */
export type ApprovePlan = {
  targets: { accountId: string; platform: PublishPlatform; label: string; at: number | null; problem: string | null }[];
  missingPlatforms: PublishPlatform[];
  error?: string;
};
