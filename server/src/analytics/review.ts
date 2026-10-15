import { and, desc, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import { DEFAULT_WEEKLY_REVIEW, lastReviewDue, type ReviewBody, type ReviewSlotSuggestion } from '../../../shared/analytics';
import type { QueueSlot } from '../../../shared/publish';
import { askStructured } from '../claude/oneshot';
import { resolveModel } from '../claude/options';
import { playbook } from '../claude/plugin';
import { db, newId, now, schema } from '../db';
import { emit } from '../lib/events';
import { badRequest, HttpError, notFound } from '../lib/http';
import { notify } from '../lib/push';
import { getSetting } from '../lib/settings';
import { enqueue } from '../jobs/queue';
import { accountLabel, getAccount, updateAccount } from '../publish/accounts';
import { createPiece, getWorkspace } from '../services/pieces';
import { digest } from './report';
import { syncStats } from './stats';

const DAY = 86400_000;
const PERIOD_DAYS = 7;

export type ReviewRow = typeof schema.reviews.$inferSelect;

export function getReview(id: string) {
  const row = db.select().from(schema.reviews).where(eq(schema.reviews.id, id)).get();
  if (!row) throw notFound('Review not found');
  return row;
}

export function listReviews(workspaceId: string, limit = 12) {
  return db
    .select()
    .from(schema.reviews)
    .where(eq(schema.reviews.workspaceId, workspaceId))
    .orderBy(desc(schema.reviews.createdAt))
    .limit(limit)
    .all()
    .map(({ digest: _d, voiceBefore, voiceAfter, ...r }) => ({ ...r, voiceChanged: voiceAfter !== null, voiceBefore, voiceAfter }));
}

const announce = (workspaceId: string, id?: string) => emit({ type: 'changed', entity: 'reviews', workspaceId, id });

/** Published posts with numbers since `since`: without any there's nothing to review. */
const hasResults = (workspaceId: string, since: number) =>
  !!db
    .select({ id: schema.posts.id })
    .from(schema.posts)
    .where(and(eq(schema.posts.workspaceId, workspaceId), eq(schema.posts.status, 'published'), gte(schema.posts.publishedAt, since), isNotNull(schema.posts.stats)))
    .get();

/** Start a review: by itself each week, or from "Review now". */
export function startReview(workspaceId: string, trigger: 'weekly' | 'manual') {
  getWorkspace(workspaceId);
  const running = db
    .select({ id: schema.reviews.id })
    .from(schema.reviews)
    .where(and(eq(schema.reviews.workspaceId, workspaceId), eq(schema.reviews.status, 'running')))
    .get();
  if (running) throw new HttpError(409, 'Claude is already reviewing this workspace.');
  if (!hasResults(workspaceId, now() - 90 * DAY)) throw badRequest('Nothing to review yet — once posts have gone out and their numbers are in, Claude can look at how they did.');
  const id = newId();
  db.insert(schema.reviews)
    .values({ id, workspaceId, trigger, status: 'running', periodStart: now() - PERIOD_DAYS * DAY, periodEnd: now(), model: resolveModel() })
    .run();
  enqueue('analytics.review', { reviewId: id }, { maxAttempts: 2 });
  announce(workspaceId, id);
  return getReview(id);
}

type ReviewOutput = {
  headline: string;
  summary: string;
  wins: { post: string; why: string }[];
  lessons: string[];
  ideas: { title: string; hook: string; why: string }[];
  queueChanges: { account: string; slots: { time: string; days: number[] }[]; reason: string }[];
  voiceMemory: string;
  voiceNote: string;
};

const REVIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'summary', 'wins', 'lessons', 'ideas', 'queueChanges', 'voiceMemory', 'voiceNote'],
  properties: {
    headline: { type: 'string', description: 'One sentence on how the week went, under 120 characters' },
    summary: { type: 'string', description: '3–5 short markdown bullets ("- "): the key numbers and what stood out' },
    wins: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['post', 'why'],
        properties: { post: { type: 'string', description: 'The post’s id, like P3' }, why: { type: 'string', description: 'The most likely reason it did well, in a sentence' } },
      },
    },
    lessons: { type: 'array', maxItems: 4, items: { type: 'string' }, description: 'Short, actionable takeaways for the coming week' },
    ideas: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'hook', 'why'],
        properties: {
          title: { type: 'string', description: 'Working title, under 60 characters' },
          hook: { type: 'string', description: 'The opening line, in the creator’s voice' },
          why: { type: 'string', description: 'Which result it builds on' },
        },
      },
    },
    queueChanges: {
      type: 'array',
      description: 'Only for accounts whose timing data clearly supports a change; empty otherwise',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['account', 'slots', 'reason'],
        properties: {
          account: { type: 'string', description: 'The account’s id, like A1' },
          slots: {
            type: 'array',
            minItems: 1,
            maxItems: 24,
            description: 'The account’s full new queue',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['time', 'days'],
              properties: {
                time: { type: 'string', description: 'Local time, 24-hour HH:MM' },
                days: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 6 }, description: '0 = Sunday … 6 = Saturday' },
              },
            },
          },
          reason: { type: 'string', description: 'The timing numbers behind it, in a sentence' },
        },
      },
    },
    voiceMemory: { type: 'string', description: 'The full voice memory, updated (or unchanged)' },
    voiceNote: { type: 'string', description: 'What you changed in the voice memory, in one sentence; empty if nothing' },
  },
};

