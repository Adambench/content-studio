// A page's Ideas: the cards of its brainstorm canvas in a tree (shared/ideas.ts), the Saved pile that shares from
// the phone land in, and locking an idea in as a video. Posts saved from other people are kept as research items
// (source `saved`), so their details, words and breakdown are the Research page's; their pictures are media rows
// (source `idea`) that never wait in the Inbox.
import { rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { and, asc, eq, inArray, isNotNull, isNull, lt } from 'drizzle-orm';
import { firstLink, normalizeLabel, type IdeaKind, type IdeaNode, type IdeaPiece } from '../../../shared/ideas';
import { normalizeDraft } from '../../../shared/types';
import { config } from '../config';
import { db, newId, now, schema } from '../db';
import { pieceViews } from '../analytics/report';
import { emit } from '../lib/events';
import { badRequest, notFound } from '../lib/http';
import { enqueue } from '../jobs/queue';
import { deleteMedia, mediaPath } from '../services/media';
import { createPiece, getWorkspace } from '../services/pieces';
import { postOf } from '../research/analyse';

export type IdeaRow = typeof schema.ideas.$inferSelect;

const DAY = 86400_000;
/** Deleted cards can be brought back for this long. */
const KEEP_DELETED = 30 * DAY;

export const emitIdeas = (workspaceId: string, id?: string) => emit({ type: 'changed', entity: 'ideas', workspaceId, id });

export function getIdea(id: string) {
  const row = db.select().from(schema.ideas).where(eq(schema.ideas.id, id)).get();
  if (!row || row.deletedAt) throw notFound('That card is gone.');
  return row;
}

/** Whether a page has an Ideas canvas (personal and business pages; clipping pages find, they don't brainstorm). */
export function hasIdeas(workspaceId: string) {
  const ws = getWorkspace(workspaceId);
  return ws.kind !== 'clipping';
}

/** The page's Saved pile, made the first time it's needed. */
export function savedPile(workspaceId: string) {
  const found = db
    .select()
    .from(schema.ideas)
    .where(and(eq(schema.ideas.workspaceId, workspaceId), eq(schema.ideas.kind, 'saved'), isNull(schema.ideas.parentId)))
    .get();
  if (found) {
    if (found.deletedAt) db.update(schema.ideas).set({ deletedAt: null }).where(eq(schema.ideas.id, found.id)).run();
    return found;
  }
  const id = newId();
  // Last at the top level, whatever's added after it (the canvas keeps it at the bottom too).
  db.insert(schema.ideas).values({ id, workspaceId, kind: 'saved', title: 'Saved', position: 1e12, seenAt: now() }).run();
  return getIdea(id);
}

const children = (parentId: string) =>
  db
    .select()
    .from(schema.ideas)
    .where(and(eq(schema.ideas.parentId, parentId), isNull(schema.ideas.deletedAt)))
    .orderBy(asc(schema.ideas.position))
    .all();

const topLevel = (workspaceId: string) =>
  db
    .select()
    .from(schema.ideas)
    .where(and(eq(schema.ideas.workspaceId, workspaceId), isNull(schema.ideas.parentId), isNull(schema.ideas.deletedAt)))
    .orderBy(asc(schema.ideas.position))
    .all();

/** Every card under `row` (deleted or not), deepest last. */
function descendants(row: Pick<IdeaRow, 'id' | 'workspaceId'>) {
  const id = row.id;
  const out: IdeaRow[] = [];
  const all = db.select().from(schema.ideas).where(eq(schema.ideas.workspaceId, row.workspaceId)).all();
  const byParent = new Map<string, IdeaRow[]>();
  for (const r of all) if (r.parentId) byParent.set(r.parentId, [...(byParent.get(r.parentId) ?? []), r]);
  const walk = (pid: string) => {
    for (const c of byParent.get(pid) ?? []) {
      out.push(c);
      walk(c.id);
    }
  };
  walk(id);
  return out;
}

/**
 * Where a card goes among its siblings (leaving out `self`, the one moving): after `after`, first when `after` is null
 * (or `first`: the Saved pile, newest on top), else last.
 */
function positionFor(workspaceId: string, parentId: string | null, after: string | null | undefined, first: boolean, self?: string) {
  const sibs = (parentId ? children(parentId) : topLevel(workspaceId).filter((r) => r.kind !== 'saved')).filter((r) => r.id !== self);
  if (!sibs.length) return 0;
  if (after) {
    const i = sibs.findIndex((s) => s.id === after);
    if (i >= 0) return i === sibs.length - 1 ? sibs[i].position + 1 : (sibs[i].position + sibs[i + 1].position) / 2;
  }
  return first || after === null ? sibs[0].position - 1 : sibs[sibs.length - 1].position + 1;
}

// ---------- reading ----------

/** Stage names and numbers for the videos ideas became (on this page or another). */
function piecesOf(pieceIds: string[]) {
  const out = new Map<string, IdeaPiece>();
  if (!pieceIds.length) return out;
  const rows = db.select().from(schema.pieces).where(inArray(schema.pieces.id, pieceIds)).all();
  const stagesOf = new Map(db.select({ id: schema.workspaces.id, stages: schema.workspaces.stages }).from(schema.workspaces).all().map((w) => [w.id, w.stages]));
  const views = pieceViews(pieceIds);
  const posted = db
    .select({ pieceId: schema.posts.pieceId })
    .from(schema.posts)
    .where(and(inArray(schema.posts.pieceId, pieceIds), eq(schema.posts.status, 'published')))
    .all();
  for (const p of rows) {
    out.set(p.id, {
      id: p.id,
      workspaceId: p.workspaceId,
      title: p.title,
      stage: p.stage,
      stageName: stagesOf.get(p.workspaceId)?.find((s) => s.id === p.stage)?.name ?? p.stage,
      views: views.get(p.id) ?? null,
      postedCount: posted.filter((x) => x.pieceId === p.id).length,
    });
  }
  return out;
}

/** Cards whose post details are being fetched. */
function fetching() {
  const rows = db
    .select({ payload: schema.jobs.payload })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.type, 'ideas.details'), inArray(schema.jobs.status, ['queued', 'running'])))
    .all();
  return new Set(rows.map((r) => (r.payload as { ideaId?: string }).ideaId));
}

