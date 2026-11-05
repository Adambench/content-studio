const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function timeAgo(ms: number) {
  const diff = (ms - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 45) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 7) return rtf.format(Math.round(diff / 86400), 'day');
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: abs > 86400 * 300 ? 'numeric' : undefined });
}

/** Compact age for tight spaces: "now", "5m", "3h", "2d", then a date. */
export function shortAgo(ms: number) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`;
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const compactFormat = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

/** Counts as people read them: 980, 12.9K, 1.2M. */
export const compact = (n: number | null | undefined) => (n === null || n === undefined ? '–' : compactFormat.format(n));

export const percent = (fraction: number | null | undefined, digits = 1) => (fraction === null || fraction === undefined ? '–' : `${(fraction * 100).toFixed(digits)}%`);

/** How a post compares with a typical one: "2.1×". */
export const times = (score: number | null | undefined) => (score === null || score === undefined ? '–' : `${score >= 10 ? Math.round(score) : score.toFixed(1)}×`);

export function duration(ms: number | null | undefined) {
  if (!ms && ms !== 0) return '';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function clock(seconds: number) {
  return duration(seconds * 1000);
}

export function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

export function resetsIn(ms: number) {
  const mins = Math.max(0, Math.round((ms - Date.now()) / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return mins % 60 ? `${h} h ${mins % 60} min` : `${h} h`;
}

/** A coming time in few characters: "3:00 PM" today, "Tue" this week, then a date. */
export function shortWhen(ms: number) {
  const d = new Date(ms);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (ms - Date.now() < 6 * 86400_000) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const hm = (d: Date) => d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** When a post goes out, short: "18:00" today, "Fri 12:30" this week, then the date and time. */
export function postTime(ms: number) {
  const d = new Date(ms);
  if (d.toDateString() === new Date().toDateString()) return hm(d);
  if (Math.abs(ms - Date.now()) < 6 * 86400_000) return `${d.toLocaleDateString(undefined, { weekday: 'short' })} ${hm(d)}`;
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${hm(d)}`;
}

/** A day, said simply: "Today", "Yesterday", "Tomorrow", a weekday this week, else the date. */
export function dayText(ms: number) {
  const day = (t: number) => Math.floor((t - new Date(t).getTimezoneOffset() * 60_000) / 86400_000);
  const diff = day(ms) - day(Date.now());
  if (diff === 0) return 'Today';
  if (diff === -1) return 'Yesterday';
  if (diff === 1) return 'Tomorrow';
  if (Math.abs(diff) < 6) return new Date(ms).toLocaleDateString(undefined, { weekday: 'short' });
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** "Today 18:00", "Fri 12:30": a post's time in words. */
export const postWhen = (ms: number) => `${dayText(ms)} ${hm(new Date(ms))}`;
