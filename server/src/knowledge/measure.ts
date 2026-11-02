// Measuring a reference video, no model: what changes on screen and when (hard cuts from FFmpeg's scene detection,
// motion from how much each frame differs from the one before), the sound effects (where the sound jumps, in what
// isn't voice), whether they land on those changes, how fast it talks and what happens in the first 3 s. The same
// things the quality score measures on my own edits (shared/quality.ts), so the two compare.
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import type { ReferenceMeasures } from '../../../shared/references';
import { requireBinary } from '../lib/bin';

const execFile = promisify(execFileCb);

/** Frames a second the picture is read at. */
const FPS = 30;
/** The sound's level is read every 10 ms. */
const STEP = 0.01;

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/** How much each frame differs from the one before: the mean difference of a small grey copy (0–255), 30 a second. */
export async function frameDiffs(file: string): Promise<number[]> {
  const vf = `fps=${FPS},scale=160:-2,format=gray,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-`;
  const { stdout } = await execFile(requireBinary('ffmpeg'), ['-v', 'error', '-nostdin', '-i', file, '-an', '-vf', vf, '-f', 'null', '-'], { maxBuffer: 64 * 1024 * 1024, timeout: 10 * 60_000 });
  // The first frame has nothing before it.
  return [0, ...[...stdout.matchAll(/YAVG=([\d.]+)/g)].map((m) => Number(m[1]))];
}

/** Hard cuts (seconds), from FFmpeg's scene detection on a small copy of the picture. */
export async function hardCuts(file: string): Promise<number[]> {
  const { stderr } = await execFile(requireBinary('ffmpeg'), ['-hide_banner', '-nostdin', '-i', file, '-an', '-vf', "scale=320:-2,select='gt(scene,0.32)',showinfo", '-f', 'null', '-'], {
    maxBuffer: 50 * 1024 * 1024,
    timeout: 10 * 60_000,
  });
  return [...stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1]));
}