function toNodes(rows: IdeaRow[]): IdeaNode[] {
  const busy = rows.some((r) => r.researchItemId) ? fetching() : new Set<string | undefined>();
  const pieces = piecesOf([...new Set(rows.flatMap((r) => (r.pieceId ? [r.pieceId] : [])))]);
  const itemIds = rows.flatMap((r) => (r.researchItemId ? [r.researchItemId] : []));
  const items = new Map(itemIds.length ? db.select().from(schema.researchItems).where(inArray(schema.researchItems.id, itemIds)).all().map((i) => [i.id, i]) : []);
  const mediaIds = rows.flatMap((r) => (r.mediaId ? [r.mediaId] : []));
  const thumbs = new Map(mediaIds.length ? db.select({ id: schema.media.id, hasThumb: schema.media.hasThumb }).from(schema.media).where(inArray(schema.media.id, mediaIds)).all().map((m) => [m.id, m.hasThumb]) : []);
  return rows.map((r) => {
    const item = r.researchItemId ? items.get(r.researchItemId) : undefined;
    return {
      id: r.id,
      workspaceId: r.workspaceId,
      parentId: r.parentId,
      position: r.position,
      kind: r.kind,
      title: r.title,
      body: r.body,
      script: r.script,
      format: r.format,
      labels: r.labels,
      collapsed: r.collapsed,
      url: r.url,
      mediaId: r.mediaId,
      hasThumb: !!(r.mediaId && thumbs.get(r.mediaId)),
      pieceId: r.pieceId,
      piece: (r.pieceId && pieces.get(r.pieceId)) || null,
      post:
        item && item.platform !== 'file'
          ? {
              itemId: item.id,
              platform: item.platform,
              channel: item.channel,
              title: item.title,
              views: item.views,
              score: item.score,
              postedAt: item.postedAt,
              fetching: busy.has(r.id),
              analysisStatus: item.analysisStatus,
            }
          : null,
      by: r.by,
      assist: r.assist ?? null,
      seenAt: r.seenAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  });
}

export const toNode = (row: IdeaRow) => toNodes([row])[0];

/** Every card on the page's canvas (not deleted, nor under a deleted one). */
export function listIdeas(workspaceId: string): IdeaNode[] {
  if (!hasIdeas(workspaceId)) return [];
  savedPile(workspaceId);
  const rows = db.select().from(schema.ideas).where(eq(schema.ideas.workspaceId, workspaceId)).orderBy(asc(schema.ideas.position)).all();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const gone = (r: IdeaRow): boolean => !!r.deletedAt || (!!r.parentId && (!byId.get(r.parentId) || gone(byId.get(r.parentId)!)));
  return toNodes(rows.filter((r) => !gone(r)));
}

/** A card with what its panel shows: a saved post's words and breakdown. */
export function ideaDetail(id: string) {
  const row = getIdea(id);
  const item = row.researchItemId ? db.select().from(schema.researchItems).where(eq(schema.researchItems.id, row.researchItemId)).get() : undefined;
  return {
    ...toNode(row),
    transcript: item?.transcript ?? '',
    analysis: item?.analysis ?? null,
    analysisError: item?.analysisError ?? null,
    channelUrl: item?.channelUrl ?? null,
  };
}

// ---------- the series an idea is an episode of ----------

/** The series a card is in and its episode number (its place among the series' ideas). */
export function episodeOf(row: Pick<IdeaRow, 'id' | 'parentId' | 'kind'>) {
  if (!row.parentId || row.kind !== 'idea') return null;
  const parent = db.select().from(schema.ideas).where(eq(schema.ideas.id, row.parentId)).get();
  if (!parent || parent.kind !== 'series' || parent.deletedAt) return null;
  const episodes = children(parent.id).filter((c) => c.kind === 'idea');
  const n = episodes.findIndex((e) => e.id === row.id);
  return n < 0 ? null : { series: parent, episode: n + 1, episodes };
}

/** Board cards: the series each video is an episode of. */
export function seriesForPieces(pieceIds: string[]) {
  const out = new Map<string, { ideaId: string; seriesId: string; name: string; episode: number }>();
  if (!pieceIds.length) return out;
  const rows = db
    .select()
    .from(schema.ideas)
    .where(and(inArray(schema.ideas.pieceId, pieceIds), isNull(schema.ideas.deletedAt)))
    .all();
  for (const r of rows) {
    const ep = episodeOf(r);
    if (r.pieceId) out.set(r.pieceId, { ideaId: r.id, seriesId: ep?.series.id ?? '', name: ep?.series.title ?? '', episode: ep?.episode ?? 0 });
  }
  return out;
}

/** The Ideas card a video came from (for its page to link back), with its series. */
export function ideaForPiece(pieceId: string) {
  const row = db
    .select()
    .from(schema.ideas)
    .where(and(eq(schema.ideas.pieceId, pieceId), isNull(schema.ideas.deletedAt)))
    .get();
  if (!row) return null;
  const ep = episodeOf(row);
  return { id: row.id, workspaceId: row.workspaceId, series: ep ? { id: ep.series.id, name: ep.series.title, episode: ep.episode } : null };
}

/**
 * Scheduling an episode before the one before it: a warning (a series goes out in order). `at` is when this one
 * would go out on `platform`.
 */
export function episodeOrderWarning(pieceId: string, platform: string, at: number | null) {
  const row = db
    .select()
    .from(schema.ideas)
    .where(and(eq(schema.ideas.pieceId, pieceId), isNull(schema.ideas.deletedAt)))
    .get();
  const ep = row && episodeOf(row);
  if (!ep || ep.episode < 2 || at === null) return null;
  const earlier = ep.episodes.slice(0, ep.episode - 1).filter((e) => e.pieceId);
  for (const e of earlier.reverse()) {
    const posts = db
      .select({ at: schema.posts.scheduledAt, status: schema.posts.status })
      .from(schema.posts)
      .where(and(eq(schema.posts.pieceId, e.pieceId!), eq(schema.posts.platform, platform as never)))
      .all()
      .filter((p) => p.status !== 'failed' && p.status !== 'missed');
    const n = ep.episodes.findIndex((x) => x.id === e.id) + 1;
    if (!posts.length) return `Episode ${n} of “${ep.series.title}” isn’t scheduled on this platform yet: this one (episode ${ep.episode}) would go out first.`;
    if (posts.every((p) => p.at > at)) return `Episode ${n} of “${ep.series.title}” goes out after this one (episode ${ep.episode}).`;
  }
  return null;
}

// ---------- writing ----------

type CreateInput = {
  id?: string;
  parentId?: string | null;
  after?: string | null;
  kind?: IdeaKind;
  title?: string;
  body?: string;
  script?: string;
  labels?: string[];
  url?: string | null;
  mediaId?: string | null;
  by?: 'you' | 'claude';
};

/** A post saved by link: kept as a research item (one per page per post), its details fetched in the background. */
function researchItemFor(workspaceId: string, url: string) {
  const post = postOf(url);
  if (!post) return null;
  const existing = db
    .select()
    .from(schema.researchItems)
    .where(and(eq(schema.researchItems.workspaceId, workspaceId), eq(schema.researchItems.platform, post.platform), eq(schema.researchItems.externalId, post.id)))
    .get();
  if (existing) return existing;
  const id = newId();
  db.insert(schema.researchItems).values({ id, workspaceId, platform: post.platform, externalId: post.id, url: post.url, source: 'saved', firstSeenAt: now(), lastSeenAt: now() }).run();
  emit({ type: 'changed', entity: 'research', workspaceId });
  return db.select().from(schema.researchItems).where(eq(schema.researchItems.id, id)).get()!;
}

const cleanTitle = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 300);

