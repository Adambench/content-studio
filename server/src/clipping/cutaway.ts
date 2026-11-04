// A cutaway to who the speaker is talking to: 1–2 s of the source's own shot of the listener (the host nodding along),
// over the speaker's voice, once in the clip. Only when the source shows them. The whole source's shots are scanned
// once (kept beside it); the ones on another camera than the speaker's, best inside a long answer (a show cuts to the
// host mostly while he asks, and those shots are no use: his lips would move to someone else's words), go to Opus with
// two frames and the words heard each, and it says which show the listener only listening, and when. The cutaway
// covers a jump cut when there is one (it hides the jump), never the hook's first seconds, the end or another overlay.
import { execFile as execFileCb } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import { clipStarts, editDuration, normalizeEdit, type BrollOverlay, type EditSpec } from '../../../shared/edit';
import type { Transcript } from '../../../shared/types';
import { askStructured } from '../claude/oneshot';
import { playbook } from '../claude/plugin';
import { getSource } from '../campaigns/campaigns';
import { readSourceTranscript, sourceFile } from '../campaigns/sources';
import { config } from '../config';
import { db, newId, schema } from '../db';
import { requireBinary } from '../lib/bin';
import { extractFrames, probe } from '../lib/ffmpeg';
import { adoptFile, mediaPath } from '../services/media';
import { getPiece } from '../services/pieces';
import { pictureChanges } from '../studio/exact-cuts';
import { scanSpeakers } from '../studio/reframe';
import { findEditForPiece, saveEditVersion } from '../studio/edits';
import { getMoment } from './moments';

const execFile = promisify(execFileCb);

const MIN_SHOT = 1.8;
const MAX_SHOTS = 16;
/** Thumbnails (32×18, grey) this close on average (0–255) are the same camera. */
const SAME_CAMERA = 14;
const THUMB = 32 * 18;
const FPS = 6;

type Shot = { start: number; end: number; thumb: Float32Array };

/**
 * The source's shots between two times (its own seconds), each with a tiny average picture of it to tell its camera
 * by. One pass over the reference frames only (B-frames skipped: 7× faster, the same cuts): a couple of minutes for a
 * two-hour 1080p episode.
 */
async function scanShots(file: string, from: number, to: number): Promise<Shot[]> {
  const { stdout, stderr } = await execFile(
    requireBinary('ffmpeg'),
    [
      // The window as input options, so every output stops at its end (an output's -t only counts what it's sent).
      ...['-hide_banner', '-nostdin', '-skip_frame', 'bidir', '-ss', from.toFixed(2), '-t', (to - from).toFixed(2), '-i', file, '-an', '-sn'],
      ...['-filter_complex', `[0:v]fps=${FPS},scale=192:-2,split[a][b];[a]select='gt(scene,0.2)',showinfo[cuts];[b]scale=32:18,format=gray[thumbs]`],
      ...['-map', '[cuts]', '-f', 'null', '-', '-map', '[thumbs]', '-f', 'rawvideo', 'pipe:1'],
    ],
    { encoding: 'buffer', maxBuffer: 512 * 1024 * 1024, timeout: 45 * 60_000 },
  );
  const cuts = [...stderr.toString().matchAll(/pts_time:([\d.]+)/g)].map((x) => from + Number(x[1]));
  const frames = Math.floor(stdout.length / THUMB);
  const edges = [from, ...cuts, to];
  return edges.slice(1).map((end, i) => {
    const start = edges[i];
    const thumb = new Float32Array(THUMB);
    let n = 0;
    for (let f = Math.ceil((start - from + 0.2) * FPS); f < Math.min(frames, (end - from - 0.2) * FPS); f++, n++) for (let k = 0; k < THUMB; k++) thumb[k] += stdout[f * THUMB + k];
    if (n) for (let k = 0; k < THUMB; k++) thumb[k] /= n;
    return { start, end, thumb };
  });
}

