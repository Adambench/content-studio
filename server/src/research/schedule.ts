// The daily research run for each page with the Research brief on and something to watch: the sweep, then the brief.
// Checked every half hour; it starts after 7:00 local time, once a day (or when I ask).
import { normalizeModules } from '../../../shared/types';
import { normalizeResearch, watchesAnything } from '../../../shared/research';
import { localDay } from '../analytics/stats';
import { db, schema } from '../db';
import { badRequest, HttpError } from '../lib/http';
import { enqueue } from '../jobs/queue';
import { getWorkspace } from '../services/pieces';
import { latestBriefs, startBrief, sweeping } from './research';

const TICK_MS = 30 * 60_000;
const START_HOUR = 7;
let timer: NodeJS.Timeout | undefined;

/** Start a research run now: the sweep, then the brief. */
export function runResearch(workspaceId: string) {
  const ws = getWorkspace(workspaceId);
  if (!watchesAnything(normalizeResearch(ws.research))) throw badRequest('Add keywords or accounts to watch first.');
  if (sweeping(ws.id)) throw new HttpError(409, 'Research is already running for this page.');
  const briefId = startBrief(ws.id, localDay());
  enqueue('research.sweep', { workspaceId: ws.id, briefId }, { maxAttempts: 2 });
  return briefId;
}

function tick() {
  if (new Date().getHours() < START_HOUR) return;
  const day = localDay();
  for (const ws of db.select().from(schema.workspaces).all()) {
    if (!normalizeModules(ws.modules).includes('research') || !watchesAnything(normalizeResearch(ws.research))) continue;
    const { latest } = latestBriefs(ws.id);
    // One a day: today's has run (or is running, or failed and waits for tomorrow or my click).
    if (latest?.day === day || sweeping(ws.id)) continue;
    try {
      runResearch(ws.id);
    } catch (err) {
      console.warn(`[research] ${ws.name}: ${(err as Error).message}`);
    }
  }
}

export function startResearch() {
  setTimeout(tick, 3 * 60_000);
  timer = setInterval(tick, TICK_MS);
}

export function stopResearch() {
  clearInterval(timer);
}
