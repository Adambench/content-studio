// Where the creator is with watching a finished video: not watched yet, comments to fix, changed since the comments
// (watch it again), or watched and fine. Worked out from the comments (shared/notes.ts) and the render the creator
// last said looks good (`pieces.reviewed_media_id`), so a new render always asks for a new look.

export const REVIEW_STATES = ['watch', 'improve', 'recheck', 'good'] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

export const REVIEW_LABELS: Record<ReviewState, string> = {
  watch: 'To watch',
  improve: 'To improve',
  recheck: 'Check again',
  good: 'Looks good',
};

export type ReviewFacts = {
  /** The newest finished video (null: nothing to watch yet). */
  renderId: string | null;
  /** The render the creator said looks good. */
  reviewedMediaId: string | null;
  open: number;
  /** Comments of any status. */
  comments: number;
  /** It went out (or is going out) already. */
  out?: boolean;
};

/**
 * Open comments always mean "to improve". Otherwise the newest render is fine once the creator said so; one with
 * comments behind it (fixed or closed) wants a second look; one never commented on wants a first. A video that is
 * already out with nothing said about it isn't asked about.
 */
export function reviewState(f: ReviewFacts): ReviewState | null {
  if (!f.renderId) return f.open ? 'improve' : null;
  if (f.open) return 'improve';
  if (f.reviewedMediaId === f.renderId) return 'good';
  if (f.comments) return 'recheck';
  return f.out ? null : 'watch';
}
