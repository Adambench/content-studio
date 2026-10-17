import { execFile as execFileCb } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import type { FastifyInstance } from 'fastify';
import { listWorkers } from '../compute/workers';
import { config } from '../config';
import { newId } from '../db';
import { requireBinary } from '../lib/bin';
import { emit } from '../lib/events';
import { probe } from '../lib/ffmpeg';
import { badRequest, notFound } from '../lib/http';
import { hasVoiceReference, voiceReferencePath } from '../services/tts';

const execFile = promisify(execFileCb);

/** Settings → My voice: the recording the cloned voice copies (Chatterbox uses its first ~10 s). */
export async function voiceRoutes(app: FastifyInstance) {
  app.get('/api/voice', async () => {
    const ref = hasVoiceReference() ? await stat(voiceReferencePath()) : null;
    const seconds = ref ? ((await probe(voiceReferencePath())).durationMs ?? 0) / 1000 : 0;
    return {
      reference: ref ? { seconds: Math.round(seconds * 10) / 10, updatedAt: Math.round(ref.mtimeMs) } : null,
      workers: listWorkers()
        .filter((w) => w.online && w.tools.includes('speak'))
        .map((w) => w.name),
    };
  });

  app.get('/api/voice/reference.wav', async (_req, reply) => {
    if (!hasVoiceReference()) throw notFound('No recording yet');
    reply.header('Cache-Control', 'no-store');
    return reply.type('audio/wav').sendFile(basename(voiceReferencePath()), dirname(voiceReferencePath()));
  });

  // One audio file: kept as mono 24 kHz WAV, its first 30 s, with silence at the ends trimmed.
  app.post('/api/voice/reference', async (req) => {
    const file = await req.file();
    if (!file) throw badRequest('Send one audio file.');
    if (!/^(audio|video)\//.test(file.mimetype)) throw badRequest('That isn’t an audio file.');
    const tmp = join(config.tmpDir, `voice-${newId()}`);
    await mkdir(config.tmpDir, { recursive: true });
    const out = `${tmp}.wav`;
    try {
      await pipeline(file.file, createWriteStream(tmp));
      const trim = 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse';
      await execFile(requireBinary('ffmpeg'), ['-hide_banner', '-nostdin', '-y', '-v', 'error', '-i', tmp, '-vn', '-af', trim, '-ac', '1', '-ar', '24000', '-t', '30', out], { timeout: 120_000 });
      const seconds = ((await probe(out)).durationMs ?? 0) / 1000;
      if (seconds < 5) throw badRequest(`That’s ${seconds.toFixed(1)} s of speech: record 10–30 s of you talking.`);
      await mkdir(dirname(voiceReferencePath()), { recursive: true });
      await rename(out, voiceReferencePath());
      emit({ type: 'changed', entity: 'settings' });
      return { seconds: Math.round(seconds * 10) / 10 };
    } finally {
      await rm(tmp, { force: true });
      await rm(out, { force: true });
    }
  });

  app.delete('/api/voice/reference', async () => {
    await rm(voiceReferencePath(), { force: true });
    emit({ type: 'changed', entity: 'settings' });
    return { ok: true };
  });
}
