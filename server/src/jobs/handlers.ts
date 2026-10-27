import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Transcript } from '../../../shared/types';
import { onReviewFailed, runReview } from '../analytics/review';
import { statsJob } from '../analytics/schedule';
import { onReadFailed, readCampaign, refreshBudgets } from '../campaigns/read';
import { onSyncFailed, syncSubmissions } from '../campaigns/submissions';
import { analyseItem, onAnalyseFailed } from '../research/analyse';
import { onBriefFailed, writeBrief } from '../research/brief';
import { onSweepFailed, researchSweep } from '../research/sweep';
import { downloadSource, onSourceFailed, transcribeSource } from '../campaigns/sources';
import { makeClip, onMakeFailed } from '../clipping/make';
import { pickMoments } from '../clipping/pick';
import { scanSource } from '../clipping/scan';
import { askStructured } from '../claude/oneshot';
import { generateMedia, onGenerateFailed } from '../studio/generate';
import { playbook } from '../claude/plugin';
import { config } from '../config';
import { db, now, schema } from '../db';
import { emit } from '../lib/events';
import { extractAudio, makeThumb, probe } from '../lib/ffmpeg';
import { notify } from '../lib/push';
import { getSetting } from '../lib/settings';
import { isLoose, queueInboxSort, suggestInbox } from '../services/inbox';
import { getMedia, mediaPath, thumbPath, transcriptPath, whisperInstalled } from '../services/media';
import { createPiece, getWorkspace } from '../services/pieces';
import { makeProxy, onProxyFailed } from '../studio/proxy';
import { onPublishFailed, publishPost } from '../publish/publisher';
import { renderJob } from '../studio/render';
import { checkJob } from '../studio/quality';
import { onReframeFailed, reframeEdit } from '../studio/reframe';
import { buildFormat, onFormatBuildFailed } from '../studio/formats';
import { onUgcScriptFailed, writeUgcScript } from '../campaigns/ugc';
import { enqueue, onJobFailed, registerJob } from './queue';
import { onPitchFailed, pitchDirections } from '../studio/directions';
import { onFinderFailed, runFinder } from '../finder/finder';
import { applyEffect, onEffectFailed } from '../studio/effects';
import { runTool } from '../compute/run';
import { fleshOut, onAssistFailed, onFleshFailed, runAssist } from '../ideas/assist';
import { fetchDetails } from '../ideas/details';
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
  else if (row.source === 'capture') enqueue('capture.structure', { workspaceId: row.workspaceId, mediaId });
  else if (isLoose(row)) queueInboxSort(row.workspaceId);
}

async function transcribeMedia({ mediaId }: { mediaId: string }) {
  const row = setMedia(mediaId, { transcriptStatus: 'running' });
  const wav = join(config.tmpDir, `${mediaId}.wav`);
  try {
    await extractAudio(mediaPath(row), wav);
    await runTool('transcribe', { audio: wav, json: transcriptPath(mediaId) }, { model: getSetting('whisperModel') ?? 'small' }, { timeoutMs: 60 * 60 * 1000 });
  } finally {
    await rm(wav, { force: true });
  }
  const transcript = JSON.parse(await readFile(transcriptPath(mediaId), 'utf8')) as Transcript;
  setMedia(mediaId, { transcriptStatus: 'done', transcriptText: transcript.text, transcriptLang: transcript.language });
  emit({ type: 'job', jobType: 'media.transcribe', status: 'done', workspaceId: row.workspaceId, message: `Transcribed ${row.originalName}` });
  if (row.source === 'capture') enqueue('capture.structure', { workspaceId: row.workspaceId, mediaId });
  else if (isLoose(getMedia(mediaId))) queueInboxSort(row.workspaceId);
}

onJobFailed('media.transcribe', ({ mediaId }: { mediaId: string }, message) => {
  const row = setMedia(mediaId, { transcriptStatus: 'error' });
  if (isLoose(row)) queueInboxSort(row.workspaceId);
  emit({ type: 'job', jobType: 'media.transcribe', status: 'error', workspaceId: row.workspaceId, message });
  // A voice memo should never be lost: still turn it into a card, even without words.
  if (row.source === 'capture') enqueue('capture.structure', { workspaceId: row.workspaceId, mediaId });
});

type CapturedIdea = { title: string; hook: string; outline: string; tags: string[] };

const IDEA_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'hook', 'outline', 'tags'],
  properties: {
    title: { type: 'string', description: 'Short working title, max 60 characters' },
    hook: { type: 'string', description: 'A scroll-stopping opening line for a short vertical video, in my voice' },
    outline: { type: 'string', description: 'The idea as a few short bullet points (markdown "- " lines)' },
    tags: { type: 'array', items: { type: 'string' }, maxItems: 4 },
  },
};

