// Series (shared/board.ts): a page's series, each with what every episode follows and its episodes in order. An
// episode is a card with the series' id and its number, 1 to n in the order I put them.
import { and, asc, eq, inArray, isNotNull, max } from 'drizzle-orm';
import { columnOf, type Series } from '../../../shared/board';
import { db, newId, now, schema } from '../db';
import { emit } from '../lib/events';
import { badRequest, notFound } from '../lib/http';
import { createPiece, getPiece, getWorkspace } from './pieces';

type Row = typeof schema.series.$inferSelect;

export function getSeriesRow(id: string) {
  const row = db.select().from(schema.series).where(eq(schema.series.id, id)).get();
  if (!row) throw notFound('Series not found');
  return row;
}

function withEpisodes(rows: Row[]): Series[] {
  if (!rows.length) return [];
  const eps = db
    .select({ id: schema.pieces.id, title: schema.pieces.title, stage: schema.pieces.stage, seriesId: schema.pieces.seriesId, episode: schema.pieces.episode, createdAt: schema.pieces.createdAt })
    .from(schema.pieces)
    .where(inArray(schema.pieces.seriesId, rows.map((r) => r.id)))
    .orderBy(asc(schema.pieces.episode), asc(schema.pieces.createdAt))
    .all();
  return rows.map((r) => ({
    id: r.id,
    workspaceId: r.workspaceId,
    name: r.name,
    about: r.about,
    episodes: eps.filter((e) => e.seriesId === r.id).map((e) => ({ id: e.id, title: e.title, episode: e.episode ?? 0, column: columnOf(e.stage) })),
  }));
}

/** A page's series, oldest first. */
export function listSeries(workspaceId: string): Series[] {
  return withEpisodes(db.select().from(schema.series).where(eq(schema.series.workspaceId, workspaceId)).orderBy(asc(schema.series.position), asc(schema.series.createdAt)).all());
}

export const getSeries = (id: string): Series => withEpisodes([getSeriesRow(id)])[0];

function changed(workspaceId: string, id?: string) {
  emit({ type: 'changed', entity: 'series', workspaceId, id });
  // Cards show their series and episode.
  emit({ type: 'changed', entity: 'pieces', workspaceId });
}

export function createSeries(workspaceId: string, input: { name: string; about?: string }) {
  getWorkspace(workspaceId);
  const name = input.name.trim();
  if (!name) throw badRequest('Name it first.');
  if (db.select().from(schema.series).where(and(eq(schema.series.workspaceId, workspaceId), eq(schema.series.name, name))).get()) throw badRequest(`There's a series called “${name}” already.`);
  const id = newId();
  db.insert(schema.series).values({ id, workspaceId, name, about: input.about?.trim() ?? '', position: now() }).run();
  changed(workspaceId, id);
  return getSeries(id);
}

export function updateSeries(id: string, input: { name?: string; about?: string }) {
  const row = getSeriesRow(id);
  const name = input.name?.trim();
  if (input.name !== undefined && !name) throw badRequest('A series needs a name.');
  db.update(schema.series)
    .set({ ...(name ? { name } : {}), ...(input.about !== undefined ? { about: input.about } : {}), updatedAt: now() })
    .where(eq(schema.series.id, id))
    .run();
  changed(row.workspaceId, id);
  return getSeries(id);
}

/** The series goes; its episodes stay as cards. */
export function deleteSeries(id: string) {
  const row = getSeriesRow(id);
  db.transaction((tx) => {
    tx.update(schema.pieces).set({ seriesId: null, episode: null, updatedAt: now() }).where(eq(schema.pieces.seriesId, id)).run();
    tx.delete(schema.series).where(eq(schema.series.id, id)).run();
  });
  changed(row.workspaceId, id);
}

/** Number a series' episodes 1 to n: in the order given, or as they are (closing gaps). */
function renumber(seriesId: string, order?: string[]) {
  const eps = db
    .select({ id: schema.pieces.id })
    .from(schema.pieces)
    .where(eq(schema.pieces.seriesId, seriesId))
    .orderBy(asc(schema.pieces.episode), asc(schema.pieces.createdAt))
    .all()
    .map((e) => e.id);
  const ids = order ? [...order.filter((id) => eps.includes(id)), ...eps.filter((id) => !order.includes(id))] : eps;
  db.transaction((tx) => {
    ids.forEach((id, i) => tx.update(schema.pieces).set({ episode: i + 1 }).where(eq(schema.pieces.id, id)).run());
  });
}

/** Put the episodes in this order. */
export function orderEpisodes(seriesId: string, pieceIds: string[]) {
  const row = getSeriesRow(seriesId);
  renumber(seriesId, pieceIds);
  changed(row.workspaceId, seriesId);
  return getSeries(seriesId);
}

/** Make a card an episode of a series (the next one), or take it out (null). */
export function setPieceSeries(pieceId: string, seriesId: string | null) {
  const piece = getPiece(pieceId);
  if (piece.seriesId === seriesId) return;
  if (seriesId && getSeriesRow(seriesId).workspaceId !== piece.workspaceId) throw badRequest('That series is on another page.');
  const last = seriesId ? db.select({ n: max(schema.pieces.episode) }).from(schema.pieces).where(and(eq(schema.pieces.seriesId, seriesId), isNotNull(schema.pieces.episode))).get() : null;
  db.update(schema.pieces)
    .set({ seriesId, episode: seriesId ? (last?.n ?? 0) + 1 : null, updatedAt: now() })
    .where(eq(schema.pieces.id, pieceId))
    .run();
  if (piece.seriesId) renumber(piece.seriesId);
  changed(piece.workspaceId, seriesId ?? piece.seriesId ?? undefined);
}

/** A new card as the series' next episode: an idea, or with its script and notes (Claude's, from Claude Code). */
export function addEpisode(seriesId: string, input: { title: string; script?: string; notes?: string; author?: 'you' | 'claude' }) {
  const row = getSeriesRow(seriesId);
  const title = input.title.trim();
  if (!title) throw badRequest('Name the episode first.');
  const written = !!input.script?.trim();
  const { pieceId } = createPiece(row.workspaceId, {
    title,
    stage: written ? 'script' : 'idea',
    ...(written || input.notes ? { content: { script: input.script ?? '', notes: input.notes ?? '' }, author: input.author ?? 'you', message: input.author === 'claude' ? `Episode script for ${row.name}` : 'First draft' } : {}),
  });
  setPieceSeries(pieceId, seriesId);
  return { pieceId, episode: getPiece(pieceId).episode ?? 1 };
}

/** What a prompt about one episode needs: the series, what it follows, and the other episodes around it. */
export function seriesText(pieceId: string) {
  const piece = getPiece(pieceId);
  if (!piece.seriesId) return '';
  const s = getSeries(piece.seriesId);
  const others = s.episodes.filter((e) => e.id !== piece.id).map((e) => `Ep ${e.episode}: ${e.title}`);
  return [
    `Series: ${s.name} (this is Ep ${piece.episode ?? '?'} of ${s.episodes.length})`,
    s.about.trim() && `Every episode follows:\n${s.about.trim()}`,
    others.length && `The other episodes:\n${others.join('\n')}`,
  ]
    .filter(Boolean)
    .join('\n');
}
