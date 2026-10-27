// References (phase 12 step 7): a video I paste on the Knowledge page is downloaded and measured (measure.ts, no
// model), then read by one model call (task `lessons`), which marks its beats, its promise and payoff, and drafts a
// few lessons as suggested Knowledge rules: approving them is my click. Two jobs, so a failed read can be tried again
// without measuring again: `reference.measure` (yt-dlp, FFmpeg, Whisper, Demucs) then `reference.lessons`.
import { execFile as execFileCb } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { and, desc, eq } from 'drizzle-orm';
import { editDuration, normalizeEdit, timelineWords } from '../../../shared/edit';
import { KNOWLEDGE_TOPICS, RULE_BODY_MAX, RULE_TITLE_MAX, type KnowledgeTopic } from '../../../shared/knowledge';
import { screenEvents } from '../../../shared/quality';
import { BEAT_KINDS, type OwnMeasures, type ReferenceMeasures, type ReferenceRead, type ReferenceVideo } from '../../../shared/references';
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
import { downloadPost, postOf, whisper } from '../research/analyse';
import { clipToolsInstalled } from '../services/cliptools';
import { getWorkspace } from '../services/pieces';
import { specMedia, specTranscripts } from '../studio/edits';
import { createRule } from './knowledge';
import { frameDiffs, hardCuts, measure, soundLevels } from './measure';

const execFile = promisify(execFileCb);

type Row = typeof schema.referenceVideos.$inferSelect;

/** Topics a lesson can go under (halal is the user's own; clipping is paused). */
const LESSON_TOPICS = KNOWLEDGE_TOPICS.filter((t): t is Exclude<KnowledgeTopic, 'halal' | 'clipping'> => t !== 'halal' && t !== 'clipping');
/** Longer videos aren't references for shorts (and Demucs on a laptop is slow). */
const MAX_SECONDS = 4 * 60;
/** Frames on the contact sheet. */
const SHEET = { cols: 4, rows: 3 };

const emitReferences = (id?: string) => emit({ type: 'changed', entity: 'references', id });
const dirOf = (id: string) => join(config.referencesDir, id);

