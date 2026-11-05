// The Android app: pairing, paired devices and the API version both sides check.

/**
 * Bumped when the API changes in a way an older app can't work with (or the other way round). `/api/health` reports
 * it and the app compares it with its own. 2: edits have a nasheed track instead of music (an older app saving an edit
 * would drop it) and the music asset type is gone. 3: edits have camera moves, colour looks, textures, caption fonts and
 * many more transitions, caption presets, graphics, layouts and animations (an older app saving an edit would drop them).
 * 4: Phase 14: the phone only writes scripts and sends footage to a video; Ideas, captures and saved posts are gone.
 */
export const API_VERSION = 4;

export type Health = { ok: true; api: number; version: string };

/** Browsers and the desktop app sign in with a cookie; a paired device (the Android app) with a bearer token. A compute worker (a home PC, shared/compute.ts) pairs the same way
 * but may only call /api/worker/. */
export type SessionKind = 'browser' | 'desktop' | 'device' | 'worker';

export type PairedDevice = {
  id: string;
  name: string;
  createdAt: number;
  lastSeenAt: number | null;
  /** This is the device asking. */
  current: boolean;
  /** It gets notifications (has an FCM token). */
  push: boolean;
};

/** A one-time pairing code the desktop shows as a QR code. */
export type Pairing = { code: string; server: string; link: string; expiresAt: number };

export const PAIRING_SCHEME = 'contentstudio';

export const pairingLink = (server: string, code: string) => `${PAIRING_SCHEME}://pair?server=${encodeURIComponent(server)}&code=${code}`;

/**
 * The app's own links (contentstudio://pair?…, contentstudio://capture): what they open and their parameters. Parsed
 * by hand: older WebViews give custom-scheme URLs no host.
 */
export function appLink(text: string): { target: string; params: URLSearchParams } | null {
  const m = /^contentstudio:\/\/([^/?#]*)\/?(?:\?([^#]*))?/i.exec(text.trim());
  return m ? { target: m[1].toLowerCase(), params: new URLSearchParams(m[2] ?? '') } : null;
}

// Crockford's base32: no I, L, O or U, so a code read off a screen can't be mistyped as another.
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 12 characters (60 bits) shown as XXXX-XXXX-XXXX. */
export function formatPairingCode(bytes: Uint8Array) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < 12) {
      out += CODE_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out.match(/.{4}/g)!.join('-');
}

/** Upper-case, without separators, with the letters people confuse for digits mapped back. */
export const normalizePairingCode = (code: string) =>
  code
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/(.{4})(?=.)/g, '$1-');

/** Read a scanned or pasted pairing link. Also takes "<address> <code>" typed by hand. */
export function parsePairingLink(text: string): { server: string; code: string } | null {
  const trimmed = text.trim();
  const link = appLink(trimmed);
  if (link) {
    const server = normalizeServer(link.params.get('server') ?? '');
    const code = normalizePairingCode(link.params.get('code') ?? '');
    return link.target === 'pair' && server && code.length === 14 ? { server, code } : null;
  }
  // Not a link: "<address> <code>".
  const [address, ...rest] = trimmed.split(/\s+/);
  const server = normalizeServer(address ?? '');
  const code = normalizePairingCode(rest.join(''));
  return server && code.length === 14 ? { server, code } : null;
}

/** `laptop.tail1234.ts.net` → `https://laptop.tail1234.ts.net`; null if it isn't an address. */
export function normalizeServer(input: string) {
  const value = input.trim().replace(/\/+$/, '');
  if (!value) return null;
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(value) ? value : `https://${value}`);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}
