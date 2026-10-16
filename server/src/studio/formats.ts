// Building a format video (shared/recipe.ts): the `format.build` job speaks the recipe with Kokoro, times every line,
// transcribes the speech for the captions, and lays the edit out around it — background footage muted underneath,
// the voice as the voiceover, the captions in the format's style. Saved as a new version; nothing else in the edit
// (overlays, sound effects, the look) is touched.
import { createHash } from 'node:crypto';
import { execFile as execFileCb } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { and, eq } from 'drizzle-orm';
import { emptyEdit, normalizeEdit, type CaptionSettings, type EditClip, type EditSpec } from '../../../shared/edit';
import { RECIPE_INFO, recipeSpeech, speechSignature, type Recipe } from '../../../shared/recipe';
import type { Transcript } from '../../../shared/types';
import { config } from '../config';
import { db, newId, schema } from '../db';
import { requireBinary } from '../lib/bin';
import { emit } from '../lib/events';
import { getSetting } from '../lib/settings';
import { JobError } from '../jobs/queue';
import { adoptFile, getMedia, whisperInstalled } from '../services/media';
import { type Author } from '../services/pieces';
import { speak, ttsInstalled } from '../services/tts';
import { getEdit, saveEditVersion } from './edits';
import { runTool } from '../compute/run';

const execFile = promisify(execFileCb);

/** How each format's captions look the first time it's built (the creator's later changes are kept). */
const CAPTIONS: Record<Recipe['kind'], Partial<CaptionSettings>> = {
  story: { enabled: true, preset: 'bold', maxWords: 2, position: 0.5, uppercase: true, size: 1.15 },
  chat: { enabled: false },
  dialogue: { enabled: true, preset: 'clean', maxWords: 5, position: 0.36, uppercase: false, size: 1 },
};

/** Whisper's words, or (without Whisper) each line's words spread over its time by length. */
async function transcribe(wav: string, out: string, speech: { text: string }[], timing: { start: number; end: number }[], duration: number): Promise<Transcript> {
  if (whisperInstalled()) {
    await runTool('transcribe', { audio: wav, json: out }, { model: getSetting('whisperModel') ?? 'small' }, { timeoutMs: 60 * 60 * 1000 });
    return JSON.parse(await readFile(out, 'utf8')) as Transcript;
  }
  const segments = speech.flatMap((s, i) => {
    const words = s.text.split(/\s+/).filter(Boolean);
    const { start, end } = timing[i] ?? { start: 0, end: 0 };
    const total = words.reduce((n, w) => n + w.length + 1, 0) || 1;
    let t = start;
    const timed = words.map((w) => {
      const len = ((w.length + 1) / total) * (end - start);
      const word = { start: Math.round(t * 1000) / 1000, end: Math.round((t + len) * 1000) / 1000, word: ` ${w}` };
      t += len;
      return word;
    });
    return timed.length ? [{ start, end, text: s.text, words: timed }] : [];
  });
  return { language: 'en', duration, text: speech.map((s) => s.text).join(' '), segments };
}

/** The workspace's built-in moving background (a slow gradient, made once with FFmpeg). */
async function movingBackground(workspaceId: string) {
  const existing = db
    .select()
    .from(schema.media)
    .where(and(eq(schema.media.workspaceId, workspaceId), eq(schema.media.source, 'generated')))
    .get();
  if (existing) return { id: existing.id, seconds: existing.durationMs ? existing.durationMs / 1000 : 60 };
  const file = join(config.tmpDir, `background-${newId()}.mp4`);
  await execFile(
    requireBinary('ffmpeg'),
    [
      '-y', '-v', 'error', '-f', 'lavfi',
      '-i', 'gradients=s=540x960:c0=0x1e1b4b:c1=0x6d28d9:c2=0x0e7490:c3=0x111827:nb_colors=4:speed=0.015:type=radial:d=60:r=30',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-g', '60', '-movflags', '+faststart', file,
    ],
    { timeout: 10 * 60 * 1000 },
  );
  const m = await adoptFile(workspaceId, file, 'Moving background.mp4', 'video/mp4', { source: 'generated' });
  db.update(schema.media).set({ durationMs: 60_000, width: 540, height: 960 }).where(eq(schema.media.id, m.id)).run();
  return { id: m.id, seconds: 60 };
}

/**
 * Background clips covering `seconds`, muted: each video in turn from a starting point picked by the edit's id (so
 * two videos built from the same gameplay don't start on the same frame), photos for four seconds each.
 */
function backgroundClips(sources: { id: string; seconds: number | null; image: boolean }[], seconds: number, seed: string): EditClip[] {
  const clips: EditClip[] = [];
  let left = seconds;
  let hash = createHash('sha1').update(seed).digest().readUInt32BE(0);
  for (let k = 0; left > 0.05 && k < 200; k++) {
    const src = sources[k % sources.length];
    const len = src.image ? Math.min(4, left) : Math.min(left, src.seconds ?? left);
    const room = src.image || !src.seconds ? 0 : Math.max(0, src.seconds - len);
    const start = room > 1 ? (hash % Math.floor(room * 10)) / 10 : 0;
    hash = (hash * 1103515245 + 12345) >>> 0;
    clips.push({ id: newId().slice(0, 10), mediaId: src.id, in: start, out: Math.round((start + len) * 1000) / 1000, focusX: 0.5, focusY: 0.5, zoom: 1, volume: 0, transition: null });
    left -= len;
  }
  return clips;
}

