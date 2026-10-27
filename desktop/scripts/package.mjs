// Builds everything and packages the desktop app into desktop/release/linux-unpacked.
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(desktopDir, '..');
const stage = join(desktopDir, '.stage');
const release = join(desktopDir, 'release');
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });

run('npm run build -w web');
run('npm run build -w server');
run('npm run build -w desktop');

// The packaged app mirrors the repo layout, so paths work the same in development and when installed.
rmSync(stage, { recursive: true, force: true });
for (const rel of ['desktop/dist', 'desktop/icons', 'server/dist', 'server/drizzle', 'server/scripts', 'server/assets', 'web/dist']) {
  cpSync(join(root, rel), join(stage, rel), { recursive: true });
}
// The skills as a ready-made Claude plugin (the server builds the same folder in its data dir in development).
cpSync(join(root, '.claude/skills'), join(stage, 'claude-plugin/skills'), { recursive: true, dereference: true });
mkdirSync(join(stage, 'claude-plugin/.claude-plugin'), { recursive: true });
writeFileSync(
  join(stage, 'claude-plugin/.claude-plugin/plugin.json'),
  JSON.stringify({ name: 'studio-skills', description: "Content Studio's skills: the playbook and the content skills it builds on", version: '1.0.0' }, null, 2),
);
// For the Toolbox page: where each skill came from, and the app's packages (most are bundled, so their package.json
// files don't ship). Mirrors the development path in server/src/toolbox/inventory.ts.
cpSync(join(root, 'skills-lock.json'), join(stage, 'skills-lock.json'));
const libraryNames = new Set();
for (const ws of ['.', 'server', 'web', 'desktop', 'shared', 'mobile']) {
  const file = join(root, ws, 'package.json');
  if (existsSync(file)) for (const n of Object.keys(JSON.parse(readFileSync(file, 'utf8')).dependencies ?? {})) libraryNames.add(n);
}
const libraries = [...libraryNames].flatMap((name) => {
  const file = join(root, 'node_modules', name, 'package.json');
  if (!existsSync(file)) return [];
  const pkg = JSON.parse(readFileSync(file, 'utf8'));
  const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  const source = pkg.homepage ?? (repo ? String(repo).replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://') : null);
  return [{ name, version: pkg.version, licence: pkg.license ?? null, about: pkg.description ?? '', source }];
});
writeFileSync(join(stage, 'libraries.json'), JSON.stringify(libraries));

/**
 * The server bundle includes everything except packages that find files inside themselves: the Claude Agent SDK
 * (its CLI binary), HyperFrames (runtime, workers), Puppeteer (Chrome downloads) and GSAP (served to compositions).
 * Copy each with its whole dependency tree, resolved the way Node would (nested node_modules first).
 */
const copied = new Set();
function resolvePackage(name, fromDir) {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (dir === root || dir === dirname(dir)) return null;
  }
}
function copyPackage(name, fromDir = root, optional = false) {
  const dir = resolvePackage(name, fromDir);
  if (!dir) {
    if (optional) return;
    throw new Error(`Can't find ${name} (needed from ${fromDir})`);
  }
  if (copied.has(dir)) return;
  copied.add(dir);
  cpSync(dir, join(stage, dir.slice(root.length + 1)), { recursive: true, dereference: true });
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  for (const dep of Object.keys(pkg.dependencies ?? {})) copyPackage(dep, dir);
  // Platform builds (Claude's CLI, sharp's binaries) are optional dependencies; only this machine's are installed.
  for (const dep of Object.keys(pkg.optionalDependencies ?? {})) copyPackage(dep, dir, true);
}
for (const name of ['@anthropic-ai/claude-agent-sdk', '@hyperframes/producer', '@hyperframes/core', 'puppeteer-core', '@puppeteer/browsers', 'gsap']) copyPackage(name);
console.log(`Copied ${copied.size} runtime packages`);
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version ?? '0.1.0';
writeFileSync(
  join(stage, 'package.json'),
  JSON.stringify(
    {
      name: 'content-studio',
      productName: 'Content Studio',
      desktopName: 'content-studio.desktop',
      version,
      description: 'Plan, write, edit and schedule social content with Claude',
      author: 'Content Studio',
      main: 'desktop/dist/main.cjs',
    },
    null,
    2,
  ),
);

const builder = require('electron-builder');
rmSync(join(release, 'linux-unpacked'), { recursive: true, force: true });
await builder.build({
  projectDir: desktopDir,
  targets: builder.Platform.LINUX.createTarget('dir'),
  config: {
    appId: 'app.contentstudio.desktop',
    productName: 'Content Studio',
    executableName: 'content-studio',
    directories: { app: stage, output: release },
    electronVersion: require('electron/package.json').version,
    // Reuse the Electron already downloaded for development instead of fetching it again.
    electronDist: join(root, 'node_modules/electron/dist'),
    // Plain files (no asar archive) so the Claude binary can be executed.
    asar: false,
    npmRebuild: false,
    linux: { icon: join(desktopDir, 'icons/icon.png'), category: 'AudioVideo', executableName: 'content-studio' },
  },
});
// electron-builder only collects declared npm dependencies; the SDK was copied in by hand, so place it the same way.
cpSync(join(stage, 'node_modules'), join(release, 'linux-unpacked/resources/app/node_modules'), { recursive: true });
console.log(`\nPackaged → ${join(release, 'linux-unpacked')}`);
