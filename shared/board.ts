// The board (PLAN.md Phase 14): one set of columns for every page, the same on Home (every page) and on a page's
// sections. A card's column comes from its stage; only the writing columns are mine to move cards between.

export const BOARD_COLUMNS = ['ideas', 'writing', 'film', 'editing', 'review', 'scheduled', 'posted'] as const;
export type BoardColumn = (typeof BOARD_COLUMNS)[number];

export const COLUMN_LABELS: Record<BoardColumn, string> = {
  ideas: 'Ideas',
  writing: 'Writing',
  film: 'Ready to film',
  editing: 'Editing',
  review: 'Review',
  scheduled: 'Scheduled',
  posted: 'Posted',
};

/** Where I write: I drag cards between these. */
export const WRITING_COLUMNS = ['ideas', 'writing', 'film'] as const satisfies readonly BoardColumn[];
export type WritingColumn = (typeof WRITING_COLUMNS)[number];
/** Where Claude edits and I watch, approve and see it go out. */
export const VIDEO_COLUMNS = ['editing', 'review', 'scheduled', 'posted'] as const satisfies readonly BoardColumn[];

/** The stage a writing column puts a card in. */
export const COLUMN_STAGE: Record<WritingColumn, string> = { ideas: 'idea', writing: 'script', film: 'film' };

export const isWritingColumn = (c: BoardColumn): c is WritingColumn => (WRITING_COLUMNS as readonly string[]).includes(c);

/** The column a stage shows in. Approved but not queued (`ready`) waits with Scheduled, flagged. */
export function columnOf(stage: string): BoardColumn {
  switch (stage) {
    case 'idea':
      return 'ideas';
    case 'script':
      return 'writing';
    case 'film':
      return 'film';
    case 'edit':
    case 'making':
    case 'fixing':
      return 'editing';
    case 'review':
      return 'review';
    case 'ready':
    case 'scheduled':
      return 'scheduled';
    case 'posted':
      return 'posted';
    default:
      return 'ideas';
  }
}

/** Posted cards stay on the board this long. */
export const POSTED_DAYS = 7;

/** A card on the board. */
export type BoardItem = {
  id: string;
  workspaceId: string;
  title: string;
  stage: string;
  column: BoardColumn;
  position: number;
  updatedAt: number;
  /** The newest render's length. */
  durationMs: number | null;
  /** A render is queued or drawing. */
  rendering: boolean;
  openComments: number;
  /** When it next goes out. */
  nextPostAt: number | null;
  /** Why it didn't go out (a failed or missed post), or that it's approved with nowhere queued. */
  failed: string | null;
  /** When it went out, or was due to (the queue time). */
  postedAt: number | null;
  series: { id: string; name: string; episode: number } | null;
  /** Clips I shared for it. */
  footage: number;
};

/** An episode of a series: a card, numbered by its place in the series. */
export type SeriesEpisode = { id: string; title: string; episode: number; column: BoardColumn };

/** A series on a page: what every episode follows (Claude reads it when writing one), and its episodes in order. */
export type Series = { id: string; workspaceId: string; name: string; about: string; episodes: SeriesEpisode[] };

/** A page as the board and the top bar show it. */
export type BoardPage = { id: string; name: string; color: string; kind: string; hidden: boolean };

export type BoardData = { pages: BoardPage[]; items: BoardItem[] };

/** A link I dropped on a clipping page for Claude to check when making its videos. */
export type CampaignLink = {
  id: string;
  title: string | null;
  link: string;
  ended: boolean;
  checked: boolean;
  /** What stops or questions it: "Not halal", "Halal?" (the screen's doubts, in `why`), "Couldn’t read it". */
  note: string | null;
  why: string;
};
