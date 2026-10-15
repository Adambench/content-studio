import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { eq, lt } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { API_VERSION, formatPairingCode, normalizePairingCode, pairingLink, type Pairing, type SessionKind } from '../../../shared/devices';
import { config } from '../config';
import { db, newId, now, schema } from '../db';
import { emit } from '../lib/events';
import { HttpError } from '../lib/http';
import { getSetting, setSetting } from '../lib/settings';
import { appVersion } from '../lib/version';

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

const COOKIE = 'cs_session';
const SESSION_MS = 90 * 24 * 60 * 60 * 1000;
// A paired phone stays signed in while it's used: each use pushes this further out.
const DEVICE_MS = 365 * 24 * 60 * 60 * 1000;
const PAIRING_MS = 10 * 60 * 1000;
const MIN_PASSWORD = 10;

type Session = typeof schema.sessions.$inferSelect;

async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verifyPassword(password: string, stored: string) {
  const [, saltB64, keyB64] = stored.split('$');
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  return timingSafeEqual(key, expected);
}

export function cookieSecret() {
  let secret = getSetting('cookieSecret');
  if (!secret) {
    secret = randomBytes(32).toString('base64');
    setSetting('cookieSecret', secret);
  }
  return secret;
}

// Small in-memory brake on password and pairing-code guessing: 10 failures per IP per 15 minutes.
const failures = new Map<string, { count: number; until: number }>();
function checkRate(ip: string) {
  const entry = failures.get(ip);
  if (entry && entry.until > now() && entry.count >= 10) throw new HttpError(429, 'Too many attempts. Try again later.');
}
function recordFailure(ip: string) {
  const entry = failures.get(ip);
  if (!entry || entry.until < now()) failures.set(ip, { count: 1, until: now() + 15 * 60 * 1000 });
  else entry.count++;
}

function startSession(req: FastifyRequest, reply: FastifyReply, kind: SessionKind = 'browser', userAgent?: string) {
  const id = newId();
  db.insert(schema.sessions)
    .values({ id, kind, expiresAt: now() + SESSION_MS, lastSeenAt: now(), userAgent: userAgent ?? req.headers['user-agent'] ?? null })
    .run();
  reply.setCookie(COOKIE, id, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: 'auto',
    signed: true,
    maxAge: SESSION_MS / 1000,
  });
  return id;
}

const tokensMatch = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * GETs the app makes without headers — `<img>`/`<video>` sources, the live-event stream, the video preview and what
 * it loads — may carry the device token as `?access_token=`. Nothing else accepts it, so a leaked media link can't
 * change anything.
 */
const TOKEN_IN_QUERY = [/^\/api\/media\/[^/]+\/(file|thumb|proxy)$/, /^\/api\/events$/, /^\/api\/edits\/[^/]+\/preview\.html$/, /^\/api\/studio\/(vendor|fonts|sfx)\/[^/]+$/];

/** The device token a request carries, if any. */
export function bearerToken(req: FastifyRequest) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim() || null;
  if (req.method !== 'GET' && req.method !== 'HEAD') return null;
  const path = req.url.split('?')[0];
  if (!TOKEN_IN_QUERY.some((re) => re.test(path))) return null;
  const token = (req.query as Record<string, unknown> | undefined)?.access_token;
  return typeof token === 'string' && token ? token : null;
}

const sessionCache = new WeakMap<FastifyRequest, Session | null>();

/** The signed-in session behind a request (cookie or device token), or null. */
export function requestSession(req: FastifyRequest): Session | null {
  if (sessionCache.has(req)) return sessionCache.get(req)!;
  let id: string | null = null;
  const token = bearerToken(req);
  if (token) id = sha256(token);
  else {
    const raw = req.cookies[COOKIE];
    const unsigned = raw ? req.unsignCookie(raw) : null;
    if (unsigned?.valid && unsigned.value) id = unsigned.value;
  }
  let session = id ? (db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get() ?? null) : null;
  if (session && session.expiresAt <= now()) session = null;
  // Note when it was last used (at most every 10 minutes); a device's sign-in lasts a year from then.
  if (session && (session.lastSeenAt ?? 0) < now() - 10 * 60 * 1000) {
    const values = { lastSeenAt: now(), ...(session.kind === 'device' && { expiresAt: now() + DEVICE_MS }) };
    db.update(schema.sessions).set(values).where(eq(schema.sessions.id, session.id)).run();
    session = { ...session, ...values };
  }
  sessionCache.set(req, session);
  return session;
}

export const isAuthenticated = (req: FastifyRequest) => !!requestSession(req);

// ---------- pairing the Android app ----------

