// kie.ai: submit a generation task, poll it, download the result. `CS_HOSTED_API` points the calls at a stand-in.
// The request and response shapes follow kie.ai's market API (createTask / recordInfo); model ids and prices are
// settings (shared/hosted.ts) because they change.
import { writeFile } from 'node:fs/promises';
import type { GenAspect, GenKind } from '../../../../shared/generate';
import type { HostedModel } from '../../../../shared/hosted';
import { JobError } from '../../jobs/queue';
import { hostedKey } from './ledger';

const base = () => (process.env.CS_HOSTED_API || 'https://api.kie.ai').replace(/\/$/, '');

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = hostedKey();
  if (!key) throw new JobError('Add the kie.ai key in Settings → Models first.', { retry: false });
  let res: Response;
  try {
    res = await fetch(`${base()}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}`, ...init.headers },
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    throw new JobError(`kie.ai didn't answer: ${(err as Error).message}`, { wait: true, delayMs: 2 * 60_000 });
  }
  const text = await res.text();
  let body: { code?: number; msg?: string; data?: T } = {};
  try {
    body = JSON.parse(text);
  } catch {
    /* not JSON */
  }
  const code = body.code ?? res.status;
  if (res.status === 401 || code === 401) throw new JobError('kie.ai refused the key. Check it in Settings → Models.', { retry: false });
  if (res.status === 402 || code === 402) throw new JobError('kie.ai is out of credits. Top up at kie.ai.', { retry: false });
  if (res.status === 429 || code === 429) throw new JobError('kie.ai is rate limiting; waiting a bit.', { wait: true, delayMs: 3 * 60_000 });
  if (!res.ok || code !== 200) throw new Error(`kie.ai ${path}: ${body.msg || text.slice(0, 200) || res.status}`);
  return body.data as T;
}

const SIZE: Record<GenAspect, string> = { '9:16': '9:16', '16:9': '16:9', '1:1': '1:1' };

export type Submit = { kind: GenKind; model: HostedModel; prompt: string; negative: string; aspect: GenAspect; seed: number };

/** Start a task; returns its id. */
export async function submit(s: Submit): Promise<string> {
  const input: Record<string, unknown> =
    s.kind === 'video'
      ? {
          prompt: s.prompt,
          negative_prompt: s.negative,
          aspect_ratio: SIZE[s.aspect],
          resolution: s.model.resolution,
          duration: String(s.model.seconds),
          seed: s.seed,
          enable_prompt_expansion: false,
        }
      : { prompt: s.prompt, aspect_ratio: SIZE[s.aspect], resolution: s.model.resolution, seed: s.seed };
  const data = await call<{ taskId: string }>('/api/v1/jobs/createTask', { method: 'POST', body: JSON.stringify({ model: s.model.id, input }) });
  if (!data?.taskId) throw new Error('kie.ai gave no task id');
  return data.taskId;
}

type Record_ = { state: 'waiting' | 'queuing' | 'generating' | 'success' | 'fail'; resultJson?: string; failMsg?: string };

/** Wait for the task and return the result's address. */
export async function waitFor(taskId: string, kind: GenKind): Promise<string> {
  const deadline = Date.now() + (kind === 'video' ? 25 : 10) * 60_000;
  const gap = Number(process.env.CS_HOSTED_POLL_MS) || (kind === 'video' ? 10_000 : 4_000);
  while (Date.now() < deadline) {
    const r = await call<Record_>(`/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`);
    if (r.state === 'success') {
      const urls = (JSON.parse(r.resultJson || '{}') as { resultUrls?: string[] }).resultUrls;
      if (!urls?.[0]) throw new Error('kie.ai finished without a result');
      return urls[0];
    }
    if (r.state === 'fail') throw new Error(`kie.ai could not make it: ${r.failMsg || 'no reason given'}`);
    await new Promise((ok) => setTimeout(ok, gap));
  }
  throw new Error('kie.ai took too long');
}

export async function download(url: string, file: string) {
  const res = await fetch(url, { signal: AbortSignal.timeout(5 * 60_000) });
  if (!res.ok) throw new Error(`Downloading the result failed (${res.status})`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
}

/** Credits left at the service. */
export async function creditsLeft(): Promise<number> {
  return Number(await call<number>('/api/v1/chat/credit'));
}
