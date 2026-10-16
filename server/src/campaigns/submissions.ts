// Submissions: once a campaign's clip is posted with a link, it waits for me to submit it on Content Rewards (the app
// never submits anything). A daily read of my submissions page there, in the desktop app's signed-in window, brings
// back each one's status, the views the campaign counted and what it earned; I can also set them by hand.
import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import {
  budgetLow,
  estimateEarnings,
  postKey,
  SUBMISSION_STATUSES,
  type CampaignResults,
  type Submission,
  type SubmissionStatus,
} from '../../../shared/campaigns';
import { REVIEW_STAGE } from '../../../shared/types';
import { parsePage } from '../claude/extract';
import { db, newId, now, schema } from '../db';
import { desktopAvailable, readPage } from '../lib/desktop';
import { emit } from '../lib/events';
import { notFound } from '../lib/http';
import { notify } from '../lib/push';
import { getSetting, setSetting } from '../lib/settings';
import { JobError } from '../jobs/queue';
import { emitCampaign, getCampaignRow, type CampaignRow } from './campaigns';

export type SubmissionRow = typeof schema.submissions.$inferSelect;

/** Where Content Rewards lists my submissions, with their status, views and earnings. */
// (CS_SUBMISSIONS_URL points it at a local stand-in for testing.)
export const SUBMISSIONS_URL = process.env.CS_SUBMISSIONS_URL || 'https://contentrewards.com/c/submissions';

export function emitSubmissions(campaignIds: Iterable<string>) {
  emit({ type: 'changed', entity: 'submissions' });
  for (const id of new Set(campaignIds)) emitCampaign(id);
}

/** The pieces made for a campaign: clips from its moments, and videos filmed for it (UGC). */
function campaignPieceIds(campaignId: string) {
  const clips = db
    .select({ pieceId: schema.moments.pieceId })
    .from(schema.moments)
    .where(and(eq(schema.moments.campaignId, campaignId), isNotNull(schema.moments.pieceId)))
    .all()
    .map((r) => r.pieceId!);
  const filmed = db.select({ id: schema.pieces.id }).from(schema.pieces).where(eq(schema.pieces.campaignId, campaignId)).all().map((r) => r.id);
  return [...new Set([...clips, ...filmed])];
}

/**
 * Make a `to_submit` row for every post of a Content Rewards campaign's clip that's out with a link and doesn't have
 * one yet, on platforms the campaign pays for. Called after a post goes out, after stats find a post's link (TikTok
 * inbox drafts), after I link a post by hand, and at start.
 */
export async function createDueSubmissions() {
  const due = and(eq(schema.posts.status, 'published'), isNotNull(schema.posts.url), eq(schema.campaigns.origin, 'content_rewards'), isNull(schema.submissions.id));
  // Clips (through their moment) and filmed videos (linked to the campaign themselves).
  const clips = db
    .select({ post: schema.posts, campaign: schema.campaigns })
    .from(schema.posts)
    .innerJoin(schema.moments, eq(schema.moments.pieceId, schema.posts.pieceId))
    .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.moments.campaignId))
    .leftJoin(schema.submissions, eq(schema.submissions.postId, schema.posts.id))
    .where(due)
    .all();
  const filmed = db
    .select({ post: schema.posts, campaign: schema.campaigns })
    .from(schema.posts)
    .innerJoin(schema.pieces, eq(schema.pieces.id, schema.posts.pieceId))
    .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.pieces.campaignId))
    .leftJoin(schema.submissions, eq(schema.submissions.postId, schema.posts.id))
    .where(due)
    .all();
  const seen = new Set<string>();
  const rows = [...clips, ...filmed]
    .filter(({ post }) => !seen.has(post.id) && !!seen.add(post.id))
    .filter(({ post, campaign }) => !campaign.platforms.length || (campaign.platforms as string[]).includes(post.platform));
  if (!rows.length) return 0;
  db.transaction((tx) => {
    for (const { post, campaign } of rows)
      tx.insert(schema.submissions)
        .values({ id: newId(), postId: post.id, campaignId: campaign.id, workspaceId: post.workspaceId, pieceId: post.pieceId, platform: post.platform, url: post.url! })
        .onConflictDoNothing()
        .run();
  });
  emitSubmissions(rows.map((r) => r.campaign.id));
  const byCampaign = new Map<string, { campaign: CampaignRow; n: number }>();
  for (const { campaign } of rows) byCampaign.set(campaign.id, { campaign, n: (byCampaign.get(campaign.id)?.n ?? 0) + 1 });
  for (const { campaign, n } of byCampaign.values())
    await notify(`Submit ${n === 1 ? 'a clip' : `${n} clips`} to Content Rewards`, `${campaign.title}: ${n === 1 ? 'it’s' : 'they’re'} posted. Submit the link${n === 1 ? '' : 's'} on the campaign’s page.`, '/today');
  return rows.length;
}

