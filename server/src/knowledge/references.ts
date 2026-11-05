// References: videos that moved me, pasted on the Knowledge page as inspiration. Each is downloaded and measured
// (measure.ts, no model), then read by one model call (task `lessons`): how it's built, why it works, and its
// ingredients for me to mark *want* or *not for me*. A page's style is written from those marks (job
// `inspiration.build`, my click) and goes into every prompt that makes something for the page (`inspirationText`).
// Jobs: `reference.measure` (yt-dlp, FFmpeg, Whisper, Demucs) then `reference.lessons` (the read; its old name).
import { execFile as execFileCb } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { and, desc, eq } from 'drizzle-orm';
import { editDuration, normalizeEdit, timelineWords } from '../../../shared/edit';
import { screenEvents } from '../../../shared/quality';
import { ASPECT_LABELS, INGREDIENT_ASPECTS, type Ingredient, type IngredientMark, type OwnMeasures, type PageStyle, type ReferenceMeasures, type ReferenceRead, type ReferenceVideo } from '../../../shared/references';
import { KIND_INFO, type Transcript } from '../../../shared/types';
import { askStructured, type PromptImage } from '../claude/oneshot';
import { resolveModel } from '../claude/options';
import { playbook } from '../claude/plugin';
import { waitForUsage } from '../claude/usage';
import { youtubeCaptions } from '../campaigns/sources';
import { runTool } from '../compute/run';
import { config } from '../config';
import { db, newId, now, schema } from '../db';
import { requireBinary } from '../lib/bin';
import { emit } from '../lib/events';
import { extractFrames, probe } from '../lib/ffmpeg';
import { badRequest, notFound } from '../lib/http';
import { enqueue, JobError } from '../jobs/queue';
import { downloadPost, postOf, whisper } from './fetch';
import { clipToolsInstalled } from '../services/cliptools';
import { getWorkspace } from '../services/pieces';
import { specMedia, specTranscripts } from '../studio/edits';
import { frameDiffs, hardCuts, measure, soundLevels } from './measure';

const execFile = promisify(execFileCb);

type Row = typeof schema.referenceVideos.$inferSelect;

/** Longer videos aren't references for shorts (and Demucs on a laptop is slow). */
const MAX_SECONDS = 4 * 60;
/** Frames on the contact sheet. */
const SHEET = { cols: 4, rows: 3 };

const emitReferences = (id?: string) => emit({ type: 'changed', entity: 'references', id });
const dirOf = (id: string) => join(config.referencesDir, id);

/** An old read (from before references were inspiration) shows as unread until it's read again. */
const readOf = (r: Row): ReferenceRead | null => (r.read && typeof (r.read as Partial<ReferenceRead>).why === 'string' ? { ...r.read, shape: r.read.shape ?? [], cautions: r.read.cautions ?? [] } : null);

function toReference(r: Row): ReferenceVideo {
  return {
    id: r.id,
    workspaceId: r.workspaceId,
    url: r.url,
    platform: r.platform,
    title: r.title,
    channel: r.channel,
    views: r.views,
    postedAt: r.postedAt,
    status: r.status,
    step: r.step,
    error: r.error,
    measures: r.measures,
    read: readOf(r),
    lines: r.lines,
    hasFrames: r.hasFrames,
    ingredients: readOf(r) ? r.ingredients : [],
    note: r.note,
    createdAt: r.createdAt,
    measuredAt: r.measuredAt,
  };
}

function getRow(id: string) {
  const r = db.select().from(schema.referenceVideos).where(eq(schema.referenceVideos.id, id)).get();
  if (!r) throw notFound('Reference not found');
  return r;
}

function update(id: string, values: Partial<typeof schema.referenceVideos.$inferInsert>) {
  db.update(schema.referenceVideos).set(values).where(eq(schema.referenceVideos.id, id)).run();
  emitReferences(id);
}

export const listReferences = () => db.select().from(schema.referenceVideos).orderBy(desc(schema.referenceVideos.createdAt)).all().map(toReference);
export const getReference = (id: string) => toReference(getRow(id));

