import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { overview, postPerformance } from '../analytics/report';
import { addIdea, applySlots, getReview, listReviews, startReview, undoVoice } from '../analytics/review';
import { db, schema } from '../db';
import { emit } from '../lib/events';
import { badRequest } from '../lib/http';
import { enqueue, hasPendingJob } from '../jobs/queue';
import { request } from '../publish/platforms/http';
import { getPost } from '../publish/posts';
import { getWorkspace } from '../services/pieces';

/** A TikTok video's id from a link to it, following a short share link (vm.tiktok.com/…) to the full one. */
async function tiktokVideoId(link: string) {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//.test(link) ? link : `https://${link}`);
  } catch {
    return null;
  }
  if (!/(^|\.)tiktok\.com$/.test(url.hostname)) return null;
  const fromPath = (u: URL) => u.pathname.match(/\/(?:video|photo)\/(\d{6,})/)?.[1] ?? null;
  if (fromPath(url)) return fromPath(url);
  const res = await request(url.toString(), { method: 'GET', timeoutMs: 10_000 }).catch(() => null);
  const location = res?.headers.get('location');
  return location ? fromPath(new URL(location, url)) : null;
}

export async function analyticsRoutes(app: FastifyInstance) {
  app.get<{ Params: { wid: string }; Querystring: { days?: string } }>('/api/workspaces/:wid/analytics', async (req) => {
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(90).default(28) }).parse(req.query);
    return overview(getWorkspace(req.params.wid).id, days);
  });

  // "Refresh stats": read every recent post's numbers now, not when they're next due.
  app.post<{ Params: { wid: string } }>('/api/workspaces/:wid/analytics/refresh', async (req) => {
    const ws = getWorkspace(req.params.wid);
    if (!hasPendingJob('stats.sync', 'workspaceId', ws.id)) enqueue('stats.sync', { workspaceId: ws.id, force: true, manual: true }, { maxAttempts: 1 });
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/posts/:id/stats', async (req) => postPerformance(getPost(req.params.id)));

  // A TikTok draft posted from the inbox, or a post TikTok didn't give an id for: say which video it became.
  app.post<{ Params: { id: string } }>('/api/posts/:id/link', async (req) => {
    const post = getPost(req.params.id);
    const { url } = z.object({ url: z.string().trim().min(1).max(500) }).parse(req.body);
    if (post.status !== 'published') throw badRequest('Only posts that went out can be linked to a video.');
    if (post.platform !== 'tiktok') throw badRequest('Only TikTok posts need linking — the others know their video already.');
    const id = await tiktokVideoId(url);
    if (!id) throw badRequest('That doesn’t look like a link to a TikTok video (like tiktok.com/@you/video/123…).');
    const handle = post.accountId ? db.select({ handle: schema.accounts.handle }).from(schema.accounts).where(eq(schema.accounts.id, post.accountId)).get()?.handle : '';
    db.update(schema.posts)
      .set({ externalId: id, url: handle ? `https://www.tiktok.com/@${handle}/video/${id}` : url, statsNote: null, statsAt: null })
      .where(eq(schema.posts.id, post.id))
      .run();
    emit({ type: 'changed', entity: 'posts', workspaceId: post.workspaceId, id: post.id, pieceId: post.pieceId });
    enqueue('stats.sync', { workspaceId: post.workspaceId, postIds: [post.id], force: true }, { maxAttempts: 1 });
    return { ok: true };
  });

  // ---------- weekly reviews ----------

  app.get<{ Params: { wid: string } }>('/api/workspaces/:wid/reviews', async (req) => listReviews(getWorkspace(req.params.wid).id));

  app.post<{ Params: { wid: string } }>('/api/workspaces/:wid/reviews', async (req) => {
    const { digest: _d, ...review } = startReview(getWorkspace(req.params.wid).id, 'manual');
    return review;
  });

  app.post<{ Params: { id: string; index: string } }>('/api/reviews/:id/slots/:index/apply', async (req) => applySlots(getReview(req.params.id).id, Number(req.params.index)));

  app.post<{ Params: { id: string; index: string } }>('/api/reviews/:id/ideas/:index', async (req) => addIdea(getReview(req.params.id).id, Number(req.params.index)));

  app.post<{ Params: { id: string } }>('/api/reviews/:id/undo-voice', async (req) => {
    undoVoice(req.params.id);
    return { ok: true };
  });
}
