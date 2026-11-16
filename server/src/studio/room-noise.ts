// A take's room noise, taken out before anything makes it louder: a phone a metre away records the voice quietly over
// the room's rumble and hiss, and the final levelling (to −14 LUFS) raises both together (Day 8, 2026-11-15: takes at
// −30 LUFS with the room only 17 dB under the voice came out with it 13 dB under). Measured once per file from its own
// quietest stretch (no model): that stretch is the noise's fingerprint, FFmpeg's afftdn takes it out of the whole take
// and a high-pass takes the rumble under the voice. The cleaned sound is kept beside the file's frames and the render's
// cuts take their sound from it. Only where the edit asks (`audio.denoise`, my own takes) and the take needs it: a
// clean recording, or one with no quiet stretch (a game, a street: nothing to read the noise from), stays as recorded.
import { execFile as execFileCb } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { config } from '../config';
import { requireBinary } from '../lib/bin';
import { mediaPath, type MediaRow } from '../services/media';

const execFile = promisify(execFileCb);

/** The room and the voice (dBFS, RMS), and the quietest stretch the room was read from (seconds of the file). */
export type RoomNoise = { floor: number; voice: number; at: number; length: number };

const RATE = 8000;
const WIN = 0.05;
/** The file's sound from its second 0, whatever its first timestamp: times in the cleaned file are the file's own. */
const FROM_ZERO = 'aresample=48000:async=1:first_pts=0';
const DENOISE = (floor: number) => `afftdn=nr=14:nf=${Math.round(Math.min(-20, Math.max(-80, floor - 6)))}`;
/** The room this far under the voice or more is fine as it is; under 10 dB there is no pause to read it from. */
const CLEAN_ENOUGH = 30;
const NO_PAUSE = 10;
const db = (meanSquare: number) => 10 * Math.log10(Math.max(meanSquare, 1e-12));
const r1 = (n: number) => Math.round(n * 10) / 10;

/** The take's room noise against its voice; null when it has no sound or is too short to say. */
export async function measureNoise(file: string): Promise<RoomNoise | null> {
  const { stdout } = await execFile(requireBinary('ffmpeg'), ['-hide_banner', '-nostdin', '-v', 'error', '-i', file, '-map', '0:a:0', '-af', FROM_ZERO, '-ac', '1', '-ar', String(RATE), '-f', 'f32le', 'pipe:1'], {
    encoding: 'buffer',
    maxBuffer: 1024 * 1024 * 1024,
  }).catch(() => ({ stdout: Buffer.alloc(0) }));
  const buf = stdout as Buffer;
  const n = Math.round(RATE * WIN);
  const count = Math.floor(buf.length / 4 / n);
  if (count < 60) return null;
  const power: number[] = [];
  for (let w = 0; w < count; w++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += buf.readFloatLE((w * n + i) * 4) ** 2;
    power.push(sum / n);
  }
  const sorted = [...power].sort((a, b) => a - b);
  const voice = db(sorted[Math.floor(sorted.length * 0.9)]);
  // The quietest stretch: 1.5 s where the take has one, a shorter pause otherwise.
  for (const length of [1.5, 1, 0.6]) {
    const k = Math.round(length / WIN);
    if (count < k * 3) continue;
    let run = 0;
    let best = Infinity;
    let at = 0;
    for (let w = 0; w < count; w++) {
      run += power[w] - (w >= k ? power[w - k] : 0);
      if (w >= k - 1 && run < best) {
        best = run;
        at = w - k + 1;
      }
    }
    const floor = db(best / k);
    // A real pause is flat: its loudest twentieth of a second isn't speech starting.
    const peak = db(Math.max(...power.slice(at, at + k)));
    if (peak - floor < 6 || length === 0.6) return { floor: r1(floor), voice: r1(voice), at: Math.round(at * WIN * 100) / 100, length };
  }
  return null;
}

/** Whether a take's sound gets cleaned: the room is heard under the voice, and there is a pause to read it from. */
export const needsCleaning = (n: RoomNoise | null): n is RoomNoise => !!n && n.voice - n.floor < CLEAN_ENOUGH && n.voice - n.floor >= NO_PAUSE;

/**
 * The filter graph that cleans a whole take: its quietest stretch goes in front of it, afftdn learns the room from that
 * stretch (a profile it then holds), and the stretch is cut off again, so the profile is on from the first sample.
 */
