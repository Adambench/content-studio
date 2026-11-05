import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat, truncate } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { and, eq, isNull, lt } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ASSET_TYPES } from '../../../shared/types';
import { config } from '../config';
import { db, newId, now, schema } from '../db';
import { badRequest, HttpError, notFound } from '../lib/http';
import { adoptFile } from '../services/media';
import { getPiece, getWorkspace } from '../services/pieces';

/*
 * Resumable uploads for the Android app, which sends big videos from a background job that may be stopped and
 * restarted at any point (network drops, the phone sleeping, the app being closed):
 *   POST   /api/uploads                 → { id, offset: 0 }
 *   GET    /api/uploads/:id             → { offset, size, mediaId }   (where to carry on)
 *   PATCH  /api/uploads/:id  Upload-Offset: n, body = the next bytes  → { offset, mediaId }
 * The last chunk turns it into a library file. Unfinished uploads are dropped after a week.
 */

const dir = join(config.tmpDir, 'uploads');
const partPath = (id: string) => join(dir, id);
const MAX_SIZE = 8 * 1024 ** 3;
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

// One request at a time per upload: a retry that overtakes a stalled request must not interleave with it.
const busy = new Set<string>();

type UploadRow = typeof schema.uploads.$inferSelect;

function getUpload(id: string) {
  const row = db.select().from(schema.uploads).where(eq(schema.uploads.id, id)).get();
  if (!row) throw notFound('That upload has expired. Start it again.');
  return row;
}

const received = async (row: UploadRow) => (row.mediaId ? row.size : await stat(partPath(row.id)).then((s) => s.size, () => 0));

async function cleanUp() {
  const old = db.select().from(schema.uploads).where(lt(schema.uploads.updatedAt, now() - KEEP_MS)).all();
  for (const row of old) {
    if (busy.has(row.id)) continue;
    await rm(partPath(row.id), { force: true });
    db.delete(schema.uploads).where(eq(schema.uploads.id, row.id)).run();
  }
}

export async function uploadRoutes(app: FastifyInstance) {
  await mkdir(dir, { recursive: true });
  await cleanUp();
  setInterval(() => void cleanUp().catch(() => {}), 6 * 60 * 60 * 1000).unref();

  // Chunks arrive as a raw stream (not buffered, so no body limit): the handler writes them straight to disk.
  app.addContentTypeParser('application/offset+octet-stream', (_req, payload, done) => done(null, payload));

  app.post('/api/uploads', async (req) => {
    const body = z
      .object({
        workspaceId: z.string(),
        pieceId: z.string().nullish(),
        assetType: z.enum(ASSET_TYPES).nullish(),
        source: z.enum(['upload', 'capture', 'share', 'idea']).default('upload'),
        // A picture shared to the Saved pile: the card it joins (the phone picks the id, so a note can join it too).
        ideaId: z.string().regex(/^[0-9a-f-]{36}$/i).nullish(),
        name: z.string().trim().min(1).max(255),
        mime: z.string().max(200).default('application/octet-stream'),
        size: z.number().int().min(1).max(MAX_SIZE, 'Files can be up to 8 GB.'),
      })
      .parse(req.body);
    const ws = getWorkspace(body.workspaceId);
    if (body.pieceId && getPiece(body.pieceId).workspaceId !== ws.id) throw badRequest('That piece belongs to another workspace.');
    const id = newId();
    db.insert(schema.uploads)
      .values({ id, workspaceId: ws.id, pieceId: body.pieceId ?? null, assetType: body.assetType ?? null, source: body.source, ideaId: body.ideaId ?? null, name: body.name, mime: body.mime, size: body.size })
      .run();
    return { id, offset: 0, size: body.size, mediaId: null };
  });

  app.get<{ Params: { id: string } }>('/api/uploads/:id', async (req) => {
    const row = getUpload(req.params.id);
    return { id: row.id, offset: await received(row), size: row.size, mediaId: row.mediaId };
  });

  app.patch<{ Params: { id: string } }>('/api/uploads/:id', async (req, reply) => {
    const body = req.body as Readable | undefined;
    // Read (and drop) a body we won't use before answering, so the client always gets the answer.
    const drain = () =>
      new Promise<void>((resolve) => {
        if (!body || body.readableEnded) return resolve();
        body.on('end', resolve).on('close', resolve).on('error', () => resolve());
        body.resume();
      });
    const row = getUpload(req.params.id);
    if (!body || !req.headers['content-type']?.startsWith('application/offset+octet-stream')) throw badRequest('Send the bytes as application/offset+octet-stream.');
    if (row.mediaId) {
      await drain();
      return { offset: row.size, mediaId: row.mediaId };
    }
    if (busy.has(row.id)) {
      await drain();
      throw new HttpError(409, 'This upload is already receiving data.');
    }
    busy.add(row.id);
    try {
      const offset = await received(row);
      const claimed = Number(req.headers['upload-offset']);
      if (claimed !== offset) {
        await drain();
        return reply.code(409).send({ error: 'Wrong offset.', offset, size: row.size, mediaId: null });
      }
      const room = row.size - offset;
      if (Number(req.headers['content-length']) > room) {
        await drain();
        throw badRequest('More bytes than the upload’s size.');
      }
      let count = 0;
      let tooLong = false;
      body.on('data', (chunk: Buffer) => {
        count += chunk.length;
        if (count > room && !tooLong) {
          tooLong = true;
          body.destroy();
        }
      });
      // A dropped connection leaves what arrived so far on disk; the next request carries on from there.
      await pipeline(body, createWriteStream(partPath(row.id), { flags: 'a' })).catch(() => {});
      if (tooLong) {
        await truncate(partPath(row.id), offset);
        throw badRequest('More bytes than the upload’s size.');
      }
      const have = await received(row);
      db.update(schema.uploads).set({ updatedAt: now() }).where(eq(schema.uploads.id, row.id)).run();
      if (have < row.size) return { offset: have, mediaId: null };

      const media = await adoptFile(row.workspaceId, partPath(row.id), row.name, row.mime, { pieceId: row.pieceId, assetType: row.assetType, source: row.source });
      db.update(schema.uploads).set({ mediaId: media.id, updatedAt: now() }).where(and(eq(schema.uploads.id, row.id), isNull(schema.uploads.mediaId))).run();
      return { offset: row.size, mediaId: media.id };
    } finally {
      busy.delete(row.id);
    }
  });

  app.delete<{ Params: { id: string } }>('/api/uploads/:id', async (req) => {
    const row = getUpload(req.params.id);
    if (busy.has(row.id)) throw new HttpError(409, 'This upload is receiving data.');
    if (!row.mediaId) await rm(partPath(row.id), { force: true });
    db.delete(schema.uploads).where(eq(schema.uploads.id, row.id)).run();
    return { ok: true };
  });
}
