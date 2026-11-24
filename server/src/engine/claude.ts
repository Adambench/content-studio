// Claude, through the Agent SDK on my Pro login (never an API key). Every call names its task, is counted, and
// background calls wait while the 5-hour usage is high; what I pressed and wait on never waits.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { query, type Options, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { config } from '../config.ts';
import { getSetting, run as sql, setSetting } from '../db/db.ts';
import { JobWait } from '../jobs/queue.ts';
import { newId, now } from '../lib/util.ts';

export type Task = 'write' | 'hooks' | 'pick' | 'plan' | 'review' | 'fix' | 'lesson' | 'market' | 'test';

/** Every creative choice and review on Opus; reading the market's videos is lighter work. */
const MODEL: Record<Task, string> = { write: 'opus', hooks: 'opus', pick: 'opus', plan: 'opus', review: 'opus', fix: 'opus', lesson: 'opus', market: 'sonnet', test: 'haiku' };

const BACKGROUND_LIMIT = 0.8;

type Usage = { fiveHour?: { utilization: number; resetsAt: number }; sevenDay?: { utilization: number; resetsAt: number }; status?: string; updatedAt: number };

function baseOptions(): Options {
  // An ANTHROPIC_API_KEY in the environment would take precedence over the login and bill that key: drop it.
  const { ANTHROPIC_API_KEY: _drop, ...env } = process.env;
  return {
    cwd: config.claudeDir,
    env: { ...env, CLAUDE_AGENT_SDK_CLIENT_APP: `content-studio/${config.version}`, ENABLE_CLAUDEAI_MCP_SERVERS: 'false' },
    // None of my personal Claude Code settings, hooks or CLAUDE.md files.
    settingSources: [],
  };
}

export function claudeStatus(): { loggedIn: boolean; detail: string } {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return { loggedIn: true, detail: 'Token from the environment' };
  const creds = join(homedir(), '.claude/.credentials.json');
  if (!existsSync(creds)) return { loggedIn: false, detail: 'Not logged in: run `claude` on this machine and /login' };
  try {
    const c = JSON.parse(readFileSync(creds, 'utf8')) as { claudeAiOauth?: { subscriptionType?: string } };
    return { loggedIn: !!c.claudeAiOauth, detail: c.claudeAiOauth?.subscriptionType ? `Claude ${c.claudeAiOauth.subscriptionType}` : 'Logged in' };
  } catch {
    return { loggedIn: true, detail: 'Logged in' };
  }
}

export const claudeUsage = () => getSetting<Usage | null>('claudeUsage', null);

/** For background work: a JobWait while the 5-hour window is above 80 %, until a minute after it resets. */
export function waitForUsage() {
  const limited = getSetting<number>('claudeLimitedUntil', 0);
  if (limited > now()) throw new JobWait('Claude refused for usage: trying again in an hour', limited - now());
  const five = claudeUsage()?.fiveHour;
  if (!five || five.utilization < BACKGROUND_LIMIT || five.resetsAt <= now()) return;
  const delay = five.resetsAt - now() + 60_000;
  const at = new Date(now() + delay).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  throw new JobWait(`Waiting for Claude's 5-hour usage to come down (${Math.round(five.utilization * 100)} %), until about ${at}`, delay);
}

type RateInfo = { status?: string; rateLimitType?: string; utilization?: number; resetsAt?: number; unifiedWindows?: Record<string, { utilization: number; resetsAt: number }> };

function recordRate(info: RateInfo) {
  const w = info.unifiedWindows ?? {};
  const pick = (name: string) => w[name] ?? (info.rateLimitType === name && info.utilization !== undefined && info.resetsAt ? { utilization: info.utilization, resetsAt: info.resetsAt } : undefined);
  const five = pick('five_hour');
  const seven = pick('seven_day');
  const prev = claudeUsage();
  setSetting('claudeUsage', {
    status: info.status,
    fiveHour: five ? { utilization: five.utilization, resetsAt: five.resetsAt * 1000 } : prev?.fiveHour,
    sevenDay: seven ? { utilization: seven.utilization, resetsAt: seven.resetsAt * 1000 } : prev?.sevenDay,
    updatedAt: now(),
  } satisfies Usage);
}

