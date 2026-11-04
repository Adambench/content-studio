// Making a clip from a moment (the `clip.make` job): cut it from the source with margins, keep only the voice
// (Demucs; checked in the pauses when there was music behind it, or the clip is dropped), look at three frames for
// anything haram (Opus), transcribe the voice, find the speaker's face, then put it on the page's board: a piece in
// Making with Claude's captions, an edit in the page's look (tightened, captions, hook card, a few sound effects),
// and a render. The render finishing moves the card to Review (studio/render.ts).
import { execFile as execFileCb } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { and, eq, inArray } from 'drizzle-orm';
import { MOMENT_KIND_LABELS, clock, type BurnedIn, type FramesCheck, type LeftOut, type MusicCheck } from '../../../shared/clipping';
import { TIGHTEN_PRESETS, clipStarts, editDuration, fillerRangesFromTranscript, normalizeEdit, smoothJumps, speechRangesFromTranscript, tightenClips, type EditClip } from '../../../shared/edit';
import { emptyDraft, normalizeDraft, type Transcript } from '../../../shared/types';
import { askStructured } from '../claude/oneshot';
import { playbook } from '../claude/plugin';
import { waitForUsage } from '../claude/usage';
import { getCampaignRow, getSource } from '../campaigns/campaigns';
import { readSourceTranscript, sourceFile } from '../campaigns/sources';
import { config } from '../config';
import { db, schema } from '../db';
import { requireBinary } from '../lib/bin';
import { emit } from '../lib/events';
import { extractFrames, probe } from '../lib/ffmpeg';
import { getSetting } from '../lib/settings';
import { JobError } from '../jobs/queue';
import { clipToolsInstalled } from '../services/cliptools';
import { adoptFile, deleteMedia, whisperInstalled } from '../services/media';
import { createPiece, getBranch, getPiece, getWorkspace, saveVersion } from '../services/pieces';
import { applyLook, lookTag, pickLook } from '../studio/clip-looks';
import { isLectureCampaign, speakerTag } from '../islamic/lectures';
import { sentenceBounds } from './bounds';
import { addListenerCutaway } from './cutaway';
import { fillHook, whoTag } from './framing';
import { createEdit, saveEditVersion, startingSpec } from '../studio/edits';
import { refineWords, snapCuts, voiceEnvelope } from '../studio/clean-cuts';
import { applyFocusSpans, focusSpans, scanSpeakers, trimSlivers, withoutRanges, type SpeakerScan } from '../studio/reframe';
import { cancelRender, queueRender, renderingHere } from '../studio/render';
import { getMoment, momentExists, updateMoment } from './moments';
import { runTool } from '../compute/run';

const execFile = promisify(execFileCb);
/** Room cut either side of the picked moment, so its first and last sentences can be finished (clipping/bounds.ts). */
const HEAD = 6;
const TAIL = 16;

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
  required: ['verdict', 'reasons', 'leaveOut', 'burnedIn'],
  properties: {
    verdict: { type: 'string', enum: ['ok', 'flag', 'reject'] },
    reasons: { type: 'array', items: { type: 'string' } },
    leaveOut: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['frame', 'why'], properties: { frame: { type: 'integer' }, why: { type: 'string' } } },
    },
    burnedIn: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['what', 'edge', 'depth'],
        properties: { what: { type: 'string' }, edge: { type: 'string', enum: ['top', 'bottom'] }, depth: { type: 'number' } },
      },
    },
  },
};

/**
 * Frames to Opus, against the halal rules: one from every shot of the clip (a shot of a drink for a few frames counts
 * as much as a long one), or three across it without a shot scan. Up to 12.
 */
