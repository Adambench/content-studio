// Reviewing clips: every card in a page's Review column with its render, the moment it came from and the
// campaign's rules checked against it. Approving is my click: the card goes to Ready and onto the next free queue
// time of the page's accounts on the platforms the campaign pays for. Rejecting keeps the reason for the next pick.
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { checkRules, type ClipFacts, type ReviewClip } from '../../../shared/clipping';
import type { ApprovePlan } from '../../../shared/dashboard';
import { normalizeEdit } from '../../../shared/edit';
import { isActivePlatform, PUBLISH_PLATFORMS, type PublishPlatform, type TikTokPrivacy } from '../../../shared/publish';
import { FIXING_STAGE, REVIEW_STAGE, inReview, normalizeDraft, type DraftContent, type WorkspaceColor } from '../../../shared/types';
import { getCampaignRow, getSource, toMoment } from '../campaigns/campaigns';
import { db, now, schema } from '../db';
import { emit } from '../lib/events';
import { badRequest, HttpError, notFound } from '../lib/http';
import { accountLabel, listAccounts } from '../publish/accounts';
import { createPosts, deletePost, planPosts } from '../publish/posts';
import { getPiece, getWorkspace } from '../services/pieces';
import { currentCarousel } from '../studio/carousel';
import { findEditForPiece } from '../studio/edits';
import { markReviewed } from '../studio/notes';
import { discardClip } from './make';
import { updateMoment } from './moments';

/** Everything a viewer reads on a platform: caption and hashtags, or title, description and tags. */
function platformText(d: DraftContent, p: PublishPlatform) {
  return [d.platforms[p].caption, d.platforms[p].hashtags].join('\n');
}

function buildClip(piece: typeof schema.pieces.$inferSelect): ReviewClip {
  const ws = getWorkspace(piece.workspaceId);
  const branch = piece.activeBranchId ? db.select().from(schema.branches).where(eq(schema.branches.id, piece.activeBranchId)).get() : undefined;
  const draft = normalizeDraft(branch?.working);
  const [renderMedia, previousMedia] = db
    .select()
    .from(schema.media)
    .where(and(eq(schema.media.pieceId, piece.id), eq(schema.media.source, 'render'), eq(schema.media.kind, 'video')))
    .orderBy(desc(schema.media.createdAt))
    .limit(2)
    .all();
  const versionOf = (mediaId: string | undefined) => (mediaId ? (db.select({ n: schema.renders.versionNumber }).from(schema.renders).where(eq(schema.renders.mediaId, mediaId)).get()?.n ?? null) : null);
  const lastRender = db.select().from(schema.renders).where(eq(schema.renders.pieceId, piece.id)).orderBy(desc(schema.renders.createdAt)).get();
  const momentRow = db.select().from(schema.moments).where(eq(schema.moments.pieceId, piece.id)).get();
  // A clip's campaign through its moment; a filmed (UGC) video's through its own link.
  const campaignId = momentRow?.campaignId ?? piece.campaignId;
  const campaign = campaignId ? getCampaignRow(campaignId) : null;
  const source = momentRow ? getSource(momentRow.sourceId) : null;

  // Where it can go: the campaign's platforms (its "only on" rules first), else anywhere the page posts.
  const only = campaign?.checklist.flatMap((r) => (r.check?.type === 'platform' ? [String(r.check.value)] : [])) ?? [];
  const allowed = (only.length ? only : campaign?.platforms.length ? campaign.platforms : PUBLISH_PLATFORMS).filter((p): p is PublishPlatform => isActivePlatform(p));
  const accounts = listAccounts(ws.id).filter((a) => allowed.includes(a.platform));
  const targets = accounts.length ? [...new Set(accounts.map((a) => a.platform))] : allowed;
  const copy = Object.fromEntries(targets.map((p) => [p, platformText(draft, p)])) as Partial<Record<PublishPlatform, string>>;
  const edit = findEditForPiece(piece.id);
  const facts: ClipFacts = {
    seconds: renderMedia?.durationMs ? renderMedia.durationMs / 1000 : null,
    platforms: targets,
    copy,
    watermark: !!(edit && normalizeEdit(edit.working).watermark.mediaId),
  };
  // A carousel: its newest version is what's approved and posted (the first slide stands for it, like a render).
  const carousel = currentCarousel(piece.id);
  const cover = carousel ? db.select().from(schema.media).where(eq(schema.media.id, carousel.mediaIds[0])).get() : undefined;
  const rendering = lastRender && (lastRender.status !== 'done' || !renderMedia) && lastRender.status !== 'cancelled' ? { status: lastRender.status, progress: lastRender.progress, stage: lastRender.stage, error: lastRender.error } : null;
  return {
    pieceId: piece.id,
    title: piece.title,
    hook: draft.hook,
    workspace: { id: ws.id, name: ws.name, color: ws.color as WorkspaceColor },
    stage: piece.stage,
    updatedAt: piece.updatedAt,
    render: cover
      ? { mediaId: cover.id, durationMs: null, width: cover.width, height: cover.height, hasThumb: cover.hasThumb }
      : renderMedia
        ? { mediaId: renderMedia.id, durationMs: renderMedia.durationMs, width: renderMedia.width, height: renderMedia.height, hasThumb: renderMedia.hasThumb }
        : null,
    slides: carousel?.mediaIds ?? null,
    renderVersion: carousel ? carousel.number : versionOf(renderMedia?.id),
    previousRender: previousMedia ? { mediaId: previousMedia.id, hasThumb: previousMedia.hasThumb, version: versionOf(previousMedia.id) } : null,
    rendering: carousel ? null : rendering,
    moment: momentRow ? toMoment(momentRow, piece.stage) : null,
    campaign: campaign && { id: campaign.id, title: campaign.title, brand: campaign.brand, link: campaign.link, platforms: campaign.platforms },
    source: source && { id: source.id, title: source.title, link: source.link },
    copy,
    accounts: accounts.map((a) => ({ id: a.id, platform: a.platform, label: accountLabel(a), tiktokMode: a.settings.tiktokMode ?? 'inbox', reconnect: a.status === 'reconnect' })),
    missingPlatforms: allowed.filter((p) => !accounts.some((a) => a.platform === p)),
    rules: campaign ? checkRules(campaign.checklist, facts) : [],
  };
}

