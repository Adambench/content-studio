import type { FastifyInstance } from 'fastify';
import { basename, dirname } from 'node:path';
import { z } from 'zod';
import { deleteReference, getReference, getStyle, listReferences, markReference, ownMeasures, queueReference, referenceFrame, retryReference, saveStyle } from '../knowledge/references';

/** References on the Knowledge page: videos that moved me, read for their ingredients; a page's style from my marks. */
export async function referenceRoutes(app: FastifyInstance) {
  app.get('/api/references', async () => listReferences());

  app.post('/api/references', async (req) => {
    const b = z.object({ url: z.string().trim().min(1).max(2000), workspaceId: z.string().max(64).nullable().default(null) }).parse(req.body);
    return queueReference(b);
  });

  app.get<{ Params: { id: string } }>('/api/references/:id', async (req) => getReference(req.params.id));

  app.post<{ Params: { id: string } }>('/api/references/:id/retry', async (req) => retryReference(req.params.id));


  // My marks: what moved me, each ingredient wanted or not, the page it's for.
  app.patch<{ Params: { id: string } }>('/api/references/:id', async (req) => {
    const b = z
      .object({
        note: z.string().max(2000).optional(),
        workspaceId: z.string().max(64).nullable().optional(),
        ingredients: z.array(z.object({ id: z.string().max(32), mark: z.enum(['want', 'skip']).nullable().optional(), note: z.string().max(500).optional() })).max(20).optional(),
      })
      .parse(req.body);
    return markReference(req.params.id, b);
  });

  // A page's style, written from its references and my marks.
  app.get<{ Params: { workspaceId: string } }>('/api/styles/:workspaceId', async (req) => getStyle(req.params.workspaceId));
  app.put<{ Params: { workspaceId: string } }>('/api/styles/:workspaceId', async (req) => saveStyle(req.params.workspaceId, z.object({ body: z.string().max(8000) }).parse(req.body).body));

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
