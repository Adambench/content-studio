import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, session, shell, Tray, type MenuItemConstructorOptions } from 'electron';

const APP_NAME = 'Content Studio';
const PORT = Number(process.env.PORT ?? 8787);
const SERVER_URL = `http://127.0.0.1:${PORT}`;
// `npm run dev` points the window at Vite and runs the server itself (with hot reload).
const DEV_URL = process.env.DEV_URL;
const APP_URL = DEV_URL ?? SERVER_URL;
const APP_ORIGIN = new URL(APP_URL).origin;

// Same layout in the repo and in the packaged app: <root>/desktop/dist/main.cjs.
const root = join(__dirname, '../..');
const dataDir = process.env.CONTENT_STUDIO_DATA_DIR ?? join(process.env.XDG_DATA_HOME ?? join(homedir(), '.local/share'), 'content-studio');
const iconPath = join(root, 'desktop/icons/icon.png');
const trayIconPath = join(root, 'desktop/icons/tray.png');
const autostartFile = join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'autostart/content-studio.desktop');
// A fresh secret each launch; only this process and the server it starts know it.
const desktopToken = process.env.DESKTOP_TOKEN ?? randomBytes(32).toString('hex');

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let server: ChildProcess | null = null;
let quitting = false;

app.setName(APP_NAME);
// A second launch (e.g. clicking the launcher again) just brings the existing window forward.
const isFirstInstance = app.requestSingleInstanceLock();
if (!isFirstInstance) app.quit();
app.on('second-instance', () => showWindow());

// ---------- server ----------

function portIsFree(port: number) {
  return new Promise<boolean>((resolve) => {
    const probe = createServer()
      .once('error', () => resolve(false))
      .once('listening', () => probe.close(() => resolve(true)))
      .listen(port, '127.0.0.1');
  });
}

const crashes: number[] = [];

function startServer() {
  mkdirSync(join(dataDir, 'logs'), { recursive: true });
  const log = createWriteStream(join(dataDir, 'logs/server.log'), { flags: 'a' });
  log.write(`\n--- ${new Date().toISOString()} starting ---\n`);
  server = spawn(process.execPath, [join(root, 'server/dist/server.mjs')], {
    env: {
      ...process.env,
      // Run Electron's binary as plain Node for the server.
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      PORT: String(PORT),
      DESKTOP_TOKEN: desktopToken,
      APP_RESOURCES: root,
      CONTENT_STUDIO_DATA_DIR: dataDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout?.pipe(log);
  server.stderr?.pipe(log);
  server.on('exit', (code, signal) => {
    log.write(`--- server exited (code ${code}, signal ${signal}) ---\n`);
    server = null;
    if (quitting) return;
    const now = Date.now();
    crashes.push(now);
    while (crashes.length && now - crashes[0] > 60_000) crashes.shift();
    if (crashes.length > 4) {
      dialog.showErrorBox(APP_NAME, `The background server keeps stopping. Details are in:\n${join(dataDir, 'logs/server.log')}`);
      return;
    }
    setTimeout(startServer, 1000 * crashes.length);
  });
}

async function waitFor(url: string, timeoutMs = 45_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`${url} didn’t respond`);
}

/** Get a session from the server with the shared secret and hand its cookie to the window. */
async function signIn() {
  const res = await fetch(`${SERVER_URL}/api/auth/desktop`, { method: 'POST', headers: { 'x-desktop-token': desktopToken } });
  if (!res.ok) throw new Error(`Desktop sign-in failed (${res.status})`);
  const cookie = (await res.json()) as { name: string; value: string; maxAgeSeconds: number };
  await session.defaultSession.cookies.set({
    url: APP_URL,
    name: cookie.name,
    value: cookie.value,
    httpOnly: true,
    sameSite: 'lax',
    expirationDate: Math.floor(Date.now() / 1000) + cookie.maxAgeSeconds,
  });
}

// ---------- window ----------

type WindowState = { x?: number; y?: number; width: number; height: number; maximized?: boolean };
const stateFile = join(dataDir, 'window.json');

function loadWindowState(): WindowState {
  try {
    return { width: 1440, height: 900, ...JSON.parse(readFileSync(stateFile, 'utf8')) };
  } catch {
    return { width: 1440, height: 900 };
  }
}

function saveWindowState() {
  if (!win || win.isDestroyed()) return;
  const bounds = win.getNormalBounds();
  try {
    writeFileSync(stateFile, JSON.stringify({ ...bounds, maximized: win.isMaximized() }));
  } catch {
    /* not critical */
  }
}

function isAppUrl(url: string) {
  try {
    return new URL(url).origin === APP_ORIGIN;
  } catch {
    return false;
  }
}

function createWindow() {
  const state = loadWindowState();
  win = new BrowserWindow({
    ...state,
    minWidth: 900,
    minHeight: 600,
    title: APP_NAME,
    icon: iconPath,
    backgroundColor: '#0c0c10',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  if (state.maximized) win.maximize();

  win.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden')) win?.show();
  });
  win.on('resize', saveWindowState);
  win.on('move', saveWindowState);
  // Closing the window keeps the app running in the tray, so background work (and later, scheduled posts) continues.
  win.on('close', (e) => {
    saveWindowState();
    if (quitting) return;
    e.preventDefault();
    win?.hide();
    firstHideNotice();
  });

  const wc = win.webContents;
  // Links to other sites open in the normal browser; the window only ever shows the app.
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url) && !isAppUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (!isAppUrl(url)) {
      e.preventDefault();
      if (/^https?:/.test(url)) void shell.openExternal(url);
    }
  });
  wc.on('context-menu', (_e, params) => {
    const items: MenuItemConstructorOptions[] = [];
    for (const word of params.dictionarySuggestions.slice(0, 5)) items.push({ label: word, click: () => wc.replaceMisspelling(word) });
    if (params.misspelledWord) items.push({ label: 'Add to dictionary', click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord) }, { type: 'separator' });
    if (params.linkURL && !isAppUrl(params.linkURL)) items.push({ label: 'Open link in browser', click: () => void shell.openExternal(params.linkURL) }, { type: 'separator' });
    if (params.isEditable) items.push({ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' });
    else if (params.selectionText) items.push({ role: 'copy' });
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win! });
  });

  // CS_OPEN_PATH opens a specific page first (handy for testing).
  void win.loadURL(new URL(process.env.CS_OPEN_PATH ?? '/', APP_URL).toString());
  if (process.env.CS_SCREENSHOT) scheduleScreenshot(process.env.CS_SCREENSHOT);
}

