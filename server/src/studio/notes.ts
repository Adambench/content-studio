// The creator's comments pinned to moments of a finished video (shared/notes.ts), and what Claude needs to fix each
// one: what is said and shown there, and which clip of the edit it falls in.
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { clipAt, normalizeEdit, timelineWords, type EditSpec } from '../../../shared/edit';
import { NOTE_MAX, type NoteStatus, type VideoNote } from '../../../shared/notes';
import { reviewState, type ReviewState } from '../../../shared/review';
import { FIXING_STAGE, REVIEW_STAGE } from '../../../shared/types';
import { db, newId, now, schema } from '../db';
import { emit } from '../lib/events';
import { badRequest, notFound } from '../lib/http';
import { formatTime, mediaPath } from '../services/media';
import { getPiece, getWorkspace } from '../services/pieces';
import { carouselOfSlide, currentCarousel, currentCarousels } from './carousel';
import { findEditForPiece, specMedia, specTranscripts } from './edits';
import { lessonsText } from '../knowledge/lessons';

type Row = typeof schema.videoNotes.$inferSelect;
const round = (v: number) => Math.round(v * 10) / 10;

const toNote = (r: Row): VideoNote => ({
  id: r.id,
  pieceId: r.pieceId,
  mediaId: r.mediaId,
  version: r.version,
  at: r.at,
  end: r.end,
  text: r.text,
  status: r.status,
  reply: r.reply,
  lessonId: r.lessonId,
  createdAt: r.createdAt,
  resolvedAt: r.resolvedAt,
});

const announce = (r: Pick<Row, 'workspaceId' | 'pieceId' | 'id'>) => emit({ type: 'changed', entity: 'notes', workspaceId: r.workspaceId, pieceId: r.pieceId, id: r.id });

export function listNotes(pieceId: string) {
  return db.select().from(schema.videoNotes).where(eq(schema.videoNotes.pieceId, pieceId)).orderBy(asc(schema.videoNotes.at), asc(schema.videoNotes.createdAt)).all().map(toNote);
}

export function getNote(id: string) {
  const row = db.select().from(schema.videoNotes).where(eq(schema.videoNotes.id, id)).get();
  if (!row) throw notFound('Comment not found');
  return row;
}

/** A comment at `at` (to `end` for a stretch) on one of the piece's renders, the one being watched. */
export function addNote(pieceId: string, body: { mediaId?: string | null; at: number; end?: number | null; text: string }) {
  const piece = getPiece(pieceId);
  const text = body.text.trim().slice(0, NOTE_MAX);
  if (!text) throw badRequest('Write what to change.');
  let version: number | null = null;
  let length = Infinity;
  if (body.mediaId) {
    const m = db.select().from(schema.media).where(and(eq(schema.media.id, body.mediaId), eq(schema.media.pieceId, pieceId))).get();
    if (!m || m.source !== 'render') throw badRequest('That isn’t one of this video’s renders.');
    // A carousel's slide: `at` is the slide's index in its version.
    const slide = m.kind === 'image' ? carouselOfSlide(pieceId, m.id) : null;
    version = slide ? slide.number : (db.select({ n: schema.renders.versionNumber }).from(schema.renders).where(eq(schema.renders.mediaId, m.id)).get()?.n ?? null);
    if (slide) length = slide.slides - 1;
    if (m.durationMs) length = m.durationMs / 1000;
  }
  const at = round(Math.max(0, Math.min(body.at, length)));
  const end = body.end != null && body.end > at + 0.2 ? round(Math.min(body.end, length)) : null;
  const row = db
    .insert(schema.videoNotes)
    .values({ id: newId(), workspaceId: piece.workspaceId, pieceId, mediaId: body.mediaId ?? null, version, at, end, text })
    .returning()
    .get();
  announce(row);
  followComments(pieceId);
  return toNote(row);
}

/** The creator's changes (the words, closing or reopening it) or Claude's (`fixed` with what it changed). */
export function updateNote(id: string, patch: { text?: string; status?: NoteStatus; reply?: string }) {
  const row = getNote(id);
  const text = patch.text?.trim().slice(0, NOTE_MAX);
  if (patch.text !== undefined && !text) throw badRequest('Write what to change.');
  const set: Partial<Row> = {};
  if (text) set.text = text;
  if (patch.reply !== undefined) set.reply = patch.reply.trim().slice(0, NOTE_MAX);
  if (patch.status && patch.status !== row.status) {
    set.status = patch.status;
    set.resolvedAt = patch.status === 'open' ? null : Date.now();
    // Reopened: Claude's last answer stays until it answers again.
  }
  if (!Object.keys(set).length) return toNote(row);
  const next = db.update(schema.videoNotes).set(set).where(eq(schema.videoNotes.id, id)).returning().get();
  announce(next);
  if (set.status) followComments(row.pieceId);
  return toNote(next);
}

