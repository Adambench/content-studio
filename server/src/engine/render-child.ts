// The render process (see render.ts): node render-child.ts <projectDir> <out> <fps> <quality> <gpu|cpu>
// The format follows the file: .mp4, or .mov / .webm with transparency (overlays for FFmpeg to lay on footage).
// Prints "@progress 0.412 <stage>" lines; exits 0 when the file is written.

const [projectDir, out, fps, quality, device] = process.argv.slice(2);
if (!projectDir || !out) {
  console.error('usage: render-child.ts <projectDir> <out.mp4|.mov|.webm> <fps> <quality> <gpu|cpu>');
  process.exit(2);
}

const abort = new AbortController();
process.on('SIGTERM', () => abort.abort());
process.on('SIGINT', () => abort.abort());

try {
  // The producer reads its environment (Chrome's path, workers) when it loads, so it's imported after the parent set it.
  const { createRenderJob, executeRenderJob } = await import('@hyperframes/producer');
  const job = createRenderJob({
    fps: Number(fps) || 30,
    quality: (quality as 'draft' | 'standard' | 'high') || 'standard',
    format: out.endsWith('.mov') ? 'mov' : out.endsWith('.webm') ? 'webm' : 'mp4',
    useGpu: device !== 'cpu',
    strictness: 'best-effort',
    entryFile: 'index.html',
  } as Parameters<typeof createRenderJob>[0]);
  let last = 0;
  await executeRenderJob(
    job,
    projectDir,
    out,
    (j: { progress: number; currentStage?: string }) => {
      const t = Date.now();
      if (t - last < 1000) return;
      last = t;
      console.log(`@progress ${(j.progress / 100).toFixed(3)} ${j.currentStage ?? ''}`);
    },
    abort.signal,
  );
  console.log('@progress 1 complete');
  process.exit(0);
} catch (err) {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
}
