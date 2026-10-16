// The dispatcher for compute workers (shared/compute.ts). Callers ask `runTool`; when a worker that has the tool is
// online the task waits in a queue for it to poll, otherwise (or when the worker is lost, or its run fails) the same
// command runs here on the laptop. Workers are paired devices of kind 'worker'; everything they may call is under
// /api/worker/. Tasks live in memory: a restart of the laptop's server makes its callers' jobs run again.
import { createReadStream, existsSync } from 'node:fs';
import { rename, rm, stat } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { COMPUTE_TOOLS, TOOL_INFO, WORKER_ONLINE_MS, type ComputeTool, type ToolParams, type WorkerInfo, type WorkerReport, type WorkerTask } from '../../../shared/compute';
import { db, newId, now, schema } from '../db';
import { emit } from '../lib/events';

type Task = {
  id: string;
  tool: ComputeTool;
  params: ToolParams;
  /** Name → path on the laptop, for the inputs (read) and the outputs (written when the worker sends them). */
  files: Record<string, string>;
  timeoutMs: number;
  status: 'queued' | 'running' | 'done' | 'failed';
  workerId: string | null;
  leaseUntil: number;
  attempts: number;
  progress: string;
  stdout: string;
  error: string;
  uploaded: Set<string>;
  onProgress?: (text: string) => void;
  settle: (r: { ok: true; stdout: string; on: string } | { ok: false; reason: 'no-worker' | 'lost' | 'failed'; message: string }) => void;
};

type WorkerState = { name: string; gpu: string; tools: ComputeTool[]; lastPoll: number; taskId: string | null; speed: WorkerInfo['speed'] };

const LEASE_MS = 90_000;
const tasks = new Map<string, Task>();
const workers = new Map<string, WorkerState>();

const online = (w: WorkerState) => now() - w.lastPoll < WORKER_ONLINE_MS;
const changed = () => emit({ type: 'changed', entity: 'compute' });

/** Whether some online worker has the tool (so a task is worth queueing). */
export const workerFor = (tool: ComputeTool) => [...workers.values()].some((w) => online(w) && w.tools.includes(tool));

export type RemoteResult = { ok: true; stdout: string; on: string } | { ok: false; reason: 'no-worker' | 'lost' | 'failed'; message: string };

/** Queue a task for a worker and wait for it. Resolves with why it couldn't be done when the caller should run it here. */
export function runRemote(tool: ComputeTool, files: Record<string, string>, params: ToolParams, opts: { timeoutMs: number; onProgress?: (text: string) => void }): Promise<RemoteResult> {
  if (!workerFor(tool)) return Promise.resolve({ ok: false, reason: 'no-worker', message: 'No worker has this tool.' });
  return new Promise((resolve) => {
    const id = newId();
    tasks.set(id, {
      id,
      tool,
      params,
      files,
      timeoutMs: opts.timeoutMs,
      status: 'queued',
      workerId: null,
      leaseUntil: 0,
      attempts: 0,
      progress: '',
      stdout: '',
      error: '',
      uploaded: new Set(),
      onProgress: opts.onProgress,
      settle: (r) => {
        tasks.delete(id);
        changed();
        resolve(r);
      },
    });
    changed();
  });
}

/** Lost workers' tasks go back to the queue once; a second loss, or no worker left for the tool, sends them to the laptop. */
function sweep() {
  for (const t of tasks.values()) {
    if (t.status === 'running' && t.leaseUntil < now()) {
      const w = t.workerId ? workers.get(t.workerId) : undefined;
      if (w) w.taskId = null;
      if (t.attempts >= 2) t.settle({ ok: false, reason: 'lost', message: 'The worker stopped answering.' });
      else {
        t.status = 'queued';
        t.workerId = null;
        changed();
      }
    } else if (t.status === 'queued' && !workerFor(t.tool)) {
      t.settle({ ok: false, reason: 'no-worker', message: 'The worker went offline.' });
    }
  }
}
const timer = setInterval(sweep, 10_000);
timer.unref();

