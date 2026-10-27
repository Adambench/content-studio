import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { KNOWLEDGE_TOPICS, RULE_BODY_MAX, RULE_TITLE_MAX, type KnowledgeRule } from '../../../shared/knowledge';
import { createRule, deleteRule, listKnowledge, resetRule, restoreRule, updateRule } from '../knowledge/knowledge';

const title = z.string().trim().min(1).max(RULE_TITLE_MAX);
const body = z.string().max(RULE_BODY_MAX);
const status = z.enum(['active', 'proposed', 'off']);

/** The Knowledge page: the playbook as rules I can read, edit and add to (server/src/knowledge/). */
export async function knowledgeRoutes(app: FastifyInstance) {
  app.get('/api/knowledge', async () => listKnowledge());

  app.post('/api/knowledge', async (req) => {
    const b = z.object({ topic: z.enum(KNOWLEDGE_TOPICS), title, body: body.default('') }).parse(req.body);
    return createRule({ ...b, source: 'you' });
  });

  app.patch<{ Params: { id: string } }>('/api/knowledge/:id', async (req) => {
    const b = z.object({ title: title.optional(), body: body.optional(), status: status.optional(), topic: z.enum(KNOWLEDGE_TOPICS).optional() }).parse(req.body);
    return updateRule(req.params.id, b);
  });

  app.post<{ Params: { id: string } }>('/api/knowledge/:id/reset', async (req) => resetRule(req.params.id));

  app.delete<{ Params: { id: string } }>('/api/knowledge/:id', async (req) => ({ rule: deleteRule(req.params.id) }));

  // Undo of a delete: the rule as the app still has it.
  app.post('/api/knowledge/restore', async (req) => {
    const r = z
      .object({
        id: z.string().min(1).max(64),
        workspaceId: z.string().nullable(),
        topic: z.enum(KNOWLEDGE_TOPICS),
        title,
        body,
        source: z.enum(['playbook', 'you', 'claude', 'results', 'reference']),
        status,
        note: z.string().max(2000),
        referenceId: z.string().max(64).nullable().default(null),
        position: z.number(),
        createdAt: z.number(),
      })
      .passthrough()
      .parse(req.body);
    return restoreRule(r as KnowledgeRule);
  });
}
