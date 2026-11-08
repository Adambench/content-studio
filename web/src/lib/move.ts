// Moving a card to another column (the board's drag, the card page's column), the server's way (moveCard,
// server/src/clipping/review.ts): onto Scheduled approves and queues it, off Scheduled cancels its unsent posts.
import { toast } from 'sonner';
import { COLUMN_LABELS, COLUMN_STAGE, columnOf, isWritingColumn, type BoardColumn, type BoardData } from '@shared/board';
import { api, errorMessage } from './api';
import { postWhen } from './format';
import { keys, queryClient } from './queries';

type Moved = { from: string; scheduled: { at: number }[]; note: string | null; cancelled: number };

function refresh(id: string) {
  void queryClient.invalidateQueries({ queryKey: keys.boardAll });
  void queryClient.invalidateQueries({ queryKey: keys.piece(id) });
  void queryClient.invalidateQueries({ queryKey: keys.piecePosts(id) });
}

/** What the move did, in a few words. */
function said(res: Moved, column: BoardColumn) {
  const first = res.scheduled.map((s) => s.at).sort((a, b) => a - b)[0];
  if (first) return `Scheduled ${postWhen(first)}`;
  if (res.note) return res.note;
  const cancelled = res.cancelled ? (res.cancelled === 1 ? ', its post cancelled' : `, ${res.cancelled} posts cancelled`) : '';
  return `${column === 'posted' ? 'Marked posted' : `Moved to ${COLUMN_LABELS[column]}`}${cancelled}`;
}

/**
 * Put a card in another column: right away on screen, then on the server. Between the writing columns it just moves;
 * a move that touches the videos' columns says what it did, with Undo (back where it was, the same way).
 */
export async function moveCard(card: { id: string; column: BoardColumn }, column: BoardColumn) {
  const was = card.column;
  if (was === column) return;
  queryClient.setQueryData<BoardData>(keys.boardAll, (d) => d && { ...d, items: d.items.map((i) => (i.id === card.id ? { ...i, column, stage: COLUMN_STAGE[column] } : i)) });
  try {
    const res = await api<Moved>(`/pieces/${card.id}/move`, { method: 'POST', body: { stage: COLUMN_STAGE[column] } });
    if (isWritingColumn(was) && isWritingColumn(column)) return;
    toast(said(res, column), {
      duration: 10_000,
      action: {
        label: 'Undo',
        onClick: () =>
          api<Moved>(`/pieces/${card.id}/move`, { method: 'POST', body: { stage: res.from } }).then(
            (back) => {
              const to = columnOf(res.from);
              if (to === 'scheduled') toast(said(back, to));
              refresh(card.id);
            },
            (err) => toast.error(errorMessage(err)),
          ),
      },
    });
  } catch (err) {
    toast.error(errorMessage(err));
  } finally {
    refresh(card.id);
  }
}