export function cleanGraph(n: RoomNoise, late: number) {
  const t = (x: number) => x.toFixed(4);
  const rumble = 'highpass=f=110:p=2,highpass=f=110:p=2';
  const learn = `asendcmd=c='0.05 afftdn sn start; ${t(n.length - 0.05)} afftdn sn stop',${DENOISE(n.floor)}`;
  return [
    `[0:a:0]${FROM_ZERO},asplit[room][take]`,
    `[room]atrim=start=${t(n.at)}:end=${t(n.at + n.length)},asetpts=PTS-STARTPTS[first]`,
    // The stretch in front is cut off again, with what afftdn holds the sound back by, and the end padded by as much.
    `[first][take]concat=n=2:v=0:a=1,${rumble},${learn},apad=pad_dur=${t(late)},atrim=start=${t(n.length + late)},asetpts=PTS-STARTPTS[out]`,
  ].join(';');
}

let lateness: Promise<number> | null = null;
/**
 * How long this FFmpeg's afftdn holds the sound back (25 ms on 7.x: its window, which it doesn't give back): a click a
 * second into silence, sent through it, comes out that much later. Measured once a run; cuts would lose lip sync by it.
 */
export function denoiseDelay(): Promise<number> {
  lateness ??= (async () => {
    const rate = 48000;
    const { stdout } = await execFile(
      requireBinary('ffmpeg'),
      ['-hide_banner', '-nostdin', '-v', 'error', '-f', 'lavfi', '-i', `aevalsrc='if(eq(n\,${rate})\,0.9\,0)':s=${rate}:d=2`, '-af', DENOISE(-50), '-f', 'f32le', 'pipe:1'],
      { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 },
    );
    const buf = stdout as Buffer;
    let peak = 0;
    let at = rate;
    for (let i = 0; i < buf.length >> 2; i++) {
      const v = Math.abs(buf.readFloatLE(i * 4));
      if (v > peak) {
        peak = v;
        at = i;
      }
    }
    return Math.max(0, Math.min(0.2, (at - rate) / rate));
  })();
  return lateness;
}

const VERSION = 2;
const kept = (mediaId: string, ext: 'json' | 'flac') => join(config.framesDir, `sound-${mediaId}.${ext}`);
const making = new Map<string, Promise<{ noise: RoomNoise; file: string } | null>>();

/** A take's cleaned sound (a file as long as the take, on its own times), made once and kept; null when it needs none. */
export function quietSoundOf(m: MediaRow): Promise<{ noise: RoomNoise; file: string } | null> {
  if (m.kind !== 'video' && m.kind !== 'audio') return Promise.resolve(null);
  if (!making.has(m.id)) making.set(m.id, make(m).finally(() => making.delete(m.id)));
  return making.get(m.id)!;
}

async function make(m: MediaRow) {
  const cached = await readFile(kept(m.id, 'json'), 'utf8').then((t) => JSON.parse(t) as { v: number; noise: RoomNoise | null; cleaned: boolean }, () => null);
  if (cached?.v === VERSION && (!cached.cleaned || existsSync(kept(m.id, 'flac')))) return cached.cleaned && cached.noise ? { noise: cached.noise, file: kept(m.id, 'flac') } : null;
  const noise = await measureNoise(mediaPath(m));
  const cleaned = needsCleaning(noise);
  if (cleaned) {
    const tmp = `${kept(m.id, 'flac')}.part.flac`;
    await execFile(requireBinary('ffmpeg'), ['-hide_banner', '-nostdin', '-y', '-v', 'error', '-i', mediaPath(m), '-filter_complex', cleanGraph(noise, await denoiseDelay()), '-map', '[out]', '-c:a', 'flac', tmp], { maxBuffer: 20 * 1024 * 1024 });
    await rename(tmp, kept(m.id, 'flac'));
  }
  await writeFile(kept(m.id, 'json'), JSON.stringify({ v: VERSION, noise, cleaned }));
  return cleaned ? { noise, file: kept(m.id, 'flac') } : null;
}

/** In a few words: "room 17 dB under the voice (−44.5 dBFS), cleaned". */
export const noiseText = (n: RoomNoise) => `room ${r1(n.voice - n.floor)} dB under the voice (${n.floor} dBFS, read at ${n.at}–${r1(n.at + n.length)} s)`;
