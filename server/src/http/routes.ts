import { existsSync, statfsSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import type { Readable } from 'node:stream';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { InputRole, LiveEvent, SystemInfo, VideoDetail } from '../../../shared/types.ts';
import { config } from '../config.ts';
import { get } from '../db/db.ts';
import { claudeStatus, claudeUsage } from '../engine/claude.ts';
import { chromeInstalled } from '../engine/render.ts';
import { thumbPath } from '../jobs/kinds.ts';
import { enqueue, getJob, listJobs } from '../jobs/queue.ts';
import { cancelJob } from '../jobs/runner.ts';
import { findBinary } from '../lib/proc.ts';
import { HttpError, notFound, subscribe } from '../lib/util.ts';
import { addLesson, brain, toggleLesson, writeBrandFile } from '../services/brain.ts';
import { createBrand, deleteBrand, listBrands, updateBrand } from '../services/brands.ts';
import { forgetDevice, listDevices, newPairCode, pair } from '../services/devices.ts';
import { appendChunk, deleteInput, getInput, inputPath, listInputs, saveStream, startUpload, updateInput, uploadState } from '../services/inputs.ts';
import { addNote, deleteNote, listNotes, updateNote } from '../services/notes.ts';
import { answer, fixNotes, goNow, makeWhenUploaded, sendMessage, stop } from '../services/runs.ts';
import { listThread } from '../services/thread.ts';
import { getVersion, listVersions, versionFiles } from '../services/versions.ts';
import { approveVideo, createVideo, deleteVideo, getVideo, listVideos, markSeen, setPosted, updateVideo } from '../services/videos.ts';

type P = { Params: { id: string } };

export function videoDetail(id: string): VideoDetail {
  const run = listJobs({ videoId: id, active: true }).find((j) => j.kind === 'agent') ?? null;
  return { video: getVideo(id), inputs: listInputs(id), versions: listVersions(id), notes: listNotes(id), thread: listThread(id), job: run };
}

/** Send a file with HTTP ranges (seeking in a video), or 404. */
function sendFile(reply: FastifyReply, path: string | null, opts: { download?: string } = {}) {
  if (!path || !existsSync(path)) return reply.code(404).send({ error: 'Not found' });
  if (opts.download) reply.header('Content-Disposition', `attachment; filename="${opts.download.replace(/["\\]/g, '')}"`);
  return reply.sendFile(basename(path), dirname(path), { cacheControl: true, maxAge: 3600_000 });
}

const downloadName = (videoId: string, n: number, ext: string) => `${getVideo(videoId).title.replace(/[^\p{L}\p{N} -]/gu, '').trim() || 'video'} v${n}${ext}`;

export async function registerApi(app: FastifyInstance) {
  app.get('/api/health', async () => ({ ok: true, version: config.version }));

  app.get('/api/system', async (): Promise<SystemInfo & { usage: unknown }> => {
    const tools = [
      { name: 'ffmpeg', ok: !!findBinary('ffmpeg'), detail: findBinary('ffmpeg') ?? 'not installed' },
      { name: 'ffprobe', ok: !!findBinary('ffprobe'), detail: findBinary('ffprobe') ?? 'not installed' },
      { name: 'uv', ok: !!findBinary('uv'), detail: findBinary('uv') ?? 'not installed' },
      { name: 'chrome', ok: await chromeInstalled(), detail: 'Chrome headless shell for HyperFrames' },
    ];
    let diskFree: number | null = null;
    try {
      const fs = statfsSync(config.studioDir);
      diskFree = fs.bavail * fs.bsize;
    } catch {
      // Unknown is fine.
    }
    return { version: config.version, host: config.hostname, gpu: findBinary('nvidia-smi') ? 'NVIDIA' : null, tools, claude: claudeStatus(), studioDir: config.studioDir, diskFree, usage: claudeUsage() };
  });

  // ------------------------------------------------------------ brands
  app.get('/api/brands', async () => listBrands());
  app.post('/api/brands', async (req) => createBrand(req.body));
  app.patch<P>('/api/brands/:id', async (req) => updateBrand(req.params.id, req.body));
  app.delete<P>('/api/brands/:id', async (req) => {
    deleteBrand(req.params.id);
    return { ok: true };
  });

  // ------------------------------------------------------------ videos
  app.get<{ Querystring: { brandId?: string } }>('/api/videos', async (req) => listVideos({ brandId: req.query.brandId }));
  // New, from the inbox's box: with something said, Claude starts at once (that's my go).
  app.post('/api/videos', async (req) => {
    const body = z.object({ text: z.string().max(20_000).optional(), go: z.boolean().default(true) }).passthrough().parse(req.body ?? {});
    const video = createVideo(req.body);
    if (body.text?.trim() && body.go) sendMessage(video.id, { text: body.text });
    return getVideo(video.id);
  });
  app.get<P>('/api/videos/:id', async (req) => videoDetail(req.params.id));
  app.patch<P>('/api/videos/:id', async (req) => updateVideo(req.params.id, req.body));
  app.delete<P>('/api/videos/:id', async (req) => {
    stop(req.params.id);
    deleteVideo(req.params.id);
    return { ok: true };
  });
  app.post<P>('/api/videos/:id/seen', async (req) => {
    markSeen(req.params.id);
    return { ok: true };
  });

  // What starts Claude.
  app.post<P>('/api/videos/:id/messages', async (req) => sendMessage(req.params.id, req.body));
  app.post<P>('/api/videos/:id/go', async (req) => goNow(req.params.id));
  app.post<P>('/api/videos/:id/fix', async (req) => fixNotes(req.params.id));
  app.post<P>('/api/videos/:id/answer', async (req) => answer(req.params.id, req.body));
  app.post<P>('/api/videos/:id/make-when-uploaded', async (req) => {
    makeWhenUploaded(req.params.id, z.object({ count: z.number().int().min(1).max(200) }).parse(req.body).count);
    return getVideo(req.params.id);
  });
  app.post<P>('/api/videos/:id/stop', async (req) => {
    stop(req.params.id);
    return { ok: true };
  });

  app.post<P>('/api/videos/:id/approve', async (req) => approveVideo(req.params.id, z.object({ n: z.number().int().min(1) }).parse(req.body).n));
  app.post<P>('/api/videos/:id/posted', async (req) => setPosted(req.params.id, z.object({ posted: z.boolean().default(true) }).parse(req.body ?? {}).posted));

  app.post<P>('/api/videos/:id/test-render', async (req) => {
    const body = z.object({ seconds: z.number().min(1).max(120).default(10), inputId: z.string().optional(), gpu: z.boolean().default(true) }).parse(req.body ?? {});
    return enqueue('test-render', { videoId: getVideo(req.params.id).id, input: body });
  });

  // ------------------------------------------------------------ notes
  app.post<P>('/api/videos/:id/notes', async (req) => addNote(getVideo(req.params.id).id, req.body));
  app.patch<P>('/api/notes/:id', async (req) => updateNote(req.params.id, req.body));
  app.delete<P>('/api/notes/:id', async (req) => {
    deleteNote(req.params.id);
    return { ok: true };
  });

  // ------------------------------------------------------------ files
  app.put<P & { Querystring: { name?: string; mime?: string; role?: string } }>('/api/videos/:id/inputs', async (req) => {
    const name = req.query.name || 'file';
    const mime = req.query.mime || String(req.headers['content-type'] || 'application/octet-stream');
    return saveStream(req.params.id, req.body as Readable, name, mime, (req.query.role || null) as InputRole);
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

  // ------------------------------------------------------------ brain
  app.get('/api/brain', async () => brain());
  app.post('/api/brain/lessons', async (req) => {
    const b = z.object({ scope: z.string(), text: z.string().trim().min(3).max(400) }).parse(req.body);
    addLesson(b.scope, b.text);
    return brain();
  });
  app.patch('/api/brain/lessons', async (req) => {
    const b = z.object({ scope: z.string(), line: z.number().int().min(0), on: z.boolean() }).parse(req.body);
    toggleLesson(b.scope, b.line, b.on);
    return brain();
  });
  app.put<P>('/api/brain/brands/:id', async (req) => {
    writeBrandFile(req.params.id, z.object({ text: z.string().max(100_000) }).parse(req.body).text);
    return brain();
  });

  // ------------------------------------------------------------ jobs
  app.get<{ Querystring: { videoId?: string; active?: string } }>('/api/jobs', async (req) => listJobs({ videoId: req.query.videoId, active: req.query.active === '1' }));
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
    return sendFile(reply, thumbPath(input.videoId, input.id));
  });
  app.get<P & { Querystring: { download?: string } }>('/media/version/:id', async (req, reply) => {
    const v = getVersion(req.params.id);
    return sendFile(reply, versionFiles(v).file, { download: req.query.download ? downloadName(v.videoId, v.n, '.mp4') : undefined });
  });
  app.get<P>('/media/poster/:id', async (req, reply) => sendFile(reply, versionFiles(getVersion(req.params.id)).poster));
  app.get<{ Params: { id: string; k: string }; Querystring: { download?: string } }>('/media/slide/:id/:k', async (req, reply) => {
    const v = getVersion(req.params.id);
    const k = Number(req.params.k);
    return sendFile(reply, versionFiles(v).slides[k] ?? null, { download: req.query.download ? downloadName(v.videoId, v.n, ` ${k + 1}.png`) : undefined });
  });
  // The Android app's downloads ask for /api/media/<id>/file: a version (its video), or one of a video's files.
  app.get<P>('/api/media/:id/file', async (req, reply) => {
    if (get('SELECT 1 FROM versions WHERE id = ?', req.params.id)) {
      const v = getVersion(req.params.id);
      const f = versionFiles(v);
      return sendFile(reply, f.file ?? f.slides[0] ?? null, { download: downloadName(v.videoId, v.n, f.file ? '.mp4' : '.png') });
    }
    const input = get<{ id: string }>('SELECT id FROM inputs WHERE id = ?', req.params.id);
    if (!input) throw notFound('File');
    return sendFile(reply, inputPath(input.id));
  });
}
