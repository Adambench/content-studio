// Renders a HyperFrames project to MP4 in its own process (Chrome's headless shell draws each frame, FFmpeg
// encodes). A child process so a cancel can stop it outright and a crash can't take the server down.

import { existsSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import { Browser, computeExecutablePath, install } from '@puppeteer/browsers';
import { config } from '../config.ts';
import { run, searchPath } from '../lib/proc.ts';

const CHROME_DIR = join(config.toolsDir, 'chrome');

async function chromeBuild(): Promise<string> {
  const { PUPPETEER_REVISIONS } = (await import('puppeteer-core/internal/revisions.js')) as { PUPPETEER_REVISIONS: Record<string, string> };
  return PUPPETEER_REVISIONS['chrome-headless-shell']!;
}

/** Chrome's headless shell, the exact build HyperFrames' Puppeteer expects, downloaded once (about 100 MB). */
export async function ensureChrome(onProgress?: (fraction: number) => void): Promise<string> {
  const buildId = await chromeBuild();
  const path = computeExecutablePath({ browser: Browser.CHROMEHEADLESSSHELL, buildId, cacheDir: CHROME_DIR });
  if (existsSync(path)) return path;
  await install({ browser: Browser.CHROMEHEADLESSSHELL, buildId, cacheDir: CHROME_DIR, downloadProgressCallback: (done, total) => onProgress?.(total ? done / total : 0) });
  return path;
}

export async function chromeInstalled(): Promise<boolean> {
  return existsSync(computeExecutablePath({ browser: Browser.CHROMEHEADLESSSHELL, buildId: await chromeBuild(), cacheDir: CHROME_DIR }));
}

export type RenderOptions = {
  fps?: number;
  /** Encode on the GPU (NVENC on the 1070); off falls back to x264. */
  gpu?: boolean;
  workers?: number;
  quality?: 'draft' | 'standard' | 'high';
  signal?: AbortSignal;
  onProgress?: (fraction: number, stage: string) => void;
};

/** Render `projectDir`/index.html to `out`. Resolves with how long it took. */
export async function renderProject(projectDir: string, out: string, opts: RenderOptions = {}): Promise<{ ms: number }> {
  const chrome = await ensureChrome();
  const started = Date.now();
  const workers = opts.workers ?? Math.max(2, Math.min(8, Math.floor(availableParallelism() / 2)));
  await run(
    process.execPath,
    [join(import.meta.dirname, 'render-child.ts'), projectDir, out, String(opts.fps ?? 30), opts.quality ?? 'standard', opts.gpu === false ? 'cpu' : 'gpu'],
    {
      signal: opts.signal,
      env: {
        PATH: searchPath(),
        PRODUCER_HEADLESS_SHELL_PATH: chrome,
        PRODUCER_MAX_WORKERS: String(workers),
        HYPERFRAMES_EXTRACT_CACHE_DIR: join(config.workDir, 'hf-cache'),
        HYPERFRAMES_EXTRACT_CACHE_MAX_MB: '4096',
        // No telemetry from a private machine.
        HYPERFRAMES_TELEMETRY: '0',
        DO_NOT_TRACK: '1',
      },
      onLine: (line) => {
        const m = line.match(/^@progress (\d(?:\.\d+)?) ?(.*)$/);
        if (m) opts.onProgress?.(Number(m[1]), m[2] ?? '');
      },
    },
  );
  return { ms: Date.now() - started };
}
