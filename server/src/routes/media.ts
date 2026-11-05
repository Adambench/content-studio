import { dirname } from 'node:path';
import { and, desc, eq, isNotNull, isNull, like, or } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ASSET_TYPES } from '../../../shared/types';
import { db, schema } from '../db';
import { emit } from '../lib/events';
import { badRequest, notFound } from '../lib/http';
import { getSetting, setSetting } from '../lib/settings';
import { enqueue } from '../jobs/queue';
import { isAuthenticated } from './auth';
import { deleteMedia, getMedia, mediaPath, readTranscript, saveUpload, thumbPath, whisperInstalled, type UploadedFile } from '../services/media';
import { createPiece, getPiece, getWorkspace } from '../services/pieces';

const uploadQuery = z.object({
  pieceId: z.string().optional(),
  assetType: z.enum(ASSET_TYPES).optional(),
});

/** Save every file in a multipart request; collect text fields along the way. */
export async function readMultipart(req: FastifyRequest, onFile: (file: UploadedFile) => Promise<void>) {
  const fields: Record<string, string> = {};
  for await (const part of req.parts()) {
    if (part.type === 'file') await onFile({ stream: part.file, filename: part.filename, mimetype: part.mimetype });
    else fields[part.fieldname] = String(part.value ?? '');
  }
  return fields;
}

