import { and, asc, desc, eq, gte, inArray, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import { copyFromDraft, POSTING, postProblems, upcomingSlotTimes, type PostFormat, type PostOptions, type PostProblem } from '../../../shared/publish';
import { normalizeDraft } from '../../../shared/types';
import { db, newId, now, schema } from '../db';
import { emit } from '../lib/events';
import { badRequest, HttpError, notFound } from '../lib/http';
import { getPiece, getWorkspace } from '../services/pieces';
import { episodeOrderWarning } from '../ideas/ideas';
import { accountLabel, publicAccount } from './accounts';
import type { AccountRow, PostRow } from './platforms';
import { publicUrl } from './setup';

export const copySchema = z.object({ caption: z.string().max(10_000), title: z.string().max(500), tags: z.string().max(2000) });
export const optionsSchema = z
  .object({
    tiktokPrivacy: z.enum(['PUBLIC_TO_EVERYONE', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'SELF_ONLY']).optional(),
    allowComments: z.boolean().optional(),
    allowDuet: z.boolean().optional(),
    allowStitch: z.boolean().optional(),
    discloseContent: z.boolean().optional(),
    yourBrand: z.boolean().optional(),
    brandedContent: z.boolean().optional(),
    aiGenerated: z.boolean().optional(),
    shareToFeed: z.boolean().optional(),
    youtubePrivacy: z.enum(['public', 'unlisted', 'private']).optional(),
    madeForKids: z.boolean().optional(),
    // Older apps still send TikTok's "add recommended music": accepted and dropped, it's always off.
    autoAddMusic: z.boolean().optional(),
  })
  .strict()
  .transform(({ autoAddMusic: _music, ...options }) => options);

export const scheduleSchema = z.object({
  format: z.enum(['video', 'photo']),
  mediaIds: z.array(z.string()).min(1).max(35),
  targets: z
    .array(z.object({ accountId: z.string(), copy: copySchema.optional(), options: optionsSchema.default({}) }))
    .min(1)
    .max(12),
  when: z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('now'), staggerMinutes: z.number().int().min(0).max(24 * 60).default(0) }),
    z.object({ mode: z.literal('at'), at: z.number().int(), staggerMinutes: z.number().int().min(0).max(24 * 60).default(0) }),
    // Each account's next free queue slot; `asap`: right away when a queue time just went by without a post.
    z.object({ mode: z.literal('queue'), asap: z.boolean().optional() }),
  ]),
});
export type ScheduleInput = z.infer<typeof scheduleSchema>;

export function getPost(id: string) {
  const row = db.select().from(schema.posts).where(eq(schema.posts.id, id)).get();
  if (!row) throw notFound('Post not found');
  return row;
}

export function setPost(p: Pick<PostRow, 'id' | 'workspaceId' | 'pieceId'>, values: Partial<PostRow>) {
  db.update(schema.posts).set({ ...values, updatedAt: now() }).where(eq(schema.posts.id, p.id)).run();
  emit({ type: 'changed', entity: 'posts', workspaceId: p.workspaceId, id: p.id, pieceId: p.pieceId });
}

/** Posts can be changed until they start going out, and again if they fail or miss their time. */
export const editable = (p: Pick<PostRow, 'status'>) => p.status === 'scheduled' || p.status === 'failed' || p.status === 'missed';

/** When an account's posts went out or will (the last two days on), so the queue keeps its spacing and daily cap. */
function takenTimes(accountId: string) {
  const since = now() - 2 * 24 * 3600_000;
  return db
    .select({ at: schema.posts.scheduledAt, publishedAt: schema.posts.publishedAt })
    .from(schema.posts)
    .where(and(eq(schema.posts.accountId, accountId), inArray(schema.posts.status, ['scheduled', 'publishing', 'published']), or(gte(schema.posts.scheduledAt, since), gte(schema.posts.publishedAt, since))))
    .all()
    .map((r) => r.publishedAt ?? r.at);
}

const localDate = (ms: number) => new Date(ms).toDateString();