/** Make submissions in the background (never fails what called it). */
export function submissionsAfterPosting() {
  void createDueSubmissions().catch((err) => console.warn(`[submissions] ${(err as Error).message}`));
}

/** Submissions with what's shown alongside: the clip, the account, our own views and an estimate of the earnings. */
export function listSubmissions(filter: { campaignId?: string; workspaceId?: string; statuses?: SubmissionStatus[] } = {}): Submission[] {
  const rows = db
    .select({ s: schema.submissions, post: schema.posts, title: schema.pieces.title, campaign: schema.campaigns })
    .from(schema.submissions)
    .innerJoin(schema.posts, eq(schema.posts.id, schema.submissions.postId))
    .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.submissions.campaignId))
    .leftJoin(schema.pieces, eq(schema.pieces.id, schema.submissions.pieceId))
    .where(
      and(
        filter.campaignId ? eq(schema.submissions.campaignId, filter.campaignId) : undefined,
        filter.workspaceId ? eq(schema.submissions.workspaceId, filter.workspaceId) : undefined,
        filter.statuses ? inArray(schema.submissions.status, filter.statuses) : undefined,
      ),
    )
    .orderBy(desc(schema.posts.publishedAt))
    .all();
  const mediaIds = [...new Set(rows.map((r) => r.post.mediaIds[0]).filter(Boolean))];
  const thumbs = new Set(
    mediaIds.length
      ? db
          .select({ id: schema.media.id })
          .from(schema.media)
          .where(and(inArray(schema.media.id, mediaIds), eq(schema.media.hasThumb, true)))
          .all()
          .map((m) => m.id)
      : [],
  );
  return rows.map(({ s, post, title, campaign }) => {
    const postViews = post.stats?.views ?? null;
    const known = s.earnings !== null;
    const est = known || s.status === 'rejected' || s.status === 'skipped' ? { amount: null, note: null } : estimateEarnings(s.views ?? postViews, campaign.payouts.find((p) => p.platform === s.platform));
    return {
      ...s,
      pieceTitle: title ?? 'Untitled',
      accountLabel: post.accountLabel,
      publishedAt: post.publishedAt,
      thumbMediaId: thumbs.has(post.mediaIds[0]) ? post.mediaIds[0] : null,
      postViews,
      estimate: est.amount,
      estimateNote: est.note,
    };
  });
}

export function getSubmission(id: string) {
  const row = db.select().from(schema.submissions).where(eq(schema.submissions.id, id)).get();
  if (!row) throw notFound('Submission not found');
  return row;
}

/** My changes: "Done" (submitted), not submitting it, or the campaign's numbers typed in when they can't be read. */
export function updateSubmission(id: string, patch: { status?: SubmissionStatus; views?: number | null; earnings?: number | null; note?: string }) {
  const s = getSubmission(id);
  const values: Partial<SubmissionRow> = { updatedAt: now() };
  if (patch.status && patch.status !== s.status) {
    values.status = patch.status;
    if (patch.status !== 'to_submit' && patch.status !== 'skipped' && !s.submittedAt) values.submittedAt = now();
    if (patch.status === 'to_submit') values.submittedAt = null;
  }
  if (patch.views !== undefined) values.views = patch.views;
  if (patch.earnings !== undefined) {
    values.earnings = patch.earnings;
    values.earningsFrom = patch.earnings === null ? null : 'you';
  }
  if (patch.note !== undefined) values.note = patch.note.trim().slice(0, 500);
  db.update(schema.submissions).set(values).where(eq(schema.submissions.id, id)).run();
  emitSubmissions([s.campaignId]);
  return getSubmission(id);
}

// ---------- a campaign's numbers ----------

const zeroCounts = () => Object.fromEntries(SUBMISSION_STATUSES.map((s) => [s, 0])) as Record<SubmissionStatus, number>;

