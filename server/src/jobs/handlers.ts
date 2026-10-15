import { execFile as execFileCb } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { Transcript } from '../../../shared/types';
import { onReviewFailed, runReview } from '../analytics/review';
import { statsJob } from '../analytics/schedule';
import { askStructured } from '../claude/oneshot';
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
import { enqueue, onJobFailed, registerJob } from './queue';

const execFile = promisify(execFileCb);

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
  // Footage and voice memos get transcribed; brand assets (music, SFX…) and finished renders don't.
  const wantsTranscript = !row.assetType && row.source !== 'render' && !!info?.hasAudio && (row.kind === 'video' || row.kind === 'audio');
  setMedia(mediaId, {
    durationMs: info?.durationMs ?? null,
    width: info?.width ?? null,
    height: info?.height ?? null,
    hasThumb,
    transcriptStatus: wantsTranscript ? (whisperInstalled() ? 'queued' : 'unavailable') : 'none',
  });
  if (wantsTranscript && whisperInstalled()) enqueue('media.transcribe', { mediaId }, { maxAttempts: 2 });
  else if (row.source === 'capture') enqueue('capture.structure', { workspaceId: row.workspaceId, mediaId });
}

async function transcribeMedia({ mediaId }: { mediaId: string }) {
  const row = setMedia(mediaId, { transcriptStatus: 'running' });
  const wav = join(config.tmpDir, `${mediaId}.wav`);
  try {
    await extractAudio(mediaPath(row), wav);
    await execFile(config.whisperPython, [join(config.scriptsDir, 'transcribe.py'), wav, '--out', transcriptPath(mediaId), '--model', getSetting('whisperModel') ?? 'small'], {
      maxBuffer: 20 * 1024 * 1024,
      timeout: 60 * 60 * 1000,
    });
  } finally {
    await rm(wav, { force: true });
  }
  const transcript = JSON.parse(await readFile(transcriptPath(mediaId), 'utf8')) as Transcript;
  setMedia(mediaId, { transcriptStatus: 'done', transcriptText: transcript.text, transcriptLang: transcript.language });
  emit({ type: 'job', jobType: 'media.transcribe', status: 'done', workspaceId: row.workspaceId, message: `Transcribed ${row.originalName}` });
  if (row.source === 'capture') enqueue('capture.structure', { workspaceId: row.workspaceId, mediaId });
}

onJobFailed('media.transcribe', ({ mediaId }: { mediaId: string }, message) => {
  const row = setMedia(mediaId, { transcriptStatus: 'error' });
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
      system: [
        `You turn a creator's rough spoken or typed notes into a content idea card for their "${ws.name}" brand.`,
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
  // Video studio: preview copies of footage, and renders (each render runs its own Chrome workers).
  registerJob('media.proxy', makeProxy, 1);
  onJobFailed('media.proxy', onProxyFailed);
  registerJob('video.render', renderJob, 1);
  // Publishing is network-bound, so it doesn't wait behind renders; two at once keeps cross-posts close together.
  registerJob('post.publish', publishPost, 2);
  onJobFailed('post.publish', onPublishFailed);
  // Analytics: reading posts' numbers (network-bound, one at a time so platforms' rate limits are respected) and
  // Claude's weekly review.
  registerJob('stats.sync', statsJob, 1);
  registerJob('analytics.review', runReview, 1);
  onJobFailed('analytics.review', onReviewFailed);
}
