import { mkdir, rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { COMPUTE_TOOLS } from '../../../shared/compute';
import { forgetWorker, finish, inputStream, listWorkers, outputPath, aliveWhileFlowing, poll, progress } from '../compute/workers';
import { runToolOn } from '../compute/run';
import { config } from '../config';
import { db, newId, schema } from '../db';
import { requireBinary } from '../lib/bin';
import { emit } from '../lib/events';
import { badRequest, HttpError } from '../lib/http';
import { requestSession } from './auth';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

/** The worker the request came from (it signed in with its device token). */
function worker(req: Parameters<typeof requestSession>[0]) {
  const s = requestSession(req);
  if (!s || s.kind !== 'worker') throw new HttpError(403, 'Only a compute worker calls this.');
  return s;
}

/** Compute workers (shared/compute.ts): what Settings → Compute shows, and what the workers call. */
export async function computeRoutes(app: FastifyInstance) {
  // Output files arrive as raw bytes.
  app.addContentTypeParser('application/octet-stream', (_req, payload, done) => done(null, payload));

  // ---------- Settings → Compute ----------

  app.get('/api/compute/workers', async () => listWorkers());

  app.delete<{ Params: { id: string } }>('/api/compute/workers/:id', async (req) => {
    db.delete(schema.sessions).where(and(eq(schema.sessions.id, req.params.id), eq(schema.sessions.kind, 'worker'))).run();
    forgetWorker(req.params.id);
    emit({ type: 'changed', entity: 'compute' });
    return { ok: true };
  });

  app.patch<{ Params: { id: string } }>('/api/compute/workers/:id', async (req) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body);
    db.update(schema.sessions).set({ name }).where(and(eq(schema.sessions.id, req.params.id), eq(schema.sessions.kind, 'worker'))).run();
    emit({ type: 'changed', entity: 'compute' });
    return { ok: true };
  });

  /** A small matte job through the normal path: it goes to a worker when one is online, and says where it ran and how long it took. */
  app.post('/api/compute/test', async () => {
    const dir = join(config.tmpDir, `compute-test-${newId()}`);
    await mkdir(dir, { recursive: true });
    try {
      const video = join(dir, 'in.mp4');
      await execFile(requireBinary('ffmpeg'), ['-hide_banner', '-nostdin', '-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=540x960:rate=15:duration=2', '-pix_fmt', 'yuv420p', video]);
      const started = Date.now();
      const { on } = await runToolOn('matte', { video, mask: join(dir, 'mask.mp4') }, {}, { timeoutMs: 10 * 60_000 }).catch((err: Error) => {
        throw badRequest(`The test failed: ${err.message.slice(0, 200)}. Is the clip tools install done (Settings → Clip tools)?`);
      });
      return { on, seconds: Math.round((Date.now() - started) / 100) / 10 };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  // ---------- what a worker calls ----------

  app.post('/api/worker/poll', async (req, reply) => {
    const session = worker(req);
    const body = z
      .object({
        name: z.string().max(80).default('Worker'),
        gpu: z.string().max(120).default(''),
        tools: z.array(z.enum(COMPUTE_TOOLS)).max(10).default([]),
        busy: z.boolean().default(false),
        speed: z.object({ matteMsPerFrame: z.number().nullable(), cuda: z.boolean() }).optional(),
      })
      .parse(req.body);
    const signal = { aborted: false };
    // The response closing before it was sent means the worker went away (the request's own close fires once its body is read).
    reply.raw.on('close', () => {
      if (!reply.raw.writableFinished) signal.aborted = true;
    });
    const task = await poll(session.id, session.name ?? body.name, body, signal);
    if (signal.aborted) return reply;
    return { task };
  });

  app.get<{ Params: { id: string; name: string } }>('/api/worker/tasks/:id/inputs/:name', async (req, reply) => {
    const stream = inputStream(worker(req).id, req.params.id, req.params.name);
    if (!stream) throw new HttpError(404, 'No such input.');
    return reply.type('application/octet-stream').send(stream);
  });

  app.put<{ Params: { id: string; name: string } }>('/api/worker/tasks/:id/outputs/:name', async (req) => {
    const id = worker(req).id;
    const path = outputPath(id, req.params.id, req.params.name);
    if (!path) throw new HttpError(404, 'No such output.');
    // A big upload can take longer than the lease.
    await pipeline(req.body as NodeJS.ReadableStream, aliveWhileFlowing(id, req.params.id), createWriteStream(path));
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/worker/tasks/:id/progress', async (req) => {
    const { text } = z.object({ text: z.string().max(500) }).parse(req.body);
    return { ok: progress(worker(req).id, req.params.id, text) };
  });

  app.post<{ Params: { id: string } }>('/api/worker/tasks/:id/done', async (req) => {
    const body = z.object({ ok: z.boolean(), stdout: z.string().max(5_000_000).optional(), message: z.string().max(2000).optional() }).parse(req.body);
    return { ok: await finish(worker(req).id, req.params.id, body) };
  });
}