export function createIdea(workspaceId: string, input: CreateInput) {
  if (!hasIdeas(workspaceId)) throw badRequest('Clipping pages don’t have Ideas.');
  const parent = input.parentId ? getIdea(input.parentId) : null;
  if (parent && parent.workspaceId !== workspaceId) throw badRequest('That card is on another page.');
  if (input.id) {
    if (!/^[0-9a-f-]{36}$/i.test(input.id)) throw badRequest('Bad id.');
    const taken = db.select({ id: schema.ideas.id }).from(schema.ideas).where(eq(schema.ideas.id, input.id)).get();
    // A retry of a create that already went through.
    if (taken) return getIdea(input.id);
  }
  const url = input.url?.trim() || null;
  const item = url ? researchItemFor(workspaceId, url) : null;
  const kind: IdeaKind = input.kind === 'saved' ? 'idea' : url ? 'link' : input.mediaId ? 'image' : (input.kind ?? 'idea');
  const id = input.id ?? newId();
  db.insert(schema.ideas)
    .values({
      id,
      workspaceId,
      parentId: parent?.id ?? null,
      position: positionFor(workspaceId, parent?.id ?? null, input.after, parent?.kind === 'saved'),
      kind,
      title: cleanTitle(input.title ?? (item?.title || '')),
      body: input.body ?? '',
      script: input.script ?? '',
      labels: [...new Set((input.labels ?? []).map(normalizeLabel).filter(Boolean))].slice(0, 12),
      url,
      researchItemId: item?.id ?? null,
      mediaId: input.mediaId ?? null,
      by: input.by ?? 'you',
    })
    .run();
  if (item) enqueue('ideas.details', { ideaId: id }, { maxAttempts: 2 });
  emitIdeas(workspaceId, id);
  return getIdea(id);
}

