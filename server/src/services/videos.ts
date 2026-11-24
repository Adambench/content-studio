// Videos (and carousels): one folder each in ~/studio/<page>/<video>, one Claude Code session, one thread. Status is
// never stored: it comes from what's happening (a run, an upload, approved, posted).

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { KINDS, type JobStatus, type Kind, type Page, type Video, type VideoStatus, type VideoSummary } from '../../../shared/types.ts';
import { config } from '../config.ts';
import { all, get, run } from '../db/db.ts';
import { emit, HttpError, newId, notFound, now } from '../lib/util.ts';
import { pageDir, ensurePageFiles, getPage, slugify } from './pages.ts';
import { addThread, lastSaid } from './thread.ts';

type VideoRow = {
  id: string;
  page_id: string;
  slug: string;
  title: string;
  kind: Kind;
  session_id: string | null;
  approved_n: number | null;
  posted_at: number | null;
  caption: string;
  make_at_inputs: number | null;
  seen_at: number;
  created_at: number;
  updated_at: number;
};

const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The video's folder. Only ever built from slugs the app made, so it can't point outside ~/studio. */
export function videoDir(v: { page_id?: string; pageId?: string; slug: string }): string {
  const page = getPage((v.page_id ?? v.pageId)!);
  if (!SLUG.test(v.slug) || !SLUG.test(page.slug)) throw new HttpError(500, 'Bad folder name');
  return join(pageDir(page), v.slug);
}

function row(id: string): VideoRow {
  const r = get<VideoRow>('SELECT * FROM videos WHERE id = ?', id);
  if (!r) throw notFound('Video');
  return r;
}

/** Did Claude save version n after my last message (so that's what's waiting, not its words)? */
function newerThanMyLast(videoId: string, n: number): boolean {
  const mine = get<{ seq: number }>("SELECT MAX(rowid) AS seq FROM thread WHERE video_id = ? AND kind = 'you'", videoId)?.seq ?? 0;
  const saved = get<{ seq: number }>("SELECT MAX(rowid) AS seq FROM thread WHERE video_id = ? AND kind = 'version' AND json_extract(data, '$.n') = ?", videoId, n)?.seq ?? 0;
  return saved > mine;
}