/**
 * The account's next good time (shared/publish.ts POSTING): a queue time with room that day and no post within the
 * gap. With `asap`, a queue time that went by without a post a little while ago means now (a minute from now).
 */
export function nextFreeSlot(account: AccountRow, after: number, alsoTaken: number[] = [], opts: { asap?: boolean } = {}) {
  const taken = [...takenTimes(account.id), ...alsoTaken];
  const fits = (t: number) => taken.filter((x) => localDate(x) === localDate(t)).length < POSTING.perDay && !taken.some((x) => Math.abs(x - t) < POSTING.gapMs);
  if (opts.asap) {
    const soon = after + 60_000;
    const missed = upcomingSlotTimes(account.slots, after - POSTING.lateMs, 1).some((t) => t <= after && localDate(t) === localDate(after));
    if (missed && fits(soon)) return soon;
  }
  return upcomingSlotTimes(account.slots, after).find(fits) ?? null;
}

/**
 * Work out each post's time and what could go wrong, without saving anything. The schedule dialog shows this as
 * you change it; creating posts runs the same plan and refuses if anything is an error.
 */
export function planPosts(pieceId: string, input: ScheduleInput) {
  const piece = getPiece(pieceId);
  const branch = piece.activeBranchId ? db.select().from(schema.branches).where(eq(schema.branches.id, piece.activeBranchId)).get() : undefined;
  const draft = normalizeDraft(branch?.working);
  const media = db.select().from(schema.media).where(inArray(schema.media.id, input.mediaIds)).all();
  const byId = new Map(media.map((m) => [m.id, m]));
  const ordered = input.mediaIds.map((id) => byId.get(id)).filter((m) => !!m && m.workspaceId === piece.workspaceId);
  if (ordered.length !== input.mediaIds.length) throw badRequest('Some of those files aren’t in this workspace’s library.');

  const accountRows = db.select().from(schema.accounts).where(inArray(schema.accounts.id, input.targets.map((t) => t.accountId))).all();
  const queued: Record<string, number[]> = {};
  const base = input.when.mode === 'at' ? Math.max(input.when.at, now()) : now();

  const targets = input.targets.map((t, i) => {
    const account = accountRows.find((a) => a.id === t.accountId && a.workspaceId === piece.workspaceId);
    if (!account) throw badRequest('That account isn’t connected to this workspace.');
    const problems: PostProblem[] = [];
    let at: number | null;
    if (input.when.mode === 'queue') {
      at = nextFreeSlot(account, now(), queued[account.id], { asap: input.when.asap });
      if (at === null) problems.push({ level: 'error', message: `${accountLabel(account)} has no free queue times — set them on the Accounts page.` });
      else (queued[account.id] ??= []).push(at);
    } else at = base + i * input.when.staggerMinutes * 60_000;
    if (account.status === 'reconnect') problems.push({ level: 'error', message: `Reconnect ${accountLabel(account)} first (Accounts page).` });
    // A series goes out in order.
    const order = episodeOrderWarning(pieceId, account.platform, at);
    if (order) problems.push({ level: 'warning', message: order });
    const copy = t.copy ?? copyFromDraft(account.platform, draft, input.format);
    problems.push(
      ...postProblems({
        platform: account.platform,
        format: input.format,
        copy,
        options: t.options,
        media: ordered.map((m) => m!),
        tiktokMode: account.settings.tiktokMode ?? 'inbox',
        hasPublicUrl: !!publicUrl(),
      }),
    );
    return { accountId: account.id, platform: account.platform, account, scheduledAt: at, copy, options: t.options as PostOptions, problems };
  });
  return { piece, targets };
}

