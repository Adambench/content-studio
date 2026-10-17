// The chat on the self-hosted model: its own tool loop over Ollama's chat API, calling the same studio tools as
// Claude's chat (same handlers, same workspace checks; none of them schedules, publishes, approves or submits). Skills
// open through `read_skill`, pages through `web_fetch`; there's no web search.
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { ChatPart, ChatStreamEvent } from '../../../shared/types';
import { chatSkillList, readSkillFile } from '../claude/plugin';
import { SERVER_NAME, toolLabel } from '../claude/tools';
import { db, newId, schema } from '../db';
import { localChat, localConfig, roughTokens, type LocalMessage, type LocalTool, type LocalToolCall } from './local';

const MAX_TURNS = 40;
const MAX_RESULT_CHARS = 24_000;

type Result = CallToolResult;
/** A studio tool as `tool()` makes it (the handlers take their own argument types). */
type Def = { name: string; description: string; inputSchema: Record<string, z.ZodType>; handler: (args: any, extra: unknown) => Promise<Result> };

/** What a local chat turn needs from runChat: the same parts, events and persistence as Claude's. */
export type LocalTurn = {
  threadId: string;
  /** The user's message and the assistant's placeholder, left out of the history. */
  skipMessageIds: string[];
  text: string;
  systemPrompt: string;
  tools: Def[];
  parts: ChatPart[];
  signal: AbortSignal;
  onEvent: (e: ChatStreamEvent) => void;
  persist: () => void;
};

const LOCAL_NOTE = (skills: { name: string; description: string }[]) =>
  `## How tools work in this chat
- You run on the creator's own model here, not as Claude: the tools below are all you have. Call one tool at a time when a later step needs its answer; read what it returns before you go on.
- Skills open with read_skill instead of Skill/Read: read_skill({ "name": "playbook" }) for the SKILL.md, then read_skill({ "name": "playbook", "file": "references/hooks.md" }) for a file it points to. Wherever these instructions say to open or Read a skill, use read_skill.
- web_fetch reads one web page as text; there's no web search.
- Answer in the creator's language, briefly. Never claim a tool did something it didn't report.

Skills you can open: ${skills.map((s) => `${s.name} (${s.description})`).join('; ')}`;

function extraTools(): Def[] {
  const text = (t: string): Result => ({ content: [{ type: 'text', text: t }] });
  const fail = (t: string): Result => ({ content: [{ type: 'text', text: t }], isError: true });
  return [
    {
      name: 'read_skill',
      description: 'Open one of the skills: its SKILL.md, or one of its own files (e.g. references/hooks.md).',
      inputSchema: { name: z.string().describe('The skill, e.g. playbook'), file: z.string().optional().describe('A file inside the skill, relative to its folder') },
      handler: async ({ name, file }: { name: string; file?: string }) => {
        try {
          return text(readSkillFile(name, file).slice(0, MAX_RESULT_CHARS));
        } catch (err) {
          return fail((err as Error).message);
        }
      },
    },
    {
      name: 'web_fetch',
      description: 'Read a public web page as plain text (first ~20,000 characters).',
      inputSchema: { url: z.string().describe('The full http(s) address') },
      handler: async ({ url }: { url: string }) => {
        try {
          return text(await fetchPage(url));
        } catch (err) {
          return fail((err as Error).message);
        }
      },
    },
  ];
}

/** Only public addresses: the chat can't be steered into this computer's or the home network's services. */
async function fetchPage(url: string) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new Error('Only http and https pages.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^(localhost|.*\.local|.*\.internal|.*\.ts\.net)$/i.test(host) || /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(host) || host.includes(':')) {
    throw new Error('That address is on a private network.');
  }
  const res = await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(20_000), headers: { 'user-agent': 'Mozilla/5.0 (Content Studio)' } });
  if (!res.ok) throw new Error(`The page answered ${res.status}.`);
  const html = (await res.text()).slice(0, 2_000_000);
  const textOnly = html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
  return `${res.url}\n\n${textOnly.slice(0, 20_000)}`;
}

