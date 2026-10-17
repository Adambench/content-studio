import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AI_TASKS, DEFAULT_LOCAL_AI, normalizeRouting } from '../../../shared/ai';
import { DEFAULT_GENERATION, GEN_ASPECTS, GEN_KINDS, GEN_PURPOSES } from '../../../shared/generate';
import { BROLL_LAYOUTS } from '../../../shared/looks';
import { listWorkers } from '../compute/workers';
import { badRequest } from '../lib/http';
import { getPiece, getWorkspace } from '../services/pieces';
import { generationSettings, queueGeneration } from '../studio/generate';
import { localConfig, localStatus } from '../ai/local';
import { aiRouting, routesNow } from '../ai/route';
import { emit } from '../lib/events';
import { getSetting, setSetting } from '../lib/settings';

/** Settings → Models: which model answers each task, and the self-hosted model server. */
export async function aiRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { fresh?: string } }>('/api/ai', async (req) => ({
    routing: aiRouting(),
    local: localConfig(),
    status: await localStatus(req.query.fresh === '1'),
    now: await routesNow(),
    claudeLimitedUntil: getSetting('claudeLimitedUntil') ?? null,
    generation: generationSettings(),
    // Which online home PCs can make pictures and clips.
    generators: listWorkers()
      .filter((w) => w.online && (w.tools.includes('image') || w.tools.includes('video')))
      .map((w) => ({ name: w.name, image: w.tools.includes('image'), video: w.tools.includes('video') })),
  }));

  app.patch('/api/ai', async (req) => {
    const mode = z.enum(['auto', 'claude', 'local']);
    const body = z
      .object({
        routing: z
          .object({
            localOnly: z.boolean(),
            tasks: z.partialRecord(z.enum(AI_TASKS), mode),
            weeklyAt: z.number().min(0.05).max(1),
            fiveHourAt: z.number().min(0.05).max(1),
          })
          .partial()
          .optional(),
        local: z
          .object({
            url: z
              .string()
              .trim()
              .max(200)
              .refine((u) => !u || /^https?:\/\/[^\s/]+(:\d+)?\/?$/.test(u), 'An address like http://desktop-1070:11434'),
            model: z.string().trim().max(120),
            contextTokens: z.number().int().min(4096).max(262144),
          })
          .partial()
          .optional(),
        generation: z.object({ videoFrom: z.number().int().min(0).max(23), videoTo: z.number().int().min(0).max(23) }).partial().optional(),
        /** Claude works again: stop skipping it before the hour is up. */
        clearClaudeLimit: z.boolean().optional(),
      })
      .parse(req.body);
    if (body.routing) {
      const r = aiRouting();
      setSetting('aiRouting', normalizeRouting({ ...r, ...body.routing, tasks: { ...r.tasks, ...body.routing.tasks } }));
    }
    if (body.local) setSetting('localAi', { ...DEFAULT_LOCAL_AI, ...getSetting('localAi'), ...body.local });
    if (body.clearClaudeLimit) setSetting('claudeLimitedUntil', 0);
    if (body.generation) setSetting('generation', { ...DEFAULT_GENERATION, ...getSetting('generation'), ...body.generation });
    emit({ type: 'changed', entity: 'settings' });
    return { ok: true };
  });

  // A picture or a clip made on a home PC (shared/generate.ts), from the piece page.
  app.post<{ Params: { wid: string } }>('/api/workspaces/:wid/generate', async (req) => {
    const ws = getWorkspace(req.params.wid);
    const body = z
      .object({
        kind: z.enum(GEN_KINDS),
        prompt: z.string().trim().min(3).max(600),
        purpose: z.enum(GEN_PURPOSES).default('broll'),
        aspect: z.enum(GEN_ASPECTS).default('9:16'),
        pieceId: z.string().nullable().default(null),
        place: z.object({ start: z.number().min(0), end: z.number().min(0.3), layout: z.enum(BROLL_LAYOUTS).default('full') }).nullable().default(null),
      })
      .parse(req.body);
    if (body.pieceId && getPiece(body.pieceId).workspaceId !== ws.id) throw badRequest('That video is in another workspace.');
    if (body.place && (!body.pieceId || body.place.end <= body.place.start)) throw badRequest('Placing it needs the video and an end after the start.');
    return { jobId: queueGeneration({ ...body, workspaceId: ws.id, by: 'you' }) };
  });
}
