// Claude, through the Agent SDK on my Pro login (never an API key). Every call names its task, is counted, and
// background calls wait while the 5-hour usage is high; what I pressed and wait on never waits.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { query, type Options, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { config, keys } from '../config.ts';
import type { ClaudeCall } from '../../../shared/types.ts';
import { all, getSetting, run as sql, setSetting } from '../db/db.ts';
import { JobWait } from '../jobs/queue.ts';
import { newId, now } from '../lib/util.ts';

export type Task = 'agent' | 'write' | 'pick' | 'review' | 'lesson' | 'market' | 'test';

/** Every creative choice and review on Opus; reading the market's videos is lighter work. */
const MODEL: Record<Task, string> = { agent: 'opus', write: 'opus', pick: 'opus', review: 'opus', lesson: 'opus', market: 'sonnet', test: 'haiku' };

const BACKGROUND_LIMIT = 0.8;
const WEEK_LIMIT = 0.9;

type Usage = { fiveHour?: { utilization: number; resetsAt: number }; sevenDay?: { utilization: number; resetsAt: number }; status?: string; updatedAt: number };

/** Claude's environment: the Pro login, never an API key. Also what the terminal's `claude` gets. */
export function claudeEnv(): Record<string, string> {
  // An ANTHROPIC_API_KEY in the environment would take precedence over the login and bill that key: drop it.
  const { ANTHROPIC_API_KEY: _drop, ...env } = process.env;
  // The login can be a long-lived token (`claude setup-token`) kept in the keys file instead of ~/.claude.
  const token = keys().CLAUDE_CODE_OAUTH_TOKEN;
  return { ...(env as Record<string, string>), ...(token ? { CLAUDE_CODE_OAUTH_TOKEN: token } : {}), CLAUDE_AGENT_SDK_CLIENT_APP: `content-studio/${config.version}`, ENABLE_CLAUDEAI_MCP_SERVERS: 'false' };
}

function baseOptions(): Options {
  // One-off answers load none of my Claude Code settings, hooks, skills or CLAUDE.md files.
  return { cwd: config.claudeDir, env: claudeEnv(), settingSources: [] };
}

export function claudeStatus(): { loggedIn: boolean; detail: string } {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN || keys().CLAUDE_CODE_OAUTH_TOKEN) return { loggedIn: true, detail: 'Logged in (token)' };
  const creds = join(homedir(), '.claude/.credentials.json');
  if (!existsSync(creds)) return { loggedIn: false, detail: 'Not logged in: `claude setup-token`, then CLAUDE_CODE_OAUTH_TOKEN in keys.env' };
  try {
    const c = JSON.parse(readFileSync(creds, 'utf8')) as { claudeAiOauth?: { subscriptionType?: string } };
    const plan = c.claudeAiOauth?.subscriptionType;
    return { loggedIn: !!c.claudeAiOauth, detail: plan ? `Logged in (${plan[0]!.toUpperCase()}${plan.slice(1)})` : 'Logged in' };
  } catch {
    return { loggedIn: true, detail: 'Logged in' };
  }
}

export const claudeUsage = () => getSetting<Usage | null>('claudeUsage', null);

/** The plan's usage now (0..1); null for a window that has reset since it was last reported (its number is stale). */
export function usageNow(): { five: number | null; week: number | null } {
  const u = claudeUsage();
  const live = (w?: { utilization: number; resetsAt: number }) => (w && w.resetsAt > now() ? w.utilization : null);
  return { five: live(u?.fiveHour), week: live(u?.sevenDay) };
}

/** For background work: a JobWait while the 5-hour window is above 80 %, until a minute after it resets. */
export function waitForUsage() {
  const limited = getSetting<number>('claudeLimitedUntil', 0);
  if (limited > now()) throw new JobWait('Claude refused for usage: trying again in an hour', limited - now());
  const usage = claudeUsage();
  // The week's last 10 % stay for what I press (its window resets once a week, so waiting can take a night).
  for (const [w, limit, what] of [[usage?.fiveHour, BACKGROUND_LIMIT, '5-hour'], [usage?.sevenDay, WEEK_LIMIT, 'weekly']] as const) {
    if (!w || w.utilization < limit || w.resetsAt <= now()) continue;
    const delay = w.resetsAt - now() + 60_000;
    const at = new Date(now() + delay).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    throw new JobWait(`Waiting for Claude's ${what} usage to come down (${Math.round(w.utilization * 100)} %), until about ${at}`, delay);
  }
}

export type RateInfo = { status?: string; rateLimitType?: string; utilization?: number; resetsAt?: number; unifiedWindows?: Record<string, { utilization: number; resetsAt: number }> };