/** Clips made, approved and posted, their views, the campaign's verdicts and the earnings. Mechanical: no Claude. */
export function campaignResults(campaignId: string): CampaignResults {
  const c = getCampaignRow(campaignId);
  const made = db
    .select({ status: schema.moments.status, stage: schema.pieces.stage, pieceId: schema.moments.pieceId })
    .from(schema.moments)
    .leftJoin(schema.pieces, eq(schema.pieces.id, schema.moments.pieceId))
    .where(eq(schema.moments.campaignId, campaignId))
    .all();
  const clips = { made: 0, inReview: 0, approved: 0, rejected: 0 };
  for (const m of made) {
    if (m.status === 'rejected') clips.rejected++;
    if (m.status !== 'made' || !m.stage) continue;
    clips.made++;
    if (m.stage === REVIEW_STAGE) clips.inReview++;
    else if (m.stage !== 'making') clips.approved++;
  }
  const pieceIds = campaignPieceIds(campaignId);
  const filmed = db.select({ id: schema.pieces.id }).from(schema.pieces).where(eq(schema.pieces.campaignId, campaignId)).all().length;
  const posts = pieceIds.length
    ? db
        .select({ pieceId: schema.posts.pieceId, stats: schema.posts.stats, platform: schema.posts.platform })
        .from(schema.posts)
        .where(and(inArray(schema.posts.pieceId, pieceIds), eq(schema.posts.status, 'published')))
        .all()
    : [];
  const withViews = posts.filter((p) => p.stats?.views !== null && p.stats?.views !== undefined);
  const subs = listSubmissions({ campaignId });
  const counts = zeroCounts();
  for (const s of subs) counts[s.status]++;
  const decided = counts.approved + counts.paid + counts.rejected;
  const earning = subs.filter((s) => s.status === 'approved' || s.status === 'paid');
  const earned = earning.reduce((t, s) => t + (s.earnings ?? 0), 0);
  const paid = subs.filter((s) => s.status === 'paid').reduce((t, s) => t + (s.earnings ?? 0), 0);
  const estimated = subs.filter((s) => s.earnings === null).reduce((t, s) => t + (s.estimate ?? 0), 0);
  const posted = new Set(posts.map((p) => p.pieceId)).size;
  return {
    clips,
    filmed,
    posted,
    posts: posts.length,
    views: withViews.length ? withViews.reduce((t, p) => t + (p.stats!.views ?? 0), 0) : null,
    submissions: counts,
    approvalRate: decided ? (counts.approved + counts.paid) / decided : null,
    earned: Math.round(earned * 100) / 100,
    paid: Math.round(paid * 100) / 100,
    estimated: Math.round(estimated * 100) / 100,
    perClip: posted && (earned || estimated) ? Math.round(((earned + estimated) / posted) * 100) / 100 : null,
    budgetLow: c.origin === 'content_rewards' && budgetLow(c),
  };
}

/** The workspace's posts that belong to a campaign's clips (for the Analytics page's campaign filter). */
export function campaignPostIds(campaignId: string, workspaceId: string) {
  const pieceIds = campaignPieceIds(campaignId);
  if (!pieceIds.length) return new Set<string>();
  return new Set(
    db
      .select({ id: schema.posts.id })
      .from(schema.posts)
      .where(and(inArray(schema.posts.pieceId, pieceIds), eq(schema.posts.workspaceId, workspaceId)))
      .all()
      .map((p) => p.id),
  );
}

// ---------- reading Content Rewards ----------

type SiteSubmission = {
  postUrl: string;
  campaign: string;
  platform: string;
  status: 'pending' | 'approved' | 'rejected' | 'paid' | 'flagged' | 'other';
  views: number | null;
  earnings: number | null;
  reason: string;
};

const SITE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['submissions'],
  properties: {
    submissions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['postUrl', 'campaign', 'platform', 'status', 'views', 'earnings', 'reason'],
        properties: {
          postUrl: { type: 'string', description: 'The link to the submitted TikTok, Instagram or YouTube post, from the links list; empty if the page doesn’t give it' },
          campaign: { type: 'string', description: 'The campaign’s name' },
          platform: { type: 'string', description: 'tiktok, instagram, youtube or x' },
          status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'paid', 'flagged', 'other'], description: 'pending covers “in review”, “awaiting approval” and the like' },
          views: { type: ['number', 'null'], description: 'The views counted for it' },
          earnings: { type: ['number', 'null'], description: 'What it earned or is paid, in US dollars' },
          reason: { type: 'string', description: 'Why it was rejected or flagged, if the page says; else empty' },
        },
      },
    },
  },
};

