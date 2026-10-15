import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { normalizeServer, type PairedDevice } from '../../../shared/devices';
import { db, schema } from '../db';
import { emit } from '../lib/events';
import { badRequest, notFound } from '../lib/http';
import { detectTailscaleUrl, publicUrl } from '../publish/setup';
import { cancelPairing, requestSession, startPairing } from './auth';

/** Paired phones (the Android app), from the desktop's Settings → Phone access. */
export async function deviceRoutes(app: FastifyInstance) {
  app.get('/api/devices', async (req): Promise<PairedDevice[]> => {
    const current = requestSession(req)?.id;
    const withPush = new Set(
      db
        .select({ sessionId: schema.pushSubscriptions.sessionId })
        .from(schema.pushSubscriptions)
        .where(eq(schema.pushSubscriptions.kind, 'fcm'))
        .all()
        .map((s) => s.sessionId),
    );
    return db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.kind, 'device'))
      .orderBy(desc(schema.sessions.createdAt))
      .all()
      .map((s) => ({ id: s.id, name: s.name ?? 'Android phone', createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, current: s.id === current, push: withPush.has(s.id) }));
  });

  // Where the phone should find this computer: the public (Funnel) address, else this machine's Tailscale name.
  app.get('/api/devices/address', async () => ({ url: publicUrl() ?? (await detectTailscaleUrl()) }));

  app.post('/api/devices/pairing', async (req) => {
    const body = z.object({ server: z.string() }).parse(req.body);
    const server = normalizeServer(body.server);
    if (!server) throw badRequest('Enter the address your phone reaches this computer at, like https://laptop.tail1234.ts.net.');
    return startPairing(server);
  });

  app.delete('/api/devices/pairing', async () => {
    cancelPairing();
    return { ok: true };
  });

  app.patch<{ Params: { id: string } }>('/api/devices/:id', async (req) => {
    const { name } = z.object({ name: z.string().trim().min(1).max(80) }).parse(req.body);
    const res = db
      .update(schema.sessions)
      .set({ name })
      .where(and(eq(schema.sessions.id, req.params.id), eq(schema.sessions.kind, 'device')))
      .run();
    if (!res.changes) throw notFound('Device not found');
    emit({ type: 'changed', entity: 'devices' });
    return { ok: true };
  });

  // Unpair: its token stops working at once and its notifications stop (push subscriptions go with the session).
  app.delete<{ Params: { id: string } }>('/api/devices/:id', async (req) => {
    const res = db
      .delete(schema.sessions)
      .where(and(eq(schema.sessions.id, req.params.id), eq(schema.sessions.kind, 'device')))
      .run();
    if (!res.changes) throw notFound('Device not found');
    emit({ type: 'changed', entity: 'devices' });
    return { ok: true };
  });
}