function systemPrompt(ws: typeof schema.workspaces.$inferSelect) {
  return [
    // The same text every week first, so it caches.
    playbook('hooks', 'retention', 'halal'),
    `You are Claude, built into Content Studio, doing the weekly review of the creator's "${ws.name}" short-form posts (TikTok, Instagram, YouTube Shorts). The numbers are already worked out for you; your job is to read them honestly and turn them into a few concrete next steps.`,
    `Rules:
- Be specific and grounded: name posts by title and quote their numbers. Never invent numbers, posts, trends or reasons that the data doesn't support.
- Small samples are noisy. With only a handful of posts on an account, say so and keep conclusions tentative. One hit or one flop is not a pattern.
- Compare posts with "× typical" (views after 24 hours against the account's median); raw views favour older posts. Engagement, watch time and shares say whether people liked it, not just saw it.
- Wins: the 1–3 pieces that did best (a piece posted to several accounts counts once — pick its strongest post) and the most likely reason — hook, topic, format, length or timing — judging from their hook, caption and numbers.
- Lessons: up to 4 short, actionable takeaways for next week.
- Ideas: up to 3 new pieces that build on what worked, in the creator's voice.
- Queue times: suggest an account's new queue only when its timing numbers clearly support it (at least a few posts in each part of the day you compare). Keep about the same number of posts a week unless the numbers say otherwise. Otherwise leave it out. The creator applies suggestions with a click; you can't change anything yourself.
- Voice memory: return the full voice memory with what the results show works for this audience (hooks, topics, formats, lengths, caption style) folded in. Keep every existing rule unless the results clearly contradict it; mark rules that come from results with "(from results)"; stay under 350 words. If the results don't teach anything new yet, return it unchanged and leave voiceNote empty.
- Plain, friendly language; no hype.`,
    `## The brand\n${ws.description || '(no description)'}\n\n### Brand guide\n${ws.brandGuide.trim() || '(not written)'}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

const SLOT_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function cleanSlots(slots: { time: string; days: number[] }[]): QueueSlot[] | null {
  const out = slots
    .map((s) => ({ time: s.time.trim().padStart(5, '0'), days: [...new Set(s.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() }))
    .filter((s) => SLOT_TIME.test(s.time) && s.days.length)
    .sort((a, b) => a.time.localeCompare(b.time));
  return out.length && out.length <= 24 ? out : null;
}

const sameSlots = (a: QueueSlot[], b: QueueSlot[]) => JSON.stringify(cleanSlots(a)) === JSON.stringify(cleanSlots(b));

/** The `analytics.review` job. */
export async function runReview({ reviewId }: { reviewId: string }) {
  const review = db.select().from(schema.reviews).where(eq(schema.reviews.id, reviewId)).get();
  if (!review || review.status !== 'running') return;
  // Fresh numbers first (only what's due a read).
  await syncStats({ workspaceId: review.workspaceId }).catch((err) => console.warn(`[review] stats sync failed: ${(err as Error).message}`));
  const ws = getWorkspace(review.workspaceId);
  const data = digest(ws.id, PERIOD_DAYS);
  const previous = db
    .select({ body: schema.reviews.body, createdAt: schema.reviews.createdAt })
    .from(schema.reviews)
    .where(and(eq(schema.reviews.workspaceId, ws.id), eq(schema.reviews.status, 'done')))
    .orderBy(desc(schema.reviews.createdAt))
    .get();

  const prompt = [
    data.text,
    previous?.body
      ? `## Your last review (${new Date(previous.createdAt).toDateString()})\n${previous.body.headline}\nLessons: ${previous.body.lessons.map((l) => `\n- ${l}`).join('')}\nSay briefly whether this week bore them out.`
      : '',
    `## Current voice memory\n${ws.voiceMemory.trim() || '(empty)'}`,
    data.focus ? 'Review the last 7 days.' : 'Nothing was published in the last 7 days. Say so briefly, look at how the earlier posts are doing, and keep it short.',
  ]
    .filter(Boolean)
    .join('\n\n');

  const out = await askStructured<ReviewOutput>({ system: systemPrompt(ws), prompt, schema: REVIEW_SCHEMA, model: review.model ?? undefined });

  const slots: ReviewSlotSuggestion[] = [];
  for (const change of out.queueChanges ?? []) {
    const accountId = data.accountIds.get(change.account.replace(/[[\]]/g, '').trim());
    const account = accountId ? db.select().from(schema.accounts).where(eq(schema.accounts.id, accountId)).get() : undefined;
    const clean = cleanSlots(change.slots ?? []);
    if (!account || !clean || sameSlots(clean, account.slots)) continue;
    slots.push({ accountId: account.id, account: accountLabel(account), slots: clean, reason: change.reason });
  }
  const postOf = (ref: string) => data.postIds.get(ref.replace(/[[\]]/g, '').trim());
  const pieceIds = [...new Set([...data.postIds.values()].map((p) => p.pieceId))];
  const titles = new Map(
    (pieceIds.length ? db.select({ id: schema.pieces.id, title: schema.pieces.title }).from(schema.pieces).where(inArray(schema.pieces.id, pieceIds)).all() : []).map((p) => [p.id, p.title]),
  );
  const body: ReviewBody = {
    headline: out.headline.trim(),
    summary: out.summary.trim(),
    wins: (out.wins ?? []).flatMap((w) => {
      const p = postOf(w.post);
      return p ? [{ title: titles.get(p.pieceId) ?? 'A post', why: w.why, pieceId: p.pieceId, account: p.accountLabel }] : [];
    }).filter((w, i, all) => all.findIndex((x) => x.pieceId === w.pieceId) === i),
    lessons: (out.lessons ?? []).map((l) => l.trim()).filter(Boolean),
    ideas: (out.ideas ?? []).filter((i) => i.title.trim()),
    slots,
    voiceNote: '',
  };

  // Only change the voice memory if nothing else did while Claude was thinking (voice learning, an edit by hand).
  const memory = out.voiceMemory?.trim() ?? '';
  const current = getWorkspace(ws.id).voiceMemory;
  const changeVoice = !!memory && memory !== ws.voiceMemory.trim() && current === ws.voiceMemory;
  if (changeVoice) body.voiceNote = out.voiceNote.trim() || 'Updated with what the results show.';

  db.transaction((tx) => {
    if (changeVoice) tx.update(schema.workspaces).set({ voiceMemory: memory, updatedAt: now() }).where(eq(schema.workspaces.id, ws.id)).run();
    tx.update(schema.reviews)
      .set({ status: 'done', body, digest: data.text, voiceBefore: changeVoice ? ws.voiceMemory : null, voiceAfter: changeVoice ? memory : null, finishedAt: now(), error: null })
      .where(eq(schema.reviews.id, reviewId))
      .run();
  });
  if (changeVoice) emit({ type: 'changed', entity: 'workspaces', workspaceId: ws.id });
  announce(ws.id, reviewId);
  emit({ type: 'job', jobType: 'analytics.review', status: 'done', workspaceId: ws.id, message: body.headline });
  if (review.trigger === 'weekly') await notify(`Weekly review: ${ws.name}`, body.headline, `/w/${ws.id}/analytics`);
}

