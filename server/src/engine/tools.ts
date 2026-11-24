// The studio's own tools for Claude (an in-process MCP server, "mcp__studio__*"): how what Claude does reaches the
// app. Progress, a question, a version to watch, notes fixed, a lesson, a title, a caption, a render on the GPU.

import { existsSync, mkdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { config } from '../config.ts';
import type { JobContext } from '../jobs/runner.ts';
import { errorText, now } from '../lib/util.ts';
import { addLesson } from '../services/brain.ts';
import { markFixed } from '../services/notes.ts';
import { addThread } from '../services/thread.ts';
import { saveVersion } from '../services/versions.ts';
import { getVideo, updateVideo, videoDir } from '../services/videos.ts';
import { withGpu } from './gpu.ts';
import { renderProject } from './render.ts';

const ok = (text: string) => ({ content: [{ type: 'text' as const, text }] });
const fail = (text: string) => ({ content: [{ type: 'text' as const, text }], isError: true });

/** What the agent run needs to know after the turn (Claude asked something: the run ends there). */
export type RunState = { asked: boolean; steps: number };

export function studioTools(videoId: string, ctx: JobContext, state: RunState) {
  const dir = () => videoDir(getVideo(videoId));
  return createSdkMcpServer({
    name: 'studio',
    version: '1',
    alwaysLoad: true,
    instructions: 'The Content Studio app. Use these tools to show the creator your progress, questions, versions and lessons.',
    tools: [
      tool('progress', 'Tell the creator what you are doing now, in a few plain words ("Cutting the retakes"). Call it at each real step.', { step: z.string().min(1).max(120), fraction: z.number().min(0).max(1).optional() }, async ({ step, fraction }) => {
        state.steps++;
        ctx.progress(fraction ?? Math.min(0.95, 0.05 + state.steps * 0.08), step);
        addThread(videoId, 'step', step, {}, ctx.job.id);
        return ok('Shown.');
      }),
      tool('ask', 'Ask the creator something only they can decide, with 2 to 4 short options. Then end your turn: the answer comes as the next message.', { question: z.string().min(1).max(300), options: z.array(z.string().min(1).max(160)).min(2).max(4) }, async ({ question, options }) => {
        state.asked = true;
        addThread(videoId, 'question', question, { options, picked: null }, ctx.job.id);
        return ok('Asked. End your turn now and wait for the answer.');
      }),
      tool(
        'save_version',
        'Save a finished, checked render for the creator to watch: a video file (mp4), or a carousel as slide images in order. Paths are relative to the video folder (or absolute in the studio).',
        { file: z.string().optional(), slides: z.array(z.string()).max(20).optional(), note: z.string().max(300).optional() },
        async ({ file, slides, note }) => {
          try {
            const v = await saveVersion(videoId, { file, slides, note }, ctx.job.id);
            return ok(`Saved as v${v.n}${v.duration ? ` (${v.duration.toFixed(1)} s)` : ''}.`);
          } catch (err) {
            return fail(errorText(err));
          }
        },
      ),
      tool('notes_fixed', "Mark the creator's notes as fixed in a version you saved, with one short reply.", { ids: z.array(z.string()).min(1), version: z.number().int().min(1), reply: z.string().max(300).optional() }, async ({ ids, version, reply }) => {
        markFixed(videoId, ids, version, reply ?? null);
        return ok('Marked fixed.');
      }),
      tool('lesson', 'Record a general rule learned from a note, for next time: scope "brand" (this brand only) or "all" (every brand). One sentence.', { text: z.string().min(3).max(400), scope: z.enum(['brand', 'all']) }, async ({ text, scope }) => {
        const v = getVideo(videoId);
        addLesson(scope === 'all' ? 'all' : v.brandId, text);
        addThread(videoId, 'lesson', text, { scope }, ctx.job.id);
        return ok('Recorded.');
      }),
      tool('set_title', "Name the video (a few words; the app's list shows it).", { title: z.string().min(1).max(120) }, async ({ title }) => {
        updateVideo(videoId, { title });
        return ok('Renamed.');
      }),
      tool('set_caption', 'Set the Instagram caption the creator will copy when posting.', { caption: z.string().min(1).max(2200) }, async ({ caption }) => {
        updateVideo(videoId, { caption });
        return ok('Caption set.');
      }),
      tool(
        'render',
        'Render a HyperFrames project folder to MP4 on the GPU (NVENC). One render at a time across the studio; this waits its turn. Returns the output path.',
        { project: z.string(), out: z.string().optional(), gpu: z.boolean().optional() },
        async ({ project, out, gpu }) => {
          const base = dir();
          const p = isAbsolute(project) ? resolve(project) : resolve(base, project);
          if (!p.startsWith(config.studioDir + '/') && !p.startsWith('/tmp/')) return fail('The project must be in the studio or /tmp.');
          if (!existsSync(join(p, 'index.html'))) return fail(`No index.html in ${project}.`);
          const target = out ? (isAbsolute(out) ? resolve(out) : resolve(base, out)) : join(base, 'work', `render-${now()}.mp4`);
          if (!target.startsWith(config.studioDir + '/') && !target.startsWith('/tmp/')) return fail('The output must be in the studio or /tmp.');
          mkdirSync(join(target, '..'), { recursive: true });
          try {
            const { ms } = await withGpu(
              () => renderProject(p, target, { gpu: gpu !== false, signal: ctx.signal, onProgress: (f) => ctx.progress(Math.min(0.95, f), 'Rendering') }),
              (ahead) => ctx.progress(0.5, `Waiting for the GPU (${ahead} ahead)`),
            );
            return ok(`Rendered ${target} in ${(ms / 1000).toFixed(1)} s.`);
          } catch (err) {
            return fail(`Render failed: ${errorText(err)}`);
          }
        },
      ),
    ],
  });
}
