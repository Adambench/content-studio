import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { normalizeDraft, type DraftContent } from '@shared/types';
import { api, errorMessage } from '@/lib/api';
import { keys, queryClient } from '@/lib/queries';
import type { PieceDetail } from '@/lib/types';

/** The card's live draft (one per open card: pass it down as `CardDraft`): edited here at once, saved a moment after the last change, and kept in step with the server. */
export function useDraft(piece: PieceDetail) {
  const branch = piece.branches.find((b) => b.id === piece.activeBranchId) ?? piece.branches[0];
  const [draft, setDraft] = useState<DraftContent>(() => normalizeDraft(branch?.working));
  const pending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(draft);
  latest.current = draft;

  // Someone else changed it (Claude, the phone) while I wasn't typing: show theirs.
  const remote = JSON.stringify(branch?.working ?? null);
  useEffect(() => {
    if (!pending.current && branch) setDraft(normalizeDraft(branch.working));
  }, [remote]);

  async function flush() {
    if (!branch || !pending.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    try {
      await api(`/branches/${branch.id}/working`, { method: 'PUT', body: { content: latest.current } });
      pending.current = false;
      void queryClient.invalidateQueries({ queryKey: keys.piece(piece.id) });
    } catch (err) {
      toast.error(`Not saved: ${errorMessage(err)}`);
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