export function onReviewFailed({ reviewId }: { reviewId: string }, message: string) {
  const review = db.select().from(schema.reviews).where(eq(schema.reviews.id, reviewId)).get();
  if (!review) return;
  db.update(schema.reviews).set({ status: 'error', error: message, finishedAt: now() }).where(eq(schema.reviews.id, reviewId)).run();
  announce(review.workspaceId, reviewId);
  emit({ type: 'job', jobType: 'analytics.review', status: 'error', workspaceId: review.workspaceId, message });
}

/** Run each workspace's review once its weekly time comes round (or soon after, if the computer was off). */
export function checkWeeklyReviews() {
  const setting = { ...DEFAULT_WEEKLY_REVIEW, ...getSetting('weeklyReview') };
  if (!setting.enabled) return;
  const due = lastReviewDue(setting, now());
  // Days late, it's nearly time for the next one: wait for that.
  if (now() - due > 3 * DAY) return;
  for (const ws of db.select({ id: schema.workspaces.id }).from(schema.workspaces).all()) {
    const last = db.select({ at: schema.reviews.createdAt }).from(schema.reviews).where(eq(schema.reviews.workspaceId, ws.id)).orderBy(desc(schema.reviews.createdAt)).get();
    // Reviewed since (or shortly before, from "Review now") it was due.
    if (last && last.at >= due - 12 * 3600_000) continue;
    if (!hasResults(ws.id, now() - 14 * DAY)) continue;
    try {
      startReview(ws.id, 'weekly');
    } catch (err) {
      console.warn(`[review] couldn't start for ${ws.id}: ${(err as Error).message}`);
    }
  }
}

