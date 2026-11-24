// My notes on a version: pinned to a moment (or a slide), collected, then sent to Claude together by Fix.

import { z } from 'zod';
import type { Note, NoteStatus } from '../../../shared/types.ts';
import { all, get, run } from '../db/db.ts';
import { emit, HttpError, newId, notFound, now } from '../lib/util.ts';

type NoteRow = { id: string; video_id: string; version_n: number; at: number | null; slide: number | null; text: string; status: NoteStatus; fixed_in: number | null; reply: string | null; created_at: number; resolved_at: number | null };

const toNote = (r: NoteRow): Note => ({ id: r.id, videoId: r.video_id, versionN: r.version_n, at: r.at, slide: r.slide, text: r.text, status: r.status, fixedIn: r.fixed_in, reply: r.reply, createdAt: r.created_at, resolvedAt: r.resolved_at });

export const listNotes = (videoId: string) => all<NoteRow>('SELECT * FROM notes WHERE video_id = ? ORDER BY created_at', videoId).map(toNote);
export const openNotes = (videoId: string) => all<NoteRow>("SELECT * FROM notes WHERE video_id = ? AND status = 'open' ORDER BY created_at", videoId).map(toNote);

export function getNote(id: string): Note {
  const r = get<NoteRow>('SELECT * FROM notes WHERE id = ?', id);
  if (!r) throw notFound('Note');
  return toNote(r);
}

const noteInput = z.object({ versionN: z.number().int().min(1), at: z.number().min(0).nullable().optional(), slide: z.number().int().min(1).nullable().optional(), text: z.string().trim().min(1).max(2000) });

export function addNote(videoId: string, input: unknown): Note {
  const n = noteInput.parse(input);
  if (!get('SELECT 1 FROM versions WHERE video_id = ? AND n = ?', videoId, n.versionN)) throw new HttpError(400, `There's no v${n.versionN}`);
  const id = newId();
  run('INSERT INTO notes (id, video_id, version_n, at, slide, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, videoId, n.versionN, n.at ?? null, n.slide ?? null, n.text, now());
  touched(videoId, id);
  return getNote(id);
}

const notePatch = z.object({ text: z.string().trim().min(1).max(2000).optional(), status: z.enum(['open', 'fixed']).optional() });

export function updateNote(id: string, input: unknown): Note {
  const patch = notePatch.parse(input);
  const cur = getNote(id);
  const status = patch.status ?? cur.status;
  run('UPDATE notes SET text = ?, status = ?, resolved_at = ? WHERE id = ?', patch.text ?? cur.text, status, status === 'fixed' ? (cur.resolvedAt ?? now()) : null, id);
  touched(cur.videoId, id);
  return getNote(id);
}

export function deleteNote(id: string) {
  const cur = getNote(id);
  run('DELETE FROM notes WHERE id = ?', id);
  touched(cur.videoId, id);
}

/** Fix: the open notes are with Claude now. */
export function markSent(ids: string[]) {
  for (const id of ids) {
    const cur = getNote(id);
    run("UPDATE notes SET status = 'sent' WHERE id = ? AND status = 'open'", id);
    touched(cur.videoId, id);
  }
}

/** Claude says these are fixed in a version (its `notes_fixed` tool). */
export function markFixed(videoId: string, ids: string[], fixedIn: number, reply: string | null) {
  for (const id of ids) {
    const cur = get<NoteRow>('SELECT * FROM notes WHERE id = ? AND video_id = ?', id, videoId);
    if (!cur) continue;
    run("UPDATE notes SET status = 'fixed', fixed_in = ?, reply = ?, resolved_at = ? WHERE id = ?", fixedIn, reply, now(), id);
    touched(videoId, id);
  }
}

/** A run that stopped leaves its notes open again, so Fix can send them once more. */
export function reopenSent(videoId: string) {
  run("UPDATE notes SET status = 'open' WHERE video_id = ? AND status = 'sent'", videoId);
  emit('video', videoId, videoId);
}

function touched(videoId: string, id: string) {
  run('UPDATE videos SET updated_at = ? WHERE id = ?', now(), videoId);
  emit('note', id, videoId);
  emit('video', videoId, videoId);
}
