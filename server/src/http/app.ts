import { existsSync } from 'node:fs';
import { join } from 'node:path';
import cors from '@fastify/cors';
import staticFiles from '@fastify/static';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { config } from '../config.ts';
import { HttpError } from '../lib/util.ts';
import { deviceFor } from '../services/devices.ts';
import { registerApi } from './routes.ts';
import { registerTerminal } from './terminal.ts';

/**
 * Who may talk to the app. It listens on 127.0.0.1 only; Tailscale Serve puts it on the tailnet over HTTPS and
 * tells it who's asking (Tailscale-User-Login), so the laptop and the phone need nothing else. Paired devices send a
 * token (the Android upload queue). A process on this machine talking to it directly is me too. Funnel (the public
 * internet) never gets in.
 */
export function allowed(req: FastifyRequest): boolean {
  const h = req.headers;
  if (h['tailscale-funnel-request']) return false;
  if (h['tailscale-user-login']) return true;
  const bearer = typeof h.authorization === 'string' && h.authorization.startsWith('Bearer ') ? h.authorization.slice(7) : null;
  const queryToken = (req.query as Record<string, string> | undefined)?.t;
  if (bearer && deviceFor(bearer)) return true;
  if (queryToken && deviceFor(queryToken)) return true;
  const remote = req.socket.remoteAddress ?? '';
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote) && !h['x-forwarded-for'];
}

const OPEN = new Set(['/api/health', '/api/pair']);

export async function buildApp() {
  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024, trustProxy: true });

  await app.register(cors, {
    // The Android app's pages come from https://localhost; the dev UI from Vite.
    origin: ['https://localhost', 'capacitor://localhost', 'http://localhost', 'http://localhost:5173', 'http://127.0.0.1:5173'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Upload-Offset'],
  });

  // Uploads come as a raw body (a file, or a chunk of one): handed on as a stream, never buffered.
  app.addContentTypeParser('*', (_req, payload, done) => done(null, payload));

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const path = req.url.split('?')[0] ?? '';
    if (req.method === 'OPTIONS' || OPEN.has(path) || !(path.startsWith('/api/') || path.startsWith('/media/'))) return;
    if (!allowed(req)) {
      reply.code(401).send({ error: 'Not signed in: open the app over Tailscale or pair this device' });
    }
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) return reply.code(400).send({ error: err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') });
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: (err as Error).message });
    console.error('[http]', err);
    return reply.code(500).send({ error: (err as Error).message || 'Something went wrong' });
  });

  const hasWeb = existsSync(join(config.webDist, 'index.html'));
  await app.register(staticFiles, { root: hasWeb ? config.webDist : config.dataDir, serve: hasWeb, wildcard: false, decorateReply: true });

  await registerTerminal(app);
  await registerApi(app);

  // The UI is one page: any other GET that isn't the API is the app.
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && hasWeb && !req.url.startsWith('/api/') && !req.url.startsWith('/media/')) return reply.sendFile('index.html', config.webDist);
    return reply.code(404).send({ error: 'Not found' });
  });

  return app;
}
