// What I give a card (takes, my voice, screenshots, products, footage), and the uploads that bring them.

import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { rm, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import type { Input, InputKind, InputRole, MediaMeta } from '../../../shared/types.ts';
import { config } from '../config.ts';
import { all, get, parseJson, run, tx } from '../db/db.ts';
import { enqueue } from '../jobs/queue.ts';
import { between, emit, HttpError, newId, notFound, now } from '../lib/util.ts';
import { getCard } from './board.ts';

type InputRow = {
  id: string;
  card_id: string;
  kind: InputKind;
  role: InputRole;
  name: string;
  mime: string;
  size: number;
  file: string;
  sha: string | null;
  meta: string | null;
  position: number;
  created_at: number;
};

const toInput = (r: InputRow): Input => ({
  id: r.id,
  cardId: r.card_id,
  kind: r.kind,
  role: r.role,
  name: r.name,
  mime: r.mime,
  size: r.size,
  meta: parseJson<MediaMeta | null>(r.meta, null),
  position: r.position,
  createdAt: r.created_at,
});

export const listInputs = (cardId: string) => all<InputRow>('SELECT * FROM inputs WHERE card_id = ? ORDER BY position', cardId).map(toInput);

export function getInput(id: string): Input {
  const r = get<InputRow>('SELECT * FROM inputs WHERE id = ?', id);
  if (!r) throw notFound('File');
  return toInput(r);
}

/** The file on disk. */
export function inputPath(id: string): string {
  const r = get<{ file: string }>('SELECT file FROM inputs WHERE id = ?', id);
  if (!r) throw notFound('File');
  return join(config.dataDir, r.file);
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

/** What a file most likely is for, from the card's recipe; Claude reads it as a hint, and I can change it. */
export function defaultRole(recipe: string, kind: InputKind): InputRole {
  if (kind === 'audio') return 'voice';
  if (kind === 'video') return ['voiceover', 'graded', 'explainer'].includes(recipe) ? 'broll' : 'take';
  if (kind === 'image') return ['carousel', 'ugc'].includes(recipe) ? 'product' : 'proof';
  return 'reference';
}

const roleSchema = z.enum(['take', 'voice', 'proof', 'product', 'broll', 'logo', 'reference']).nullable();

function cleanName(name: string) {
  return name.replace(/[/\\\0]/g, '_').slice(0, 200) || 'file';
}

/** Record a file that's already in place under the card's media folder, then look at it in the background. */
function addInput(cardId: string, id: string, file: string, name: string, mime: string, role: InputRole): Input {
  const card = getCard(cardId);
  const kind = kindOf(mime, name);
  const size = statSync(join(config.dataDir, file)).size;
  const last = get<{ p: number | null }>('SELECT MAX(position) AS p FROM inputs WHERE card_id = ?', cardId)?.p ?? null;
  run(
    'INSERT INTO inputs (id, card_id, kind, role, name, mime, size, file, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id,
    cardId,
    kind,
    role ?? defaultRole(card.recipe, kind),
    cleanName(name),
    mime || 'application/octet-stream',
    size,
    file,
    between(last, null),
    now(),
  );
  run('UPDATE cards SET updated_at = ? WHERE id = ?', now(), cardId);
  if (kind === 'video' || kind === 'audio' || kind === 'image') enqueue('look', { cardId, input: { inputId: id } });
  emit('input', id, cardId);
  emit('card', cardId, cardId);
  return getInput(id);
}

function mediaFile(cardId: string, id: string, name: string) {
  const ext = extname(name).toLowerCase().replace(/[^.a-z0-9]/g, '').slice(0, 8);
  mkdirSync(join(config.mediaDir, cardId), { recursive: true });
  return join('media', cardId, `${id}${ext}`);
}

/** One request with the whole file as its body (the laptop's drop, the CLI). */
export async function saveStream(cardId: string, body: Readable, name: string, mime: string, role: InputRole): Promise<Input> {
  getCard(cardId);
  const id = newId();
  const file = mediaFile(cardId, id, name);
  const abs = join(config.dataDir, file);
  try {
    await pipeline(body, createWriteStream(abs));
  } catch (err) {
    await rm(abs, { force: true });
    throw err;
  }
  return addInput(cardId, id, file, name, mime, role);
}

/** A file the engine made or found (stock, a cut-out) kept as one of the card's inputs. */
export function adoptFile(cardId: string, path: string, name: string, mime: string, role: InputRole): Input {
  const id = newId();
  const file = mediaFile(cardId, id, name);
  renameSync(path, join(config.dataDir, file));
  return addInput(cardId, id, file, name, mime, role);
}

export const inputPatch = z.object({ role: roleSchema.optional(), name: z.string().trim().min(1).max(200).optional(), position: z.number().optional() });

export function updateInput(id: string, input: unknown): Input {
  const patch = inputPatch.parse(input);
  const cur = getInput(id);
  run('UPDATE inputs SET role = ?, name = ?, position = ? WHERE id = ?', patch.role === undefined ? cur.role : patch.role, patch.name ?? cur.name, patch.position ?? cur.position, id);
  emit('input', id, cur.cardId);
  emit('card', cur.cardId, cur.cardId);
  return getInput(id);
}

export async function deleteInput(id: string) {
  const path = inputPath(id);
  const cur = getInput(id);
  run('DELETE FROM inputs WHERE id = ?', id);
  await rm(path, { force: true });
  emit('input', id, cur.cardId);
  emit('card', cur.cardId, cur.cardId);
}

export function setInputMeta(id: string, meta: MediaMeta, sha: string | null) {
  const cur = getInput(id);
  run('UPDATE inputs SET meta = ?, sha = COALESCE(?, sha) WHERE id = ?', JSON.stringify(meta), sha, id);
  emit('input', id, cur.cardId);
}

// ---------------------------------------------------------------- resumable uploads (the phone)

type UploadRow = { id: string; card_id: string; role: InputRole; name: string; mime: string; size: number; received: number; file: string; input_id: string | null; created_at: number; updated_at: number };

export const uploadStart = z.object({
  cardId: z.string().optional(),
  // The Android app before the new screens sends the old names.
  pieceId: z.string().optional(),
  role: roleSchema.optional(),
  assetType: z.string().optional().nullable(),
  name: z.string().min(1).max(300),
  mime: z.string().max(200).default('application/octet-stream'),
  size: z.number().int().min(0).max(64 * 1024 ** 3),
});

export function startUpload(input: unknown): { id: string; offset: number } {
  const u = uploadStart.parse(input);
  const cardId = u.cardId ?? u.pieceId;
  if (!cardId) throw new HttpError(400, 'Which card is it for?');
  getCard(cardId);
  const id = newId();
  const file = join(config.uploadsDir, `${id}.part`);
  writeFileSync(file, '');
  run('INSERT INTO uploads (id, card_id, role, name, mime, size, received, file, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)', id, cardId, u.role ?? null, u.name, u.mime, u.size, file, now(), now());
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
    if (received < r.size) return { offset: received, mediaId: null };
    const input = tx(() => {
      const inputId = newId();
      const file = mediaFile(r.card_id, inputId, r.name);
      renameSync(r.file, join(config.dataDir, file));
      const made = addInput(r.card_id, inputId, file, r.name, r.mime, r.role);
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
