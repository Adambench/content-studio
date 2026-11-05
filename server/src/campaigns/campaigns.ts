import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { asc, desc, eq, inArray, or } from 'drizzle-orm';
import type { Campaign, CampaignDetail, CampaignSource } from '../../../shared/campaigns';
import type { Moment } from '../../../shared/clipping';
import { config } from '../config';
import { db, now, schema } from '../db';
import { emit } from '../lib/events';
import { notFound } from '../lib/http';

export type CampaignRow = typeof schema.campaigns.$inferSelect;
export type SourceRow = typeof schema.campaignSources.$inferSelect;
export type MomentRow = typeof schema.moments.$inferSelect;

export const campaignDir = (campaignId: string) => join(config.sourcesDir, campaignId);

export function getCampaignRow(id: string) {
  const row = db.select().from(schema.campaigns).where(eq(schema.campaigns.id, id)).get();
  if (!row) throw notFound('Campaign not found');
  return row;
}

export function pagesOf(campaignIds: string[]) {
  const rows = campaignIds.length ? db.select().from(schema.campaignPages).where(inArray(schema.campaignPages.campaignId, campaignIds)).all() : [];
  const map = new Map<string, string[]>();
  for (const r of rows) map.set(r.campaignId, [...(map.get(r.campaignId) ?? []), r.workspaceId]);
  return map;
}

export function toCampaign(row: CampaignRow, pageIds: string[] = []): Campaign {
  const { pageText: _pageText, budgetWarnedAt: _warned, ...rest } = row;
  return { ...rest, pageIds };
}

export function toSource(row: SourceRow): CampaignSource {
  const { fileName, updatedAt: _u, ...rest } = row;
  return { ...rest, downloaded: !!fileName };
}

export function listCampaigns(): Campaign[] {
  const rows = db.select().from(schema.campaigns).orderBy(desc(schema.campaigns.createdAt)).all();
  const pages = pagesOf(rows.map((r) => r.id));
  return rows.map((r) => toCampaign(r, pages.get(r.id)));
}

export function listSources(campaignId: string) {
  return db.select().from(schema.campaignSources).where(eq(schema.campaignSources.campaignId, campaignId)).orderBy(asc(schema.campaignSources.createdAt)).all();
}

export const toMoment = (row: MomentRow, pieceStage?: string | null): Moment => ({ ...row, pieceStage: pieceStage ?? null });

/** A campaign's moments, in source order, with their clip's card stage. */
export function listMoments(campaignId: string) {
  return db
    .select({ moment: schema.moments, stage: schema.pieces.stage })
    .from(schema.moments)
    .leftJoin(schema.pieces, eq(schema.pieces.id, schema.moments.pieceId))
    .where(eq(schema.moments.campaignId, campaignId))
    .orderBy(asc(schema.moments.sourceId), asc(schema.moments.start))
    .all()
    .map((r) => toMoment(r.moment, r.stage));
}

export function getCampaignDetail(id: string): CampaignDetail {
  const row = getCampaignRow(id);
  return {
    ...toCampaign(row, pagesOf([id]).get(id)),
    sources: listSources(id).map(toSource),
    moments: listMoments(id),
  };
}

/** Campaigns a workspace works on: assigned to it, or its own (a business's). For Claude's read-only tools. */
export function campaignsForWorkspace(workspaceId: string) {
  const assigned = db.select({ id: schema.campaignPages.campaignId }).from(schema.campaignPages).where(eq(schema.campaignPages.workspaceId, workspaceId)).all();
  const ids = assigned.map((a) => a.id);
  const rows = db
    .select()
    .from(schema.campaigns)
    .where(ids.length ? or(inArray(schema.campaigns.id, ids), eq(schema.campaigns.businessWorkspaceId, workspaceId)) : eq(schema.campaigns.businessWorkspaceId, workspaceId))
    .orderBy(desc(schema.campaigns.createdAt))
    .all();
  const pages = pagesOf(rows.map((r) => r.id));
  return rows.map((r) => toCampaign(r, pages.get(r.id)));
}

export function updateCampaign(id: string, values: Partial<typeof schema.campaigns.$inferInsert>) {
  db.update(schema.campaigns)
    .set({ ...values, updatedAt: now() })
    .where(eq(schema.campaigns.id, id))
    .run();
  emitCampaign(id);
}

export function setPages(campaignId: string, workspaceIds: string[]) {
  db.transaction((tx) => {
    tx.delete(schema.campaignPages).where(eq(schema.campaignPages.campaignId, campaignId)).run();
    for (const workspaceId of new Set(workspaceIds)) tx.insert(schema.campaignPages).values({ campaignId, workspaceId }).run();
  });
}

export function emitCampaign(id?: string) {
  emit({ type: 'changed', entity: 'campaigns', id });
}

export function getSource(id: string) {
  const row = db.select().from(schema.campaignSources).where(eq(schema.campaignSources.id, id)).get();
  if (!row) throw notFound('Source not found');
  return row;
}

export function updateSource(id: string, values: Partial<typeof schema.campaignSources.$inferInsert>) {
  db.update(schema.campaignSources)
    .set({ ...values, updatedAt: now() })
    .where(eq(schema.campaignSources.id, id))
    .run();
  const row = getSource(id);
  emitCampaign(row.campaignId);
  return row;
}

export async function deleteCampaign(id: string) {
  getCampaignRow(id);
  db.delete(schema.campaigns).where(eq(schema.campaigns.id, id)).run();
  await rm(campaignDir(id), { recursive: true, force: true });
  emitCampaign(id);
}

/** Sources still being fetched or transcribed, for Today. */
export function busySources() {
  return db
    .select({ source: schema.campaignSources, campaignTitle: schema.campaigns.title })
    .from(schema.campaignSources)
    .innerJoin(schema.campaigns, eq(schema.campaigns.id, schema.campaignSources.campaignId))
    .where(inArray(schema.campaignSources.status, ['queued', 'downloading', 'transcribing', 'scanning']))
    .orderBy(asc(schema.campaignSources.createdAt))
    .all();
}
