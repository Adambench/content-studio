// Making a clip from a moment (the `clip.make` job): cut it from the source with margins, keep only the voice
// (Demucs; checked in the pauses when there was music behind it, or the clip is dropped), look at three frames for
// anything haram (Haiku), transcribe the voice, find the speaker's face, then put it on the page's board: a piece in
// Making with Claude's captions, an edit in the page's look (tightened, captions, hook card, a few sound effects),
// and a render. The render finishing moves the card to Review (studio/render.ts).
import { execFile as execFileCb } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { and, eq, inArray } from 'drizzle-orm';
import { MOMENT_KIND_LABELS, clock, type FramesCheck, type MusicCheck } from '../../../shared/clipping';
import { TIGHTEN_PRESETS, editDuration, normalizeEdit, speechRangesFromTranscript, tightenClips, type EditSpec } from '../../../shared/edit';
import { builtinSfxId } from '../../../shared/sfx';
import { emptyDraft, type Transcript } from '../../../shared/types';
import { askStructured } from '../claude/oneshot';
import { playbook } from '../claude/plugin';
import { waitForUsage } from '../claude/usage';
import { getCampaignRow, getSource } from '../campaigns/campaigns';
import { readSourceTranscript, run, sourceFile } from '../campaigns/sources';
import { config } from '../config';
import { db, schema } from '../db';
import { requireBinary } from '../lib/bin';
import { emit } from '../lib/events';
import { extractFrames, probe } from '../lib/ffmpeg';
import { getSetting } from '../lib/settings';
import { JobError } from '../jobs/queue';
import { clipToolsInstalled, toolsEnv, yunetModel } from '../services/cliptools';
import { adoptFile, deleteMedia, whisperInstalled } from '../services/media';
import { createPiece, getWorkspace } from '../services/pieces';
import { createEdit, saveEditVersion } from '../studio/edits';
import { cancelRender, queueRender } from '../studio/render';
import { getMoment, momentExists, updateMoment } from './moments';

const execFile = promisify(execFileCb);
const MARGIN = 0.5;

const ffmpeg = (args: string[], timeoutMs = 10 * 60_000) =>
  execFile(requireBinary('ffmpeg'), ['-hide_banner', '-nostdin', '-y', '-v', 'error', ...args], { maxBuffer: 20 * 1024 * 1024, timeout: timeoutMs });

/** Integrated loudness (LUFS), or null for silence. */
export async function loudness(file: string) {
  const { stderr } = await execFile(requireBinary('ffmpeg'), ['-hide_banner', '-nostdin', '-i', file, '-af', 'ebur128', '-f', 'null', '-'], { maxBuffer: 50 * 1024 * 1024 });
  const m = /I:\s+(-?[\d.]+) LUFS/.exec(stderr.slice(stderr.lastIndexOf('Summary:')));
  const v = m ? Number(m[1]) : NaN;
  return Number.isFinite(v) && v > -70 ? v : null;
}

/** The sound's level every 100 ms (dBFS). */
async function levels(file: string) {
  const { stdout } = await execFile(requireBinary('ffmpeg'), ['-v', 'error', '-nostdin', '-i', file, '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
  const n = 1600;
  const out: number[] = [];
  for (let i = 0; i + n * 2 <= stdout.length; i += n * 2) {
    let sum = 0;
    for (let k = 0; k < n; k++) {
      const v = stdout.readInt16LE(i + k * 2) / 32768;
      sum += v * v;
    }
    out.push(10 * Math.log10(sum / n + 1e-12));
  }
  return out;
}

const percentile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor((q / 100) * s.length))] : NaN;
};

/**
 * The music check (`MusicCheck`): there's background when what isn't voice is loud (over −35 LUFS) or close to the
 * voice (within 12 dB). Then the isolated voice must be silent in the pauses between words (a song's singing or
 * leftovers of the music would show there); with too few pauses to tell, it's "unverified" and the review says to
 * listen. `left` when the voice isn't clean: the clip is dropped.
 */