/** Cards waiting in Review across every page (or one), oldest first. */
export function reviewQueue(workspaceId?: string): ReviewClip[] {
  const reviewing = db
    .select()
    .from(schema.workspaces)
    .all()
    .filter((w) => w.stages.some((s) => s.id === REVIEW_STAGE) && (!workspaceId || w.id === workspaceId))
    .map((w) => w.id);
  if (!reviewing.length) return [];
  return db
    .select()
    .from(schema.pieces)
    .where(and(eq(schema.pieces.stage, REVIEW_STAGE), inArray(schema.pieces.workspaceId, reviewing)))
    .orderBy(asc(schema.pieces.updatedAt))
    .limit(100)
    .all()
    .map(buildClip);
}

export const reviewClip = (pieceId: string) => buildClip(getPiece(pieceId));

function moveTo(piece: typeof schema.pieces.$inferSelect, stage: string) {
  db.update(schema.pieces).set({ stage, updatedAt: now() }).where(eq(schema.pieces.id, piece.id)).run();
  emit({ type: 'changed', entity: 'pieces', workspaceId: piece.workspaceId, id: piece.id });
}

/** A video can be approved until it's scheduled (from Ready again, it retries the queue). */
function approvable(piece: typeof schema.pieces.$inferSelect) {
  const ids = getWorkspace(piece.workspaceId).stages.map((s) => s.id);
  const cut = ids.indexOf('scheduled');
  return piece.stage !== 'scheduled' && piece.stage !== 'posted' && (cut < 0 || ids.indexOf(piece.stage) < cut);
}

/** The schedule an approval makes: the render to each usable account, at its next good time (now when just late). */
function queueInput(clip: ReviewClip, tiktokPrivacy?: TikTokPrivacy) {
  return {
    format: clip.slides?.length ? ('photo' as const) : ('video' as const),
    mediaIds: clip.slides?.length ? clip.slides : [clip.render!.mediaId],
    targets: clip.accounts
      .filter((a) => !a.reconnect)
      .map((a) => ({ accountId: a.id, options: {} })),
    when: { mode: 'queue' as const, asap: true },
  };
}