export function deleteNote(id: string) {
  const row = getNote(id);
  db.delete(schema.videoNotes).where(eq(schema.videoNotes.id, id)).run();
  announce(row);
  followComments(row.pieceId);
}

/**
 * Review holds only what I haven't watched (shared/types.ts FIXING_STAGE): a card there with a comment open goes to
 * With Claude, and comes back once none is open, nothing is being made or rendered for it and its newest render shows
 * the edit as it is now (Claude's fix, not the version I commented on). Pages without both columns keep their cards
 * where they are. Returns where it is now.
 */
export function followComments(pieceId: string) {
  const piece = db.select({ stage: schema.pieces.stage, workspaceId: schema.pieces.workspaceId }).from(schema.pieces).where(eq(schema.pieces.id, pieceId)).get();
  if (!piece || (piece.stage !== REVIEW_STAGE && piece.stage !== FIXING_STAGE)) return piece?.stage ?? null;
  const stages = getWorkspace(piece.workspaceId).stages.map((s) => s.id);
  if (!stages.includes(REVIEW_STAGE) || !stages.includes(FIXING_STAGE)) return piece.stage;
  const open = db.select({ id: schema.videoNotes.id }).from(schema.videoNotes).where(and(eq(schema.videoNotes.pieceId, pieceId), eq(schema.videoNotes.status, 'open'))).get();
  let stage = piece.stage;
  if (piece.stage === REVIEW_STAGE && open) stage = FIXING_STAGE;
  else if (piece.stage === FIXING_STAGE && !open) {
    const rendering = db.select({ id: schema.renders.id }).from(schema.renders).where(and(eq(schema.renders.pieceId, pieceId), inArray(schema.renders.status, ['queued', 'running']), eq(schema.renders.older, false))).get();
    const making = db.select({ id: schema.moments.id }).from(schema.moments).where(and(eq(schema.moments.pieceId, pieceId), eq(schema.moments.status, 'making'))).get();
    const head = findEditForPiece(pieceId)?.headVersionId;
    const shown = db
      .select({ versionId: schema.renders.versionId })
      .from(schema.renders)
      .where(and(eq(schema.renders.pieceId, pieceId), eq(schema.renders.status, 'done')))
      .orderBy(desc(schema.renders.createdAt))
      .get()?.versionId;
    if (!rendering && !making && (!head || shown === head)) stage = REVIEW_STAGE;
  }
  if (stage === piece.stage) return stage;
  db.update(schema.pieces).set({ stage, updatedAt: now() }).where(eq(schema.pieces.id, pieceId)).run();
  emit({ type: 'changed', entity: 'pieces', workspaceId: piece.workspaceId, id: pieceId });
  return stage;
}

/**
 * The newest finished video of a piece (what "looks good" is said about); for a carousel, its newest version's first
 * slide (each version's slides are new files, so a new version asks for another look).
 */
export function latestRenderId(pieceId: string) {
  const slides = currentCarousel(pieceId);
  if (slides) return slides.mediaIds[0] ?? null;
  return (
    db
      .select({ id: schema.media.id })
      .from(schema.media)
      .where(and(eq(schema.media.pieceId, pieceId), eq(schema.media.source, 'render'), eq(schema.media.kind, 'video')))
      .orderBy(desc(schema.media.createdAt))
      .get()?.id ?? null
  );
}

/** Each piece's review state (shared/review.ts) and open comments, for the board and Claude's get_board. */
export function reviewStates(pieces: Pick<typeof schema.pieces.$inferSelect, 'id' | 'stage' | 'reviewedMediaId'>[]) {
  const ids = pieces.map((p) => p.id);
  const out = new Map<string, { state: ReviewState | null; open: number }>();
  if (!ids.length) return out;
  const counts = new Map(
    db
      .select({ pieceId: schema.videoNotes.pieceId, open: sql<number>`sum(${schema.videoNotes.status} = 'open')`, all: sql<number>`count(*)` })
      .from(schema.videoNotes)
      .where(inArray(schema.videoNotes.pieceId, ids))
      .groupBy(schema.videoNotes.pieceId)
      .all()
      .map((r) => [r.pieceId, { open: Number(r.open), all: Number(r.all) }]),
  );
  const newest = new Map<string, string>();
  for (const m of db
    .select({ id: schema.media.id, pieceId: schema.media.pieceId })
    .from(schema.media)
    .where(and(inArray(schema.media.pieceId, ids), eq(schema.media.source, 'render'), eq(schema.media.kind, 'video')))
    .orderBy(asc(schema.media.createdAt))
    .all())
    if (m.pieceId) newest.set(m.pieceId, m.id);
  for (const [pieceId, c] of currentCarousels(ids)) if (c.mediaIds[0]) newest.set(pieceId, c.mediaIds[0]);
  const gone = new Set(
    db
      .select({ pieceId: schema.posts.pieceId })
      .from(schema.posts)
      .where(and(inArray(schema.posts.pieceId, ids), inArray(schema.posts.status, ['scheduled', 'publishing', 'published'])))
      .all()
      .map((r) => r.pieceId),
  );
  for (const p of pieces) {
    const c = counts.get(p.id) ?? { open: 0, all: 0 };
    const state = reviewState({ renderId: newest.get(p.id) ?? null, reviewedMediaId: p.reviewedMediaId, open: c.open, comments: c.all, out: gone.has(p.id) || p.stage === 'posted' });
    out.set(p.id, { state, open: c.open });
  }
  return out;
}