/** Measure a pasted link (my click). One already measured is returned as it is; one that failed is tried again. */
export function queueReference(input: { url: string; workspaceId?: string | null }) {
  const post = postOf(input.url);
  if (!post) throw badRequest('Paste a link to a YouTube Short or video, a TikTok or an Instagram reel.');
  if (input.workspaceId) getWorkspace(input.workspaceId);
  const existing = db
    .select()
    .from(schema.referenceVideos)
    .where(and(eq(schema.referenceVideos.platform, post.platform), eq(schema.referenceVideos.externalId, post.id)))
    .get();
  if (existing) {
    if (existing.status === 'error') retryReference(existing.id);
    return getReference(existing.id);
  }
  const id = newId();
  db.insert(schema.referenceVideos)
    .values({ id, workspaceId: input.workspaceId ?? null, platform: post.platform, externalId: post.id, url: post.url, step: 'Waiting to start' })
    .run();
  enqueue('reference.measure', { referenceId: id }, { maxAttempts: 2 });
  emitReferences(id);
  return getReference(id);
}

/** After an error: measure it again. What I like about it is mine to write (no Claude read since Phase 14). */
export function retryReference(id: string) {
  const r = getRow(id);
  if (r.status !== 'error') return getReference(id);
  update(id, { status: 'queued', step: 'Waiting to start', error: null });
  enqueue('reference.measure', { referenceId: id }, { maxAttempts: 2 });
  return getReference(id);
}

/** Gone, with its frames and the suggestions still waiting; lessons I approved stay as rules. */
export async function deleteReference(id: string) {
  getRow(id);
  db.delete(schema.knowledge)
    .where(and(eq(schema.knowledge.referenceId, id), eq(schema.knowledge.status, 'proposed')))
    .run();
  const r = getRow(id);
  db.delete(schema.referenceVideos).where(eq(schema.referenceVideos.id, id)).run();
  await rm(dirOf(id), { recursive: true, force: true });
  for (const w of stylePages(r.workspaceId)) emitStyle(w);
  emit({ type: 'changed', entity: 'knowledge' });
  emitReferences(id);
}

/** A reference's picture: `first` (its opening frame) or `sheet` (12 frames across it). */
export function referenceFrame(id: string, name: 'first' | 'sheet') {
  const file = join(dirOf(id), `${name}.jpg`);
  if (!existsSync(file)) throw notFound('No picture');
  return file;
}

/** The first frame and a contact sheet of 12 frames, evenly through it (the middle of each twelfth). */
async function saveFrames(file: string, seconds: number, dir: string, work: string) {
  const n = SHEET.cols * SHEET.rows;
  const times = Array.from({ length: n }, (_, i) => ((i + 0.5) * seconds) / n);
  const tiles = await extractFrames(file, times, (i) => join(work, `s${String(i).padStart(2, '0')}.jpg`), 320);
  const [first] = await extractFrames(file, [Math.min(0.05, seconds / 2)], () => join(work, 'first.jpg'), 540);
  await mkdir(dir, { recursive: true });
  await execFile(requireBinary('ffmpeg'), [
    '-y',
    '-v',
    'error',
    '-start_number',
    '0',
    '-i',
    join(work, 's%02d.jpg'),
    '-vf',
    `scale=240:-2,tile=${SHEET.cols}x${SHEET.rows}:padding=4:color=black`,
    '-frames:v',
    '1',
    '-q:v',
    '4',
    join(dir, 'sheet.jpg'),
  ]);
  await rename(first, join(dir, 'first.jpg'));
  return { times, tiles };
}

/**
 * What's said: Whisper (its word times are the ones measured against), else YouTube's captions. The pages are in
 * English (with Arabic in places): a language Whisper guessed wrong from a short opening is heard again as English.
 */
async function transcribe(file: string, url: string, platform: Row['platform'], work: string): Promise<Transcript | null> {
  let t = await whisper(file, work).catch(() => null);
  if (t && !['en', 'ar'].includes(t.language)) t = (await whisper(file, work, 'en').catch(() => null)) ?? t;
  if (t) return t;
  return platform === 'youtube' ? youtubeCaptions(url).catch(() => null) : null;
}