function showWindow(path?: string) {
  if (!win) return;
  if (path && isAppUrl(new URL(path, APP_URL).toString())) win.webContents.send('navigate', path);
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

let hideNoticeShown = false;
function firstHideNotice() {
  const marker = join(dataDir, '.tray-notice-shown');
  if (hideNoticeShown || existsSync(marker)) return;
  hideNoticeShown = true;
  writeFileSync(marker, '');
  new Notification({ title: APP_NAME, body: 'Still running in the tray so background work keeps going. Quit from the tray icon.', icon: iconPath }).show();
}

/** Debug aid: CS_SCREENSHOT=/path/shot.png saves what the window shows once it has loaded. */
function scheduleScreenshot(file: string) {
  win?.webContents.once('did-finish-load', () => {
    setTimeout(async () => {
      const image = await win!.webContents.capturePage();
      writeFileSync(file, image.toPNG());
      if (process.env.CS_SCREENSHOT_QUIT) quit();
    }, Number(process.env.CS_SCREENSHOT_DELAY ?? 3000));
  });
}

// ---------- tray & start at login ----------

const startsAtLogin = () => existsSync(autostartFile);

function setStartAtLogin(on: boolean) {
  if (!app.isPackaged) return false; // a dev build has no stable path to launch
  if (on) {
    mkdirSync(join(autostartFile, '..'), { recursive: true });
    writeFileSync(
      autostartFile,
      ['[Desktop Entry]', 'Type=Application', `Name=${APP_NAME}`, `Exec="${process.execPath}" --hidden`, 'Icon=content-studio', 'X-GNOME-Autostart-enabled=true', ''].join('\n'),
    );
  } else rmSync(autostartFile, { force: true });
  updateTrayMenu();
  return startsAtLogin();
}

function updateTrayMenu() {
  tray?.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Open ${APP_NAME}`, click: () => showWindow() },
      { label: 'Capture an idea', click: () => showWindow('/capture') },
      { type: 'separator' },
      { label: 'Start at login', type: 'checkbox', checked: startsAtLogin(), enabled: app.isPackaged, click: (item) => setStartAtLogin(item.checked) },
      { label: 'Open data folder', click: () => void shell.openPath(dataDir) },
      { type: 'separator' },
      { label: `Quit ${APP_NAME}`, click: quit },
    ]),
  );
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(trayIconPath));
  tray.setToolTip(APP_NAME);
  tray.on('click', () => showWindow());
  updateTrayMenu();
}

function quit() {
  quitting = true;
  app.quit();
}

// ---------- IPC for the web app (see preload.ts) ----------

function registerIpc() {
  ipcMain.handle('login-item:get', () => ({ enabled: startsAtLogin(), available: app.isPackaged }));
  ipcMain.handle('login-item:set', (_e, on: boolean) => setStartAtLogin(!!on));
  ipcMain.handle('open-data-folder', () => shell.openPath(dataDir));
  ipcMain.handle('sign-in', () => signIn());
  ipcMain.handle('notify', (_e, n: { title: string; body: string; url?: string }) => {
    const notification = new Notification({ title: String(n.title).slice(0, 120), body: String(n.body).slice(0, 300), icon: iconPath });
    notification.on('click', () => showWindow(n.url));
    notification.show();
  });
}

// ---------- startup ----------

app.on('before-quit', () => {
  quitting = true;
});

app.on('will-quit', (e) => {
  if (!server) return;
  // Give the server a moment to finish what it's writing.
  e.preventDefault();
  const child = server;
  const force = setTimeout(() => child.kill('SIGKILL'), 4000);
  child.once('exit', () => {
    clearTimeout(force);
    server = null;
    app.quit();
  });
  child.kill('SIGTERM');
});

app.whenReady().then(async () => {
  if (!isFirstInstance) return;
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'editMenu' },
      { label: 'View', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }, ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' } as const])] },
    ]),
  );
  // Only the app's own pages get the microphone (idea capture) and notifications.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(isAppUrl(wc.getURL()) && ['media', 'notifications', 'clipboard-sanitized-write', 'fullscreen'].includes(permission));
  });
  registerIpc();

  try {
    if (!DEV_URL) {
      if (!(await portIsFree(PORT))) {
        dialog.showErrorBox(APP_NAME, `Port ${PORT} is already in use — probably another copy of Content Studio started from a terminal. Close it and open the app again.`);
        return quit();
      }
      startServer();
    }
    await waitFor(`${SERVER_URL}/api/health`);
    if (DEV_URL) await waitFor(DEV_URL);
    await signIn();
  } catch (err) {
    dialog.showErrorBox(APP_NAME, `Couldn’t start: ${(err as Error).message}\n\nDetails are in ${join(dataDir, 'logs/server.log')}`);
    return quit();
  }
  createTray();
  createWindow();
});

// Keep running in the tray when the window is closed.
app.on('window-all-closed', () => {});