/**
 * The creator watched the newest render and it's fine (shared/review.ts): Claude's fixes there are closed with it.
 * Not while a comment is open. `good: false` takes it back.
 */
export function markReviewed(pieceId: string, good: boolean) {
  const piece = getPiece(pieceId);
  const renderId = good ? latestRenderId(pieceId) : null;
  if (good) {
    if (!renderId) throw badRequest('There’s no finished video to watch yet.');
    if (listNotes(pieceId).some((n) => n.status === 'open')) throw badRequest('Close or delete the open comments first.');
    const fixed = db
      .update(schema.videoNotes)
      .set({ status: 'done', resolvedAt: Date.now() })
      .where(and(eq(schema.videoNotes.pieceId, pieceId), eq(schema.videoNotes.status, 'fixed')))
      .returning({ id: schema.videoNotes.id })
      .all();
    if (fixed.length) announce({ workspaceId: piece.workspaceId, pieceId, id: fixed[0].id });
  }
  db.update(schema.pieces).set({ reviewedMediaId: renderId }).where(eq(schema.pieces.id, pieceId)).run();
  emit({ type: 'changed', entity: 'pieces', workspaceId: piece.workspaceId, id: pieceId });
  return { reviewedMediaId: renderId };
}

const span = (a: number, b: number | null) => (b == null ? formatTime(a) : `${formatTime(a)}–${formatTime(b)}`);
const secs = (a: number, b: number | null) => (b == null ? `${a.toFixed(1)} s` : `${a.toFixed(1)}–${b.toFixed(1)} s`);

/** What sits under a comment on the edit version its render shows: the words, the clip and its source time, what's on screen. */
async function context(spec: EditSpec, at: number, end: number | null) {
  const from = at - (end == null ? 1.5 : 0.3);
  const to = (end ?? at) + (end == null ? 1.5 : 0.3);
  const words = timelineWords(spec, await specTranscripts(spec, specMedia(spec)))
    .filter((w) => w.end > from && w.start < to)
    .map((w) => w.text)
    .join(' ');
  const lines: string[] = [];
  if (words) lines.push(`said around it: “${words}”`);
  const clips = new Map<number, string>();
  for (const t of end == null ? [at] : [at, (at + end) / 2, end - 0.05]) {
    const c = clipAt(spec, t);
    if (!c || clips.has(c.index)) continue;
    const src = c.clip.in + (t - c.start);
    clips.set(c.index, `clip ${c.index + 1} of ${spec.clips.length} (id ${c.clip.id}, media ${c.clip.mediaId}, source ${c.clip.in.toFixed(2)}–${c.clip.out.toFixed(2)} s, here ${src.toFixed(2)} s, ${c.clip.fit})`);
  }
  if (clips.size) lines.push(`in ${[...clips.values()].join('; ')}`);
  const shown = spec.overlays
    .filter((o) => o.start < (end ?? at + 0.3) && o.end > at - 0.3)
    .map((o) => {
      const what = o.type === 'graphic' ? `graphic ${o.template} “${o.text}${o.sub ? ` / ${o.sub}` : ''}”` : o.type === 'text' ? `text “${o.text}”` : o.type;
      return `${what} (id ${o.id}, ${o.start.toFixed(1)}–${o.end.toFixed(1)} s)`;
    });
  if (shown.length) lines.push(`on screen: ${shown.join('; ')}`);
  return lines;
}

/**
 * The comments as Claude reads them (the chat's get_notes and Claude Code's `scripts/notes.ts`): each with the edit
 * version its render showed, the words, clip and overlays there, and a warning when the edit has changed since (its
 * times may have moved).
 */