function toReference(r: Row): ReferenceVideo {
  const lessons = db
    .select({ id: schema.knowledge.id, title: schema.knowledge.title, status: schema.knowledge.status })
    .from(schema.knowledge)
    .where(eq(schema.knowledge.referenceId, r.id))
    .all();
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
    read: r.read,
    lines: r.lines,
    hasFrames: r.hasFrames,
    lessons,
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

/** After an error: measure again if it never was, else only read it again. */
export function retryReference(id: string) {
  const r = getRow(id);
  if (r.status !== 'error') return getReference(id);
  if (r.measures) {
    update(id, { status: 'drafting', step: 'Waiting to read it', error: null });
    enqueue('reference.lessons', { referenceId: id }, { maxAttempts: 2 });
  } else {
    update(id, { status: 'queued', step: 'Waiting to start', error: null });
    enqueue('reference.measure', { referenceId: id }, { maxAttempts: 2 });
  }
  return getReference(id);
}

/** Read it again and draft new lessons: its suggestions still waiting go (approved ones stay). */
export function redraftLessons(id: string) {
  const r = getRow(id);
  if (!r.measures) throw badRequest('It hasn’t been measured yet.');
  if (r.status === 'measuring' || r.status === 'drafting' || r.status === 'queued') return getReference(id);
  db.delete(schema.knowledge)
    .where(and(eq(schema.knowledge.referenceId, id), eq(schema.knowledge.status, 'proposed')))
    .run();
  emit({ type: 'changed', entity: 'knowledge' });
  update(id, { status: 'drafting', step: 'Waiting to read it', error: null });
  enqueue('reference.lessons', { referenceId: id }, { maxAttempts: 2 });
  return getReference(id);
}

/** Gone, with its frames and the suggestions still waiting; lessons I approved stay as rules. */
export async function deleteReference(id: string) {
  getRow(id);
  db.delete(schema.knowledge)
    .where(and(eq(schema.knowledge.referenceId, id), eq(schema.knowledge.status, 'proposed')))
    .run();
  db.delete(schema.referenceVideos).where(eq(schema.referenceVideos.id, id)).run();
  await rm(dirOf(id), { recursive: true, force: true });
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

/** What's said: Whisper (its word times are the ones measured against), else YouTube's captions. */
async function transcribe(file: string, url: string, platform: Row['platform'], work: string): Promise<Transcript | null> {
  const t = await whisper(file, work).catch(() => null);
  if (t) return t;
  return platform === 'youtube' ? youtubeCaptions(url).catch(() => null) : null;
}

/** The `reference.measure` job. */
export async function measureReference({ referenceId }: { referenceId: string }) {
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
    if (p.hasAudio) {
      if (!words.length) rest = await soundLevels(file);
      else if (clipToolsInstalled()) {
        step('Splitting the voice from the rest');
        const wav = join(work, 'sound.wav');
        await execFile(requireBinary('ffmpeg'), ['-y', '-v', 'error', '-nostdin', '-i', file, '-vn', '-ar', '44100', '-c:a', 'pcm_s16le', wav], { maxBuffer: 10 * 1024 * 1024 });
        await runTool('separate', { audio: wav, vocals: join(work, 'voice.wav'), rest: join(work, 'rest.wav') }, {}, { timeoutMs: 20 * 60_000, track: `reference:${referenceId}` });
        rest = await soundLevels(join(work, 'rest.wav'));
      } else mix = await soundLevels(file);
    }
    step('Measuring the sound');
    const measures = measure({ seconds, width: p.width ?? 0, height: p.height ?? 0, diffs, cuts, rest, mix, words });
    const lines = (transcript?.segments ?? []).map((s) => ({ at: Math.round(s.start * 10) / 10, text: s.text.trim() })).filter((l) => l.text);
    update(referenceId, { measures, lines, measuredAt: now(), status: 'drafting', step: 'Waiting to read it', error: null });
    enqueue('reference.lessons', { referenceId }, { maxAttempts: 2 });
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

const READ_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'hook', 'promise', 'payoff', 'payoffAt', 'beats', 'motion', 'sound', 'cautions', 'lessons'],
  properties: {
    summary: { type: 'string', description: 'What the video is and how it is made, in one or two sentences' },
    hook: {
      type: 'object',
      additionalProperties: false,
      required: ['picture', 'words', 'text', 'why'],
      properties: {
        picture: { type: 'string', description: 'What the first frame shows and what moves in the first 1–3 s' },
        words: { type: 'string', description: 'What is said in the first 3 s, briefly (quote at most a few words)' },
        text: { type: 'string', description: 'The text on screen at the start; empty if none' },
        why: { type: 'string', description: 'Why it stops the scroll, by the rules' },
      },
    },
    promise: { type: 'string', description: 'The promise the opening makes: what the viewer stays for' },
    payoff: { type: 'string', description: 'What pays the promise off; empty if it never does' },
    payoffAt: { type: ['number', 'null'], description: 'The second the payoff lands, or null' },
    beats: {
      type: 'array',
      maxItems: 10,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['at', 'kind', 'what'],
        properties: { at: { type: 'number', description: 'Seconds' }, kind: { type: 'string', enum: [...BEAT_KINDS] }, what: { type: 'string', description: 'One line' } },
      },
      description: 'The beats in order: hook, setup, build, re-hooks, payoff, call to action, end',
    },
    motion: { type: 'string', description: 'How the picture moves and changes, from the measured numbers and the frames: cuts, animation, graphics, kinetic type' },
    sound: { type: 'string', description: 'Voice and sound effects from the measured hits; if it has music, only say that it has music (never copied)' },
    cautions: { type: 'array', items: { type: 'string' }, description: 'Music, anything haram, claims to check; empty if none' },
    lessons: {
      type: 'array',
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['topic', 'title', 'body', 'why'],
        properties: {
          topic: { type: 'string', enum: [...LESSON_TOPICS] },
          title: { type: 'string', description: `The rule's name, at most ${RULE_TITLE_MAX} characters` },
          body: { type: 'string', description: 'The rule, as an instruction for future videos: 1–4 sentences, with the measured numbers that make it concrete' },
          why: { type: 'string', description: 'What in this video shows it: the times and the numbers' },
        },
      },
      description: 'Rules worth adding to the knowledge base: only what is new or sharper than the rules already there; none is fine',
    },
  },
};

type ReadOut = Omit<ReferenceRead, 'beats'> & { beats: ReferenceRead['beats']; lessons: { topic: string; title: string; body: string; why: string }[] };

const INSTRUCTIONS = `You study a short vertical video the creator chose as a reference, to learn how it is made and what their own videos should take from it. You get the numbers measured from it (trust them; never invent numbers or times), what is said with times, its first frame, and a contact sheet of 12 frames across it.

- The content model: every video has a hook (a promise in the first 1–3 s), content that builds toward it and a payoff near the end. Name the promise, the payoff and the second it lands, and mark the beats with their times.
- Lessons become rules in the creator's knowledge base, used for every video they make: write them as instructions, concrete (numbers, timings, moves), about how to make videos, never about this video's topic or its words. Only add what the rules above don't already say, or say it sharper with the numbers. Fewer, better lessons; none if it teaches nothing new.
- Explain, don't copy: never write a script from it or reuse its lines.
- The creator never uses music or instruments. If it has music (a beat, a bed), say so in cautions and in the sound notes, and never suggest music, beats or anything synced to music. Sound lessons are about non-melodic sound effects and the voice only. Flag anything haram it shows or promotes.
- Plain, specific language.`;

