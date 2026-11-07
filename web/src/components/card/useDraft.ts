import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { normalizeDraft, type DraftContent } from '@shared/types';
import { api, ApiError, errorMessage } from '@/lib/api';
import { draftSaved, keepDraft, outbox, sendOutbox } from '@/lib/offline';
import { keys, queryClient } from '@/lib/queries';
import type { PieceDetail } from '@/lib/types';

/**
 * The card's live draft (one per open card: pass it down as `CardDraft`): edited here at once, saved a moment after
 * the last change, and kept in step with the server. While the computer can't be reached it waits in the outbox
 * (lib/offline.ts) and shows from there.
 */
export function useDraft(piece: PieceDetail) {
  const branch = piece.branches.find((b) => b.id === piece.activeBranchId) ?? piece.branches[0];
  const waiting = () => (branch ? outbox.get()[branch.id]?.content : undefined);
  const [draft, setDraft] = useState<DraftContent>(() => normalizeDraft(waiting() ?? branch?.working));
  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(draft);
  latest.current = draft;

  // Someone else changed it (Claude, the phone) while I wasn't typing: show theirs (unless mine still waits to go).
  const remote = JSON.stringify(branch?.working ?? null);
  useEffect(() => {
    if (!pending.current && branch && !waiting()) setDraft(normalizeDraft(branch.working));
  }, [remote]);

  async function flush() {
    if (!branch || !pending.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const content = latest.current;
    const base = branch.workingUpdatedAt ?? null;
    // Something written offline still waits: this goes the same way, so the computer's changes are kept first.
    if (outbox.get()[branch.id]) {
      keepDraft({ branchId: branch.id, pieceId: piece.id, content, base });
      pending.current = false;
      return void sendOutbox();
    }
    try {
      await api(`/branches/${branch.id}/working`, { method: 'PUT', body: { content } });
      pending.current = false;
      draftSaved(branch.id);
      void queryClient.invalidateQueries({ queryKey: keys.piece(piece.id) });
    } catch (err) {
      // The computer can't be reached: it goes when it's back.
      if (err instanceof ApiError && err.status === 0) {
        keepDraft({ branchId: branch.id, pieceId: piece.id, content, base });
        pending.current = false;
      } else toast.error(`Not saved: ${errorMessage(err)}`);
    }
  }

  // Leaving the card saves what's left.
  useEffect(() => () => void flush(), []);

  function change(next: DraftContent | ((d: DraftContent) => DraftContent)) {
    setDraft((d) => {
      const value = typeof next === 'function' ? next(d) : next;
      latest.current = value;
      return value;
    });
    pending.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 700);
  }

  return { draft, change, flush, ready: !!branch };
}

/** One card's draft, shared by everything on the card that edits it (the document, the post text), so no part saves over another's change. */
export type CardDraft = ReturnType<typeof useDraft>;

/** Rename a card (Enter or leaving the field). */
export async function renameCard(id: string, title: string) {
  const t = title.trim();
  if (!t) return;
  try {
    await api(`/pieces/${id}`, { method: 'PATCH', body: { title: t } });
    void queryClient.invalidateQueries({ queryKey: keys.piece(id) });
    void queryClient.invalidateQueries({ queryKey: keys.boardAll });
  } catch (err) {
    toast.error(errorMessage(err));
  }
}