export async function musicCheck(voice: string, rest: string, words: { start: number; end: number }[]): Promise<MusicCheck> {
  const [voiceLufs, restLufs] = await Promise.all([loudness(voice), loudness(rest)]);
  const background = restLufs !== null && (restLufs > -35 || (voiceLufs !== null && restLufs > voiceLufs - 12));
  if (!background) return { background, verdict: 'none', voiceLufs, restLufs, pauseSeconds: 0 };
  const v = await levels(voice);
  const pause = v.map((_, i) => {
    const t = i / 10 + 0.05;
    return words.every((w) => t < w.start - 0.3 || t > w.end + 0.3);
  });
  const inPauses = v.filter((_, i) => pause[i]);
  const inSpeech = v.filter((_, i) => !pause[i]);
  const pauseSeconds = Math.round(inPauses.length) / 10;
  if (pauseSeconds < 1) return { background, verdict: 'unverified', voiceLufs, restLufs, pauseSeconds };
  const clean = percentile(inPauses, 90) < Math.max(-50, percentile(inSpeech, 50) - 25);
  return { background, verdict: clean ? 'removed' : 'left', voiceLufs, restLufs, pauseSeconds };
}

const FRAMES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'reasons'],
  properties: { verdict: { type: 'string', enum: ['ok', 'flag', 'reject'] }, reasons: { type: 'array', items: { type: 'string' } } },
};

/** Three frames to Haiku, against the halal rules: what the clip shows. */
async function framesCheck(video: string, seconds: number, dir: string): Promise<FramesCheck> {
  const files = await extractFrames(video, [0.15, 0.5, 0.85].map((f) => f * seconds), (i) => join(dir, `frame${i}.jpg`), 768);
  const images = await Promise.all(files.map(async (f) => ({ data: (await readFile(f)).toString('base64'), mediaType: 'image/jpeg' as const })));
  const out = await askStructured<FramesCheck>({
    system: [
      playbook('halal'),
      'You look at three frames of a short clip cut from a podcast, stream or interview, for a creator who keeps every post halal by the rules above. Judge only what is visible in the frames: `reject` when one clearly shows something never promoted or shown (a drink of alcohol, gambling on screen, smoking or vaping, immodest dress or imagery, a haram product as the point); `flag` when something visible is a gray area, or a frame is too dark or blurred to judge; `ok` when nothing visible applies, with no reasons.',
      'Sound and music are checked separately: never mention them. Don’t flag what you can’t see (“can’t rule out” is not a reason). One short line per reason, naming the frame and what is in it.',
    ]
      .filter(Boolean)
      .join('\n\n'),
    prompt: 'The three frames, from the start, middle and end of the clip.',
    images,
    schema: FRAMES_SCHEMA,
    model: 'haiku',
  });
  return { verdict: ['ok', 'flag', 'reject'].includes(out.verdict) ? out.verdict : 'flag', reasons: (out.reasons ?? []).map((r) => r.trim()).filter(Boolean).slice(0, 5) };
}

/** The source's own transcript between two times, shifted to start at 0 (when Whisper isn't installed). */
function sliceTranscript(t: Transcript, from: number, to: number): Transcript {
  const segments = t.segments
    .filter((s) => s.end > from && s.start < to)
    .map((s) => {
      const words = (s.words ?? []).filter((w) => w.end > from && w.start < to).map((w) => ({ ...w, start: Math.max(0, w.start - from), end: Math.min(to, w.end) - from }));
      return { start: Math.max(0, s.start - from), end: Math.min(to, s.end) - from, text: words.length ? words.map((w) => w.word).join('').trim() : s.text, words };
    });
  return { language: t.language, duration: to - from, text: segments.map((s) => s.text).join(' '), segments };
}

type Face = { x: number; y: number; h: number };

/**
 * Where to frame: the median centre of the biggest face in sampled frames. Two people taking turns in a wide shot
 * give two clusters; the busier one wins (following whoever speaks comes later).
 */
