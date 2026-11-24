// Claude Code working on one video: its folder, its session (resumed every time), every tool Claude Code has plus the
// studio's, the guard rails, no approval prompts. One run per go (a message, Fix, an answer); what it says, does and
// saves lands in the thread as it happens. My Pro login, never an API key; what I start never waits for usage.

import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { setSetting } from '../db/db.ts';
import type { JobContext } from '../jobs/runner.ts';
import { errorText, now } from '../lib/util.ts';
import { reopenSent } from '../services/notes.ts';
import { addThread } from '../services/thread.ts';
import { clearApproval, getVideo, setSession } from '../services/videos.ts';
import { claudeEnv, isUsageError, recordCall, recordRate, type CallUsage, type RateInfo } from './claude.ts';
import { guardFor } from './guard.ts';
import { studioTools, type RunState } from './tools.ts';

const STARTED = now();

const APPEND = `You are working inside the Content Studio app on ai-server, in one video's folder. The creator talks to you
through the app: your text shows in the video's thread, so keep it to a sentence or two. Use the studio tools
(mcp__studio__*) to show progress, ask, save versions, mark notes fixed and record lessons. The studio's CLAUDE.md
files (loaded above) are your standing instructions; the halal rules there have no exceptions.`;

/** One line for a tool call in the thread (shown when I open the steps). */
export function describe(name: string, input: Record<string, unknown>, cwd: string): string {
  const rel = (p: unknown) => String(p ?? '').replace(cwd + '/', '');
  switch (name) {
    case 'Bash':
      return `$ ${String(input.command ?? '').split('\n')[0]!.slice(0, 240)}`;
    case 'Read':
      return `Read ${rel(input.file_path)}`;
    case 'Write':
      return `Wrote ${rel(input.file_path)}`;
    case 'Edit':
    case 'MultiEdit':
      return `Edited ${rel(input.file_path)}`;
    case 'Glob':
      return `Looked for ${String(input.pattern ?? '')}`;
    case 'Grep':
      return `Searched for ${String(input.pattern ?? '')}`;
    case 'Skill':
      return `Skill: ${String(input.skill ?? input.name ?? '')}`;
    case 'WebSearch':
      return `Searched the web: ${String(input.query ?? '')}`;
    case 'WebFetch':
      return `Read ${String(input.url ?? '')}`;
    case 'Task':
    case 'Agent':
      return `Subagent: ${String(input.description ?? '')}`;
    case 'TodoWrite':
      return 'Updated its to-do list';
    default:
      return name.replace(/^mcp__\w+__/, '');
  }
}

export async function runAgent(ctx: JobContext) {
  const video = getVideo(ctx.videoId!);
  const cwd = video.folder;
  let prompt = String(ctx.input.prompt ?? '').trim() || 'Go.';
  if (ctx.job.startedAt && ctx.job.startedAt < STARTED) prompt = `(The app restarted while you were on this. Carry on from where you stopped: check project.md and the folder.)\n\n${prompt}`;
  clearApproval(video.id);
  const state: RunState = { asked: false, steps: 0 };
  const abortController = new AbortController();
  ctx.signal.addEventListener('abort', () => abortController.abort(), { once: true });
  const started = now();
  let usage: CallUsage = {};
  let ok = false;
  let resume = video.sessionId ?? undefined;
  ctx.progress(0.02, 'Claude is on it');

  const handle = (m: SDKMessage) => {
    if (m.type === 'system' && m.subtype === 'init') return setSession(video.id, m.session_id);
    if (m.type === 'rate_limit_event') return recordRate((m as unknown as { rate_limit_info: RateInfo }).rate_limit_info);
    if (m.type === 'assistant' && !m.parent_tool_use_id) {
      for (const b of m.message.content) {
        if (b.type === 'text' && b.text.trim()) addThread(video.id, 'claude', b.text.trim(), {}, ctx.job.id);
        else if (b.type === 'tool_use' && !b.name.startsWith('mcp__studio__')) addThread(video.id, 'tool', describe(b.name, (b.input ?? {}) as Record<string, unknown>, cwd), { tool: b.name }, ctx.job.id);
      }
      return;
    }
    if (m.type === 'result') {
      usage = { ...usage, ...(m.usage as CallUsage) };
      if (m.subtype !== 'success') throw new Error(('errors' in m && m.errors?.join('; ')) || m.subtype);
    }
  };

  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const q = query({
          prompt,
          options: {
            cwd,
            env: claudeEnv(),
            model: 'opus',
            settingSources: ['user', 'project'],
            systemPrompt: { type: 'preset', preset: 'claude_code', append: APPEND },
            permissionMode: 'bypassPermissions',
            allowDangerouslySkipPermissions: true,
            disallowedTools: ['AskUserQuestion'],
            mcpServers: { studio: studioTools(video.id, ctx, state) },
            hooks: { PreToolUse: [{ hooks: [guardFor(cwd)] }] },
            resume,
            abortController,
            stderr: (d) => {
              if (/error|fail/i.test(d)) console.error('[claude]', d.trim().slice(0, 400));
            },
          },
        });
        for await (const m of q) handle(m);
        ok = true;
        break;
      } catch (err) {
        const text = errorText(err);
        if (attempt === 0 && resume && /no conversation found|session.{0,40}not found|could not (find|resume)/i.test(text)) {
          setSession(video.id, null);
          resume = undefined;
          addThread(video.id, 'sys', 'Claude’s earlier session was gone, so it starts a new one (project.md keeps what it knew).', {}, ctx.job.id);
          continue;
        }
        throw err;
      }
    }
  } catch (err) {
    reopenSent(video.id);
    if (ctx.signal.aborted) {
      addThread(video.id, 'sys', 'Stopped', {}, ctx.job.id);
    } else {
      const text = errorText(err);
      if (isUsageError(text)) setSetting('claudeLimitedUntil', now() + 60 * 60_000);
      addThread(video.id, 'error', text.slice(0, 300), {}, ctx.job.id);
    }
    throw err;
  } finally {
    recordCall({ task: 'agent', model: 'opus', videoId: video.id, jobId: ctx.job.id, usage, ms: now() - started, ok });
  }
}
