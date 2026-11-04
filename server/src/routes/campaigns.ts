import { inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CAMPAIGN_PLATFORMS, CHECK_TYPES, isMarket, MARKET_INFO, MARKETS, parseCampaignLink, RULE_KINDS, SUBMISSION_STATUSES } from '../../../shared/campaigns';
import { db, newId, schema } from '../db';
import { badRequest } from '../lib/http';
import { enqueue, hasPendingJob } from '../jobs/queue';
import { deleteCampaign, emitCampaign, getCampaignDetail, getCampaignRow, getSource, listCampaigns, listSources, pagesOf, setPages, updateCampaign } from '../campaigns/campaigns';
import { addSourceLink, deleteSource, freeSourceVideos, saveSourceUpload, startSource, stopSource } from '../campaigns/sources';
import { getSubmission, listSubmissions, updateSubmission } from '../campaigns/submissions';
import { addCampaignLink, isReading, startRead } from '../campaigns/add';
import { desktopAvailable } from '../lib/desktop';
import { getSetting } from '../lib/settings';

const idParam = z.object({ id: z.string().min(1) });

const ruleSchema = z.object({
  text: z.string().trim().min(1).max(300),
  kind: z.enum(RULE_KINDS),
  check: z.object({ type: z.enum(CHECK_TYPES), value: z.union([z.string().max(200), z.number()]) }).nullable(),
  platforms: z.array(z.enum(CAMPAIGN_PLATFORMS)).max(4).optional(),
  by: z.literal('you').optional(),
});

function checkPages(ids: string[]) {
  const found = ids.length ? db.select({ id: schema.workspaces.id }).from(schema.workspaces).where(inArray(schema.workspaces.id, ids)).all() : [];
  if (found.length !== new Set(ids).size) throw badRequest('One of those pages doesn’t exist.');
}

const withReading = <T extends { id: string }>(c: T) => ({ ...c, reading: isReading(c.id) });

/** Campaigns, each on the page (workspace) it's added from: add from a link or a brief, confirm, sources. See campaigns/. */
export async function campaignRoutes(app: FastifyInstance) {
  app.get('/api/campaigns', async () => listCampaigns().map(withReading));

  app.post('/api/campaigns', async (req) => {
    const body = z
      .union([
        // A marketplace campaign's link (Content Rewards or Vyro; `origin` is read from the link), for the page `pageId`.
        z.object({ origin: z.enum(MARKETS).optional(), link: z.string().trim().url().max(500), pageId: z.string().min(1).optional() }),
        // A business's own: it posts on the business's page unless `pageId` says another.
        z.object({
          origin: z.literal('business'),
          businessWorkspaceId: z.string().min(1),
          pageId: z.string().min(1).optional(),
          title: z.string().trim().min(1).max(120),
          brief: z.string().trim().min(1).max(20_000),
        }),
      ])
      .parse(req.body);
    if ('link' in body) {
      if (!body.pageId) throw badRequest('Say which page it’s for: a campaign is added to the page it posts on.');
      checkPages([body.pageId]);
      if (!parseCampaignLink(body.link))
        throw badRequest(
          /whop\.com/i.test(body.link)
            ? 'That’s Whop’s page, which doesn’t say which campaign is open. Use the campaign’s own link: the link button on its banner, or open it on contentrewards.com.'
            : `Give the campaign’s own link: ${MARKETS.map((m) => MARKET_INFO[m].linkExample).join(' or ')}.`,
        );
      return withReading(getCampaignDetail(addCampaignLink(body.link, body.pageId).id));
    }
    checkPages([body.businessWorkspaceId, ...(body.pageId ? [body.pageId] : [])]);
    const id = newId();
    db.insert(schema.campaigns)
      .values({ id, origin: 'business', businessWorkspaceId: body.businessWorkspaceId, title: body.title, description: body.brief, pageText: body.brief, status: 'reading' })
      .run();
    setPages(id, [body.pageId ?? body.businessWorkspaceId]);
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

  // My OK after reading the screen: it goes live on its page (or the pages given). A rejected campaign can't be confirmed.
  app.post('/api/campaigns/:id/confirm', async (req) => {
    const { id } = idParam.parse(req.params);
    const body = z.object({ pageIds: z.array(z.string().min(1)).min(1).max(50).optional() }).parse(req.body ?? {});
    const c = getCampaignRow(id);
    if (c.status !== 'to_confirm') throw badRequest('This campaign isn’t waiting for confirmation.');
    if (c.halalVerdict === 'reject') throw badRequest('The halal screen rejected this campaign, so it can’t be used.');
    if (!c.readAt) throw badRequest('Read the campaign successfully first.');
    const pageIds = body.pageIds ?? pagesOf([id]).get(id) ?? [];
    if (!pageIds.length) throw badRequest('Pick the page it posts on.');
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

  // Read it again; `text` is the campaign page's text I copied, for when the page can't be read as it should.
  app.post('/api/campaigns/:id/read', async (req) => {
    const { id } = idParam.parse(req.params);
    const { text } = z.object({ text: z.string().trim().min(40, 'Paste the whole campaign page.').max(100_000).optional() }).parse(req.body ?? {});
    const c = getCampaignRow(id);
    if (text && !isMarket(c.origin)) throw badRequest('A business campaign reads its brief: edit the brief instead.');
    if (isMarket(c.origin) && !c.link) throw badRequest('This campaign has no link to read.');
    if (isReading(id)) throw badRequest('It’s being read right now: wait for that first.');
    startRead(id, text);
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

/** Submissions to the marketplaces: the list, my changes, and reading their status there. */
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

  // "Check now": read my submissions pages on the marketplaces (one page read and one Haiku call each).
  app.post('/api/submissions/sync', async () => {
    if (!desktopAvailable()) throw badRequest('Reading the marketplaces needs the desktop app: open Content Studio on the computer.');
    if (!hasPendingJob('submissions.sync')) enqueue('submissions.sync', {}, { maxAttempts: 1 });
    return syncState();
  });
}
