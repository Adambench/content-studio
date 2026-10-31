import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Where the app's own files live. The desktop app passes APP_RESOURCES (its install folder); in development
 * it's the repository root, found relative to this file.
 */
const resourcesDir = resolve(process.env.APP_RESOURCES ?? join(dirname(fileURLToPath(import.meta.url)), '../..'));
const dataDir = resolve(process.env.CONTENT_STUDIO_DATA_DIR ?? join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local/share'), 'content-studio'));
// The skills as a Claude plugin: shipped with the packaged app, built from `.claude/skills` in development.
const packagedPluginDir = join(resourcesDir, 'claude-plugin');
const devPluginDir = join(dataDir, 'claude-plugin');

export const config = {
  isProd: process.env.NODE_ENV === 'production',
  port: Number(process.env.PORT ?? 8787),
  // Loopback only: Tailscale Funnel proxies to localhost, so nothing else should reach the port.
  host: process.env.HOST ?? '127.0.0.1',
  /** Shared secret with the desktop app, which uses it to sign itself in. Unset when running without it. */
  desktopToken: process.env.DESKTOP_TOKEN || null,
  resourcesDir,
  webDist: join(resourcesDir, 'web/dist'),
  migrationsDir: join(resourcesDir, 'server/drizzle'),
  scriptsDir: join(resourcesDir, 'server/scripts'),
  // Fonts and other files the video studio ships with.
  assetsDir: join(resourcesDir, 'server/assets'),
  dataDir,
  dbFile: join(dataDir, 'content-studio.sqlite'),
  mediaDir: join(dataDir, 'media'),
  thumbsDir: join(dataDir, 'thumbs'),
  transcriptsDir: join(dataDir, 'transcripts'),
  framesDir: join(dataDir, 'frames'),
  // Browser-friendly copies of footage for the video studio's preview.
  proxiesDir: join(dataDir, 'proxies'),
  // Working folders of renders in progress (removed when they finish).
  rendersDir: join(dataDir, 'renders'),
  // The headless Chrome that HyperFrames renders with, downloaded on first use.
  rendererDir: join(dataDir, 'renderer'),
  cacheDir: join(dataDir, 'cache'),
  tmpDir: join(dataDir, 'tmp'),
  // References' frames (the first one and a contact sheet), a folder each.
  referencesDir: join(dataDir, 'references'),
  logsDir: join(dataDir, 'logs'),
  // Claude's working directory (sessions are stored per cwd). Its only file tool, Read, is limited to the skills.
  claudeDir: join(dataDir, 'claude'),
  skillsSource: join(resourcesDir, '.claude/skills'),
  pluginDir: existsSync(join(packagedPluginDir, '.claude-plugin/plugin.json')) ? packagedPluginDir : devPluginDir,
  devPluginDir,
  // Skills I install from the Toolbox, as a second plugin (studio-added): outside the app, so updates keep them.
  addedPluginDir: join(dataDir, 'skills-added'),
  // Claude Code's own skills (every project) and the skills CLI's record of where they came from.
  claudeCodeSkillsDir: join(homedir(), '.claude/skills'),
  skillsCliLock: join(homedir(), '.agents/.skill-lock.json'),
  // Campaigns' long source videos and their transcripts (sources/<campaign>/), apart from the pages' libraries.
  sourcesDir: join(dataDir, 'sources'),
  // Whisper's Python environment lives with the data so app updates don't wipe it.
  whisperVenv: join(dataDir, 'whisper'),
  whisperPython: join(dataDir, 'whisper/bin/python'),
  // The clip tools (Demucs, OpenCV's YuNet, gdown) and their models: a Python environment installed from Settings.
  toolsDir: join(dataDir, 'tools'),
  toolsPython: join(dataDir, 'tools/bin/python'),
  vapidSubject: process.env.VAPID_SUBJECT ?? 'mailto:content-studio@example.com',
};

for (const dir of [config.dataDir, config.mediaDir, config.thumbsDir, config.transcriptsDir, config.framesDir, config.proxiesDir, config.rendersDir, config.cacheDir, config.tmpDir, config.logsDir, config.claudeDir, config.sourcesDir, config.referencesDir]) {
  mkdirSync(dir, { recursive: true });
}
