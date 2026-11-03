import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { normalizeDraft } from '../../../shared/types';
import { pieceViews } from '../analytics/report';
import { db, now, schema } from '../db';
import { emit } from '../lib/events';
import { badRequest, notFound } from '../lib/http';
import { isLoose, queueInboxSort } from '../services/inbox';
import { deleteMedia } from '../services/media';
import { createBranch, createPiece, getBranch, getPiece, getPieceDetail, getWorkspace, restoreVersion, saveVersion, updateWorking } from '../services/pieces';
import { chooseDirection, requestPitch } from '../studio/directions';
import { reviewStates } from '../studio/notes';
import { ideaForPiece, seriesForPieces } from '../ideas/ideas';

const draftSchema = z.object({
  hook: z.string(),
  script: z.string(),
  notes: z.string(),
  platforms: z.object({
    tiktok: z.object({ caption: z.string(), hashtags: z.string() }),
    instagram: z.object({ caption: z.string(), hashtags: z.string() }),
    youtube: z.object({ title: z.string(), description: z.string(), tags: z.string() }),
    x: z.object({ text: z.string() }),
  }),
});

/** What the card shows about posting: the next time it goes out, how many went out, and whether one needs you. */
function postSummary(posts: { status: string; at: number }[]) {
  const upcoming = posts.filter((p) => p.status === 'scheduled' || p.status === 'publishing').map((p) => p.at);
  return {
    nextPostAt: upcoming.length ? Math.min(...upcoming) : null,
    postedCount: posts.filter((p) => p.status === 'published').length,
    postAttention: posts.some((p) => p.status === 'failed' || p.status === 'missed'),
  };
}

