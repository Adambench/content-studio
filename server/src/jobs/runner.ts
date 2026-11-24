// Runs the queued jobs. Lanes keep the 1070 PC sane: one heavy job at a time (a make, a render), a few media looks,
// a few quick Claude jobs beside them. A job's steps are remembered, so one interrupted (a restart, a wait for
// Claude's usage window) goes on from the step it was in.

import type { Job, JobKind } from '../../../shared/types.ts';
import { errorText } from '../lib/util.ts';
import { addLog, claimNext, finishJob, getJob, jobInput, jobState, JobWait, markCancelled, onEnqueue, requeueInterrupted, saveState, setProgress } from './queue.ts';

export type JobContext = {
  job: Job;
  cardId: string | null;
  input: Record<string, unknown>;
  signal: AbortSignal;
  log: (text: string) => void;
  progress: (fraction: number, step?: string) => void;
  /** Run `fn` once per job: a later run of the same job gets the saved result instead. Results must be JSON. */
  step: <T>(name: string, fn: () => Promise<T>) => Promise<T>;
};

export type JobHandler = (ctx: JobContext) => Promise<void>;

type Lane = { name: string; slots: number; kinds: JobKind[]; running: number };

const handlers = new Map<JobKind, JobHandler>();
const lanes: Lane[] = [
  { name: 'heavy', slots: 1, kinds: ['make', 'fix', 'test-render'], running: 0 },
  { name: 'media', slots: 2, kinds: ['look'], running: 0 },
  { name: 'quick', slots: 3, kinds: ['write', 'hooks'], running: 0 },
];
const controllers = new Map<string, AbortController>();

export function registerJob(kind: JobKind, handler: JobHandler) {
  handlers.set(kind, handler);
}

let timer: NodeJS.Timeout | null = null;
let stopped = false;

export function startRunner() {
  requeueInterrupted();
  onEnqueue(() => tick());
  timer = setInterval(tick, 2_000);
  tick();
}

export async function stopRunner() {
  stopped = true;
  if (timer) clearInterval(timer);
  for (const c of controllers.values()) c.abort(new Error('Server stopping'));
}

export function cancelJob(id: string) {
  const running = controllers.get(id);
  if (running) running.abort(new Error('Cancelled'));
  else markCancelled(id);
  return getJob(id);
}

function tick() {
  if (stopped) return;
  for (const lane of lanes) {
    while (lane.running < lane.slots) {
      const kinds = lane.kinds.filter((k) => handlers.has(k));
      const job = claimNext(kinds);
      if (!job) break;
      lane.running++;
      void execute(job).finally(() => {
        lane.running--;
        tick();
      });
    }
  }
}

async function execute(job: Job) {
  const handler = handlers.get(job.kind)!;
  const controller = new AbortController();
  controllers.set(job.id, controller);
  const state = jobState(job.id);
  const steps = (state.steps ?? {}) as Record<string, unknown>;
  const ctx: JobContext = {
    job,
    cardId: job.cardId,
    input: jobInput(job.id),
    signal: controller.signal,
    log: (text) => addLog(job.id, text),
    progress: (fraction, step) => setProgress(job.id, fraction, step),
    step: async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
      if (name in steps) return steps[name] as T;
      const out = await fn();
      steps[name] = out ?? null;
      saveState(job.id, { ...state, steps });
      return out;
    },
  };
  try {
    await handler(ctx);
    finishJob(job.id, 'done');
  } catch (err) {
    if (controller.signal.aborted && !stopped) {
      addLog(job.id, 'Cancelled');
      finishJob(job.id, 'cancelled');
    } else if (stopped) {
      // Picked up again after the restart.
    } else if (err instanceof JobWait) {
      addLog(job.id, err.message);
      finishJob(job.id, 'waiting', { runAfter: Date.now() + err.delayMs, error: err.message });
    } else {
      const message = errorText(err);
      addLog(job.id, `Failed: ${message}`);
      finishJob(job.id, 'failed', { error: message });
      console.error(`[job ${job.kind} ${job.id}]`, err);
    }
  } finally {
    controllers.delete(job.id);
  }
}
