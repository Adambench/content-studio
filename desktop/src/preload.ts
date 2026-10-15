import { contextBridge, ipcRenderer } from 'electron';

/** The small, explicit bridge the web app gets when it runs inside the desktop app (window.desktop). */
const desktop = {
  isDesktop: true as const,
  getStartAtLogin: (): Promise<{ enabled: boolean; available: boolean }> => ipcRenderer.invoke('login-item:get'),
  setStartAtLogin: (on: boolean): Promise<boolean> => ipcRenderer.invoke('login-item:set', on),
  openDataFolder: (): Promise<string> => ipcRenderer.invoke('open-data-folder'),
  signIn: (): Promise<void> => ipcRenderer.invoke('sign-in'),
  notify: (n: { title: string; body: string; url?: string }): Promise<void> => ipcRenderer.invoke('notify', n),
  onNavigate(callback: (path: string) => void) {
    const listener = (_e: unknown, path: string) => callback(path);
    ipcRenderer.on('navigate', listener);
    return () => void ipcRenderer.off('navigate', listener);
  },
};

contextBridge.exposeInMainWorld('desktop', desktop);

export type DesktopBridge = typeof desktop;