// Codes live in memory: a restart simply makes the desktop show a new one.
let pairing: (Pairing & { normalized: string }) | null = null;

/** A new one-time code for the app to pair with (replacing any earlier one). */
export function startPairing(server: string): Pairing {
  const code = formatPairingCode(randomBytes(8));
  pairing = { code, server, link: pairingLink(server, code), expiresAt: now() + PAIRING_MS, normalized: normalizePairingCode(code) };
  const { normalized: _, ...shown } = pairing;
  return shown;
}

export function cancelPairing() {
  pairing = null;
}

export async function authRoutes(app: FastifyInstance) {
  db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, now())).run();

  app.get('/api/auth/status', async (req) => ({
    setupRequired: !getSetting('passwordHash'),
    authenticated: isAuthenticated(req),
    // With the desktop app, the phone password is chosen from the desktop, never by whoever reaches the URL first.
    desktopManaged: !!config.desktopToken,
  }));

  // The desktop app signs itself in with the secret it started the server with.
  app.post('/api/auth/desktop', async (req, reply) => {
    const token = req.headers['x-desktop-token'];
    if (!config.desktopToken || typeof token !== 'string' || !tokensMatch(token, config.desktopToken)) throw new HttpError(403, 'Not allowed.');
    const id = startSession(req, reply, 'desktop', 'Content Studio desktop app');
    return { name: COOKIE, value: reply.signCookie(id), maxAgeSeconds: SESSION_MS / 1000 };
  });

  app.post('/api/auth/setup', async (req, reply) => {
    if (getSetting('passwordHash')) throw new HttpError(409, 'A password is already set.');
    if (config.desktopToken) throw new HttpError(403, 'Set the phone password from the Content Studio app on your computer (Settings → Phone access).');
    const { password } = z.object({ password: z.string() }).parse(req.body);
    if (password.length < MIN_PASSWORD) throw new HttpError(400, `Use at least ${MIN_PASSWORD} characters.`);
    setSetting('passwordHash', await hashPassword(password));
    startSession(req, reply);
    return { ok: true };
  });

  app.post('/api/auth/login', async (req, reply) => {
    checkRate(req.ip);
    const { password } = z.object({ password: z.string() }).parse(req.body);
    const stored = getSetting('passwordHash');
    if (!stored || !(await verifyPassword(password, stored))) {
      recordFailure(req.ip);
      throw new HttpError(401, 'Wrong password.');
    }
    failures.delete(req.ip);
    startSession(req, reply);
    return { ok: true };
  });

  // The Android app trades the code from the desktop's QR for a long-lived device token. Only its hash is stored.
  app.post('/api/auth/pair', async (req) => {
    checkRate(req.ip);
    const body = z.object({ code: z.string().max(40), name: z.string().trim().min(1).max(80).default('Android phone') }).parse(req.body);
    const code = normalizePairingCode(body.code);
    if (!pairing || pairing.expiresAt < now() || !tokensMatch(code, pairing.normalized)) {
      recordFailure(req.ip);
      throw new HttpError(401, 'That code didn’t work. Show a new QR code on your computer (Settings → Phone access) and try again.');
    }
    failures.delete(req.ip);
    pairing = null;
    const token = randomBytes(32).toString('base64url');
    db.insert(schema.sessions)
      .values({ id: sha256(token), kind: 'device', name: body.name, expiresAt: now() + DEVICE_MS, lastSeenAt: now(), userAgent: req.headers['user-agent'] ?? null })
      .run();
    emit({ type: 'changed', entity: 'devices' });
    return { token, api: API_VERSION, version: appVersion };
  });

  // Signs out a browser, or unpairs the device asking.
  app.post('/api/auth/logout', async (req, reply) => {
    const session = requestSession(req);
    if (session) db.delete(schema.sessions).where(eq(schema.sessions.id, session.id)).run();
    if (session?.kind === 'device') emit({ type: 'changed', entity: 'devices' });
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.post('/api/auth/password', async (req) => {
    if (!isAuthenticated(req)) throw new HttpError(401, 'Sign in first.');
    const body = z.object({ current: z.string().optional(), next: z.string() }).parse(req.body);
    const stored = getSetting('passwordHash');
    // Setting the first password needs only a signed-in session (the desktop app); changing one needs the old one.
    if (stored && !(await verifyPassword(body.current ?? '', stored))) throw new HttpError(401, 'Current password is wrong.');
    if (body.next.length < MIN_PASSWORD) throw new HttpError(400, `Use at least ${MIN_PASSWORD} characters.`);
    setSetting('passwordHash', await hashPassword(body.next));
    return { ok: true };
  });
}
