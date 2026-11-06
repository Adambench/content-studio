// The board (shared/board.ts): every card of the pages I see, with what its one line needs.
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import { columnOf, type BoardData, type BoardItem } from '../../../shared/board';
import { db, schema } from '../db';
import { reviewStates } from '../studio/notes';

/** Footage I shared for a video (not what the app made: renders, cuts, voices). */
const FOOTAGE_SOURCES = ['upload', 'share', 'capture'] as const;

export function boardData(): BoardData {
  const pages = db.select().from(schema.workspaces).orderBy(asc(schema.workspaces.position), asc(schema.workspaces.createdAt)).all();
  const shown = pages.filter((w) => !w.hidden).map((w) => w.id);
  return {
    pages: pages.map((w) => ({ id: w.id, name: w.name, color: w.color, kind: w.kind, hidden: w.hidden })),
    items: shown.length ? boardItems(shown) : [],
  };
}

function boardItems(workspaceIds: string[]): BoardItem[] {
  const pieces = db.select().from(schema.pieces).where(inArray(schema.pieces.workspaceId, workspaceIds)).orderBy(asc(schema.pieces.position), asc(schema.pieces.createdAt)).all();
  if (!pieces.length) return [];
  const ids = pieces.map((p) => p.id);

  const renders = new Map<string, number | null>();
  for (const m of db
    .select({ pieceId: schema.media.pieceId, durationMs: schema.media.durationMs })
    .from(schema.media)
    .where(and(inArray(schema.media.pieceId, ids), eq(schema.media.source, 'render'), eq(schema.media.kind, 'video')))
    .orderBy(asc(schema.media.createdAt))
    .all())
    if (m.pieceId) renders.set(m.pieceId, m.durationMs);

  const footage = new Map<string, number>();
  for (const m of db
    .select({ pieceId: schema.media.pieceId })
    .from(schema.media)
    .where(and(inArray(schema.media.pieceId, ids), inArray(schema.media.source, [...FOOTAGE_SOURCES])))
    .all())
    if (m.pieceId) footage.set(m.pieceId, (footage.get(m.pieceId) ?? 0) + 1);

  const drawing = new Set(
    db
      .select({ pieceId: schema.renders.pieceId })
      .from(schema.renders)
      .where(and(inArray(schema.renders.pieceId, ids), inArray(schema.renders.status, ['queued', 'running']), eq(schema.renders.older, false)))
      .all()
      .map((r) => r.pieceId),
  );

  const posts = db
    .select({ pieceId: schema.posts.pieceId, status: schema.posts.status, at: schema.posts.scheduledAt, publishedAt: schema.posts.publishedAt, error: schema.posts.error })
    .from(schema.posts)
    .where(inArray(schema.posts.pieceId, ids))
    .orderBy(desc(schema.posts.scheduledAt))
    .all();

  const review = reviewStates(pieces);
  return pieces.map((p): BoardItem => {
    const own = posts.filter((x) => x.pieceId === p.id);
    const upcoming = own.filter((x) => x.status === 'scheduled' || x.status === 'publishing').map((x) => x.at);
    const published = own.find((x) => x.status === 'published');
    const broken = own.find((x) => x.status === 'failed' || x.status === 'missed');
    const failed = broken ? broken.error || (broken.status === 'missed' ? 'Missed its time' : 'Failed') : p.stage === 'ready' && !upcoming.length ? 'Not queued' : null;
    return {
      id: p.id,
      workspaceId: p.workspaceId,
      title: p.title,
      stage: p.stage,
      column: columnOf(p.stage),
      position: p.position,
      updatedAt: p.updatedAt,
      durationMs: renders.get(p.id) ?? null,
      rendering: drawing.has(p.id),
      openComments: review.get(p.id)?.open ?? 0,
      nextPostAt: upcoming.length ? Math.min(...upcoming) : null,
      failed,
      postedAt: published ? (published.publishedAt ?? published.at) : null,
      series: p.series ? { name: p.series, episode: p.episode ?? 1 } : null,
      footage: footage.get(p.id) ?? 0,
    };
  });
}
