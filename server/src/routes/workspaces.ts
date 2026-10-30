import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { and, asc, eq, isNull, max, notInArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { normalizeTemplate } from '../../../shared/edit';
import { MASCOTS } from '../../../shared/mascots';
import { KIND_PRESETS, MODULES, WORKSPACE_COLORS, WORKSPACE_KINDS, normalizeModules } from '../../../shared/types';
import { config } from '../config';
import { db, newId, now, schema } from '../db';
import { emit } from '../lib/events';
import { badRequest } from '../lib/http';
import { getSetting, setSetting } from '../lib/settings';
import { enqueue } from '../jobs/queue';
import { getWorkspace } from '../services/pieces';
import { lectureCampaign } from '../islamic/lectures';
import { inboxWhere } from '../services/inbox';

const stageSchema = z.object({ id: z.string().min(1).max(40), name: z.string().trim().min(1).max(40) });
const patchSchema = z.object({
  name: z.string().trim().min(1).max(60).optional(),
  color: z.enum(WORKSPACE_COLORS).optional(),
  kind: z.enum(WORKSPACE_KINDS).optional(),
  modules: z.array(z.enum(MODULES)).max(MODULES.length).optional(),
  niche: z.string().trim().max(300).optional(),
  description: z.string().max(2000).optional(),
  brandGuide: z.string().max(20000).optional(),
  voiceMemory: z.string().max(20000).optional(),
  stages: z.array(stageSchema).min(1).max(12).optional(),
  mascot: z.enum(MASCOTS).nullable().optional(),
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
    const inbox = (id: string) => db.select({ n: sql<number>`count(*)` }).from(schema.media).where(inboxWhere(id)).get()?.n ?? 0;
    return rows.map((w) => ({ ...w, pieceCount: byWs.get(w.id) ?? 0, inboxCount: inbox(w.id) }));
  });

  app.post('/api/workspaces', async (req) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(60),
        color: z.enum(WORKSPACE_COLORS).default('violet'),
        kind: z.enum(WORKSPACE_KINDS).default('personal'),
        niche: z.string().trim().max(300).default(''),
        description: z.string().max(2000).default(''),
      })
      .parse(req.body);
    const last = db.select({ p: max(schema.workspaces.position) }).from(schema.workspaces).get();
    const id = newId();
    const preset = KIND_PRESETS[body.kind];
    db.insert(schema.workspaces)
      .values({ id, ...body, modules: preset.modules, stages: preset.stages, position: (last?.p ?? -1) + 1 })
      .run();
    setSetting('lastWorkspaceId', id);
    emit({ type: 'changed', entity: 'workspaces', workspaceId: id });
    return getWorkspace(id);
  });

  app.get<{ Params: { id: string } }>('/api/workspaces/:id', async (req) => ({
    ...getWorkspace(req.params.id),
    pendingEdits: pendingEdits(req.params.id),
  }));

  // An Islamic page's lecture clips: a campaign of its own, made the first time it's opened.
  app.post<{ Params: { id: string } }>('/api/workspaces/:id/lectures', async (req) => ({ campaignId: lectureCampaign(req.params.id) }));

  app.patch<{ Params: { id: string } }>('/api/workspaces/:id', async (req) => {
    const ws = getWorkspace(req.params.id);
    const body = patchSchema.parse(req.body);
    if (body.stages) {
      const ids = body.stages.map((s) => s.id);
      if (new Set(ids).size !== ids.length) throw badRequest('Stage ids must be unique.');
    }
    const { editTemplate, modules, ...rest } = body;
    const values = {
      ...rest,
      ...(modules && { modules: normalizeModules(modules) }),
      ...(editTemplate !== undefined ? { editTemplate: editTemplate && normalizeTemplate(editTemplate) } : {}),
    };
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