const isUsageError = (text: string) => /usage limit|rate.?limit|limit reached|out of extra usage/i.test(text);

export type Image = { path: string } | { data: string; mediaType: 'image/jpeg' | 'image/png' };

function imageBlock(img: Image) {
  const data = 'path' in img ? readFileSync(img.path).toString('base64') : img.data;
  const mediaType = 'path' in img ? (img.path.endsWith('.png') ? 'image/png' : 'image/jpeg') : img.mediaType;
  return { type: 'image' as const, source: { type: 'base64' as const, media_type: mediaType, data } };
}

async function* withImages(text: string, images: Image[]): AsyncGenerator<SDKUserMessage> {
  yield { type: 'user', parent_tool_use_id: null, message: { role: 'user', content: [...images.map(imageBlock), { type: 'text' as const, text }] } };
}

export type AskInput<S extends z.ZodType> = {
  task: Task;
  system: string;
  prompt: string;
  schema: S;
  images?: Image[];
  model?: string;
  /** I pressed for it and I'm waiting: never wait for the usage window. */
  now?: boolean;
  cardId?: string | null;
  jobId?: string | null;
  signal?: AbortSignal;
};

/** One answer from Claude in the shape of `schema`, with no tools. */
export async function ask<S extends z.ZodType>(input: AskInput<S>): Promise<z.infer<S>> {
  if (!input.now) waitForUsage();
  const model = input.model ?? MODEL[input.task];
  const abortController = new AbortController();
  input.signal?.addEventListener('abort', () => abortController.abort(), { once: true });
  const started = now();
  const q = query({
    prompt: input.images?.length ? withImages(input.prompt, input.images) : input.prompt,
    options: {
      ...baseOptions(),
      model,
      systemPrompt: input.system,
      tools: [],
      outputFormat: { type: 'json_schema', schema: z.toJSONSchema(input.schema, { target: 'draft-7' }) as Record<string, unknown> },
      persistSession: false,
      maxTurns: 4,
      abortController,
    },
  });
  let usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  let ok = false;
  try {
    for await (const message of q) {
      if (message.type === 'rate_limit_event') recordRate((message as { rate_limit_info: RateInfo }).rate_limit_info);
      if (message.type !== 'result') continue;
      usage = { ...usage, ...(message.usage as typeof usage) };
      if (message.subtype !== 'success') {
        const why = ('errors' in message && message.errors?.join('; ')) || message.subtype;
        if (isUsageError(String(why))) setSetting('claudeLimitedUntil', now() + 60 * 60_000);
        throw new Error(`Claude couldn't finish: ${why}`);
      }
      if (message.structured_output === undefined) throw new Error('Claude gave no structured answer');
      const parsed = input.schema.safeParse(message.structured_output);
      if (!parsed.success) throw new Error(`Claude's answer didn't fit: ${parsed.error.message.slice(0, 300)}`);
      ok = true;
      return parsed.data;
    }
    throw new Error('Claude ended without an answer');
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    if (isUsageError(text)) setSetting('claudeLimitedUntil', now() + 60 * 60_000);
    throw err;
  } finally {
    sql(
      'INSERT INTO claude_calls (id, task, model, card_id, job_id, input_tokens, output_tokens, cache_read, cache_write, ms, ok, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      newId(),
      input.task,
      model,
      input.cardId ?? null,
      input.jobId ?? null,
      usage.input_tokens ?? 0,
      usage.output_tokens ?? 0,
      usage.cache_read_input_tokens ?? 0,
      usage.cache_creation_input_tokens ?? 0,
      now() - started,
      ok,
      now(),
    );
  }
}

/** The text of a skill (SKILL.md, or one of its files) to paste into a prompt: background calls load no skills. */
export function skill(name: string, file = 'SKILL.md'): string {
  const p = join(config.skillsDir, name, file);
  if (!existsSync(p)) return '';
  return readFileSync(p, 'utf8').replace(/^---[\s\S]*?---\n/, '').trim();
}
