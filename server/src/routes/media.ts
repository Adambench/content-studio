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
import { getPiece, getWorkspace } from '../services/pieces';

const uploadQuery = z.object({
  pieceId: z.string().optional(),
  assetType: z.enum(ASSET_TYPES).optional(),
});

/** Save every file in a multipart request; collect text fields along the way. */
async function readMultipart(req: FastifyRequest, onFile: (file: UploadedFile) => Promise<void>) {
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
    db.update(schema.media).set(body).where(eq(schema.media.id, row.id)).run();
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

  // Quick idea capture from the app: a voice memo (multipart) or a typed note (JSON).
  app.post<{ Params: { wid: string } }>('/api/workspaces/:wid/capture', async (req) => {
    const ws = getWorkspace(req.params.wid);
    if (req.isMultipart()) {
      let saved = 0;
      const fields = await readMultipart(req, async (file) => {
        await saveUpload(ws.id, file, { source: 'capture' });
        saved++;
      });
      if (!saved && fields.text?.trim()) enqueue('capture.structure', { workspaceId: ws.id, text: fields.text.trim() });
      else if (!saved) throw badRequest('Nothing to capture.');
    } else {
      const { text } = z.object({ text: z.string().trim().min(1).max(20000) }).parse(req.body);
      enqueue('capture.structure', { workspaceId: ws.id, text });
    }
    return { ok: true };
  });

  // Android share sheet → Content Studio (Web Share Target). Audio and text become ideas; video and images go to the library.
  app.post('/api/share-target', async (req, reply) => {
    if (!isAuthenticated(req)) return reply.redirect('/login?next=shared', 303);
    const workspaces = db.select().from(schema.workspaces).all();
    const ws = workspaces.find((w) => w.id === getSetting('lastWorkspaceId')) ?? workspaces[0];
    if (!ws) return reply.redirect('/', 303);
    setSetting('lastWorkspaceId', ws.id);

    let library = 0;
    let ideas = 0;
    const fields = await readMultipart(req, async (file) => {
      const isAudio = file.mimetype.startsWith('audio/');
      await saveUpload(ws.id, file, { source: isAudio ? 'capture' : 'share' });
      if (isAudio) ideas++;
      else library++;
    });
    const text = [fields.title, fields.text, fields.url].map((s) => s?.trim()).filter(Boolean).join('\n');
    if (text && !library && !ideas) {
      enqueue('capture.structure', { workspaceId: ws.id, text });
      ideas++;
    }
    return reply.redirect(library ? `/w/${ws.id}/library?shared=${library}` : `/w/${ws.id}/board?captured=${ideas}`, 303);
  });
}
