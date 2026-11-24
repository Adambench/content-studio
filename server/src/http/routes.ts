import { existsSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import type { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { CardDetail, Hook, InputRole, LiveEvent, SystemInfo } from '../../../shared/types.ts';
import { config } from '../config.ts';
import { get } from '../db/db.ts';
import { claudeStatus, claudeUsage } from '../engine/claude.ts';
import { chromeInstalled } from '../engine/render.ts';
import { thumbPath } from '../jobs/kinds.ts';
import { enqueue, getJob, jobState, listJobs } from '../jobs/queue.ts';
import { cancelJob } from '../jobs/runner.ts';
import { findBinary } from '../lib/proc.ts';
import { HttpError, notFound, subscribe } from '../lib/util.ts';
import { approveCard, createCard, createPage, deleteCard, deletePage, getCard, listCards, listDrafts, listPages, saveDraft, trashCard, updateCard, updatePage } from '../services/board.ts';
import { addComment, deleteComment, listComments, updateComment } from '../services/comments.ts';
import { forgetDevice, listDevices, newPairCode, pair } from '../services/devices.ts';
import { appendChunk, deleteInput, getInput, inputPath, listInputs, saveStream, startUpload, updateInput, uploadState } from '../services/inputs.ts';
import { createRule, deleteRule, listRules, updateRule } from '../services/rules.ts';
import { getVersion, listRenders, listVersions, renderFiles, versionSlides } from '../services/versions.ts';

type P = { Params: { id: string } };

function latestHooks(cardId: string): Hook[] | null {
  const job = get<{ id: string }>("SELECT id FROM jobs WHERE card_id = ? AND kind = 'hooks' AND status = 'done' ORDER BY created_at DESC LIMIT 1", cardId);
  if (!job) return null;
  const steps = jobState(job.id).steps as { answer?: { hooks: Hook[] } } | undefined;
  return steps?.answer?.hooks ?? null;
}

export function cardDetail(id: string): CardDetail {
  return { card: getCard(id), inputs: listInputs(id), versions: listVersions(id), renders: listRenders(id), comments: listComments(id), jobs: listJobs({ cardId: id, limit: 10 }), hooks: latestHooks(id) };
}

/** Send a file with HTTP ranges (seeking in a video), or 404. */
function sendFile(reply: FastifyReply, path: string | null, opts: { download?: string } = {}) {
  if (!path || !existsSync(path)) return reply.code(404).send({ error: 'Not found' });
  if (opts.download) reply.header('Content-Disposition', `attachment; filename="${opts.download.replace(/["\\]/g, '')}"`);
  return reply.sendFile(basename(path), dirname(path), { cacheControl: true, maxAge: 3600_000 });
}

export async function registerApi(app: FastifyInstance) {
  app.get('/api/health', async () => ({ ok: true, version: config.version }));

  app.get('/api/system', async (): Promise<SystemInfo & { usage: unknown }> => {
    const gpu = findBinary('nvidia-smi') ? 'NVIDIA' : null;
    const tools = [
      { name: 'ffmpeg', ok: !!findBinary('ffmpeg'), detail: findBinary('ffmpeg') ?? 'not installed' },
      { name: 'ffprobe', ok: !!findBinary('ffprobe'), detail: findBinary('ffprobe') ?? 'not installed' },
      { name: 'uv', ok: !!findBinary('uv'), detail: findBinary('uv') ?? 'not installed' },
      { name: 'chrome', ok: await chromeInstalled(), detail: 'Chrome headless shell for HyperFrames' },
    ];
    return { version: config.version, host: config.hostname, gpu, tools, claude: claudeStatus(), usage: claudeUsage() };
  });

  // ------------------------------------------------------------ pages
  app.get('/api/pages', async () => listPages());
  app.post('/api/pages', async (req) => createPage(req.body as never));
  app.patch<P>('/api/pages/:id', async (req) => updatePage(req.params.id, req.body));
  app.delete<P>('/api/pages/:id', async (req) => {
    deletePage(req.params.id);
    return { ok: true };
  });

  // ------------------------------------------------------------ cards
  app.get<{ Querystring: { pageId?: string; trash?: string } }>('/api/board', async (req) => listCards({ pageId: req.query.pageId, trash: req.query.trash === '1' }));
  app.post('/api/cards', async (req) => createCard(req.body as never));
  app.get<P>('/api/cards/:id', async (req) => cardDetail(req.params.id));
  app.patch<P>('/api/cards/:id', async (req) => updateCard(req.params.id, req.body, 'you'));
  app.delete<P & { Querystring: { hard?: string } }>('/api/cards/:id', async (req) => {
    if (req.query.hard === '1') deleteCard(req.params.id);
    else trashCard(req.params.id);
    return { ok: true };
  });
  app.post<P>('/api/cards/:id/approve', async (req) => approveCard(req.params.id));

  app.get<P>('/api/cards/:id/drafts', async (req) => listDrafts(req.params.id));
  app.post<{ Params: { id: string; draftId: string } }>('/api/cards/:id/drafts/:draftId/restore', async (req) => {
    const draft = listDrafts(req.params.id).find((d) => d.id === req.params.draftId);
    if (!draft) throw notFound('Draft');
    const card = getCard(req.params.id);
    saveDraft(card.id, 'you', card.script, card.notes, 'Before restoring an older draft');
    return updateCard(card.id, { script: draft.script, notes: draft.notes }, 'you');
  });

  // ------------------------------------------------------------ the buttons: Write, Hooks, Make, Fix
  app.post<P>('/api/cards/:id/write', async (req) => enqueue('write', { cardId: getCard(req.params.id).id, input: z.object({ instruction: z.string().max(2000).default('') }).parse(req.body ?? {}), single: true }));
  app.post<P>('/api/cards/:id/hooks', async (req) => enqueue('hooks', { cardId: getCard(req.params.id).id, single: true }));
  app.post<P>('/api/cards/:id/make', async (req) => {
    const card = getCard(req.params.id);
    const body = z.object({ recipe: z.string().optional() }).parse(req.body ?? {});
    return enqueue('make', { cardId: card.id, input: { recipe: body.recipe ?? card.recipe }, single: true });
  });
  app.post<P>('/api/cards/:id/fix', async (req) => {
    const card = getCard(req.params.id);
    if (!card.openComments) throw new HttpError(409, 'No open comments to fix');
    return enqueue('fix', { cardId: card.id, single: true });
  });
  app.post<P>('/api/cards/:id/test-render', async (req) => {
    const body = z.object({ seconds: z.number().min(1).max(120).default(10), inputId: z.string().optional(), gpu: z.boolean().default(true) }).parse(req.body ?? {});
    return enqueue('test-render', { cardId: getCard(req.params.id).id, input: body });
  });

  // ------------------------------------------------------------ inputs
  app.put<P & { Querystring: { name?: string; mime?: string; role?: string } }>('/api/cards/:id/inputs', async (req) => {
    const name = req.query.name || 'file';
    const mime = req.query.mime || String(req.headers['content-type'] || 'application/octet-stream');
    const role = (req.query.role || null) as InputRole;
    return saveStream(req.params.id, req.body as Readable, name, mime, role);
  });
  app.patch<P>('/api/inputs/:id', async (req) => updateInput(req.params.id, req.body));
  app.delete<P>('/api/inputs/:id', async (req) => {
    await deleteInput(req.params.id);
    return { ok: true };
  });

  // The phone's resumable uploads.
  app.post('/api/uploads', async (req) => startUpload(req.body));
  app.get<P>('/api/uploads/:id', async (req) => uploadState(req.params.id));
  app.patch<P>('/api/uploads/:id', async (req, reply) => {
    const offset = Number(req.headers['upload-offset']);
    if (!Number.isInteger(offset) || offset < 0) throw new HttpError(400, 'Upload-Offset is missing');
    const out = await appendChunk(req.params.id, offset, req.body as Readable);
    if (out.conflict) return reply.code(409).send({ offset: out.offset });
    return { offset: out.offset, mediaId: out.mediaId };
  });

  // ------------------------------------------------------------ comments
  app.post<P>('/api/cards/:id/comments', async (req) => addComment(req.params.id, req.body));
  app.patch<P>('/api/comments/:id', async (req) => updateComment(req.params.id, req.body));
  app.delete<P>('/api/comments/:id', async (req) => {
    deleteComment(req.params.id);
    return { ok: true };
  });

  // ------------------------------------------------------------ rules
  app.get<{ Querystring: { pageId?: string } }>('/api/rules', async (req) => listRules({ pageId: req.query.pageId || null }));
  app.post('/api/rules', async (req) => createRule(req.body as never));
  app.patch<P>('/api/rules/:id', async (req) => updateRule(req.params.id, req.body));
  app.delete<P>('/api/rules/:id', async (req) => {
    deleteRule(req.params.id);
    return { ok: true };
  });

  // ------------------------------------------------------------ jobs
  app.get<{ Querystring: { cardId?: string; active?: string } }>('/api/jobs', async (req) => listJobs({ cardId: req.query.cardId, active: req.query.active === '1' }));
  app.get<P>('/api/jobs/:id', async (req) => getJob(req.params.id));
  app.post<P>('/api/jobs/:id/cancel', async (req) => cancelJob(req.params.id));

  // ------------------------------------------------------------ pairing
  app.post('/api/pair/code', async () => newPairCode());
  app.post('/api/pair', async (req) => {
    const body = z.object({ code: z.string().min(4).max(20), name: z.string().max(80).default('Phone') }).parse(req.body);
    return pair(body.code, body.name);
  });
  app.get('/api/devices', async () => listDevices());
  app.delete<P>('/api/devices/:id', async (req) => {
    forgetDevice(req.params.id);
    return { ok: true };
  });

  // ------------------------------------------------------------ live events (SSE)
  app.get('/api/events', (req, reply) => {
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    reply.raw.write('retry: 3000\n\n');
    let pending = new Map<string, LiveEvent>();
    let timer: NodeJS.Timeout | null = null;
    const flush = () => {
      timer = null;
      const batch = [...pending.values()];
      pending = new Map();
      if (batch.length) reply.raw.write(`data: ${JSON.stringify(batch)}\n\n`);
    };
    const unsubscribe = subscribe((e) => {
      pending.set(`${e.entity}:${e.id}`, e);
      timer ??= setTimeout(flush, 150);
    });
    const heartbeat = setInterval(() => reply.raw.write(': keepalive\n\n'), 25_000);
    req.raw.on('close', () => {
      unsubscribe();
      clearInterval(heartbeat);
      if (timer) clearTimeout(timer);
    });
  });

  // ------------------------------------------------------------ media
  app.get<P & { Querystring: { download?: string } }>('/media/input/:id', async (req, reply) => {
    const input = getInput(req.params.id);
    return sendFile(reply, inputPath(input.id), { download: req.query.download ? input.name : undefined });
  });
  app.get<P>('/media/thumb/:id', async (req, reply) => {
    const input = getInput(req.params.id);
    return sendFile(reply, thumbPath(input.cardId, input.id));
  });
  app.get<P & { Querystring: { download?: string } }>('/media/render/:id', async (req, reply) => {
    const files = renderFiles(req.params.id);
    return sendFile(reply, files.file, { download: req.query.download ? `${getCard(listRenderCard(req.params.id)).title}.mp4` : undefined });
  });
  app.get<P>('/media/poster/:id', async (req, reply) => sendFile(reply, renderFiles(req.params.id).poster));
  // The Android app's downloads ask for /api/media/<id>/file: a render, or one of a card's files.
  app.get<P>('/api/media/:id/file', async (req, reply) => {
    const render = get<{ id: string }>('SELECT id FROM renders WHERE id = ?', req.params.id);
    return sendFile(reply, render ? renderFiles(render.id).file : inputPath(getInput(req.params.id).id));
  });
  app.get<{ Params: { id: string; n: string } }>('/media/slide/:id/:n', async (req, reply) => {
    const slides = versionSlides(getVersion(req.params.id));
    return sendFile(reply, slides[Number(req.params.n)] ?? null);
  });

}

function listRenderCard(renderId: string): string {
  const r = get<{ card_id: string }>('SELECT card_id FROM renders WHERE id = ?', renderId);
  if (!r) throw notFound('Render');
  return r.card_id;
}
