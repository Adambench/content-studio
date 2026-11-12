// A camera take's own light, put right before any look goes on: a room lit by a warm bulb comes out orange, a dim one
// dull. Measured once per file from sixteen of its frames (no model): the average colour of the mid-tones says which
// way the light leans. A well-lit talking head leans a little warm itself (skin, wood, lamps), so most of what's past
// that natural lean is taken out, never the lean itself; a dim take is lifted, at most a stop. The result is a LUT kept beside the file's frames, so every render of that take wears the same fix.
// Only clips on the main track get it (`grade.light`): a screenshot or a screen recording is never "corrected".
import { execFile as execFileCb } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config';
import { requireBinary } from '../lib/bin';
import { probe, TONEMAP } from '../lib/ffmpeg';
import { mediaPath, type MediaRow } from '../services/media';

const execFile = promisify(execFileCb);

/** What multiplies each of red, green and blue (in linear light), and the lift on top. */
export type LightFix = { gain: [number, number, number]; expo: number; /** The take's average colour and middle brightness (0–1), as measured. */ was: { colour: [number, number, number]; middle: number } };

/**
 * Where red, green and blue sit against the picture's brightness in well-lit talking heads (the middle of three graded
 * ones measured 2026-11-12: red 1.07–1.29, blue 0.66–0.91), and how much of the way there a take is brought.
 */
const LEAN = [1.12, 0.97, 0.85];
const STRENGTH = 0.8;
/** The middle brightness a talking head should have at least; under it the take is lifted. */
const MIDDLE = 0.4;
const W = 48;
const H = 86;
const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const enc = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** The fix a file's light needs; null when it's fine as it is (within 6 % on every colour, bright enough). */
export async function measureLight(file: string): Promise<LightFix | null> {
  const info = await probe(file);
  const seconds = Math.max(1, (info.durationMs ?? 0) / 1000);
  const vf = [info.hdr && TONEMAP, `fps=${(16 / seconds).toFixed(4)}`, `scale=${W}:${H}`].filter(Boolean).join(',');
  const { stdout } = await execFile(requireBinary('ffmpeg'), ['-hide_banner', '-nostdin', '-v', 'error', '-i', file, '-vf', vf, '-frames:v', '16', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
  const buf = stdout as Buffer;
  const frames = Math.floor(buf.length / (W * H * 3));
  if (!frames) return null;
  const sum = [0, 0, 0];
  let n = 0;
  const middles: number[] = [];
  for (let f = 0; f < frames; f++)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = (f * W * H + y * W + x) * 3;
        const [r, g, b] = [lin(buf[i] / 255), lin(buf[i + 1] / 255), lin(buf[i + 2] / 255)];
        const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        // The lean is read off the mid-tones (a lamp in shot or a black corner says nothing about the light).
        if (Y > 0.01 && Y < 0.8) {
          sum[0] += r;
          sum[1] += g;
          sum[2] += b;
          n++;
        }
        // Brightness, where the person is: the middle of the frame.
        if (x > W * 0.2 && x < W * 0.8 && y > H * 0.25 && y < H * 0.75) middles.push(enc(Y));
      }
  if (!n) return null;
  const mean = sum.map((v) => v / n);
  const grey = 0.2126 * mean[0] + 0.7152 * mean[1] + 0.0722 * mean[2];
  let gain = mean.map((m, c) => Math.min(1.4, Math.max(0.72, ((LEAN[c] * grey) / Math.max(m, 1e-4)) ** STRENGTH)));
  // The same brightness after as before: the colours trade, the light stays.
  const after = 0.2126 * gain[0] * mean[0] + 0.7152 * gain[1] * mean[1] + 0.0722 * gain[2] * mean[2];
  gain = gain.map((g) => r3((g * grey) / after));
  middles.sort((a, b) => a - b);
  const middle = middles[middles.length >> 1] ?? MIDDLE;
  const expo = r3(Math.min(2, Math.max(1, lin(MIDDLE) / Math.max(lin(middle), 1e-4))));
  if (gain.every((g) => Math.abs(g - 1) <= 0.06) && expo < 1.06) return null;
  return { gain: gain as [number, number, number], expo, was: { colour: mean.map((v) => r3(enc(v))) as [number, number, number], middle: r3(middle) } };
}

/** The fix as a 33-point LUT (.cube): gains and lift in linear light, bright parts rolled off instead of clipped. */
export function lightCubeText(fix: LightFix) {
  const shoulder = (v: number) => (v <= 0.7 ? v : 0.7 + 0.3 * Math.tanh((v - 0.7) / 0.3));
  const N = 33;
  const lines = ['TITLE "Light fix"', `LUT_3D_SIZE ${N}`];
  for (let b = 0; b < N; b++)
    for (let g = 0; g < N; g++)
      for (let r = 0; r < N; r++)
        lines.push([r, g, b].map((v, c) => Math.min(1, Math.max(0, enc(shoulder(Math.min(4, lin(v / (N - 1)) * fix.gain[c] * fix.expo))))).toFixed(5)).join(' '));
  return `${lines.join('\n')}\n`;
}

const VERSION = 2;
const kept = (mediaId: string, ext: 'json' | 'cube') => join(config.framesDir, `light-${mediaId}.${ext}`);

/** A take's fix and its LUT file, measured once and kept; null when its light is fine (or it isn't a video). */
export async function lightOf(m: MediaRow): Promise<{ fix: LightFix; cube: string } | null> {
  if (m.kind !== 'video') return null;
  const cached = await readFile(kept(m.id, 'json'), 'utf8').then((t) => JSON.parse(t) as { v: number; fix: LightFix | null }, () => null);
  if (cached?.v === VERSION) return cached.fix ? { fix: cached.fix, cube: kept(m.id, 'cube') } : null;
  const fix = await measureLight(mediaPath(m));
  if (fix) await writeFile(kept(m.id, 'cube'), lightCubeText(fix));
  await writeFile(kept(m.id, 'json'), JSON.stringify({ v: VERSION, fix }));
  return fix ? { fix, cube: kept(m.id, 'cube') } : null;
}

/** A fix in a few words: "red ×0.82, green ×1.06, blue ×1.37". */
export const lightText = (fix: LightFix) => `red ×${fix.gain[0]}, green ×${fix.gain[1]}, blue ×${fix.gain[2]}${fix.expo > 1.01 ? `, lifted ×${fix.expo}` : ''}`;