/** Every shot of a source, scanned once and kept beside it (`<source>.shots.json`). */
async function sourceShots(file: string): Promise<Shot[]> {
  const cache = file.replace(/\.[^./]+$/, '') + '.shots.json';
  try {
    const kept = JSON.parse(await readFile(cache, 'utf8')) as { v: number; shots: { start: number; end: number; thumb: number[] }[] };
    if (kept.v === 1) return kept.shots.map((s) => ({ start: s.start, end: s.end, thumb: Float32Array.from(s.thumb) }));
  } catch {}
  const length = ((await probe(file)).durationMs ?? 0) / 1000;
  if (!length) return [];
  const shots = await scanShots(file, 0, length);
  const round = (n: number) => Math.round(n * 100) / 100;
  await writeFile(cache, JSON.stringify({ v: 1, shots: shots.map((s) => ({ start: round(s.start), end: round(s.end), thumb: Array.from(s.thumb, Math.round) })) })).catch(() => {});
  return shots;
}

/**
 * When each person's turn to talk starts, from the ">>" a platform's captions put where another person starts
 * (none in Whisper's words: then nothing is known).
 */
function turnStarts(t: Transcript | null): number[] {
  return (t?.segments ?? []).flatMap((s) => (s.words?.length ? s.words : [{ word: s.text, start: s.start, end: s.end }])).filter((w) => w.word.includes('>>')).map((w) => w.start);
}

const apart = (a: Float32Array, b: Float32Array) => {
  let d = 0;
  for (let k = 0; k < THUMB; k++) d += Math.abs(a[k] - b[k]);
  return d / THUMB;
};

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['shots'],
  properties: {
    shots: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['shot', 'shows', 'quietFrom', 'quietTo', 'listenerFrom', 'listenerTo', 'clean'],
        properties: {
          shot: { type: 'integer' },
          shows: { type: 'string', enum: ['listener', 'speaker', 'both', 'other'] },
          quietFrom: { type: 'number' },
          listenerFrom: { type: 'number' },
          listenerTo: { type: 'number' },
          quietTo: { type: 'number' },
          clean: { type: 'boolean' },
        },
      },
    },
  },
};
type Verdict = { shots: { shot: number; shows: 'listener' | 'speaker' | 'both' | 'other'; quietFrom: number; quietTo: number; listenerFrom: number; listenerTo: number; clean: boolean }[] };

/** What's heard during a shot, with times from its start ("+2.4 s So if someone's…"). */
const heardIn = (t: Transcript | null, a: number, b: number) => {
  const words = (t?.segments ?? []).flatMap((s) => (s.words?.length ? s.words : [{ word: ` ${s.text}`, start: s.start, end: s.end }])).filter((w) => w.start < b && w.end > a);
  let out = '';
  let mark = -Infinity;
  for (const w of words) {
    if (w.start - mark >= 1.5) {
      out += ` [+${Math.max(0, w.start - a).toFixed(1)} s]`;
      mark = w.start;
    }
    out += w.word;
  }
  return out.trim().slice(0, 500);
};

/**
 * The listener's shots best for the clip (`at`, the source's seconds), as the part of each to show: up to `seconds`
 * long, where they listen. None when the source never shows them, or the clip already does.
 */