/** Where and when approving would post it, shown on the button before the click. Saves nothing. */
export function approvePlan(pieceId: string): ApprovePlan {
  const clip = buildClip(getPiece(pieceId));
  const reconnect = clip.accounts.filter((a) => a.reconnect).map((a) => ({ accountId: a.id, platform: a.platform, label: a.label, at: null, problem: 'Reconnect it first (Accounts)' }));
  if (!clip.render || !clip.accounts.some((a) => !a.reconnect)) return { targets: reconnect, missingPlatforms: clip.missingPlatforms };
  try {
    // Who sees it on TikTok is asked on the button; any answer gives the same time.
    const plan = planPosts(pieceId, queueInput(clip, 'PUBLIC_TO_EVERYONE'));
    return {
      targets: [
        ...plan.targets.map((t) => ({ accountId: t.accountId, platform: t.platform, label: accountLabel(t.account), at: t.scheduledAt, problem: t.problems.find((p) => p.level === 'error')?.message ?? null })),
        ...reconnect,
      ],
      missingPlatforms: clip.missingPlatforms,
    };
  } catch (err) {
    return { targets: reconnect, missingPlatforms: clip.missingPlatforms, error: (err as Error).message };
  }
}

/**
 * My yes: I watched it and it's fine (Claude's fixed comments close with it), the card goes to Ready, then to each
 * of the page's accounts the clip may go to at its next good time (shared/publish.ts POSTING: right away when a
 * queue time just went by, never more than two a day). TikTok posting directly needs me to say who sees it. When
 * there's nowhere to queue it, it waits in Ready and the answer says why. `from` is where it was, for Undo.
 * `anywhere`: I dropped the card on Scheduled from any column (Posted too: it goes out again); its posts that
 * haven't gone out are replaced.
 */
export function approveClip(pieceId: string, opts: { tiktokPrivacy?: TikTokPrivacy; anywhere?: boolean } = {}) {
  const piece = getPiece(pieceId);
  if (!opts.anywhere && !approvable(piece)) throw new HttpError(409, 'It’s scheduled already.');
  const clip = buildClip(piece);
  if (!clip.render) throw badRequest(clip.rendering ? 'Wait for its render to finish.' : 'It has no video to post yet.');
  const failing = clip.rules.find((r) => r.status === 'fail');
  if (failing) throw badRequest(`Fix this first: ${failing.rule.text} (${failing.detail}).`);
  const waiting = opts.anywhere ? unsentPosts(piece.id) : [];
  const ws = getWorkspace(piece.workspaceId);
  const ready = ws.stages.some((s) => s.id === 'ready') ? 'ready' : piece.stage;
  const usable = clip.accounts.filter((a) => !a.reconnect);
  // My yes means I watched it and it's fine (shared/review.ts); refused while a comment is open.
  markReviewed(piece.id, true);
  for (const p of waiting) deletePost(p.id);
  moveTo(piece, ready);
  const from = piece.stage;
  type Scheduled = { platform: PublishPlatform; label: string; at: number };
  if (!usable.length) {
    const missing = clip.missingPlatforms.length ? ` on ${clip.missingPlatforms.join(', ')}` : '';
    return { from, scheduled: [] as Scheduled[], note: `Approved, not queued: ${ws.name} has no connected account${missing} yet.` };
  }
  // Each account on its own merits: one that can't take it (Instagram without the public address, say) doesn't hold
  // the others back.
  const input = queueInput(clip, opts.tiktokPrivacy);
  const skipped: string[] = [];
  let targets = input.targets;
  try {
    const plan = planPosts(pieceId, input);
    for (const t of plan.targets) {
      const error = t.problems.find((p) => p.level === 'error');
      if (error) skipped.push(`${accountLabel(t.account)}: ${error.message}`);
    }
    targets = input.targets.filter((t) => plan.targets.some((p) => p.accountId === t.accountId && !p.problems.some((x) => x.level === 'error')));
    if (!targets.length) return { from, scheduled: [] as Scheduled[], note: `Approved, not queued. ${skipped.join(' ')}` };
    const ids = createPosts(pieceId, { ...input, targets });
    const posts = db.select().from(schema.posts).where(inArray(schema.posts.id, ids)).all();
    return { from, scheduled: posts.map((p): Scheduled => ({ platform: p.platform, label: p.accountLabel, at: p.scheduledAt })), note: skipped.length ? `Not queued on ${skipped.join(' ')}` : null };
  } catch (err) {
    return { from, scheduled: [] as Scheduled[], note: `Approved, not queued: ${(err as Error).message}` };
  }
}

