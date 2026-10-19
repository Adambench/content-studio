// What hosted generation has cost, and the daily cap on it.
import { gte, sql } from 'drizzle-orm';
import { normalizeHosted, type HostedSettings } from '../../../../shared/hosted';
import { db, newId, schema } from '../../db';
import { getSetting } from '../../lib/settings';

export const hostedSettings = (): HostedSettings => normalizeHosted(getSetting('hosted'));
export const hostedKey = () => getSetting('hostedKey') || '';

const startOfDay = (at = new Date()) => new Date(at.getFullYear(), at.getMonth(), at.getDate()).getTime();

export function spentTodayUsd() {
  const row = db
    .select({ total: sql<number>`coalesce(sum(${schema.aiSpend.dollars}), 0)` })
    .from(schema.aiSpend)
    .where(gte(schema.aiSpend.createdAt, startOfDay()))
    .get();
  return row?.total ?? 0;
}

/** Whether a request costing `usd` still fits under today's cap. */
export const fitsCap = (usd: number, s = hostedSettings()) => spentTodayUsd() + usd <= s.dailyCapUsd + 1e-9;

export const msUntilTomorrow = (at = new Date()) => new Date(at.getFullYear(), at.getMonth(), at.getDate() + 1).getTime() - at.getTime() + 60_000;

export function recordSpend(r: { model: string; kind: string; taskId: string | null; credits: number; dollars: number; pieceId: string | null }) {
  db.insert(schema.aiSpend).values({ id: newId(), provider: 'kie.ai', model: r.model, kind: r.kind, taskId: r.taskId, credits: r.credits, dollars: r.dollars, pieceId: r.pieceId }).run();
}
