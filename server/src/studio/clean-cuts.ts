// Clean cuts: every cut lands in a real pause of the voice, so a clip never starts on an "um", never ends with the first
// sound of the next sentence and never clips a word. Whisper's word times are close but not exact (faster-whisper gives
// a pause, or a filler it didn't write down, to the next word's start), so the cut points come from the voice's own
// loudness, 10 ms at a time. Mechanical: no model involved.
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import type { EditClip } from '../../../shared/edit';
import type { Transcript, TranscriptWord } from '../../../shared/types';
import { requireBinary } from '../lib/bin';

const execFile = promisify(execFileCb);
const RATE = 16000;
const STEP = 0.01;
/** A pause this long between sounds is a gap a cut can sit in (stop consonants inside a word are shorter). */
const MIN_GAP = 0.06;
/**
 * How far a cut may reach into a neighbouring word's times: a word longer than its letters need has likely been given
 * part of the gap beside it (up to 0.18 s of it); a word of normal length, barely at all.
 */
const stretch = (w: TranscriptWord) => {
  const letters = w.word.replace(/[^\p{L}\p{N}]/gu, '').length;
  return Math.min(0.18, Math.max(0.04, w.end - w.start - (0.06 * letters + 0.05)));
};

/** How far past a word's edge (by Whisper's times) the pause beside it may start. */
const EDGE = 0.25;
/** A pause this long inside a word's times means Whisper gave that word sound that isn't it (a filler, a breath). */
const INNER_GAP = 0.15;

export type Envelope = { db: Float32Array; quiet: number; seconds: number };

/** The voice's loudness every 10 ms (dB), and the level under which it counts as a pause. */
export async function voiceEnvelope(file: string, signal?: AbortSignal): Promise<Envelope> {
  const { stdout } = await execFile(requireBinary('ffmpeg'), ['-hide_banner', '-nostdin', '-v', 'error', '-i', file, '-map', '0:a:0', '-ac', '1', '-ar', String(RATE), '-f', 'f32le', 'pipe:1'], {
    encoding: 'buffer',
    maxBuffer: 1024 * 1024 * 1024,
    signal,
  });
  const buf = stdout as Buffer;
  const samples = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
  const hop = Math.round(RATE * STEP);
  const n = Math.floor(samples.length / hop);
  const db = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = i * hop; j < (i + 1) * hop; j++) sum += samples[j] * samples[j];
    db[i] = 10 * Math.log10(sum / hop + 1e-12);
  }
  const sorted = Float32Array.from(db).sort();
  const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? -100;
  const floor = pct(0.1);
  const loud = pct(0.9);
  // A third of the way from the room to the voice, and always well under the voice.
  const quiet = Math.min(floor + 0.33 * (loud - floor), loud - 20);
  return { db, quiet, seconds: n * STEP };
}

/** How much louder than `quiet` a soft pause may be: the dip between two words in a noisy voice track. */
const SOFT = 6;

/** Pauses (runs of quiet at least `min` long) between two times, in order; `soft` counts dips a little above quiet. */
export function pauses(env: Envelope, from: number, to: number, min = MIN_GAP, soft = false): [number, number][] {
  const a = Math.max(0, Math.floor(from / STEP));
  const b = Math.min(env.db.length, Math.ceil(to / STEP));
  const level = env.quiet + (soft ? SOFT : 0);
  // A frame is quiet when it and its neighbours mostly are (one loud click doesn't end a pause).
  const isQuiet = (i: number) => {
    let q = 0;
    for (let k = i - 1; k <= i + 1; k++) if (k < 0 || k >= env.db.length || env.db[k] < level) q++;
    return q >= 2;
  };
  const out: [number, number][] = [];
  let start = -1;
  for (let i = a; i <= b; i++) {
    const q = i < b && isQuiet(i);
    if (q && start < 0) start = i;
    if (!q && start >= 0) {
      if ((i - start) * STEP >= min) out.push([start * STEP, i * STEP]);
      start = -1;
    }
  }
  return out;
}

/** The quietest moment between two times (over 30 ms, so one quiet frame inside a word doesn't count). */
function quietest(env: Envelope, from: number, to: number) {
  const a = Math.max(0, Math.floor(from / STEP));
  const b = Math.min(env.db.length - 1, Math.ceil(to / STEP));
  const level = (i: number) => Math.max(env.db[Math.max(0, i - 1)], env.db[i], env.db[Math.min(env.db.length - 1, i + 1)]);
  let best = a;
  for (let i = a; i <= b; i++) if (level(i) < level(best)) best = i;
  return best * STEP;
}

const isSpeech = (env: Envelope, t: number) => (env.db[Math.floor(t / STEP)] ?? -100) >= env.quiet;

/**
 * Word times fitted to the voice: a word whose times hold a real pause keeps only the sound after it (what came before
 * is a filler or a breath Whisper didn't write down), and each word's start and end move in to where its sound is.
 */
/**
 * Pauses by the voice band (150–4000 Hz) against the room's own floor: phone takes whose room tone sits above
 * voiceEnvelope's quiet level (capped at 20 dB under the voice) show no pauses there, but do here.
 */