/** The `reference.measure` job (then the read, unless `measureOnly`). */
export async function measureReference({ referenceId, measureOnly }: { referenceId: string; measureOnly?: boolean }) {
  const r = getRow(referenceId);
  if (r.measures) return;
  const step = (text: string) => update(referenceId, { status: 'measuring', step: text });
  const work = join(config.tmpDir, `reference-${referenceId}`);
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  try {
    step('Downloading');
    const { file, info } = await downloadPost(r.url, work);
    update(referenceId, {
      title: (info.title && !/^Video by /.test(info.title) ? info.title : info.description || r.title).replace(/\s+/g, ' ').trim().slice(0, 500),
      channel: info.channel || info.uploader || r.channel,
      views: info.view_count ?? r.views,
      postedAt: info.timestamp ? info.timestamp * 1000 : r.postedAt,
    });
    const p = await probe(file);
    if (!p.hasVideo || !p.durationMs) throw new JobError('It has no picture to measure.', { retry: false });
    const seconds = p.durationMs / 1000;
    if (seconds > MAX_SECONDS) throw new JobError(`It’s ${Math.round(seconds / 60)} minutes long: references are shorts (up to 4 minutes).`, { retry: false });

    step('Measuring the picture');
    const [diffs, cuts] = await Promise.all([frameDiffs(file), hardCuts(file)]);
    await saveFrames(file, seconds, dirOf(referenceId), work);
    update(referenceId, { hasFrames: true });

    step('Reading what’s said');
    const transcript = p.hasAudio ? await transcribe(file, r.url, r.platform, work) : null;
    const words = (transcript?.segments ?? []).flatMap((s) => (s.words ?? []).map((w) => ({ start: w.start, end: w.end, text: w.word.trim() }))).filter((w) => w.text);

    // The sound effects are found in what isn't voice: Demucs splits it out; with nothing said, it's all of it.
    let rest: number[] | null = null;
    let mix: number[] | null = null;
    let voice: number[] | null = null;
    if (p.hasAudio) {
      if (!words.length) rest = await soundLevels(file);
      else if (clipToolsInstalled()) {
        step('Splitting the voice from the rest');
        const wav = join(work, 'sound.wav');
        await execFile(requireBinary('ffmpeg'), ['-y', '-v', 'error', '-nostdin', '-i', file, '-vn', '-ar', '44100', '-c:a', 'pcm_s16le', wav], { maxBuffer: 10 * 1024 * 1024 });
        await runTool('separate', { audio: wav, vocals: join(work, 'voice.wav'), rest: join(work, 'rest.wav') }, {}, { timeoutMs: 20 * 60_000, track: `reference:${referenceId}` });
        rest = await soundLevels(join(work, 'rest.wav'));
        voice = await soundLevels(join(work, 'voice.wav'));
      } else mix = await soundLevels(file);
    }
    step('Measuring the sound');
    const measures = measure({ seconds, width: p.width ?? 0, height: p.height ?? 0, diffs, cuts, rest, mix, voice, words });
    const lines = (transcript?.segments ?? []).map((s) => ({ at: Math.round(s.start * 10) / 10, text: s.text.trim() })).filter((l) => l.text);
    update(referenceId, { measures, lines, measuredAt: now(), status: 'done', step: '', error: null });
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export function onMeasureFailed({ referenceId }: { referenceId: string }, message: string) {
  try {
    update(referenceId, { status: 'error', step: '', error: message.slice(0, 300) });
  } catch {
    /* deleted */
  }
}

const INGREDIENT_ITEMS = {
  type: 'object',
  additionalProperties: false,
  required: ['aspect', 'name', 'what', 'why', 'at'],
  properties: {
    aspect: { type: 'string', enum: [...INGREDIENT_ASPECTS] },
    name: { type: 'string', description: 'A few words a person would use, e.g. "Calm illustrated night scenes", "One question carried to the end"' },
    what: { type: 'string', description: 'How this video does it, concretely: what the frames show, the times, the measured numbers. 1–2 sentences' },
    why: { type: 'string', description: 'What it does for the viewer. One sentence' },
    at: { type: ['number', 'null'], description: 'The second it shows best, or null' },
  },
};

const READ_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'why', 'shape', 'ingredients', 'cautions'],
  properties: {
    summary: { type: 'string', description: 'What the video is and how it is made, in one or two sentences' },
    why: { type: 'string', description: 'Why it moves people: the heart of it, 1–3 sentences' },
    shape: {
      type: 'array',
      maxItems: 7,
      items: { type: 'object', additionalProperties: false, required: ['at', 'what'], properties: { at: { type: 'number', description: 'Seconds' }, what: { type: 'string', description: 'One line' } } },
      description: 'How it is built over time, 3–7 steps: how it opens, what it builds, where it turns, how it closes and how the end answers the start',
    },
    ingredients: { type: 'array', minItems: 4, maxItems: 10, items: INGREDIENT_ITEMS, description: 'The distinct choices its maker made, each one the creator can take or leave on its own' },
    cautions: { type: 'array', items: { type: 'string' }, description: 'Only what is real and matters; empty is fine' },
  },
};

