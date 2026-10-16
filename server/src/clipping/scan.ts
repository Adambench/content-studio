// Where to look in a long source video, found without Claude: windows of 20–75 s on sentence boundaries, scored on
// loudness peaks, speech pace, the chat replay's busy moments (where yt-dlp gets one), the brief's keywords and a few
// cues of a good clip (numbers, contrasts, stories). The best ~30 go to Claude (`source.pick`) as stretches of
// transcript, so one request reads only those. A short source goes whole.
import { spawn } from 'node:child_process';
import { readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { Transcript } from '../../../shared/types';
import { campaignDir, getCampaignRow, getSource, updateSource, type SourceRow } from '../campaigns/campaigns';
import { readSourceTranscript, run, sourceFile, sourceScanPath, ytdlp } from '../campaigns/sources';
import { db, schema } from '../db';
import { requireBinary } from '../lib/bin';
import { enqueue, JobError } from '../jobs/queue';

export type Word = { start: number; end: number; text: string };
/** A line of the transcript: a sentence, or a caption line when the transcript has no punctuation. */
export type Line = { start: number; end: number; text: string; words: number };
export type ScanWindow = { start: number; end: number; score: number; signals: { loud: number; pace: number; chat: number; keywords: number; cues: number; weakStart: boolean } };
export type ScanResult = { at: number; duration: number; whole: boolean; chat: number; windows: ScanWindow[]; stretches: { start: number; end: number }[] };

const MIN_WINDOW = 20;
const MAX_WINDOW = 75;
/** Sources up to this long go to Claude whole. */
const WHOLE_SECONDS = 15 * 60;
/** At most this much transcript goes to Claude from a long source. */
const MAX_STRETCH_SECONDS = 45 * 60;

const exists = (id: string) => !!db.select({ id: schema.campaignSources.id }).from(schema.campaignSources).where(eq(schema.campaignSources.id, id)).get();

// ---------- transcript → lines ----------

/** Every word with its time. Segments without word timings get theirs spread over the segment by length. */
export function transcriptWords(t: Transcript): Word[] {
  const out: Word[] = [];
  for (const seg of t.segments) {
    if (seg.words?.length) {
      for (const w of seg.words) if (w.word.trim()) out.push({ start: w.start, end: w.end, text: w.word.trim() });
      continue;
    }
    const parts = seg.text.split(/\s+/).filter(Boolean);
    const chars = parts.reduce((n, w) => n + w.length + 1, 0) || 1;
    let at = seg.start;
    for (const p of parts) {
      const len = ((seg.end - seg.start) * (p.length + 1)) / chars;
      out.push({ start: at, end: at + len, text: p });
      at += len;
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

const MAX_LINE = 15;

/**
 * Lines on sentence boundaries. Whisper punctuates, so a line ends at a full stop, a question or an exclamation;
 * YouTube's automatic captions don't (and their words touch), so their caption lines are used instead. Either way a
 * pause of a second ends a line, and lines longer than 15 s are split at their longest pause.
 */
export function toLines(t: Transcript): Line[] {
  const words = transcriptWords(t);
  if (!words.length) return [];
  const punctuated = words.filter((w) => /[.?!…]["”')\]]*$/.test(w.text)).length > words.length * 0.02;
  // Without punctuation, a segment's last word ends a line.
  const segmentEnds = new Set<number>();
  if (!punctuated) for (const seg of t.segments) if (seg.words?.length) segmentEnds.add(seg.words.at(-1)!.end);
  const groups: Word[][] = [];
  let cur: Word[] = [];
  words.forEach((w, i) => {
    cur.push(w);
    const next = words[i + 1];
    const gap = next ? next.start - w.end : Infinity;
    const end = punctuated ? /[.?!…]["”')\]]*$/.test(w.text) : segmentEnds.has(w.end);
    if (!next || gap >= 1 || end) {
      groups.push(cur);
      cur = [];
    }
  });
  const split = (g: Word[]): Word[][] => {
    if (g.length < 4 || g.at(-1)!.end - g[0].start <= MAX_LINE) return [g];
    let at = Math.floor(g.length / 2);
    let best = -1;
    for (let i = 1; i < g.length - 1; i++) {
      const gap = g[i].start - g[i - 1].end;
      // The longest pause, preferring the middle half so both halves stay useful.
      if (i > g.length / 4 && i < (g.length * 3) / 4 && gap > best) {
        best = gap;
        at = i;
      }
    }
    return [...split(g.slice(0, at)), ...split(g.slice(at))];
  };
  return groups.flatMap(split).map((g) => ({ start: g[0].start, end: g.at(-1)!.end, text: g.map((w) => w.text).join(' '), words: g.length }));
}

// ---------- signals ----------

/** The loudest quarter second of each second (dBFS), from the sound at 8 kHz: where people laugh, shout or argue. */
export function loudnessPerSecond(file: string): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const child = spawn(requireBinary('ffmpeg'), ['-v', 'error', '-nostdin', '-i', file, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], { stdio: ['ignore', 'pipe', 'pipe'] });
    const BLOCK = 2000; // 250 ms
    const blocks: number[] = [];
    let sum = 0;
    let n = 0;
    let carry: Buffer | null = null;
    child.stdout.on('data', (chunk: Buffer) => {
      let buf = carry ? Buffer.concat([carry, chunk]) : chunk;
      const usable = buf.length - (buf.length % 2);
      carry = usable < buf.length ? buf.subarray(usable) : null;
      buf = buf.subarray(0, usable);
      for (let i = 0; i < buf.length; i += 2) {
        const v = buf.readInt16LE(i) / 32768;
        sum += v * v;
        if (++n === BLOCK) {
          blocks.push(10 * Math.log10(sum / n + 1e-12));
          sum = 0;
          n = 0;
        }
      }
    });
    let err = '';
    child.stderr.on('data', (c: Buffer) => (err = (err + c.toString()).slice(-2000)));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(err.trim() || `ffmpeg stopped (exit ${code})`));
      const out = new Float32Array(Math.ceil(blocks.length / 4));
      for (let s = 0; s < out.length; s++) out[s] = Math.max(...blocks.slice(s * 4, s * 4 + 4));
      resolve(out);
    });
  });
}

/**
 * When chat messages came in during a past stream, in seconds: YouTube's `live_chat` replay or Twitch's `rechat`,
 * where yt-dlp can get them. Empty when there's none (a video that wasn't live, or the replay is off).
 */
export async function chatTimes(s: SourceRow): Promise<number[]> {
  if (!s.link || (s.kind !== 'youtube' && s.kind !== 'twitch')) return [];
  const y = ytdlp();
  const dir = campaignDir(s.campaignId);
  const base = `${s.id}.chat`;
  try {
    await run(y.bin, [...y.args, '--skip-download', '--write-subs', '--sub-langs', 'live_chat,rechat', '--no-playlist', '-o', join(dir, `${base}.%(ext)s`), s.link], { env: y.env, timeoutMs: 15 * 60_000, track: s.id });
  } catch (err) {
    console.warn(`[scan] no chat replay for ${s.link}: ${(err as Error).message}`);
  }
  const files = (await readdir(dir)).filter((f) => f.startsWith(base));
  const times: number[] = [];
  for (const f of files) {
    const text = await readFile(join(dir, f), 'utf8').catch(() => '');
    for (const m of text.matchAll(/"videoOffsetTimeMsec"\s*:\s*"?(\d+)/g)) times.push(Number(m[1]) / 1000);
    for (const m of text.matchAll(/"content(?:_offset_seconds|OffsetSeconds)"\s*:\s*([\d.]+)/g)) times.push(Number(m[1]));
    await rm(join(dir, f), { force: true });
  }
  return times.filter((t) => Number.isFinite(t) && t >= 0).sort((a, b) => a - b);
}

const STOPWORDS = new Set(
  'about above after again against also another because been before being below between both cannot could does doing down during each every from further have having here hers herself himself into itself just like make made more most must need needs only other ours over same should some such than that their theirs them themselves then there these they this those through under until very want were what when where which while whom with would your yours yourself clip clips clipping video videos content post posts posting campaign campaigns views view tiktok instagram youtube shorts reels reel creator creators page pages http https www com watch link links using used will'.split(' '),
);

/** Words from the brief and the pages' niches worth finding in the transcript. */
export function briefKeywords(texts: string[]) {
  const out = new Set<string>();
  for (const t of texts)
    for (const w of t.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []) {
      if (!STOPWORDS.has(w)) out.add(w);
      if (out.size >= 40) return [...out];
    }
  return [...out];
}

const CUES = [
  /\b\d+(?:[.,]\d+)?\b|\b(?:hundred|thousand|million|billion|percent)\b|[$%£€]/i,
  /\b(?:never|nobody|everyone|most people|actually|the truth|secret|mistake|wrong|problem|stop|biggest|worst|realized|changed my life)\b/i,
  /\b(?:i remember|one day|the day|years ago|i used to|when i was|first time|my dad|my mom|my father|my mother)\b/i,
  /\?/,
];
const WEAK_STARTS = new Set(['so', 'and', 'but', 'or', 'um', 'uh', 'yeah', 'because', 'cause', 'which', 'also', 'anyway', 'like', 'then', 'he', 'she', 'it', 'this', 'that']);

const firstWord = (text: string) => (text.toLowerCase().match(/[\p{L}']+/u)?.[0] ?? '').replace(/'$/, '');

function zscores(values: number[]) {
  const mean = values.reduce((a, b) => a + b, 0) / (values.length || 1);
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length || 1)) || 1;
  return values.map((v) => (v - mean) / sd);
}

const median = (xs: ArrayLike<number>) => {
  const s = Array.from(xs).sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/** Every window of 20–75 s that starts and ends on a line, scored. */
export function scoreWindows(lines: Line[], loud: Float32Array | null, chat: number[], keywords: string[]): ScanWindow[] {
  const kw = lines.map((l) => {
    const text = l.text.toLowerCase();
    return keywords.filter((k) => text.includes(k)).length;
  });
  const cue = lines.map((l) => CUES.filter((re) => re.test(l.text)).length);
  const W = [0];
  const K = [0];
  const C = [0];
  lines.forEach((l, i) => {
    W.push(W[i] + l.words);
    K.push(K[i] + kw[i]);
    C.push(C[i] + cue[i]);
  });
  const loudBase = loud ? median(loud.filter((v) => v > -70)) : 0;
  const duration = lines.at(-1)?.end ?? 0;
  const chatRate = chat.length / Math.max(1, duration);
  // Chat reacts a few seconds after the moment.
  const chatIn = (a: number, b: number) => {
    let lo = 0;
    let hi = chat.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (chat[mid] < a) lo = mid + 1;
      else hi = mid;
    }
    let n = 0;
    for (let i = lo; i < chat.length && chat[i] < b; i++) n++;
    return n;
  };
  const raw: { i: number; j: number; loud: number; pace: number; chat: number; keywords: number; cues: number; weakStart: boolean }[] = [];
  for (let i = 0; i < lines.length; i++) {
    for (let j = i; j < lines.length; j++) {
      const span = lines[j].end - lines[i].start;
      if (span > MAX_WINDOW) break;
      if (span < MIN_WINDOW) continue;
      let top: number[] = [];
      if (loud) {
        const from = Math.max(0, Math.floor(lines[i].start));
        const to = Math.min(loud.length, Math.ceil(lines[j].end));
        top = Array.from(loud.subarray(from, to)).sort((a, b) => b - a).slice(0, 3);
      }
      raw.push({
        i,
        j,
        loud: top.length ? top.reduce((a, b) => a + b, 0) / top.length - loudBase : 0,
        pace: (W[j + 1] - W[i]) / span,
        chat: chat.length ? Math.log1p(chatIn(lines[i].start + 2, lines[j].end + 12) / Math.max(1e-6, chatRate * (span + 10))) : 0,
        keywords: Math.min(3, K[j + 1] - K[i]),
        cues: Math.min(3, C[j + 1] - C[i]),
        weakStart: WEAK_STARTS.has(firstWord(lines[i].text)),
      });
    }
  }
  const zl = zscores(raw.map((r) => r.loud));
  const zp = zscores(raw.map((r) => r.pace));
  const zc = chat.length ? zscores(raw.map((r) => r.chat)) : raw.map(() => 0);
  return raw.map((r, k) => ({
    start: lines[r.i].start,
    end: lines[r.j].end,
    score: Math.round((1.0 * zl[k] + 0.6 * zp[k] + 1.2 * zc[k] + 0.5 * r.keywords + 0.4 * r.cues - 0.8 * (r.weakStart ? 1 : 0)) * 100) / 100,
    signals: { loud: Math.round(r.loud * 10) / 10, pace: Math.round(r.pace * 100) / 100, chat: Math.round(r.chat * 100) / 100, keywords: r.keywords, cues: r.cues, weakStart: r.weakStart },
  }));
}

const overlap = (a: { start: number; end: number }, b: { start: number; end: number }) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));

/**
 * The best windows, spread across the source: the top two of every 10 minutes first (the best clips aren't always in
 * the loud part), then the best of the rest, never two that mostly overlap.
 */
export function selectWindows(windows: ScanWindow[], duration: number, count: number) {
  const sorted = [...windows].sort((a, b) => b.score - a.score);
  const taken: ScanWindow[] = [];
  const fits = (w: ScanWindow) => taken.every((t) => overlap(t, w) <= 0.3 * Math.min(t.end - t.start, w.end - w.start));
  const parts = Math.max(1, Math.round(duration / 600));
  for (let p = 0; p < parts; p++) {
    const from = (p * duration) / parts;
    const to = ((p + 1) * duration) / parts;
    let n = 0;
    for (const w of sorted) {
      if (n >= 2 || taken.length >= count) break;
      if (w.start >= from && w.start < to && fits(w)) {
        taken.push(w);
        n++;
      }
    }
  }
  for (const w of sorted) {
    if (taken.length >= count) break;
    if (fits(w)) taken.push(w);
  }
  // Keep within what one request should read, dropping the weakest.
  taken.sort((a, b) => b.score - a.score);
  while (taken.length > 1 && taken.reduce((s, w) => s + (w.end - w.start), 0) > MAX_STRETCH_SECONDS) taken.pop();
  return taken.sort((a, b) => a.start - b.start);
}

/** Overlapping or nearly touching windows become one stretch, with a line of context on each side. */
export function toStretches(windows: ScanWindow[], lines: Line[]) {
  const out: { start: number; end: number }[] = [];
  for (const w of [...windows].sort((a, b) => a.start - b.start)) {
    const last = out.at(-1);
    if (last && w.start - last.end < 4) last.end = Math.max(last.end, w.end);
    else out.push({ start: w.start, end: w.end });
  }
  for (const s of out) {
    const before = lines.filter((l) => l.end <= s.start).at(-1);
    const after = lines.find((l) => l.start >= s.end);
    if (before) s.start = before.start;
    if (after) s.end = after.end;
  }
  return out;
}

// ---------- the job ----------

/** The `source.scan` job: find the candidate windows, then queue Claude's pick. */
export async function scanSource({ sourceId }: { sourceId: string }) {
  if (!exists(sourceId)) return;
  const s = updateSource(sourceId, { status: 'scanning', detail: 'Finding the liveliest stretches' });
  const c = getCampaignRow(s.campaignId);
  const t = await readSourceTranscript(s);
  if (!t) throw new JobError('It has no transcript yet.', { retry: false });
  const lines = toLines(t);
  const duration = Math.max(t.duration || 0, lines.at(-1)?.end ?? 0, (s.durationMs ?? 0) / 1000);
  if (lines.reduce((n, l) => n + l.words, 0) < 40) {
    updateSource(sourceId, { status: 'ready', detail: 'Too little speech in it to clip.' });
    return;
  }

  const file = sourceFile(s);
  const loud = file ? await loudnessPerSecond(file).catch((err: Error) => (console.warn(`[scan] loudness of ${sourceId}: ${err.message}`), null)) : null;
  if (!exists(sourceId)) return;
  let chat: number[] = [];
  if (s.kind === 'youtube' || s.kind === 'twitch') {
    updateSource(sourceId, { detail: 'Reading the chat replay' });
    chat = await chatTimes(getSource(sourceId));
    if (!exists(sourceId)) return;
  }
  const pages = db.select({ niche: schema.workspaces.niche }).from(schema.campaignPages).innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.campaignPages.workspaceId)).where(eq(schema.campaignPages.campaignId, c.id)).all();
  const keywords = briefKeywords([c.title, c.brand, c.description, ...pages.map((p) => p.niche)]);
  const windows = scoreWindows(lines, loud, chat, keywords);
  const whole = duration <= WHOLE_SECONDS;
  const picked = whole ? windows : selectWindows(windows, duration, Math.min(30, Math.ceil(duration / 90)));
  const result: ScanResult = {
    at: Date.now(),
    duration,
    whole,
    chat: chat.length,
    windows: (whole ? [...picked].sort((a, b) => b.score - a.score).slice(0, 30) : picked).map((w) => ({ ...w, start: round(w.start), end: round(w.end) })),
    stretches: whole ? [{ start: 0, end: round(duration) }] : toStretches(picked, lines).map((st) => ({ start: round(st.start), end: round(st.end) })),
  };
  await writeFile(sourceScanPath(s), JSON.stringify(result));
  if (!exists(sourceId)) return;
  updateSource(sourceId, { detail: 'Waiting for Claude to pick moments' });
  enqueue('source.pick', { sourceId }, { maxAttempts: 3 });
}

const round = (n: number) => Math.round(n * 100) / 100;

export async function readScan(s: Pick<SourceRow, 'campaignId' | 'id'>): Promise<ScanResult | null> {
  try {
    return JSON.parse(await readFile(sourceScanPath(s), 'utf8')) as ScanResult;
  } catch {
    return null;
  }
}