async function findFocus(video: string, momentId: string): Promise<Face | null> {
  const out = await run(config.toolsPython, [join(config.scriptsDir, 'faces.py'), video, '--model', yunetModel(), '--samples', '12'], { env: toolsEnv(), timeoutMs: 5 * 60_000, track: `clip:${momentId}` });
  const r = JSON.parse(out.trim().split('\n').pop() ?? '{}') as { faces?: { x: number; y: number; h: number }[]; focus?: Face | null };
  const faces = r.faces ?? [];
  if (!faces.length) return null;
  const xs = faces.map((f) => f.x).sort((a, b) => a - b);
  let split = -1;
  let gap = 0.2;
  for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] > gap) ((gap = xs[i] - xs[i - 1]), (split = i));
  const group = split < 0 ? faces : (split >= xs.length - split ? faces.filter((f) => f.x < xs[split]) : faces.filter((f) => f.x >= xs[split]));
  const med = (k: keyof Face) => percentile(group.map((f) => f[k]), 50);
  return { x: med('x'), y: med('y'), h: med('h') };
}

/** Delete a clip's card with the files clipping made for it (the cut and its renders), e.g. when rejected. */
export async function discardClip(pieceId: string) {
  const piece = db.select().from(schema.pieces).where(eq(schema.pieces.id, pieceId)).get();
  if (!piece) return;
  for (const r of db.select().from(schema.renders).where(and(eq(schema.renders.pieceId, pieceId), inArray(schema.renders.status, ['queued', 'running']))).all()) cancelRender(r.id);
  const files = db
    .select({ id: schema.media.id })
    .from(schema.media)
    .where(and(eq(schema.media.pieceId, pieceId), inArray(schema.media.source, ['clip', 'render'])))
    .all();
  for (const f of files) await deleteMedia(f.id);
  db.delete(schema.pieces).where(eq(schema.pieces.id, pieceId)).run();
  emit({ type: 'changed', entity: 'pieces', workspaceId: piece.workspaceId, id: pieceId });
}

