// The `media.generate` job: a picture or a short clip made on a home PC (shared/generate.ts), looked at before it's
// kept (never a person or an animal), added to the files and, when asked, put into the edit as b-roll.
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import {
  DEFAULT_GENERATION,
  GEN_SIZES,
  NEGATIVE_PROMPT,
  VIDEO_FRAMES,
  generationPrompt,
  msUntilVideoWindow,
  type GenerateRequest,
  type GenerationSettings,
} from '../../../shared/generate';
import { normalizeEdit, type BrollOverlay } from '../../../shared/edit';
import { REVIEW_STAGE } from '../../../shared/types';
import { HOSTED_OUT, hostedPriceUsd } from '../../../shared/hosted';
import { download, submit, waitFor } from '../ai/hosted/kie';
import { fitsCap, hostedKey, hostedSettings, msUntilTomorrow, recordSpend, spentTodayUsd } from '../ai/hosted/ledger';
import { askStructured } from '../claude/oneshot';
import { runToolOn } from '../compute/run';
import { config } from '../config';
import { db, newId, schema } from '../db';
import { JobError, enqueue } from '../jobs/queue';
import { emit } from '../lib/events';
import { extractFrames, fitToSize, probe } from '../lib/ffmpeg';
import { getSetting } from '../lib/settings';
import { notify } from '../lib/push';
import { adoptFile, mediaPath } from '../services/media';
import { getPiece, type Author } from '../services/pieces';
import { findEditForPiece, saveEditVersion } from './edits';
import { rerenderLatest } from './render';

export type GenerateJob = GenerateRequest & { workspaceId: string; by: Author };

export const generationSettings = (): GenerationSettings => ({ ...DEFAULT_GENERATION, ...getSetting('generation') });

/** Tries before giving up on a prompt that keeps showing people or animals. */
const TRIES = 3;

export function queueGeneration(job: GenerateJob) {
  return enqueue('media.generate', job, { maxAttempts: 2 });
}

type Check = { livingBeings: boolean; haram: boolean; what: string };
const CHECK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['livingBeings', 'haram', 'what'],
  properties: {
    livingBeings: { type: 'boolean', description: 'Any person or animal at all, even small, blurred, partial or in the background' },
    haram: { type: 'boolean', description: 'Alcohol, smoking, drugs, gambling, immodest clothing, or religious idols' },
    what: { type: 'string', description: 'In a few words, what you saw that fails (empty when nothing does)' },
  },
};

/** Look at the picture (or three frames of the clip): a person, an animal or something haram in it fails. */
async function checkPicture(file: string, kind: GenerateRequest['kind'], dir: string): Promise<Check> {
  const info = kind === 'video' ? await probe(file) : null;
  const seconds = (info?.durationMs ?? 0) / 1000;
  const times = kind === 'video' ? [0.2, seconds / 2, Math.max(0.2, seconds - 0.3)] : [0];
  const frames = await extractFrames(file, times, (i) => join(dir, `check-${i}.jpg`), 512);
  const images = await Promise.all(frames.map(async (f) => ({ data: (await readFile(f)).toString('base64'), mediaType: 'image/jpeg' as const })));
  return askStructured<Check>({
    task: 'pictures',
    system:
      'You check generated pictures for a halal content studio before they are used. The rule: no living beings at all — no person, face, hand, body part, silhouette, figure, statue or doll of a person, and no animal, bird, fish or insect, however small, blurred or far away. ' +
      'Also flag anything haram: alcohol, smoking, drugs, gambling, immodest clothing, religious idols. Places, buildings, objects, food, plants, landscapes, sky, water, screens and abstract shapes are fine. When unsure whether something is a person or an animal, flag it.',
    prompt: images.length > 1 ? `These are ${images.length} frames from one short clip. Does any of them fail?` : 'Does this picture fail?',
    images,
    schema: CHECK_SCHEMA,
    model: 'haiku',
  });
}

/** One try on the hosted service: submit, wait, download, bring to full size. Spend is recorded when it's submitted. */
async function makeHosted(job: GenerateJob, prompt: string, file: string, dir: string, attempt: number) {
  const h = hostedSettings();
  const model = h.models[job.kind];
  const usd = hostedPriceUsd(h, job.kind);
  const taskId = await submit({ kind: job.kind, model, prompt, negative: NEGATIVE_PROMPT, aspect: job.aspect, seed: Math.floor(Math.random() * 2 ** 31) });
  recordSpend({ model: model.id, kind: job.kind, taskId, credits: job.kind === 'video' ? model.credits * model.seconds : model.credits, dollars: usd, pieceId: job.pieceId });
  const raw = join(dir, `raw-${attempt}.${job.kind === 'video' ? 'mp4' : 'png'}`);
  await download(await waitFor(taskId, job.kind), raw);
  const [w, hgt] = HOSTED_OUT[job.aspect];
  await fitToSize(raw, file, w, hgt, job.kind === 'video');
  return { seconds: job.kind === 'video' ? model.seconds : 0, on: 'kie.ai' };
}

/**
 * Where this job runs: the hosted service when the key is saved, the kind is set to it and today's cap has room;
 * otherwise a home PC (or, with the backend set to hosted only, a wait for tomorrow's cap).
 */
