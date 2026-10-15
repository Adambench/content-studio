// Installs the packaged app for this user: ~/.local/lib/content-studio + an app-menu entry and icons.
// Re-running it updates the app in place (and restarts it if it was running).
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readlinkSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const built = join(desktopDir, 'release/linux-unpacked');
const dest = join(homedir(), '.local/lib/content-studio');
const exe = join(dest, 'content-studio');
const share = process.env.XDG_DATA_HOME ?? join(homedir(), '.local/share');

if (!existsSync(join(built, 'content-studio'))) {
  console.error('Nothing to install — run `npm run package -w desktop` first.');
  process.exit(1);
}

/** PIDs of the installed app's processes (main process and its helpers). */
function runningPids() {
  const pids = [];
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      if (readlinkSync(`/proc/${entry}/exe`).startsWith(dest + '/')) pids.push(Number(entry));
    } catch {
      /* gone or not ours */
    }
  }
  return pids;
}

const wasRunning = runningPids().length > 0;
if (wasRunning) {
  console.log('Closing the running app…');
  for (const pid of runningPids()) {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      /* already exiting */
    }
  }
  const until = Date.now() + 10_000;
  while (runningPids().length && Date.now() < until) execFileSync('sleep', ['0.3']);
  for (const pid of runningPids()) process.kill(pid, 'SIGKILL');
}

// Copy beside the old install, then swap, so a failed copy never leaves a broken app.
mkdirSync(dirname(dest), { recursive: true });
const next = `${dest}.new`;
rmSync(next, { recursive: true, force: true });
cpSync(built, next, { recursive: true, verbatimSymlinks: true });
rmSync(dest, { recursive: true, force: true });
renameSync(next, dest);

const icons = join(desktopDir, 'icons');
for (const size of [48, 64, 128, 256]) {
  const dir = join(share, `icons/hicolor/${size}x${size}/apps`);
  mkdirSync(dir, { recursive: true });
  cpSync(join(icons, `icon-${size}.png`), join(dir, 'content-studio.png'));
}
mkdirSync(join(share, 'icons/hicolor/512x512/apps'), { recursive: true });
cpSync(join(icons, 'icon.png'), join(share, 'icons/hicolor/512x512/apps/content-studio.png'));
mkdirSync(join(share, 'icons/hicolor/scalable/apps'), { recursive: true });
cpSync(join(icons, 'icon.svg'), join(share, 'icons/hicolor/scalable/apps/content-studio.svg'));

mkdirSync(join(share, 'applications'), { recursive: true });
writeFileSync(
  join(share, 'applications/content-studio.desktop'),
  [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Content Studio',
    'GenericName=Social Content Planner',
    'Comment=Plan, write, edit and schedule your TikTok, Instagram and YouTube content with Claude',
    `Exec="${exe}" %U`,
    'Icon=content-studio',
    'Terminal=false',
    'Categories=AudioVideo;Video;Office;',
    'Keywords=social;tiktok;instagram;youtube;reels;shorts;content;video;claude;',
    'StartupWMClass=content-studio',
    'StartupNotify=true',
    '',
  ].join('\n'),
);
for (const [cmd, args] of [
  ['update-desktop-database', [join(share, 'applications')]],
  ['gtk-update-icon-cache', ['-f', '-t', join(share, 'icons/hicolor')]],
]) {
  try {
    execFileSync(cmd, args, { stdio: 'ignore' });
  } catch {
    /* optional helpers */
  }
}

console.log(`Installed Content Studio → ${dest}`);
console.log('Open it from your app menu (search “Content Studio”).');
if (wasRunning) {
  spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
  console.log('Restarted the app.');
}