type ReadOut = { summary: string; why: string; shape: { at: number; what: string }[]; ingredients: Omit<Ingredient, 'id' | 'mark' | 'note'>[]; cautions: string[] };

const INSTRUCTIONS = `The creator dropped this short video on the Knowledge page because it moved them: it's inspiration for their own videos. You study how it was built, so their videos can carry what makes it powerful without copying it. You get the numbers measured from it (trust them; never invent numbers or times), what is said with times, its first frame, and a contact sheet of 12 frames across it.

- Describe, never grade. The creator chose it because it works for them: never judge it against rules, never say what it lacks or how to fix it. Say what it does and why it lands.
- \`why\`: the heart of it, what makes someone stop, feel and remember it.
- \`shape\`: how it is built over time: how it opens, what it builds, where it turns, how it closes, and how the end answers the start.
- \`ingredients\`: 6–10 distinct choices its maker made, each one the creator can take or leave on its own: the idea or angle, how the story is told, the visual style and kind of imagery, the production quality (sharpness, polish, consistency, how finished it looks), the voice and delivery, the text on screen and captions, the pace and motion, the sound, the feel it leaves. Keep separate things separate, so liking one never means taking another: the look of a clip and the message in it are two ingredients.
- When the message itself is something to leave (an unsourced claim, blame of a whole group, anything haram), make it its own ingredient, say so plainly in it, and add a caution.
- Sound: voice-only backgrounds (humming, voices, a vocal drone, a nasheed with no instruments) are fine for this creator; only musical instruments are out. The measurements can't tell an instrument from an ambience or a hum, so never say a bed "may be music". Mention instruments only when a steady beat was measured.
- \`cautions\`: only what is real and matters: something haram shown or promoted, a Qur'an or hadith quote with no reference on screen (to check before taking anything from it), a claim that needs a source. Not a list of what the video "should" have done.
- Never write a script from it or reuse its lines. Plain, specific language.`;

const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n * 100)} %`);
const times = (xs: number[], max = 60) => (xs.length ? xs.slice(0, max).join(', ') + (xs.length > max ? ` … (${xs.length} in all)` : '') : 'none');

/** The measured numbers as the model reads them. */
function measuredText(m: ReferenceMeasures) {
  const per2: string[] = [];
  for (let t = 0; t < m.seconds; t += 2) {
    const inWin = (xs: number[]) => xs.filter((x) => x >= t && x < t + 2).length;
    const motion = m.motion.slice(t * 2, t * 2 + 4);
    const level = motion.length ? motion.reduce((a, b) => a + b, 0) / motion.length : 0;
    per2.push(`${t}–${t + 2} s: ${inWin(m.changes)} changes, ${inWin(m.sounds)} sounds, motion ${level.toFixed(2)}`);
  }
  const under =
    m.background === 'bed' ? 'Something runs under the voice most of the time (an ambience, a pad, a hum or instruments: the numbers can’t tell which).' : m.background === 'some' ? 'Something runs under the voice part of the time (the numbers can’t tell what).' : '';
  const vocal = m.voiceBed != null && m.voiceBed >= 0.4 ? ` The voice track keeps sounding in ${pct(m.voiceBed)} of the pauses between words: humming or voices without words.` : '';
  return [
    `Length ${m.seconds} s, ${m.width}×${m.height}.`,
    `Picture: ${m.cuts.length} hard cuts (${m.cutsPerSecond} a second) at ${times(m.cuts)}. ${m.changes.length} changes on screen (cuts, and things starting to move): ${m.changesPer10} per 10 s, at ${times(m.changes)}. The picture moves ${pct(m.moving)} of the time; the longest still stretch is ${m.longestStill.seconds} s from ${m.longestStill.at} s.`,
    `Sound: ${
      m.soundsFrom === 'none'
        ? 'no sound to measure.'
        : `${m.sounds.length} sound-effect hits (${m.soundsPer10} per 10 s${m.soundsFrom === 'pauses' ? ', only counted in the pauses between words' : ''}) at ${times(m.sounds)}. ${pct(m.soundOnChange)} of the changes have a sound on their frame.`
    }${m.beat ? ` A steady beat every ${m.beat} s (percussion or instruments).` : ''} ${under}${vocal}`,
    `Speech: ${m.words ? `${m.words} words, ${m.wordsPerSecond} a second, the first at ${m.firstWordAt} s. First 3 s: “${m.firstWords}”` : 'nothing said.'}`,
    `Every 2 s:\n${per2.join('\n')}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

