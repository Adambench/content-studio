// Research data: a page's watch list, its outliers, briefs and analyses.
import { and, desc, eq, gte, inArray, isNotNull, ne, or } from 'drizzle-orm';
import { normalizeResearch, OUTLIER_AT, type ResearchBrief, type ResearchItem, type ResearchOverview } from '../../../shared/research';
import { db, newId, now, schema } from '../db';
import { desktopAvailable } from '../lib/desktop';
import { emit } from '../lib/events';
import { notFound } from '../lib/http';
import { hasPendingJob } from '../jobs/queue';
import { getWorkspace } from '../services/pieces';

export type ItemRow = typeof schema.researchItems.$inferSelect;
export type BriefRow = typeof schema.researchBriefs.$inferSelect;

const DAY = 86400_000;

export const emitResearch = (workspaceId: string) => emit({ type: 'changed', entity: 'research', workspaceId });

export const toItem = (r: ItemRow): ResearchItem => r;
export const toBrief = (r: BriefRow): ResearchBrief => r;

export function researchSettings(workspaceId: string) {
  return normalizeResearch(getWorkspace(workspaceId).research);
}

export function getItem(id: string) {
  const row = db.select().from(schema.researchItems).where(eq(schema.researchItems.id, id)).get();
  if (!row) throw notFound('Not found');
  return row;
}

export function updateItem(id: string, values: Partial<ItemRow>) {
  db.update(schema.researchItems).set(values).where(eq(schema.researchItems.id, id)).run();
  const row = getItem(id);
  emitResearch(row.workspaceId);
  return row;
}

export function getBrief(id: string) {
  const row = db.select().from(schema.researchBriefs).where(eq(schema.researchBriefs.id, id)).get();
  if (!row) throw notFound('Brief not found');
  return row;
}

/** The newest brief (running, done or failed), and the newest one that's done. */
export function latestBriefs(workspaceId: string) {
  const latest = db.select().from(schema.researchBriefs).where(eq(schema.researchBriefs.workspaceId, workspaceId)).orderBy(desc(schema.researchBriefs.createdAt)).get() ?? null;
  const done =
    latest?.status === 'done'
      ? latest
      : (db
          .select()
          .from(schema.researchBriefs)
          .where(and(eq(schema.researchBriefs.workspaceId, workspaceId), eq(schema.researchBriefs.status, 'done')))
          .orderBy(desc(schema.researchBriefs.createdAt))
          .get() ?? null);
  return { latest, done };
}

/** A new brief row (the sweep and Claude's read fill it in). */
export function startBrief(workspaceId: string, day: string) {
  const id = newId();
  db.insert(schema.researchBriefs).values({ id, workspaceId, day, status: 'running' }).run();
  emitResearch(workspaceId);
  return id;
}

export function finishBrief(id: string, values: Partial<BriefRow>) {
  db.update(schema.researchBriefs)
    .set({ ...values, finishedAt: values.status === 'running' ? null : now() })
    .where(eq(schema.researchBriefs.id, id))
    .run();
  emitResearch(getBrief(id).workspaceId);
}

/** Outliers first seen in the last `days` days, best first. */
export function recentOutliers(workspaceId: string, days = 21, limit = 60) {
  return db
    .select()
    .from(schema.researchItems)
    .where(
      and(
        eq(schema.researchItems.workspaceId, workspaceId),
        inArray(schema.researchItems.source, ['watch', 'search']),
        isNotNull(schema.researchItems.score),
        gte(schema.researchItems.score, OUTLIER_AT),
        gte(schema.researchItems.lastSeenAt, now() - days * DAY),
      ),
    )
    .orderBy(desc(schema.researchItems.score))
    .limit(limit)
    .all();
}

export function analyses(workspaceId: string, limit = 30) {
  return db
    .select()
    .from(schema.researchItems)
    // Links and library videos, and outliers I asked to have analysed.
    .where(and(eq(schema.researchItems.workspaceId, workspaceId), or(inArray(schema.researchItems.source, ['link', 'library']), ne(schema.researchItems.analysisStatus, 'none'))))
    .orderBy(desc(schema.researchItems.firstSeenAt))
    .limit(limit)
    .all();
}

export const sweeping = (workspaceId: string) => hasPendingJob('research.sweep', 'workspaceId', workspaceId) || hasPendingJob('research.brief', 'workspaceId', workspaceId);

export function researchOverview(workspaceId: string): ResearchOverview {
  const { latest, done } = latestBriefs(workspaceId);
  return {
    settings: researchSettings(workspaceId),
    brief: done && toBrief(done),
    running: sweeping(workspaceId) || latest?.status === 'running',
    // The newest run failed (the last good brief still shows).
    error: latest?.status === 'error' ? latest.error : null,
    outliers: recentOutliers(workspaceId).map(toItem),
    analyses: analyses(workspaceId).map(toItem),
    desktop: desktopAvailable(),
  };
}
