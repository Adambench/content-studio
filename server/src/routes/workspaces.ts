import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { and, asc, eq, isNull, max, notInArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { normalizeTemplate } from '../../../shared/edit';
import { DEFAULT_STAGES, WORKSPACE_COLORS } from '../../../shared/types';
import { config } from '../config';
import { db, newId, now, schema } from '../db';
import { emit } from '../lib/events';
import { badRequest } from '../lib/http';
import { getSetting, setSetting } from '../lib/settings';
import { enqueue } from '../jobs/queue';
import { getWorkspace } from '../services/pieces';

const stageSchema = z.object({ id: z.string().min(1).max(40), name: z.string().trim().min(1).max(40) });
const patchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  color: z.enum(WORKSPACE_COLORS).optional(),
  description: z.string().max(2000).optional(),
  brandGuide: z.string().max(20000).optional(),
  voiceMemory: z.string().max(20000).optional(),
  stages: z.array(stageSchema).min(1).max(12).optional(),
  // The brand's video look; null clears it.
  editTemplate: z.record(z.string(), z.unknown()).nullable().optional(),
});

function pendingEdits(workspaceId: string) {
  return (
    db
      .select({ n: sql<number>`count(*)` })
      .from(schema.editEvents)
      .where(and(eq(schema.editEvents.workspaceId, workspaceId), isNull(schema.editEvents.learnedAt)))
      .get()?.n ?? 0
  );
}

export async function workspaceRoutes(app: FastifyInstance) {
  app.get('/api/workspaces', async () => {
    const rows = db.select().from(schema.workspaces).orderBy(asc(schema.workspaces.position), asc(schema.workspaces.createdAt)).all();
    const counts = db
      .select({ workspaceId: schema.pieces.workspaceId, n: sql<number>`count(*)` })
      .from(schema.pieces)
      .groupBy(schema.pieces.workspaceId)
      .all();
    const byWs = new Map(counts.map((c) => [c.workspaceId, c.n]));
    return rows.map((w) => ({ ...w, pieceCount: byWs.get(w.id) ?? 0 }));
  });

  app.post('/api/workspaces', async (req) => {
    const body = z
      .object({ name: z.string().trim().min(1).max(60), color: z.enum(WORKSPACE_COLORS).default('violet'), description: z.string().max(2000).default('') })
      .parse(req.body);
    const last = db.select({ p: max(schema.workspaces.position) }).from(schema.workspaces).get();
    const id = newId();
    db.insert(schema.workspaces)
      .values({ id, ...body, stages: DEFAULT_STAGES, position: (last?.p ?? -1) + 1 })
      .run();
    setSetting('lastWorkspaceId', id);
    emit({ type: 'changed', entity: 'workspaces', workspaceId: id });
    return getWorkspace(id);
  });

  app.get<{ Params: { id: string } }>('/api/workspaces/:id', async (req) => ({
    ...getWorkspace(req.params.id),
    pendingEdits: pendingEdits(req.params.id),
  }));

  app.patch<{ Params: { id: string } }>('/api/workspaces/:id', async (req) => {
    const ws = getWorkspace(req.params.id);
    const body = patchSchema.parse(req.body);
    if (body.stages) {
      const ids = body.stages.map((s) => s.id);
      if (new Set(ids).size !== ids.length) throw badRequest('Stage ids must be unique.');
    }
    const { editTemplate, ...rest } = body;
    const values = { ...rest, ...(editTemplate !== undefined ? { editTemplate: editTemplate && normalizeTemplate(editTemplate) } : {}) };
    db.transaction((tx) => {
      tx.update(schema.workspaces).set({ ...values, updatedAt: now() }).where(eq(schema.workspaces.id, ws.id)).run();
      // Cards in a removed stage move to the first stage instead of disappearing.
      if (body.stages) {
        tx.update(schema.pieces)
          .set({ stage: body.stages[0].id })
          .where(and(eq(schema.pieces.workspaceId, ws.id), notInArray(schema.pieces.stage, body.stages.map((s) => s.id))))
          .run();
      }
    });
    emit({ type: 'changed', entity: 'workspaces', workspaceId: ws.id });
    if (body.stages) emit({ type: 'changed', entity: 'pieces', workspaceId: ws.id });
    return getWorkspace(ws.id);
  });

  app.delete<{ Params: { id: string } }>('/api/workspaces/:id', async (req) => {
    const ws = getWorkspace(req.params.id);
    const mediaIds = db.select({ id: schema.media.id }).from(schema.media).where(eq(schema.media.workspaceId, ws.id)).all();
    db.delete(schema.workspaces).where(eq(schema.workspaces.id, ws.id)).run();
    if (getSetting('lastWorkspaceId') === ws.id) setSetting('lastWorkspaceId', db.select({ id: schema.workspaces.id }).from(schema.workspaces).get()?.id ?? '');
    await rm(join(config.mediaDir, ws.id), { recursive: true, force: true });
    await Promise.all(
      mediaIds.flatMap(({ id }) =>
        [join(config.thumbsDir, `${id}.jpg`), join(config.transcriptsDir, `${id}.json`), join(config.proxiesDir, `${id}.mp4`), join(config.proxiesDir, `${id}.jpg`)].map((p) => rm(p, { force: true })),
      ),
    );
    emit({ type: 'changed', entity: 'workspaces', workspaceId: ws.id });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/workspaces/:id/learn', async (req) => {
    const ws = getWorkspace(req.params.id);
    if (!pendingEdits(ws.id)) throw badRequest('No new edits to learn from yet.');
    enqueue('voice.learn', { workspaceId: ws.id });
    return { ok: true };
  });
}
