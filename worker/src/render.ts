// Draws a render's frames on a home PC: the laptop cut and graded the footage and wrote the composition, and sends the
// project folder as one tar; this unpacks it, renders it with HyperFrames (headless Chrome, frame by frame, then FFmpeg)
// and writes the video. scripts/setup-worker.sh --with render bundles this next to its own HyperFrames install (the
// laptop's exact versions), so `node render.mjs` finds the packages beside it.
//
//   node render.mjs <project.tar> --out <video.mp4> [--fps 30]     prints "@progress 0.41 rendering" lines
//   node render.mjs --install                                       downloads Chrome's headless shell once
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { availableParallelism, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { RENDER_JOB } from '../../shared/compute';

const here = dirname(fileURLToPath(import.meta.url));
const run = promisify(execFile);

/** The headless shell build this HyperFrames' Puppeteer expects, downloaded beside it once. */
async function chrome() {
  const { Browser, computeExecutablePath, install } = await import('@puppeteer/browsers');
  const { PUPPETEER_REVISIONS } = await import('puppeteer-core/internal/revisions.js');
  const buildId = PUPPETEER_REVISIONS['chrome-headless-shell'];
  const cacheDir = join(here, 'chrome');
  const path = computeExecutablePath({ browser: Browser.CHROMEHEADLESSSHELL, buildId, cacheDir });
  if (!existsSync(path)) await install({ browser: Browser.CHROMEHEADLESSSHELL, buildId, cacheDir });
  return path;
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--install') {
    await chrome();
    await writeFile(join(here, '.ready'), new Date().toISOString());
    console.log('The renderer is ready.');
    return;
  }
  const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const project = args[0];
  const out = flag('--out');
  const fps = Number(flag('--fps') ?? 30);
  if (!project || !out || !(fps > 0 && fps <= 60)) throw new Error('Usage: render.mjs <project.tar> --out <video.mp4> [--fps 30]');

  const dir = await mkdtemp(join(tmpdir(), 'cs-render-'));
  const abort = new AbortController();
  process.on('SIGTERM', () => abort.abort());
  process.on('SIGINT', () => abort.abort());
  try {
    // GNU tar drops leading slashes and `..` from member names, so nothing lands outside the folder.
    await run('tar', ['-xf', project, '-C', dir, '--no-same-owner', '--no-same-permissions'], { maxBuffer: 1 << 20 });
    if (!existsSync(join(dir, 'index.html'))) throw new Error('The project has no index.html.');
    // Read by the producer when it loads: set before it's imported.
    process.env.PRODUCER_HEADLESS_SHELL_PATH = await chrome();
    process.env.HYPERFRAMES_EXTRACT_CACHE_DIR = join(here, 'cache');
    process.env.HYPERFRAMES_EXTRACT_CACHE_MAX_MB = '2048';
    // Each capture worker is a Chrome: about one per two threads, as many as the PC has to spare.
    process.env.PRODUCER_MAX_WORKERS = String(Math.max(2, Math.min(8, Math.floor(availableParallelism() / 2))));
    const { createRenderJob, executeRenderJob } = await import('@hyperframes/producer');
    const job = createRenderJob({ ...RENDER_JOB, fps });
    let last = 0;
    await executeRenderJob(
      job,
      dir,
      out,
      (j: { progress: number; currentStage: string }) => {
        const t = Date.now();
        if (t - last < 1000) return;
        last = t;
        console.log(`@progress ${(j.progress / 100).toFixed(3)} ${j.currentStage}`);
      },
      abort.signal,
    );
    console.log('@progress 1 complete');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