/** Schedule a piece to one or more accounts. Only ever called from the user's click — Claude has no way in. */
export function createPosts(pieceId: string, input: ScheduleInput) {
  const { piece, targets } = planPosts(pieceId, input);
  const problem = targets.flatMap((t) => t.problems).find((p) => p.level === 'error');
  if (problem) throw badRequest(problem.message);
  const groupId = newId();
  const rows = targets.map((t) => ({
    id: newId(),
    workspaceId: piece.workspaceId,
    pieceId,
    accountId: t.accountId,
    platform: t.platform,
    accountLabel: accountLabel(t.account),
    groupId,
    format: input.format as PostFormat,
    mediaIds: input.mediaIds,
    copy: t.copy,
    options: t.options,
    scheduledAt: t.scheduledAt!,
  }));
  db.insert(schema.posts).values(rows).run();
  advanceStage(pieceId, 'scheduled');
  emit({ type: 'changed', entity: 'posts', workspaceId: piece.workspaceId, pieceId });
  return rows.map((r) => r.id);
}

export const updateSchema = z.object({
  scheduledAt: z.number().int().optional(),
  copy: copySchema.optional(),
  options: optionsSchema.optional(),
  mediaIds: z.array(z.string()).min(1).max(35).optional(),
});

export function updatePost(id: string, patch: z.infer<typeof updateSchema>) {
  const post = getPost(id);
  if (!editable(post)) throw new HttpError(409, post.status === 'publishing' ? 'It’s being posted right now.' : 'It’s already posted.');
  const account = post.accountId ? db.select().from(schema.accounts).where(eq(schema.accounts.id, post.accountId)).get() : undefined;
  const next = { copy: patch.copy ?? post.copy, options: patch.options ?? post.options, mediaIds: patch.mediaIds ?? post.mediaIds };
  if (account && (patch.copy || patch.options || patch.mediaIds)) {
    const media = db.select().from(schema.media).where(inArray(schema.media.id, next.mediaIds)).all();
    if (media.length !== next.mediaIds.length || media.some((m) => m.workspaceId !== post.workspaceId)) throw badRequest('Some of those files aren’t in this workspace’s library.');
    const error = postProblems({ platform: post.platform, format: post.format, copy: next.copy, options: next.options, media, tiktokMode: account.settings.tiktokMode ?? 'inbox', hasPublicUrl: !!publicUrl() }).find((p) => p.level === 'error');
    if (error) throw badRequest(error.message);
  }
  const contentChanged = !!(patch.copy || patch.options || patch.mediaIds);
  setPost(post, {
    ...next,
    ...(patch.scheduledAt !== undefined && { scheduledAt: Math.max(patch.scheduledAt, now()), status: 'scheduled', error: null, stage: '' }),
    // A half-finished upload of the old content must not be resumed with the new one.
    ...(contentChanged && { remote: {} }),
  });
  if (patch.scheduledAt !== undefined) advanceStage(post.pieceId, 'scheduled');
  return getPost(id);
}

/** Post it at the next scheduler tick: "Post now", or "Try again" after a failure. */
export function postNow(id: string) {
  const post = getPost(id);
  if (!editable(post)) throw new HttpError(409, post.status === 'publishing' ? 'It’s being posted right now.' : 'It’s already posted.');
  if (!post.accountId) throw badRequest('Its account was disconnected. Remove this post and schedule it again.');
  setPost(post, { scheduledAt: now(), status: 'scheduled', error: null, stage: '' });
}

/** Give up on a post that's waiting to try again (its next attempt sees it's no longer going out and stops). */
export function stopPost(id: string) {
  const post = getPost(id);
  if (post.status !== 'publishing') throw new HttpError(409, 'It isn’t being posted.');
  setPost(post, { status: 'failed', error: 'You stopped it.', stage: '' });
}

export function deletePost(id: string) {
  const post = getPost(id);
  if (post.status === 'publishing') throw new HttpError(409, 'It’s being posted right now — wait for it to finish.');
  db.delete(schema.posts).where(eq(schema.posts.id, id)).run();
  emit({ type: 'changed', entity: 'posts', workspaceId: post.workspaceId, id, pieceId: post.pieceId });
}

/** Move a piece's card forward to a stage (if the workspace has it), never back. */
function advanceStage(pieceId: string, stageId: 'scheduled' | 'posted') {
  const piece = getPiece(pieceId);
  const stages = getWorkspace(piece.workspaceId).stages.map((s) => s.id);
  const target = stages.indexOf(stageId);
  if (target < 0 || stages.indexOf(piece.stage) >= target) return;
  db.update(schema.pieces).set({ stage: stageId, updatedAt: now() }).where(eq(schema.pieces.id, pieceId)).run();
  emit({ type: 'changed', entity: 'pieces', workspaceId: piece.workspaceId, id: pieceId });
}

