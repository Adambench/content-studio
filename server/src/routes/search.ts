import { and, desc, eq, inArray, isNull, like, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { noteSnippet, noteTitle } from '../../../shared/notebook';
import { normalizeDraft } from '../../../shared/types';
import { db, schema } from '../db';

/** The words around the first match, so a result shows why it matched. */
function snippet(text: string | null | undefined, term: string) {
  if (!text) return '';
  const flat = text.replace(/\s+/g, ' ');
  const at = flat.toLowerCase().indexOf(term.toLowerCase());
  if (at < 0) return '';
  const from = Math.max(0, at - 40);
  return `${from ? '…' : ''}${flat.slice(from, at + term.length + 60).trim()}${at + term.length + 60 < flat.length ? '…' : ''}`;
}

/** One search over every workspace's videos (title, tags, hook, script, notes), footage (name, notes, what's said) and Notes. */
export async function searchRoutes(app: FastifyInstance) {
  app.get('/api/search', async (req) => {
    const { q } = z.object({ q: z.string().trim().min(2).max(100) }).parse(req.query);
    const term = `%${q}%`;

    const branchHits = db
      .select({ pieceId: schema.branches.pieceId, working: schema.branches.working })
      .from(schema.branches)
      .where(like(schema.branches.working, term))
      .limit(40)
      .all();
    const pieces = db
      .select()
      .from(schema.pieces)
      .where(or(like(schema.pieces.title, term), like(schema.pieces.tags, term), branchHits.length ? inArray(schema.pieces.id, branchHits.map((b) => b.pieceId)) : undefined))
      .orderBy(desc(schema.pieces.updatedAt))
      .limit(15)
      .all();
    const thumbs = pieces.length
      ? db
          .select({ id: schema.media.id, pieceId: schema.media.pieceId, source: schema.media.source })
          .from(schema.media)
          .where(and(inArray(schema.media.pieceId, pieces.map((p) => p.id)), eq(schema.media.hasThumb, true), isNull(schema.media.assetType)))
          .orderBy(desc(schema.media.createdAt))
          .all()
      : [];

    const media = db
      .select()
      .from(schema.media)
      .where(and(isNull(schema.media.assetType), or(like(schema.media.originalName, term), like(schema.media.notes, term), like(schema.media.transcriptText, term))))
      .orderBy(desc(schema.media.createdAt))
      .limit(15)
      .all();

    const notes = db
      .select({ id: schema.notebook.id, workspaceId: schema.notebook.workspaceId, body: schema.notebook.body })
      .from(schema.notebook)
      .where(and(isNull(schema.notebook.deletedAt), like(schema.notebook.body, term)))
      .orderBy(desc(schema.notebook.updatedAt))
      .limit(10)
      .all();

    return {
      notes: notes.map((n) => {
        const title = noteTitle(n.body);
        return { id: n.id, workspaceId: n.workspaceId, title, snippet: title.toLowerCase().includes(q.toLowerCase()) ? noteSnippet(n.body, 100) : snippet(n.body, q) };
      }),
      pieces: pieces.map((p) => {
        const own = thumbs.filter((t) => t.pieceId === p.id);
        const hit = branchHits.find((b) => b.pieceId === p.id);
        const d = hit ? normalizeDraft(hit.working) : null;
        return {
          id: p.id,
          workspaceId: p.workspaceId,
          title: p.title,
          stage: p.stage,
          thumbMediaId: (own.find((t) => t.source === 'render') ?? own[0])?.id ?? null,
          snippet: p.title.toLowerCase().includes(q.toLowerCase()) ? '' : d ? snippet(d.hook, q) || snippet(d.script, q) || snippet(d.notes, q) : p.tags.join(', '),
        };
      }),
      media: media.map((m) => ({
        id: m.id,
        workspaceId: m.workspaceId,
        pieceId: m.pieceId,
        originalName: m.originalName,
        kind: m.kind,
        hasThumb: m.hasThumb,
        durationMs: m.durationMs,
        snippet: m.originalName.toLowerCase().includes(q.toLowerCase()) ? '' : snippet(m.notes, q) || snippet(m.transcriptText, q),
      })),
    };
  });
}