export async function bandPauses(file: string, min = 0.12): Promise<[number, number][]> {
  const { stdout } = await execFile(requireBinary('ffmpeg'), ['-v', 'error', '-i', file, '-map', '0:a:0', '-ac', '1', '-ar', '16000', '-af', 'highpass=f=150,lowpass=f=4000', '-f', 'f32le', 'pipe:1'], {
    encoding: 'buffer',
    maxBuffer: 1024 * 1024 * 1024,
  });
  const buf = stdout as unknown as Buffer;
  const x = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
  const hop = 160;
  const db = Array.from({ length: Math.floor(x.length / hop) }, (_, i) => {
    let sum = 0;
    for (let j = i * hop; j < (i + 1) * hop; j++) sum += x[j] * x[j];
    return 10 * Math.log10(sum / hop + 1e-12);
  });
  const sorted = db.filter((v) => v > -110).sort((a, b) => a - b);
  const level = (sorted[Math.floor(0.08 * sorted.length)] ?? -100) + 8;
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= db.length; i++) {
    const quiet = i < db.length && [db[i - 1], db[i], db[i + 1]].filter((v) => v === undefined || v < level).length >= 2;
    if (quiet && start < 0) start = i;
    if (!quiet && start >= 0) {
      if ((i - start) / 100 >= min) out.push([start / 100, i / 100]);
      start = -1;
    }
  }
  return out;
}

/**
 * Each word moved out of the pauses beside it (`bandPauses`): Whisper gives a line's first word the silence before it,
 * and on a phone take `refineWords` can't see that silence (the room is louder than its quiet level). A clip cut in that
 * silence lost the word from its captions.
 */
export function fitToPauses(t: Transcript, gaps: [number, number][]): Transcript {
  const segments = t.segments.map((seg) => ({ ...seg, words: seg.words?.map((w) => ({ ...w })) }));
  const words = segments.flatMap((s) => s.words ?? []).sort((x, y) => x.start - y.start);
  let prevEnd = 0;
  for (const w of words) {
    const len = w.end - w.start;
    // Wholly inside a long silence: Whisper slid it (and the line it starts) early. It's said just after the silence.
    const within = gaps.find(([a, b]) => b - a >= 0.3 && a <= w.start + 0.02 && w.end <= b + 0.02);
    if (within) {
      w.start = within[1] - 0.02;
      w.end = w.start + Math.min(len, 0.3);
    } else {
      const before = gaps.find(([a, b]) => a <= w.start + 0.02 && b > w.start && b < w.end - 0.02);
      if (before) w.start = before[1] - 0.02;
      const after = gaps.find(([a, b]) => a > w.start + 0.05 && a < w.end && b >= w.end - 0.02);
      if (after) w.end = after[0] + 0.03;
    }
    // Never before the word ahead of it ends (a moved word pushes the next one along).
    if (w.start < prevEnd && prevEnd < w.end - 0.05) w.start = prevEnd;
    w.start = round(w.start);
    w.end = round(w.end);
    prevEnd = Math.max(prevEnd, w.end);
  }
  return { ...t, segments };
}

export function refineWords(t: Transcript, env: Envelope): Transcript {
  const fit = (w: TranscriptWord): TranscriptWord => {
    let { start, end } = w;
    if (end - start < 0.08) return w;
    const inside = (gaps: [number, number][]) => gaps.filter(([a, b]) => a > start + 0.02 && b < end - 0.04);
    // A real pause first; failing that a soft one, a little longer (a noisy track never goes fully quiet).
    let inner = inside(pauses(env, start, end, INNER_GAP));
    if (!inner.length) inner = inside(pauses(env, start, end, INNER_GAP + 0.03, true));
    if (inner.length) start = inner[inner.length - 1][1] - 0.02;
    // Leading and trailing quiet inside the word's times.
    let s = start;
    while (s < end - 0.05 && !isSpeech(env, s)) s += STEP;
    let e = end;
    while (e > s + 0.05 && !isSpeech(env, e - STEP)) e -= STEP;
    // Nothing loud enough in it (a soft word): leave it as Whisper had it.
    if (e - s < 0.05) return w;
    return { ...w, start: round(Math.max(w.start, s - 0.02)), end: round(Math.min(w.end, e + 0.03)) };
  };
  return { ...t, segments: t.segments.map((seg) => ({ ...seg, words: seg.words?.map(fit) })) };
}

/**
 * Every clip's in and out moved into the pause beside it: in just before the first word's sound (never on what comes
 * before it), out after the last word's sound has died away (never on the next word's first sound). Where a short cut
 * (one tightening made, under 2 s) has no clean pause on one side (words Whisper didn't write down run straight into
 * the kept ones), the words stay and the two shots become one: a cut into sound is worse than a pause. `words` are the
 * media's words (refined), in source time.
 */