export async function mediaRoutes(app: FastifyInstance) {
  app.post<{ Params: { wid: string } }>('/api/workspaces/:wid/media', async (req) => {
    const ws = getWorkspace(req.params.wid);
    const opts = uploadQuery.parse(req.query);
    if (opts.pieceId && getPiece(opts.pieceId).workspaceId !== ws.id) throw badRequest('That piece belongs to another workspace.');
    const saved: Awaited<ReturnType<typeof saveUpload>>[] = [];
    await readMultipart(req, async (file) => {
      saved.push(await saveUpload(ws.id, file, { pieceId: opts.pieceId ?? null, assetType: opts.assetType ?? null }));
    });
    if (!saved.length) throw badRequest('No files received.');
    return saved;
  });

  // The creator's voice for one video (its script read aloud): kept with the video as a recording, never an idea card.
  app.post<{ Params: { id: string } }>('/api/pieces/:id/recording', async (req) => {
    const piece = getPiece(req.params.id);
    const saved: Awaited<ReturnType<typeof saveUpload>>[] = [];
    await readMultipart(req, async (file) => {
      if (!file.mimetype.startsWith('audio/')) {
        file.stream.resume();
        throw badRequest('Only a voice recording goes here.');
      }
      saved.push(await saveUpload(piece.workspaceId, file, { source: 'capture', pieceId: piece.id }));
    });
    if (!saved.length) throw badRequest('No recording received.');
    return saved[0];
  });

  app.get<{ Params: { wid: string } }>('/api/workspaces/:wid/media', async (req) => {
    const q = z
      .object({ scope: z.enum(['footage', 'assets']).default('footage'), kind: z.enum(['video', 'image', 'audio', 'other']).optional(), q: z.string().optional(), pieceId: z.string().optional() })
      .parse(req.query);
    const term = q.q?.trim() ? `%${q.q.trim()}%` : undefined;
    return db
      .select()
      .from(schema.media)
      .where(
        and(
          eq(schema.media.workspaceId, req.params.wid),
          q.scope === 'assets' ? isNotNull(schema.media.assetType) : isNull(schema.media.assetType),
          q.kind ? eq(schema.media.kind, q.kind) : undefined,
          q.pieceId ? eq(schema.media.pieceId, q.pieceId) : undefined,
          term ? or(like(schema.media.originalName, term), like(schema.media.notes, term), like(schema.media.transcriptText, term)) : undefined,
        ),
      )
      .orderBy(desc(schema.media.createdAt))
      .limit(500)
      .all();
  });

  app.get<{ Params: { id: string } }>('/api/media/:id', async (req) => {
    const row = getMedia(req.params.id);
    const transcript = row.transcriptStatus === 'done' ? await readTranscript(row.id) : null;
    return { ...row, transcript };
  });

  app.get<{ Params: { id: string }; Querystring: { download?: string } }>('/api/media/:id/file', async (req, reply) => {
    const row = getMedia(req.params.id);
    const path = mediaPath(row);
    reply.header('Cache-Control', 'private, max-age=31536000, immutable');
    if (req.query.download) reply.header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(row.originalName)}`);
    return reply.type(row.mime).sendFile(row.fileName, dirname(path));
  });

  app.get<{ Params: { id: string } }>('/api/media/:id/thumb', async (req, reply) => {
    const row = getMedia(req.params.id);
    if (!row.hasThumb) throw notFound('No preview');
    reply.header('Cache-Control', 'private, max-age=31536000, immutable');
    return reply.type('image/jpeg').sendFile(`${row.id}.jpg`, dirname(thumbPath(row.id)));
  });

  app.patch<{ Params: { id: string } }>('/api/media/:id', async (req) => {
    const row = getMedia(req.params.id);
    const body = z
      .object({
        pieceId: z.string().nullable().optional(),
        notes: z.string().max(5000).optional(),
        originalName: z.string().trim().min(1).max(200).optional(),
        assetType: z.enum(ASSET_TYPES).optional(),
      })
      .parse(req.body);
    if (body.pieceId && getPiece(body.pieceId).workspaceId !== row.workspaceId) throw badRequest('That piece belongs to another workspace.');
    if (body.assetType && !row.assetType) throw badRequest('Footage can’t become a brand asset.');
    db.update(schema.media).set(body.pieceId !== undefined ? { ...body, suggestion: null } : body).where(eq(schema.media.id, row.id)).run();
    emit({ type: 'changed', entity: 'media', workspaceId: row.workspaceId, id: row.id });
    for (const id of new Set([row.pieceId, body.pieceId])) if (id) emit({ type: 'changed', entity: 'pieces', workspaceId: row.workspaceId, id });
    return getMedia(row.id);
  });

  app.delete<{ Params: { id: string } }>('/api/media/:id', async (req) => {
    await deleteMedia(req.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/media/:id/transcribe', async (req) => {
    const row = getMedia(req.params.id);
    if (!whisperInstalled()) throw badRequest('Speech-to-text isn’t installed yet — install it in Settings → Transcription.');
    if (row.kind !== 'video' && row.kind !== 'audio') throw badRequest('Only video and audio can be transcribed.');
    db.update(schema.media).set({ transcriptStatus: 'queued' }).where(eq(schema.media.id, row.id)).run();
    enqueue('media.transcribe', { mediaId: row.id }, { maxAttempts: 2 });
    emit({ type: 'changed', entity: 'media', workspaceId: row.workspaceId, id: row.id });
    return { ok: true };
  });

  // The browser's share target (the PWA; the Android app has its own share screen): shared clips go on a new card
  // on the first page I write for, to film-ready; anything else is ignored.
  app.post('/api/share-target', async (req, reply) => {
    if (!isAuthenticated(req)) return reply.redirect('/login?next=shared', 303);
    const ws = db.select().from(schema.workspaces).all().find((w) => !w.hidden && w.kind !== 'clipping');
    if (!ws) return reply.redirect('/', 303);
    const { pieceId } = createPiece(ws.id, { title: `Shared ${new Date().toLocaleDateString()}`, stage: 'film' });
    let saved = 0;
    await readMultipart(req, async (file) => {
      if (!file.mimetype.startsWith('video/') && !file.mimetype.startsWith('audio/')) return void file.stream.resume();
      await saveUpload(ws.id, file, { source: 'share', pieceId });
      saved++;
    });
    if (!saved) {
      db.delete(schema.pieces).where(eq(schema.pieces.id, pieceId)).run();
      return reply.redirect('/', 303);
    }
    emit({ type: 'changed', entity: 'pieces', workspaceId: ws.id, id: pieceId });
    return reply.redirect(`/c/${pieceId}`, 303);
  });
}
