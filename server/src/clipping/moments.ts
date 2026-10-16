import { eq } from 'drizzle-orm';
import { emitCampaign, type MomentRow } from '../campaigns/campaigns';
import { db, now, schema } from '../db';
import { notFound } from '../lib/http';
import { enqueue, hasPendingJob } from '../jobs/queue';

export function getMoment(id: string) {
  const row = db.select().from(schema.moments).where(eq(schema.moments.id, id)).get();
  if (!row) throw notFound('Moment not found');
  return row;
}

export const momentExists = (id: string) => !!db.select({ id: schema.moments.id }).from(schema.moments).where(eq(schema.moments.id, id)).get();

export function updateMoment(id: string, values: Partial<MomentRow>) {
  db.update(schema.moments)
    .set({ ...values, updatedAt: now() })
    .where(eq(schema.moments.id, id))
    .run();
  const row = getMoment(id);
  emitCampaign(row.campaignId);
  return row;
}

/** Make (or make again) a moment's clip: "Make clip", or Claude's `make_clip`. */
export function queueMake(momentId: string) {
  const m = getMoment(momentId);
  if (m.status === 'making' && hasPendingJob('clip.make', 'momentId', momentId)) return m;
  enqueue('clip.make', { momentId }, { maxAttempts: 2 });
  return updateMoment(momentId, { status: 'making', detail: 'Waiting its turn', rejectReason: null });
}
