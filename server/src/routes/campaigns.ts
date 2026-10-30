import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CHECK_TYPES, isCampaignLink, RULE_KINDS, SUBMISSION_STATUSES } from '../../../shared/campaigns';
import { db, newId, schema } from '../db';
import { badRequest } from '../lib/http';
import { enqueue, hasPendingJob } from '../jobs/queue';
import { deleteCampaign, emitCampaign, getCampaignDetail, getCampaignRow, getSource, listCampaigns, listSources, pagesOf, setPages, updateCampaign } from '../campaigns/campaigns';
import { addSourceLink, deleteSource, freeSourceVideos, saveSourceUpload, startSource, stopSource } from '../campaigns/sources';
import { getSubmission, listSubmissions, updateSubmission } from '../campaigns/submissions';
import { desktopAvailable } from '../lib/desktop';
import { getSetting } from '../lib/settings';

const idParam = z.object({ id: z.string().min(1) });

const ruleSchema = z.object({
  text: z.string().trim().min(1).max(300),
  kind: z.enum(RULE_KINDS),
  check: z.object({ type: z.enum(CHECK_TYPES), value: z.union([z.string().max(200), z.number()]) }).nullable(),
  by: z.literal('you').optional(),
});

function checkPages(ids: string[]) {
  const found = ids.length ? db.select({ id: schema.workspaces.id }).from(schema.workspaces).where(inArray(schema.workspaces.id, ids)).all() : [];
  if (found.length !== new Set(ids).size) throw badRequest('One of those pages doesn’t exist.');
}

const reading = (id: string) => hasPendingJob('campaign.read', 'campaignId', id);
const withReading = <T extends { id: string }>(c: T) => ({ ...c, reading: reading(c.id) });

function startRead(id: string) {
  if (!reading(id)) enqueue('campaign.read', { campaignId: id }, { maxAttempts: 2 });
  emitCampaign(id);
}

