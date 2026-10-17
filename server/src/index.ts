import { existsSync } from 'node:fs';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import Fastify, { LogController } from 'fastify';
import { ZodError } from 'zod';
import { startAnalytics, stopAnalytics } from './analytics/schedule';
import { startCampaignUpkeep, stopCampaignUpkeep } from './campaigns/schedule';
import { startResearch, stopResearch } from './research/schedule';
import { startFinderSchedule, stopFinderSchedule } from './finder/schedule';
import { finderRoutes } from './routes/finder';
import { stopAllSources } from './campaigns/sources';
import { preparePlugin } from './claude/plugin';
import { config } from './config';
import { runMigrations } from './db';
import { registerHandlers } from './jobs/handlers';
import { startWorker, stopWorker } from './jobs/queue';
import { HttpError } from './lib/http';
import { initPush } from './lib/push';
import { startScheduler, stopScheduler } from './publish/scheduler';
import { analyticsRoutes } from './routes/analytics';
import { authRoutes, cookieSecret, isAuthenticated, isWorker } from './routes/auth';
import { computeRoutes } from './routes/compute';
import { aiRoutes } from './routes/ai';
import { voiceRoutes } from './routes/voice';
import { campaignRoutes, submissionRoutes } from './routes/campaigns';
import { researchRoutes } from './routes/research';
import { clippingRoutes } from './routes/clipping';
import { chatRoutes } from './routes/chat';
import { deviceRoutes } from './routes/devices';
import { mediaRoutes } from './routes/media';
import { pieceRoutes } from './routes/pieces';
import { searchRoutes } from './routes/search';
import { publishingRoutes } from './routes/publishing';
import { siteRoutes } from './routes/sites';
import { studioRoutes } from './routes/studio';
import { systemRoutes } from './routes/system';
import { todayRoutes } from './routes/today';
import { uploadRoutes } from './routes/uploads';
import { workspaceRoutes } from './routes/workspaces';

runMigrations();
initPush();
preparePlugin();

const app = Fastify({
  logger: { level: config.isProd ? 'info' : 'warn' },
  // Every request is noise in the app's log file; errors are still logged.
  logController: new LogController({ disableRequestLogging: true }),
  // Only Tailscale (on localhost) talks to us, so trust its forwarded headers for https detection.
  trustProxy: true,
  bodyLimit: 5 * 1024 * 1024,
});

await app.register(cookie, { secret: cookieSecret() });
await app.register(multipart, { limits: { fileSize: 8 * 1024 ** 3, files: 50 } });
// Registered for reply.sendFile (media); serves the built web app in production.
// Wildcard serving (the default) picks up files from new builds without a restart.
await app.register(fastifyStatic, {
  root: existsSync(config.webDist) ? config.webDist : config.dataDir,
  serve: existsSync(config.webDist),
  setHeaders(res, path) {
    // Hashed assets never change; the shell and service worker must always be revalidated.
    if (path.includes('/assets/')) res.header('Cache-Control', 'public, max-age=31536000, immutable');
    else res.header('Cache-Control', 'no-cache');
  },
});

// The Android app's pages come from https://localhost inside the APK and call the API from there with a device token
// (no cookies), so the API answers that origin. (Vite's dev server, for trying the app build in a browser, too.)
const APP_ORIGINS = new Set(['https://localhost', ...(config.isProd ? [] : ['http://localhost:5173'])]);
app.addHook('onRequest', async (req, reply) => {
  const origin = req.headers.origin;
  if (!origin || !APP_ORIGINS.has(origin) || !req.url.startsWith('/api/')) return;
  reply.header('Access-Control-Allow-Origin', origin).header('Vary', 'Origin');
  if (req.method === 'OPTIONS')
    return reply
      .code(204)
      .header('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, PATCH, DELETE')
      .header('Access-Control-Allow-Headers', 'Authorization, Content-Type, Upload-Offset')
      .header('Access-Control-Max-Age', '86400')
      .send();
});

// /api/oauth/ (platform sign-in returns, proven by their one-time state) and /api/public/ (signed media links the
// platforms download) are reached by browsers and servers that aren't signed in.
const PUBLIC_API = ['/api/auth/', '/api/health', '/api/share-target', '/api/oauth/', '/api/public/'];
app.addHook('onRequest', async (req, reply) => {
  if (!req.url.startsWith('/api/') || PUBLIC_API.some((p) => req.url.startsWith(p))) return;
  if (req.url.startsWith('/api/worker/')) {
    if (!isWorker(req)) return reply.code(403).send({ error: 'Only a paired compute worker can call this.' });
    return;
  }
  if (!isAuthenticated(req)) return reply.code(401).send({ error: 'Sign in first.' });
});

app.setErrorHandler((err, req, reply) => {
  if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
  if (err instanceof ZodError) return reply.code(400).send({ error: err.issues[0]?.message ?? 'Invalid request', issues: err.issues });
  const status = (err as { statusCode?: number }).statusCode;
  if (status && status < 500) return reply.code(status).send({ error: (err as Error).message });
  req.log.error(err);
  return reply.code(500).send({ error: 'Something went wrong on the server.' });
});

// The web app is a single-page app: unknown non-API GETs get index.html.
// Missing files (anything with an extension) stay 404s so a stale bundle fails loudly instead of loading HTML.
app.setNotFoundHandler((req, reply) => {
  const path = req.url.split('?')[0];
  const isAppRoute = req.method === 'GET' && !path.startsWith('/api/') && !/\.[a-z0-9]+$/i.test(path);
  if (isAppRoute && existsSync(config.webDist)) return reply.header('Cache-Control', 'no-cache').sendFile('index.html', config.webDist);
  return reply.code(404).send({ error: 'Not found' });
});

await app.register(authRoutes);
await app.register(systemRoutes);
await app.register(workspaceRoutes);
await app.register(pieceRoutes);
await app.register(searchRoutes);
await app.register(mediaRoutes);
await app.register(uploadRoutes);
await app.register(deviceRoutes);
await app.register(chatRoutes);
await app.register(studioRoutes);
await app.register(publishingRoutes);
await app.register(analyticsRoutes);
await app.register(todayRoutes);
await app.register(siteRoutes);
await app.register(campaignRoutes);
await app.register(submissionRoutes);
await app.register(clippingRoutes);
await app.register(researchRoutes);
await app.register(finderRoutes);
await app.register(computeRoutes);
await app.register(aiRoutes);
await app.register(voiceRoutes);

registerHandlers();
startWorker();
startScheduler();
startAnalytics();
startCampaignUpkeep();
startResearch();
startFinderSchedule();

await app.listen({ port: config.port, host: config.host });
console.log(`Content Studio is running on http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);

let stopping = false;
async function shutdown() {
  if (stopping) return;
  stopping = true;
  stopWorker();
  stopScheduler();
  stopAnalytics();
  stopCampaignUpkeep();
  stopResearch();
  stopFinderSchedule();
  stopAllSources();
  await app.close();
  process.exit(0);
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, shutdown);
// The desktop app holds our stdin open; it closes when the app goes away, even if it crashed and couldn't stop us,
// so we don't linger holding the port.
if (process.env.CS_EXIT_WITH_PARENT) {
  process.stdin.on('end', shutdown).on('close', shutdown).on('error', shutdown).resume();
}
