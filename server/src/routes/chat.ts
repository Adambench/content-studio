import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isRunning, pieceThread, runChat, stopChat } from '../claude/agent';
import { db, newId, now, schema } from '../db';
import { emit } from '../lib/events';
import { notFound } from '../lib/http';
import { openSse } from '../lib/sse';
import { getPiece, getWorkspace } from '../services/pieces';

const modelSchema = z.enum(['sonnet', 'opus', 'haiku', 'local']);

function getThread(id: string) {
  const thread = db.select().from(schema.chatThreads).where(eq(schema.chatThreads.id, id)).get();
  if (!thread) throw notFound('Chat not found');
  return thread;
}

export async function chatRoutes(app: FastifyInstance) {
  app.get<{ Params: { wid: string } }>('/api/workspaces/:wid/threads', async (req) =>
    db
      .select({ id: schema.chatThreads.id, title: schema.chatThreads.title, model: schema.chatThreads.model, updatedAt: schema.chatThreads.updatedAt })
      .from(schema.chatThreads)
      // A video's own chat lives in its package, not in this list.
      .where(and(eq(schema.chatThreads.workspaceId, req.params.wid), isNull(schema.chatThreads.pieceId)))
      .orderBy(desc(schema.chatThreads.updatedAt))
      .limit(100)
      .all()
      .map((t) => ({ ...t, running: isRunning(t.id) })),
  );

  app.post<{ Params: { wid: string } }>('/api/workspaces/:wid/threads', async (req) => {
    const ws = getWorkspace(req.params.wid);
    const body = z.object({ model: modelSchema.optional() }).parse(req.body ?? {});
    const id = newId();
    db.insert(schema.chatThreads).values({ id, workspaceId: ws.id, model: body.model ?? null }).run();
    emit({ type: 'changed', entity: 'threads', workspaceId: ws.id, id });
    return getThread(id);
  });

  /** A video's own chat: its latest, started on first use. */
  app.get<{ Params: { id: string } }>('/api/pieces/:id/thread', async (req) => {
    const thread = pieceThread(getPiece(req.params.id));
    return { ...thread, running: isRunning(thread.id) };
  });

  app.patch<{ Params: { id: string } }>('/api/threads/:id', async (req) => {
    const thread = getThread(req.params.id);
    const body = z.object({ title: z.string().trim().min(1).max(100).optional(), model: modelSchema.optional() }).parse(req.body);
    db.update(schema.chatThreads).set({ ...body, updatedAt: now() }).where(eq(schema.chatThreads.id, thread.id)).run();
    emit({ type: 'changed', entity: 'threads', workspaceId: thread.workspaceId, id: thread.id });
    return getThread(thread.id);
  });

  app.delete<{ Params: { id: string } }>('/api/threads/:id', async (req) => {
    const thread = getThread(req.params.id);
    stopChat(thread.id);
    db.delete(schema.chatThreads).where(eq(schema.chatThreads.id, thread.id)).run();
    emit({ type: 'changed', entity: 'threads', workspaceId: thread.workspaceId, id: thread.id });
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/threads/:id/messages', async (req) => {
    const thread = getThread(req.params.id);
    const messages = db.select().from(schema.chatMessages).where(eq(schema.chatMessages.threadId, thread.id)).orderBy(asc(schema.chatMessages.createdAt)).all();
    return { thread: { ...thread, running: isRunning(thread.id) }, messages };
  });

  // Streams Claude's reply as SSE. If the browser goes away, the turn still finishes and is saved.
  app.post<{ Params: { id: string } }>('/api/threads/:id/messages', async (req, reply) => {
    const thread = getThread(req.params.id);
    const body = z
      .object({ text: z.string().trim().min(1).max(50_000), contextPieceId: z.string().nullable().optional(), contextView: z.enum(['video']).nullable().optional(), model: modelSchema.optional() })
      .parse(req.body);
    if (body.model && body.model !== thread.model) db.update(schema.chatThreads).set({ model: body.model }).where(eq(schema.chatThreads.id, thread.id)).run();
    const sse = openSse(reply);
    try {
      await runChat({ threadId: thread.id, text: body.text, contextPieceId: body.contextPieceId, contextView: body.contextView, model: body.model, onEvent: sse.send });
    } catch (err) {
      sse.send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      sse.end();
    }
  });

  app.post<{ Params: { id: string } }>('/api/threads/:id/stop', async (req) => {
    stopChat(getThread(req.params.id).id);
    return { ok: true };
  });
}
