// Reviewing clips: every card in a page's Review column with its render, the moment it came from and the
// campaign's rules checked against it. Approving is my click: the card goes to Ready and onto the next free queue
// time of the page's accounts on the platforms the campaign pays for. Rejecting keeps the reason for the next pick.
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { checkRules, type ClipFacts, type ReviewClip } from '../../../shared/clipping';
import { normalizeEdit } from '../../../shared/edit';
import { PUBLISH_PLATFORMS, type PublishPlatform, type TikTokPrivacy } from '../../../shared/publish';
import { REVIEW_STAGE, normalizeDraft, type DraftContent, type WorkspaceColor } from '../../../shared/types';
import { getCampaignRow, getSource, toMoment } from '../campaigns/campaigns';
import { db, now, schema } from '../db';
import { emit } from '../lib/events';
import { badRequest, HttpError, notFound } from '../lib/http';
import { accountLabel, listAccounts } from '../publish/accounts';
import { createPosts, planPosts } from '../publish/posts';
import { getPiece, getWorkspace } from '../services/pieces';
import { findEditForPiece } from '../studio/edits';
import { discardClip } from './make';
import { updateMoment } from './moments';

/** Everything a viewer reads on a platform: caption and hashtags, or title, description and tags. */
function platformText(d: DraftContent, p: PublishPlatform) {
  if (p === 'youtube') return [d.platforms.youtube.title, d.platforms.youtube.description, d.platforms.youtube.tags].join('\n');
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
  const allowed = (only.length ? only : campaign?.platforms.length ? campaign.platforms : PUBLISH_PLATFORMS).filter((p): p is PublishPlatform => (PUBLISH_PLATFORMS as readonly string[]).includes(p));
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
  const rendering = lastRender && (lastRender.status !== 'done' || !renderMedia) && lastRender.status !== 'cancelled' ? { status: lastRender.status, progress: lastRender.progress, stage: lastRender.stage, error: lastRender.error } : null;
  return {
    pieceId: piece.id,
    title: piece.title,
    hook: draft.hook,
    workspace: { id: ws.id, name: ws.name, color: ws.color as WorkspaceColor },
    stage: piece.stage,
    updatedAt: piece.updatedAt,
    render: renderMedia ? { mediaId: renderMedia.id, durationMs: renderMedia.durationMs, width: renderMedia.width, height: renderMedia.height, hasThumb: renderMedia.hasThumb } : null,
    renderVersion: versionOf(renderMedia?.id),
    previousRender: previousMedia ? { mediaId: previousMedia.id, hasThumb: previousMedia.hasThumb, version: versionOf(previousMedia.id) } : null,
    rendering,
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

/**
 * My yes: the card goes to Ready, then to the next free queue time of each of the page's accounts the clip may go
 * to (the same as "Next queue time" in the schedule dialog). TikTok posting directly needs me to say who sees it.
 * When there's nowhere to queue it, it waits in Ready and the answer says why.
 */
export function approveClip(pieceId: string, opts: { tiktokPrivacy?: TikTokPrivacy } = {}) {
  const piece = getPiece(pieceId);
  if (piece.stage !== REVIEW_STAGE) throw new HttpError(409, 'It isn’t waiting for review any more.');
  const clip = buildClip(piece);
  if (!clip.render) throw badRequest('Wait for its render to finish.');
  const failing = clip.rules.find((r) => r.status === 'fail');
  if (failing) throw badRequest(`Fix this first: ${failing.rule.text} (${failing.detail}).`);
  const ws = getWorkspace(piece.workspaceId);
  const ready = ws.stages.some((s) => s.id === 'ready') ? 'ready' : piece.stage;
  const usable = clip.accounts.filter((a) => !a.reconnect);
  if (usable.some((a) => a.platform === 'tiktok' && a.tiktokMode === 'direct') && !opts.tiktokPrivacy) throw badRequest('Choose who can see it on TikTok.');
  // My yes means I watched it and it's fine (shared/review.ts).
  db.update(schema.pieces).set({ reviewedMediaId: clip.render.mediaId }).where(eq(schema.pieces.id, piece.id)).run();
  moveTo(piece, ready);
  if (!usable.length) {
    const missing = clip.missingPlatforms.length ? ` on ${clip.missingPlatforms.join(', ')}` : '';
    return { scheduled: [] as { platform: PublishPlatform; label: string; at: number }[], note: `Approved: it’s in Ready. ${ws.name} has no connected account${missing} to queue it on yet.` };
  }
  // Each account on its own merits: one that can't take it (Instagram without the public address, say) doesn't hold
  // the others back.
  const input = {
    format: 'video' as const,
    mediaIds: [clip.render.mediaId],
    targets: usable.map((a) => ({ accountId: a.id, options: a.platform === 'tiktok' && a.tiktokMode === 'direct' ? { tiktokPrivacy: opts.tiktokPrivacy } : {} })),
    when: { mode: 'queue' as const },
  };
  const skipped: string[] = [];
  let targets = input.targets;
  try {
    const plan = planPosts(pieceId, input);
    for (const t of plan.targets) {
      const error = t.problems.find((p) => p.level === 'error');
      if (error) skipped.push(`${accountLabel(t.account)}: ${error.message}`);
    }
    targets = input.targets.filter((t) => plan.targets.some((p) => p.accountId === t.accountId && !p.problems.some((x) => x.level === 'error')));
    if (!targets.length) return { scheduled: [], note: `Approved, but not queued. ${skipped.join(' ')} It waits in Ready.` };
    const ids = createPosts(pieceId, { ...input, targets });
    const posts = db.select().from(schema.posts).where(inArray(schema.posts.id, ids)).all();
    return { scheduled: posts.map((p) => ({ platform: p.platform, label: p.accountLabel, at: p.scheduledAt })), note: skipped.length ? `Not queued on ${skipped.join(' ')}` : null };
  } catch (err) {
    return { scheduled: [], note: `Approved, but not queued: ${(err as Error).message} It waits in Ready.` };
  }
}

/**
 * My no, with a reason. A clip made from a moment goes (its card, its cut and renders) and the moment keeps the
 * reason, which the next pick reads; any other card in Review goes back a column.
 */
export async function rejectClip(pieceId: string, reason: string) {
  const piece = getPiece(pieceId);
  if (piece.stage !== REVIEW_STAGE) throw new HttpError(409, 'It isn’t waiting for review any more.');
  const m = db.select().from(schema.moments).where(eq(schema.moments.pieceId, pieceId)).get();
  if (m) {
    updateMoment(m.id, { status: 'rejected', rejectReason: reason.trim().slice(0, 300), detail: '' });
    await discardClip(pieceId);
    return { removed: true };
  }
  const stages = getWorkspace(piece.workspaceId).stages.map((s) => s.id);
  const back = stages[Math.max(0, stages.indexOf(REVIEW_STAGE) - 1)];
  if (!back) throw notFound('No column to send it back to.');
  moveTo(piece, back);
  return { removed: false };
}