const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n * 100)} %`);
const times = (xs: number[], max = 60) => (xs.length ? xs.slice(0, max).join(', ') + (xs.length > max ? ` … (${xs.length} in all)` : '') : 'none');

/** The measured numbers as the model reads them, with the page's own videos beside them. */
function measuredText(m: ReferenceMeasures, own: OwnMeasures | null) {
  const per2: string[] = [];
  for (let t = 0; t < m.seconds; t += 2) {
    const inWin = (xs: number[]) => xs.filter((x) => x >= t && x < t + 2).length;
    const motion = m.motion.slice(t * 2, t * 2 + 4);
    const level = motion.length ? motion.reduce((a, b) => a + b, 0) / motion.length : 0;
    per2.push(`${t}–${t + 2} s: ${inWin(m.changes)} changes, ${inWin(m.sounds)} sounds, motion ${level.toFixed(2)}`);
  }
  return [
    `Length ${m.seconds} s, ${m.width}×${m.height}.`,
    `Picture: ${m.cuts.length} hard cuts (${m.cutsPerSecond} a second) at ${times(m.cuts)}. ${m.changes.length} changes on screen (cuts, and things starting to move): ${m.changesPer10} per 10 s, at ${times(m.changes)}. The picture moves ${pct(m.moving)} of the time; the longest still stretch is ${m.longestStill.seconds} s from ${m.longestStill.at} s.`,
    `Sound: ${
      m.soundsFrom === 'none'
        ? 'no sound to measure.'
        : `${m.sounds.length} sound-effect hits (${m.soundsPer10} per 10 s${m.soundsFrom === 'pauses' ? ', only counted in the pauses between words: the voice couldn’t be split out' : ''}) at ${times(m.sounds)}. ${pct(m.soundOnChange)} of the changes have a sound on their frame; ${pct(m.soundsOnChanges)} of the sounds land on a change.`
    }${m.beat ? ` It has music: a steady beat every ${m.beat} s.` : ''}${m.background === 'bed' ? ' A bed runs under the voice most of the time (music or ambience).' : m.background === 'some' ? ' Something runs under the voice part of the time (music or ambience).' : ''}`,
    `Speech: ${m.words ? `${m.words} words, ${m.wordsPerSecond} a second, the first at ${m.firstWordAt} s. First 3 s: “${m.firstWords}”` : 'nothing said.'}`,
    `First 3 s: ${m.hook.changes} changes (the first at ${m.hook.firstChangeAt ?? '—'} s), ${m.hook.sounds} sounds.`,
    `Every 2 s:\n${per2.join('\n')}`,
    own?.videos
      ? `The creator's own latest ${own.videos} edits, measured the same way: ${own.changesPer10 ?? '—'} changes per 10 s, longest stretch with nothing changing ${own.longestStill ?? '—'} s, ${pct(own.soundOnChange)} of moves with a sound on their frame, first word at ${own.firstWordAt ?? '—'} s.`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** The `reference.lessons` job: one model call, then the lessons as suggested rules. */
