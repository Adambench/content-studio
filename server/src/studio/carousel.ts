// A card's carousel (Instagram, up to 20 slides in the app, 10 through the API): versions of its slides, the newest is
// what Review shows, comments pin to, Approve posts and the export saves. Claude saves a version with
// `npm run edit -- carousel <card> <png…> "<message>"`; the slides are image media on the card (source `render`).
import { createReadStream } from 'node:fs';
import { basename, extname } from 'node:path';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { CarouselVersion } from '../../../shared/types';
import { REVIEW_STAGE } from '../../../shared/types';
import { db, newId, now, schema } from '../db';
import { emit } from '../lib/events';
import { badRequest } from '../lib/http';
import { notify } from '../lib/push';
import { getPiece, getWorkspace } from '../services/pieces';
import { saveUpload } from '../services/media';
import { followComments } from './notes';

/** Instagram's app takes 20 slides; its API 10 (shared/publish.ts PUBLISH_LIMITS). */
export const MAX_SLIDES = 20;
const MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

type Row = typeof schema.carouselVersions.$inferSelect;

/** Every version of a piece's carousel, newest first, each with its slides. */
export function listCarousel(pieceId: string): CarouselVersion[] {
  const rows = db.select().from(schema.carouselVersions).where(eq(schema.carouselVersions.pieceId, pieceId)).orderBy(desc(schema.carouselVersions.number)).all();
  if (!rows.length) return [];
  const ids = [...new Set(rows.flatMap((r) => r.mediaIds))];
  const media = new Map(
    db
      .select({ id: schema.media.id, width: schema.media.width, height: schema.media.height, name: schema.media.originalName })
      .from(schema.media)
      .where(inArray(schema.media.id, ids))
      .all()
      .map((m) => [m.id, m]),
  );
  return rows.map((r) => ({
    id: r.id,
    number: r.number,
    author: r.author,
    message: r.message,
    createdAt: r.createdAt,
    slides: r.mediaIds.filter((id) => media.has(id)).map((id) => ({ mediaId: id, width: media.get(id)!.width, height: media.get(id)!.height, name: media.get(id)!.name })),
  }));
}

/** The newest version (what's under review now), or null for a card that isn't a carousel. */
export function currentCarousel(pieceId: string): Row | null {
  return db.select().from(schema.carouselVersions).where(eq(schema.carouselVersions.pieceId, pieceId)).orderBy(desc(schema.carouselVersions.number)).get() ?? null;
}

/** Each piece's newest carousel version, for the board and review states in one query. */
export function currentCarousels(pieceIds: string[]) {
  const out = new Map<string, Row>();
  if (!pieceIds.length) return out;
  for (const r of db.select().from(schema.carouselVersions).where(inArray(schema.carouselVersions.pieceId, pieceIds)).all()) {
    const seen = out.get(r.pieceId);
    if (!seen || r.number > seen.number) out.set(r.pieceId, r);
  }
  return out;
}

/** The version a slide (a media id) belongs to. */
export function carouselOfSlide(pieceId: string, mediaId: string) {
  const rows = db.select().from(schema.carouselVersions).where(eq(schema.carouselVersions.pieceId, pieceId)).all();
  const row = rows.find((r) => r.mediaIds.includes(mediaId));
  return row ? { number: row.number, slide: row.mediaIds.indexOf(mediaId), slides: row.mediaIds.length } : null;
}

/**
 * Save a version: new image files (in order) or images already on the card (they become slides). A card being made
 * or edited goes to Review, unwatched, like a finished render.
 */
export async function saveCarousel(pieceId: string, input: { files?: string[]; mediaIds?: string[] }, message: string, author: 'you' | 'claude') {
  const piece = getPiece(pieceId);
  const ids: string[] = [];
  if (input.mediaIds?.length) {
    const rows = db.select().from(schema.media).where(and(inArray(schema.media.id, input.mediaIds), eq(schema.media.pieceId, pieceId))).all();
    for (const id of input.mediaIds) {
      const m = rows.find((r) => r.id === id);
      if (!m || m.kind !== 'image') throw badRequest(`${id} isn’t a picture on this card.`);
      ids.push(m.id);
    }
    db.update(schema.media).set({ source: 'render' }).where(inArray(schema.media.id, ids)).run();
  }
  for (const file of input.files ?? []) {
    const mime = MIME[extname(file).toLowerCase()];
    if (!mime) throw badRequest(`${basename(file)}: slides are ${Object.keys(MIME).join(' ')}`);
    const n = String(ids.length + 1).padStart(2, '0');
    const m = await saveUpload(piece.workspaceId, { stream: createReadStream(file), filename: `${piece.title} ${n}${extname(file).toLowerCase()}`, mimetype: mime }, { pieceId, source: 'render' });
    ids.push(m.id);
  }
  if (!ids.length) throw badRequest('A carousel needs at least one slide.');
  if (ids.length > MAX_SLIDES) throw badRequest(`Instagram takes ${MAX_SLIDES} slides at most (this has ${ids.length}).`);
  const number = (currentCarousel(pieceId)?.number ?? 0) + 1;
  const row = db.insert(schema.carouselVersions).values({ id: newId(), workspaceId: piece.workspaceId, pieceId, number, author, message, mediaIds: ids, createdAt: now() }).returning().get();

  const stages = getWorkspace(piece.workspaceId).stages.map((s) => s.id);
  if (['idea', 'script', 'film', 'making', 'edit'].includes(piece.stage) && stages.includes(REVIEW_STAGE)) {
    db.update(schema.pieces).set({ stage: REVIEW_STAGE, updatedAt: now() }).where(eq(schema.pieces.id, pieceId)).run();
    await notify('Ready to look at', `“${piece.title}”`, `/c/${pieceId}`).catch(() => {});
  }
  emit({ type: 'changed', entity: 'pieces', workspaceId: piece.workspaceId, id: pieceId });
  followComments(pieceId);
  return row;
}
