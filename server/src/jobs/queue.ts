// The job table: what the engine has to do, in order. The runner (runner.ts) takes jobs from here; anything can
// queue one. Kept free of services so every module can import it.

import type { Job, JobKind, JobLine, JobStatus } from '../../../shared/types.ts';
import { all, get, parseJson, run } from '../db/db.ts';
import { emit, newId, notFound, now } from '../lib/util.ts';

type JobRow = { id: string; kind: JobKind; video_id: string | null; status: JobStatus; input: string; state: string; step: string | null; progress: number; log: string; error: string | null; run_after: number; created_at: number; started_at: number | null; finished_at: number | null };

const toJob = (r: JobRow): Job => ({ id: r.id, kind: r.kind, videoId: r.video_id, status: r.status, step: r.step, progress: r.progress, log: parseJson<JobLine[]>(r.log, []), error: r.error, createdAt: r.created_at, startedAt: r.started_at, finishedAt: r.finished_at });

/** A job asking to be tried again later (Claude's usage window, a busy machine), not a failure. */
export class JobWait extends Error {
  delayMs: number;
  constructor(message: string, delayMs: number) {
    super(message);
    this.delayMs = delayMs;
  }
}

let wake: () => void = () => {};
export const onEnqueue = (fn: () => void) => {
  wake = fn;
};

export type EnqueueOptions = { videoId?: string | null; input?: Record<string, unknown>; /** Don't queue a second one while one is waiting or running for this video. */ single?: boolean };

export function enqueue(kind: JobKind, opts: EnqueueOptions = {}): Job {
  if (opts.single && opts.videoId) {
    const cur = get<JobRow>("SELECT * FROM jobs WHERE kind = ? AND video_id = ? AND status IN ('queued', 'waiting', 'running') ORDER BY created_at DESC LIMIT 1", kind, opts.videoId);
    if (cur) return toJob(cur);
  }
  const id = newId();
  run('INSERT INTO jobs (id, kind, video_id, status, input, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, kind, opts.videoId ?? null, 'queued', JSON.stringify(opts.input ?? {}), now());
  emit('job', id, opts.videoId ?? undefined);
  if (opts.videoId) emit('video', opts.videoId, opts.videoId);
  queueMicrotask(() => wake());
  return getJob(id);
}

export function getJob(id: string): Job {
  const r = get<JobRow>('SELECT * FROM jobs WHERE id = ?', id);
  if (!r) throw notFound('Job');
  return toJob(r);
}

export function jobInput<T>(id: string): T {
  return parseJson<T>(get<{ input: string }>('SELECT input FROM jobs WHERE id = ?', id)?.input, {} as T);
}

export function jobState(id: string): Record<string, unknown> {
  return parseJson<Record<string, unknown>>(get<{ state: string }>('SELECT state FROM jobs WHERE id = ?', id)?.state, {});
}

export function listJobs(opts: { videoId?: string; active?: boolean; limit?: number } = {}): Job[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (opts.videoId) {
    where.push('video_id = ?');
    params.push(opts.videoId);
  }
  if (opts.active) where.push("status IN ('queued', 'waiting', 'running')");
  params.push(opts.limit ?? 50);
  return all<JobRow>(`SELECT * FROM jobs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ?`, ...params).map(toJob);
}

/** The next job of these kinds that may run now, marked running. */
export function claimNext(kinds: readonly JobKind[]): Job | null {
  if (!kinds.length) return null;
  const r = get<JobRow>(
    // One Claude run per video at a time (they share its session): a second message waits for the first run.
    `SELECT * FROM jobs WHERE status IN ('queued', 'waiting') AND run_after <= ? AND kind IN (${kinds.map(() => '?').join(',')})
       AND (kind != 'agent' OR video_id IS NULL OR NOT EXISTS (SELECT 1 FROM jobs r WHERE r.video_id = jobs.video_id AND r.kind = 'agent' AND r.status = 'running'))
     ORDER BY run_after, created_at LIMIT 1`,
    now(),
    ...kinds,
  );
  if (!r) return null;
  run("UPDATE jobs SET status = 'running', started_at = COALESCE(started_at, ?), error = NULL WHERE id = ?", now(), r.id);
  touch(r);
  return getJob(r.id);
}

function touch(r: { id: string; video_id: string | null }) {
  emit('job', r.id, r.video_id ?? undefined);
  if (r.video_id) emit('video', r.video_id, r.video_id);
}

export function setProgress(id: string, progress: number, step?: string) {
  const r = get<JobRow>('SELECT * FROM jobs WHERE id = ?', id);
  if (!r) return;
  run('UPDATE jobs SET progress = ?, step = COALESCE(?, step) WHERE id = ?', Math.max(0, Math.min(1, progress)), step ?? null, id);
  touch(r);
}

export function addLog(id: string, text: string) {
  const r = get<JobRow>('SELECT * FROM jobs WHERE id = ?', id);
  if (!r) return;
  const log = parseJson<JobLine[]>(r.log, []);
  log.push({ at: now(), text: text.slice(0, 500) });
  run('UPDATE jobs SET log = ? WHERE id = ?', JSON.stringify(log.slice(-200)), id);
  touch(r);
}

export function saveState(id: string, state: Record<string, unknown>) {
  run('UPDATE jobs SET state = ? WHERE id = ?', JSON.stringify(state), id);
}

export function finishJob(id: string, status: Exclude<JobStatus, 'queued' | 'running'>, opts: { error?: string; runAfter?: number } = {}) {
  const r = get<JobRow>('SELECT * FROM jobs WHERE id = ?', id);
  if (!r) return;
  const final = status === 'done' || status === 'failed' || status === 'cancelled';
  run(
    'UPDATE jobs SET status = ?, error = ?, run_after = ?, finished_at = ?, progress = ? WHERE id = ?',
    status,
    opts.error ?? null,
    opts.runAfter ?? r.run_after,
    final ? now() : null,
    status === 'done' ? 1 : r.progress,
    id,
  );
  touch(r);
}

/** After a restart, what was running is queued again; its finished steps are kept, so it carries on. */
export function requeueInterrupted() {
  run("UPDATE jobs SET status = 'queued' WHERE status = 'running'");
}

export function markCancelled(id: string) {
  const r = get<JobRow>('SELECT * FROM jobs WHERE id = ?', id);
  if (!r) throw notFound('Job');
  if (r.status === 'queued' || r.status === 'waiting') finishJob(id, 'cancelled');
  return toJob(r);
}
