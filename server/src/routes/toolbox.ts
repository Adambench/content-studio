import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { setFindStatus, startScout, toolbox } from '../toolbox/scout';

/** The Toolbox page: what's installed and used, and the weekly scout's finds (server/src/toolbox/). */
export async function toolboxRoutes(app: FastifyInstance) {
  app.get('/api/toolbox', async () => toolbox());

  app.post('/api/toolbox/scout', async () => {
    startScout();
    return { ok: true };
  });

  // Wanting a find only marks it: installing stays my click, outside the app.
  app.patch<{ Params: { id: string } }>('/api/toolbox/finds/:id', async (req) => {
    const { status } = z.object({ status: z.enum(['new', 'wanted', 'dismissed']) }).parse(req.body);
    setFindStatus(req.params.id, status);
    return { ok: true };
  });
}
