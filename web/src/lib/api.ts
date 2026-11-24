// Talking to the server. In the browser it's the page's own origin (ai-server over Tailscale, or Vite's proxy in
// dev); in the Android app it's the address the phone was paired with, plus its token.

export const isApp = import.meta.env.MODE === 'app';

let server = '';
let token: string | null = null;

export function setConnection(next: { server: string; token: string | null }) {
  server = next.server.replace(/\/$/, '');
  token = next.token;
}

export const serverUrl = () => server || window.location.origin;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(server + path, { method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'), headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined });
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `${res.status} ${res.statusText}`);
  return data as T;
}

/** A media URL (video, still) usable in src: the token rides in the query, since <video> can't send headers. */
export function mediaUrl(path: string): string {
  if (!token) return server + path;
  return `${server}${path}${path.includes('?') ? '&' : '?'}t=${encodeURIComponent(token)}`;
}

/** Live events: the token in the query for the same reason. */
export const eventsUrl = () => mediaUrl('/api/events');

/** One file to a card, with progress (fetch can't report upload progress; XHR can). */
export function uploadFile(cardId: string, file: File, role: string | null, onProgress?: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({ name: file.name, mime: file.type || 'application/octet-stream', ...(role ? { role } : {}) });
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `${server}/api/cards/${cardId}/inputs?${params}`);
    if (token) xhr.setRequestHeader('authorization', `Bearer ${token}`);
    xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new ApiError(xhr.status, (() => { try { return JSON.parse(xhr.responseText).error; } catch { return xhr.statusText; } })())));
    xhr.onerror = () => reject(new ApiError(0, 'Upload failed: the server can’t be reached'));
    xhr.send(file);
  });
}
