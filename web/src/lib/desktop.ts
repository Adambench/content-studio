/** Present when running inside the Content Studio desktop app (see desktop/src/preload.ts). */
export type DesktopBridge = {
  isDesktop: true;
  getStartAtLogin(): Promise<{ enabled: boolean; available: boolean }>;
  setStartAtLogin(on: boolean): Promise<boolean>;
  openDataFolder(): Promise<string>;
  signIn(): Promise<void>;
  notify(n: { title: string; body: string; url?: string }): Promise<void>;
  onNavigate(callback: (path: string) => void): () => void;
};

export const desktop = (window as unknown as { desktop?: DesktopBridge }).desktop;
export const isDesktop = !!desktop;
