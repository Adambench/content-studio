// "Find clips" on a clipping page: one run that chains the whole search. New Content Rewards campaigns (leads to add;
// joining stays the creator's click), then for each active campaign on the page the creator's videos (channels listed
// again, ranked by views and recency, the best few downloaded), the moments other clippers already got big on (matched
// to the transcript before the scan), and the usual scan → pick → make, ending in Review. Runs by hand or each
// morning. The slow parts (download, transcript, pick, cut) are the jobs that already exist; this only starts them.
import { and, eq, inArray, sql } from 'drizzle-orm';
import { FINDER_STEPS, emptyRun, rankVideos, type FinderRun, type FinderStep, type FinderStepId } from '../../../shared/finder';
import { db, now, schema } from '../db';
import { emit } from '../lib/events';
import { HttpError } from '../lib/http';
import { getSetting, setSetting } from '../lib/settings';
import { enqueue, hasPendingJob } from '../jobs/queue';
import { getWorkspace } from '../services/pieces';
import { existsSync } from 'node:fs';
import { relistChannel, rememberedListings, isListingLink, queueScan, readSourceTranscript, sourceScanPath, startSource } from '../campaigns/sources';
import { campaignLeads, discoverCampaigns } from './discover';
import { findViralHints } from './viral';

/** Videos started per campaign per run, and how many may be in progress at once (disk and CPU stay bounded). */
const START_PER_CAMPAIGN = 2;
const MAX_IN_PROGRESS = 3;
const IN_PROGRESS = ['queued', 'downloading', 'transcribing', 'scanning'] as const;

export const getRun = (workspaceId: string): FinderRun => getSetting('finderRuns')?.[workspaceId] ?? emptyRun();
const saveRun = (workspaceId: string, run: FinderRun) => {
  setSetting('finderRuns', { ...(getSetting('finderRuns') ?? {}), [workspaceId]: run });
  emit({ type: 'changed', entity: 'finder', workspaceId });
};

export const finderAuto = (workspaceId: string) => getSetting('finderAuto')?.[workspaceId] ?? true;
export function setFinderAuto(workspaceId: string, on: boolean) {
  setSetting('finderAuto', { ...(getSetting('finderAuto') ?? {}), [workspaceId]: on });
  emit({ type: 'changed', entity: 'finder', workspaceId });
}

export function startFinder(workspaceId: string) {
  const ws = getWorkspace(workspaceId);
  if (ws.kind !== 'clipping') throw new HttpError(400, 'Only clipping pages have Find clips.');
  if (hasPendingJob('finder.run', 'workspaceId', workspaceId)) throw new HttpError(409, 'Already looking.');
  saveRun(workspaceId, {
    status: 'running',
    startedAt: now(),
    finishedAt: null,
    summary: '',
    steps: (Object.keys(FINDER_STEPS) as FinderStepId[]).map((id) => ({ id, label: FINDER_STEPS[id], status: 'waiting', detail: '' })),
  });
  enqueue('finder.run', { workspaceId }, { maxAttempts: 1 });
}

/** The active campaigns this page posts on. */
function activeCampaigns(workspaceId: string) {
  return db
    .select({ id: schema.campaigns.id, title: schema.campaigns.title })
    .from(schema.campaigns)
    .innerJoin(schema.campaignPages, eq(schema.campaignPages.campaignId, schema.campaigns.id))
    .where(and(eq(schema.campaignPages.workspaceId, workspaceId), eq(schema.campaigns.status, 'active')))
    .all();
}

const momentCount = (sourceId: string) => db.select({ n: sql<number>`count(*)` }).from(schema.moments).where(eq(schema.moments.sourceId, sourceId)).get()?.n ?? 0;

type Source = typeof schema.campaignSources.$inferSelect;

/** Step 2: list the channels again, rank what is not downloaded, start the best few. Returns a line for the step. */
async function findVideos(campaigns: { id: string; title: string }[]) {
  let started = 0;
  let listed = 0;
  for (const c of campaigns) {
    for (const link of rememberedListings(c.id).slice(-3)) listed += (await relistChannel(c.id, link).catch(() => [])).length;
    const rows = db.select().from(schema.campaignSources).where(eq(schema.campaignSources.campaignId, c.id)).all();
    // A channel link added but never listed.
    for (const r of rows.filter((r) => r.status === 'found' && r.link && isListingLink(r.link)).slice(0, 3)) await startSource(r.id).catch(() => []);
    const all = db.select().from(schema.campaignSources).where(eq(schema.campaignSources.campaignId, c.id)).all();
    const busy = all.filter((r) => (IN_PROGRESS as readonly string[]).includes(r.status)).length;
    const room = Math.max(0, Math.min(START_PER_CAMPAIGN, MAX_IN_PROGRESS - busy));
    const candidates = all.filter((r) => r.status === 'found' && r.link && !isListingLink(r.link));
    const ranked = rankVideos(candidates.map((r) => ({ ...r, moments: momentCount(r.id) })));
    for (const r of ranked.slice(0, room)) {
      await startSource(r.id).catch((err: Error) => console.warn(`[finder] ${r.title}: ${err.message}`));
      started++;
    }
  }
  return { started, listed };
}