export async function findListenerShot(opts: { file: string; at: { start: number; end: number }; speakerFrame: string; transcript: Transcript | null; seconds: number; dir: string }) {
  const all = await sourceShots(opts.file);
  const dist = (s: Pick<Shot, 'start' | 'end'>) => (s.end <= opts.at.start ? opts.at.start - s.end : s.start >= opts.at.end ? s.start - opts.at.end : 0);
  // The speaker's camera: the clip's longest shot. Every shot on it is left out (the listener is on another camera).
  const overlap = (s: Shot) => Math.min(s.end, opts.at.end) - Math.max(s.start, opts.at.start);
  const own = all.filter((s) => overlap(s) > 0).sort((a, b) => overlap(b) - overlap(a))[0];
  // Inside one person's long turn (over 15 s with nobody else starting: an answer, not the host's question), no other
  // voice starting during the shot: the listener is most likely only listening there.
  const turns = turnStarts(opts.transcript);
  const turnOf = (s: Shot) => {
    const mid = (s.start + s.end) / 2;
    return { from: turns.filter((t) => t <= mid).pop() ?? 0, to: turns.find((t) => t > mid) ?? Infinity };
  };
  const inAnswer = (s: Shot) => {
    if (!turns.length || turns.some((t) => t > s.start - 0.3 && t < s.end + 0.3)) return false;
    const { from, to } = turnOf(s);
    return to - from >= 15;
  };
  const others = all.filter((s) => s.end - s.start >= MIN_SHOT && (!own || apart(s.thumb, own.thumb) >= SAME_CAMERA));
  // The listener's cameras: where the show cuts while someone else asks (a short turn, under 15 s), grouped by camera.
  // A show's own inserts (footage, pictures) rarely repeat; a host's camera does, question after question.
  const groups: { thumb: Float32Array; n: number }[] = [];
  for (const s of others.filter((x) => turns.length && !inAnswer(x) && turnOf(x).to - turnOf(x).from < 15)) {
    const g = groups.find((x) => apart(x.thumb, s.thumb) < SAME_CAMERA);
    if (g) g.n++;
    else groups.push({ thumb: s.thumb, n: 1 });
  }
  const cameras = groups.filter((g) => g.n >= 3);
  const onListenerCamera = (s: Shot) => cameras.some((g) => apart(g.thumb, s.thumb) < SAME_CAMERA);
  const rank = (s: Shot) => (inAnswer(s) ? 2 : 0) + (onListenerCamera(s) ? 1 : 0);
  const shots = others
    .sort((a, b) => rank(b) - rank(a) || dist(a) - dist(b))
    .slice(0, MAX_SHOTS)
    .sort((a, b) => a.start - b.start);
  console.log(`[cutaway] ${all.length} shots, ${cameras.length} listener cameras, ${shots.length} sent (${shots.filter((x) => rank(x) === 3).length} on them inside an answer)`);
  if (!shots.length) return [];

  const times = shots.flatMap((s) => [s.start + (s.end - s.start) * 0.3, s.start + (s.end - s.start) * 0.7]);
  const files = await extractFrames(opts.file, times, (i) => join(opts.dir, `shot${i}.jpg`), 384);
  const images = [opts.speakerFrame, ...files];
  const out = await askStructured<Verdict>({
    task: 'clips',
    system: [
      playbook('halal'),
      'You look at shots of a podcast or interview around a short clip cut from it, to find a cutaway: a second or two of the person the speaker is talking to, listening, shown over the speaker’s voice.',
      'The first frame is from the clip: the person talking in it is the speaker. Then two frames from each shot of the same video near the clip (at 30 % and 70 % of it), in order, with what is heard during that shot (times from its start; “>>” marks where another person starts talking).',
      'For each shot: `shows` is `listener` when it shows only the person or people the speaker is talking to (the host, the interviewer, the other guest), on the show’s own cameras; the speaker may show only as a shoulder or the back of his head. `speaker` when it shows the speaker, `both` for a wide shot of both sides, `other` for anything else: footage or a picture the show put in, a screen, a logo, a split screen, a black or blurred frame.',
      '`quietFrom`–`quietTo` (seconds from the shot’s start): for a `listener` or `both` shot, the stretch where the person or people the speaker talks to only listen: the words heard then are the speaker’s (his point going on), not a listener’s own question, comment or laugh, and their mouths are closed or still in the frames there. At least 1.5 s, or both 0 when there is none (a listener talks all through it, or you can’t tell). Both 0 for every other shot.',
      '`listenerFrom`–`listenerTo`: for a `listener` or `both` shot, the part of the frame’s width (0 = left edge, 1 = right edge) the listeners take up, heads and shoulders, without the speaker (a `both` shot is cut down to it, so the speaker isn’t seen talking to other words). 0 and 1 when they fill it; both 0 for other shots.',
      '`clean`: nothing in the frames breaks the halal rules above (a drink of alcohol, smoking, immodest dress, a haram brand).',
    ].join('\n\n'),
    prompt: [
      `Frame 1: the clip (the speaker).`,
      ...shots.map(
        (s, i) =>
          `Shot ${i + 1}: frames ${i * 2 + 2} and ${i * 2 + 3}, ${(s.end - s.start).toFixed(1)} s long, ${s.end <= opts.at.start ? `${Math.round(opts.at.start - s.end)} s before the clip` : s.start >= opts.at.end ? `${Math.round(s.start - opts.at.end)} s after the clip` : 'during the clip'}. Heard: “${heardIn(opts.transcript, s.start, s.end) || 'nothing'}”`,
      ),
    ].join('\n'),
    images: await Promise.all(images.map(async (f) => ({ data: (await readFile(f)).toString('base64'), mediaType: 'image/jpeg' as const }))),
    schema: SCHEMA,
    model: 'opus',
  });
  console.log(`[cutaway] ${shots.map((sh, i) => `${i + 1}:${sh.start.toFixed(1)}-${sh.end.toFixed(1)}`).join(' ')} → ${(out.shots ?? []).map((v) => `${v.shot}:${v.shows}${v.quietTo > v.quietFrom ? ` quiet ${v.quietFrom}-${v.quietTo} at ${v.listenerFrom}-${v.listenerTo}` : ''}${v.clean ? '' : ' unclean'}`).join(', ')}`);
  // The part of each shot where they only listen, a little in from the shot's edges. A wide shot only with where the
  // listeners sit, to frame on them.
  const good = (out.shots ?? []).flatMap((v) => {
    const s = shots[v.shot - 1];
    if (!s || (v.shows !== 'listener' && v.shows !== 'both') || !v.clean || !(v.quietTo > v.quietFrom)) return [];
    const x0 = Math.max(0, Math.min(1, v.listenerFrom));
    const x1 = Math.max(x0, Math.min(1, v.listenerTo));
    if (v.shows === 'both' && !(x1 > x0)) return [];
    const a = Math.max(s.start + 0.25, s.start + v.quietFrom);
    const b = Math.min(s.end - 0.25, s.start + v.quietTo);
    return b - a >= 1.1 ? [{ start: a, end: b, shot: s, wide: v.shows === 'both', side: x1 > x0 ? { x0, x1 } : null }] : [];
  });
  // The clip already cuts to them: nothing to add.
  if (good.some((g) => dist(g.shot) === 0)) return [];
  // A close shot of the listener first, then the nearest; the best few, each checked again on what the clip shows.
  return good
    .sort((x, y) => Number(x.wide) - Number(y.wide) || dist(x.shot) - dist(y.shot))
    .slice(0, 3)
    .map((g) => {
      const seconds = Math.min(opts.seconds, g.end - g.start);
      return { start: g.start + (g.end - g.start - seconds) / 2, seconds, side: g.side };
    });
}

