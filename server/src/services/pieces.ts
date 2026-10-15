import { and, asc, desc, eq, inArray, isNull, max, min, sql } from 'drizzle-orm';
import { DRAFT_FIELDS, emptyDraft, normalizeDraft, type DraftContent } from '../../../shared/types';
import { db, newId, now, schema } from '../db';
import { emit } from '../lib/events';
import { notFound } from '../lib/http';
import { enqueue } from '../jobs/queue';

export type Author = 'you' | 'claude';

/** Number of unlearned edits that triggers a voice-learning pass. */
const LEARN_THRESHOLD = 5;

export function getWorkspace(id: string) {
  const ws = db.select().from(schema.workspaces).where(eq(schema.workspaces.id, id)).get();
  if (!ws) throw notFound('Workspace not found');
  return ws;
}

export function getPiece(id: string) {
  const piece = db.select().from(schema.pieces).where(eq(schema.pieces.id, id)).get();
  if (!piece) throw notFound('Piece not found');
  return piece;
}

export function getBranch(id: string) {
  const branch = db.select().from(schema.branches).where(eq(schema.branches.id, id)).get();
  if (!branch) throw notFound('Alternative not found');
  return branch;
}

function touchPiece(pieceId: string) {
  db.update(schema.pieces).set({ updatedAt: now() }).where(eq(schema.pieces.id, pieceId)).run();
}

function announce(pieceId: string, branchId: string | null, by: Author) {
  const piece = getPiece(pieceId);
  emit({ type: 'changed', entity: 'pieces', workspaceId: piece.workspaceId, id: pieceId });
  if (branchId) emit({ type: 'branch', branchId, pieceId, by });
}

export function createPiece(
  workspaceId: string,
  input: { title: string; stage?: string; tags?: string[]; content?: Partial<DraftContent>; author?: Author; message?: string },
) {
  const ws = getWorkspace(workspaceId);
  const stage = input.stage && ws.stages.some((s) => s.id === input.stage) ? input.stage : ws.stages[0].id;
  // New cards go to the top of their column.
  const top = db
    .select({ value: min(schema.pieces.position) })
    .from(schema.pieces)
    .where(and(eq(schema.pieces.workspaceId, workspaceId), eq(schema.pieces.stage, stage)))
    .get();
  const pieceId = newId();
  const branchId = newId();
  const working = normalizeDraft({ ...emptyDraft(), ...input.content });

  db.transaction((tx) => {
    tx.insert(schema.pieces)
      .values({ id: pieceId, workspaceId, title: input.title, stage, position: (top?.value ?? 1) - 1, tags: input.tags ?? [], activeBranchId: branchId })
      .run();
    tx.insert(schema.branches).values({ id: branchId, pieceId, name: 'Main', working }).run();
  });
  if (input.content) saveVersion(branchId, { author: input.author ?? 'you', message: input.message ?? 'First draft' });
  announce(pieceId, null, input.author ?? 'you');
  return { pieceId, branchId };
}

export function listVersions(branchId: string) {
  return db
    .select({
      id: schema.versions.id,
      number: schema.versions.number,
      author: schema.versions.author,
      message: schema.versions.message,
      createdAt: schema.versions.createdAt,
    })
    .from(schema.versions)
    .where(eq(schema.versions.branchId, branchId))
    .orderBy(desc(schema.versions.number))
    .all();
}

export function getPieceDetail(pieceId: string) {
  const piece = getPiece(pieceId);
  const branches = db.select().from(schema.branches).where(eq(schema.branches.pieceId, pieceId)).orderBy(asc(schema.branches.createdAt)).all();
  const mediaRows = db
    .select()
    .from(schema.media)
    .where(and(eq(schema.media.pieceId, pieceId), isNull(schema.media.assetType)))
    .orderBy(asc(schema.media.createdAt))
    .all();
  return {
    ...piece,
    branches: branches.map((b) => ({ ...b, working: normalizeDraft(b.working), versions: listVersions(b.id) })),
    media: mediaRows,
  };
}

export function updateWorking(branchId: string, content: DraftContent, by: Author) {
  const branch = getBranch(branchId);
  db.update(schema.branches).set({ working: normalizeDraft(content), workingUpdatedAt: now() }).where(eq(schema.branches.id, branchId)).run();
  touchPiece(branch.pieceId);
  announce(branch.pieceId, branchId, by);
}

