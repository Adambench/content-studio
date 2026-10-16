import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { campaignLeads, dropLead } from '../finder/discover';
import { finderAuto, getRun, setFinderAuto, startFinder } from '../finder/finder';
import { getWorkspace } from '../services/pieces';

/** The one-button finder on clipping pages (shared/finder.ts). */
export async function finderRoutes(app: FastifyInstance) {
  app.get<{ Params: { wid: string } }>('/api/workspaces/:wid/finder', async (req) => {
    const ws = getWorkspace(req.params.wid);
    return { run: getRun(ws.id), auto: finderAuto(ws.id), leads: campaignLeads() };
  });

  app.post<{ Params: { wid: string } }>('/api/workspaces/:wid/finder', async (req) => {
    startFinder(getWorkspace(req.params.wid).id);
    return { ok: true };
  });

  app.put<{ Params: { wid: string } }>('/api/workspaces/:wid/finder/auto', async (req) => {
    const body = z.object({ on: z.boolean() }).parse(req.body);
    setFinderAuto(getWorkspace(req.params.wid).id, body.on);
    return { ok: true };
  });

  // A lead the creator added (via the normal campaign add) or doesn't want.
  app.post('/api/finder/leads/dismiss', async (req) => {
    dropLead(z.object({ link: z.string() }).parse(req.body).link);
    return { ok: true };
  });
}