export async function draftLessons({ referenceId }: { referenceId: string }) {
  const r = getRow(referenceId);
  if (!r.measures) throw new JobError('It hasn’t been measured.', { retry: false });
  await waitForUsage('lessons');
  update(referenceId, { status: 'drafting', step: 'Reading it and drafting lessons' });
  const m = r.measures;
  const ws = r.workspaceId ? getWorkspace(r.workspaceId) : null;
  const pages = ws
    ? `${ws.name} (${KIND_INFO[ws.kind].label.toLowerCase()})${ws.niche ? ` — ${ws.niche}` : ''}`
    : db
        .select()
        .from(schema.workspaces)
        .all()
        .map((w) => `${w.name} (${KIND_INFO[w.kind].label.toLowerCase()})${w.niche ? ` — ${w.niche}` : ''}`)
        .join('; ');
  const own = await ownMeasures(r.workspaceId).catch(() => null);
  const images: PromptImage[] = [];
  for (const name of ['first', 'sheet'] as const) {
    const file = join(dirOf(referenceId), `${name}.jpg`);
    if (existsSync(file)) images.push({ data: (await readFile(file)).toString('base64'), mediaType: 'image/jpeg' });
  }
  const n = SHEET.cols * SHEET.rows;
  const sheetTimes = Array.from({ length: n }, (_, i) => Math.round((((i + 0.5) * m.seconds) / n) * 10) / 10);
  const out = await askStructured<ReadOut>({
    task: 'lessons',
    system: [playbook('content-model', 'hooks', 'retention', 'packaging', 'motion', 'sound-design', 'halal'), INSTRUCTIONS].filter(Boolean).join('\n\n'),
    prompt: [
      `# Who learns from it\n${ws ? `The page ${pages}.` : `Every page: ${pages || '(none yet)'}.`}`,
      `# The reference\n${[r.platform, r.channel && `by ${r.channel}`, r.views !== null && `${r.views.toLocaleString('en-GB')} views`].filter(Boolean).join(' · ')}${r.title ? `\nTitle or caption: “${r.title.slice(0, 400)}”` : ''}`,
      `# Measured\n${measuredText(m, own)}`,
      `# What's said\n${r.lines.length ? r.lines.map((l) => `[${l.at} s] ${l.text}`).join('\n').slice(0, 8000) : '(nothing)'}`,
      `# The pictures\n${images.length === 2 ? `The first frame, then the contact sheet: 12 frames left to right, top to bottom, at ${sheetTimes.join(', ')} s.` : '(none)'}`,
    ].join('\n\n'),
    schema: READ_SCHEMA,
    images,
    model: resolveModel(),
  });
  const read: ReferenceRead = {
    summary: out.summary?.trim() ?? '',
    hook: { picture: out.hook?.picture ?? '', words: out.hook?.words ?? '', text: out.hook?.text ?? '', why: out.hook?.why ?? '' },
    promise: out.promise ?? '',
    payoff: out.payoff ?? '',
    payoffAt: typeof out.payoffAt === 'number' && out.payoffAt >= 0 && out.payoffAt <= m.seconds ? Math.round(out.payoffAt * 10) / 10 : null,
    beats: (out.beats ?? [])
      .filter((b) => (BEAT_KINDS as readonly string[]).includes(b.kind) && typeof b.at === 'number' && b.at >= 0 && b.at <= m.seconds)
      .map((b) => ({ at: Math.round(b.at * 10) / 10, kind: b.kind, what: b.what.trim() }))
      .sort((a, b) => a.at - b.at),
    motion: out.motion ?? '',
    sound: out.sound ?? '',
    cautions: (out.cautions ?? []).map((c) => c.trim()).filter(Boolean),
  };
  // A new read replaces the suggestions still waiting (a retry after a failure may have left some).
  db.delete(schema.knowledge)
    .where(and(eq(schema.knowledge.referenceId, referenceId), eq(schema.knowledge.status, 'proposed')))
    .run();
  for (const l of (out.lessons ?? []).slice(0, 4)) {
    if (!(LESSON_TOPICS as readonly string[]).includes(l.topic) || !l.title?.trim() || !l.body?.trim()) continue;
    createRule({
      topic: l.topic as KnowledgeTopic,
      title: l.title.trim().slice(0, RULE_TITLE_MAX),
      body: l.body.trim().slice(0, RULE_BODY_MAX),
      source: 'reference',
      status: 'proposed',
      note: l.why ?? '',
      workspaceId: r.workspaceId,
      referenceId,
    });
  }
  update(referenceId, { read, status: 'done', step: '', error: null });
  emit({ type: 'job', jobType: 'reference.lessons', status: 'done', message: 'A reference is measured, its lessons are on Knowledge' });
}

export function onLessonsFailed({ referenceId }: { referenceId: string }, message: string) {
  try {
    update(referenceId, { status: 'error', step: '', error: `Measured, but it couldn’t be read: ${message}`.slice(0, 300) });
  } catch {
    /* deleted */
  }
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

/** For the chat: every reference measured (for every page, or this one), briefly. */
export function referencesText(workspaceId: string) {
  const rows = db
    .select()
    .from(schema.referenceVideos)
    .where(eq(schema.referenceVideos.status, 'done'))
    .orderBy(desc(schema.referenceVideos.createdAt))
    .all()
    .filter((r) => !r.workspaceId || r.workspaceId === workspaceId)
    .slice(0, 12);
  return rows.map((r) => {
    const m = r.measures!;
    return [
      `## ${r.title || r.url}${r.channel ? ` (${r.channel})` : ''}`,
      `id ${r.id} · ${r.url}`,
      `${m.seconds} s · ${m.changesPer10} changes per 10 s · longest still ${m.longestStill.seconds} s · ${m.cutsPerSecond} cuts a second · ${m.soundsPer10} sounds per 10 s, ${pct(m.soundOnChange)} of changes with a sound · ${m.wordsPerSecond ?? 0} words a second${m.beat ? ' · has music (never copied)' : m.background === 'bed' ? ' · a bed under the voice, maybe music (never copied)' : ''}`,
      r.read ? `${r.read.summary}\nHook: ${r.read.hook.picture} ${r.read.hook.why}\nPromise: ${r.read.promise} → payoff at ${r.read.payoffAt ?? '?'} s: ${r.read.payoff}\nBeats: ${r.read.beats.map((b) => `${b.at} s ${b.kind}: ${b.what}`).join('; ')}\nMotion: ${r.read.motion}\nSound: ${r.read.sound}` : '',
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