/** Snapshot a branch's working draft (optionally replacing it first) as a new version. */
export function saveVersion(branchId: string, input: { author: Author; message?: string; content?: DraftContent }) {
  const branch = getBranch(branchId);
  const content = normalizeDraft(input.content ?? branch.working);
  const head = branch.headVersionId
    ? db.select().from(schema.versions).where(eq(schema.versions.id, branch.headVersionId)).get()
    : undefined;

  if (head && JSON.stringify(normalizeDraft(head.content)) === JSON.stringify(content)) {
    if (input.content) updateWorking(branchId, content, input.author);
    return { version: head, unchanged: true };
  }

  const last = db.select({ n: max(schema.versions.number) }).from(schema.versions).where(eq(schema.versions.branchId, branchId)).get();
  const version = {
    id: newId(),
    branchId,
    pieceId: branch.pieceId,
    number: (last?.n ?? 0) + 1,
    parentId: head?.id ?? null,
    author: input.author,
    message: input.message?.trim() || (input.author === 'claude' ? 'Claude draft' : 'Saved'),
    content,
    createdAt: now(),
  };
  db.transaction((tx) => {
    tx.insert(schema.versions).values(version).run();
    tx.update(schema.branches).set({ headVersionId: version.id, working: content, workingUpdatedAt: now() }).where(eq(schema.branches.id, branchId)).run();
  });
  touchPiece(branch.pieceId);

  if (input.author === 'you' && head?.author === 'claude') recordEdits(branch.pieceId, normalizeDraft(head.content), content);
  announce(branch.pieceId, branchId, input.author);
  return { version, unchanged: false };
}

/** Remember how I rewrote Claude's text so it can learn my voice. */
function recordEdits(pieceId: string, before: DraftContent, after: DraftContent) {
  const piece = getPiece(pieceId);
  const rows = DRAFT_FIELDS.filter((f) => f.key !== 'notes')
    .map((f) => ({ field: f.key, before: f.get(before).trim(), after: f.get(after).trim() }))
    .filter((r) => r.before && r.before !== r.after)
    .map((r) => ({ id: newId(), workspaceId: piece.workspaceId, pieceId, field: r.field, before: r.before.slice(0, 4000), after: r.after.slice(0, 4000) }));
  if (!rows.length) return;
  db.insert(schema.editEvents).values(rows).run();

  const pending = db
    .select({ n: sql<number>`count(*)` })
    .from(schema.editEvents)
    .where(and(eq(schema.editEvents.workspaceId, piece.workspaceId), isNull(schema.editEvents.learnedAt)))
    .get();
  const alreadyQueued = db
    .select({ id: schema.jobs.id })
    .from(schema.jobs)
    .where(and(eq(schema.jobs.type, 'voice.learn'), inArray(schema.jobs.status, ['queued', 'running']), sql`json_extract(${schema.jobs.payload}, '$.workspaceId') = ${piece.workspaceId}`))
    .get();
  if ((pending?.n ?? 0) >= LEARN_THRESHOLD && !alreadyQueued) enqueue('voice.learn', { workspaceId: piece.workspaceId });
}

export function createBranch(
  pieceId: string,
  input: { name: string; fromBranchId?: string; fromVersionId?: string; content?: Partial<DraftContent>; author: Author; message?: string },
) {
  const piece = getPiece(pieceId);
  let base: DraftContent = emptyDraft();
  let origin = '';
  if (input.fromVersionId) {
    const v = db.select().from(schema.versions).where(eq(schema.versions.id, input.fromVersionId)).get();
    if (!v || v.pieceId !== pieceId) throw notFound('Version not found');
    base = normalizeDraft(v.content);
    origin = ` from v${v.number}`;
  } else {
    const source = input.fromBranchId ? getBranch(input.fromBranchId) : piece.activeBranchId ? getBranch(piece.activeBranchId) : undefined;
    if (source) {
      base = normalizeDraft(source.working);
      origin = ` from ${source.name}`;
    }
  }
  const content = mergeDraft(base, input.content ?? {});
  const branchId = newId();
  db.insert(schema.branches).values({ id: branchId, pieceId, name: input.name, working: content }).run();
  db.update(schema.pieces).set({ activeBranchId: branchId, updatedAt: now() }).where(eq(schema.pieces.id, pieceId)).run();
  const { version } = saveVersion(branchId, { author: input.author, message: input.message ?? `Started${origin}` });
  return { branchId, version };
}

export function restoreVersion(versionId: string) {
  const v = db.select().from(schema.versions).where(eq(schema.versions.id, versionId)).get();
  if (!v) throw notFound('Version not found');
  return saveVersion(v.branchId, { author: 'you', message: `Restored v${v.number}`, content: normalizeDraft(v.content) });
}

/** Deep-merge a partial draft (as Claude sends it) over a full one. */
export function mergeDraft(base: DraftContent, patch: Partial<DraftContent> | { platforms?: Partial<Record<string, Record<string, string>>> }): DraftContent {
  const p = patch as Partial<DraftContent>;
  const platforms = (p.platforms ?? {}) as Partial<DraftContent['platforms']>;
  return normalizeDraft({
    hook: p.hook ?? base.hook,
    script: p.script ?? base.script,
    notes: p.notes ?? base.notes,
    platforms: {
      tiktok: { ...base.platforms.tiktok, ...platforms.tiktok },
      instagram: { ...base.platforms.instagram, ...platforms.instagram },
      youtube: { ...base.platforms.youtube, ...platforms.youtube },
      x: { ...base.platforms.x, ...platforms.x },
    },
  });
}
