// My comments on a render (pinned to a moment, a stretch or a slide). Each one I leave is a lesson: fixing it records
// the general rule too (rules.ts), so no later video makes the same mistake.

import { z } from 'zod';
import type { Comment, CommentStatus } from '../../../shared/types.ts';
import { all, get, run } from '../db/db.ts';
import { emit, newId, notFound, now } from '../lib/util.ts';
import { getCard } from './board.ts';

type CommentRow = { id: string; card_id: string; render_id: string | null; version_id: string | null; at: number | null; end_at: number | null; slide: number | null; text: string; status: CommentStatus; reply: string | null; rule_id: string | null; created_at: number; resolved_at: number | null };

const toComment = (r: CommentRow): Comment => ({ id: r.id, cardId: r.card_id, renderId: r.render_id, versionId: r.version_id, at: r.at, end: r.end_at, slide: r.slide, text: r.text, status: r.status, reply: r.reply, ruleId: r.rule_id, createdAt: r.created_at, resolvedAt: r.resolved_at });

export const listComments = (cardId: string) => all<CommentRow>('SELECT * FROM comments WHERE card_id = ? ORDER BY created_at', cardId).map(toComment);

export const openComments = (cardId: string) => all<CommentRow>("SELECT * FROM comments WHERE card_id = ? AND status = 'open' ORDER BY COALESCE(at, slide, 0), created_at", cardId).map(toComment);

export function getComment(id: string): Comment {
  const r = get<CommentRow>('SELECT * FROM comments WHERE id = ?', id);
  if (!r) throw notFound('Comment');
  return toComment(r);
}

export const commentInput = z.object({
  renderId: z.string().nullable().optional(),
  versionId: z.string().nullable().optional(),
  at: z.number().min(0).nullable().optional(),
  end: z.number().min(0).nullable().optional(),
  slide: z.number().int().min(0).nullable().optional(),
  text: z.string().trim().min(1).max(5_000),
});

export function addComment(cardId: string, input: unknown): Comment {
  const c = commentInput.parse(input);
  getCard(cardId);
  const id = newId();
  run(
    'INSERT INTO comments (id, card_id, render_id, version_id, at, end_at, slide, text, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id,
    cardId,
    c.renderId ?? null,
    c.versionId ?? null,
    c.at ?? null,
    c.end != null && c.at != null && c.end > c.at ? c.end : null,
    c.slide ?? null,
    c.text,
    'open',
    now(),
  );
  emit('comment', id, cardId);
  emit('card', cardId, cardId);
  return getComment(id);
}

export const commentPatch = z.object({ text: z.string().trim().min(1).max(5_000).optional(), status: z.enum(['open', 'fixed', 'closed']).optional() });

export function updateComment(id: string, input: unknown): Comment {
  const patch = commentPatch.parse(input);
  const cur = getComment(id);
  const status = patch.status ?? cur.status;
  run('UPDATE comments SET text = ?, status = ?, resolved_at = ? WHERE id = ?', patch.text ?? cur.text, status, status === 'open' ? null : (cur.resolvedAt ?? now()), id);
  emit('comment', id, cur.cardId);
  emit('card', cur.cardId, cur.cardId);
  return getComment(id);
}

/** Claude's answer to a comment once it's fixed, with the lesson it recorded. */
export function resolveComment(id: string, reply: string, ruleId: string | null) {
  const cur = getComment(id);
  run("UPDATE comments SET status = 'fixed', reply = ?, rule_id = ?, resolved_at = ? WHERE id = ?", reply, ruleId, now(), id);
  emit('comment', id, cur.cardId);
  emit('card', cur.cardId, cur.cardId);
}

export function deleteComment(id: string) {
  const cur = getComment(id);
  run('DELETE FROM comments WHERE id = ?', id);
  emit('comment', id, cur.cardId);
  emit('card', cur.cardId, cur.cardId);
}
