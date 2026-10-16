import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { normalizeResearch } from '../../../shared/research';
import { db, now, schema } from '../db';
import { eq } from 'drizzle-orm';
import { emit } from '../lib/events';
import { badRequest, HttpError } from '../lib/http';
import { queueAnalysis } from '../research/analyse';
import { addBriefIdea } from '../research/brief';
import { emitResearch, getItem, researchOverview, researchSettings } from '../research/research';
import { runResearch } from '../research/schedule';
import { suggestChannels } from '../research/sweep';
import { getWorkspace } from '../services/pieces';

const idParam = z.object({ id: z.string().min(1) });

/** Research: what a page watches, its daily brief and outliers, and videos analysed on request. */
export async function researchRoutes(app: FastifyInstance) {
  app.get<{ Params: { wid: string } }>('/api/workspaces/:wid/research', async (req) => researchOverview(getWorkspace(req.params.wid).id));

  app.put<{ Params: { wid: string } }>('/api/workspaces/:wid/research/settings', async (req) => {
    const ws = getWorkspace(req.params.wid);
    const body = z
      .object({
        keywords: z.array(z.string().max(80)).max(20),
        youtube: z.array(z.object({ url: z.string().max(300), name: z.string().max(100) })).max(40),
        tiktok: z.array(z.string().max(100)).max(40),
        instagram: z.array(z.string().max(100)).max(40),
      })
      .parse(req.body);
    const research = normalizeResearch(body);
    db.update(schema.workspaces).set({ research, updatedAt: now() }).where(eq(schema.workspaces.id, ws.id)).run();
    emit({ type: 'changed', entity: 'workspaces', workspaceId: ws.id });
    emitResearch(ws.id);
    return research;
  });

  // "Find channels for me": YouTube channels that keep coming up in Shorts searches for the keywords (or the niche).
  app.post<{ Params: { wid: string } }>('/api/workspaces/:wid/research/find-channels', async (req) => {
    const ws = getWorkspace(req.params.wid);
    const { keywords } = z.object({ keywords: z.array(z.string().trim().min(2).max(80)).max(5).optional() }).parse(req.body ?? {});
    const settings = researchSettings(ws.id);
    const words = keywords?.length ? keywords : settings.keywords.length ? settings.keywords : ws.niche ? [ws.niche.split(/[.,;:—–-]/)[0].slice(0, 60)] : [];
    if (!words.length) throw badRequest('Add a keyword (or the page’s niche) first.');
    try {
      return { keywords: words, channels: await suggestChannels(words, settings.youtube.map((c) => c.url)) };
    } catch (err) {
      throw new HttpError(502, `YouTube search didn’t work: ${(err as Error).message}`);
    }
  });

  app.post<{ Params: { wid: string } }>('/api/workspaces/:wid/research/run', async (req) => {
    runResearch(getWorkspace(req.params.wid).id);
    return researchOverview(req.params.wid);
  });

  // Analyse a video: a pasted link, or one in the library.
  app.post<{ Params: { wid: string } }>('/api/workspaces/:wid/research/analyse', async (req) => {
    const ws = getWorkspace(req.params.wid);
    const body = z.union([z.object({ url: z.string().trim().min(5).max(1000) }), z.object({ mediaId: z.string().min(1) })]).parse(req.body);
    return queueAnalysis(ws.id, body);
  });

  app.get('/api/research/items/:id', async (req) => getItem(idParam.parse(req.params).id));

  app.delete('/api/research/items/:id', async (req) => {
    const item = getItem(idParam.parse(req.params).id);
    db.delete(schema.researchItems).where(eq(schema.researchItems.id, item.id)).run();
    emitResearch(item.workspaceId);
    return { ok: true };
  });

  app.post<{ Params: { id: string; index: string } }>('/api/research/briefs/:id/ideas/:index', async (req) => addBriefIdea(req.params.id, Number(req.params.index)));
}
