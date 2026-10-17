import { existsSync, statSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { normalizeServer } from '../../../shared/devices';
import { TIGHTEN_PRESETS, normalizeEdit, type EditSpec } from '../../../shared/edit';
import { builtinSfx, builtinSfxId } from '../../../shared/sfx';
import { config } from '../config';
import { db, schema } from '../db';
import { emit } from '../lib/events';
import { badRequest, notFound } from '../lib/http';
import { correctTranscript, getMedia } from '../services/media';
import { clipToolsInstalled } from '../services/cliptools';
import { hasVoiceReference, speak, ttsInstalled, voiceReferencePath } from '../services/tts';
import { CHARACTERS, CLONE_VOICE, VOICES, type CharacterId } from '../../../shared/recipe';
import { characterSvg } from '../studio/characters';
import { JobError, enqueue, hasPendingJob } from '../jobs/queue';
import { getPiece } from '../services/pieces';
import { BUNDLED_FONTS, composeEdit } from '../studio/compose';
import { createEdit, editDetail, findEditForPiece, getEdit, listRenders, restoreEditVersion, saveEditVersion, specMedia, specTranscripts, updateEditWorking } from '../studio/edits';
import { proxyPath } from '../studio/proxy';
import { builtinSfxPath, cancelRender, getRender, GSAP_FILES, gsapFilePath, queueRender, runtimePath } from '../studio/render';
import { tightenEdit } from '../studio/tighten';
import { bearerToken } from './auth';

// The edit's shape is checked and clamped by normalizeEdit/validateSpec; here we only need an object.
const specBody = z.record(z.string(), z.unknown());
const FONT_FILES = new Set(BUNDLED_FONTS.flatMap((f) => f.files));

export async function studioRoutes(app: FastifyInstance) {
  /** The piece's edit, or null before one is started. */
  app.get<{ Params: { id: string } }>('/api/pieces/:id/edit', async (req) => {
    getPiece(req.params.id);
    const edit = findEditForPiece(req.params.id);
    return edit ? editDetail(edit.id) : null;
  });

  app.post<{ Params: { id: string } }>('/api/pieces/:id/edit', async (req) => editDetail(createEdit(req.params.id, 'you').id));

  app.get<{ Params: { id: string } }>('/api/pieces/:id/renders', async (req) => {
    const edit = findEditForPiece(req.params.id);
    return edit ? listRenders(edit.id) : [];
  });

  // Autosave of the live edit; returns the server timestamp so the editor can spot newer remote edits.
  app.put<{ Params: { id: string } }>('/api/edits/:id/working', async (req) => {
    const { spec } = z.object({ spec: specBody }).parse(req.body);
    const edit = updateEditWorking(req.params.id, spec as unknown as EditSpec, 'you');
    return { workingUpdatedAt: edit.workingUpdatedAt };
  });

  app.post<{ Params: { id: string } }>('/api/edits/:id/versions', async (req) => {
    const body = z.object({ message: z.string().max(200).optional(), spec: specBody.optional() }).parse(req.body ?? {});
    const { version, unchanged } = saveEditVersion(req.params.id, { author: 'you', message: body.message, spec: body.spec as EditSpec | undefined });
    return { versionId: version.id, number: version.number, unchanged };
  });

  app.get<{ Params: { id: string } }>('/api/edit-versions/:id', async (req) => {
    const v = db.select().from(schema.editVersions).where(eq(schema.editVersions.id, req.params.id)).get();
    if (!v) throw notFound('Version not found');
    return { ...v, spec: normalizeEdit(v.spec) };
  });

  app.post<{ Params: { id: string } }>('/api/edit-versions/:id/restore', async (req) => {
    const { version } = restoreEditVersion(req.params.id);
    return { versionId: version.id, number: version.number };
  });

  app.post<{ Params: { id: string } }>('/api/edits/:id/tighten', async (req) => {
    const body = z
      .object({ preset: z.enum(['natural', 'tight']).default('natural'), removeFillers: z.boolean().optional(), punchIn: z.boolean().optional() })
      .parse(req.body ?? {});
    const opts = { ...TIGHTEN_PRESETS[body.preset], ...(body.removeFillers !== undefined && { removeFillers: body.removeFillers }), ...(body.punchIn !== undefined && { punchIn: body.punchIn }) };
    return tightenEdit(req.params.id, opts, 'you');
  });

  app.post<{ Params: { id: string } }>('/api/edits/:id/render', async (req) => queueRender(req.params.id, 'you'));

  // A format video's voice: speak the recipe, time it, lay out the edit (a new version).
  app.post<{ Params: { id: string } }>('/api/edits/:id/build', async (req) => {
    const edit = getEdit(req.params.id);
    if (!normalizeEdit(edit.working).recipe) throw badRequest('This edit isn’t a format video.');
    if (!ttsInstalled()) throw badRequest('Install the clip tools first (Settings → Clip tools): the voices come with them.');
    if (!hasPendingJob('format.build', 'editId', edit.id)) enqueue('format.build', { editId: edit.id, by: 'you' }, { maxAttempts: 1 });
    return { ok: true };
  });

  // How a voice sounds: a short sample, made once and kept (the cloned voice's, once per recording).
  app.get<{ Params: { voice: string } }>('/api/tts/voices/:voice', async (req, reply) => {
    const id = req.params.voice.replace(/\.wav$/, '');
    if (!VOICES.some((v) => v.id === id)) throw notFound('No such voice');
    if (!ttsInstalled()) throw badRequest('Install the clip tools first (Settings → Clip tools).');
    if (id === CLONE_VOICE && !hasVoiceReference()) throw badRequest('Record your voice first (Settings → My voice).');
    const version = id === CLONE_VOICE ? `-${Math.round(statSync(voiceReferencePath()).mtimeMs)}` : '';
    const file = join(config.cacheDir, 'voices', `${id}${version}.wav`);
    if (!existsSync(file)) {
      await mkdir(dirname(file), { recursive: true });
      try {
        await speak([{ text: 'Here’s how I sound reading your script. Short lines work best.', voice: id, speed: 1.05, pause: 0.1 }], file);
      } catch (err) {
        // The cloned voice needs a home PC: say so instead of failing the request.
        if (err instanceof JobError) throw badRequest(err.message);
        throw err;
      }
    }
    reply.header('Cache-Control', 'private, max-age=86400');
    return reply.type('audio/wav').sendFile(basename(file), dirname(file));
  });

  // "Follow the speaker": find the shots and who's talking in the footage, then reframe on them (a new version).
  app.post<{ Params: { id: string } }>('/api/edits/:id/reframe', async (req) => {
    const edit = getEdit(req.params.id);
    if (!clipToolsInstalled()) throw badRequest('Install the clip tools first (Settings → Clip tools): they find the faces.');
    if (!hasPendingJob('edit.reframe', 'editId', edit.id)) enqueue('edit.reframe', { editId: edit.id, author: 'you' }, { maxAttempts: 1 });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/renders/:id/cancel', async (req) => {
    cancelRender(req.params.id);
    return { ok: true };
  });

  // Forget a finished render (its video stays in the library).
  app.delete<{ Params: { id: string } }>('/api/renders/:id', async (req) => {
    const r = getRender(req.params.id);
    if (r.status === 'queued' || r.status === 'running') throw badRequest('Cancel the render first.');
    db.delete(schema.renders).where(eq(schema.renders.id, r.id)).run();
    emit({ type: 'changed', entity: 'renders', workspaceId: r.workspaceId, id: r.id, pieceId: r.pieceId });
    return { ok: true };
  });

  /**
   * The edit as a HyperFrames composition for the in-app player: preview copies of the footage (or a placeholder
   * while they're made) and the app's own copy of the HyperFrames runtime, so nothing loads from the internet.
   */
  app.get<{ Params: { id: string }; Querystring: { origin?: string } }>('/api/edits/:id/preview.html', async (req, reply) => {
    const edit = getEdit(req.params.id);
    // The Android app fetches this with its token and shows it as srcdoc on its own origin, so everything the page
    // loads needs this server's address (which it passes as ?origin=) and the token.
    const token = req.headers.authorization?.startsWith('Bearer ') ? bearerToken(req) : null;
    const origin = token && req.query.origin ? normalizeServer(req.query.origin) : null;
    const url = (path: string) => (token && origin ? `${origin}${path}?access_token=${encodeURIComponent(token)}` : path);
    const spec = normalizeEdit(edit.working);
    const rows = specMedia(spec);
    const byId = new Map(rows.map((m) => [m.id, m]));
    const source = (mediaId: string, mediaStart: number) => {
      const m = byId.get(mediaId);
      if (!m) return null;
      if (m.proxyStatus === 'done') return { src: url(`/api/media/${m.id}/proxy`), mediaStart };
      // Photos the browser can show as they are don't need to wait for their copy.
      if (m.kind === 'image' && !/heic|heif/i.test(m.mime)) return { src: url(`/api/media/${m.id}/file`), mediaStart: 0 };
      return null;
    };
    const { html } = composeEdit({
      spec,
      media: new Map(rows.map((m) => [m.id, m])),
      transcripts: await specTranscripts(spec, rows),
      clipSource: (i) => source(spec.clips[i].mediaId, spec.clips[i].in),
      brollSource: (i) => {
        const o = spec.overlays[i];
        return o.type === 'broll' ? source(o.mediaId, o.in) : null;
      },
      fileUrl: (id) => {
        const builtin = builtinSfx(id);
        return url(builtin ? `/api/studio/sfx/${builtin.name}.ogg` : `/api/media/${id}/file`);
      },
      fontUrl: (file) => url(`/api/studio/fonts/${file}`),
      scripts: [...GSAP_FILES.map((f) => url(`/api/studio/vendor/${f}`)), url('/api/studio/vendor/hyperframes-runtime.js')],
      preview: true,
      forApp: !!(token && origin),
    });
    return reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-store').send(html);
  });

  app.get<{ Params: { id: string } }>('/api/media/:id/proxy', async (req, reply) => {
    const m = getMedia(req.params.id);
    const path = proxyPath(m);
    if (!existsSync(path)) throw notFound('Preview copy isn’t ready yet');
    reply.header('Cache-Control', 'private, max-age=31536000, immutable');
    return reply.type(m.kind === 'image' ? 'image/jpeg' : 'video/mp4').sendFile(basename(path), dirname(path));
  });

  app.get<{ Params: { file: string } }>('/api/studio/vendor/:file', async (req, reply) => {
    const files: Record<string, string> = { ...Object.fromEntries(GSAP_FILES.map((f) => [f, gsapFilePath(f)])), 'hyperframes-runtime.js': runtimePath() };
    const path = files[req.params.file];
    if (!path) throw notFound();
    reply.header('Cache-Control', 'no-cache');
    return reply.type('text/javascript; charset=utf-8').sendFile(basename(path), dirname(path));
  });

  app.get<{ Params: { file: string } }>('/api/studio/fonts/:file', async (req, reply) => {
    if (!FONT_FILES.has(req.params.file)) throw notFound();
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    return reply.type('font/woff2').sendFile(req.params.file, join(config.assetsDir, 'fonts'));
  });

  // The app's own sound effects, for the preview and for listening in the editor and brand assets.
  app.get<{ Params: { file: string } }>('/api/studio/sfx/:file', async (req, reply) => {
    const name = req.params.file.replace(/\.ogg$/, '');
    if (!builtinSfx(builtinSfxId(name)) || !existsSync(builtinSfxPath(name))) throw notFound();
    reply.header('Cache-Control', 'public, max-age=86400');
    return reply.type('audio/ogg').sendFile(`${name}.ogg`, dirname(builtinSfxPath(name)));
  });

  // The built-in characters, to pick from in the editor.
  app.get<{ Params: { file: string } }>('/api/studio/characters/:file', async (req, reply) => {
    const look = req.params.file.replace(/\.svg$/, '');
    if (!CHARACTERS.some((c) => c.id === look)) throw notFound();
    reply.header('Cache-Control', 'public, max-age=86400');
    return reply.type('image/svg+xml').send(characterSvg(look as CharacterId).replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" '));
  });

  // Fix what Whisper heard, for captions and search.
  app.put<{ Params: { id: string } }>('/api/media/:id/transcript/range', async (req) => {
    const body = z.object({ start: z.number().min(0), end: z.number().min(0), text: z.string().max(5000) }).parse(req.body);
    if (body.end <= body.start) throw badRequest('Invalid range.');
    const t = await correctTranscript(req.params.id, body.start, body.end, body.text);
    // Captions in open editors come from the transcript.
    const m = getMedia(req.params.id);
    emit({ type: 'changed', entity: 'edits', workspaceId: m.workspaceId });
    return { text: t.text };
  });
}
