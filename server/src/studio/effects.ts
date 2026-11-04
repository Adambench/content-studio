// Matte effects (shared/effects.ts): a person matte for the clip's video (a local model, cached), then FFmpeg cuts the
// person out and changes the rest, into a new file the edit's clips use instead. The `media.effect` job.
import { execFile as execFileCb } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import { inReview } from '../../../shared/types';
import { MATTE_EFFECT_INFO, matteFilter, type MatteEffect, type MatteEffectOptions } from '../../../shared/effects';
import { normalizeEdit } from '../../../shared/edit';
import { config } from '../config';
import { db, schema } from '../db';
import { requireBinary } from '../lib/bin';
import { probe } from '../lib/ffmpeg';
import { emit } from '../lib/events';
import { JobError, enqueue } from '../jobs/queue';
import { clipToolsInstalled, matteModel } from '../services/cliptools';
import { adoptFile, getMedia, mediaPath, readTranscript } from '../services/media';
import { getPiece } from '../services/pieces';
import { findEditForPiece, saveEditVersion } from './edits';
import { rerenderLatest } from './render';
import { runTool } from '../compute/run';

const execFile = promisify(execFileCb);
const matteFile = (mediaId: string) => join(config.framesDir, `matte-${mediaId}.mp4`);

export const matteReady = () => clipToolsInstalled() && existsSync(matteModel());

/** The person matte of a video: made once (a few minutes for a minute of video) and kept. */
export async function ensureMatte(mediaId: string, track?: string) {
  const out = matteFile(mediaId);
  if (existsSync(out)) return out;
  const m = getMedia(mediaId);
  if (m.kind !== 'video') throw new JobError('Only a video can have a person matte.', { retry: false });
  if (!matteReady()) throw new JobError('Install the clip tools again (Settings → Clip tools): the person model isn’t there yet.', { retry: false });
  const part = `${out}.part.mp4`;
  await runTool('matte', { video: mediaPath(m), mask: part }, {}, { timeoutMs: 60 * 60_000, track });
  await execFile('mv', [part, out]);
  return out;
}

export type EffectJob = { pieceId: string; editId: string; mediaId: string; effect: MatteEffect; options: MatteEffectOptions };

/** Queue an effect on one video of a piece's edit. */
export function queueEffect(job: EffectJob) {
  enqueue('media.effect', job, { maxAttempts: 2 });
}

/** The `media.effect` job: the matte, the composite, a new file, and a new version of the edit that uses it. */
export async function applyEffect(job: EffectJob) {
  const piece = getPiece(job.pieceId);
  const source = getMedia(job.mediaId);
  const info = await probe(mediaPath(source));
  if (!info.width || !info.height) throw new JobError('The video has no picture.', { retry: false });
  const mask = await ensureMatte(job.mediaId, `effect:${job.mediaId}`);
  let image: string | null = null;
  if (job.options.style === 'image' && job.effect === 'background') {
    if (!job.options.imageMediaId) throw new JobError('Pick the picture for the background.', { retry: false });
    const img = getMedia(job.options.imageMediaId);
    if (img.workspaceId !== piece.workspaceId || img.kind !== 'image') throw new JobError('That isn’t a picture in this workspace.', { retry: false });
    image = mediaPath(img);
  }
  const fps = 30;
  const { graph, extraInput } = matteFilter(job.effect, job.options, { w: info.width - (info.width % 2), h: info.height - (info.height % 2), fps });
  const dir = join(config.tmpDir, `effect-${job.mediaId}`);
  await mkdir(dir, { recursive: true });
  const out = join(dir, 'out.mp4');
  try {
    await execFile(
      requireBinary('ffmpeg'),
      [
        '-hide_banner', '-nostdin', '-y', '-v', 'error',
        '-i', mediaPath(source), '-i', mask, ...extraInput.map((a) => (a === '{image}' ? image! : a)),
        '-filter_complex', graph, '-map', '[v]', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-r', String(fps),
        '-c:a', 'copy', ...(info.durationMs ? ['-t', (info.durationMs / 1000).toFixed(3)] : []), '-movflags', '+faststart', out,
      ],
      { maxBuffer: 20 * 1024 * 1024, timeout: 30 * 60_000 },
    );
    const label = MATTE_EFFECT_INFO[job.effect].label;
    // Same length, same sound: the source's words (with the creator's corrections) carry over, so captions stay.
    const transcript = source.transcriptStatus === 'done' ? await readTranscript(source.id) : null;
    const made = await adoptFile(piece.workspaceId, out, `${source.originalName.replace(/\.[^.]+$/, '')} (${label.toLowerCase()}).mp4`, 'video/mp4', {
      pieceId: job.pieceId,
      source: 'generated',
      ...(transcript && { transcript }),
    });
    const probed = await probe(mediaPath(made));
    db.update(schema.media).set({ durationMs: probed.durationMs, width: probed.width, height: probed.height }).where(eq(schema.media.id, made.id)).run();

    // The edit uses the new file wherever it used the old one (the times stay: it's the same length, same sound).
    const edit = findEditForPiece(job.pieceId);
    if (!edit) return;
    const spec = normalizeEdit(edit.working);
    if (!spec.clips.some((c) => c.mediaId === job.mediaId)) return;
    spec.clips = spec.clips.map((c) => (c.mediaId === job.mediaId ? { ...c, mediaId: made.id } : c));
    saveEditVersion(edit.id, { author: 'claude', message: `Effect: ${label.toLowerCase()}`, spec });
    emit({ type: 'changed', entity: 'edits', workspaceId: piece.workspaceId, id: edit.id });
    // A clip waiting in Review shows the result by itself, like any change Claude makes there.
    if (inReview(getPiece(job.pieceId).stage)) rerenderLatest(edit.id, 'claude');
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export function onEffectFailed({ pieceId }: EffectJob, message: string) {
  try {
    emit({ type: 'job', jobType: 'media.effect', status: 'error', message: message.slice(0, 200), workspaceId: getPiece(pieceId).workspaceId } as never);
  } catch {
    /* the piece is gone */
  }
}
