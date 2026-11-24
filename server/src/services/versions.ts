// Versions (each thing Claude or I saved: a plan, its project folder, its slides) and their renders.

import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Author, Render, RenderStatus, Version, VersionKind } from '../../../shared/types.ts';
import { config } from '../config.ts';
import { all, get, parseJson, run, tx } from '../db/db.ts';
import { emit, newId, notFound, now } from '../lib/util.ts';
import { getCard } from './board.ts';

type VersionRow = { id: string; card_id: string; n: number; author: Author; kind: VersionKind; recipe: string; note: string; plan: string; project: string | null; slides: number; created_at: number };

const toVersion = (r: VersionRow): Version => ({ id: r.id, cardId: r.card_id, n: r.n, author: r.author, kind: r.kind, recipe: r.recipe, note: r.note, slides: r.slides, createdAt: r.created_at });

export const listVersions = (cardId: string) => all<VersionRow>('SELECT * FROM versions WHERE card_id = ? ORDER BY n DESC', cardId).map(toVersion);

export function getVersion(id: string): Version {
  const r = get<VersionRow>('SELECT * FROM versions WHERE id = ?', id);
  if (!r) throw notFound('Version');
  return toVersion(r);
}

export function versionPlan<T>(id: string, fallback: T): T {
  return parseJson(get<{ plan: string }>('SELECT plan FROM versions WHERE id = ?', id)?.plan, fallback);
}

/** The version's own folder (its HyperFrames project or its slides). */
export function projectDir(v: { id: string; cardId: string; n: number }): string {
  const dir = join(config.projectsDir, v.cardId, `v${v.n}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function latestVersion(cardId: string): Version | null {
  const r = get<VersionRow>('SELECT * FROM versions WHERE card_id = ? ORDER BY n DESC LIMIT 1', cardId);
  return r ? toVersion(r) : null;
}

export function createVersion(input: { cardId: string; author: Author; kind: VersionKind; recipe: string; note: string; plan: unknown }): Version {
  getCard(input.cardId);
  return tx(() => {
    const n = (get<{ n: number | null }>('SELECT MAX(n) AS n FROM versions WHERE card_id = ?', input.cardId)?.n ?? 0) + 1;
    const id = newId();
    run(
      'INSERT INTO versions (id, card_id, n, author, kind, recipe, note, plan, project, slides, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)',
      id,
      input.cardId,
      n,
      input.author,
      input.kind,
      input.recipe,
      input.note,
      JSON.stringify(input.plan ?? {}),
      join('projects', input.cardId, `v${n}`),
      now(),
    );
    emit('version', id, input.cardId);
    emit('card', input.cardId, input.cardId);
    return getVersion(id);
  });
}

/** A carousel version's slides are the PNGs in its folder's slides/, in name order. */
export function versionSlides(v: Version): string[] {
  const dir = join(projectDir(v), 'slides');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
    .sort()
    .map((f) => join(dir, f));
}

export function setSlides(id: string, count: number) {
  const v = getVersion(id);
  run('UPDATE versions SET slides = ? WHERE id = ?', count, id);
  emit('version', id, v.cardId);
}

// ---------------------------------------------------------------- renders

type RenderRow = { id: string; card_id: string; version_id: string; status: RenderStatus; file: string | null; poster: string | null; duration: number | null; width: number | null; height: number | null; error: string | null; job_id: string | null; created_at: number; finished_at: number | null; n: number };

const toRender = (r: RenderRow): Render => ({ id: r.id, cardId: r.card_id, versionId: r.version_id, n: r.n, status: r.status, duration: r.duration, width: r.width, height: r.height, error: r.error, createdAt: r.created_at, finishedAt: r.finished_at });

const RENDER_SELECT = 'SELECT r.*, v.n AS n FROM renders r JOIN versions v ON v.id = r.version_id';

export const listRenders = (cardId: string) => all<RenderRow>(`${RENDER_SELECT} WHERE r.card_id = ? ORDER BY r.created_at DESC`, cardId).map(toRender);

export function getRender(id: string): Render {
  const r = get<RenderRow>(`${RENDER_SELECT} WHERE r.id = ?`, id);
  if (!r) throw notFound('Render');
  return toRender(r);
}

export function renderFiles(id: string): { file: string | null; poster: string | null } {
  const r = get<{ file: string | null; poster: string | null }>('SELECT file, poster FROM renders WHERE id = ?', id);
  if (!r) throw notFound('Render');
  return { file: r.file ? join(config.dataDir, r.file) : null, poster: r.poster ? join(config.dataDir, r.poster) : null };
}

export function createRender(versionId: string, jobId: string | null): Render {
  const v = getVersion(versionId);
  const id = newId();
  run('INSERT INTO renders (id, card_id, version_id, status, job_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, v.cardId, versionId, 'queued', jobId, now());
  emit('render', id, v.cardId);
  emit('card', v.cardId, v.cardId);
  return getRender(id);
}

/** Where a render's files go (relative to the data folder, as stored). */
export function renderTarget(r: Render): { file: string; poster: string; abs: string; posterAbs: string } {
  mkdirSync(join(config.rendersDir, r.cardId), { recursive: true });
  const file = join('renders', r.cardId, `v${r.n}-${r.id.slice(0, 8)}.mp4`);
  const poster = join('renders', r.cardId, `v${r.n}-${r.id.slice(0, 8)}.jpg`);
  return { file, poster, abs: join(config.dataDir, file), posterAbs: join(config.dataDir, poster) };
}

export function updateRender(id: string, patch: Partial<{ status: RenderStatus; file: string; poster: string; duration: number; width: number; height: number; error: string | null }>) {
  const cur = get<RenderRow>(`${RENDER_SELECT} WHERE r.id = ?`, id);
  if (!cur) throw notFound('Render');
  const done = patch.status && ['done', 'failed', 'cancelled'].includes(patch.status);
  run(
    'UPDATE renders SET status = ?, file = ?, poster = ?, duration = ?, width = ?, height = ?, error = ?, finished_at = ? WHERE id = ?',
    patch.status ?? cur.status,
    patch.file ?? cur.file,
    patch.poster ?? cur.poster,
    patch.duration ?? cur.duration,
    patch.width ?? cur.width,
    patch.height ?? cur.height,
    patch.error === undefined ? cur.error : patch.error,
    done ? now() : cur.finished_at,
    id,
  );
  emit('render', id, cur.card_id);
  emit('card', cur.card_id, cur.card_id);
}