function summarize(r: VideoRow): VideoSummary {
  const latest = get<{ id: string; n: number; kind: 'video' | 'carousel'; duration: number | null; slides: number }>('SELECT id, n, kind, duration, slides FROM versions WHERE video_id = ? ORDER BY n DESC LIMIT 1', r.id) ?? null;
  const openNotes = get<{ c: number }>("SELECT COUNT(*) AS c FROM notes WHERE video_id = ? AND status = 'open'", r.id)?.c ?? 0;
  const job = get<{ id: string; status: JobStatus; step: string | null; progress: number }>("SELECT id, status, step, progress FROM jobs WHERE video_id = ? AND kind = 'agent' AND status IN ('queued', 'waiting', 'running') ORDER BY created_at DESC LIMIT 1", r.id) ?? null;
  const uploading = get<{ c: number }>('SELECT COUNT(*) AS c FROM uploads WHERE video_id = ? AND input_id IS NULL AND updated_at > ?', r.id, now() - 15 * 60_000)?.c ?? 0;
  const status: VideoStatus = r.posted_at ? 'posted' : r.approved_n ? (r.kind === 'page' ? 'done' : 'ready') : job || uploading ? 'making' : 'turn';
  const said = lastSaid(r.id);
  let reason = '';
  if (status === 'making') reason = job ? (job.status === 'waiting' ? 'Waiting for Claude’s usage window' : job.step || 'Claude is on it') : `Uploading ${uploading} file${uploading > 1 ? 's' : ''}`;
  else if (status === 'ready') reason = `v${r.approved_n} approved`;
  else if (status === 'done') reason = `Set up (v${r.approved_n})`;
  else if (status === 'posted') reason = 'Posted';
  else if (said?.kind === 'question' && said.data.picked == null) reason = `Claude asks: ${said.text}`;
  else if (said?.kind === 'error') reason = `Stopped: ${said.text}`;
  else if (latest && newerThanMyLast(r.id, latest.n)) reason = `v${latest.n} ready`;
  else if (said?.kind === 'claude') reason = said.text.split('\n')[0]!.slice(0, 90);
  else if (latest) reason = `v${latest.n} ready`;
  else {
    const files = get<{ c: number }>('SELECT COUNT(*) AS c FROM inputs WHERE video_id = ?', r.id)?.c ?? 0;
    reason = files ? `${files} file${files > 1 ? 's' : ''} · say go` : 'New';
  }
  const newest = get<{ created_at: number }>("SELECT created_at FROM thread WHERE video_id = ? AND kind IN ('claude', 'question', 'version', 'error') ORDER BY rowid DESC LIMIT 1", r.id);
  return {
    id: r.id,
    pageId: r.page_id,
    slug: r.slug,
    title: r.title,
    kind: r.kind,
    status,
    reason,
    unseen: !!newest && newest.created_at > r.seen_at,
    latest,
    openNotes,
    job,
    uploading,
    approvedN: r.approved_n,
    postedAt: r.posted_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function listVideos(opts: { pageId?: string } = {}): VideoSummary[] {
  const rows = opts.pageId ? all<VideoRow>('SELECT * FROM videos WHERE page_id = ? ORDER BY updated_at DESC', opts.pageId) : all<VideoRow>('SELECT * FROM videos ORDER BY updated_at DESC');
  return rows.map(summarize);
}

export function getVideo(id: string): Video {
  const r = row(id);
  return { ...summarize(r), caption: r.caption, makeAtInputs: r.make_at_inputs, sessionId: r.session_id, folder: videoDir(r) };
}

/** A title from what I typed: its first sentence, at most 60 characters. */
export function titleFrom(text: string): string {
  const first = text.replace(/^\/\S+\s*/, '').split(/[.!?\n]/)[0]!.trim();
  const t = first.length > 60 ? `${first.slice(0, 58).replace(/\s\S*$/, '')}…` : first;
  return t ? t[0]!.toUpperCase() + t.slice(1) : 'Untitled';
}

const videoInput = z.object({ pageId: z.string(), title: z.string().trim().max(120).optional(), text: z.string().max(20_000).optional(), kind: z.enum(KINDS).default('auto') });

/** Folder names a page keeps for itself: its setup and its look. */
const RESERVED = new Set(['setup', 'kit']);

/** A free folder name in the page: taken by no video, no folder on disk, nothing reserved. */
function freeSlug(page: Page, base: string): string {
  let slug = base;
  for (let i = 2; RESERVED.has(slug) || get('SELECT 1 FROM videos WHERE page_id = ? AND slug = ?', page.id, slug) || existsSync(join(pageDir(page), slug)); i++) slug = `${base}-${i}`;
  return slug;
}

function insert(page: Page, slug: string, title: string, kind: Kind, about: string): string {
  const id = newId();
  run('INSERT INTO videos (id, page_id, slug, title, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, page.id, slug, title, kind, now(), now());
  const dir = videoDir({ page_id: page.id, slug });
  for (const sub of ['files', 'work', 'renders']) mkdirSync(join(dir, sub), { recursive: true });
  writeFileSync(join(dir, 'project.md'), `# ${title}\n\n${about} Claude keeps this file: the decisions made, what's left.\n`);
  emit('video', id, id);
  return id;
}

export function createVideo(input: unknown): Video {
  const v = videoInput.parse(input);
  const page = getPage(v.pageId);
  ensurePageFiles(page);
  const title = v.title || titleFrom(v.text ?? '');
  return getVideo(insert(page, freeSlug(page, slugify(title, 'video')), title, v.kind, `A video for ${page.name}.`));
}

/** The page's own studio (one per page, in setup/): Claude sets the page up there with me, like a video. */
export function ensureSetup(pageId: string): Video {
  const page = getPage(pageId);
  if (page.setupId) return getVideo(page.setupId);
  ensurePageFiles(page);
  // setup/ unless a video from before pages had setups took the name (a folder left on disk is reused).
  const slug = get('SELECT 1 FROM videos WHERE page_id = ? AND slug = ?', page.id, 'setup') ? freeSlug(page, 'setup') : 'setup';
  const id = insert(page, slug, 'Page setup', 'page', `The setup of ${page.name}: what I gave is in files/; the page's brain is ../CLAUDE.md and its look ../kit/.`);
  emit('page', page.id);
  return getVideo(id);
}

const videoPatch = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  kind: z.enum(KINDS).optional(),
  caption: z.string().max(5000).optional(),
  pageId: z.string().optional(),
});

export function updateVideo(id: string, input: unknown): Video {
  const patch = videoPatch.parse(input);
  const cur = row(id);
  if (cur.kind === 'page' && ((patch.pageId && patch.pageId !== cur.page_id) || patch.kind)) throw new HttpError(409, 'A page’s setup stays with its page');
  if (patch.pageId && patch.pageId !== cur.page_id) moveToPage(cur, patch.pageId);
  run('UPDATE videos SET title = ?, kind = ?, caption = ?, updated_at = ? WHERE id = ?', patch.title ?? cur.title, patch.kind ?? cur.kind, patch.caption ?? cur.caption, now(), id);
  emit('video', id, id);
  return getVideo(id);
}

/** Its folder moves with it; Claude's session belonged to the old folder, so the next message starts a new one. */
function moveToPage(cur: VideoRow, pageId: string) {
  const page = getPage(pageId);
  ensurePageFiles(page);
  const slug = freeSlug(page, cur.slug);
  renameSync(videoDir(cur), videoDir({ page_id: page.id, slug }));
  run('UPDATE videos SET page_id = ?, slug = ?, session_id = NULL WHERE id = ?', page.id, slug, cur.id);
  addThread(cur.id, 'sys', `Moved to ${page.name}. Claude starts a new session there (project.md keeps what it knew).`);
}

export function setSession(id: string, sessionId: string | null) {
  run('UPDATE videos SET session_id = ? WHERE id = ?', sessionId, id);
}

export function setMakeAtInputs(id: string, count: number | null) {
  row(id);
  run('UPDATE videos SET make_at_inputs = ? WHERE id = ?', count, id);
  emit('video', id, id);
}

export function markSeen(id: string) {
  row(id);
  run('UPDATE videos SET seen_at = ? WHERE id = ?', now(), id);
  emit('video', id, id);
}

export function approveVideo(id: string, n: number): Video {
  row(id);
  if (!get('SELECT 1 FROM versions WHERE video_id = ? AND n = ?', id, n)) throw new HttpError(400, `There's no v${n}`);
  if (get("SELECT 1 FROM notes WHERE video_id = ? AND status IN ('open', 'sent')", id)) throw new HttpError(409, 'Fix or drop the open notes first');
  run('UPDATE videos SET approved_n = ?, updated_at = ? WHERE id = ?', n, now(), id);
  addThread(id, 'sys', `You approved v${n}`);
  return getVideo(id);
}

/** A new run after Approve means it's being changed: no longer approved. */
export function clearApproval(id: string) {
  const r = row(id);
  if (r.approved_n == null || r.posted_at) return;
  run('UPDATE videos SET approved_n = NULL WHERE id = ?', id);
  emit('video', id, id);
}

export function setPosted(id: string, posted: boolean): Video {
  const r = row(id);
  if (r.kind === 'page') throw new HttpError(409, 'A page’s setup isn’t posted');
  if (posted && r.approved_n == null) throw new HttpError(409, 'Approve a version first');
  run('UPDATE videos SET posted_at = ?, updated_at = ? WHERE id = ?', posted ? now() : null, now(), id);
  addThread(id, 'sys', posted ? 'Posted' : 'Back from Posted');
  return getVideo(id);
}

/** The script Claude and I share: script.md in the video's folder ('' when there's none yet). */
export function readScript(id: string): string {
  const f = join(videoDir(row(id)), 'script.md');
  return existsSync(f) ? readFileSync(f, 'utf8') : '';
}

export function writeScript(id: string, text: string) {
  writeFileSync(join(videoDir(row(id)), 'script.md'), text.endsWith('\n') || !text ? text : `${text}\n`);
  run('UPDATE videos SET updated_at = ? WHERE id = ?', now(), id);
  emit('video', id, id);
}

/** The video, its rows and its folder. */
export function deleteVideo(id: string) {
  const r = row(id);
  const dir = videoDir(r);
  for (const u of all<{ file: string }>('SELECT file FROM uploads WHERE video_id = ? AND input_id IS NULL', id)) rmSync(u.file, { force: true });
  run('DELETE FROM uploads WHERE video_id = ?', id);
  run('DELETE FROM videos WHERE id = ?', id);
  if (dir.startsWith(config.studioDir + '/') && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  emit('video', id, id);
}
