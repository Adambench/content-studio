export function secs(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s)) return '';
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

export function ago(t: number): string {
  const d = (Date.now() - t) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d / 60)} min ago`;
  if (d < 86400) return `${Math.floor(d / 3600)} h ago`;
  if (d < 7 * 86400) return new Date(t).toLocaleDateString([], { weekday: 'short' });
  return new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function bytes(n: number): string {
  if (n < 1024 ** 2) return `${Math.round(n / 1024)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

/** A moment in a video, to a tenth: 0:07.2. */
export function tc(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s)) return '';
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}
