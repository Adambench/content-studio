import { existsSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { Browser, computeExecutablePath, install } from '@puppeteer/browsers';
import { PUPPETEER_REVISIONS } from 'puppeteer-core/internal/revisions.js';
import { config } from '../config';
import { emit } from '../lib/events';

/**
 * HyperFrames renders by driving Chrome's headless shell frame by frame. We download the exact build its Puppeteer
 * expects into the data folder (about 100 MB, once), like Whisper, so app updates don't wipe it.
 */
const BUILD_ID = PUPPETEER_REVISIONS['chrome-headless-shell'];

export type RendererInstall = { state: 'idle' | 'installing' | 'done' | 'error'; message: string };

let status: RendererInstall = { state: 'idle', message: '' };
let installing: Promise<string> | null = null;

export const rendererPath = () => computeExecutablePath({ browser: Browser.CHROMEHEADLESSSHELL, buildId: BUILD_ID, cacheDir: config.rendererDir });
export const rendererInstalled = () => existsSync(rendererPath());
export const rendererInstallStatus = () => status;

function update(next: RendererInstall) {
  status = next;
  emit({ type: 'changed', entity: 'settings' });
}

/** Path to the renderer's browser, downloading it first if needed. */
export function ensureRenderer(onProgress?: (fraction: number) => void): Promise<string> {
  if (rendererInstalled()) return Promise.resolve(rendererPath());
  installing ??= (async () => {
    update({ state: 'installing', message: 'Downloading the video renderer…' });
    let lastPct = -1;
    try {
      await install({
        browser: Browser.CHROMEHEADLESSSHELL,
        buildId: BUILD_ID,
        cacheDir: config.rendererDir,
        downloadProgressCallback: (done, total) => {
          const pct = total ? Math.floor((done / total) * 100) : 0;
          if (pct === lastPct) return;
          lastPct = pct;
          onProgress?.(pct / 100);
          if (pct % 5 === 0) update({ state: 'installing', message: `Downloading the video renderer… ${pct}%` });
        },
      });
      await removeOldBuilds();
      update({ state: 'done', message: 'Video renderer is ready.' });
      return rendererPath();
    } catch (err) {
      update({ state: 'error', message: `Couldn’t download the video renderer: ${err instanceof Error ? err.message : String(err)}` });
      throw err;
    } finally {
      installing = null;
    }
  })();
  return installing;
}

/** When HyperFrames moves to a newer Chrome, the old one is dead weight. */
async function removeOldBuilds() {
  const dir = join(config.rendererDir, Browser.CHROMEHEADLESSSHELL);
  for (const entry of await readdir(dir).catch(() => [])) {
    if (!entry.endsWith(BUILD_ID)) await rm(join(dir, entry), { recursive: true, force: true });
  }
}