/** Turn a voice memo or quick note into an idea card. */
async function structureCapture(payload: { workspaceId: string; mediaId?: string; text?: string }) {
  const ws = getWorkspace(payload.workspaceId);
  const memo = payload.mediaId ? getMedia(payload.mediaId) : undefined;
  const raw = (payload.text ?? memo?.transcriptText ?? '').trim();

  let idea: CapturedIdea;
  if (raw) {
    idea = await askStructured<CapturedIdea>({
      task: 'ideas',
      system: [
        // The same text every time first, so it caches.
        playbook('hooks', 'halal'),
        `You turn a creator's rough spoken or typed notes into a content idea card for their "${ws.name}" brand.`,
        ws.niche && `The page's niche: ${ws.niche}`,
        ws.description && `About the brand: ${ws.description}`,
        ws.brandGuide && `Brand guide:\n${ws.brandGuide}`,
        ws.voiceMemory && `What you've learned about their voice:\n${ws.voiceMemory}`,
        'Keep their meaning; do not invent facts, claims or numbers they did not say. Match the language they spoke in.',
      ]
        .filter(Boolean)
        .join('\n\n'),
      prompt: `My note:\n"""\n${raw}\n"""`,
      schema: IDEA_SCHEMA,
      model: 'haiku',
    });
  } else {
    idea = { title: `Voice memo ${new Date().toLocaleString()}`, hook: '', outline: '', tags: [] };
  }

  const { pieceId } = createPiece(ws.id, {
    title: idea.title.slice(0, 120) || 'New idea',
    tags: idea.tags.map((t) => t.toLowerCase().replace(/^#/, '')).slice(0, 4),
    content: { hook: idea.hook, script: idea.outline, notes: raw ? `Original note:\n${raw}` : '' },
    author: 'claude',
    message: 'Captured idea',
  });
  if (memo) {
    db.update(schema.media).set({ pieceId }).where(eq(schema.media.id, memo.id)).run();
    emit({ type: 'changed', entity: 'media', workspaceId: ws.id, id: memo.id });
  }
  await notify(`New idea in ${ws.name}`, idea.title, `/w/${ws.id}/p/${pieceId}`);
}

onJobFailed('capture.structure', (payload: { workspaceId: string; mediaId?: string; text?: string }, message) => {
  // Claude unavailable (e.g. usage limit): keep the raw note as a card rather than dropping it.
  const memo = payload.mediaId ? getMedia(payload.mediaId) : undefined;
  const raw = (payload.text ?? memo?.transcriptText ?? '').trim();
  const { pieceId } = createPiece(payload.workspaceId, {
    title: raw ? raw.split(/\s+/).slice(0, 8).join(' ') + (raw.split(/\s+/).length > 8 ? '…' : '') : 'Voice memo',
    content: { notes: raw ? `Original note:\n${raw}` : '' },
    message: 'Captured (Claude was unavailable)',
  });
  if (memo) db.update(schema.media).set({ pieceId }).where(eq(schema.media.id, memo.id)).run();
  emit({ type: 'job', jobType: 'capture.structure', status: 'error', workspaceId: payload.workspaceId, message });
});

/** Fold my recent edits to Claude's drafts into the workspace's voice memory. */
async function learnVoice({ workspaceId }: { workspaceId: string }) {
  const ws = getWorkspace(workspaceId);
  const edits = db
    .select()
    .from(schema.editEvents)
    .where(and(eq(schema.editEvents.workspaceId, workspaceId), isNull(schema.editEvents.learnedAt)))
    .orderBy(asc(schema.editEvents.createdAt))
    .limit(30)
    .all();
  if (!edits.length) return;

  const examples = edits.map((e, i) => `### Edit ${i + 1} — ${e.field}\nClaude wrote:\n${e.before}\n\nI changed it to:\n${e.after}`).join('\n\n');
  const { memory } = await askStructured<{ memory: string }>({
    task: 'ideas',
    system:
      'You maintain a concise style memory for a content creator: how they want their hooks, scripts and captions written. ' +
      'Study how they rewrote drafts and update the memory. Keep durable, specific, actionable rules (tone, length, words they cut or add, ' +
      'With only one or two examples, record just the clearest pattern and mark it "(tentative)"; confirm or drop tentative rules as more edits arrive. ' +
      'emoji/hashtag habits, structure). Merge with existing notes, drop rules the new edits contradict, no one-off trivia. ' +
      'Return the full updated memory as short markdown bullet points, under 300 words.',
    prompt: `Brand: ${ws.name}\n\nCurrent memory:\n${ws.voiceMemory || '(empty)'}\n\nRecent edits:\n\n${examples}`,
    schema: { type: 'object', additionalProperties: false, required: ['memory'], properties: { memory: { type: 'string' } } },
  });

  db.transaction((tx) => {
    tx.update(schema.workspaces).set({ voiceMemory: memory.trim(), updatedAt: now() }).where(eq(schema.workspaces.id, workspaceId)).run();
    for (const e of edits) tx.update(schema.editEvents).set({ learnedAt: now() }).where(eq(schema.editEvents.id, e.id)).run();
  });
  emit({ type: 'changed', entity: 'workspaces', workspaceId });
  emit({ type: 'job', jobType: 'voice.learn', status: 'done', workspaceId, message: `Claude learned from ${edits.length} of your edits` });
}

export function registerHandlers() {
  registerJob('media.probe', probeMedia, 2);
  // One at a time: Whisper and renders share a 4-core laptop.
  registerJob('media.transcribe', transcribeMedia, 1);
  registerJob('capture.structure', structureCapture, 1);
  registerJob('voice.learn', learnVoice, 1);
  registerJob('inbox.suggest', suggestInbox, 1);
  // Video studio: preview copies of footage, and renders (each render runs its own Chrome workers).
  registerJob('media.proxy', makeProxy, 1);
  onJobFailed('media.proxy', onProxyFailed);
  registerJob('video.render', renderJob, 1);
  // The quality check before a render (one call, and Claude's fix in the video's chat when it's below the bar).
  registerJob('edit.check', checkJob, 1);
  // "Follow the speaker": OpenCV over the footage (a minute or so per few minutes of video), then a new edit version.
  registerJob('edit.reframe', reframeEdit, 1);
  onJobFailed('edit.reframe', onReframeFailed);
  // A format video's voice (Kokoro, then Whisper for the captions): a minute or so of CPU.
  registerJob('format.build', buildFormat, 1);
  onJobFailed('format.build', onFormatBuildFailed);
  // A UGC script from a campaign's brief: one Sonnet call (waits while the 5-hour usage is high).
  registerJob('ugc.script', writeUgcScript, 1);
  onJobFailed('ugc.script', onUgcScriptFailed);
  // Publishing is network-bound, so it doesn't wait behind renders; two at once keeps cross-posts close together.
  registerJob('post.publish', publishPost, 2);
  onJobFailed('post.publish', onPublishFailed);
  // Analytics: reading posts' numbers (network-bound, one at a time so platforms' rate limits are respected) and
  // Claude's weekly review.
  registerJob('stats.sync', statsJob, 1);
  registerJob('analytics.review', runReview, 1);
  onJobFailed('analytics.review', onReviewFailed);
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
  // Submissions and earnings: budgets from the campaigns' public pages (no Claude), and my submissions page on
  // Content Rewards read in the signed-in window (one Haiku call).
  registerJob('campaign.budget', refreshBudgets, 1);
  registerJob('submissions.sync', syncSubmissions, 1);
  onJobFailed('submissions.sync', onSyncFailed);
  // Research: the daily sweep (yt-dlp and page reads, no Claude), the brief (one Haiku call) and analyses of single
  // videos (a download, FFmpeg and one Claude call with frames).
  registerJob('research.sweep', researchSweep, 1);
  registerJob('toolbox.scout', scoutJob, 1);
  onJobFailed('research.sweep', onSweepFailed);
  registerJob('research.brief', writeBrief, 1);
  onJobFailed('research.brief', onBriefFailed);
  registerJob('research.analyse', analyseItem, 1);
  onJobFailed('research.analyse', onAnalyseFailed);
  // Effects that cut the person out: the matte (a local model) then FFmpeg; one at a time, they fill the CPU.
  registerJob('media.effect', applyEffect, 1);
  // One at a time: they all run on the same home PC's card.
  registerJob('media.generate', generateMedia, 1);
  onJobFailed('media.generate', onGenerateFailed);
  onJobFailed('media.effect', onEffectFailed);
  // The finder: a run per clipping page, one at a time (it only starts the jobs above).
  registerJob('finder.run', runFinder, 1);
  onJobFailed('finder.run', onFinderFailed);
  // Creative directions for a video (one Sonnet call).
  registerJob('direction.pitch', pitchDirections, 1);
  onJobFailed('direction.pitch', onPitchFailed);
  // Ideas: a saved post's details (yt-dlp, Whisper, no Claude); Claude's help on a card and on a locked-in idea
  // (one call each, on my click).
  registerJob('ideas.details', fetchDetails, 1);
  registerJob('ideas.assist', runAssist, 2);
  onJobFailed('ideas.assist', onAssistFailed);
  registerJob('ideas.flesh', fleshOut, 1);
  onJobFailed('ideas.flesh', onFleshFailed);
}
