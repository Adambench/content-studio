// The self-hosted model server (Ollama's own API): found from Settings or a worker that hosts it, asked for JSON
// answers and for chat turns with tools. Nothing here knows about Claude; `route.ts` decides who answers.
import { DEFAULT_LOCAL_AI, type LocalAiConfig, type LocalAiStatus, type LocalModel } from '../../../shared/ai';
import { llmWorker } from '../compute/workers';
import { getSetting } from '../lib/settings';

export type LocalToolCall = { function: { name: string; arguments: Record<string, unknown> | string } };
export type LocalMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Base64 images (no data: prefix), for a model that sees. */
  images?: string[];
  tool_calls?: LocalToolCall[];
  tool_name?: string;
};
export type LocalTool = { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } };

export class LocalAiError extends Error {}

export const localConfig = (): LocalAiConfig => ({ ...DEFAULT_LOCAL_AI, ...getSetting('localAi') });

/** The address calls go to: the one set by hand, else the worker's. */
export function localAddress(): { url: string; source: 'settings' | 'worker'; worker: string | null } | null {
  const set = localConfig().url.trim().replace(/\/+$/, '');
  if (set) return { url: set, source: 'settings', worker: null };
  const w = llmWorker();
  return w ? { url: w.url, source: 'worker', worker: w.name } : null;
}

type Tags = { models?: { name: string; size?: number }[] };
type Show = { capabilities?: string[] };

let cached: { at: number; key: string; status: LocalAiStatus } | null = null;
const CACHE_MS = 20_000;

/** Whether the server answers, its models and the one calls use; cached for a few seconds. */
export async function localStatus(fresh = false): Promise<LocalAiStatus> {
  const addr = localAddress();
  const cfg = localConfig();
  const key = `${addr?.url}|${cfg.model}`;
  if (!fresh && cached && cached.key === key && Date.now() - cached.at < CACHE_MS) return cached.status;
  const status: LocalAiStatus = { url: addr?.url ?? null, source: addr?.source ?? null, worker: addr?.worker ?? null, reachable: false, models: [], model: null, error: null };
  if (!addr) status.error = 'No model server: set its address, or set up a worker with the text model.';
  else {
    try {
      const tags = (await (await fetchOk(`${addr.url}/api/tags`, { signal: AbortSignal.timeout(5000) })).json()) as Tags;
      status.reachable = true;
      status.models = await Promise.all(
        (tags.models ?? []).map(async (m): Promise<LocalModel> => {
          const caps = await fetchOk(`${addr.url}/api/show`, { method: 'POST', body: JSON.stringify({ model: m.name }), signal: AbortSignal.timeout(5000) })
            .then((r) => r.json() as Promise<Show>)
            .then((s) => s.capabilities ?? [])
            .catch(() => [] as string[]);
          return { name: m.name, sizeGb: Math.round(((m.size ?? 0) / 1e9) * 10) / 10, vision: caps.includes('vision'), tools: caps.includes('tools') };
        }),
      );
      const chosen = cfg.model && status.models.find((m) => m.name === cfg.model);
      status.model = chosen ? chosen.name : (status.models.find((m) => m.tools)?.name ?? status.models[0]?.name ?? null);
      if (cfg.model && !chosen) status.error = `The server doesn’t have ${cfg.model}; using ${status.model ?? 'nothing'}.`;
      else if (!status.model) status.error = 'The server has no models yet (ollama pull …).';
    } catch (err) {
      status.error = `Can’t reach ${addr.url}: ${(err as Error).message}`;
    }
  }
  cached = { at: Date.now(), key, status };
  return status;
}

/** Ready for calls: reachable with a model. */
export async function localReady() {
  const s = await localStatus();
  return s.reachable && !!s.model;
}

async function fetchOk(url: string, init: RequestInit = {}) {
  const res = await fetch(url, { ...init, headers: { 'content-type': 'application/json', ...init.headers } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let message = text;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      /* plain text */
    }
    throw new LocalAiError(`${res.status} ${message.slice(0, 300)}`.trim());
  }
  return res;
}

/** A rough token count (no tokenizer here): about 3.5 characters a token, images ~800 each. */
export const roughTokens = (messages: LocalMessage[]) => messages.reduce((n, m) => n + Math.ceil(m.content.length / 3.5) + (m.images?.length ?? 0) * 800, 0);