/**
 * When in the edit the cutaway goes: over a jump cut near the middle (it hides the jump), else near the middle; never
 * in the first seconds (the hook), the last ones, or over another overlay.
 */
export function cutawayTime(spec: EditSpec, seconds: number, hookEnd: number): number | null {
  const total = editDuration(spec);
  const earliest = Math.max(3, hookEnd + 0.5);
  const latest = total - 2.5 - seconds;
  if (latest < earliest) return null;
  const free = (t: number) => t >= earliest && t <= latest && !spec.overlays.some((o) => o.start < t + seconds + 0.3 && o.end > t - 0.3);
  const starts = clipStarts(spec);
  const jumps = starts.filter((t, i) => i > 0 && spec.clips[i - 1].mediaId === spec.clips[i].mediaId).map((t) => t - Math.min(0.6, seconds / 2));
  const mid = total * 0.45;
  const near = (xs: number[]) => xs.filter(free).sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))[0];
  return near(jumps) ?? near([0.45, 0.55, 0.35, 0.65, 0.3, 0.7].map((f) => total * f)) ?? null;
}

/**
 * Where to look in the listener's shot: between the faces when they fit in a tall frame together, else the biggest.
 * `side`: the part of the width the listeners take up (a wide shot): only faces there count, and the frame stays in it.
 */
