import type { FastifyInstance } from 'fastify';
import { basename, dirname } from 'node:path';
import { z } from 'zod';
import { deleteReference, getReference, listReferences, ownMeasures, queueReference, redraftLessons, referenceFrame, retryReference } from '../knowledge/references';

/** References on the Knowledge page: videos measured to learn from (server/src/knowledge/references.ts). */
export async function referenceRoutes(app: FastifyInstance) {
  app.get('/api/references', async () => listReferences());

  app.post('/api/references', async (req) => {
    const b = z.object({ url: z.string().trim().min(1).max(2000), workspaceId: z.string().max(64).nullable().default(null) }).parse(req.body);
    return queueReference(b);
  });

  app.get<{ Params: { id: string } }>('/api/references/:id', async (req) => getReference(req.params.id));

  app.post<{ Params: { id: string } }>('/api/references/:id/retry', async (req) => retryReference(req.params.id));

  app.post<{ Params: { id: string } }>('/api/references/:id/redraft', async (req) => redraftLessons(req.params.id));

  app.delete<{ Params: { id: string } }>('/api/references/:id', async (req) => {
    await deleteReference(req.params.id);
    return { ok: true };
  });

  // Its first frame and contact sheet, for <img> (the token may come in the query).
  app.get<{ Params: { id: string; name: string } }>('/api/references/:id/:name', async (req, reply) => {
    const name = /^(first|sheet)\.jpg$/.exec(req.params.name)?.[1] as 'first' | 'sheet' | undefined;
    if (!name) return reply.code(404).send({ error: 'Not found' });
    const file = referenceFrame(req.params.id, name);
    return reply.type('image/jpeg').header('cache-control', 'private, max-age=86400').sendFile(basename(file), dirname(file));
  });

  // The same measures from my own latest edits, to set beside the references.
  app.get<{ Querystring: { workspaceId?: string } }>('/api/references/own', async (req) => ownMeasures(req.query.workspaceId || null));
}
