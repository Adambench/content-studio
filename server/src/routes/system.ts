import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { and, eq, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { SOURCE_RETENTION_DAYS } from '../../../shared/campaigns';
import { DEFAULT_WEEKLY_REVIEW } from '../../../shared/analytics';
import { API_VERSION, type Health } from '../../../shared/devices';
import { config } from '../config';
import { db, newId, schema } from '../db';
import { emit, subscribe } from '../lib/events';
import { fcmSetting, fcmReady, parseGoogleServices, parseServiceAccount } from '../lib/fcm';
import { badRequest } from '../lib/http';
import { notify, vapidKeys } from '../lib/push';
import { getSetting, setSetting } from '../lib/settings';
import { openSse } from '../lib/sse';
import { appVersion } from '../lib/version';
import { findBinary } from '../lib/bin';
import { clipToolsInstalled, clipToolsInstallStatus, installClipTools } from '../services/cliptools';
import { ttsInstalled } from '../services/tts';
import { whisperInstalled } from '../services/media';
import { installWhisper, whisperInstallStatus } from '../services/whisper';
import { ensureRenderer, rendererInstalled, rendererInstallStatus } from '../studio/browser';
import { requestSession } from './auth';

function fcmStatus() {
  const { serviceAccount, app } = fcmSetting();
  return { projectId: serviceAccount?.projectId ?? app?.projectId ?? null, clientEmail: serviceAccount?.clientEmail ?? null, serviceAccount: !!serviceAccount, app: !!app };
}

export async function systemRoutes(app: FastifyInstance) {
  // The Android app checks the API version here before anything else (and to see whether the computer is reachable).
  app.get('/api/health', async (): Promise<Health> => ({ ok: true, api: API_VERSION, version: appVersion }));

  // One stream per open tab: tells the UI what changed so it can refetch.
  app.get('/api/events', async (req, reply) => {
    const sse = openSse(reply);
    const unsubscribe = subscribe((event) => sse.send(event));
    sse.onClose(unsubscribe);
  });

  app.get('/api/settings', async () => ({
    defaultModel: getSetting('defaultModel') ?? 'opus',
    whisperModel: getSetting('whisperModel') ?? 'small',
    lastWorkspaceId: getSetting('lastWorkspaceId') ?? null,
    claudeUsage: getSetting('claudeUsage') ?? null,
    vapidPublicKey: vapidKeys().publicKey,
    weeklyReview: { ...DEFAULT_WEEKLY_REVIEW, ...getSetting('weeklyReview') },
    sourceRetentionDays: getSetting('sourceRetentionDays') ?? SOURCE_RETENTION_DAYS,
  }));

  app.patch('/api/settings', async (req) => {
    const body = z
      .object({
        defaultModel: z.enum(['sonnet', 'opus', 'haiku']).optional(),
        whisperModel: z.enum(['base', 'small', 'medium']).optional(),
        lastWorkspaceId: z.string().optional(),
        sourceRetentionDays: z.number().int().min(0).max(365).optional(),
        weeklyReview: z
          .object({ enabled: z.boolean(), day: z.number().int().min(0).max(6), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) })
          .partial()
          .optional(),
      })
      .parse(req.body);
    if (body.defaultModel) setSetting('defaultModel', body.defaultModel);
    if (body.whisperModel) setSetting('whisperModel', body.whisperModel);
    if (body.lastWorkspaceId) setSetting('lastWorkspaceId', body.lastWorkspaceId);
    if (body.sourceRetentionDays !== undefined) setSetting('sourceRetentionDays', body.sourceRetentionDays);
    if (body.weeklyReview) setSetting('weeklyReview', { ...DEFAULT_WEEKLY_REVIEW, ...getSetting('weeklyReview'), ...body.weeklyReview });
    emit({ type: 'changed', entity: 'settings' });
    return { ok: true };
  });

  app.get('/api/system/status', async () => ({
    ffmpeg: !!findBinary('ffmpeg') && !!findBinary('ffprobe'),
    python: !!findBinary('python3'),
    whisper: whisperInstalled(),
    whisperInstall: whisperInstallStatus(),
    clipTools: clipToolsInstalled(),
    tts: ttsInstalled(),
    clipToolsInstall: clipToolsInstallStatus(),
    renderer: rendererInstalled(),
    rendererInstall: rendererInstallStatus(),
    desktop: !!config.desktopToken,
    dataDir: config.dataDir,
    // The Agent SDK reuses Claude Code's login on this machine.
    claudeLogin: existsSync(join(homedir(), '.claude', '.credentials.json')) || !!process.env.CLAUDE_CODE_OAUTH_TOKEN,
    pushDevices: db.select({ id: schema.pushSubscriptions.id }).from(schema.pushSubscriptions).all().length,
    fcm: fcmReady(),
  }));

  app.post('/api/system/whisper/install', async () => installWhisper());
  app.post('/api/system/clip-tools/install', async () => installClipTools());

  // Renders download it on first use anyway; this lets Settings fetch it ahead of time.
  app.post('/api/system/renderer/install', async () => {
    ensureRenderer().catch(() => {});
    return rendererInstallStatus();
  });

  // A browser's Web Push subscription, or the Android app's FCM token (tied to its device, so unpairing stops it).
  app.post('/api/push/subscribe', async (req) => {
    const body = z
      .union([
        z.object({ kind: z.literal('fcm'), token: z.string().min(10).max(4096) }),
        z.object({ endpoint: z.string().url(), keys: z.object({ p256dh: z.string(), auth: z.string() }) }),
      ])
      .parse(req.body);
    const values =
      'kind' in body
        ? { kind: 'fcm' as const, endpoint: body.token, p256dh: '', auth: '', sessionId: requestSession(req)?.id ?? null }
        : { kind: 'webpush' as const, endpoint: body.endpoint, p256dh: body.keys.p256dh, auth: body.keys.auth };
    // A device has one FCM token at a time; a new one replaces the last.
    if (values.kind === 'fcm' && values.sessionId)
      db.delete(schema.pushSubscriptions)
        .where(and(eq(schema.pushSubscriptions.sessionId, values.sessionId), ne(schema.pushSubscriptions.endpoint, values.endpoint)))
        .run();
    db.insert(schema.pushSubscriptions)
      .values({ id: newId(), ...values })
      .onConflictDoUpdate({ target: schema.pushSubscriptions.endpoint, set: values })
      .run();
    if (values.kind === 'fcm') emit({ type: 'changed', entity: 'devices' });
    return { ok: true };
  });

  app.post('/api/push/unsubscribe', async (req) => {
    const body = z.union([z.object({ endpoint: z.string() }), z.object({ token: z.string() })]).parse(req.body);
    db.delete(schema.pushSubscriptions)
      .where(eq(schema.pushSubscriptions.endpoint, 'token' in body ? body.token : body.endpoint))
      .run();
    emit({ type: 'changed', entity: 'devices' });
    return { ok: true };
  });

  // Firebase for the Android app's notifications: what's set up (never the key itself).
  app.get('/api/push/fcm', async () => fcmStatus());

  app.put('/api/push/fcm', async (req) => {
    const body = z.object({ serviceAccount: z.string().max(20_000).optional(), googleServices: z.string().max(100_000).optional() }).parse(req.body);
    const next = { ...fcmSetting() };
    if (body.serviceAccount) next.serviceAccount = parseServiceAccount(body.serviceAccount);
    if (body.googleServices) next.app = parseGoogleServices(body.googleServices);
    if (next.serviceAccount && next.app && next.serviceAccount.projectId !== next.app.projectId)
      throw badRequest(`The key is for the Firebase project “${next.serviceAccount.projectId}” but google-services.json is for “${next.app.projectId}”. Use files from the same project.`);
    setSetting('fcm', next);
    emit({ type: 'changed', entity: 'settings' });
    return fcmStatus();
  });

  app.delete('/api/push/fcm', async () => {
    setSetting('fcm', {});
    db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.kind, 'fcm')).run();
    emit({ type: 'changed', entity: 'settings' });
    emit({ type: 'changed', entity: 'devices' });
    return fcmStatus();
  });

  // The Android app starts Firebase with these (they identify the app to Firebase; they aren't a secret).
  app.get('/api/push/app-config', async () => ({ firebase: fcmSetting().serviceAccount ? (fcmSetting().app ?? null) : null }));

  app.post('/api/push/test', async () => {
    await notify('Content Studio', 'Notifications are working.', '/settings');
    return { ok: true };
  });
}