/** The `format.build` job. */
export async function buildFormat({ editId, by }: { editId: string; by: Author }) {
  const edit = getEdit(editId);
  const spec = normalizeEdit(edit.working);
  const recipe = spec.recipe;
  if (!recipe) throw new JobError('This edit isn’t a format video.', { retry: false });
  if (!ttsInstalled()) throw new JobError('Install the clip tools first (Settings → Clip tools): the voices come with them.', { retry: false });
  const speech = recipeSpeech(recipe).filter((s) => s.text.trim());
  if (!speech.length) throw new JobError('There’s nothing to say yet: write the words first.', { retry: false });

  const dir = join(config.tmpDir, `format-${newId()}`);
  await mkdir(dir, { recursive: true });
  const progress = (message: string) => emit({ type: 'job', jobType: 'format.build', status: 'running', workspaceId: edit.workspaceId, message, editId });
  try {
    progress('Making the voice…');
    const wav = join(dir, 'voice.wav');
    const voice = await speak(speech, wav, { track: `format:${editId}`, onProgress: (done, total) => progress(`Making the voice: line ${done} of ${total}`) });
    progress('Timing the captions…');
    const transcript = await transcribe(wav, join(dir, 'voice.json'), speech, voice.segments, voice.duration);
    const m4a = join(dir, 'voice.m4a');
    await execFile(requireBinary('ffmpeg'), ['-y', '-v', 'error', '-i', wav, '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', m4a], { timeout: 10 * 60 * 1000 });
    const piece = db.select({ title: schema.pieces.title }).from(schema.pieces).where(eq(schema.pieces.id, edit.pieceId)).get();
    const media = await adoptFile(edit.workspaceId, m4a, `${piece?.title || RECIPE_INFO[recipe.kind].label} — voice.m4a`, 'audio/mp4', {
      pieceId: edit.pieceId,
      source: 'tts',
      transcript,
    });
    db.update(schema.media).set({ durationMs: Math.round(voice.duration * 1000) }).where(eq(schema.media.id, media.id)).run();

    // Every line's time, from where its speech landed in the track.
    const timing = voice.segments;
    let next: Recipe;
    if (recipe.kind === 'story') next = { ...recipe, titleEnd: timing[0]?.end ? Math.round((timing[0].end + 0.3) * 1000) / 1000 : 0 };
    else if (recipe.kind === 'chat') next = { ...recipe, messages: recipe.messages.filter((m) => m.text.trim()).map((m, i) => ({ ...m, at: timing[i]?.start ?? 0, end: timing[i]?.end ?? 0 })) };
    else next = { ...recipe, lines: recipe.lines.filter((l) => l.text.trim()).map((l, i) => ({ ...l, at: timing[i]?.start ?? 0, end: timing[i]?.end ?? 0 })), mouth: voice.mouth };
    next = { ...next, builtFrom: speechSignature(next) };

    // The background under the whole voice (and a moment after it).
    progress('Laying out the video…');
    const chosen = recipe.backgrounds.map((id) => getMedia(id)).filter((m) => m.kind === 'video' || m.kind === 'image');
    const sources = chosen.length
      ? chosen.map((m) => ({ id: m.id, seconds: m.durationMs ? m.durationMs / 1000 : null, image: m.kind === 'image' }))
      : [{ ...(await movingBackground(edit.workspaceId)), image: false }];
    const first = !recipe.builtFrom;
    const base = first ? emptyEdit() : spec;
    const out: EditSpec = {
      ...spec,
      clips: backgroundClips(sources, voice.duration + 0.6, editId),
      captions: first ? { ...base.captions, ...spec.captions, ...CAPTIONS[recipe.kind] } : spec.captions,
      audio: { ...spec.audio, voiceover: { mediaId: media.id, volume: spec.audio.voiceover?.volume ?? 1 } },
      recipe: next,
    };
    const { version } = saveEditVersion(editId, { author: by, message: `${first ? 'Made' : 'Remade'} the ${RECIPE_INFO[recipe.kind].label.toLowerCase()} video's voice (${voice.duration.toFixed(1)} s)`, spec: out });
    emit({ type: 'job', jobType: 'format.build', status: 'done', workspaceId: edit.workspaceId, editId, message: `Voice ready: ${voice.duration.toFixed(1)} s, saved as v${version.number}` });
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export function onFormatBuildFailed(payload: unknown, message: string) {
  const editId = (payload as { editId?: string })?.editId;
  const edit = editId ? db.select({ workspaceId: schema.edits.workspaceId }).from(schema.edits).where(eq(schema.edits.id, editId)).get() : undefined;
  emit({ type: 'job', jobType: 'format.build', status: 'error', workspaceId: edit?.workspaceId, editId, message });
}
