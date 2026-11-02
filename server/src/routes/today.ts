import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { REVIEW_STAGE, normalizeModules } from '../../../shared/types';
import { busySources, listCampaigns } from '../campaigns/campaigns';
import { campaignResults, listSubmissions } from '../campaigns/submissions';
import { desktopAvailable } from '../lib/desktop';
import { latestBriefs } from '../research/research';
import { db, schema } from '../db';
import { getSetting } from '../lib/settings';
import { todayPosts } from '../publish/posts';

const DAY = 24 * 60 * 60 * 1000;

/** Background jobs worth showing, by what they do for me. Renders, transcriptions and posts have their own rows. */
const JOB_LABELS: Record<string, string> = {
  'capture.structure': 'Turning a captured idea into a card',
  'media.generate': 'Generating a picture or clip on the home PC',
  'voice.learn': 'Learning from your edits',
  'stats.sync': 'Reading the latest numbers',
  'analytics.review': 'Writing the weekly review',
  'campaign.read': 'Reading a campaign',
  'submissions.sync': 'Checking your submissions on the marketplaces',
  'research.sweep': 'Looking at what’s working in the niche',
  'research.brief': 'Writing the research brief',
  'research.analyse': 'Analysing a video',
  'reference.measure': 'Measuring a reference',
  'reference.lessons': 'Reading a reference',
  'inspiration.build': 'Writing a page’s style from its references',
};

/**
 * The Today view: what needs me across every workspace (clips to review, today's posts and the ones that failed,
 * clips to submit on Content Rewards), what's running, campaigns (to confirm, budget left, deadline, earnings) and
 * Claude usage.
 */
