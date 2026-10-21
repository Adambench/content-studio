// Ideas: a page's brainstorm, before anything is a video. An auto-laid mind map of cards (a phone shows the same
// cards as a nested list): ideas, series, posts saved from other people (links), screenshots. Any card can hold
// sub-ideas, notes and a script draft; one click locks an idea in as a video on the board. Shared by the server and
// the web app.
import type { ResearchAnalysis } from './research';

/**
 * `idea`: anything I write. `series`: an idea whose children are its episodes. `link`: a post saved from someone
 * else (TikTok, Reel, Short…). `image`: a screenshot or picture. `saved`: the page's Saved pile, where shares land.
 */
export const IDEA_KINDS = ['idea', 'series', 'link', 'image', 'saved'] as const;
export type IdeaKind = (typeof IDEA_KINDS)[number];

/** The video an idea became, as its card shows it. */
export type IdeaPiece = {
  id: string;
  workspaceId: string;
  title: string;
  stage: string;
  stageName: string;
  views: number | null;
  postedCount: number;
};

/** A saved post, as its card shows it (the research item it's kept as). */
export type IdeaPost = {
  itemId: string;
  platform: 'youtube' | 'tiktok' | 'instagram';
  channel: string;
  title: string;
  views: number | null;
  /** Its views over the account's usual. */
  score: number | null;
  postedAt: number | null;
  /** Fetching its details (`ideas.details`). */
  fetching: boolean;
  analysisStatus: 'none' | 'queued' | 'running' | 'done' | 'error';
};

/** What Claude came back with when asked for help on a card (Expand, Angles, Episodes, Challenge). */
export const ASSISTS = ['expand', 'angles', 'episodes', 'challenge'] as const;
export type AssistKind = (typeof ASSISTS)[number];
export type IdeaAssist = {
  kind: AssistKind;
  status: 'running' | 'done' | 'error';
  /** A line on the whole thing ("Strong premise; the payoff is vague"). */
  summary: string;
  items: { title: string; detail: string }[];
  error: string;
  at: number;
};

export const ASSIST_INFO: Record<AssistKind, { label: string; hint: string }> = {
  expand: { label: 'Expand', hint: 'Develop it: the angle, the story beats, what makes it land' },
  angles: { label: 'Angles', hint: 'Different ways in, each with a hook' },
  episodes: { label: 'Episodes', hint: 'What the next episodes could be' },
  challenge: { label: 'Challenge', hint: 'Why it might flop, and what would fix it' },
};

export type IdeaNode = {
  id: string;
  workspaceId: string;
  parentId: string | null;
  position: number;
  kind: IdeaKind;
  title: string;
  /** Free notes (a series: its premise). */
  body: string;
  /** A script draft, written any time. */
  script: string;
  /** A series' shared format and hook style. */
  format: string;
  labels: string[];
  collapsed: boolean;
  url: string | null;
  mediaId: string | null;
  /** Its picture: the image, or a saved post's thumbnail. */
  hasThumb: boolean;
  pieceId: string | null;
  piece: IdeaPiece | null;
  post: IdeaPost | null;
  /** Added by Claude (an accepted suggestion), not typed by me. */
  by: 'you' | 'claude';
  assist: IdeaAssist | null;
  /** The Saved pile: when I last looked inside (what's newer is "new"). */
  seenAt: number | null;
  createdAt: number;
  updatedAt: number;
};

/** Everything a saved post's panel shows beyond its card. */
export type IdeaDetail = IdeaNode & {
  transcript: string;
  analysis: ResearchAnalysis | null;
  analysisError: string | null;
  channelUrl: string | null;
};

/** A label's colour: the same name always gets the same one, so there's nothing to set up. */
export const LABEL_COLORS = ['violet', 'blue', 'cyan', 'emerald', 'amber', 'orange', 'rose', 'pink'] as const;
export function labelColor(label: string): (typeof LABEL_COLORS)[number] {
  let h = 0;
  for (const ch of label.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return LABEL_COLORS[h % LABEL_COLORS.length];
}

export const normalizeLabel = (raw: string) => raw.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '-').slice(0, 30);

/** The first link in a piece of text (what a share from TikTok or Instagram carries, among other words). */
export function firstLink(text: string): string | null {
  return /https?:\/\/[^\s<>"']+/i.exec(text)?.[0].replace(/[.,!?)]+$/, '') ?? null;
}

/** Cards a level shows before the rest fold into "N more" (open the card to see them all). */
export const SHOWN_CHILDREN = 12;
/** The Saved pile shows its newest few on the canvas. */
export const SHOWN_SAVED = 5;
/** Levels shown under the card being looked at; deeper ones fold into a count. */
export const SHOWN_DEPTH = 3;
