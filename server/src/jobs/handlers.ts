import { workersWith } from '../compute/workers';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Transcript } from '../../../shared/types';
import { onReadFailed, readCampaign, refreshBudgets } from '../campaigns/read';
import { measureReference, onMeasureFailed } from '../knowledge/references';
import { downloadSource, onSourceFailed, transcribeSource } from '../campaigns/sources';
import { makeClip, onMakeFailed } from '../clipping/make';
import { pickMoments } from '../clipping/pick';
import { scanSource } from '../clipping/scan';
import { askStructured } from '../claude/oneshot';
import { playbook } from '../claude/plugin';
import { config } from '../config';
import { db, now, schema } from '../db';
import { emit } from '../lib/events';
import { extractAudio, makeThumb, probe } from '../lib/ffmpeg';
import { notify } from '../lib/push';
import { getSetting } from '../lib/settings';
import { getMedia, mediaPath, thumbPath, transcriptPath, whisperInstalled } from '../services/media';
import { createPiece, getWorkspace } from '../services/pieces';
import { makeProxy, onProxyFailed } from '../studio/proxy';
import { onPublishFailed, publishPost } from '../publish/publisher';
import { renderJob } from '../studio/render';
import { bandPauses, fitToPauses, refineWords, voiceEnvelope } from '../studio/clean-cuts';
import { checkJob } from '../studio/quality';
import { onReframeFailed, reframeEdit } from '../studio/reframe';
import { enqueue, onJobFailed, registerJob } from './queue';
import { onPitchFailed, pitchDirections } from '../studio/directions';
import { applyEffect, onEffectFailed } from '../studio/effects';
import { runTool } from '../compute/run';
import { scoutJob } from '../toolbox/scout';

function setMedia(id: string, values: Partial<typeof schema.media.$inferInsert>) {
  db.update(schema.media).set(values).where(eq(schema.media.id, id)).run();
  const row = getMedia(id);
  emit({ type: 'changed', entity: 'media', workspaceId: row.workspaceId, id });
  if (row.pieceId) emit({ type: 'changed', entity: 'pieces', workspaceId: row.workspaceId, id: row.pieceId });
  return row;
}

async function probeMedia({ mediaId }: { mediaId: string }) {
  const row = getMedia(mediaId);
  const file = mediaPath(row);
  const info = await probe(file).catch(() => null);
  let hasThumb = false;
  if (row.kind === 'video' || row.kind === 'image') {
    hasThumb = await makeThumb(file, thumbPath(mediaId), info?.durationMs ?? null).then(
      () => true,
      () => false,
    );
  }
  // Footage and voice memos get transcribed; brand assets (nasheeds, SFX…) and finished renders don't, and a clip's
  // cut arrives with its transcript.
  const transcribed = row.transcriptStatus === 'done';
  const wantsTranscript = !transcribed && !row.assetType && row.source !== 'render' && !!info?.hasAudio && (row.kind === 'video' || row.kind === 'audio');
  setMedia(mediaId, {
    durationMs: info?.durationMs ?? null,
    width: info?.width ?? null,
    height: info?.height ?? null,
    hasThumb,
    transcriptStatus: transcribed ? 'done' : wantsTranscript ? (whisperInstalled() ? 'queued' : 'unavailable') : 'none',
  });
  if (wantsTranscript && whisperInstalled()) enqueue('media.transcribe', { mediaId }, { maxAttempts: 2 });
}