const pageLine = (w: { name: string; kind: keyof typeof KIND_INFO; niche: string }) => `${w.name} (${KIND_INFO[w.kind].label.toLowerCase()})${w.niche ? ` — ${w.niche}` : ''}`;

/** The read job (`reference.lessons`, its old name): one model call, how it's built and its ingredients for my marks. */
export function markReference(id: string, input: { note?: string; workspaceId?: string | null; ingredients?: { id: string; mark?: IngredientMark; note?: string }[] }) {
  const r = getRow(id);
  if (input.workspaceId) getWorkspace(input.workspaceId);
  const changes = new Map((input.ingredients ?? []).map((g) => [g.id, g]));
  const ingredients = r.ingredients.map((g) => {
    const c = changes.get(g.id);
    if (!c) return g;
    return { ...g, ...(c.mark !== undefined && { mark: c.mark === 'want' || c.mark === 'skip' ? c.mark : null }), ...(c.note !== undefined && { note: c.note.slice(0, 500) }) };
  });
  update(id, { ingredients, ...(input.note !== undefined && { note: input.note.slice(0, 2000) }), ...(input.workspaceId !== undefined && { workspaceId: input.workspaceId }) });
  for (const w of stylePages(r.workspaceId, input.workspaceId)) emitStyle(w);
  return getReference(id);
}

// ---------- a page's style ----------

const emitStyle = (workspaceId: string) => emit({ type: 'changed', entity: 'references', id: `style:${workspaceId}` });
/** The pages a reference's change touches: its page, or every page when it's for all of them. */
const stylePages = (...ids: (string | null | undefined)[]) =>
  ids.includes(null) || ids.every((x) => x === undefined) ? db.select({ id: schema.workspaces.id }).from(schema.workspaces).all().map((w) => w.id) : [...new Set(ids.filter((x): x is string => !!x))];

/** The references a page's style is written from: its own, and those for every page, read. */
const styleReferences = (workspaceId: string) =>
  db
    .select()
    .from(schema.referenceVideos)
    .orderBy(desc(schema.referenceVideos.createdAt))
    .all()
    .filter((r) => (r.workspaceId === workspaceId || r.workspaceId === null) && r.status === 'done' && r.ingredients.length);

/** What a style is written from, so a change to any of it shows it's out of date. */
const fingerprint = (refs: Row[]) => JSON.stringify(refs.map((r) => [r.id, r.note, r.ingredients.map((g) => [g.id, g.mark, g.note])]));

export function getStyle(workspaceId: string): PageStyle {
  getWorkspace(workspaceId);
  const row = db.select().from(schema.pageStyles).where(eq(schema.pageStyles.workspaceId, workspaceId)).get();
  const refs = styleReferences(workspaceId);
  return {
    workspaceId,
    body: row?.body ?? '',
    status: row?.status ?? 'idle',
    error: row?.error ?? null,
    builtAt: row?.builtAt ?? null,
    references: row?.references ?? 0,
    stale: !!refs.length && (!row?.builtAt || row.builtFrom !== fingerprint(refs)),
    edited: !!row && row.body !== row.builtBody,
  };
}

function setStyle(workspaceId: string, values: Partial<typeof schema.pageStyles.$inferInsert>) {
  db.insert(schema.pageStyles)
    .values({ workspaceId, ...values, updatedAt: now() })
    .onConflictDoUpdate({ target: schema.pageStyles.workspaceId, set: { ...values, updatedAt: now() } })
    .run();
  emitStyle(workspaceId);
}

/** My own words for the style. */
export function saveStyle(workspaceId: string, body: string) {
  getWorkspace(workspaceId);
  setStyle(workspaceId, { body: body.slice(0, 8000) });
  return getStyle(workspaceId);
}

/** Write the style again from the references and my marks (my click). */
export function inspirationText(workspaceId: string) {
  const row = db.select().from(schema.pageStyles).where(eq(schema.pageStyles.workspaceId, workspaceId)).get();
  if (row?.body.trim()) return `The page's style, from the videos that moved its creator (follow it; never copy those videos):\n${row.body.trim()}`;
  const marked = styleReferences(workspaceId).flatMap((r) => r.ingredients.filter((g) => g.mark).map((g) => ({ g, from: r.channel })));
  if (!marked.length) return '';
  const list = (mark: IngredientMark) =>
    marked
      .filter((x) => x.g.mark === mark)
      .map((x) => `- ${ASPECT_LABELS[x.g.aspect]}: ${x.g.name}${x.g.note ? ` (${x.g.note})` : ''}${x.from ? ` (from @${x.from})` : ''}`)
      .join('\n');
  return [`What the creator wants from the videos that moved them (inspiration, never a copy):\n${list('want')}`, list('skip') && `Not for them:\n${list('skip')}`].filter(Boolean).join('\n');
}

