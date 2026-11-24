// A video's conversation with Claude, in the order things happened.

import type { ThreadItem, ThreadKind } from '../../../shared/types.ts';
import { all, get, parseJson, run } from '../db/db.ts';
import { emit, newId, notFound, now } from '../lib/util.ts';

type ThreadRow = { id: string; video_id: string; job_id: string | null; kind: ThreadKind; text: string; data: string; created_at: number };

const toItem = (r: ThreadRow): ThreadItem => ({ id: r.id, videoId: r.video_id, jobId: r.job_id, kind: r.kind, text: r.text, data: parseJson<Record<string, unknown>>(r.data, {}), createdAt: r.created_at });

/** The newest `limit` items, oldest first. */
export function listThread(videoId: string, limit = 400): ThreadItem[] {
  return all<ThreadRow>('SELECT * FROM (SELECT rowid AS seq, * FROM thread WHERE video_id = ? ORDER BY rowid DESC LIMIT ?) ORDER BY seq', videoId, limit).map(toItem);
}

export function addThread(videoId: string, kind: ThreadKind, text: string, data: Record<string, unknown> = {}, jobId: string | null = null): ThreadItem {
  const id = newId();
  run('INSERT INTO thread (id, video_id, job_id, kind, text, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, videoId, jobId, kind, text.slice(0, 20_000), JSON.stringify(data), now());
  run('UPDATE videos SET updated_at = ? WHERE id = ?', now(), videoId);
  emit('thread', id, videoId);
  emit('video', videoId, videoId);
  return getThreadItem(id);
}

export function getThreadItem(id: string): ThreadItem {
  const r = get<ThreadRow>('SELECT * FROM thread WHERE id = ?', id);
  if (!r) throw notFound('Message');
  return toItem(r);
}

export function updateThreadData(id: string, data: Record<string, unknown>) {
  const cur = getThreadItem(id);
  run('UPDATE thread SET data = ? WHERE id = ?', JSON.stringify({ ...cur.data, ...data }), id);
  emit('thread', id, cur.videoId);
  emit('video', cur.videoId, cur.videoId);
}

/** The last item Claude or I added that says what's waiting (not steps or tool calls). */
export function lastSaid(videoId: string): ThreadItem | null {
  const r = get<ThreadRow>("SELECT * FROM thread WHERE video_id = ? AND kind IN ('you', 'claude', 'question', 'version', 'error', 'sys') ORDER BY rowid DESC LIMIT 1", videoId);
  return r ? toItem(r) : null;
}
