import { MessageSquareText, RotateCcw, ThumbsUp, TvMinimalPlay, type LucideIcon } from 'lucide-react';
import type { ReviewState } from '@shared/review';

/** How each review state (shared/review.ts) looks on a board card, the board's filter and under the player. */
export const REVIEW_LOOK: Record<ReviewState, { icon: LucideIcon; tone: string; chip: string }> = {
  watch: { icon: TvMinimalPlay, tone: 'text-sky-400', chip: 'bg-sky-500/15 text-sky-300' },
  improve: { icon: MessageSquareText, tone: 'text-amber-400', chip: 'bg-amber-500/15 text-amber-300' },
  recheck: { icon: RotateCcw, tone: 'text-brand', chip: 'bg-brand/15 text-brand' },
  good: { icon: ThumbsUp, tone: 'text-emerald-400', chip: 'bg-emerald-500/15 text-emerald-300' },
};