/** The `clip.make` job. */
export async function makeClip({ momentId }: { momentId: string }) {
  if (!momentExists(momentId)) return;
  let m = getMoment(momentId);
  if (m.status !== 'making') return;
  if (!clipToolsInstalled()) throw new JobError('Install the clip tools first (Settings → Clip tools): they remove background music.', { retry: false });
  try {
    // A render and Demucs each fill the CPU and a few GB of memory: the render goes first, so the clips already made
    // reach Review sooner (and the laptop doesn't run out of memory).
    if (db.select({ id: schema.jobs.id }).from(schema.jobs).where(and(eq(schema.jobs.type, 'video.render'), eq(schema.jobs.status, 'running'))).get())
      throw new JobError('Waiting for a render to finish', { wait: true, delayMs: 15_000 });
    waitForUsage();
  } catch (err) {
    if (m.detail !== (err as Error).message) updateMoment(momentId, { detail: (err as Error).message });
    throw err;
  }
  const s = getSource(m.sourceId);
  const c = getCampaignRow(m.campaignId);
  // Paused or ended meanwhile: it waits as found, to make later by hand.
  if (c.status !== 'active') {
    updateMoment(momentId, { status: 'candidate', detail: 'Not made: the campaign isn’t active.' });
    return;
  }
  const file = sourceFile(s);
  if (!file) throw new JobError('The source video was deleted to save space: download it again (Source videos → Download again), then make the clip.', { retry: false });
  const info = await probe(file);
  if (!info.hasVideo || !info.hasAudio) throw new JobError('The source needs both picture and sound to make a clip.', { retry: false });
  const sourceSeconds = (info.durationMs ?? s.durationMs ?? 0) / 1000;
  // A retry starts clean: the card an earlier attempt made goes.
  if (m.pieceId) {
    await discardClip(m.pieceId);
    m = updateMoment(momentId, { pieceId: null });
  }

  const dir = join(config.tmpDir, 'clips', momentId);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const step = (detail: string) => {
    if (!momentExists(momentId)) throw new JobError('The moment was deleted.', { retry: false });
    // Skipped just as it started: leave it skipped.
    if (getMoment(momentId).status !== 'making') throw new Skipped();
    updateMoment(momentId, { detail });
  };
  try {
    // 1. The cut, with margins: the picture at full quality, the sound as WAV for Demucs.
    step('Cutting it from the source');
    const cutStart = Math.max(0, m.start - MARGIN);
    const cutEnd = Math.min(sourceSeconds || m.end + MARGIN, m.end + MARGIN);
    const length = cutEnd - cutStart;
    const video = join(dir, 'video.mp4');
    const original = join(dir, 'original.wav');
    await ffmpeg(['-ss', cutStart.toFixed(3), '-i', file, '-t', length.toFixed(3), '-map', '0:v:0', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', video]);
    await ffmpeg(['-ss', cutStart.toFixed(3), '-i', file, '-t', length.toFixed(3), '-map', '0:a:0', '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', original]);

    // 2. Voice and everything else apart (about 30 s for 45 s of clip).
    step('Separating the voice from any music');
    const voice = join(dir, 'voice.wav');
    const rest = join(dir, 'rest.wav');
    await run(config.toolsPython, [join(config.scriptsDir, 'separate.py'), original, '--vocals', voice, '--rest', rest], { env: toolsEnv(), timeoutMs: 20 * 60_000, track: `clip:${momentId}` });

    // 3. The voice's words, for the music check's pauses and the captions.
    step('Transcribing the voice');
    let transcript: Transcript;
    if (whisperInstalled()) {
      const wav = join(dir, 'voice16k.wav');
      const out = join(dir, 'transcript.json');
      await ffmpeg(['-i', voice, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
      await run(config.whisperPython, [join(config.scriptsDir, 'transcribe.py'), wav, '--out', out, '--model', getSetting('whisperModel') ?? 'small'], { timeoutMs: 20 * 60_000, track: `clip:${momentId}` });
      transcript = JSON.parse(await readFile(out, 'utf8')) as Transcript;
    } else {
      const whole = await readSourceTranscript(s);
      if (!whole) throw new JobError('There’s no transcript to caption it from.', { retry: false });
      transcript = sliceTranscript(whole, cutStart, cutEnd);
    }
    const words = transcript.segments.flatMap((seg) => seg.words ?? []);

    step('Checking for music');
    const music = await musicCheck(voice, rest, words);
    if (music.verdict === 'left') {
      updateMoment(momentId, { status: 'dropped', music, detail: 'Background music couldn’t be removed cleanly, so the clip was dropped.' });
      return;
    }

    // 4. What the clip shows.
    step('Checking what’s on screen');
    const frames = await framesCheck(video, length, dir);
    if (frames.verdict === 'reject') {
      updateMoment(momentId, { status: 'dropped', frames, music, detail: `Dropped by the halal check: ${frames.reasons[0] ?? 'something on screen'}`.slice(0, 300) });
      return;
    }

    // 5. The speaker's face, to frame on.
    step('Finding the speaker');
    const face = await findFocus(video, momentId).catch((err: Error) => (console.warn(`[clip] faces for ${momentId}: ${err.message}`), null));

    // The finished cut: the picture with only the voice.
    const clip = join(dir, 'clip.mp4');
    await ffmpeg(['-i', video, '-i', voice, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-shortest', '-movflags', '+faststart', clip]);
    const clipInfo = await probe(clip);

    // 6. The card, with Claude's captions as a version of its own.
    step('Putting it on the board');
    if (!momentExists(momentId)) return;
    const ws = getWorkspace(m.workspaceId);
    const at = `${clock(m.start)}–${clock(m.end)}`;
    const link = s.kind === 'youtube' && s.link ? `${s.link}&t=${Math.floor(m.start)}s` : s.link;
    const draft = emptyDraft();
    if (m.captions) draft.platforms = { ...draft.platforms, ...m.captions };
    const spoken = words.filter((w) => w.start >= m.start - cutStart - 0.3 && w.end <= m.end - cutStart + 0.3).map((w) => w.word).join('').trim();
    const notes = [
      `Clipped from “${s.title || 'a source video'}” at ${at}${link ? `\n${link}` : ''}`,
      `Campaign: ${c.title}`,
      `${MOMENT_KIND_LABELS[m.kind]} · standalone score ${m.score}/10${m.why ? `\n${m.why}` : ''}`,
      m.halalFlags.length && `Halal flags:\n${m.halalFlags.map((f) => `- ${f}`).join('\n')}`,
      frames.verdict === 'flag' && `On screen (check it):\n${frames.reasons.map((f) => `- ${f}`).join('\n')}`,
      music.verdict === 'removed' && 'Background music was removed: only the voice is kept.',
      music.verdict === 'unverified' && 'There was sound behind the voice and it’s been removed, but the speech never pauses long enough to check: listen for any music left.',
      m.checkByEye.length && `Check by eye:\n${m.checkByEye.map((f) => `- ${f}`).join('\n')}`,
    ]
      .filter(Boolean)
      .join('\n\n');
    const tag = (c.brand || c.title).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 24);
    const { pieceId } = createPiece(ws.id, {
      title: m.title || `Clip from ${s.title || 'a source'}`,
      // A clipping page's Making column; a page without one (a business's) gets it in Edit.
      stage: ['making', 'edit'].find((id) => ws.stages.some((st) => st.id === id)),
      tags: tag ? [tag] : [],
      content: { ...draft, hook: m.hookCard.replace(/\*/g, '') || m.firstLine, script: spoken || m.firstLine, notes },
      author: 'claude',
      message: `Clip of ${at}`,
    });
    updateMoment(momentId, { pieceId, music, frames });
    const media = await adoptFile(ws.id, clip, `${(m.title || s.title || 'Clip').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80)}.mp4`, 'video/mp4', { pieceId, source: 'clip', transcript });
    db.update(schema.media)
      .set({ durationMs: clipInfo.durationMs, width: clipInfo.width, height: clipInfo.height })
      .where(eq(schema.media.id, media.id))
      .run();

    // 7. The edit, in the page's look.
    const edit = createEdit(pieceId, 'claude');
    const spec = normalizeEdit(edit.working);
    const rel = { start: m.start - cutStart, end: m.end - cutStart };
    const first = words.find((w) => w.end > rel.start + 0.05);
    const last = [...words].reverse().find((w) => w.start < rel.end - 0.05);
    const clipLen = (clipInfo.durationMs ?? length * 1000) / 1000;
    const base = spec.clips.find((x) => x.mediaId === media.id) ?? spec.clips[0];
    if (!base) throw new Error('The edit didn’t pick up the cut.');
    base.mediaId = media.id;
    base.in = Math.max(0, (first?.start ?? rel.start) - 0.1);
    base.out = Math.min(clipLen, (last?.end ?? rel.end) + 0.35);
    if (face) {
      base.focusX = Math.round(face.x * 1000) / 1000;
      base.focusY = Math.round(Math.max(0, face.y - 0.05) * 1000) / 1000;
    }
    let clips = tightenClips([base], { [media.id]: speechRangesFromTranscript(transcript, true) }, TIGHTEN_PRESETS.tight);
    if (!clips.length) clips = [base];
    const next: EditSpec = { ...spec, clips, overlays: [...spec.overlays], audio: { ...spec.audio, sfx: [...spec.audio.sfx] } };
    const total = editDuration(next);
    if (m.hookCard) {
      const end = Math.min(2.5, total);
      next.overlays.push({ id: crypto.randomUUID().slice(0, 8), type: 'text', text: m.hookCard, style: 'title', position: 'top', animation: 'pop', start: 0, end });
      next.audio.sfx.push({ id: crypto.randomUUID().slice(0, 8), mediaId: builtinSfxId('pop'), at: 0.05, volume: 0.6 });
    }
    // One soft whoosh on the first jump cut after the hook: sparing, under the voice.
    let t = 0;
    for (const x of clips.slice(0, -1)) {
      t += x.out - x.in;
      if (t > 2.6 && t < total - 1) {
        next.audio.sfx.push({ id: crypto.randomUUID().slice(0, 8), mediaId: builtinSfxId('whoosh-fast'), at: Math.max(0, Math.round((t - 0.15) * 100) / 100), volume: 0.3 });
        break;
      }
    }
    saveEditVersion(edit.id, { author: 'claude', message: `Clip of ${at}: tightened, hook card, captions`, spec: next });

    // 8. Render; finishing moves it to Review.
    queueRender(edit.id, 'claude');
    updateMoment(momentId, { status: 'made', detail: '' });
  } catch (err) {
    if (!(err instanceof Skipped)) throw err;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

class Skipped extends Error {}

export function onMakeFailed({ momentId }: { momentId: string }, message: string) {
  if (!momentExists(momentId)) return;
  updateMoment(momentId, { status: 'failed', detail: message.slice(0, 300) });
  emit({ type: 'job', jobType: 'clip.make', status: 'error', message });
}