export type IdeaPatch = Partial<Pick<IdeaRow, 'title' | 'body' | 'script' | 'format' | 'labels' | 'collapsed' | 'position'>> & {
  kind?: 'idea' | 'series';
  parentId?: string | null;
  /** Moving: go after this sibling (or first when null), instead of a position. */
  after?: string | null;
};

export function updateIdea(id: string, patch: IdeaPatch) {
  const row = getIdea(id);
  const values: Partial<IdeaRow> = { updatedAt: now() };
  if (patch.title !== undefined) values.title = cleanTitle(patch.title);
  if (patch.body !== undefined) values.body = patch.body.slice(0, 50_000);
  if (patch.script !== undefined) values.script = patch.script.slice(0, 50_000);
  if (patch.format !== undefined) values.format = patch.format.slice(0, 5000);
  if (patch.labels !== undefined) values.labels = [...new Set(patch.labels.map(normalizeLabel).filter(Boolean))].slice(0, 12);
  if (patch.collapsed !== undefined) values.collapsed = patch.collapsed;
  if (patch.kind !== undefined) {
    if (row.kind !== 'idea' && row.kind !== 'series') throw badRequest('Only ideas can become a series.');
    values.kind = patch.kind;
  }
  const moving = patch.parentId !== undefined || patch.after !== undefined || patch.position !== undefined;
  if (moving) {
    if (row.kind === 'saved') throw badRequest('The Saved pile stays where it is.');
    const parentId = patch.parentId !== undefined ? patch.parentId : row.parentId;
    if (parentId) {
      const parent = getIdea(parentId);
      if (parent.workspaceId !== row.workspaceId) throw badRequest('That card is on another page.');
      if (parent.id === row.id || descendants(row).some((d) => d.id === parent.id)) throw badRequest('A card can’t go inside itself.');
    }
    values.parentId = parentId;
    const intoSaved = !!parentId && getIdea(parentId).kind === 'saved';
    values.position = patch.position ?? positionFor(row.workspaceId, parentId, patch.after, patch.after === null || (intoSaved && patch.after === undefined), id);
  }
  db.update(schema.ideas).set(values).where(eq(schema.ideas.id, id)).run();
  emitIdeas(row.workspaceId, id);
  return getIdea(id);
}