/** Step 3: sources that already have a transcript and no moments yet get their viral stretches before the scan. */
export async function attachViral(source: Source) {
  const t = await readSourceTranscript(source);
  if (!t) return 0;
  const hints = await findViralHints(source, t, (m) => console.warn(`[finder] ${source.title}: ${m}`)).catch(() => []);
  if (hints.length) db.update(schema.campaignSources).set({ viral: hints }).where(eq(schema.campaignSources.id, source.id)).run();
  return hints.length;
}

async function waitingSources(campaigns: { id: string }[]) {
  if (!campaigns.length) return [];
  return db
    .select()
    .from(schema.campaignSources)
    .where(and(inArray(schema.campaignSources.campaignId, campaigns.map((c) => c.id)), eq(schema.campaignSources.status, 'ready')))
    .all()
    // A source already scanned that had nothing standing alone isn't scanned (and its viral search run) again.
    .filter((s) => s.fileName && momentCount(s.id) === 0 && !existsSync(sourceScanPath(s)));
}

/** The `finder.run` job. */
export async function runFinder({ workspaceId }: { workspaceId: string }) {
  const run = getRun(workspaceId);
  const step = (id: FinderStepId, patch: Partial<FinderStep>) => {
    run.steps = run.steps.map((s) => (s.id === id ? { ...s, ...patch } : s));
    saveRun(workspaceId, run);
  };
  const guarded = async (id: FinderStepId, work: () => Promise<string>) => {
    step(id, { status: 'running', detail: '' });
    try {
      step(id, { status: 'done', detail: await work() });
    } catch (err) {
      step(id, { status: 'error', detail: (err as Error).message.slice(0, 200) });
    }
  };

  await guarded('campaigns', async () => {
    // The campaign list is the same for every clipping page: read it at most every few hours (the signed-in window has a daily cap).
    const last = campaignLeads();
    if (Date.now() - last.at < 4 * 3600_000) return `${last.items.length} campaign${last.items.length === 1 ? '' : 's'} to look at (checked ${Math.round((Date.now() - last.at) / 60_000)} min ago)`;
    const n = await discoverCampaigns();
    return n ? `${n} new campaign${n === 1 ? '' : 's'} to look at` : 'Nothing new';
  });
  const campaigns = activeCampaigns(workspaceId);
  if (!campaigns.length) {
    for (const id of ['videos', 'viral', 'clips'] as const) step(id, { status: 'skipped', detail: 'No active campaign is assigned to this page.' });
  } else {
    await guarded('videos', async () => {
      const { started, listed } = await findVideos(campaigns);
      return `${started} video${started === 1 ? '' : 's'} started downloading${listed ? `, ${listed} listed` : ''}`;
    });
    await guarded('viral', async () => {
      let hints = 0;
      for (const s of await waitingSources(campaigns)) hints += await attachViral(s);
      return hints ? `${hints} stretch${hints === 1 ? '' : 'es'} other clippers already got big on` : 'None found (new videos are checked once they have a transcript)';
    });
    await guarded('clips', async () => {
      const waiting = await waitingSources(campaigns);
      for (const s of waiting) queueScan(s.id);
      const busy = db.select({ n: sql<number>`count(*)` }).from(schema.campaignSources).where(inArray(schema.campaignSources.status, [...IN_PROGRESS])).get()?.n ?? 0;
      return `${waiting.length} video${waiting.length === 1 ? '' : 's'} sent to find moments; ${busy} in progress. Clips land in Review as they’re made.`;
    });
  }
  run.status = run.steps.every((s) => s.status === 'error') ? 'error' : 'done';
  run.finishedAt = now();
  run.summary = run.steps
    .filter((s) => s.status === 'done' && s.detail)
    .map((s) => s.detail)
    .join(' · ');
  saveRun(workspaceId, run);
}

export function onFinderFailed({ workspaceId }: { workspaceId: string }, message: string) {
  saveRun(workspaceId, { ...getRun(workspaceId), status: 'error', finishedAt: now(), summary: message.slice(0, 200) });
}
