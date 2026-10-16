import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { eq } from 'drizzle-orm';
import type { AssetType, MediaKind, Transcript, TranscriptWord } from '../../../shared/types';
import { config } from '../config';
import { db, newId, schema } from '../db';
import { emit } from '../lib/events';
import { badRequest, notFound } from '../lib/http';
import { enqueue } from '../jobs/queue';
import { workerFor } from '../compute/workers';

export type MediaRow = typeof schema.media.$inferSelect;
export type UploadedFile = { stream: Readable; filename: string; mimetype: string };

export function kindFromMime(mime: string, name: string): MediaKind {
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  const ext = extname(name).toLowerCase();
  if (['.mp4', '.mov', '.mkv', '.webm', '.m4v'].includes(ext)) return 'video';
  if (['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.avif'].includes(ext)) return 'image';
  if (['.mp3', '.wav', '.m4a', '.aac', '.ogg', '.opus', '.flac'].includes(ext)) return 'audio';
  return 'other';
}

export const mediaPath = (m: Pick<MediaRow, 'workspaceId' | 'fileName'>) => join(config.mediaDir, m.workspaceId, m.fileName);
export const thumbPath = (id: string) => join(config.thumbsDir, `${id}.jpg`);
export const transcriptPath = (id: string) => join(config.transcriptsDir, `${id}.json`);
const proxyFiles = (id: string) => [join(config.proxiesDir, `${id}.mp4`), join(config.proxiesDir, `${id}.jpg`)];

export function getMedia(id: string) {
  const row = db.select().from(schema.media).where(eq(schema.media.id, id)).get();
  if (!row) throw notFound('File not found');
  return row;
}

type MediaOptions = {
  pieceId?: string | null;
  assetType?: AssetType | null;
  source?: 'upload' | 'capture' | 'share' | 'clip' | 'tts' | 'generated';
  /** Already transcribed (a clip's cut): saved with it, so it isn't transcribed again. */
  transcript?: Transcript;
};

export async function saveUpload(workspaceId: string, file: UploadedFile, opts: MediaOptions = {}) {
  return addMedia(workspaceId, file.filename, file.mimetype, opts, (dest) => pipeline(file.stream, createWriteStream(dest)));
}

/** Move a file that's already in the data folder (a finished resumable upload) into the library. */
export async function adoptFile(workspaceId: string, path: string, name: string, mime: string, opts: MediaOptions = {}) {
  return addMedia(workspaceId, name, mime, opts, (dest) => rename(path, dest));
}

async function addMedia(workspaceId: string, filename: string, mimetype: string, opts: MediaOptions, write: (dest: string) => Promise<unknown>) {
  const id = newId();
  const ext = extname(filename).toLowerCase().replace(/[^.a-z0-9]/g, '') || '';
  const fileName = `${id}${ext}`;
  const dir = join(config.mediaDir, workspaceId);
  await mkdir(dir, { recursive: true });
  const dest = join(dir, fileName);
  try {
    await write(dest);
  } catch (err) {
    await rm(dest, { force: true });
    throw err;
  }
  const { size } = await stat(dest);
  if (opts.transcript) await writeFile(transcriptPath(id), JSON.stringify(opts.transcript));
  const row = {
    id,
    workspaceId,
    pieceId: opts.pieceId ?? null,
    kind: kindFromMime(mimetype, filename),
    assetType: opts.assetType ?? null,
    source: opts.source ?? 'upload',
    originalName: filename || fileName,
    fileName,
    mime: mimetype || 'application/octet-stream',
    size,
    ...(opts.transcript && { transcriptStatus: 'done' as const, transcriptText: opts.transcript.text, transcriptLang: opts.transcript.language }),
  };
  db.insert(schema.media).values(row).run();
  if (row.kind !== 'other') enqueue('media.probe', { mediaId: id });
  emit({ type: 'changed', entity: 'media', workspaceId, id });
  if (row.pieceId) emit({ type: 'changed', entity: 'pieces', workspaceId, id: row.pieceId });
  return getMedia(id);
}

export async function deleteMedia(id: string) {
  const row = getMedia(id);
  db.delete(schema.media).where(eq(schema.media.id, id)).run();
  // The speaker scan (studio/reframe.ts) is kept beside the frames.
  const scan = join(config.framesDir, `speakers-${id}.json`);
  await Promise.all([mediaPath(row), thumbPath(id), transcriptPath(id), scan, ...proxyFiles(id)].map((p) => rm(p, { force: true })));
  emit({ type: 'changed', entity: 'media', workspaceId: row.workspaceId, id });
  if (row.pieceId) emit({ type: 'changed', entity: 'pieces', workspaceId: row.workspaceId, id: row.pieceId });
}

export async function readTranscript(id: string): Promise<Transcript | null> {
  const path = transcriptPath(id);
  if (!existsSync(path)) return null;
  return JSON.parse(await readFile(path, 'utf8')) as Transcript;
}

/**
 * Replace what was said between `start` and `end` (source seconds) with corrected text — fixing Whisper's mistakes
 * for captions and search. Word timings are kept when the word count matches, otherwise spread by length.
 */
export async function correctTranscript(id: string, start: number, end: number, text: string) {
  const row = getMedia(id);
  const t = await readTranscript(id);
  if (!t) throw badRequest('This file has no transcript.');
  const hits: { seg: number; word: TranscriptWord }[] = [];
  t.segments.forEach((s, seg) => s.words?.forEach((word) => (word.start + word.end) / 2 >= start && (word.start + word.end) / 2 < end && hits.push({ seg, word })));
  if (!hits.length) throw badRequest('No words were transcribed in that part.');
  const next = text.split(/\s+/).filter(Boolean);
  const from = hits[0].word.start;
  const to = hits[hits.length - 1].word.end;
  let words: TranscriptWord[];
  if (next.length === hits.length) words = hits.map((h, i) => ({ ...h.word, word: ` ${next[i]}` }));
  else {
    const chars = next.reduce((n, w) => n + w.length + 1, 0) || 1;
    let at = from;
    words = next.map((w) => {
      const len = ((to - from) * (w.length + 1)) / chars;
      const word = { start: Math.round(at * 1000) / 1000, end: Math.round((at + len) * 1000) / 1000, word: ` ${w}` };
      at += len;
      return word;
    });
  }
  const drop = new Set(hits.map((h) => h.word));
  t.segments.forEach((s) => (s.words = s.words?.filter((w) => !drop.has(w))));
  const target = t.segments[hits[0].seg];
  target.words = [...(target.words ?? []), ...words].sort((a, b) => a.start - b.start);
  for (const s of t.segments) if (s.words) s.text = s.words.map((w) => w.word).join('').trim();
  t.segments = t.segments.filter((s) => s.text.trim() || !s.words);
  t.text = t.segments.map((s) => s.text.trim()).join(' ');
  await writeFile(transcriptPath(id), JSON.stringify(t));
  db.update(schema.media).set({ transcriptText: t.text }).where(eq(schema.media.id, id)).run();
  emit({ type: 'changed', entity: 'media', workspaceId: row.workspaceId, id });
  return t;
}

/** Whisper is here, or on a compute worker that's online (shared/compute.ts). */
export const whisperInstalled = () => existsSync(config.whisperPython) || workerFor('transcribe');

export function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
