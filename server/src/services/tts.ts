import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from '../campaigns/sources';
import { config } from '../config';
import { clipToolsInstalled, toolsEnv } from './cliptools';

/**
 * Speech made on this computer with Kokoro (scripts/tts.py, in the clip tools' Python environment): format videos'
 * narration, messages and characters' lines. No account, no API, nothing leaves the laptop.
 */
export const kokoroDir = () => join(config.toolsDir, 'models/kokoro');
export const ttsInstalled = () =>
  clipToolsInstalled() && existsSync(join(kokoroDir(), 'kokoro-v1.0.int8.onnx')) && existsSync(join(kokoroDir(), 'voices-v1.0.bin'));

export type SpeechSegment = { text: string; voice: string; speed: number; pause: number };
export type Speech = { duration: number; segments: { start: number; end: number }[]; fps: number; mouth: string };

/** Speak the segments one after another into `outWav` (about 2.5× faster than real time). */
export async function speak(segments: SpeechSegment[], outWav: string, opts: { track?: string; onProgress?: (done: number, total: number) => void } = {}): Promise<Speech> {
  const job = `${outWav}.json`;
  await writeFile(job, JSON.stringify({ segments }));
  const out = await run(config.toolsPython, [join(config.scriptsDir, 'tts.py'), job, '--models', kokoroDir(), '--out', outWav], {
    env: toolsEnv(),
    timeoutMs: 30 * 60_000,
    track: opts.track,
    onLine: (line) => {
      const m = /^\[tts\] (\d+)\/(\d+)/.exec(line);
      if (m) opts.onProgress?.(Number(m[1]), Number(m[2]));
    },
  });
  return JSON.parse(out.trim().split('\n').pop() ?? '{}') as Speech;
}
