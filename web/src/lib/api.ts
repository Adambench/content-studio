import { serverReachable } from './ui-state';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/*
 * Where the API is. The website and the desktop app are served by the server itself (same origin, cookie session).
 * The Android app's pages are bundled in the APK, so it talks to the server it paired with, using its device token
 * (see lib/native.ts).
 */
let base = '';
let token: string | null = null;

export function setConnection(server: string, deviceToken: string | null) {
  base = server.replace(/\/+$/, '');
  token = deviceToken;
}

export const apiUrl = (path: string) => `${base}/api${path}`;
/** The paired server's address in the app (empty on the website and desktop app, which are served by it). */
export const serverOrigin = () => base;

/** A GET URL for things that can't send headers — `<img>`, `<video>`, links, EventSource. The app adds its token. */
export function fileUrl(path: string) {
  const url = apiUrl(path);
  return token ? `${url}${url.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}` : url;
}

export const mediaFileUrl = (id: string) => fileUrl(`/media/${id}/file`);
export const mediaThumbUrl = (id: string) => fileUrl(`/media/${id}/thumb`);

export const authHeaders = (): Record<string, string> => (token ? { Authorization: `Bearer ${token}` } : {});

const reachable = (ok: boolean) => serverReachable.get() !== ok && serverReachable.set(ok);

/** fetch() against the API with the session (cookie or device token); notes whether the server answered. */
export async function apiFetch(path: string, init: RequestInit = {}) {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), { ...init, headers: { ...authHeaders(), ...init.headers }, credentials: token ? 'omit' : 'same-origin' });
  } catch (err) {
    if ((err as Error).name !== 'AbortError') reachable(false);
    throw err;
  }
  reachable(true);
  if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event('app:unauthorized'));
  return res;
}

type Options = { method?: string; body?: unknown; signal?: AbortSignal };

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const isForm = opts.body instanceof FormData;
  let res: Response;
  try {
    res = await apiFetch(path, {
      method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
      headers: opts.body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError(0, token ? 'Can’t reach your computer. Is Content Studio running there?' : 'Can’t reach the server.');
  }
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : undefined;
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string })?.error ?? `Request failed (${res.status})`);
  return data as T;
}

/** Upload with progress (fetch can't report upload progress). */
export function uploadFiles<T>(path: string, files: File[], onProgress?: (fraction: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const f of files) form.append('file', f, f.name);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', apiUrl(path));
    for (const [k, v] of Object.entries(authHeaders())) xhr.setRequestHeader(k, v);
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => (xhr.status < 300 ? resolve(xhr.response as T) : reject(new ApiError(xhr.status, xhr.response?.error ?? 'Upload failed')));
    xhr.onerror = () => reject(new ApiError(0, 'Network error during upload'));
    xhr.send(form);
  });
}

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));