// ---------- acting on a review (each one a click) ----------

function getSuggestion<T>(list: T[] | undefined, index: number) {
  const item = list?.[index];
  if (!item) throw notFound('That suggestion isn’t in this review.');
  return item;
}

/** Use the queue times Claude suggested for an account. */
export function applySlots(reviewId: string, index: number) {
  const review = getReview(reviewId);
  const body = review.body!;
  const s = getSuggestion(body.slots, index);
  const account = getAccount(s.accountId);
  if (account.workspaceId !== review.workspaceId) throw notFound('Account not found');
  updateAccount(account.id, { slots: s.slots });
  s.appliedAt = now();
  db.update(schema.reviews).set({ body }).where(eq(schema.reviews.id, reviewId)).run();
  announce(review.workspaceId, reviewId);
  return s;
}

/** Put one of the review's ideas on the board as a new card. */
export function addIdea(reviewId: string, index: number) {
  const review = getReview(reviewId);
  const body = review.body!;
  const idea = getSuggestion(body.ideas, index);
  if (idea.pieceId && db.select({ id: schema.pieces.id }).from(schema.pieces).where(eq(schema.pieces.id, idea.pieceId)).get()) return idea;
  const { pieceId } = createPiece(review.workspaceId, {
    title: idea.title.slice(0, 120),
    content: { hook: idea.hook, notes: `From the weekly review: ${idea.why}` },
    author: 'claude',
    message: 'Idea from the weekly review',
  });
  idea.pieceId = pieceId;
  db.update(schema.reviews).set({ body }).where(eq(schema.reviews.id, reviewId)).run();
  announce(review.workspaceId, reviewId);
  return idea;
}

/** Put the voice memory back as it was before the review changed it. */
export function undoVoice(reviewId: string) {
  const review = getReview(reviewId);
  if (review.body?.voiceUndone) throw badRequest('Already undone.');
  if (review.voiceAfter === null || review.voiceBefore === null) throw badRequest('This review didn’t change the voice memory.');
  const ws = getWorkspace(review.workspaceId);
  if (ws.voiceMemory !== review.voiceAfter) throw new HttpError(409, 'The voice memory has changed since this review — edit it in Workspace settings instead.');
  db.transaction((tx) => {
    tx.update(schema.workspaces).set({ voiceMemory: review.voiceBefore!, updatedAt: now() }).where(eq(schema.workspaces.id, ws.id)).run();
    tx.update(schema.reviews).set({ body: { ...review.body!, voiceUndone: true } }).where(eq(schema.reviews.id, reviewId)).run();
  });
  emit({ type: 'changed', entity: 'workspaces', workspaceId: ws.id });
  announce(ws.id, reviewId);
}
