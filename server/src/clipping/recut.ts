// Cutting a clip on the board again from its source with a new start or end: the fix for a clip that stops before its
// story does, or starts in the middle of it, when the words it needs lie outside its cut. The same card (its comments,
// its versions, its place on the board) gets the new cut, made like the first one (music check, framing on the
// speaker, whole sentences, the check against the lessons) and rendered.
import { and, eq, inArray } from 'drizzle-orm';
import { clock } from '../../../shared/clipping';
import { getCampaignRow, getSource } from '../campaigns/campaigns';
import { readSourceTranscript, sourceFile } from '../campaigns/sources';
import { db, schema } from '../db';
import { badRequest, HttpError } from '../lib/http';
import { cancelRender } from '../studio/render';
import { queueMake, updateMoment } from './moments';

/** The moment a clip on the board was cut from, if it's a clip. */
export function momentOfPiece(pieceId: string) {
  return db.select().from(schema.moments).where(eq(schema.moments.pieceId, pieceId)).get() ?? null;
}

/** The longest clip the campaign takes (its rules' length cap), 90 s without one. */
export function campaignMaxSeconds(campaignId: string) {
  return Number(getCampaignRow(campaignId).checklist.find((r) => r.check?.type === 'maxSeconds')?.check?.value) || 90;
}

function clipMoment(pieceId: string) {
  const m = momentOfPiece(pieceId);
  if (!m) throw badRequest('This video isn’t a clip cut from a source video.');
  return m;
}

/** The source's words around a clip (`around` seconds either side), a line per caption with its time, the clip's own marked. */
export async function clipSource(pieceId: string, around = 60) {
  const m = clipMoment(pieceId);
  const s = getSource(m.sourceId);
  const t = await readSourceTranscript(s);
  if (!t) throw badRequest('The source video has no transcript.');
  const lines = t.segments
    .filter((seg) => seg.end > m.start - around && seg.start < m.end + around)
    .map((seg) => `${seg.start.toFixed(1).padStart(7)} ${seg.start >= m.start - 0.3 && seg.start < m.end ? '|' : ' '} ${seg.text.trim()}`);
  return {
    source: s.title,
    clip: { start: m.start, end: m.end, at: `${clock(m.start)}–${clock(m.end)}`, seconds: Math.round((m.end - m.start) * 10) / 10 },
    maxSeconds: campaignMaxSeconds(m.campaignId),
    sourceSeconds: s.durationMs ? s.durationMs / 1000 : undefined,
    // Seconds of the source; "|" marks the lines inside the clip now. ">>" is where the captions mark a new speaker.
    words: lines.join('\n'),
  };
}

// Cuts asked for per moment, so a check that keeps disagreeing can't cut it again and again.
const recent = new Map<string, number[]>();

/** Cut a clip again from its source between `start` and `end` (seconds of the source). */
export function recutClip(pieceId: string, start: number, end: number) {
  const m = clipMoment(pieceId);
  if (m.status === 'making') throw new HttpError(409, 'It’s being made already.');
  const s = getSource(m.sourceId);
  if (!sourceFile(s)) throw badRequest('The source video was deleted to save space: download it again first (Source videos → Download again).');
  const length = s.durationMs ? s.durationMs / 1000 : Infinity;
  if (!(start >= 0 && end > start + 3 && end <= length + 0.5)) throw badRequest(`Pick a start and an end inside the source${Number.isFinite(length) ? ` (0–${clock(length)})` : ''}, at least 3 s apart.`);
  const max = campaignMaxSeconds(m.campaignId);
  if (end - start > max) throw badRequest(`That’s ${Math.round(end - start)} s: the campaign takes ${max} s at most.`);
  const times = (recent.get(m.id) ?? []).filter((t) => Date.now() - t < 30 * 60_000);
  if (times.length >= 2) throw badRequest('It was cut again twice in the last half hour: fix the rest in the edit, or tell the creator what you’d change.');
  recent.set(m.id, [...times, Date.now()]);
  // Its render waiting (or being checked) is for the old cut.
  for (const r of db.select().from(schema.renders).where(and(eq(schema.renders.pieceId, pieceId), inArray(schema.renders.status, ['queued', 'running']))).all()) cancelRender(r.id);
  updateMoment(m.id, { start: Math.round(start * 100) / 100, end: Math.round(end * 100) / 100 });
  queueMake(m.id);
  return { at: `${clock(start)}–${clock(end)}`, seconds: Math.round((end - start) * 10) / 10 };
}
