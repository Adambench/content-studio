import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from '../campaigns/sources';
import { runToolOn } from '../compute/run';
import { config } from '../config';
import { JobError } from '../jobs/queue';
import { clipToolsInstalled, toolsEnv } from './cliptools';
import { CLONE_VOICE } from '../../../shared/recipe';

/**
 * Speech made on this computer with Kokoro (scripts/tts.py, in the clip tools' Python environment): format videos'
 * narration, messages and characters' lines. No account, no API, nothing leaves the laptop. Lines in the creator's own
 * voice (`clone`, Chatterbox cloning their recording) are made on a home PC: the same script, with the reference.
 */
export const kokoroDir = () => join(config.toolsDir, 'models/kokoro');
export const ttsInstalled = () =>
  clipToolsInstalled() && existsSync(join(kokoroDir(), 'kokoro-v1.0.int8.onnx')) && existsSync(join(kokoroDir(), 'voices-v1.0.bin'));

export type SpeechSegment = { text: string; voice: string; speed: number; pause: number };
export type Speech = { duration: number; segments: { start: number; end: number }[]; fps: number; mouth: string };

/** The creator's recording the cloned voice copies (mono WAV, at most 30 s; Settings → My voice). */
export const voiceReferencePath = () => join(config.dataDir, 'voice', 'reference.wav');
export const hasVoiceReference = () => existsSync(voiceReferencePath());

/** Speak the segments one after another into `outWav` (about 2.5× faster than real time). */
export async function speak(segments: SpeechSegment[], outWav: string, opts: { track?: string; onProgress?: (done: number, total: number) => void } = {}): Promise<Speech> {
  const job = `${outWav}.json`;
  await writeFile(job, JSON.stringify({ segments }));
  const progress = (line: string) => {
    const m = /\[tts\] (\d+)\/(\d+)/.exec(line);
    if (m) opts.onProgress?.(Number(m[1]), Number(m[2]));
  };
  if (segments.some((s) => s.voice === CLONE_VOICE)) {
    if (!hasVoiceReference()) throw new JobError('Record your voice first (Settings → My voice).', { retry: false });
    const { stdout } = await runToolOn('speak', { job, reference: voiceReferencePath(), wav: outWav }, {}, { timeoutMs: 60 * 60_000, track: opts.track, onProgress: progress });
    return JSON.parse(stdout.trim().split('\n').pop() ?? '{}') as Speech;
  }
  const out = await run(config.toolsPython, [join(config.scriptsDir, 'tts.py'), job, '--models', kokoroDir(), '--out', outWav], {
    env: toolsEnv(),
    timeoutMs: 30 * 60_000,
    track: opts.track,
    onLine: progress,
  });
  return JSON.parse(out.trim().split('\n').pop() ?? '{}') as Speech;
}