/** Campaigns (outside workspaces): add from a link or a brief, confirm and assign, sources. See campaigns/. */
export async function campaignRoutes(app: FastifyInstance) {
  app.get('/api/campaigns', async () => listCampaigns().map(withReading));

  app.post('/api/campaigns', async (req) => {
    const body = z
      .discriminatedUnion('origin', [
        z.object({ origin: z.literal('content_rewards'), link: z.string().trim().url().max(500) }),
        z.object({ origin: z.literal('business'), businessWorkspaceId: z.string().min(1), title: z.string().trim().min(1).max(120), brief: z.string().trim().min(1).max(20_000) }),
      ])
      .parse(req.body);
    if (body.origin === 'content_rewards') {
      if (!isCampaignLink(body.link)) throw badRequest('Give the campaign’s Content Rewards link (contentrewards.com/c/campaigns/…).');
      const link = body.link.replace(/[?#].*$/, '');
      const existing = db.select({ id: schema.campaigns.id }).from(schema.campaigns).where(eq(schema.campaigns.link, link)).get();
      if (existing) return withReading(getCampaignDetail(existing.id));
      const id = newId();
      db.insert(schema.campaigns).values({ id, origin: 'content_rewards', link, status: 'reading' }).run();
      startRead(id);
      return withReading(getCampaignDetail(id));
    }
    checkPages([body.businessWorkspaceId]);
    const id = newId();
    db.insert(schema.campaigns)
      .values({ id, origin: 'business', businessWorkspaceId: body.businessWorkspaceId, title: body.title, description: body.brief, pageText: body.brief, status: 'reading' })
      .run();
    startRead(id);
    return withReading(getCampaignDetail(id));
  });

  app.get('/api/campaigns/:id', async (req) => withReading(getCampaignDetail(idParam.parse(req.params).id)));

  app.patch('/api/campaigns/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const c = getCampaignRow(id);
    const body = z
      .object({
        title: z.string().trim().min(1).max(120).optional(),
        status: z.enum(['active', 'paused', 'ended']).optional(),
        deadline: z.number().int().nullable().optional(),
        pageIds: z.array(z.string().min(1)).max(50).optional(),
        checklist: z.array(ruleSchema).max(60).optional(),
        // A business campaign's brief; read again after changing it.
        brief: z.string().trim().min(1).max(20_000).optional(),
      })
      .parse(req.body);
    if (body.status && (c.status === 'reading' || c.status === 'to_confirm')) throw badRequest('Confirm the campaign first.');
    if (body.brief && c.origin !== 'business') throw badRequest('Only a business campaign has a brief to edit.');
    if (body.pageIds) {
      checkPages(body.pageIds);
      setPages(id, body.pageIds);
    }
    updateCampaign(id, {
      title: body.title,
      status: body.status,
      ...(body.status && { endedAt: body.status === 'ended' ? (c.endedAt ?? Date.now()) : null }),
      deadline: body.deadline,
      checklist: body.checklist,
      ...(body.brief ? { pageText: body.brief, description: body.brief } : {}),
    });
    if (body.brief) startRead(id);
    return withReading(getCampaignDetail(id));
  });

  // My OK after reading the screen: it goes live on the pages I picked. A rejected campaign can't be confirmed.
  app.post('/api/campaigns/:id/confirm', async (req) => {
    const { id } = idParam.parse(req.params);
    const { pageIds } = z.object({ pageIds: z.array(z.string().min(1)).min(1, 'Pick at least one page.').max(50) }).parse(req.body);
    const c = getCampaignRow(id);
    if (c.status !== 'to_confirm') throw badRequest('This campaign isn’t waiting for confirmation.');
    if (c.halalVerdict === 'reject') throw badRequest('The halal screen rejected this campaign, so it can’t be used.');
    if (!c.readAt) throw badRequest('Read the campaign successfully first.');
    checkPages(pageIds);
    setPages(id, pageIds);
    updateCampaign(id, { status: 'active' });
    return withReading(getCampaignDetail(id));
  });

  // A UGC video for one of its pages: Claude writes the script, shot list and captions from the brief (a card on that page).
  app.post('/api/campaigns/:id/ugc', async (req) => {
    const { id } = idParam.parse(req.params);
    const body = z.object({ workspaceId: z.string().min(1), angle: z.string().max(500).optional() }).parse(req.body);
    const c = getCampaignRow(id);
    if (c.status !== 'active') throw badRequest('Confirm the campaign on its pages first.');
    if (!(pagesOf([id]).get(id) ?? []).includes(body.workspaceId)) throw badRequest('That page isn’t one this campaign posts on.');
    enqueue('ugc.script', { campaignId: id, workspaceId: body.workspaceId, angle: body.angle?.trim() || undefined }, { maxAttempts: 3 });
    return { ok: true };
  });

  app.post('/api/campaigns/:id/read', async (req) => {
    const { id } = idParam.parse(req.params);
    const c = getCampaignRow(id);
    if (c.origin === 'content_rewards' && !c.link) throw badRequest('This campaign has no link to read.');
    startRead(id);
    return withReading(getCampaignDetail(id));
  });

  app.delete('/api/campaigns/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    // Downloads still writing into its folder stop first.
    for (const s of listSources(id)) stopSource(s.id);
    await deleteCampaign(id);
    return { ok: true };
  });

  // Delete the downloaded source videos of a campaign that's paused or ended (transcripts, moments and clips stay).
  app.post('/api/campaigns/:id/free-sources', async (req) => {
    const { id } = idParam.parse(req.params);
    const c = getCampaignRow(id);
    if (c.status === 'active') throw badRequest('Pause or end the campaign first: its sources are still in use.');
    await freeSourceVideos(id, 'Video deleted to free space (the transcript stays): download it again to make more clips.');
    return withReading(getCampaignDetail(id));
  });

  // ---------- sources ----------

  app.post('/api/campaigns/:id/sources', async (req) => {
    const { id } = idParam.parse(req.params);
    const { link } = z.object({ link: z.string().trim().url().max(2000) }).parse(req.body);
    await addSourceLink(id, link);
    return getCampaignDetail(id);
  });

  app.post('/api/campaigns/:id/sources/upload', async (req) => {
    const { id } = idParam.parse(req.params);
    getCampaignRow(id);
    for await (const part of req.parts()) {
      if (part.type === 'file') await saveSourceUpload(id, { stream: part.file, filename: part.filename, mimetype: part.mimetype });
    }
    return getCampaignDetail(id);
  });

  // Download a source that's only listed (or try again after a failure); a channel or folder lists its videos.
  app.post('/api/sources/:id/start', async (req) => {
    const s = getSource(idParam.parse(req.params).id);
    await startSource(s.id, { confirmed: true });
    return getCampaignDetail(s.campaignId);
  });

  app.delete('/api/sources/:id', async (req) => {
    const s = getSource(idParam.parse(req.params).id);
    await deleteSource(s.id);
    return getCampaignDetail(s.campaignId);
  });
}

/** Submissions to Content Rewards: the list, my changes, and reading their status there. */
export async function submissionRoutes(app: FastifyInstance) {
  const syncState = () => ({ last: getSetting('submissionsSync') ?? null, available: desktopAvailable(), running: hasPendingJob('submissions.sync') });

  app.get('/api/submissions', async (req) => {
    const q = z.object({ campaignId: z.string().optional(), workspaceId: z.string().optional(), status: z.string().optional() }).parse(req.query);
    const statuses = q.status?.split(',').filter((s): s is (typeof SUBMISSION_STATUSES)[number] => (SUBMISSION_STATUSES as readonly string[]).includes(s));
    return listSubmissions({ campaignId: q.campaignId, workspaceId: q.workspaceId, statuses: statuses?.length ? statuses : undefined });
  });

  app.patch('/api/submissions/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    const body = z
      .object({
        status: z.enum(SUBMISSION_STATUSES).optional(),
        views: z.number().int().min(0).max(1e12).nullable().optional(),
        earnings: z.number().min(0).max(1e7).nullable().optional(),
        note: z.string().max(500).optional(),
      })
      .parse(req.body);
    updateSubmission(id, body);
    return listSubmissions({ campaignId: getSubmission(id).campaignId }).find((s) => s.id === id);
  });

  app.get('/api/submissions/sync', async () => syncState());

  // "Check now": read my submissions page on Content Rewards (one page read, one Haiku call).
  app.post('/api/submissions/sync', async () => {
    if (!desktopAvailable()) throw badRequest('Reading Content Rewards needs the desktop app: open Content Studio on the computer.');
    if (!hasPendingJob('submissions.sync')) enqueue('submissions.sync', {}, { maxAttempts: 1 });
    return syncState();
  });
}