async function transcribeMedia({ mediaId }: { mediaId: string }) {
  const row = setMedia(mediaId, { transcriptStatus: 'running' });
  const wav = join(config.tmpDir, `${mediaId}.wav`);
  let transcript: Transcript;
  try {
    await extractAudio(mediaPath(row), wav);
    await runTool('transcribe', { audio: wav, json: transcriptPath(mediaId) }, { model: getSetting('whisperModel') ?? 'small' }, { timeoutMs: 60 * 60 * 1000 });
    transcript = JSON.parse(await readFile(transcriptPath(mediaId), 'utf8')) as Transcript;
    // Whisper gives a word the pause before it (a line's first word often starts a second early, in the silence), so a
    // clip cut in that pause lost the word from its captions. Fitted to the voice, every word starts where it's heard.
    // A phone take's room is louder than the envelope's quiet level: the voice band's own pauses catch the rest.
    const fitted = await voiceEnvelope(wav).then(
      async (env) => fitToPauses(refineWords(transcript, env), await bandPauses(wav)),
      () => null,
    );
    if (fitted) {
      transcript = fitted;
      await writeFile(transcriptPath(mediaId), JSON.stringify(transcript));
    }
  } finally {
    await rm(wav, { force: true });
  }
  setMedia(mediaId, { transcriptStatus: 'done', transcriptText: transcript.text, transcriptLang: transcript.language });
  emit({ type: 'job', jobType: 'media.transcribe', status: 'done', workspaceId: row.workspaceId, message: `Transcribed ${row.originalName}` });
}

onJobFailed('media.transcribe', ({ mediaId }: { mediaId: string }, message) => {
  const row = setMedia(mediaId, { transcriptStatus: 'error' });
  emit({ type: 'job', jobType: 'media.transcribe', status: 'error', workspaceId: row.workspaceId, message });
});

export function registerHandlers() {
  registerJob('media.probe', probeMedia, 2);
  // One at a time: Whisper and renders share a 4-core laptop.
  registerJob('media.transcribe', transcribeMedia, 1);
  // Video studio: preview copies of footage, and renders (each render runs its own Chrome workers).
  registerJob('media.proxy', makeProxy, 1);
  onJobFailed('media.proxy', onProxyFailed);
  // One at a time here; with home PCs that render, one on each.
  registerJob('video.render', renderJob, () => Math.max(1, workersWith('render')));
  // The quality check before a render (one call, and Claude's fix in the video's chat when it's below the bar).
  registerJob('edit.check', checkJob, 1);
  // "Follow the speaker": OpenCV over the footage (a minute or so per few minutes of video), then a new edit version.
  registerJob('edit.reframe', reframeEdit, 1);
  onJobFailed('edit.reframe', onReframeFailed);
  // Publishing is network-bound, so it doesn't wait behind renders; two at once keeps cross-posts close together.
  registerJob('post.publish', publishPost, 2);
  onJobFailed('post.publish', onPublishFailed);
  // Campaigns: reading a page (one Haiku call), then sources one at a time — downloads are network-bound and
  // transcripts share the CPU with everything else.
  registerJob('campaign.read', readCampaign, 1);
  onJobFailed('campaign.read', onReadFailed);
  registerJob('source.download', downloadSource, 1);
  onJobFailed('source.download', onSourceFailed);
  registerJob('source.transcribe', transcribeSource, 1);
  onJobFailed('source.transcribe', onSourceFailed);
  // Clipping, one of each at a time: the scan (no Claude), one Claude request per source to pick moments, then each
  // moment cut, cleaned of music (Demucs), checked and edited before its render.
  registerJob('source.scan', scanSource, 1);
  onJobFailed('source.scan', onSourceFailed);
  registerJob('source.pick', pickMoments, 1);
  onJobFailed('source.pick', onSourceFailed);
  registerJob('clip.make', makeClip, 1);
  onJobFailed('clip.make', onMakeFailed);
  // Budgets from the campaigns' public pages (no Claude).
  registerJob('campaign.budget', refreshBudgets, 1);
  // The weekly scout of new tools (Toolbox).
  registerJob('toolbox.scout', scoutJob, 1);
  // References on the Knowledge page: measured (yt-dlp, FFmpeg, Whisper, Demucs; no model). What I like about one is mine to write.
  registerJob('reference.measure', measureReference, 1);
  onJobFailed('reference.measure', onMeasureFailed);
  // Effects that cut the person out: the matte (a local model) then FFmpeg; one at a time, they fill the CPU.
  registerJob('media.effect', applyEffect, 1);
  onJobFailed('media.effect', onEffectFailed);
  // Creative directions for a video (one Opus call).
  registerJob('direction.pitch', pitchDirections, 1);
  onJobFailed('direction.pitch', onPitchFailed);
}