export async function pieceRoutes(app: FastifyInstance) {
  /** Board cards: a light summary of every piece in a workspace. */
  app.get<{ Params: { wid: string } }>('/api/workspaces/:wid/pieces', async (req) => {
    const ws = getWorkspace(req.params.wid);
    const pieces = db.select().from(schema.pieces).where(eq(schema.pieces.workspaceId, ws.id)).orderBy(asc(schema.pieces.position)).all();
    if (!pieces.length) return [];
    const ids = pieces.map((p) => p.id);
    const branches = db
      .select({ id: schema.branches.id, pieceId: schema.branches.pieceId, working: schema.branches.working, head: schema.branches.headVersionId })
      .from(schema.branches)
      .where(inArray(schema.branches.pieceId, ids))
      .all();
    const heads = db
      .select({ id: schema.versions.id, author: schema.versions.author })
      .from(schema.versions)
      .where(inArray(schema.versions.id, branches.map((b) => b.head).filter((h): h is string => !!h)))
      .all();
    const media = db
      .select({ id: schema.media.id, pieceId: schema.media.pieceId, hasThumb: schema.media.hasThumb, kind: schema.media.kind, source: schema.media.source })
      .from(schema.media)
      .where(and(inArray(schema.media.pieceId, ids), isNull(schema.media.assetType)))
      .orderBy(asc(schema.media.createdAt))
      .all();
    const posts = db
      .select({ pieceId: schema.posts.pieceId, status: schema.posts.status, at: schema.posts.scheduledAt })
      .from(schema.posts)
      .where(inArray(schema.posts.pieceId, ids))
      .all();
    const review = reviewStates(pieces);
    const authorOf = new Map(heads.map((h) => [h.id, h.author]));
    const views = pieceViews(ids);
    const series = seriesForPieces(ids);
    return pieces.map((p) => {
      const own = branches.filter((b) => b.pieceId === p.id);
      const active = own.find((b) => b.id === p.activeBranchId) ?? own[0];
      const ownMedia = media.filter((m) => m.pieceId === p.id);
      return {
        id: p.id,
        title: p.title,
        stage: p.stage,
        position: p.position,
        tags: p.tags,
        updatedAt: p.updatedAt,
        hook: active ? normalizeDraft(active.working).hook : '',
        alternatives: own.length,
        mediaCount: ownMedia.length,
        // The newest finished video, else the first footage.
        thumbMediaId: (ownMedia.findLast((m) => m.hasThumb && m.source === 'render') ?? ownMedia.find((m) => m.hasThumb))?.id ?? null,
        rendered: ownMedia.some((m) => m.source === 'render'),
        lastAuthor: active?.head ? (authorOf.get(active.head) ?? null) : null,
        ...postSummary(posts.filter((x) => x.pieceId === p.id)),
        // Whether I've watched the newest render: comments to fix, changed since, fine (shared/review.ts).
        review: review.get(p.id)?.state ?? null,
        openComments: review.get(p.id)?.open ?? 0,
        // Latest views across its posts, once any are in.
        views: views.get(p.id) ?? null,
        // The Ideas card it came from, and the series it's an episode of.
        ideaId: series.get(p.id)?.ideaId ?? null,
        series: series.get(p.id)?.seriesId ? { id: series.get(p.id)!.seriesId, name: series.get(p.id)!.name, episode: series.get(p.id)!.episode } : null,
      };
    });
  });

  app.post<{ Params: { wid: string } }>('/api/workspaces/:wid/pieces', async (req) => {
    const body = z.object({ title: z.string().trim().min(1).max(200), stage: z.string().optional() }).parse(req.body);
    const { pieceId } = createPiece(req.params.wid, body);
    return getPieceDetail(pieceId);
  });

  app.get<{ Params: { id: string } }>('/api/pieces/:id', async (req) => ({ ...getPieceDetail(req.params.id), idea: ideaForPiece(req.params.id) }));

  app.patch<{ Params: { id: string } }>('/api/pieces/:id', async (req) => {
    const piece = getPiece(req.params.id);
    const body = z
      .object({
        title: z.string().trim().min(1).max(200).optional(),
        stage: z.string().optional(),
        position: z.number().optional(),
        tags: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
        activeBranchId: z.string().optional(),
      })
      .parse(req.body);
    if (body.stage && !getWorkspace(piece.workspaceId).stages.some((s) => s.id === body.stage)) throw badRequest('Unknown stage.');
    if (body.activeBranchId && getBranch(body.activeBranchId).pieceId !== piece.id) throw badRequest('That alternative belongs to another piece.');
    db.update(schema.pieces).set({ ...body, updatedAt: now() }).where(eq(schema.pieces.id, piece.id)).run();
    emit({ type: 'changed', entity: 'pieces', workspaceId: piece.workspaceId, id: piece.id });
    return { ok: true };
  });

  // Creative directions (personal and business pages): pitch (again, with what to change), pick one.
  app.post<{ Params: { id: string } }>('/api/pieces/:id/directions', async (req) => {
    getPiece(req.params.id);
    const body = z.object({ request: z.string().trim().max(600).optional() }).parse(req.body ?? {});
    try {
      requestPitch(req.params.id, body.request);
    } catch (err) {
      throw badRequest((err as Error).message);
    }
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/pieces/:id/directions/choose', async (req) => {
    getPiece(req.params.id);
    const body = z.object({ optionId: z.string() }).parse(req.body);
    try {
      return { chosen: chooseDirection(req.params.id, body.optionId) };
    } catch (err) {
      throw badRequest((err as Error).message);
    }
  });

  app.delete<{ Params: { id: string } }>('/api/pieces/:id', async (req) => {
    const piece = getPiece(req.params.id);
    // A video is a package: by default its files go with it; `files=keep` sends them to the Inbox instead.
    const { files } = z.object({ files: z.enum(['delete', 'keep']).default('delete') }).parse(req.query);
    const own = db.select().from(schema.media).where(and(eq(schema.media.pieceId, piece.id), isNull(schema.media.assetType))).all();
    // Kept files go to the Inbox; what was made for this video (renders, cuts, voices) can't live anywhere else.
    const kept = files === 'keep' ? own.filter((m) => isLoose({ ...m, pieceId: null })) : [];
    for (const m of own) if (!kept.includes(m)) await deleteMedia(m.id);
    db.delete(schema.pieces).where(eq(schema.pieces.id, piece.id)).run();
    if (kept.length) queueInboxSort(piece.workspaceId);
    emit({ type: 'changed', entity: 'pieces', workspaceId: piece.workspaceId, id: piece.id });
    emit({ type: 'changed', entity: 'media', workspaceId: piece.workspaceId });
    return { ok: true };
  });

  // Autosave of the live draft. Returns the server timestamp so the editor can spot newer remote edits.
  app.put<{ Params: { id: string } }>('/api/branches/:id/working', async (req) => {
    const { content } = z.object({ content: draftSchema }).parse(req.body);
    updateWorking(req.params.id, content, 'you');
    return { workingUpdatedAt: getBranch(req.params.id).workingUpdatedAt };
  });

  app.post<{ Params: { id: string } }>('/api/branches/:id/versions', async (req) => {
    const body = z.object({ message: z.string().max(200).optional(), content: draftSchema.optional() }).parse(req.body ?? {});
    const { version, unchanged } = saveVersion(req.params.id, { author: 'you', message: body.message, content: body.content });
    return { versionId: version.id, number: version.number, unchanged };
  });

  app.patch<{ Params: { id: string } }>('/api/branches/:id', async (req) => {
    const branch = getBranch(req.params.id);
    const { name } = z.object({ name: z.string().trim().min(1).max(60) }).parse(req.body);
    db.update(schema.branches).set({ name }).where(eq(schema.branches.id, branch.id)).run();
    const piece = getPiece(branch.pieceId);
    emit({ type: 'changed', entity: 'pieces', workspaceId: piece.workspaceId, id: piece.id });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/branches/:id', async (req) => {
    const branch = getBranch(req.params.id);
    const piece = getPiece(branch.pieceId);
    const siblings = db.select({ id: schema.branches.id }).from(schema.branches).where(eq(schema.branches.pieceId, piece.id)).all();
    if (siblings.length <= 1) throw badRequest('A piece needs at least one alternative.');
    db.transaction((tx) => {
      tx.delete(schema.branches).where(eq(schema.branches.id, branch.id)).run();
      if (piece.activeBranchId === branch.id) {
        tx.update(schema.pieces).set({ activeBranchId: siblings.find((s) => s.id !== branch.id)!.id }).where(eq(schema.pieces.id, piece.id)).run();
      }
    });
    emit({ type: 'changed', entity: 'pieces', workspaceId: piece.workspaceId, id: piece.id });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/pieces/:id/branches', async (req) => {
    const body = z
      .object({ name: z.string().trim().min(1).max(60), fromBranchId: z.string().optional(), fromVersionId: z.string().optional() })
      .parse(req.body);
    const { branchId } = createBranch(req.params.id, { ...body, author: 'you' });
    return { branchId };
  });

  app.get<{ Params: { id: string } }>('/api/versions/:id', async (req) => {
    const v = db.select().from(schema.versions).where(eq(schema.versions.id, req.params.id)).get();
    if (!v) throw notFound('Version not found');
    return { ...v, content: normalizeDraft(v.content) };
  });

  app.post<{ Params: { id: string } }>('/api/versions/:id/restore', async (req) => {
    const { version } = restoreVersion(req.params.id);
    return { versionId: version.id, number: version.number };
  });

  app.get<{ Params: { wid: string } }>('/api/workspaces/:wid/tags', async (req) => {
    const rows = db
      .select({ tag: sql<string>`json_each.value` })
      .from(sql`${schema.pieces}, json_each(${schema.pieces.tags})`)
      .where(eq(schema.pieces.workspaceId, req.params.wid))
      .groupBy(sql`json_each.value`)
      .all();
    return rows.map((r) => r.tag);
  });
}