async function focusOn(file: string, width: number, height: number, side: { x0: number; x1: number } | null) {
  const scan = await scanSpeakers(file).catch(() => null);
  const tracks = (scan?.shots ?? []).flatMap((s) => s.tracks.filter((t) => t.n >= Math.max(2, s.samples * 0.3) && (!side || (t.x >= side.x0 - 0.03 && t.x <= side.x1 + 0.03))));
  if (!tracks.length) return { x: side ? (side.x0 + side.x1) / 2 : 0.5, y: 0.45 };
  const view = Math.min(1, ((9 / 16) * height) / width);
  const xs = tracks.map((t) => t.x);
  if (Math.max(...xs) - Math.min(...xs) <= view * 0.8) return { x: (Math.max(...xs) + Math.min(...xs)) / 2, y: tracks.reduce((n, t) => n + t.y, 0) / tracks.length };
  const big = [...tracks].sort((a, b) => b.h - a.h)[0];
  return { x: big.x, y: big.y };
}

/**
 * Put a cutaway to the listener in a clip's edit: found in the source around `at`, cut from it as the card's own file,
 * and placed as full-screen b-roll (the speaker's voice goes on under it). Returns the new spec, or null when the
 * source has no such shot or there's no room for one.
 */
export async function addListenerCutaway(opts: { spec: EditSpec; sourceFile: string; at: { start: number; end: number }; transcript: Transcript | null; workspaceId: string; pieceId: string; hookEnd: number; dir: string; seconds?: number }): Promise<{ spec: EditSpec; from: number } | null> {
  const seconds = opts.seconds ?? 1.6;
  if (cutawayTime(opts.spec, seconds, opts.hookEnd) === null) return null;
  await mkdir(opts.dir, { recursive: true });
  // The speaker, as the clip shows him: a frame from the middle of its main footage.
  const main = opts.spec.clips[Math.floor(opts.spec.clips.length / 2)];
  const mainRow = main && db.select().from(schema.media).where(eq(schema.media.id, main.mediaId)).get();
  if (!mainRow) return null;
  const [speakerFrame] = await extractFrames(mediaPath(mainRow), [(main.in + main.out) / 2], () => join(opts.dir, 'speaker.jpg'), 384);
  const candidates = await findListenerShot({ file: opts.sourceFile, at: opts.at, speakerFrame, transcript: opts.transcript, seconds, dir: opts.dir });
  for (const [k, found] of candidates.entries()) {
    const t = cutawayTime(opts.spec, found.seconds, opts.hookEnd);
    if (t === null) return null;
    const piece = join(opts.dir, `listener${k}.mp4`);
    await execFile(
      requireBinary('ffmpeg'),
      ['-y', '-v', 'error', '-ss', found.start.toFixed(3), '-i', opts.sourceFile, '-t', found.seconds.toFixed(3), '-map', '0:v:0', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', piece],
      { timeout: 5 * 60_000 },
    );
    // The shots above are read a few times a second: the piece is checked frame by frame, and only its longest part on
    // one shot shows (never a frame of the shot before or after it, a flash).
    const changes = (await pictureChanges(piece).catch(() => ({ times: [] as number[] }))).times.filter((x) => x > 0.02 && x < found.seconds - 0.02);
    const edges = [0, ...changes, found.seconds];
    let [from, to] = [0, 0];
    for (let i = 1; i < edges.length; i++) if (edges[i] - edges[i - 1] > to - from) [from, to] = [edges[i - 1], edges[i]];
    if (to - from < 1.1) continue;
    const at = changes.length ? cutawayTime(opts.spec, to - from, opts.hookEnd) : t;
    if (at === null) continue;
    const info = await probe(piece);
    const [W, H] = [info.width ?? 1920, info.height ?? 1080];
    const focus = await focusOn(piece, W, H, found.side);
    // Checked on exactly what the clip will show: the tall crop of it, never the speaker in it, nobody talking.
    const w = Math.min(1, ((9 / 16) * H) / W);
    const x0 = Math.min(Math.max(0, focus.x - w / 2), 1 - w);
    const crops = await extractFrames(piece, [from + (to - from) * 0.25, from + (to - from) * 0.75], (i) => join(opts.dir, `crop${k}-${i}.jpg`), 384, [{ x0, x1: x0 + w }, { x0, x1: x0 + w }]);
    const seen = await askStructured<CropCheck>({
      task: 'clips',
      system: CROP_CHECK,
      prompt: 'Frame 1: the speaker, in the clip. Frames 2 and 3: the cutaway, as it will show full screen.',
      images: await Promise.all([speakerFrame, ...crops].map(async (f) => ({ data: (await readFile(f)).toString('base64'), mediaType: 'image/jpeg' as const }))),
      schema: CROP_SCHEMA,
      model: 'opus',
    });
    console.log(`[cutaway] ${found.start.toFixed(1)} s at x ${focus.x.toFixed(2)}: ${seen.listener ? 'listener' : 'no listener'}${seen.speaker ? ', speaker in it' : ''}${seen.talking ? ', talking' : ''}`);
    if (!seen.listener || seen.speaker || seen.talking) continue;
    const media = await adoptFile(opts.workspaceId, piece, 'Listening.mp4', 'video/mp4', { pieceId: opts.pieceId, source: 'clip' });
    db.update(schema.media).set({ durationMs: info.durationMs, width: info.width, height: info.height }).where(eq(schema.media.id, media.id)).run();
    const round = (n: number) => Math.round(n * 1000) / 1000;
    const overlay: BrollOverlay = { id: newId().slice(0, 8), type: 'broll', mediaId: media.id, in: round(from), layout: 'full', focusX: round(focus.x), focusY: round(focus.y), start: round(at), end: round(at + to - from) };
    return { spec: normalizeEdit({ ...opts.spec, overlays: [...opts.spec.overlays, overlay] }), from: found.start + from };
  }
  return null;
}

type CropCheck = { speaker: boolean; listener: boolean; talking: boolean };
const CROP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['speaker', 'listener', 'talking'],
  properties: { speaker: { type: 'boolean' }, listener: { type: 'boolean' }, talking: { type: 'boolean' } },
};
const CROP_CHECK = [
  'Frame 1 is from a clip of a podcast or interview: the person talking in it is the speaker. Frames 2 and 3 are a cutaway from the same show, cut to a tall frame, to be shown full screen for under 2 s over the speaker’s voice: it should show who he is talking to, listening.',
  '`speaker`: the speaker from frame 1 is visible in frames 2 or 3 (his face, or most of him; only a shoulder or arm at the edge doesn’t count). He would be seen talking to other words, so this must be false.',
  '`listener`: frames 2 and 3 show the person or people he is talking to (the host, the interviewer, another guest) clearly, faces in the frame, not cut in half.',
  '`talking`: someone visible seems to be talking (mouth open mid-word, the same in both frames is fine when it’s closed) rather than listening.',
].join('\n\n');

