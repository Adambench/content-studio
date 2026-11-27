// Paired devices. On the tailnet, Tailscale tells the server who's asking; off it (the phone, over Funnel) a paired
// device's token is the only way in. A code is shown on a screen that's already signed in (or `cs pair`), works once
// and lasts 10 minutes; wrong codes are limited, since anyone on the internet can try them.

import { createHash, randomInt } from 'node:crypto';
import { all, get, run } from '../db/db.ts';
import { HttpError, newId, newToken, now } from '../lib/util.ts';

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export function newPairCode(): { code: string; expiresAt: number } {
  run('DELETE FROM pair_codes WHERE expires_at < ?', now());
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const code = Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join('');
  const expiresAt = now() + 10 * 60_000;
  run('INSERT INTO pair_codes (code, expires_at) VALUES (?, ?)', code, expiresAt);
  return { code, expiresAt };
}

const misses: number[] = [];

export function pair(code: string, name: string): { token: string } {
  while (misses.length && misses[0]! < now() - 10 * 60_000) misses.shift();
  if (misses.length >= 10) throw new HttpError(429, 'Too many wrong codes: wait 10 minutes');
  const row = get<{ code: string; expires_at: number }>('SELECT * FROM pair_codes WHERE code = ?', code.trim().toUpperCase());
  if (!row || row.expires_at < now()) {
    misses.push(now());
    throw new HttpError(401, 'That code is wrong or has expired: show a new one');
  }
  run('DELETE FROM pair_codes WHERE code = ?', row.code);
  const token = newToken();
  run('INSERT INTO devices (id, name, token_hash, created_at) VALUES (?, ?, ?, ?)', newId(), name.slice(0, 80) || 'Device', hash(token), now());
  return { token };
}

const seen = new Map<string, number>();

/** The device a bearer token belongs to, or null. Last-seen is written at most once a minute. */
export function deviceFor(token: string): { id: string; name: string } | null {
  const row = get<{ id: string; name: string }>('SELECT id, name FROM devices WHERE token_hash = ?', hash(token));
  if (!row) return null;
  const last = seen.get(row.id) ?? 0;
  if (now() - last > 60_000) {
    seen.set(row.id, now());
    run('UPDATE devices SET last_seen_at = ? WHERE id = ?', now(), row.id);
  }
  return row;
}

export const listDevices = () => all<{ id: string; name: string; created_at: number; last_seen_at: number | null }>('SELECT id, name, created_at, last_seen_at FROM devices ORDER BY created_at DESC');

export function forgetDevice(id: string) {
  run('DELETE FROM devices WHERE id = ?', id);
}
