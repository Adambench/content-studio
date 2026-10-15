import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import { db, newId, now, schema } from '../db';

type Handler = (payload: any) => Promise<void>;
type Registration = { handler: Handler; concurrency: number; running: number };

const handlers = new Map<string, Registration>();

/** A job failure that says whether trying again could help, and when. Plain errors retry with backoff. */
export class JobError extends Error {
  constructor(
    message: string,
    public opts: { retry?: boolean; delayMs?: number } = {},
  ) {
    super(message);
  }
}
let timer: NodeJS.Timeout | undefined;

export function registerJob(type: string, handler: Handler, concurrency = 1) {
  handlers.set(type, { handler, concurrency, running: 0 });
}

/** Whether a job of this type (for this payload key, e.g. a post id, if given) is waiting or running. */
export function hasPendingJob(type: string, key?: string, value?: string) {
  return !!db
    .select({ id: schema.jobs.id })
    .from(schema.jobs)
    .where(
      and(
        eq(schema.jobs.type, type),
        inArray(schema.jobs.status, ['queued', 'running']),
        key ? sql`json_extract(${schema.jobs.payload}, ${`$.${key}`}) = ${value}` : undefined,
      ),
    )
    .get();
}

export function enqueue(type: string, payload: Record<string, unknown>, opts: { delayMs?: number; maxAttempts?: number } = {}) {
  const id = newId();
  db.insert(schema.jobs)
    .values({ id, type, payload, runAt: now() + (opts.delayMs ?? 0), maxAttempts: opts.maxAttempts ?? 3 })
    .run();
  setImmediate(tick);
  return id;
}

function claim(type: string) {
  const job = db
    .select()
    .from(schema.jobs)
    .where(and(eq(schema.jobs.type, type), eq(schema.jobs.status, 'queued'), lte(schema.jobs.runAt, now())))
    .orderBy(asc(schema.jobs.runAt))
    .limit(1)
    .get();
  if (!job) return undefined;
  db.update(schema.jobs)
    .set({ status: 'running', attempts: job.attempts + 1, updatedAt: now() })
    .where(eq(schema.jobs.id, job.id))
    .run();
  return { ...job, attempts: job.attempts + 1 };
}

async function run(reg: Registration, job: NonNullable<ReturnType<typeof claim>>) {
  reg.running++;
  try {
    await reg.handler(job.payload);
    db.update(schema.jobs).set({ status: 'done', error: null, updatedAt: now() }).where(eq(schema.jobs.id, job.id)).run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const retry = job.attempts < job.maxAttempts && !(err instanceof JobError && err.opts.retry === false);
    console.error(`[job] ${job.type} failed (attempt ${job.attempts}/${job.maxAttempts}): ${message}`);
    db.update(schema.jobs)
      .set({
        status: retry ? 'queued' : 'error',
        error: message.slice(0, 4000),
        // Back off 30s, 2m, 8m… unless the job knows better (e.g. a rate limit's reset time).
        runAt: now() + ((err instanceof JobError && err.opts.delayMs) || 30_000 * 4 ** (job.attempts - 1)),
        updatedAt: now(),
      })
      .where(eq(schema.jobs.id, job.id))
      .run();
    if (!retry) failureHooks.get(job.type)?.(job.payload, message);
  } finally {
    reg.running--;
    setImmediate(tick);
  }
}

const failureHooks = new Map<string, (payload: any, message: string) => void>();
/** Called once a job has used up its retries. */
export function onJobFailed(type: string, hook: (payload: any, message: string) => void) {
  failureHooks.set(type, hook);
}

function tick() {
  for (const [type, reg] of handlers) {
    while (reg.running < reg.concurrency) {
      const job = claim(type);
      if (!job) break;
      void run(reg, job);
    }
  }
}

export function startWorker() {
  // Jobs that were mid-flight when the process stopped get picked up again.
  db.update(schema.jobs).set({ status: 'queued' }).where(eq(schema.jobs.status, 'running')).run();
  timer = setInterval(tick, 2000);
  tick();
}

export function stopWorker() {
  if (timer) clearInterval(timer);
}