export type SubmissionsSync = { at: number; ok: boolean; note: string | null; seen: number; matched: number };

const STATUS_FROM_SITE: Record<SiteSubmission['status'], SubmissionStatus | null> = { pending: 'submitted', flagged: 'submitted', approved: 'approved', rejected: 'rejected', paid: 'paid', other: null };

/**
 * The `submissions.sync` job: read my submissions page on Content Rewards in the signed-in window and update the
 * ones that match my posts by link. One page read and one Haiku call.
 */
export async function syncSubmissions() {
  const record = (s: Omit<SubmissionsSync, 'at'>) => {
    setSetting('submissionsSync', { ...s, at: now() });
    emit({ type: 'changed', entity: 'submissions' });
  };
  if (!desktopAvailable()) {
    record({ ok: false, note: 'Reading Content Rewards needs the desktop app.', seen: 0, matched: 0 });
    throw new JobError('Reading Content Rewards needs the desktop app.', { retry: false });
  }
  const page = await readPage(SUBMISSIONS_URL, { scrolls: 8 });
  if (page.loginWall) {
    record({ ok: false, note: 'Sign in to Whop under Settings → Connected sites, then check again.', seen: 0, matched: 0 });
    throw new JobError('Content Rewards asked to sign in.', { retry: false });
  }
  const out = await parsePage<{ submissions: SiteSubmission[] }>(page, {
    what: 'This is my submissions page on Content Rewards: the clips I submitted to campaigns. List every submission on it with its post link, campaign, platform, status, the views counted and the earnings.',
    schema: SITE_SCHEMA,
  });
  const mine = db.select().from(schema.submissions).where(inArray(schema.submissions.status, ['to_submit', 'submitted', 'approved', 'rejected', 'paid'])).all();
  const byKey = new Map(mine.map((s) => [postKey(s.url), s]));
  const touched = new Set<string>();
  let matched = 0;
  db.transaction((tx) => {
    for (const row of out.submissions) {
      if (!row.postUrl) continue;
      const s = byKey.get(postKey(row.postUrl));
      if (!s) continue;
      matched++;
      const status = STATUS_FROM_SITE[row.status] ?? s.status;
      const views = typeof row.views === 'number' && row.views >= 0 ? Math.round(row.views) : s.views;
      const earnings = typeof row.earnings === 'number' && row.earnings >= 0 ? row.earnings : null;
      const note = row.status === 'flagged' ? `Flagged${row.reason ? `: ${row.reason}` : ''}` : row.reason.trim() || (status === s.status ? s.note : '');
      tx.update(schema.submissions)
        .set({
          status,
          submittedAt: s.submittedAt ?? now(),
          views,
          ...(earnings !== null && { earnings, earningsFrom: 'site' as const }),
          note: note.slice(0, 500),
          checkedAt: now(),
          updatedAt: now(),
        })
        .where(eq(schema.submissions.id, s.id))
        .run();
      touched.add(s.campaignId);
    }
  });
  const unmatched = out.submissions.length - matched;
  record({
    ok: true,
    note: !out.submissions.length ? 'The page showed no submissions.' : unmatched ? `${unmatched} submission${unmatched === 1 ? '' : 's'} on Content Rewards didn’t match a post made here.` : null,
    seen: out.submissions.length,
    matched,
  });
  emitSubmissions(touched);
  emit({ type: 'job', jobType: 'submissions.sync', status: 'done', message: matched ? `Updated ${matched} submission${matched === 1 ? '' : 's'}` : 'Nothing new on Content Rewards' });
}

export function onSyncFailed(_payload: unknown, message: string) {
  const last = getSetting('submissionsSync');
  // A refusal recorded its own reason already.
  if (!last || now() - last.at > 60_000) setSetting('submissionsSync', { at: now(), ok: false, note: message.slice(0, 300), seen: 0, matched: 0 });
  emit({ type: 'changed', entity: 'submissions' });
  emit({ type: 'job', jobType: 'submissions.sync', status: 'error', message });
}

/** Submissions still waiting on the campaign: worth a daily read. */
export const awaitingCampaign = () =>
  !!db
    .select({ id: schema.submissions.id })
    .from(schema.submissions)
    .where(inArray(schema.submissions.status, ['submitted', 'approved']))
    .get();
