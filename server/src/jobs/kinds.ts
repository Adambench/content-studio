// What each kind of job does. Recipes (engine/recipes) do the making; these are the jobs around them.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.ts';
import { ask } from '../engine/claude.ts';
import { writeTestProject } from '../engine/compose/test.ts';
import { probe, quickHash, still } from '../engine/media.ts';
import { recipeFor } from '../engine/recipes/index.ts';
import { renderProject } from '../engine/render.ts';
import { hooksPrompt, hooksSchema, writePrompt, writeSchema } from '../engine/writing.ts';
import { getCard, getPage, setStage, updateCard } from '../services/board.ts';
import { getInput, inputPath, setInputMeta } from '../services/inputs.ts';
import { createRender, createVersion, projectDir, renderTarget, updateRender } from '../services/versions.ts';
import { registerJob } from './runner.ts';

/** Where a card's small pictures of its inputs live. */
export const thumbPath = (cardId: string, inputId: string) => join(config.workDir, cardId, 'thumbs', `${inputId}.jpg`);

export function registerJobs() {
  // A new file: what it is (length, size, sound, HDR), a fingerprint, and a still to show on the card.
  registerJob('look', async (ctx) => {
    const inputId = String(ctx.input.inputId);
    const input = getInput(inputId);
    const path = inputPath(inputId);
    const meta = await probe(path);
    setInputMeta(inputId, meta, await quickHash(path));
    if (input.kind === 'video' || input.kind === 'image') {
      const out = thumbPath(input.cardId, inputId);
      mkdirSync(join(out, '..'), { recursive: true });
      await still(path, out, { at: input.kind === 'video' && meta.duration ? Math.min(1, meta.duration / 3) : 0, hdr: meta.hdr, width: 360 });
    }
  });

  // Measures a render on this machine: a version and a render on the card, timed, with the speed in the log.
  registerJob('test-render', async (ctx) => {
    const card = getCard(ctx.cardId!);
    const seconds = Number(ctx.input.seconds ?? 10);
    const videoId = ctx.input.inputId ? String(ctx.input.inputId) : null;
    const version = createVersion({ cardId: card.id, author: 'claude', kind: 'video', recipe: 'custom', note: `Test render (${seconds} s${videoId ? ', over footage' : ''})`, plan: { test: true, seconds, videoId } });
    const render = createRender(version.id, ctx.job.id);
    const dir = projectDir(version);
    writeTestProject(dir, { seconds, video: videoId ? inputPath(videoId) : undefined });
    const target = renderTarget(render);
    updateRender(render.id, { status: 'running' });
    try {
      const gpu = ctx.input.gpu !== false;
      const { ms } = await renderProject(dir, target.abs, { gpu, signal: ctx.signal, onProgress: (f, stage) => ctx.progress(f, stage || 'Rendering') });
      const meta = await probe(target.abs);
      await still(target.abs, target.posterAbs, { at: Math.min(1, (meta.duration ?? 1) / 2), width: 540 });
      updateRender(render.id, { status: 'done', file: target.file, poster: target.poster, duration: meta.duration ?? seconds, width: meta.width ?? 1080, height: meta.height ?? 1920 });
      ctx.log(`Rendered ${seconds} s in ${(ms / 1000).toFixed(1)} s (${((seconds * 30) / (ms / 1000)).toFixed(1)} frames a second, ${gpu ? 'NVENC' : 'x264'})`);
      setStage(card.id, 'review');
    } catch (err) {
      updateRender(render.id, { status: ctx.signal.aborted ? 'cancelled' : 'failed', error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  });

  // Write: the script in my voice from my notes (and what's there already). The old script is kept as a draft.
  registerJob('write', async (ctx) => {
    const card = getCard(ctx.cardId!);
    const page = getPage(card.pageId);
    ctx.progress(0.1, 'Writing');
    const { system, prompt } = writePrompt(page, card, String(ctx.input.instruction ?? ''));
    const answer = await ctx.step('answer', () => ask({ task: 'write', system, prompt, schema: writeSchema, now: true, cardId: card.id, jobId: ctx.job.id, signal: ctx.signal }));
    updateCard(card.id, { script: answer.script.trim(), ...(card.title === 'Untitled' ? { title: answer.title } : {}), ...(card.stage === 'idea' ? { stage: 'script' } : {}) }, 'claude');
    ctx.log(answer.why);
  });

  // Hooks: other first lines, shown beside the script; taking one is my click.
  registerJob('hooks', async (ctx) => {
    const card = getCard(ctx.cardId!);
    const page = getPage(card.pageId);
    ctx.progress(0.1, 'Thinking of hooks');
    const { system, prompt } = hooksPrompt(page, card);
    await ctx.step('answer', () => ask({ task: 'hooks', system, prompt, schema: hooksSchema, now: true, cardId: card.id, jobId: ctx.job.id, signal: ctx.signal }));
  });

  // Make: the card's recipe from what's attached to a checked render in Review.
  registerJob('make', async (ctx) => {
    const card = getCard(ctx.cardId!);
    const before = card.stage === 'making' ? 'needs_me' : card.stage;
    const recipe = recipeFor(String(ctx.input.recipe ?? card.recipe));
    setStage(card.id, 'making');
    try {
      await recipe.make(ctx, card);
      setStage(card.id, 'review');
    } catch (err) {
      setStage(card.id, before);
      throw err;
    }
  });
}