export async function framesCheck(
  video: string,
  range: { start: number; end: number },
  shots: { start: number; end: number }[] | null,
  dir: string,
  /** The part of the picture the clip shows at a time (fractions of the width), when it's cropped: judged with a little margin. */
  shown?: (t: number) => { x0: number; x1: number } | null,
): Promise<FramesCheck> {
  const inside = (shots ?? []).map((sh) => ({ a: Math.max(range.start, sh.start), b: Math.min(range.end, sh.end) })).filter((sh) => sh.b - sh.a >= 0.08);
  // One frame per shot (up to 16), each standing for its shot; without a shot scan, three across the clip.
  let picked = inside.length ? inside : [0.15, 0.5, 0.85].map((f) => ({ a: range.start + (f - 0.15) * (range.end - range.start), b: range.start + (f + 0.15) * (range.end - range.start) }));
  if (picked.length > 16) picked = Array.from({ length: 16 }, (_, i) => picked[Math.round((i * (picked.length - 1)) / 15)]);
  const times = picked.map((sh) => (sh.a + sh.b) / 2);
  const files = await extractFrames(video, times, (i) => join(dir, `frame${i}.jpg`), times.length > 6 ? 448 : 768, shown ? times.map(shown) : undefined);
  const images = await Promise.all(files.map(async (f) => ({ data: (await readFile(f)).toString('base64'), mediaType: 'image/jpeg' as const })));
  const out = await askStructured<FramesCheck & { leaveOut?: { frame: number; why: string }[] }>({
    task: 'clips',
    system: [
      playbook('halal'),
      'You look at frames of a short clip cut from a podcast, stream or interview (one from each of its shots, in order), for a creator who keeps every post halal by the rules above. Judge only what is visible in the frames, every one of them, the background too (a drink on the table, a bottle on a shelf, a brand on a shirt): `reject` when one clearly shows something never promoted or shown (a drink of alcohol, gambling on screen, smoking or vaping, immodest dress or imagery, a haram product as the point); `flag` when something visible is a gray area, or a frame is too dark or blurred to judge; `ok` when nothing visible applies, with no reasons.',
      'Separately, `leaveOut`: the frames (numbered from 1) whose shot must not be in the clip at all, each with why: any woman visible, however she is dressed (the creator never shows women on camera); anything from the list above; and in a podcast or interview, footage that isn’t the show’s own cameras (the guest’s photos or home videos, inserted B-roll, screen recordings, clips from elsewhere). Those shots are cut out and the rest of the clip stays, so use `reject` only when it is most of the clip. Empty when every frame can stay.',
      'Sound and music are checked separately: never mention them. Don’t flag what you can’t see (“can’t rule out” is not a reason). One short line per reason, naming the frame and what is in it.',
      'Separately, `burnedIn`: text or logos the source laid over its picture near the top or bottom edge that name another brand: a sponsor’s or an advertiser’s logo or name, a ticker, a promo banner (not the show’s or channel’s own name, not a name tag of who is speaking, not things in the room like a can on the table or a logo on a shirt). For each: what it says, the edge it sits on, and `depth`, how far in from that edge its far side reaches as a fraction of the frame’s height (0.12 = within the last eighth). Generous rather than tight. Empty when there are none.',
    ]
      .filter(Boolean)
      .join('\n\n'),
    prompt: `${files.length} frames, in order, at ${times.map((t) => `${(t - range.start).toFixed(1)} s`).join(', ')} of the clip${shown ? ', each cut to the part of the picture the vertical clip shows' : ''}.`,
    images,
    schema: FRAMES_SCHEMA,
    model: 'opus',
  });
  const burnedIn = (out.burnedIn ?? [])
    .filter((b) => (b.edge === 'top' || b.edge === 'bottom') && b.depth > 0 && b.depth <= 0.35)
    .map((b) => ({ what: b.what.trim().slice(0, 80), edge: b.edge, depth: Math.round(Math.min(0.35, b.depth + 0.02) * 1000) / 1000 }))
    .slice(0, 4);
  // A frame left out takes its shot with it, and the shots between two left-out frames that weren't looked at too.
  const out_ = new Set((out.leaveOut ?? []).map((l) => l.frame - 1).filter((i) => i >= 0 && i < picked.length));
  const leftOut: LeftOut[] = [];
  for (const i of [...out_].sort((x, y) => x - y)) {
    const why = (out.leaveOut ?? []).find((l) => l.frame - 1 === i)?.why.trim().slice(0, 160) || 'can’t be shown';
    const prev = leftOut[leftOut.length - 1];
    const a = picked[i].a;
    if (prev && out_.has(i - 1)) prev.end = picked[i].b;
    else leftOut.push({ start: Math.round(a * 100) / 100, end: Math.round(picked[i].b * 100) / 100, why });
  }
  for (const l of leftOut) {
    // Every scanned shot inside a left-out stretch goes too (only every few were looked at).
    const within = inside.filter((sh) => sh.a >= l.start - 0.01 && sh.b <= l.end + 0.01);
    if (within.length) l.end = Math.max(l.end, ...within.map((sh) => sh.b));
  }
  return {
    verdict: ['ok', 'flag', 'reject'].includes(out.verdict) ? out.verdict : 'flag',
    reasons: (out.reasons ?? []).map((r) => r.trim()).filter(Boolean).slice(0, 5),
    ...(burnedIn.length && { burnedIn }),
    ...(leftOut.length && { leftOut }),
  };
}