/** Deleting marks the card (and so everything under it); it can be brought back for a month. */
export function deleteIdea(id: string) {
  const row = getIdea(id);
  if (row.kind === 'saved') throw badRequest('The Saved pile can’t be deleted.');
  db.update(schema.ideas).set({ deletedAt: now() }).where(eq(schema.ideas.id, id)).run();
  emitIdeas(row.workspaceId, id);
}

export function restoreIdea(id: string) {
  const row = db.select().from(schema.ideas).where(eq(schema.ideas.id, id)).get();
  if (!row) throw notFound('That card is gone for good.');
  db.update(schema.ideas).set({ deletedAt: null, updatedAt: now() }).where(eq(schema.ideas.id, id)).run();
  emitIdeas(row.workspaceId, id);
  return getIdea(id);
}

/** Cards deleted over a month ago go for good, with the pictures only they used. */
export async function purgeDeletedIdeas() {
  const old = db.select().from(schema.ideas).where(and(isNotNull(schema.ideas.deletedAt), lt(schema.ideas.deletedAt, now() - KEEP_DELETED))).all();
  for (const row of old) {
    const gone = [row, ...descendants(row)];
    db.delete(schema.ideas).where(eq(schema.ideas.id, row.id)).run();
    for (const g of gone) {
      if (!g.mediaId) continue;
      const m = db.select().from(schema.media).where(eq(schema.media.id, g.mediaId)).get();
      if (m && m.source === 'idea' && !m.pieceId) await deleteMedia(m.id).catch(() => {});
    }
  }
}

/** Opening the Saved pile: what's in it now isn't "new" any more. */
export function markSeen(id: string) {
  const row = getIdea(id);
  db.update(schema.ideas).set({ seenAt: now() }).where(eq(schema.ideas.id, id)).run();
  emitIdeas(row.workspaceId, id);
}

/**
 * Something shared to the page (the phone's share sheet, the PWA's share target, Research's Save): a card in the
 * Saved pile. `id` makes it safe to send again (a retried upload), and lets a note or picture sent separately join
 * the same card, whichever arrives first.
 */
export function saveShared(workspaceId: string, input: { id?: string; text?: string; note?: string; mediaId?: string; title?: string; by?: 'you' | 'claude' }) {
  const text = input.text?.trim() ?? '';
  const note = input.note?.trim() ?? '';
  const existing = input.id ? db.select().from(schema.ideas).where(eq(schema.ideas.id, input.id)).get() : undefined;
  if (existing) {
    const values: Partial<IdeaRow> = { updatedAt: now() };
    if (note && !existing.body.includes(note)) values.body = existing.body ? `${existing.body}\n\n${note}` : note;
    if (input.mediaId && !existing.mediaId) {
      values.mediaId = input.mediaId;
      if (existing.kind === 'idea' && !existing.url) values.kind = 'image';
    }
    if (text && !existing.url && !existing.title) {
      const url = firstLink(text);
      const item = url ? researchItemFor(existing.workspaceId, url) : null;
      Object.assign(values, url ? { url, kind: 'link' as const, researchItemId: item?.id ?? null, title: cleanTitle(text.replace(url, '')) } : { title: cleanTitle(text.split('\n')[0]), body: text.split('\n').slice(1).join('\n').trim() });
      if (item) enqueue('ideas.details', { ideaId: existing.id }, { maxAttempts: 2 });
    }
    db.update(schema.ideas).set(values).where(eq(schema.ideas.id, existing.id)).run();
    emitIdeas(existing.workspaceId, existing.id);
    return getIdea(existing.id);
  }
  const pile = savedPile(workspaceId);
  const url = firstLink(text);
  const rest = url ? text.replace(url, '').trim() : text;
  return createIdea(workspaceId, {
    id: input.id,
    parentId: pile.id,
    url,
    mediaId: input.mediaId,
    // A share's text around its link is usually the post's caption or "Check out this video".
    title: input.title ?? (url ? '' : rest.split('\n')[0]),
    body: [url ? '' : rest.split('\n').slice(1).join('\n').trim(), note].filter(Boolean).join('\n\n'),
    by: input.by,
  });
}