export function recordRate(info: RateInfo) {
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

export const isUsageError = (text: string) => /usage limit|rate.?limit|limit reached|out of extra usage/i.test(text);

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
  videoId?: string | null;
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
    recordCall({ task: input.task, model, videoId: input.videoId ?? null, jobId: input.jobId ?? null, usage, ms: now() - started, ok });
  }
}

export type CallUsage = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };

/** What an agent run adds to its usage: round trips, the API-price estimate, contexts, a new session, the plan's usage. */
export type RunCost = { turns?: number; costUsd?: number; peakContext?: number; lastContext?: number; fresh?: boolean; before?: ReturnType<typeof usageNow>; after?: ReturnType<typeof usageNow> };

/** Every Claude run counted, by task, so the targets can be checked. */
export function recordCall(c: { task: Task; model: string; videoId: string | null; jobId: string | null; usage: CallUsage; ms: number; ok: boolean; cost?: RunCost }) {
  const r = c.cost ?? {};
  sql(
    `INSERT INTO claude_calls (id, task, model, video_id, job_id, input_tokens, output_tokens, cache_read, cache_write, ms, ok, created_at,
       turns, cost_usd, peak_context, last_context, fresh, five_before, five_after, week_before, week_after) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    newId(),
    c.task,
    c.model,
    c.videoId,
    c.jobId,
    c.usage.input_tokens ?? 0,
    c.usage.output_tokens ?? 0,
    c.usage.cache_read_input_tokens ?? 0,
    c.usage.cache_creation_input_tokens ?? 0,
    c.ms,
    c.ok,
    now(),
    r.turns ?? 0,
    r.costUsd ?? 0,
    r.peakContext ?? 0,
    r.lastContext ?? 0,
    r.fresh ? 1 : 0,
    r.before?.five ?? null,
    r.after?.five ?? null,
    r.before?.week ?? null,
    r.after?.week ?? null,
  );
}

type CallRow = {
  id: string; task: string; model: string; video_id: string | null; title: string | null; input_tokens: number; output_tokens: number; cache_read: number; cache_write: number;
  turns: number; cost_usd: number; peak_context: number; last_context: number; fresh: number; five_before: number | null; five_after: number | null; week_before: number | null; week_after: number | null; ms: number; ok: number; created_at: number;
};

/** The newest runs (of one video, or all), newest first. */
export function listCalls(videoId?: string, limit = 40): ClaudeCall[] {
  return all<CallRow>(
    `SELECT c.*, v.title FROM claude_calls c LEFT JOIN videos v ON v.id = c.video_id ${videoId ? 'WHERE c.video_id = ?' : ''} ORDER BY c.created_at DESC LIMIT ?`,
    ...(videoId ? [videoId, limit] : [limit]),
  ).map((r) => ({
    id: r.id, task: r.task, model: r.model, videoId: r.video_id, videoTitle: r.title, inputTokens: r.input_tokens, outputTokens: r.output_tokens, cacheRead: r.cache_read, cacheWrite: r.cache_write,
    turns: r.turns, costUsd: r.cost_usd, peakContext: r.peak_context, lastContext: r.last_context, fresh: !!r.fresh, fiveBefore: r.five_before, fiveAfter: r.five_after, weekBefore: r.week_before, weekAfter: r.week_after,
    ms: r.ms, ok: !!r.ok, createdAt: r.created_at,
  }));
}

/** Skills whose description every run sees (the editing ones); the rest are listed by name and still open by name. */
const DESCRIBED_SKILLS = new Set(['playbook', 'content-principles', 'edit-video', 'hyperframes', 'hyperframes-core', 'embedded-captions', 'studio-script']);

/**
 * Settings for every Claude Code the studio starts (the runs and the Terminal), measured 2026-11-25: the skill list
 * was 9.9 k tokens on every turn, 1.4 k this way. No bundled dev skills (code review, the API, schedules), and a long
 * session compacts at 150 k instead of near the 1 M window's end.
 */
export function studioSettings() {
  const names = existsSync(config.skillsDir) ? readdirSync(config.skillsDir) : [];
  return {
    skillOverrides: Object.fromEntries(names.filter((n) => !DESCRIBED_SKILLS.has(n)).map((n) => [n, 'name-only' as const])),
    disableBundledSkills: true,
    autoCompactWindow: 150_000,
  };
}

/** The text of a skill (SKILL.md, or one of its files) to paste into a prompt: background calls load no skills. */
export function skill(name: string, file = 'SKILL.md'): string {
  const p = join(config.skillsDir, name, file);
  if (!existsSync(p)) return '';
  return readFileSync(p, 'utf8').replace(/^---[\s\S]*?---\n/, '').trim();
}
