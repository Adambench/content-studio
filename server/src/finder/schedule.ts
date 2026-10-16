// Each clipping page's finder runs by itself once a morning (after 7:00 local time, unless switched off on the Find
// page). Checked every half hour, like the research run.
import { localDay } from '../analytics/stats';
import { db, schema } from '../db';
import { getRun, finderAuto, startFinder } from './finder';

const TICK_MS = 30 * 60_000;
const START_HOUR = 7;
let timer: NodeJS.Timeout | undefined;

function tick() {
  if (new Date().getHours() < START_HOUR) return;
  for (const ws of db.select().from(schema.workspaces).all()) {
    if (ws.kind !== 'clipping' || !finderAuto(ws.id)) continue;
    const run = getRun(ws.id);
    if (run.status === 'running' || (run.startedAt && localDay(run.startedAt) === localDay())) continue;
    try {
      startFinder(ws.id);
    } catch (err) {
      console.warn(`[finder] ${ws.name}: ${(err as Error).message}`);
    }
  }
}

export function startFinderSchedule() {
  setTimeout(tick, 4 * 60_000);
  timer = setInterval(tick, TICK_MS);
}

export function stopFinderSchedule() {
  clearInterval(timer);
}