/** A card (and what's under it) to another page's canvas: its top level, or its Saved pile for a saved post. */
export async function moveToPage(id: string, workspaceId: string) {
  const row = getIdea(id);
  if (row.kind === 'saved') throw badRequest('The Saved pile stays on its page.');
  if (row.workspaceId === workspaceId) return row;
  if (!hasIdeas(workspaceId)) throw badRequest('Clipping pages don’t have Ideas.');
  const from = row.workspaceId;
  const fromSaved = row.parentId ? getIdea(row.parentId).kind === 'saved' : false;
  const parentId = fromSaved || row.kind === 'link' || row.kind === 'image' ? savedPile(workspaceId).id : null;
  const moved = [row, ...descendants(row)].filter((m) => !m.deletedAt || m.id === row.id);
  for (const m of moved) {
    const values: Partial<IdeaRow> = { workspaceId, updatedAt: now() };
    if (m.id === row.id) {
      values.parentId = parentId;
      values.position = positionFor(workspaceId, parentId, undefined, !!parentId, m.id);
    }
    // Saved posts are kept per page: the same post on the other page (or a copy of it there).
    if (m.researchItemId && m.url) values.researchItemId = researchItemFor(workspaceId, m.url)?.id ?? null;
    if (m.mediaId) await moveMedia(m.mediaId, workspaceId);
    db.update(schema.ideas).set(values).where(eq(schema.ideas.id, m.id)).run();
    if (values.researchItemId && values.researchItemId !== m.researchItemId) enqueue('ideas.details', { ideaId: m.id }, { maxAttempts: 2 });
  }
  emitIdeas(from, id);
  emitIdeas(workspaceId, id);
  return getIdea(id);
}

/** A card's picture follows it to another page (files live in a folder per page). */
async function moveMedia(mediaId: string, workspaceId: string) {
  const m = db.select().from(schema.media).where(eq(schema.media.id, mediaId)).get();
  if (!m || m.workspaceId === workspaceId || m.source !== 'idea' || m.pieceId) return;
  await mkdir(join(config.mediaDir, workspaceId), { recursive: true });
  await rename(mediaPath(m), mediaPath({ workspaceId, fileName: m.fileName })).catch(() => {});
  db.update(schema.media).set({ workspaceId }).where(eq(schema.media.id, mediaId)).run();
}

// ---------- locking in ----------

/** The idea as the video's first notes: my notes, its sub-ideas and what inspired it. */
function startingNotes(row: IdeaRow) {
  const kids = children(row.id);
  const post = (c: IdeaRow) => {
    const item = c.researchItemId ? db.select().from(schema.researchItems).where(eq(schema.researchItems.id, c.researchItemId)).get() : undefined;
    const what = c.title || (item && [item.channel, item.title && `“${item.title.slice(0, 120)}”`].filter(Boolean).join(': ')) || 'A saved post';
    return `${what} — ${c.url}`;
  };
  const lines = (rows: IdeaRow[], depth: number): string[] =>
    rows.flatMap((c) => {
      if (c.kind === 'image') return [];
      const text = c.kind === 'link' ? post(c) : c.title || c.body.split('\n')[0];
      return [`${'  '.repeat(depth)}- ${text}`, ...(depth < 2 ? lines(children(c.id), depth + 1) : [])];
    });
  const sub = lines(kids.filter((k) => k.kind !== 'link'), 0);
  const refs = kids.filter((k) => k.kind === 'link').map((k) => `- ${post(k)}`);
  return [row.body.trim(), sub.length && `Sub-ideas:\n${sub.join('\n')}`, refs.length && `Inspired by:\n${refs.join('\n')}`].filter(Boolean).join('\n\n');
}

/**
 * Lock an idea in: a video on the board (in Idea, or Script when a script is drafted), on this page or another
 * personal or business page. The card stays on the canvas and follows the video. Claude then fills in the hooks,
 * angle and outline (`ideas.flesh`) as a new version of the draft, so mine is one click away.
 */
