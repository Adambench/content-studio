// What I give a video (takes, my voice, screenshots, products, footage), in its files/ folder, and the uploads
// that bring them. A file keeps its own name there (made unique), so Claude and the terminal see real names.

import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import type { Input, InputKind, InputRole, MediaMeta } from '../../../shared/types.ts';
import { config } from '../config.ts';
import { all, get, parseJson, run, tx } from '../db/db.ts';
import { enqueue } from '../jobs/queue.ts';
import { between, emit, HttpError, newId, notFound, now } from '../lib/util.ts';
import { getVideo, videoDir } from './videos.ts';

type InputRow = {
  id: string;
  video_id: string;
  kind: InputKind;
  role: InputRole;
  name: string;
  mime: string;
  size: number;
  sha: string | null;
  meta: string | null;
  position: number;
  created_at: number;
};

const toInput = (r: InputRow): Input => ({
  id: r.id,
  videoId: r.video_id,
  kind: r.kind,
  role: r.role,
  name: r.name,
  mime: r.mime,
  size: r.size,
  meta: parseJson<MediaMeta | null>(r.meta, null),
  position: r.position,
  createdAt: r.created_at,
});

export const listInputs = (videoId: string) => all<InputRow>('SELECT * FROM inputs WHERE video_id = ? ORDER BY position', videoId).map(toInput);

export function getInput(id: string): Input {
  const r = get<InputRow>('SELECT * FROM inputs WHERE id = ?', id);
  if (!r) throw notFound('File');
  return toInput(r);
}

/** The file on disk: <video folder>/files/<name>. */
export function inputPath(id: string): string {
  const r = get<{ video_id: string; name: string }>('SELECT video_id, name FROM inputs WHERE id = ?', id);
  if (!r) throw notFound('File');
  return join(videoDir(getVideo(r.video_id)), 'files', r.name);
}

export function kindOf(mime: string, name: string): InputKind {
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('image/')) return 'image';
  const ext = extname(name).toLowerCase();
  if (['.mp4', '.mov', '.mkv', '.webm', '.m4v'].includes(ext)) return 'video';
  if (['.m4a', '.mp3', '.wav', '.ogg', '.opus', '.aac', '.flac'].includes(ext)) return 'audio';
  if (['.png', '.jpg', '.jpeg', '.webp', '.heic', '.gif', '.avif'].includes(ext)) return 'image';
  if (['.pdf', '.txt', '.md', '.docx'].includes(ext)) return 'doc';
  return 'other';
}

/** What a file most likely is for; Claude reads it as a hint and may say otherwise. */
export function defaultRole(kind: InputKind): InputRole {
  if (kind === 'audio') return 'voice';
  if (kind === 'video') return 'take';
  if (kind === 'image') return 'proof';
  return 'reference';
}

const roleSchema = z.enum(['take', 'voice', 'proof', 'product', 'broll', 'logo', 'reference']).nullable();

function cleanName(name: string) {
  return basename(name).replace(/[\\/\0]/g, '_').replace(/^\.+/, '').slice(0, 160) || 'file';
}

/** A free name in the video's files/ folder: take.mp4, then take-2.mp4… */
function freeName(videoId: string, name: string): string {
  const dir = join(videoDir(getVideo(videoId)), 'files');
  mkdirSync(dir, { recursive: true });
  const clean = cleanName(name);
  const ext = extname(clean);
  const stem = clean.slice(0, clean.length - ext.length) || 'file';
  let out = clean;
  for (let i = 2; existsSync(join(dir, out)) || get('SELECT 1 FROM inputs WHERE video_id = ? AND name = ?', videoId, out); i++) out = `${stem}-${i}${ext}`;
  return out;
}

/** Record a file that's already in place in the video's files/ folder, then look at it in the background. */
function addInput(videoId: string, id: string, name: string, mime: string, role: InputRole): Input {
  const kind = kindOf(mime, name);
  const video = getVideo(videoId);
  const size = statSync(join(videoDir(video), 'files', name)).size;
  const last = get<{ p: number | null }>('SELECT MAX(position) AS p FROM inputs WHERE video_id = ?', videoId)?.p ?? null;
  run(
    'INSERT INTO inputs (id, video_id, kind, role, name, mime, size, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id,
    videoId,
    kind,
    role ?? (video.kind === 'page' ? 'reference' : defaultRole(kind)),
    name,
    mime || 'application/octet-stream',
    size,
    between(last, null),
    now(),
  );
  run('UPDATE videos SET updated_at = ? WHERE id = ?', now(), videoId);
  if (kind === 'video' || kind === 'audio' || kind === 'image') enqueue('look', { videoId, input: { inputId: id } });
  emit('input', id, videoId);
  emit('video', videoId, videoId);
  for (const l of addedListeners) l(videoId);
  return getInput(id);
}

/** Who wants to know a file landed ("Add & make" starts Claude once they're all in). */
const addedListeners = new Set<(videoId: string) => void>();
export const onInputAdded = (fn: (videoId: string) => void) => addedListeners.add(fn);