/** The sound's level every 10 ms (dBFS, mono). */
export async function soundLevels(file: string): Promise<number[]> {
  const { stdout } = await execFile(requireBinary('ffmpeg'), ['-v', 'error', '-nostdin', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-f', 's16le', '-'], { encoding: 'buffer', maxBuffer: 256 * 1024 * 1024, timeout: 10 * 60_000 });
  const n = 160;
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

/**
 * What changes on screen: a cut, or the picture starting to move (or moving much more than just before), at most one
 * every 0.25 s. Motion is the biggest difference within 100 ms of a frame, since animation drawn on twos repeats
 * frames; "moving" is judged against the video's own usual level, so a talking head's small movements don't count.
 */
export function pictureChanges(d: number[], cuts: number[]) {
  const m = d.map((_, i) => Math.max(d[i - 1] ?? 0, d[i], d[i + 1] ?? 0));
  const base = median(m);
  const hi = Math.max(1.5, base * 3);
  const lo = Math.max(0.35, base * 1.5);
  const found: number[] = [];
  for (let i = 1; i < m.length; i++) {
    if (m[i] < hi) continue;
    const before = m.slice(Math.max(0, i - 10), i);
    const avg = before.reduce((a, b) => a + b, 0) / Math.max(1, before.length);
    if (m[i] < avg * 2.5) continue;
    // From where it starts to rise, so a sound on the move's first frame counts.
    let k = i;
    while (k > 0 && i - k < 4 && m[k - 1] >= lo && m[k - 1] < m[k]) k--;
    const at = k / FPS;
    if (!found.length || at - found[found.length - 1] >= 0.25) found.push(at);
  }
  const changes = [...found, ...cuts].sort((a, b) => a - b).filter((t, i, all) => i === 0 || t - all[i - 1] >= 0.2);

  // The longest stretch where the picture stays still.
  let still = { at: 0, seconds: 0 };
  let from = -1;
  for (let i = 0; i <= m.length; i++) {
    const quiet = i < m.length && m[i] < lo;
    if (quiet && from < 0) from = i;
    if (!quiet && from >= 0) {
      if ((i - from) / FPS > still.seconds) still = { at: from / FPS, seconds: (i - from) / FPS };
      from = -1;
    }
  }
  const moving = m.length ? m.filter((v) => v >= lo).length / m.length : 0;
  // Every half second, how much moves (0–1), for the strip on the card.
  const strip: number[] = [];
  for (let i = 0; i < m.length; i += FPS / 2) {
    const part = m.slice(i, i + FPS / 2);
    strip.push(r2(Math.min(1, part.reduce((a, b) => a + b, 0) / part.length / 8)));
  }
  return { changes: changes.map(r2), still: { at: r1(still.at), seconds: r1(still.seconds) }, moving: r2(moving), strip };
}

/**
 * Sound effects: where the sound jumps by 10 dB or more within 150 ms, over a floor, at most one every 0.15 s. Only in
 * `levels` of what isn't voice (Demucs' rest, or a video with no speech); in a mix with a voice, only the hits in
 * the pauses count (syllables jump too).
 */
export function soundHits(levels: number[], pauses?: (t: number) => boolean) {
  const floor = Math.max(-50, median(levels) + 6);
  const out: number[] = [];
  for (let i = 1; i < levels.length; i++) {
    const v = levels[i];
    if (v < floor) continue;
    let low = Infinity;
    for (let k = Math.max(0, i - 15); k < i; k++) low = Math.min(low, levels[k]);
    if (v - low < 10) continue;
    const at = i * STEP;
    if (pauses && !pauses(at)) continue;
    if (!out.length || at - out[out.length - 1] >= 0.15) out.push(r2(at));
  }
  return out;
}

/**
 * Music's beat among the hits: 8 or more on a steady grid (0.25–1.1 s apart, each within 50 ms of it, at least 60 %
 * of its beats hit, no more than 3 missing in a row). Those hits are the music, not sound effects: they're taken out
 * and the beat is returned. The grid that holds the most hits wins, so half or two-thirds of the real beat don't.
 */
export function splitBeat(hits: number[]): { hits: number[]; beat: number | null } {
  const onBeat = new Set<number>();
  let beat: number | null = null;
  for (let round = 0; round < 3; round++) {
    let best: { run: number[]; every: number; score: number } | null = null;
    for (let i = 0; i < hits.length - 1; i++) {
      if (onBeat.has(i)) continue;
      for (let j = i + 1; j <= i + 3 && j < hits.length; j++) {
        let every = hits[j] - hits[i];
        if (every < 0.25 || every > 1.1) continue;
        const run = [i];
        let last = 0;
        for (let k = i + 1; k < hits.length; k++) {
          if (onBeat.has(k)) continue;
          const d = hits[k] - hits[i];
          const n = Math.round(d / every);
          if (n - last > 4) break;
          if (n <= last || Math.abs(d - n * every) > 0.05) continue;
          run.push(k);
          last = n;
          // The grid follows the hits, so a slightly wrong first gap doesn't drift.
          if (n >= 2) every = d / n;
        }
        const fill = run.length / (last + 1);
        if (run.length < 8 || fill < 0.6) continue;
        const score = run.length * fill;
        if (!best || score > best.score) best = { run, every, score };
      }
    }
    if (!best) break;
    for (const k of best.run) onBeat.add(k);
    beat ??= Math.round(best.every * 100) / 100;
  }
  return { hits: hits.filter((_, k) => !onBeat.has(k)), beat };
}

/** A bed under everything (music, or a constant ambience) in what isn't voice: the share of the time it's well above silence. */
export function bedShare(levels: number[]) {
  if (!levels.length) return 0;
  let on = 0;
  let windows = 0;
  for (let i = 0; i < levels.length; i += 10) {
    const part = levels.slice(i, i + 10);
    const rms = 10 * Math.log10(part.reduce((a, v) => a + 10 ** (v / 10), 0) / part.length);
    if (rms > -42) on++;
    windows++;
  }
  return on / windows;
}

/**
 * Voice with no words: the share of the pauses between words (half a second or more, their edges left out) where the
 * voice track stays well above silence: humming, voices without words, a vocal bed. Levels are 10 ms apart.
 */
export function voiceInPauses(levels: number[], words: { start: number; end: number }[]) {
  const gaps: [number, number][] = [];
  for (let i = 1; i < words.length; i++) if (words[i].start - words[i - 1].end >= 0.5) gaps.push([words[i - 1].end + 0.15, words[i].start - 0.15]);
  let on = 0;
  let all = 0;
  for (const [a, b] of gaps)
    for (let t = a; t + 0.1 <= b; t += 0.1) {
      const part = levels.slice(Math.floor(t * 100), Math.floor(t * 100) + 10);
      if (!part.length) continue;
      const rms = 10 * Math.log10(part.reduce((x, v) => x + 10 ** (v / 10), 0) / part.length);
      if (rms > -45) on++;
      all++;
    }
  return all >= 10 ? Math.round((on / all) * 100) / 100 : null;
}

/** A sound lands on a change when it's from 0.12 s before to 0.25 s after it (as the quality score counts). */
const onChange = (sound: number, change: number) => sound >= change - 0.12 && sound <= change + 0.25;

export type MeasureInput = {
  seconds: number;
  width: number;
  height: number;
  diffs: number[];
  cuts: number[];
  /** The sound with no voice (Demucs' rest, or the whole sound when nothing is said); null without one. */
  rest: number[] | null;
  /** The whole sound, when `rest` is null. */
  mix: number[] | null;
  /** The voice alone (Demucs' vocals), for what sounds in the pauses between words; null without it. */
  voice?: number[] | null;
  words: { start: number; end: number; text: string }[];
};

export function measure(input: MeasureInput): ReferenceMeasures {
  const { seconds, words } = input;
  const pic = pictureChanges(input.diffs, input.cuts);
  const speaking = (t: number) => words.some((w) => t >= w.start - 0.1 && t <= w.end + 0.1);
  const { hits: sounds, beat } = splitBeat(input.rest ? soundHits(input.rest) : input.mix ? soundHits(input.mix, (t) => !speaking(t)) : []);
  const bed = input.rest ? bedShare(input.rest) : null;
  const per10 = (n: number) => (seconds > 0 ? r1((n / seconds) * 10) : 0);
  const changes = pic.changes;
  const first = (xs: number[]) => xs.filter((t) => t < 3).length;
  const firstWord = words[0] ?? null;
  return {
    seconds: r1(seconds),
    width: input.width,
    height: input.height,
    cuts: input.cuts.map(r2),
    cutsPerSecond: seconds > 0 ? r2(input.cuts.length / seconds) : 0,
    changes,
    changesPer10: per10(changes.length),
    longestStill: pic.still,
    moving: pic.moving,
    motion: pic.strip,
    sounds,
    soundsPer10: per10(sounds.length),
    soundOnChange: changes.length ? r2(changes.filter((c) => sounds.some((s) => onChange(s, c))).length / changes.length) : null,
    soundsOnChanges: sounds.length ? r2(sounds.filter((s) => changes.some((c) => onChange(s, c))).length / sounds.length) : null,
    soundsFrom: input.rest ? 'rest' : input.mix ? 'pauses' : 'none',
    background: bed === null ? null : bed > 0.6 ? 'bed' : bed > 0.3 ? 'some' : 'none',
    voiceBed: input.voice ? voiceInPauses(input.voice, words) : null,
    beat,
    words: words.length,
    wordsPerSecond: words.length && seconds > 0 ? r1(words.length / seconds) : null,
    firstWordAt: firstWord ? r2(firstWord.start) : null,
    firstWords: words
      .filter((w) => w.start < 3)
      .map((w) => w.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200),
    hook: { changes: first(changes), sounds: first(sounds), firstChangeAt: changes.length ? changes[0] : null },
  };
}
