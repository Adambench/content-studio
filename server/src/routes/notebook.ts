import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { NOTEBOOK_MAX } from '../../../shared/notebook';
import { deleteNote, listNotebook, restoreNote, saveNote } from '../ideas/notebook';
import { getWorkspace } from '../services/pieces';

const uuid = z.string().regex(/^[0-9a-f-]{36}$/i);

/** Notes: a page's free writing (server/src/ideas/notebook.ts). */
export async function notebookRoutes(app: FastifyInstance) {
  app.get<{ Params: { wid: string } }>('/api/workspaces/:wid/notebook', async (req) => listNotebook(getWorkspace(req.params.wid).id));

  // The whole note as it is now, made the first time (the app picks the id).
  app.put<{ Params: { wid: string; id: string } }>('/api/workspaces/:wid/notebook/:id', async (req) => {
    const id = uuid.parse(req.params.id);
    const { body } = z.object({ body: z.string().max(NOTEBOOK_MAX) }).parse(req.body);
    return saveNote(getWorkspace(req.params.wid).id, id, body);
  });

  app.delete<{ Params: { id: string } }>('/api/notebook/:id', async (req) => {
    deleteNote(req.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/notebook/:id/restore', async (req) => restoreNote(req.params.id));
}