/** Once nothing for the piece is still waiting to go out, it's posted. */
export function afterPublished(pieceId: string) {
  const waiting = db
    .select({ id: schema.posts.id })
    .from(schema.posts)
    .where(and(eq(schema.posts.pieceId, pieceId), inArray(schema.posts.status, ['scheduled', 'publishing', 'failed', 'missed'])))
    .get();
  if (!waiting) advanceStage(pieceId, 'posted');
}

// ---------- reading ----------

/** Posts with what the calendar shows alongside: the piece's title and a thumbnail. */
function withContext(rows: PostRow[]) {
  if (!rows.length) return [];
  const pieceIds = [...new Set(rows.map((r) => r.pieceId))];
  const pieces = db.select({ id: schema.pieces.id, title: schema.pieces.title }).from(schema.pieces).where(inArray(schema.pieces.id, pieceIds)).all();
  const titles = new Map(pieces.map((p) => [p.id, p.title]));
  const mediaIds = [...new Set(rows.map((r) => r.mediaIds[0]).filter(Boolean))];
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
  const accountIds = [...new Set(rows.map((r) => r.accountId).filter((id): id is string => !!id))];
  const accounts = new Map(
    (accountIds.length ? db.select().from(schema.accounts).where(inArray(schema.accounts.id, accountIds)).all() : []).map((a) => {
      const { id, name, handle, avatarUrl, status, settings } = publicAccount(a);
      return [id, { id, name, handle, avatarUrl, status, tiktokMode: settings.tiktokMode ?? 'inbox' }];
    }),
  );
  return rows.map(({ remote: _remote, ...r }) => ({
    ...r,
    pieceTitle: titles.get(r.pieceId) ?? 'Untitled',
    thumbMediaId: thumbs.has(r.mediaIds[0]) ? r.mediaIds[0] : null,
    account: r.accountId ? (accounts.get(r.accountId) ?? null) : null,
  }));
}

/** Everything scheduled between two times, plus anything that needs attention whenever it was due. */
export function listPosts(workspaceId: string, from: number, to: number) {
  const rows = db
    .select()
    .from(schema.posts)
    .where(
      and(
        eq(schema.posts.workspaceId, workspaceId),
        or(and(gte(schema.posts.scheduledAt, from), lt(schema.posts.scheduledAt, to)), inArray(schema.posts.status, ['failed', 'missed', 'publishing'])),
      ),
    )
    .orderBy(asc(schema.posts.scheduledAt))
    .all();
  return withContext(rows);
}

/** Every workspace's posts due between two times, plus any that failed or missed their time (for Today). */
export function todayPosts(from: number, to: number) {
  const rows = db
    .select()
    .from(schema.posts)
    .where(or(and(gte(schema.posts.scheduledAt, from), lt(schema.posts.scheduledAt, to)), inArray(schema.posts.status, ['failed', 'missed'])))
    .orderBy(asc(schema.posts.scheduledAt))
    .all();
  return withContext(rows);
}

export function postDetail(id: string) {
  return withContext([getPost(id)])[0];
}

export function piecePosts(pieceId: string) {
  return withContext(db.select().from(schema.posts).where(eq(schema.posts.pieceId, pieceId)).orderBy(desc(schema.posts.scheduledAt)).all());
}

export function upcomingPosts(workspaceId: string, limit = 50) {
  return withContext(
    db
      .select()
      .from(schema.posts)
      .where(and(eq(schema.posts.workspaceId, workspaceId), or(gte(schema.posts.scheduledAt, now() - 7 * 24 * 60 * 60_000), inArray(schema.posts.status, ['failed', 'missed']))))
      .orderBy(asc(schema.posts.scheduledAt))
      .limit(limit)
      .all(),
  );
}