/**
 * Clips framed so another brand's logo or name burned into the source's top or bottom never shows: zoomed in just
 * enough (at most 1.6×) and moved away from that edge. A whole picture can't be cropped: it's left (and noted).
 */
export function cropBurnedIn(clips: EditClip[], mediaId: string, burnedIn: BurnedIn[]): { clips: EditClip[]; left: boolean } {
  const top = Math.max(0, ...burnedIn.filter((b) => b.edge === 'top').map((b) => b.depth));
  const bottom = 1 - Math.max(0, ...burnedIn.filter((b) => b.edge === 'bottom').map((b) => b.depth));
  if (top === 0 && bottom === 1) return { clips, left: false };
  let left = false;
  const out = clips.map((c) => {
    if (c.mediaId !== mediaId) return c;
    const zoom = Math.max(c.zoom, 1 / (bottom - top));
    if (c.fit === 'whole' || zoom > 1.6) {
      left = true;
      return c;
    }
    // The crop's height is 1/zoom of the source's, centred on focusY (kept inside the picture): between the bands.
    const half = 0.5 / zoom;
    const focusY = Math.min(Math.max(c.focusY, top + half), bottom - half);
    return { ...c, zoom: Math.round(zoom * 1000) / 1000, focusY: Math.round(focusY * 1000) / 1000 };
  });
  return { clips: out, left };
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
    // A render and Demucs each fill the CPU and a few GB of memory: a render drawing its frames on this laptop goes
    // first, so the clips already made reach Review sooner (one on a home PC doesn't hold anything up).
    if (renderingHere()) throw new JobError('Waiting for a render to finish', { wait: true, delayMs: 15_000 });
    await waitForUsage('clips');
  } catch (err) {
    if (m.detail !== (err as Error).message) updateMoment(momentId, { detail: (err as Error).message });
    throw err;
  }
  const s = getSource(m.sourceId);
  const c = getCampaignRow(m.campaignId);
  // Made again (a retry, or a new start or end for a clip on the board): the same card keeps its comments, its versions
  // and its place on the board, and gets the new cut and a new edit version. A card deleted meanwhile: a new one.
  const keep = m.pieceId && db.select({ id: schema.pieces.id }).from(schema.pieces).where(eq(schema.pieces.id, m.pieceId)).get() ? m.pieceId : null;
  // Paused or ended meanwhile: it waits as found, to make later by hand (a clip on the board is cut again all the same).
  if (c.status !== 'active' && !keep) {
    updateMoment(momentId, { status: 'candidate', detail: 'Not made: the campaign isn’t active.' });
    return;
  }
  const file = sourceFile(s);
  if (!file) throw new JobError('The source video was deleted to save space: download it again (Source videos → Download again), then make the clip.', { retry: false });
  const info = await probe(file);
  if (!info.hasVideo || !info.hasAudio) throw new JobError('The source needs both picture and sound to make a clip.', { retry: false });
  const sourceSeconds = (info.durationMs ?? s.durationMs ?? 0) / 1000;
  if (keep) for (const r of db.select().from(schema.renders).where(and(eq(schema.renders.pieceId, keep), inArray(schema.renders.status, ['queued', 'running']))).all()) cancelRender(r.id);

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
    const cutStart = Math.max(0, m.start - HEAD);
    const cutEnd = Math.min(sourceSeconds || m.end + TAIL, m.end + TAIL);
    const length = cutEnd - cutStart;
    const video = join(dir, 'video.mp4');
    const original = join(dir, 'original.wav');
    await ffmpeg(['-ss', cutStart.toFixed(3), '-i', file, '-t', length.toFixed(3), '-map', '0:v:0', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', video]);
    await ffmpeg(['-ss', cutStart.toFixed(3), '-i', file, '-t', length.toFixed(3), '-map', '0:a:0', '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', original]);

    // 2. Voice and everything else apart (about 30 s for 45 s of clip).
    step('Separating the voice from any music');
    const voice = join(dir, 'voice.wav');
    const rest = join(dir, 'rest.wav');
    await runTool('separate', { audio: original, vocals: voice, rest }, {}, { timeoutMs: 20 * 60_000, track: `clip:${momentId}` });

    // 3. The voice's words, for the music check's pauses and the captions.
    step('Transcribing the voice');
    let transcript: Transcript;
    if (whisperInstalled()) {
      const wav = join(dir, 'voice16k.wav');
      const out = join(dir, 'transcript.json');
      await ffmpeg(['-i', voice, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
      await runTool('transcribe', { audio: wav, json: out }, { model: getSetting('whisperModel') ?? 'small' }, { timeoutMs: 20 * 60_000, track: `clip:${momentId}` });
      transcript = JSON.parse(await readFile(out, 'utf8')) as Transcript;
    } else {
      const whole = await readSourceTranscript(s);
      if (!whole) throw new JobError('There’s no transcript to caption it from.', { retry: false });
      transcript = sliceTranscript(whole, cutStart, cutEnd);
    }
    // Word times fitted to the voice itself, so every cut lands in a real pause (and fillers Whisper left out stay out).
    const envelope = await voiceEnvelope(voice);
    transcript = refineWords(transcript, envelope);
    const words = transcript.segments.flatMap((seg) => seg.words ?? []);

    step('Checking for music');
    const music = await musicCheck(voice, rest, words);
    if (music.verdict === 'left') {
      updateMoment(momentId, { status: 'dropped', music, detail: 'Background music couldn’t be removed cleanly, so the clip was dropped.' });
      return;
    }

    // Whole sentences: the start goes back to where its sentence begins, the end on to where it ends.
    const maxSeconds = Number(c.checklist.find((r) => r.check?.type === 'maxSeconds')?.check?.value) || 90;
    const rel = sentenceBounds(words, m.start - cutStart, m.end - cutStart, { maxLength: maxSeconds - 0.5 });
    if (rel.moved.length) {
      console.log(`[clip] ${momentId}: ${rel.moved.join('; ')}`);
      m = updateMoment(momentId, { start: Math.round((cutStart + rel.start) * 100) / 100, end: Math.round((cutStart + rel.end) * 100) / 100 });
    }

    // 4. The shots and who's talking in each, to frame on (the frame follows the speaker in wide shots).
    step('Finding the speaker');
    const speakers = await scanSpeakers(video, { track: `clip:${momentId}` }).catch((err: Error) => (console.warn(`[clip] faces for ${momentId}: ${err.message}`), null));

    // 5. What the clip shows, shot by shot.
    step('Checking what’s on screen');
    // Judged on what the clip shows: a tall crop of a wide picture leaves out the rest (the other half of a split
    // screen), so each frame is cut to its crop with a little room either side.
    const cutInfo = await probe(video);
    const wide = showsWhole({ width: cutInfo.width, height: cutInfo.height }, speakers, [c.category, c.type, c.brand, c.title, getWorkspace(m.workspaceId).niche].join(' '));
    const shownSpans = speakers && !wide ? focusSpans(speakers, '9:16') : [];
    const shown = (t: number) => {
      const sp = shownSpans.find((x) => t >= x.start && t < x.end);
      if (!sp || !cutInfo.width || !cutInfo.height) return null;
      const w = Math.min(1, ((9 / 16) * cutInfo.height) / cutInfo.width / sp.zoom) * 1.16;
      if (w >= 0.99) return null;
      const x0 = Math.min(Math.max(0, sp.x - w / 2), 1 - w);
      return { x0, x1: x0 + w };
    };
    const frames = await framesCheck(video, rel, speakers?.shots ?? null, dir, shown);
    if (frames.verdict === 'reject') {
      updateMoment(momentId, { status: 'dropped', frames, music, detail: `Dropped by the halal check: ${frames.reasons[0] ?? 'something on screen'}`.slice(0, 300) });
      return;
    }
    // Shots that can't be shown (a woman, an insert that isn't the show's own camera) are cut out of the clip; when
    // that leaves too little of it, the clip is dropped.
    const leftOut = (frames.leftOut ?? []).map((l) => ({ ...l, start: Math.max(rel.start, l.start), end: Math.min(rel.end, l.end) })).filter((l) => l.end > l.start);
    const kept = rel.end - rel.start - leftOut.reduce((n, l) => n + l.end - l.start, 0);
    if (leftOut.length && kept < Math.max(12, 0.6 * (rel.end - rel.start))) {
      updateMoment(momentId, { status: 'dropped', frames, music, detail: `Dropped: too much of it can’t be shown (${leftOut[0].why})`.slice(0, 300) });
      return;
    }

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
    const spoken = words.filter((w) => w.start >= rel.start - 0.3 && w.end <= rel.end + 0.3).map((w) => w.word).join('').trim();
    const notes = [
      `Clipped from “${s.title || 'a source video'}” at ${at}${link ? `\n${link}` : ''}`,
      `Campaign: ${c.title}`,
      `${MOMENT_KIND_LABELS[m.kind]} · standalone score ${m.score}/10${m.why ? `\n${m.why}` : ''}`,
      m.halalFlags.length && `Halal flags:\n${m.halalFlags.map((f) => `- ${f}`).join('\n')}`,
      frames.verdict === 'flag' && `On screen (check it):\n${frames.reasons.map((f) => `- ${f}`).join('\n')}`,
      leftOut.length && `Left out (it can’t be shown): ${leftOut.map((l) => `${l.why} (${l.start.toFixed(1)}–${l.end.toFixed(1)} s of the cut)`).join('; ')}. Check the story still reads across the gap.`,
      frames.burnedIn?.length && `Another brand on the source’s picture (${frames.burnedIn.map((b) => b.what).join(', ')}): framed out of the clip where the picture allows; check it doesn’t show.`,
      music.verdict === 'removed' && 'Background music was removed: only the voice is kept.',
      music.verdict === 'unverified' && 'There was sound behind the voice and it’s been removed, but the speech never pauses long enough to check: listen for any music left.',
      m.checkByEye.length && `Check by eye:\n${m.checkByEye.map((f) => `- ${f}`).join('\n')}`,
      rel.moved.length && `Cut on whole sentences: ${rel.moved.join('; ')}.`,
    ]
      .filter(Boolean)
      .join('\n\n');
    const tag = (c.brand || c.title).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 24);
    const content = { hook: m.hookCard.replace(/\*/g, '') || m.firstLine, script: spoken || m.firstLine, notes };
    let pieceId: string;
    if (keep) {
      pieceId = keep;
      const branchId = getPiece(keep).activeBranchId;
      if (branchId) saveVersion(branchId, { author: 'claude', message: `Made again: ${at}`, content: normalizeDraft({ ...getBranch(branchId).working, ...content }) });
    } else
      pieceId = createPiece(ws.id, {
        title: m.title || `Clip from ${s.title || 'a source'}`,
        // A clipping page's Making column; a page without one (a business's) gets it in Edit.
        stage: ['making', 'edit'].find((id) => ws.stages.some((st) => st.id === id)),
        tags: tag ? [tag] : [],
        content: { ...draft, ...content },
        author: 'claude',
        message: `Clip of ${at}`,
      }).pieceId;
    updateMoment(momentId, { pieceId, music, frames });
    const media = await adoptFile(ws.id, clip, `${(m.title || s.title || 'Clip').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80)}.mp4`, 'video/mp4', { pieceId, source: 'clip', transcript });
    db.update(schema.media)
      .set({ durationMs: clipInfo.durationMs, width: clipInfo.width, height: clipInfo.height })
      .where(eq(schema.media.id, media.id))
      .run();
    // Kept for "Follow the speaker" in the studio (the cut's times are the clip's).
    if (speakers) await writeFile(join(config.framesDir, `speakers-${media.id}.json`), JSON.stringify(speakers)).catch(() => {});

    // 7. The edit, in the page's look.
    const edit = createEdit(pieceId, 'claude');
    // Made again: the edit starts over from the new cut (the old versions stay, to go back to).
    const spec = keep ? startingSpec(pieceId, [media]) : normalizeEdit(edit.working);
    const first = words.find((w) => w.end > rel.start + 0.05);
    const last = [...words].reverse().find((w) => w.start < rel.end - 0.05);
    const clipLen = (clipInfo.durationMs ?? length * 1000) / 1000;
    const base = spec.clips.find((x) => x.mediaId === media.id) ?? spec.clips[0];
    if (!base) throw new Error('The edit didn’t pick up the cut.');
    base.mediaId = media.id;
    // A little air either side, never into the word before or after ("…larger family. Like").
    const wordBefore = first ? words[words.indexOf(first) - 1] : undefined;
    const wordAfter = last ? words[words.indexOf(last) + 1] : undefined;
    base.in = Math.max(0, (first?.start ?? rel.start) - 0.1, wordBefore ? wordBefore.end + 0.03 : 0);
    base.out = Math.min(clipLen, (last?.end ?? rel.end) + 0.35, wordAfter ? wordAfter.start - 0.03 : Infinity);
    // A game or a screen shows whole (cropping cuts its HUD and its text); people are framed on.
    const whole = showsWhole({ width: clipInfo.width, height: clipInfo.height }, speakers, [c.category, c.type, c.brand, c.title, ws.niche].join(' '));
    const spans = speakers && !whole ? focusSpans(speakers, spec.format) : [];
    // Where the frame sits most of the time, for anything outside the spans.
    const main = [...spans].sort((a, b) => b.end - b.start - (a.end - a.start))[0];
    if (main) {
      base.focusX = main.x;
      base.focusY = main.y;
    }
    if (whole) base.fit = 'whole';
    // Every filler out, only dead air cut: cuts the ear doesn't hear (each lands in a real pause, below).
    let clips = tightenClips([base], { [media.id]: speechRangesFromTranscript(transcript, true) }, TIGHTEN_PRESETS.clip, { [media.id]: fillerRangesFromTranscript(transcript) });
    if (!clips.length) clips = [base];
    clips = snapCuts(clips, media.id, envelope, words);
    // No frames of another shot at a cut (the source cuts just before or after it).
    if (speakers) clips = trimSlivers(clips, media.id, speakers.shots, words);
    clips = withoutRanges(clips, media.id, leftOut);
    clips = applyFocusSpans(clips, media.id, spans);
    if (whole) clips = fillHook(clips, speakers);
    const look = pickLook(ws.id);
    const total = editDuration({ ...spec, clips });
    const next = applyLook({ ...spec, clips }, look, m.hookCard, total);
    // A speaker who moves about in a shot is framed on all of it: no punch-in there, or he'd drift out of the frame.
    for (const x of next.clips) {
      const mid = (x.in + x.out) / 2;
      const span = spans.find((sp) => sp.steady && mid >= sp.start && mid < sp.end);
      if (span && x.mediaId === media.id) x.zoom = span.zoom;
    }
    if (whole) {
      // Nothing of a whole picture is cropped by a punch-in, and the words sit around it, never on it: the hook card
      // above, the captions below.
      next.clips = next.clips.map((x) => ({ ...x, zoom: 1 }));
      next.captions = { ...next.captions, position: Math.max(next.captions.position, 0.77) };
      next.overlays = next.overlays.map((o) => (o.type === 'text' && o.position === 'center' ? { ...o, position: 'top' } : o));
    }
    // Cuts that show as cuts: no twitch of a few frames, and a jump cut frames clearly tighter or wider.
    const steady = (x: { mediaId: string; in: number; out: number }) => x.mediaId === media.id && spans.some((sp) => sp.steady && (x.in + x.out) / 2 >= sp.start && (x.in + x.out) / 2 < sp.end);
    next.clips = smoothJumps(next.clips, { fixedZoom: steady });
    // Another brand's logo or name the source put over its picture never shows.
    const logos = frames.burnedIn?.length ? cropBurnedIn(next.clips, media.id, frames.burnedIn) : null;
    if (logos) next.clips = logos.clips;
    // A lecture names its speaker on screen for the whole clip.
    const speaker = isLectureCampaign(c.id) ? speakerTag(next, s, m.hookCard ? 2.5 : 0, total) : null;
    if (speaker) next.overlays.push(speaker);
    // A guest most viewers wouldn't know: an arrow names them as they first show.
    // From the second shot on, once the hook card is gone: the first seconds have one thing to read.
    const hookEnd = m.hookCard ? (look.hook.kind === 'slam' ? 2.2 : 2.5) : 0;
    const after = Math.max(2.5, hookEnd);
    const second = clipStarts(next).find((t) => t >= after - 0.01 && t <= 6) ?? after;
    const who = !whole && !speaker && speakers && m.speaker ? whoTag(next, media.id, speakers, m.speaker, clipInfo, 0.65, second) : null;
    if (who) next.overlays.push(who);
    // Once in the clip, who he's talking to: the source's own shot of them listening, over his voice (when it has one).
    step('Looking for a shot of who’s listening');
    const cutaway = whole
      ? null
      : await addListenerCutaway({ spec: next, sourceFile: file, at: { start: m.start, end: m.end }, transcript: await readSourceTranscript(s), workspaceId: ws.id, pieceId, hookEnd, dir: join(dir, 'cutaway') }).catch(
          (err: Error) => (console.warn(`[clip] cutaway for ${momentId}: ${err.message}`), null),
        );
    saveEditVersion(edit.id, {
      author: 'claude',
      message: `${keep ? 'Made again' : 'Clip'} of ${at}: tightened, hook card, captions${who ? `, ${m.speaker?.name} named` : ''}${cutaway ? ', a cutaway to who’s listening' : ''}${lookTag(look)}`,
      spec: cutaway?.spec ?? next,
    });

    // 8. Checked against the lessons from my comments (a broken one: Claude fixes it first), then rendered; finishing
    // moves it to Review.
    queueRender(edit.id, 'claude', { check: true });
    updateMoment(momentId, { status: 'made', detail: '' });
  } catch (err) {
    if (!(err instanceof Skipped)) throw err;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

class Skipped extends Error {}

const GAME = /\b(gam(e|es|ing|eplay)|roblox|minecraft|fortnite|clash|brawl|esports?|twitch|speedrun|lets ?play)\b/i;

/**
 * Whether a clip shows its whole picture rather than a crop: a wide video that's a game (by the campaign or the page),
 * or one with a face on screen for under a third of it (a screen recording, gameplay, slides).
 */
export function showsWhole(size: { width?: number | null; height?: number | null }, speakers: SpeakerScan | null, about: string) {
  if (!size.width || !size.height || size.width / size.height < 1.2) return false;
  if (GAME.test(about)) return true;
  if (!speakers?.shots.length) return false;
  const total = speakers.shots.reduce((n, sh) => n + sh.end - sh.start, 0);
  const withFace = speakers.shots.filter((sh) => sh.tracks.some((t) => t.n >= Math.max(2, sh.samples * 0.3))).reduce((n, sh) => n + sh.end - sh.start, 0);
  return total > 0 && withFace / total < 0.33;
}

export function onMakeFailed({ momentId }: { momentId: string }, message: string) {
  if (!momentExists(momentId)) return;
  updateMoment(momentId, { status: 'failed', detail: message.slice(0, 300) });
  emit({ type: 'job', jobType: 'clip.make', status: 'error', message });
}