/** One request with the whole file as its body (the laptop's drop, the CLI). */
export async function saveStream(videoId: string, body: Readable, name: string, mime: string, role: InputRole): Promise<Input> {
  getVideo(videoId);
  const id = newId();
  const file = freeName(videoId, name);
  const abs = join(videoDir(getVideo(videoId)), 'files', file);
  try {
    await pipeline(body, createWriteStream(abs));
  } catch (err) {
    await rm(abs, { force: true });
    throw err;
  }
  return addInput(videoId, id, file, mime, role);
}

export const inputPatch = z.object({ role: roleSchema.optional(), position: z.number().optional() });

export function updateInput(id: string, input: unknown): Input {
  const patch = inputPatch.parse(input);
  const cur = getInput(id);
  run('UPDATE inputs SET role = ?, position = ? WHERE id = ?', patch.role === undefined ? cur.role : patch.role, patch.position ?? cur.position, id);
  emit('input', id, cur.videoId);
  emit('video', cur.videoId, cur.videoId);
  return getInput(id);
}

export async function deleteInput(id: string) {
  const path = inputPath(id);
  const cur = getInput(id);
  run('DELETE FROM inputs WHERE id = ?', id);
  await rm(path, { force: true });
  emit('input', id, cur.videoId);
  emit('video', cur.videoId, cur.videoId);
}

export function setInputMeta(id: string, meta: MediaMeta, sha: string | null) {
  const cur = getInput(id);
  run('UPDATE inputs SET meta = ?, sha = COALESCE(?, sha) WHERE id = ?', JSON.stringify(meta), sha, id);
  emit('input', id, cur.videoId);
}

// ---------------------------------------------------------------- resumable uploads (the phone)

type UploadRow = { id: string; video_id: string; role: InputRole; name: string; mime: string; size: number; received: number; file: string; input_id: string | null; created_at: number; updated_at: number };

export const uploadStart = z.object({
  videoId: z.string().optional(),
  // The Android app's upload queue sends older names.
  cardId: z.string().optional(),
  pieceId: z.string().optional(),
  role: roleSchema.optional(),
  assetType: z.string().optional().nullable(),
  name: z.string().min(1).max(300),
  mime: z.string().max(200).default('application/octet-stream'),
  size: z.number().int().min(0).max(64 * 1024 ** 3),
});

export function startUpload(input: unknown): { id: string; offset: number } {
  const u = uploadStart.parse(input);
  const videoId = u.videoId ?? u.cardId ?? u.pieceId;
  if (!videoId) throw new HttpError(400, 'Which video is it for?');
  getVideo(videoId);
  const id = newId();
  const file = join(config.uploadsDir, `${id}.part`);
  writeFileSync(file, '');
  run('INSERT INTO uploads (id, video_id, role, name, mime, size, received, file, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)', id, videoId, u.role ?? null, u.name, u.mime, u.size, file, now(), now());
  emit('video', videoId, videoId);
  return { id, offset: 0 };
}

export function uploadState(id: string): { id: string; offset: number; size: number; mediaId: string | null } {
  const r = get<UploadRow>('SELECT * FROM uploads WHERE id = ?', id);
  if (!r) throw notFound('Upload');
  return { id, offset: r.received, size: r.size, mediaId: r.input_id };
}

const busy = new Set<string>();

/** One chunk at `offset`. Out of step (a retry overtook a slow request) → 409 with where the server is. */
export async function appendChunk(id: string, offset: number, body: Readable): Promise<{ offset: number; mediaId: string | null } & { conflict?: boolean }> {
  const r = get<UploadRow>('SELECT * FROM uploads WHERE id = ?', id);
  if (!r) throw notFound('Upload');
  if (r.input_id) return { offset: r.size, mediaId: r.input_id };
  if (busy.has(id) || offset !== r.received) {
    body.resume();
    return { offset: r.received, mediaId: null, conflict: true };
  }
  busy.add(id);
  try {
    await pipeline(body, createWriteStream(r.file, { flags: 'r+', start: offset }));
    const received = (await stat(r.file)).size;
    if (received > r.size) throw new HttpError(400, 'More bytes than the upload said');
    run('UPDATE uploads SET received = ?, updated_at = ? WHERE id = ?', received, now(), id);
    emit('video', r.video_id, r.video_id);
    if (received < r.size) return { offset: received, mediaId: null };
    const input = tx(() => {
      const inputId = newId();
      const name = freeName(r.video_id, r.name);
      renameSync(r.file, join(videoDir(getVideo(r.video_id)), 'files', name));
      const made = addInput(r.video_id, inputId, name, r.mime, r.role);
      run('UPDATE uploads SET input_id = ? WHERE id = ?', made.id, id);
      return made;
    });
    return { offset: r.size, mediaId: input.id };
  } finally {
    busy.delete(id);
  }
}

/** Uploads untouched for a week are dropped (the phone starts them again). */
export async function sweepUploads() {
  const old = all<UploadRow>('SELECT * FROM uploads WHERE updated_at < ?', now() - 7 * 24 * 3600_000);
  for (const u of old) {
    if (!u.input_id && existsSync(u.file)) await rm(u.file, { force: true });
    run('DELETE FROM uploads WHERE id = ?', u.id);
  }
}