export type LocalReply = { content: string; toolCalls: LocalToolCall[]; promptTokens: number; outputTokens: number; model: string };

/**
 * One turn on the local model. `format` is a JSON schema the answer must match (decoding is held to it); `tools` lets
 * it call tools instead of answering. Streams text through `onText`.
 */
export async function localChat(input: {
  messages: LocalMessage[];
  tools?: LocalTool[];
  format?: Record<string, unknown>;
  temperature?: number;
  signal?: AbortSignal;
  onText?: (text: string) => void;
}): Promise<LocalReply> {
  const status = await localStatus();
  if (!status.reachable || !status.model) throw new LocalAiError(status.error ?? 'The local model server isn’t ready.');
  const { contextTokens } = localConfig();
  const need = roughTokens(input.messages) + (input.tools?.length ? Math.ceil(JSON.stringify(input.tools).length / 3.5) : 0);
  if (need > contextTokens - 1024) {
    throw new LocalAiError(`This is too long for the local model (about ${need} tokens; its window is ${contextTokens}). Raise the context in Settings → Models, or use Claude for this.`);
  }
  if (input.messages.some((m) => m.images?.length) && !status.models.find((m) => m.name === status.model)?.vision) {
    throw new LocalAiError(`${status.model} can’t see pictures: pick a vision model (e.g. qwen3-vl) in Settings → Models.`);
  }
  const res = await fetchOk(`${status.url}/api/chat`, {
    method: 'POST',
    signal: input.signal,
    body: JSON.stringify({
      model: status.model,
      messages: input.messages,
      tools: input.tools?.length ? input.tools : undefined,
      format: input.format,
      stream: true,
      // Thinking costs minutes on these cards; the prompts carry the reasoning steps instead.
      think: false,
      // Kept loaded between calls (the next one usually follows soon); a video job on the worker unloads it first.
      keep_alive: '30m',
      options: { num_ctx: contextTokens, temperature: input.temperature ?? 0.6 },
    }),
  });
  if (!res.body) throw new LocalAiError('The model server sent nothing back.');
  const reply: LocalReply = { content: '', toolCalls: [], promptTokens: 0, outputTokens: 0, model: status.model };
  const decoder = new TextDecoder();
  let buffer = '';
  const take = (line: string) => {
    if (!line.trim()) return;
    const chunk = JSON.parse(line) as { message?: { content?: string; tool_calls?: LocalToolCall[] }; done?: boolean; error?: string; prompt_eval_count?: number; eval_count?: number };
    if (chunk.error) throw new LocalAiError(chunk.error);
    if (chunk.message?.content) {
      reply.content += chunk.message.content;
      input.onText?.(chunk.message.content);
    }
    if (chunk.message?.tool_calls?.length) reply.toolCalls.push(...chunk.message.tool_calls);
    if (chunk.done) {
      reply.promptTokens = chunk.prompt_eval_count ?? 0;
      reply.outputTokens = chunk.eval_count ?? 0;
    }
  };
  for await (const part of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(part, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      take(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
  }
  take(buffer);
  return reply;
}

/** A JSON answer matching `schema` from the local model; one more try when it doesn't parse. */
export async function localStructured<T>(input: { system: string; prompt: string; schema: Record<string, unknown>; images?: { data: string }[] }): Promise<T> {
  const messages: LocalMessage[] = [
    { role: 'system', content: `${input.system}\n\nAnswer with one JSON object only, matching this JSON schema:\n${JSON.stringify(input.schema)}` },
    { role: 'user', content: input.prompt, images: input.images?.map((i) => i.data) },
  ];
  let last = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const reply = await localChat({ messages, format: input.schema, temperature: attempt ? 0.2 : 0.5 });
    last = reply.content;
    try {
      return JSON.parse(stripFence(reply.content)) as T;
    } catch {
      messages.push({ role: 'assistant', content: reply.content }, { role: 'user', content: 'That wasn’t valid JSON. Send the JSON object only.' });
    }
  }
  throw new LocalAiError(`The local model didn’t return JSON: ${last.slice(0, 200)}`);
}

const stripFence = (text: string) => text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
