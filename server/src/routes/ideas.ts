import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ASSISTS } from '../../../shared/ideas';
import { db, schema } from '../db';
import { eq } from 'drizzle-orm';
import { badRequest } from '../lib/http';
import { requestAssist, setAssist } from '../ideas/assist';
import { boardIdeaCount, createIdea, deleteIdea, moveBoardIdeas, getIdea, ideaDetail, listIdeas, lockIn, markSeen, moveToPage, restoreIdea, saveShared, savedPile, toNode, updateIdea } from '../ideas/ideas';
import { queueAnalysis } from '../research/analyse';
import { getItem } from '../research/research';
import { saveUpload } from '../services/media';
import { getWorkspace } from '../services/pieces';
import { readMultipart } from './media';

const uuid = z.string().regex(/^[0-9a-f-]{36}$/i);
const label = z.string().trim().min(1).max(40);

/** Ideas: a page's brainstorm canvas (server/src/ideas/). */
export async function ideaRoutes(app: FastifyInstance) {
  app.get<{ Params: { wid: string } }>('/api/workspaces/:wid/ideas', async (req) => listIdeas(getWorkspace(req.params.wid).id));

  // A new card. The app picks the id, so it can show the card (and its keyboard focus) before the answer comes.
  app.post<{ Params: { wid: string } }>('/api/workspaces/:wid/ideas', async (req) => {
    const ws = getWorkspace(req.params.wid);
    const body = z
      .object({
        id: uuid.optional(),
        parentId: z.string().nullish(),
        after: z.string().nullish(),
        kind: z.enum(['idea', 'series']).optional(),
        title: z.string().max(2000).optional(),
        body: z.string().max(50_000).optional(),
        script: z.string().max(50_000).optional(),
        labels: z.array(label).max(12).optional(),
        url: z.string().trim().max(2000).nullish(),
        by: z.enum(['you', 'claude']).optional(),
      })
      .parse(req.body);
    return toNode(createIdea(ws.id, body));
  });

  // Several sub-ideas at once (Claude's suggestions, "Add all").
  app.post<{ Params: { id: string } }>('/api/ideas/:id/children', async (req) => {
    const parent = getIdea(req.params.id);
    const { items, by } = z
      .object({ items: z.array(z.object({ title: z.string().max(300), body: z.string().max(5000).default('') })).min(1).max(20), by: z.enum(['you', 'claude']).default('you') })
      .parse(req.body);
    return items.map((i) => toNode(createIdea(parent.workspaceId, { parentId: parent.id, title: i.title, body: i.body, by })));
  });

  // Shared to the page: the phone's share sheet (and its note, sent on its own), Research's Save.
  app.post<{ Params: { wid: string } }>('/api/workspaces/:wid/ideas/saved', async (req) => {
    const ws = getWorkspace(req.params.wid);
    const body = z
      .object({ id: uuid.optional(), text: z.string().max(20_000).optional(), note: z.string().max(5000).optional(), researchItemId: z.string().optional() })
      .parse(req.body);
    if (body.researchItemId) {
      const item = getItem(body.researchItemId);
      if (item.workspaceId !== ws.id || item.platform === 'file') throw badRequest('That post isn’t on this page.');
      return toNode(saveShared(ws.id, { id: body.id, text: item.url, note: body.note }));
    }
    if (!body.text?.trim() && !body.note?.trim()) throw badRequest('Nothing to save.');
    return toNode(saveShared(ws.id, body));
  });

  // A picture dropped or pasted onto the canvas (under a card, or into the Saved pile).
  app.post<{ Params: { wid: string } }>('/api/workspaces/:wid/ideas/image', async (req) => {
    const ws = getWorkspace(req.params.wid);
    const media: Awaited<ReturnType<typeof saveUpload>>[] = [];
    const fields = await readMultipart(req, async (file) => {
      if (!file.mimetype.startsWith('image/')) throw badRequest('Only pictures go on cards.');
      media.push(await saveUpload(ws.id, file, { source: 'idea' }));
    });
    if (!media.length) throw badRequest('No picture received.');
    const parentId = fields.parentId || savedPile(ws.id).id;
    return media.map((m, i) => toNode(createIdea(ws.id, { id: i === 0 && fields.id ? fields.id : undefined, parentId, mediaId: m.id, title: fields.title ?? '' })));
  });

  // Ideas written on the board before the canvas existed: how many, and moving them here (my click).
  app.get<{ Params: { wid: string } }>('/api/workspaces/:wid/ideas/from-board', async (req) => ({ count: boardIdeaCount(getWorkspace(req.params.wid).id) }));
  app.post<{ Params: { wid: string } }>('/api/workspaces/:wid/ideas/from-board', async (req) => moveBoardIdeas(getWorkspace(req.params.wid).id));

  app.get<{ Params: { id: string } }>('/api/ideas/:id', async (req) => ideaDetail(req.params.id));

  app.patch<{ Params: { id: string } }>('/api/ideas/:id', async (req) => {
    const body = z
      .object({
        title: z.string().max(2000).optional(),
        body: z.string().max(50_000).optional(),
        script: z.string().max(50_000).optional(),
        format: z.string().max(5000).optional(),
        labels: z.array(label).max(12).optional(),
        collapsed: z.boolean().optional(),
        kind: z.enum(['idea', 'series']).optional(),
        parentId: z.string().nullable().optional(),
        after: z.string().nullable().optional(),
        position: z.number().optional(),
      })
      .parse(req.body);
    return toNode(updateIdea(req.params.id, body));
  });

  app.delete<{ Params: { id: string } }>('/api/ideas/:id', async (req) => {
    deleteIdea(req.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/ideas/:id/restore', async (req) => toNode(restoreIdea(req.params.id)));

  app.post<{ Params: { id: string } }>('/api/ideas/:id/seen', async (req) => {
    markSeen(req.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/ideas/:id/move', async (req) => {
    const { workspaceId } = z.object({ workspaceId: z.string() }).parse(req.body);
    return toNode(await moveToPage(req.params.id, getWorkspace(workspaceId).id));
  });

  // My click: the idea becomes a video (on this page or another).
  app.post<{ Params: { id: string } }>('/api/ideas/:id/lock', async (req) => {
    const { workspaceId } = z.object({ workspaceId: z.string().optional() }).parse(req.body ?? {});
    return lockIn(req.params.id, { workspaceId });
  });

  app.post<{ Params: { id: string } }>('/api/ideas/:id/assist', async (req) => {
    const { kind } = z.object({ kind: z.enum(ASSISTS) }).parse(req.body);
    requestAssist(req.params.id, kind);
    return toNode(getIdea(req.params.id));
  });

  app.delete<{ Params: { id: string } }>('/api/ideas/:id/assist', async (req) => {
    setAssist(req.params.id, null);
    return { ok: true };
  });

  // "Break it down": Research's analysis of the saved post (one Claude call with frames).
  app.post<{ Params: { id: string } }>('/api/ideas/:id/breakdown', async (req) => {
    const row = getIdea(req.params.id);
    const item = row.researchItemId ? db.select().from(schema.researchItems).where(eq(schema.researchItems.id, row.researchItemId)).get() : undefined;
    if (!item) throw badRequest('Only saved posts can be broken down.');
    queueAnalysis(row.workspaceId, { url: item.url });
    return ideaDetail(row.id);
  });
}
