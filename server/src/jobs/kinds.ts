// What each kind of job does: Claude's runs (engine/agent.ts), a look at each new file, a timed test render.

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { runAgent } from '../engine/agent.ts';
import { writeTestProject } from '../engine/compose/test.ts';
import { withGpu } from '../engine/gpu.ts';
import { probe, quickHash, still } from '../engine/media.ts';
import { renderProject } from '../engine/render.ts';
import { now } from '../lib/util.ts';
import { getInput, inputPath, setInputMeta } from '../services/inputs.ts';
import { addThread } from '../services/thread.ts';
import { saveVersion } from '../services/versions.ts';
import { getVideo, videoDir } from '../services/videos.ts';
import { registerJob } from './runner.ts';

/** A small picture of a file, kept out of Claude's way in the video's .studio folder. */
export const thumbPath = (videoId: string, inputId: string) => join(videoDir(getVideo(videoId)), '.studio', 'thumbs', `${inputId}.jpg`);

export function registerJobs() {
  registerJob('agent', runAgent);

  // A new file: what it is (length, size, sound, HDR), a fingerprint, and a still for the Files tab.
  registerJob('look', async (ctx) => {
    const inputId = String(ctx.input.inputId);
    const input = getInput(inputId);
    const path = inputPath(inputId);
    const meta = await probe(path);
    setInputMeta(inputId, meta, await quickHash(path));
    if (input.kind === 'video' || input.kind === 'image') {
      const out = thumbPath(input.videoId, inputId);
      mkdirSync(join(out, '..'), { recursive: true });
      await still(path, out, { at: input.kind === 'video' && meta.duration ? Math.min(1, meta.duration / 3) : 0, hdr: meta.hdr, width: 360 });
    }
  });

  // Measures a render on this machine (title and captions, over a file if given) and saves it as a version.
  registerJob('test-render', async (ctx) => {
    const video = getVideo(ctx.videoId!);
    const seconds = Number(ctx.input.seconds ?? 10);
    const inputId = ctx.input.inputId ? String(ctx.input.inputId) : null;
    const dir = join(videoDir(video), 'work', `test-${now()}`);
    writeTestProject(dir, { seconds, video: inputId ? inputPath(inputId) : undefined });
    const out = join(dir, 'out.mp4');
    const gpu = ctx.input.gpu !== false;
    const { ms } = await withGpu(() => renderProject(dir, out, { gpu, signal: ctx.signal, onProgress: (f, stage) => ctx.progress(f, stage || 'Rendering') }));
    const meta = await probe(out);
    const line = `Rendered ${seconds} s in ${(ms / 1000).toFixed(1)} s (${((seconds * 30) / (ms / 1000)).toFixed(1)} frames a second, ${gpu ? 'NVENC' : 'x264'})`;
    ctx.log(line);
    await saveVersion(video.id, { file: out, note: `Test render, ${seconds} s${inputId ? ' over footage' : ''}` }, ctx.job.id);
    addThread(video.id, 'sys', line, { duration: meta.duration }, ctx.job.id);
  });
}
