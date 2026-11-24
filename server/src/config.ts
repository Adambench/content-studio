import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const home = homedir();
const dataDir = resolve(process.env.CONTENT_STUDIO_DATA_DIR || join(home, '.local/share/studio'));
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { version: string };

export const config = {
  version: pkg.version,
  host: process.env.HOST || '127.0.0.1',
  port: Number(process.env.PORT || 8787),
  hostname: hostname(),
  repoRoot,
  dataDir,
  dbFile: join(dataDir, 'studio.sqlite'),
  /**
   * The studio: one folder per brand, one per video inside it (files/, work/, renders/, project.md). Claude Code works
   * in a video's folder and loads ~/studio/CLAUDE.md and the brand's CLAUDE.md by itself.
   */
  studioDir: resolve(process.env.CS_STUDIO_DIR || join(home, 'studio')),
  uploadsDir: join(dataDir, 'uploads'),
  /** Programs and models the engine installs for itself: Python envs, Chrome's headless shell, weights. */
  toolsDir: join(dataDir, 'tools'),
  /** The Claude Agent SDK's working folder (no project settings, no CLAUDE.md). */
  claudeDir: join(dataDir, 'claude'),
  webDist: join(repoRoot, 'web/dist'),
  skillsDir: join(repoRoot, '.claude/skills'),
  keysFile: process.env.CS_KEYS_FILE || join(home, '.config/content-studio/keys.env'),
};

for (const dir of [config.dataDir, config.studioDir, config.uploadsDir, config.toolsDir, config.claudeDir]) {
  mkdirSync(dir, { recursive: true });
}

/**
 * Keys for outside services (Pexels, Pixabay, Freesound), from a KEY=value file kept only on this machine. Read on
 * every call, so a key added to the file works without a restart. Never sent to a client.
 */
export function keys(): Record<string, string> {
  if (!existsSync(config.keysFile)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(config.keysFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[2]) out[m[1]!] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}