export function lockIn(id: string, opts: { workspaceId?: string } = {}) {
  const row = getIdea(id);
  if (row.kind !== 'idea') throw badRequest(row.kind === 'series' ? 'Lock in its episodes: each one is a video.' : 'Only ideas become videos.');
  if (row.pieceId && db.select({ id: schema.pieces.id }).from(schema.pieces).where(eq(schema.pieces.id, row.pieceId)).get()) throw badRequest('It’s already a video.');
  const target = getWorkspace(opts.workspaceId ?? row.workspaceId);
  if (target.kind === 'clipping') throw badRequest('Clipping pages make clips from campaigns, not ideas.');
  const title = row.title || row.body.split('\n')[0].slice(0, 120) || 'New idea';
  const scripted = !!row.script.trim() && target.stages.some((s) => s.id === 'script');
  const ep = episodeOf(row);
  const { pieceId } = createPiece(target.id, {
    title: title.slice(0, 200),
    stage: scripted ? 'script' : target.stages[0].id,
    tags: [...row.labels, ...(ep ? [normalizeLabel(ep.series.title)] : [])].filter(Boolean).slice(0, 20),
    content: { script: row.script, notes: startingNotes(row) },
    author: 'you',
    message: 'From Ideas',
  });
  db.update(schema.ideas).set({ pieceId, updatedAt: now() }).where(eq(schema.ideas.id, id)).run();
  // Its pictures go with it (on the same page: files live in a folder per page).
  if (target.id === row.workspaceId) {
    const pics = children(row.id).flatMap((c) => (c.kind === 'image' && c.mediaId ? [c.mediaId] : []));
    if (pics.length) {
      db.update(schema.media).set({ pieceId }).where(and(inArray(schema.media.id, pics), isNull(schema.media.pieceId))).run();
      emit({ type: 'changed', entity: 'media', workspaceId: target.id });
    }
  }
  enqueue('ideas.flesh', { ideaId: id, pieceId }, { maxAttempts: 2 });
  emitIdeas(row.workspaceId, id);
  return { pieceId, workspaceId: target.id };
}

// ---------- ideas written on the board before there was a canvas ----------

/** Cards in the board's first column that are only words (no files, edit or posts): brainstorm, not videos yet. */
function boardIdeas(workspaceId: string) {
  const ws = getWorkspace(workspaceId);
  const first = ws.stages[0]?.id;
  if (!first || ws.kind === 'clipping') return [];
  const pieces = db
    .select()
    .from(schema.pieces)
    .where(and(eq(schema.pieces.workspaceId, workspaceId), eq(schema.pieces.stage, first)))
    .orderBy(asc(schema.pieces.position))
    .all();
  if (!pieces.length) return [];
  const ids = pieces.map((p) => p.id);
  const busy = new Set([
    ...db.select({ id: schema.media.pieceId }).from(schema.media).where(inArray(schema.media.pieceId, ids)).all().map((r) => r.id),
    ...db.select({ id: schema.edits.pieceId }).from(schema.edits).where(inArray(schema.edits.pieceId, ids)).all().map((r) => r.id),
    ...db.select({ id: schema.posts.pieceId }).from(schema.posts).where(inArray(schema.posts.pieceId, ids)).all().map((r) => r.id),
    ...db.select({ id: schema.ideas.pieceId }).from(schema.ideas).where(inArray(schema.ideas.pieceId, ids)).all().map((r) => r.id),
  ]);
  return pieces.filter((p) => !busy.has(p.id));
}

export const boardIdeaCount = (workspaceId: string) => boardIdeas(workspaceId).length;

/** My click: those cards come onto the canvas (top level, in board order) and leave the board. */
export function moveBoardIdeas(workspaceId: string) {
  const pieces = boardIdeas(workspaceId);
  for (const p of pieces) {
    const branch = p.activeBranchId ? db.select().from(schema.branches).where(eq(schema.branches.id, p.activeBranchId)).get() : undefined;
    const d = normalizeDraft(branch?.working);
    createIdea(workspaceId, {
      title: p.title,
      body: [d.hook && `Hook: ${d.hook}`, d.notes].filter(Boolean).join('\n\n'),
      script: d.script,
      labels: p.tags,
    });
    db.delete(schema.pieces).where(eq(schema.pieces.id, p.id)).run();
  }
  if (pieces.length) emit({ type: 'changed', entity: 'pieces', workspaceId });
  return { moved: pieces.length };
}
