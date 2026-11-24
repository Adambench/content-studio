// Claude Code working on one video: its folder, its session (resumed every time), every tool Claude Code has plus the
// studio's, the guard rails, no approval prompts. One run per go (a message, Fix, an answer); what it says, does and
// saves lands in the thread as it happens. My Pro login, never an API key; what I start never waits for usage.

import { dirname, join } from 'node:path';
import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { get, setSetting } from '../db/db.ts';
import { JobWait } from '../jobs/queue.ts';
import type { JobContext } from '../jobs/runner.ts';
import { errorText, now } from '../lib/util.ts';
import { reopenSent } from '../services/notes.ts';
import { addThread } from '../services/thread.ts';
import { clearApproval, getVideo, setSession } from '../services/videos.ts';
import { claudeEnv, isUsageError, recordCall, recordRate, waitForUsage, type CallUsage, type RateInfo } from './claude.ts';
import { guardFor } from './guard.ts';
import { hyperframesEnv } from './render.ts';
import { studioTools, type RunState } from './tools.ts';

const STARTED = now();

const APPEND = `You are working inside the Content Studio app on ai-server, in one video's folder. The creator talks to you
through the app: your text shows in the video's thread, so keep it to a sentence or two. Use the studio tools
(mcp__studio__*) to show progress, ask, save versions, mark notes fixed and record lessons. The studio's CLAUDE.md
files (loaded above) are your standing instructions; the halal rules there have no exceptions.`;

/** A page's setup: the same studio, a different job (the page itself instead of a video). */
const PAGE = `This run is a page's setup, not a video. A page is one Instagram account. You're in its setup folder
(files/ = what I gave, work/ = yours); the page is the folder above: ../CLAUDE.md is its brain (every video's Claude
reads it) and ../kit/ its look. Make the page ready for videos:
1. Study what I gave (videos with the video-perception skill, images, documents, links you can reach) and the
   niche: what its strongest accounts post and why it works (web search, yt-dlp for public videos).
2. Build what's missing, as far as my start mode says:
   - Identity: the name (when I gave none: 3 options, easy to say and spell, every reading checked in other
     languages, Arabic included, nothing tied to another religion), 3 handles, the bio (150 characters at most),
     the profile picture.
   - Voice: who it's for, the promise, how it talks (words it uses and never uses), what its hooks sound like.
   - Look: a palette (hex), two free fonts (files in ../kit/fonts), the logo and avatar drawn in code (SVG and
     PNG; no generated pictures; a mascot needs a personality and must read as the niche), the Reels caption
     style, a carousel slide and a cover template (HTML or HyperFrames in ../kit/; carousels: no eyebrow labels,
     one sentence a slide, the avatar on each).
   - Content: 3 to 5 pillars, the formats it uses (my face on camera, my voice over footage or stock, carousels…;
     every voice is mine, never synthetic), what a great post looks like here, 10 first ideas.
   - Rules: what this page adds to the halal rules.
3. Write ../CLAUDE.md for the videos' Claude: short and concrete (kit paths, hex codes, fonts, do and don't). Keep
   its "## Lessons" section, with every lesson in it, at the end. Set the page's name and main colour with
   set_page once they're decided.
4. Save a version: a board of 1080×1350 PNG slides (HTML screenshotted with the headless Chrome at
   $PRODUCER_HEADLESS_SHELL_PATH, or HyperFrames): the profile (avatar, name, bio, 6 sample posts in a grid), the
   palette and fonts, the logo, a Reel frame with captions, a carousel cover. Look at every slide before saving.
Ask me (the ask tool) only for real choices, one at a time (the name, a direction); when they're visual, save the
options as a version first. My notes come back on slides: fix them all in a new board, then notes_fixed and
lessons. Never post, follow, sign in or make accounts.`;

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

/**
 * Work I didn't press for (pages set up in bulk, `later`): it waits for spare usage, and goes only once every
 * background run started before it has finished, so they run one at a time, oldest first.
 */
function waitAsBackground(jobId: string) {
  waitForUsage();
  const before = get(
    `SELECT 1 FROM jobs o, jobs me WHERE me.id = ? AND o.id != me.id AND o.kind = 'agent' AND o.status IN ('queued', 'waiting', 'running')
       AND json_extract(o.input, '$.background') = 1 AND (o.created_at, o.id) < (me.created_at, me.id)`,
    jobId,
  );
  if (before) throw new JobWait('Waiting for the run before it', 60_000);
}

export async function runAgent(ctx: JobContext) {
  if (ctx.input.background) waitAsBackground(ctx.job.id);
  const video = getVideo(ctx.videoId!);
  const cwd = video.folder;
  const isPage = video.kind === 'page';
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
            env: { ...claudeEnv(), ...hyperframesEnv() },
            model: 'opus',
            settingSources: ['user', 'project'],
            systemPrompt: { type: 'preset', preset: 'claude_code', append: isPage ? `${APPEND}\n\n${PAGE}` : APPEND },
            permissionMode: 'bypassPermissions',
            allowDangerouslySkipPermissions: true,
            disallowedTools: ['AskUserQuestion'],
            mcpServers: { studio: studioTools(video.id, ctx, state) },
            hooks: { PreToolUse: [{ hooks: [guardFor(cwd, isPage ? [join(dirname(cwd), 'kit')] : [])] }] },
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