/** A cutaway to the listener for a clip already on the board (its card's latest edit), saved as a new version. */
export async function cutawayForPiece(pieceId: string) {
  const moment = db.select().from(schema.moments).where(eq(schema.moments.pieceId, pieceId)).get();
  if (!moment) throw new Error('Not a clip.');
  const m = getMoment(moment.id);
  const s = getSource(m.sourceId);
  const file = sourceFile(s);
  if (!file) throw new Error('The source video was deleted: download it again first.');
  const edit = findEditForPiece(pieceId);
  if (!edit) throw new Error('The clip has no edit.');
  const spec = normalizeEdit(edit.working);
  if (spec.overlays.some((o) => o.type === 'broll')) return null;
  const hook = spec.overlays.find((o) => o.type === 'text' && o.hidesCaptions);
  const dir = join(config.tmpDir, 'cutaway', pieceId);
  try {
    const out = await addListenerCutaway({ spec, sourceFile: file, at: { start: m.start, end: m.end }, transcript: await readSourceTranscript(s), workspaceId: getPiece(pieceId).workspaceId, pieceId, hookEnd: hook?.end ?? 0, dir });
    if (!out) return null;
    const { version } = saveEditVersion(edit.id, { author: 'claude', message: `Cutaway to who he’s talking to (from ${Math.floor(out.from / 60)}:${String(Math.floor(out.from % 60)).padStart(2, '0')} of the source)`, spec: out.spec });
    return { editId: edit.id, version: version.number };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