/** A worker polls: hand it the first queued task it can run, waiting a while for one to appear. */
export async function poll(workerId: string, name: string, report: WorkerReport, signal: { aborted: boolean }): Promise<WorkerTask | null> {
  const before = workers.get(workerId);
  const state: WorkerState = { name, gpu: report.gpu, tools: report.tools.filter((t) => COMPUTE_TOOLS.includes(t)), lastPoll: now(), taskId: before?.taskId ?? null, speed: report.speed ?? before?.speed ?? null };
  workers.set(workerId, state);
  if (!before || !online(before) || before.gpu !== state.gpu || before.tools.join() !== state.tools.join()) changed();
  const deadline = now() + 25_000;
  while (!signal.aborted && now() < deadline) {
    state.lastPoll = now();
    const t = [...tasks.values()].find((x) => x.status === 'queued' && state.tools.includes(x.tool));
    if (t && !state.taskId) {
      t.status = 'running';
      t.workerId = workerId;
      t.attempts++;
      t.leaseUntil = now() + LEASE_MS;
      state.taskId = t.id;
      changed();
      const inputs = await Promise.all(
        TOOL_INFO[t.tool].inputs.map(async (n) => ({ name: n, size: (await stat(t.files[n]).catch(() => null))?.size ?? 0 })),
      );
      return { id: t.id, tool: t.tool, params: t.params, inputs, outputs: TOOL_INFO[t.tool].outputs, timeoutMs: t.timeoutMs };
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}

function owned(workerId: string, taskId: string) {
  const t = tasks.get(taskId);
  return t && t.workerId === workerId && t.status === 'running' ? t : null;
}

export function inputStream(workerId: string, taskId: string, name: string) {
  const t = owned(workerId, taskId);
  const path = t && TOOL_INFO[t.tool].inputs.includes(name) ? t.files[name] : null;
  if (!t || !path || !existsSync(path)) return null;
  t.leaseUntil = now() + LEASE_MS;
  return createReadStream(path);
}

/** Where an output file is written (a part file beside it until the worker says it is done). */
export function outputPath(workerId: string, taskId: string, name: string) {
  const t = owned(workerId, taskId);
  if (!t || !TOOL_INFO[t.tool].outputs.includes(name)) return null;
  t.leaseUntil = now() + LEASE_MS;
  return `${t.files[name]}.part`;
}

export function progress(workerId: string, taskId: string, text: string) {
  const t = owned(workerId, taskId);
  if (!t) return false;
  t.leaseUntil = now() + LEASE_MS;
  t.progress = text.slice(0, 200);
  t.onProgress?.(t.progress);
  return true;
}

export async function finish(workerId: string, taskId: string, result: { ok: boolean; stdout?: string; message?: string }) {
  const t = owned(workerId, taskId);
  if (!t) return false;
  const w = workers.get(workerId);
  if (w) w.taskId = null;
  if (!result.ok) {
    t.settle({ ok: false, reason: 'failed', message: (result.message ?? 'The tool failed.').slice(0, 400) });
    return true;
  }
  try {
    for (const name of TOOL_INFO[t.tool].outputs) {
      const part = `${t.files[name]}.part`;
      if (!existsSync(part)) throw new Error(`The worker didn’t send ${name}.`);
      await rename(part, t.files[name]);
    }
    t.settle({ ok: true, stdout: result.stdout ?? '', on: w?.name ?? 'a worker' });
  } catch (err) {
    await Promise.all(TOOL_INFO[t.tool].outputs.map((n) => rm(`${t.files[n]}.part`, { force: true })));
    t.settle({ ok: false, reason: 'failed', message: (err as Error).message });
  }
  return true;
}

/** The worker's self-test result, kept for the speed comparison in Settings. */
export function recordSpeed(workerId: string, speed: WorkerInfo['speed']) {
  const w = workers.get(workerId);
  if (w) w.speed = speed;
  changed();
}

/** Paired workers with what they last said, for Settings → Compute. */
export function listWorkers(): WorkerInfo[] {
  return db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.kind, 'worker'))
    .all()
    .map((s) => {
      const w = workers.get(s.id);
      const t = w?.taskId ? tasks.get(w.taskId) : undefined;
      return {
        id: s.id,
        name: s.name ?? 'Worker',
        gpu: w?.gpu ?? '',
        tools: w?.tools ?? [],
        online: !!w && online(w),
        lastSeenAt: w?.lastPoll ?? s.lastSeenAt,
        task: t ? { tool: t.tool, progress: t.progress } : null,
        speed: w?.speed ?? null,
      };
    });
}

export function forgetWorker(id: string) {
  workers.delete(id);
  for (const t of tasks.values()) if (t.workerId === id) t.leaseUntil = 0;
  sweep();
  changed();
}