export async function notesText(pieceId: string, opts: { all?: boolean; lessons?: boolean } = {}) {
  const piece = getPiece(pieceId);
  const notes = listNotes(pieceId).filter((n) => opts.all || n.status === 'open');
  if (!notes.length) return `No ${opts.all ? '' : 'open '}comments on “${piece.title}”.`;
  const edit = findEditForPiece(pieceId);
  const head = edit ? db.select({ n: schema.editVersions.number }).from(schema.editVersions).where(eq(schema.editVersions.editId, edit.id)).orderBy(desc(schema.editVersions.number)).get()?.n : undefined;
  const specs = new Map<number, EditSpec | null>();
  const specOf = (n: number | null) => {
    if (!edit || n == null) return null;
    if (!specs.has(n)) {
      const v = db.select({ spec: schema.editVersions.spec }).from(schema.editVersions).where(and(eq(schema.editVersions.editId, edit.id), eq(schema.editVersions.number, n))).get();
      specs.set(n, v ? normalizeEdit(v.spec) : null);
    }
    return specs.get(n) ?? null;
  };
  // A carousel's comments pin to a slide (`at` = its index): the slide's file, to look at.
  const carousel = currentCarousel(pieceId);
  const slideFile = (mediaId: string | null) => {
    const m = mediaId ? db.select().from(schema.media).where(eq(schema.media.id, mediaId)).get() : undefined;
    return m ? mediaPath(m) : null;
  };
  const out = [`Comments on “${piece.title}” (piece ${pieceId}${carousel ? `, carousel at v${carousel.number}: npm run edit -- carousel` : head ? `, edit at v${head}` : ''}):`];
  for (const [i, n] of notes.entries()) {
    out.push('');
    if (carousel) {
      out.push(`${i + 1}. [${n.id}] slide ${Math.round(n.at) + 1} of v${n.version ?? '?'}${n.status === 'open' ? '' : ` · ${n.status}`}: ${n.text}`);
      const file = slideFile(n.mediaId);
      if (file) out.push(`   the slide: ${file}`);
      if (n.version && carousel.number > n.version) out.push(`   the carousel changed since v${n.version}: find the slide by what it says`);
      if (n.reply) out.push(`   last answer: ${n.reply}`);
      if (n.lessonId) out.push(`   taught the lesson ${n.lessonId}`);
      continue;
    }
    out.push(`${i + 1}. [${n.id}] ${span(n.at, n.end)} (${secs(n.at, n.end)}) on the render of v${n.version ?? '?'}${n.status === 'open' ? '' : ` · ${n.status}`}: ${n.text}`);
    const spec = specOf(n.version);
    if (spec) for (const l of await context(spec, n.at, n.end)) out.push(`   ${l}`);
    if (head && n.version && head > n.version) out.push(`   the edit changed since v${n.version}: find the spot by its words, not its time`);
    if (n.reply) out.push(`   last answer: ${n.reply}`);
    if (n.lessonId) out.push(`   taught the lesson ${n.lessonId}`);
  }
  if (opts.lessons !== false) out.push('', LESSON_HOWTO, '', lessonsText(piece.workspaceId, { ids: true }) || 'No lessons yet: every comment fixed starts one.');
  return out.join('\n');
}

/** How a fixed comment becomes a lesson, for the chat's get_notes and Claude Code's notes script. */
export const LESSON_HOWTO =
  'Every comment is also a lesson: after fixing it, record the general rule behind it, the thing to always or never do in ANY video so the creator never has to say it again (not the fix for this one: "Never end a clip on an unfinished sentence; extend to the end of the story or cut back to the last finished one", not "removed \'there\'s also like\'"). When it repeats a lesson below, pass that lesson\'s id (and sharper words if this comment adds something). When the mistake came from how the app makes videos (the clip picker, the clip maker, the framing, a template), say so: that code should change too.';

/** Every piece with open comments, newest comment first (for Claude Code: "fix my comments"). */
export function piecesWithOpenNotes() {
  const rows = db
    .select({ pieceId: schema.videoNotes.pieceId, title: schema.pieces.title, workspaceId: schema.videoNotes.workspaceId, createdAt: schema.videoNotes.createdAt })
    .from(schema.videoNotes)
    .innerJoin(schema.pieces, eq(schema.pieces.id, schema.videoNotes.pieceId))
    .where(eq(schema.videoNotes.status, 'open'))
    .orderBy(desc(schema.videoNotes.createdAt))
    .all();
  const seen = new Map<string, { pieceId: string; title: string; workspaceId: string; open: number }>();
  for (const r of rows) {
    const p = seen.get(r.pieceId) ?? { pieceId: r.pieceId, title: r.title, workspaceId: r.workspaceId, open: 0 };
    p.open++;
    seen.set(r.pieceId, p);
  }
  return [...seen.values()];
}
