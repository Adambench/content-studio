// The board, a clipping page's campaign links and help writing a script (PLAN.md Phase 14).
import { desc, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { CampaignLink } from '../../../shared/board';
import { addCampaignLink } from '../campaigns/add';
import { emitCampaign, pagesOf, setPages } from '../campaigns/campaigns';
import { db, schema } from '../db';
import { badRequest } from '../lib/http';
import { boardData } from '../services/board';
import { getPiece, getWorkspace } from '../services/pieces';
import { hookOptions, scriptDirections } from '../services/script-help';

export async function boardRoutes(app: FastifyInstance) {
  app.get('/api/board', async () => boardData());

  app.get<{ Params: { wid: string } }>('/api/workspaces/:wid/campaign-links', async (req): Promise<CampaignLink[]> => {
    const ws = getWorkspace(req.params.wid);
    const ids = db.select({ id: schema.campaignPages.campaignId }).from(schema.campaignPages).where(eq(schema.campaignPages.workspaceId, ws.id)).all().map((r) => r.id);
    if (!ids.length) return [];
    return db
      .select()
      .from(schema.campaigns)
      .where(inArray(schema.campaigns.id, ids))
      .orderBy(desc(schema.campaigns.createdAt))
      .all()
      .map((c) => ({
        id: c.id,
        title: c.title || null,
        link: c.link ?? '',
        ended: c.status === 'ended' || !!c.endedAt || c.budgetLeft === 0,
        checked: !!c.readAt,
        note: c.halalVerdict === 'reject' ? 'Not halal' : c.halalVerdict === 'flag' ? 'Halal?' : !c.readAt && c.readNote ? 'Couldn’t read it' : null,
        why: c.halalVerdict ? c.halalReasons.join(' · ') : (c.readNote ?? ''),
      }));
  });

  app.post<{ Params: { wid: string } }>('/api/workspaces/:wid/campaign-links', async (req) => {
    const ws = getWorkspace(req.params.wid);
    const { link } = z.object({ link: z.string().trim().min(1).max(2000) }).parse(req.body);
    try {
      return addCampaignLink(link, ws.id);
    } catch (err) {
      throw badRequest((err as Error).message);
    }
  });

  // Off this page; the campaign itself stays (its clips and history).
  app.delete<{ Params: { wid: string; id: string } }>('/api/workspaces/:wid/campaign-links/:id', async (req) => {
    const ws = getWorkspace(req.params.wid);
    const pages = pagesOf([req.params.id]).get(req.params.id) ?? [];
    setPages(req.params.id, pages.filter((p) => p !== ws.id));
    emitCampaign(req.params.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/pieces/:id/hooks', async (req) => {
    getPiece(req.params.id);
    return { hooks: await hookOptions(req.params.id) };
  });

  app.post<{ Params: { id: string } }>('/api/pieces/:id/script-directions', async (req) => {
    getPiece(req.params.id);
    return { directions: await scriptDirections(req.params.id) };
  });
}