/** A piece's posts that haven't gone out (queued, failed or missed); refused while one is going out. */
function unsentPosts(pieceId: string) {
  const posts = db.select().from(schema.posts).where(eq(schema.posts.pieceId, pieceId)).all();
  if (posts.some((p) => p.status === 'publishing')) throw new HttpError(409, 'It’s being posted right now: wait for it to finish.');
  return posts.filter((p) => p.status !== 'published');
}

/**
 * I drop a card on any column (or pick one on its page) and it goes there. Onto Scheduled it's my yes (approveClip,
 * queued at the next good time); anywhere else its posts that haven't gone out are cancelled, so nothing posts behind
 * my back: Posted is one I posted myself, Review is to watch it again. What went out stays out. `from` is where it
 * was, for Undo (which moves it back the same way).
 */
export function moveCard(pieceId: string, stage: string) {
  const piece = getPiece(pieceId);
  if (!getWorkspace(piece.workspaceId).stages.some((s) => s.id === stage)) throw badRequest('That column isn’t on this page’s board.');
  const from = piece.stage;
  if (stage === from) return { from, scheduled: [], note: null, cancelled: 0 };
  if (stage === 'ready' || stage === 'scheduled') return { ...approveClip(pieceId, { anywhere: true }), cancelled: 0 };
  const cancel = unsentPosts(piece.id);
  for (const p of cancel) deletePost(p.id);
  if (stage === REVIEW_STAGE) markReviewed(piece.id, false);
  moveTo(piece, stage);
  return { from, scheduled: [], note: null, cancelled: cancel.length };
}

/** Undo my yes: its posts that haven't started going out go, it's unwatched again and back where it was. */
export function undoApprove(pieceId: string, stage: string) {
  const piece = getPiece(pieceId);
  if (!getWorkspace(piece.workspaceId).stages.some((s) => s.id === stage)) throw badRequest('That column isn’t on this page’s board.');
  const posts = db.select().from(schema.posts).where(eq(schema.posts.pieceId, pieceId)).all();
  if (posts.some((p) => p.status === 'publishing' || p.status === 'published')) throw new HttpError(409, 'It’s already going out: stop it from its post.');
  for (const p of posts) deletePost(p.id);
  markReviewed(pieceId, false);
  moveTo(getPiece(pieceId), stage);
  return { ok: true };
}

/**
 * My no, with a reason. A clip made from a moment goes (its card, its cut and renders) and the moment keeps the
 * reason, which the next pick reads; any other card in Review goes back a column.
 */
export async function rejectClip(pieceId: string, reason: string) {
  const piece = getPiece(pieceId);
  if (!inReview(piece.stage)) throw new HttpError(409, 'It isn’t waiting for review any more.');
  const m = db.select().from(schema.moments).where(eq(schema.moments.pieceId, pieceId)).get();
  if (m) {
    updateMoment(m.id, { status: 'rejected', rejectReason: reason.trim().slice(0, 300), detail: '' });
    await discardClip(pieceId);
    return { removed: true };
  }
  // The column before Review and With Claude.
  const stages = getWorkspace(piece.workspaceId).stages.map((s) => s.id).filter((id) => id !== FIXING_STAGE);
  const back = stages[Math.max(0, stages.indexOf(REVIEW_STAGE) - 1)];
  if (!back) throw notFound('No column to send it back to.');
  moveTo(piece, back);
  return { removed: false };
}