function backendFor(kind: GenerateRequest['kind']): 'hosted' | 'home' {
  const h = hostedSettings();
  const mode = h.backend[kind];
  if (mode === 'home') return 'home';
  const usable = !!hostedKey();
  if (!usable) {
    if (mode === 'hosted') throw new JobError('Add the kie.ai key in Settings → Models (hosted generation is on).', { retry: false });
    return 'home';
  }
  if (!fitsCap(hostedPriceUsd(h, kind), h)) {
    if (mode === 'auto') return 'home';
    throw new JobError(`Today’s hosted spend ($${spentTodayUsd().toFixed(2)}) has reached the $${h.dailyCapUsd} cap: waiting for tomorrow.`, { wait: true, delayMs: msUntilTomorrow() });
  }
  return 'hosted';
}

/** The `media.generate` job. */
export async function generateMedia(job: GenerateJob) {
  let where = backendFor(job.kind);
  if (job.kind === 'video' && where === 'home') {
    const wait = msUntilVideoWindow(generationSettings());
    if (wait > 0) {
      const at = new Date(Date.now() + wait).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      throw new JobError(`Video clips are made at night: this one starts at about ${at}.`, { wait: true, delayMs: wait + 30_000 });
    }
  }
  const [width, height] = GEN_SIZES[job.aspect][job.kind];
  const prompt = generationPrompt(job);
  const dir = join(config.tmpDir, `generate-${newId()}`);
  await mkdir(dir, { recursive: true });
  try {
    let kept: { file: string; on: string; seconds: number } | null = null;
    let failed = '';
    for (let attempt = 1; attempt <= TRIES && !kept; attempt++) {
      // Each try asks again, so a cap reached mid-way moves the rest to the home PC (or waits).
      if (attempt > 1) where = backendFor(job.kind);
      const file = join(dir, `try-${attempt}.${job.kind === 'video' ? 'mp4' : 'png'}`);
      let made: { seconds: number; on: string };
      if (where === 'hosted') {
        made = await makeHosted(job, prompt, file, dir, attempt);
      } else {
        const seed = Math.floor(Math.random() * 2 ** 31);
        const { stdout, on } = await runToolOn(
          job.kind,
          { [job.kind]: file },
          { prompt, negative: NEGATIVE_PROMPT, width, height, seed, ...(job.kind === 'video' && { frames: VIDEO_FRAMES }) },
          { timeoutMs: job.kind === 'video' ? 4 * 60 * 60_000 : 30 * 60_000, track: `generate:${job.workspaceId}` },
        );
        made = { seconds: Number((JSON.parse(stdout.trim().split('\n').pop() || '{}') as { seconds?: number }).seconds) || 0, on };
      }
      const check = await checkPicture(file, job.kind, dir);
      if (!check.livingBeings && !check.haram) {
        kept = { file, ...made };
      } else {
        failed = check.what || (check.livingBeings ? 'a person or an animal' : 'something haram');
        console.warn(`[generate] try ${attempt} showed ${failed}; making it again`);
      }
    }
    if (!kept) throw new JobError(`Each try showed ${failed}. Describe places, objects or nature instead.`, { retry: false });

    const name = `${job.prompt.trim().slice(0, 60).replace(/[^\p{L}\p{N} ,.'-]/gu, '') || 'Generated'}.${job.kind === 'video' ? 'mp4' : 'png'}`;
    const made = await adoptFile(job.workspaceId, kept.file, name, job.kind === 'video' ? 'video/mp4' : 'image/png', { pieceId: job.pieceId, source: 'generated' });
    const probed = await probe(mediaPath(made));
    db.update(schema.media).set({ durationMs: probed.durationMs, width: probed.width, height: probed.height }).where(eq(schema.media.id, made.id)).run();
    emit({ type: 'changed', entity: 'media', workspaceId: job.workspaceId, id: made.id });

    const placed = job.place && job.pieceId ? place(job, made.id, probed.durationMs) : false;
    const wherePhrase = kept.on === 'laptop' ? '' : ` on ${kept.on}`;
    await notify('Generated', `${job.kind === 'video' ? 'A clip' : 'A picture'} is ready${wherePhrase}${kept.seconds ? ` (${Math.round(kept.seconds)} s)` : ''}${placed ? ', in the edit' : ''}: ${job.prompt.slice(0, 80)}`, job.pieceId ? `/w/${job.workspaceId}/p/${job.pieceId}` : undefined);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Into the piece's edit as b-roll, as a new version; a clip in Review renders again. */
function place(job: GenerateJob, mediaId: string, durationMs: number | null) {
  const edit = findEditForPiece(job.pieceId!);
  if (!edit || !job.place) return false;
  const spec = normalizeEdit(edit.working);
  const { start, layout } = job.place;
  // A clip can't be shown for longer than it lasts.
  const end = durationMs ? Math.min(job.place.end, start + durationMs / 1000) : job.place.end;
  const overlay: BrollOverlay = { id: newId().slice(0, 8), type: 'broll', mediaId, in: 0, layout, focusX: 0.5, focusY: 0.5, start, end };
  spec.overlays = [...spec.overlays, overlay];
  saveEditVersion(edit.id, { author: job.by, message: `Generated b-roll: ${job.prompt.slice(0, 60)}`, spec });
  emit({ type: 'changed', entity: 'edits', workspaceId: job.workspaceId, id: edit.id });
  if (getPiece(job.pieceId!).stage === REVIEW_STAGE) rerenderLatest(edit.id, job.by);
  return true;
}

export function onGenerateFailed(job: GenerateJob, message: string) {
  emit({ type: 'job', jobType: 'media.generate', status: 'error', message: message.slice(0, 200), workspaceId: job.workspaceId } as never);
  void notify('Generation failed', `${job.prompt.slice(0, 60)}: ${message.slice(0, 160)}`).catch(() => {});
}
