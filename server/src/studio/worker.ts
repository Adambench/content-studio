// Runs one HyperFrames render in a child process the server forks, so headless Chrome, frame buffers and any crash
// stay out of the server. Reports progress over IPC; SIGTERM (or the server going away) cancels.
import { createRenderJob, executeRenderJob } from '@hyperframes/producer';

/** `fps` defaults to the edit's 30; previews of a scene use fewer. */
export type WorkerRequest = { projectDir: string; output: string; fps?: number };
export type WorkerMessage =
  | { type: 'progress'; progress: number; stage: string }
  | { type: 'done'; warnings: string[] }
  | { type: 'error'; message: string };

const request = JSON.parse(process.argv[2] ?? '{}') as WorkerRequest;
const abort = new AbortController();
process.on('SIGTERM', () => abort.abort());
process.on('disconnect', () => abort.abort());
const send = (m: WorkerMessage) => process.send?.(m);

try {
  const job = createRenderJob({ fps: request.fps ?? 30, quality: 'standard', crf: 17, format: 'mp4', hdrMode: 'force-sdr', strictness: 'best-effort', useGpu: true });
  let last = 0;
  await executeRenderJob(
    job,
    request.projectDir,
    request.output,
    (j) => {
      const t = Date.now();
      if (t - last < 500) return;
      last = t;
      send({ type: 'progress', progress: j.progress / 100, stage: j.currentStage });
    },
    abort.signal,
  );
  send({ type: 'done', warnings: job.warnings.map((w) => w.message) });
  process.exit(0);
} catch (err) {
  send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  process.exit(1);
}