export function snapCuts(
  clips: EditClip[],
  mediaId: string,
  env: Envelope,
  words: TranscriptWord[],
  /** Whether two shots may become one again (false for a cut made on purpose: a line taken out). */
  mayJoin: (a: EditClip, b: EditClip) => boolean = () => true,
): EditClip[] {
  const ws = words.filter((w) => w.word.trim()).sort((a, b) => a.start - b.start);
  const mid = (w: TranscriptWord) => (w.start + w.end) / 2;
  const firstWord = (c: EditClip) => ws.findIndex((w) => mid(w) >= c.in && mid(w) < c.out);
  const lastWord = (c: EditClip, from: number) => {
    let last = from;
    for (let j = from; j < ws.length && mid(ws[j]) < c.out; j++) last = j;
    return last;
  };
  // The voice stops soon after a word / starts soon before it: a pause near its edge (word times in a noisy track can
  // be a quarter of a second off), never past the next word or before the one before.
  // A word stretched past what its letters need has the gap inside its times: look there too.
  const outPause = (l: TranscriptWord, to: number) =>
    pauses(env, l.end - 0.05 - stretch(l), to).find((g) => g[0] <= l.end + EDGE && g[0] >= l.start + 0.05) ??
    pauses(env, l.end - 0.05 - stretch(l), to, MIN_GAP, true).find((g) => g[0] <= l.end + EDGE && g[0] >= l.start + 0.05);
  const inPause = (k: TranscriptWord, from: number) => {
    const to = k.start + Math.max(0.05, stretch(k));
    return pauses(env, from, to).findLast((g) => g[1] >= k.start - EDGE && g[1] <= k.end - 0.05) ?? pauses(env, from, to, MIN_GAP, true).findLast((g) => g[1] >= k.start - EDGE && g[1] <= k.end - 0.05);
  };

  // Short cuts with no clean pause either side: keep what's between.
  const merged: EditClip[] = [];
  for (const c of clips) {
    const p = merged[merged.length - 1];
    if (p && p.mediaId === mediaId && c.mediaId === mediaId && c.in > p.out + 0.01 && c.in - p.out < 2 && mayJoin(p, c)) {
      const pf = firstWord(p);
      const k = ws[firstWord(c)];
      const l = pf >= 0 ? ws[lastWord(p, pf)] : undefined;
      if (l && k && (!outPause(l, k.start) || !inPause(k, l.end))) {
        merged[merged.length - 1] = { ...p, out: c.out };
        continue;
      }
    }
    merged.push(c);
  }

  // Where one shot runs straight on into the next (a reframe, not a cut), the join stays where it is.
  const joined = (a: EditClip | undefined, b: EditClip | undefined) => !!a && !!b && a.mediaId === b.mediaId && Math.abs(a.out - b.in) < 0.02;
  const out = merged.map((c, i) => {
    if (c.mediaId !== mediaId) return c;
    const first = firstWord(c);
    // A shot with no whole word in it is only the edge of one: a sound fragment, never worth keeping.
    if (first < 0) return null;
    const last = lastWord(c, first);
    const k = ws[first];
    const before = ws[first - 1];
    const l = ws[last];
    const after = ws[last + 1];

    let inAt = c.in;
    if (!joined(merged[i - 1], c)) {
      const from = Math.max(0, before ? before.end : k.start - 1, k.start - 1.2);
      const g = inPause(k, from);
      if (g) inAt = Math.max(g[0], g[1] - 0.12, before ? before.end : 0);
      else {
        // No pause: the deepest dip just before the word. Whisper's edges can be off, so the dip may sit a little
        // inside the word before's times (a word is loud; the gap between two is where it's quietest).
        const lo = Math.max(0, k.start - EDGE, before ? before.end - stretch(before) : 0);
        inAt = quietest(env, lo, k.start + 0.02);
      }
    }
    let outAt = c.out;
    if (!joined(c, merged[i + 1])) {
      const to = Math.min(env.seconds, after ? after.start + stretch(after) : l.end + 1, l.end + 1.2);
      const g = outPause(l, to);
      if (g) {
        // A little of the pause kept as air, never more than half of it.
        outAt = Math.min(g[1] - 0.03, g[0] + Math.min(0.16, (g[1] - g[0]) * 0.5));
        if (after) outAt = Math.min(outAt, after.start + stretch(after));
      } else {
        const hi = Math.min(env.seconds, l.end + EDGE, after ? after.start + stretch(after) : Infinity);
        outAt = quietest(env, l.end - 0.02, Math.max(l.end, hi));
      }
    }
    if (outAt - inAt < 0.2) return c;
    return { ...c, in: round(inAt), out: round(outAt) };
  });
  const kept = out.filter((c): c is EditClip => !!c);
  return kept.length ? kept : clips;
}

/** Whether a cut lands in sound (for checking a finished edit): the share of its 30 ms either side that's speech. */
export function cutInSpeech(env: Envelope, t: number) {
  let loud = 0;
  for (let x = t - 0.03; x <= t + 0.03; x += STEP) if (isSpeech(env, x)) loud++;
  return loud / 7;
}

const round = (n: number) => Math.round(n * 1000) / 1000;