/** The tools as the model sees them: their zod shapes turned into JSON schema. */
function describe(defs: Def[]): LocalTool[] {
  return defs.map((d) => {
    const { $schema: _s, ...parameters } = z.toJSONSchema(z.object(d.inputSchema), { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
    return { type: 'function', function: { name: d.name, description: d.description, parameters } };
  });
}

/** Earlier turns of this chat, newest last, as much as fits in about half the context window. */
function history(threadId: string, skip: string[], budget: number): LocalMessage[] {
  const rows = db.select().from(schema.chatMessages).where(eq(schema.chatMessages.threadId, threadId)).orderBy(asc(schema.chatMessages.createdAt)).all();
  const out: LocalMessage[] = [];
  for (const r of rows.filter((x) => !skip.includes(x.id)).reverse()) {
    const parts = (r.parts ?? []) as ChatPart[];
    const said = parts
      .map((p) => (p.type === 'text' ? p.text : `[${p.label}${p.status === 'error' ? ' — failed' : ''}]`))
      .join('\n')
      .trim();
    if (!said) continue;
    const m: LocalMessage = { role: r.role === 'user' ? 'user' : 'assistant', content: said.slice(0, 8000) };
    if (roughTokens([...out, m]) > budget) break;
    out.unshift(m);
  }
  // The history starts with a user turn.
  while (out[0]?.role === 'assistant') out.shift();
  return out;
}

const args = (call: LocalToolCall): Record<string, unknown> => {
  const a = call.function.arguments;
  if (typeof a !== 'string') return a ?? {};
  try {
    return JSON.parse(a) as Record<string, unknown>;
  } catch {
    return {};
  }
};

export async function runLocalTurn(turn: LocalTurn) {
  const defs = [...turn.tools, ...extraTools()];
  const byName = new Map(defs.map((d) => [d.name, d]));
  const tools = describe(defs);
  const system = `${turn.systemPrompt}\n\n${LOCAL_NOTE(chatSkillList())}`;
  const window = localConfig().contextTokens;
  const fixed = Math.ceil((system.length + JSON.stringify(tools).length) / 3.5);
  // Earlier turns get what's left after the instructions, the tools and room for this turn's tool results.
  const budget = Math.min(Math.floor(window * 0.35), window - fixed - 8192);
  const messages: LocalMessage[] = [{ role: 'system', content: system }, ...history(turn.threadId, turn.skipMessageIds, Math.max(0, budget)), { role: 'user', content: turn.text }];

  for (let i = 0; i < MAX_TURNS; i++) {
    makeRoom(messages, window - fixed - 2048);
    let current: Extract<ChatPart, { type: 'text' }> | null = null;
    const reply = await localChat({
      messages,
      tools,
      signal: turn.signal,
      onText: (t) => {
        if (!current) {
          current = { type: 'text', text: '' };
          turn.parts.push(current);
        }
        current.text += t;
        turn.onEvent({ type: 'text', text: t });
      },
    });
    messages.push({ role: 'assistant', content: reply.content, tool_calls: reply.toolCalls.length ? reply.toolCalls : undefined });
    turn.persist();
    if (!reply.toolCalls.length) return;

    const pictures: string[] = [];
    for (const call of reply.toolCalls) {
      if (turn.signal.aborted) return;
      const name = call.function.name;
      const input = args(call);
      const id = newId();
      const full = `mcp__${SERVER_NAME}__${name}`;
      const label = toolLabel(full, input);
      const part: Extract<ChatPart, { type: 'tool' }> = { type: 'tool', id, name: full, label, status: 'running' };
      turn.parts.push(part);
      turn.onEvent({ type: 'tool_start', id, name: full, label });
      turn.persist();

      const result = await callTool(byName.get(name), name, input);
      const textOut = result.content
        .map((c) => (c.type === 'text' ? c.text : c.type === 'image' ? '[a picture, shown below]' : ''))
        .join('\n')
        .slice(0, MAX_RESULT_CHARS);
      for (const c of result.content) if (c.type === 'image') pictures.push(c.data);
      part.status = result.isError ? 'error' : 'done';
      if (result.isError) part.detail = textOut.slice(0, 300);
      turn.onEvent({ type: 'tool_end', id, ok: !result.isError, detail: part.detail });
      messages.push({ role: 'tool', tool_name: name, content: textOut || '(no output)' });
      turn.persist();
    }
    // Pictures go in a user turn of their own: tool results carry text only.
    if (pictures.length) messages.push({ role: 'user', content: '(The pictures the tools returned, in order.)', images: pictures.slice(-8) });
  }
  turn.parts.push({ type: 'text', text: '\n\n_Stopped after 40 steps._' });
}

/** A long turn fills the window with tool results: the oldest ones are cut short until the turn fits. */
function makeRoom(messages: LocalMessage[], room: number) {
  for (let i = 1; i < messages.length - 2 && roughTokens(messages) > room; i++) {
    const m = messages[i];
    if (m.role === 'tool' && m.content.length > 400) m.content = `${m.content.slice(0, 300)}… [cut to save room; call the tool again if you need it]`;
    else if (m.images?.length) delete m.images;
  }
}

async function callTool(def: Def | undefined, name: string, input: Record<string, unknown>): Promise<Result> {
  if (!def) return { content: [{ type: 'text', text: `There's no tool called ${name}.` }], isError: true };
  const parsed = z.object(def.inputSchema).safeParse(input);
  if (!parsed.success) return { content: [{ type: 'text', text: `Wrong arguments for ${name}: ${z.prettifyError(parsed.error)}` }], isError: true };
  try {
    return await def.handler(parsed.data, {});
  } catch (err) {
    return { content: [{ type: 'text', text: (err as Error).message }], isError: true };
  }
}