/**
 * The same measures from my own latest edits (up to 8, of one page or all), to set beside a reference: changes on
 * screen per 10 s, the longest stretch with nothing changing, moves with a sound on their frame, the first word.
 */
export async function ownMeasures(workspaceId: string | null): Promise<OwnMeasures> {
  const rows = db
    .select({ working: schema.edits.working })
    .from(schema.edits)
    .where(workspaceId ? eq(schema.edits.workspaceId, workspaceId) : undefined)
    .orderBy(desc(schema.edits.workingUpdatedAt))
    .limit(20)
    .all();
  const stats: { per10: number; gap: number; sound: number | null; first: number | null }[] = [];
  for (const row of rows) {
    if (stats.length >= 8) break;
    const spec = normalizeEdit(row.working);
    const duration = editDuration(spec);
    if (duration < 3) continue;
    const events = screenEvents(spec);
    const marks = [0, ...events.map((e) => e.at).filter((t) => t > 0 && t < duration), duration];
    let gap = 0;
    for (let i = 1; i < marks.length; i++) gap = Math.max(gap, marks[i] - marks[i - 1]);
    const moves = events.filter((e) => e.motion);
    const words = await specTranscripts(spec, specMedia(spec))
      .then((t) => timelineWords(spec, t))
      .catch(() => []);
    stats.push({ per10: (events.length / duration) * 10, gap, sound: moves.length ? moves.filter((e) => e.sound).length / moves.length : null, first: words[0]?.start ?? null });
  }
  const avg = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const r1 = (n: number | null) => (n === null ? null : Math.round(n * 10) / 10);
  const sound = avg(stats.map((s) => s.sound));
  return {
    videos: stats.length,
    changesPer10: r1(avg(stats.map((s) => s.per10))),
    longestStill: r1(avg(stats.map((s) => s.gap))),
    soundOnChange: sound === null ? null : Math.round(sound * 100) / 100,
    firstWordAt: r1(avg(stats.map((s) => s.first))),
  };
}

/** For the chat: the references for this page (and every page), how each is built, and what I marked on them. */
export function referencesText(workspaceId: string) {
  const rows = db
    .select()
    .from(schema.referenceVideos)
    .where(eq(schema.referenceVideos.status, 'done'))
    .orderBy(desc(schema.referenceVideos.createdAt))
    .all()
    .filter((r) => !r.workspaceId || r.workspaceId === workspaceId)
    .slice(0, 12);
  const mark = (g: Ingredient) => (g.mark === 'want' ? 'wanted' : g.mark === 'skip' ? 'not for them' : 'unmarked');
  return rows.map((r) => {
    const m = r.measures!;
    const read = readOf(r);
    return [
      `## ${r.title || r.url}${r.channel ? ` (${r.channel})` : ''}`,
      `id ${r.id} · ${r.url}`,
      `${m.seconds} s · ${m.changesPer10} changes per 10 s · longest still ${m.longestStill.seconds} s · ${m.cutsPerSecond} cuts a second · ${m.wordsPerSecond ?? 0} words a second`,
      r.note && `What moved the creator: ${r.note}`,
      read && `${read.summary}\nWhy it works: ${read.why}\nShape: ${read.shape.map((x) => `${x.at} s ${x.what}`).join(' → ')}`,
      read && r.ingredients.length && `Ingredients:\n${r.ingredients.map((g) => `- ${ASPECT_LABELS[g.aspect]}: ${g.name} (${mark(g)}${g.note ? `: ${g.note}` : ''}). ${g.what}`).join('\n')}`,
      read?.cautions.length && `Cautions: ${read.cautions.join(' · ')}`,
    ]
      .filter(Boolean)
      .join('\n');
  });
}

/** At start: folders of references that are gone (a page deleted with its references, a crash mid-delete). */
export async function sweepReferenceFolders() {
  const ids = new Set(db.select({ id: schema.referenceVideos.id }).from(schema.referenceVideos).all().map((r) => r.id));
  for (const name of await readdir(config.referencesDir).catch(() => [] as string[])) if (!ids.has(name)) await rm(join(config.referencesDir, name), { recursive: true, force: true });
}
