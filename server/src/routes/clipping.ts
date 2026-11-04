import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getCampaignDetail, getCampaignRow, getSource, pagesOf } from '../campaigns/campaigns';
import { queueScan, readSourceTranscript } from '../campaigns/sources';
import { badRequest, HttpError } from '../lib/http';
import { hasPendingJob } from '../jobs/queue';
import { getMoment, queueMake, updateMoment } from '../clipping/moments';
import { approveClip, approvePlan, rejectClip, reviewClip, reviewQueue, undoApprove } from '../clipping/review';

const idParam = z.object({ id: z.string().min(1) });

/** Find moments in a source again (or for the first time, when its campaign wasn't active yet). */
export async function findMoments(sourceId: string) {
  const s = getSource(sourceId);
  const c = getCampaignRow(s.campaignId);
  if (c.status !== 'active') throw badRequest('Make the campaign active first.');
  if (!pagesOf([c.id]).get(c.id)?.length) throw badRequest('Pick the pages this campaign posts on first.');
  if (s.status !== 'ready' && s.status !== 'error') throw new HttpError(409, s.status === 'scanning' ? 'It’s already looking for moments.' : 'Wait until it’s downloaded and transcribed.');
  if (hasPendingJob('source.scan', 'sourceId', sourceId) || hasPendingJob('source.pick', 'sourceId', sourceId)) throw new HttpError(409, 'It’s already looking for moments.');
  if (!(await readSourceTranscript(s))) throw badRequest('It has no transcript yet.');
  if (!s.fileName) throw badRequest('Its video was deleted to save space: download it again first.');
  queueScan(sourceId);
}

/** Clipping: finding moments in sources, making clips, and the review queue (approve and queue, or reject). */
export async function clippingRoutes(app: FastifyInstance) {
  app.post('/api/sources/:id/moments', async (req) => {
    const s = getSource(idParam.parse(req.params).id);
    await findMoments(s.id);
    return getCampaignDetail(s.campaignId);
  });

  // Make a moment's clip (again): one I skipped, one that failed or was dropped, or one whose card I deleted.
  app.post('/api/moments/:id/make', async (req) => {
    const m = getMoment(idParam.parse(req.params).id);
    if (m.status === 'making') throw new HttpError(409, 'It’s being made.');
    if (m.status === 'made' && m.pieceId) throw new HttpError(409, 'Its clip is already on the board.');
    const c = getCampaignRow(m.campaignId);
    if (c.status !== 'active') throw badRequest('Make the campaign active first.');
    queueMake(m.id);
    return getCampaignDetail(m.campaignId);
  });

  // Not this one, without making it (the reason, if any, teaches the next pick like a rejected clip's).
  app.post('/api/moments/:id/skip', async (req) => {
    const m = getMoment(idParam.parse(req.params).id);
    const { reason } = z.object({ reason: z.string().trim().max(300).default('') }).parse(req.body ?? {});
    // One still waiting its turn can go; once it's being made, it finishes and is judged at review.
    if (m.status === 'making' && !m.detail.startsWith('Waiting')) throw new HttpError(409, 'It’s being made: reject it at review.');
    if (m.status === 'made' && m.pieceId) throw new HttpError(409, 'It has a clip already: reject that one at review.');
    updateMoment(m.id, { status: 'rejected', rejectReason: reason || 'Skipped', detail: '' });
    return getCampaignDetail(m.campaignId);
  });

  app.get('/api/review', async (req) => {
    const { workspaceId } = z.object({ workspaceId: z.string().optional() }).parse(req.query);
    return reviewQueue(workspaceId);
  });

  app.get('/api/review/:id', async (req) => reviewClip(idParam.parse(req.params).id));

  app.post('/api/review/:id/approve', async (req) => {
    const { id } = idParam.parse(req.params);
    const body = z.object({ tiktokPrivacy: z.enum(['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY']).optional() }).parse(req.body ?? {});
    return approveClip(id, body);
  });

  app.get('/api/review/:id/plan', async (req) => approvePlan(idParam.parse(req.params).id));

  app.post('/api/review/:id/undo', async (req) => {
    const { id } = idParam.parse(req.params);
    const { stage } = z.object({ stage: z.string().min(1).max(40) }).parse(req.body);
    return undoApprove(id, stage);
  });

  app.post('/api/review/:id/reject', async (req) => {
    const { id } = idParam.parse(req.params);
    const { reason } = z.object({ reason: z.string().trim().min(1, 'Say why, so the next clips avoid it.').max(300) }).parse(req.body);
    return rejectClip(id, reason);
  });
}