export async function todayRoutes(app: FastifyInstance) {
  app.get('/api/today', async (req) => {
    // The day as the asking device sees it (its local midnight); the server's own day otherwise.
    const q = z.object({ from: z.coerce.number().int().optional(), to: z.coerce.number().int().optional() }).parse(req.query);
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const from = q.from ?? midnight.getTime();
    const to = q.to && q.to > from ? q.to : from + DAY;

    const workspaces = db.select().from(schema.workspaces).orderBy(asc(schema.workspaces.position), asc(schema.workspaces.createdAt)).all();
    const wsIds = workspaces.map((w) => w.id);

    // ---------- clips waiting for review ----------
    const reviewing = workspaces.filter((w) => w.stages.some((s) => s.id === REVIEW_STAGE)).map((w) => w.id);
    const reviewPieces = reviewing.length
      ? db
          .select({ id: schema.pieces.id, workspaceId: schema.pieces.workspaceId, title: schema.pieces.title, updatedAt: schema.pieces.updatedAt })
          .from(schema.pieces)
          .where(and(eq(schema.pieces.stage, REVIEW_STAGE), inArray(schema.pieces.workspaceId, reviewing)))
          .orderBy(asc(schema.pieces.updatedAt))
          .limit(60)
          .all()
      : [];
    // Show the latest render when there is one (that's what gets approved), else the first footage.
    const pieceMedia = reviewPieces.length
      ? db
          .select({ id: schema.media.id, pieceId: schema.media.pieceId, source: schema.media.source, hasThumb: schema.media.hasThumb, durationMs: schema.media.durationMs, createdAt: schema.media.createdAt })
          .from(schema.media)
          .where(and(inArray(schema.media.pieceId, reviewPieces.map((p) => p.id)), isNull(schema.media.assetType)))
          .orderBy(asc(schema.media.createdAt))
          .all()
      : [];
    const review = reviewPieces.map((p) => {
      const own = pieceMedia.filter((m) => m.pieceId === p.id);
      const render = own.filter((m) => m.source === 'render').at(-1);
      const thumb = (render?.hasThumb ? render : undefined) ?? own.find((m) => m.hasThumb);
      return { ...p, thumbMediaId: thumb?.id ?? null, renderMediaId: render?.id ?? null, durationMs: render?.durationMs ?? null };
    });

    // ---------- work running ----------
    const renders = db
      .select({
        id: schema.renders.id,
        workspaceId: schema.renders.workspaceId,
        pieceId: schema.renders.pieceId,
        status: schema.renders.status,
        progress: schema.renders.progress,
        stage: schema.renders.stage,
        versionNumber: schema.renders.versionNumber,
        createdAt: schema.renders.createdAt,
        title: schema.pieces.title,
      })
      .from(schema.renders)
      .leftJoin(schema.pieces, eq(schema.pieces.id, schema.renders.pieceId))
      .where(inArray(schema.renders.status, ['queued', 'running']))
      .orderBy(asc(schema.renders.createdAt))
      .all();
    const transcribing = db
      .select({ id: schema.media.id, workspaceId: schema.media.workspaceId, name: schema.media.originalName, status: schema.media.transcriptStatus, durationMs: schema.media.durationMs })
      .from(schema.media)
      .where(inArray(schema.media.transcriptStatus, ['queued', 'running']))
      .orderBy(asc(schema.media.createdAt))
      .all();
    const jobs = db
      .select({ id: schema.jobs.id, type: schema.jobs.type, status: schema.jobs.status, payload: schema.jobs.payload })
      .from(schema.jobs)
      .where(and(inArray(schema.jobs.status, ['queued', 'running']), inArray(schema.jobs.type, Object.keys(JOB_LABELS))))
      .orderBy(asc(schema.jobs.runAt))
      .all();
    const work = [
      ...renders.map((r) => ({
        id: r.id,
        type: 'render' as const,
        workspaceId: r.workspaceId,
        pieceId: r.pieceId,
        title: `Rendering ${r.title ?? 'a video'}${r.versionNumber ? ` · v${r.versionNumber}` : ''}`,
        detail: r.status === 'queued' ? 'Waiting its turn' : r.stage,
        status: r.status as 'queued' | 'running',
        progress: r.status === 'running' ? r.progress : null,
      })),
      ...transcribing.map((m) => ({
        id: m.id,
        type: 'transcribe' as const,
        workspaceId: m.workspaceId,
        pieceId: null,
        title: `Transcribing ${m.name}`,
        detail: m.status === 'queued' ? 'Waiting its turn' : m.durationMs ? `${Math.round(m.durationMs / 60000) || '<1'} min of audio` : 'Listening',
        status: m.status as 'queued' | 'running',
        progress: null,
      })),
      ...jobs.map((j) => ({
        id: j.id,
        type: 'job' as const,
        workspaceId: typeof j.payload.workspaceId === 'string' ? j.payload.workspaceId : null,
        pieceId: null,
        title: JOB_LABELS[j.type],
        detail: j.status === 'queued' ? 'Waiting its turn' : 'Working on it',
        status: j.status as 'queued' | 'running',
        progress: null,
      })),
      ...busySources().map(({ source: s, campaignTitle }) => ({
        id: s.id,
        type: 'source' as const,
        workspaceId: null,
        pieceId: null,
        campaignId: s.campaignId,
        title: `${s.status === 'transcribing' ? 'Transcribing' : s.status === 'scanning' ? 'Finding moments in' : 'Downloading'} ${s.title || 'a source video'}`,
        detail: [campaignTitle, s.status === 'queued' ? 'Waiting its turn' : s.detail].filter(Boolean).join(' · '),
        status: (s.status === 'queued' || (s.status === 'transcribing' && s.detail === 'Waiting its turn') ? 'queued' : 'running') as 'queued' | 'running',
        progress: s.status === 'downloading' ? s.progress : null,
      })),
      ...db
        .select({ id: schema.moments.id, workspaceId: schema.moments.workspaceId, campaignId: schema.moments.campaignId, title: schema.moments.title, detail: schema.moments.detail })
        .from(schema.moments)
        .where(eq(schema.moments.status, 'making'))
        .orderBy(asc(schema.moments.updatedAt))
        .all()
        .map((m) => ({
          id: m.id,
          type: 'clip' as const,
          workspaceId: m.workspaceId,
          pieceId: null,
          campaignId: m.campaignId,
          title: `Making a clip: ${m.title || 'a moment'}`,
          detail: m.detail || 'Waiting its turn',
          status: (m.detail.startsWith('Waiting') ? 'queued' : 'running') as 'queued' | 'running',
          progress: null,
        })),
    ].filter((w) => !w.workspaceId || wsIds.includes(w.workspaceId));

    // ---------- campaigns ----------
    const campaigns = listCampaigns();
    // Rejected by the halal screen: nothing to confirm (they stay under Campaigns until deleted).
    const toConfirm = campaigns.filter((c) => c.status === 'to_confirm' && c.halalVerdict !== 'reject');
    // Running ones, the nearest deadline first.
    const active = campaigns.filter((c) => c.status === 'active').sort((a, b) => (a.deadline ?? Infinity) - (b.deadline ?? Infinity));
    const brief = (c: (typeof campaigns)[number]) => ({
      id: c.id,
      link: c.link,
      title: c.title,
      brand: c.brand,
      origin: c.origin,
      ratePer1k: c.ratePer1k,
      budgetLeft: c.budgetLeft,
      budgetTotal: c.budgetTotal,
      deadline: c.deadline,
      halalVerdict: c.halalVerdict,
      pageIds: c.pageIds,
    });

    // ---------- each page at a glance ----------
    const counts = db
      .select({ workspaceId: schema.pieces.workspaceId, stage: schema.pieces.stage, n: sql<number>`count(*)` })
      .from(schema.pieces)
      .groupBy(schema.pieces.workspaceId, schema.pieces.stage)
      .all();
    const next = db
      .select({ workspaceId: schema.posts.workspaceId, at: sql<number>`min(${schema.posts.scheduledAt})` })
      .from(schema.posts)
      .where(eq(schema.posts.status, 'scheduled'))
      .groupBy(schema.posts.workspaceId)
      .all();
    const lastPosted = db
      .select({ workspaceId: schema.posts.workspaceId, at: sql<number>`max(${schema.posts.publishedAt})` })
      .from(schema.posts)
      .where(eq(schema.posts.status, 'published'))
      .groupBy(schema.posts.workspaceId)
      .all();

    const posts = todayPosts(from, to);
    return {
      from,
      to,
      workspaces: workspaces.map((w) => {
        const own = counts.filter((c) => c.workspaceId === w.id);
        return {
          id: w.id,
          name: w.name,
          color: w.color,
          kind: w.kind,
          modules: normalizeModules(w.modules),
          niche: w.niche,
          // Cards not out yet, by stage, in board order.
          stages: w.stages.filter((s) => s.id !== 'posted').map((s) => ({ ...s, count: own.find((c) => c.stage === s.id)?.n ?? 0 })),
          nextPostAt: next.find((n) => n.workspaceId === w.id)?.at ?? null,
          lastPostedAt: lastPosted.find((n) => n.workspaceId === w.id)?.at ?? null,
        };
      }),
      review,
      posts: posts.filter((p) => p.scheduledAt >= from && p.scheduledAt < to),
      attention: posts.filter((p) => p.status === 'failed' || p.status === 'missed').sort((a, b) => b.scheduledAt - a.scheduledAt),
      work,
      campaigns: {
        toConfirm: toConfirm.map(brief),
        active: active.map((c) => {
          const r = campaignResults(c.id);
          return { ...brief(c), earned: r.earned, estimated: r.estimated, posted: r.posted, budgetLow: r.budgetLow, accepting: c.accepting };
        }),
      },
      // Posted clips to submit on Content Rewards (the campaign page opens in the signed-in window on the computer).
      submissions: listSubmissions({ statuses: ['to_submit'] }).filter((s) => wsIds.includes(s.workspaceId)),
      desktop: desktopAvailable(),
      // Each page's latest research brief from the last day and a half.
      briefs: workspaces
        .filter((w) => normalizeModules(w.modules).includes('research'))
        .flatMap((w) => {
          const b = latestBriefs(w.id).done;
          return b?.body && b.finishedAt && b.finishedAt > from - 36 * 3600_000
            ? [{ id: b.id, workspaceId: w.id, day: b.day, headline: b.body.headline, ideas: b.body.ideas.length, patterns: b.body.patterns.slice(0, 2).map((p) => p.pattern) }]
            : [];
        }),
      usage: getSetting('claudeUsage') ?? null,
      // The most recent finished weekly reviews, newest first, so their suggestions aren't missed.
      reviews: db
        .select({ id: schema.reviews.id, workspaceId: schema.reviews.workspaceId, finishedAt: schema.reviews.finishedAt })
        .from(schema.reviews)
        .where(eq(schema.reviews.status, 'done'))
        .orderBy(desc(schema.reviews.finishedAt))
        .limit(3)
        .all()
        .filter((r) => r.finishedAt && r.finishedAt > from - 7 * DAY),
    };
  });
}
