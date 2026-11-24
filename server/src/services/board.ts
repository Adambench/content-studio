// Pages and cards: the board.

import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import {
  DEFAULT_LABELS,
  DEFAULT_PAGE_SETTINGS,
  STAGES,
  type Card,
  type CardSummary,
  type DocLabels,
  type JobKind,
  type JobStatus,
  type Page,
  type PageSettings,
  type RenderStatus,
  type Stage,
} from '../../../shared/types.ts';
import { RECIPES } from '../../../shared/recipes.ts';
import { config } from '../config.ts';
import { all, get, parseJson, run, tx } from '../db/db.ts';
import { between, emit, HttpError, newId, notFound, now } from '../lib/util.ts';

// ---------------------------------------------------------------- pages

type PageRow = { id: string; name: string; color: string; position: number; settings: string; created_at: number; updated_at: number };

function toPage(r: PageRow): Page {
  const s = parseJson<Partial<PageSettings>>(r.settings, {});
  return {
    id: r.id,
    name: r.name,
    color: r.color,
    position: r.position,
    settings: { ...DEFAULT_PAGE_SETTINGS, ...s, fonts: { ...DEFAULT_PAGE_SETTINGS.fonts, ...s.fonts } },
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export const listPages = () => all<PageRow>('SELECT * FROM pages ORDER BY position').map(toPage);

export function getPage(id: string): Page {
  const r = get<PageRow>('SELECT * FROM pages WHERE id = ?', id);
  if (!r) throw notFound('Page');
  return toPage(r);
}

export const pageInput = z.object({
  name: z.string().trim().min(1).max(80),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#a1a1aa'),
  settings: z.record(z.string(), z.unknown()).optional(),
});

export function createPage(input: z.input<typeof pageInput>): Page {
  const p = pageInput.parse(input);
  const last = get<{ p: number | null }>('SELECT MAX(position) AS p FROM pages')?.p ?? null;
  const id = newId();
  const t = now();
  run('INSERT INTO pages (id, name, color, position, settings, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, p.name, p.color, between(last, null), JSON.stringify({ ...DEFAULT_PAGE_SETTINGS, ...p.settings }), t, t);
  emit('page', id);
  return getPage(id);
}

export const pagePatch = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  position: z.number().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

export function updatePage(id: string, input: unknown): Page {
  const patch = pagePatch.parse(input);
  const page = getPage(id);
  const settings = patch.settings ? { ...page.settings, ...(patch.settings as Partial<PageSettings>) } : page.settings;
  run('UPDATE pages SET name = ?, color = ?, position = ?, settings = ?, updated_at = ? WHERE id = ?', patch.name ?? page.name, patch.color ?? page.color, patch.position ?? page.position, JSON.stringify(settings), now(), id);
  emit('page', id);
  return getPage(id);
}

/** A card's folders on disk (its files, render projects and renders) go with it. Only ever a card's own id. */
function removeCardFiles(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return;
  for (const root of [config.mediaDir, config.projectsDir, config.rendersDir]) rmSync(join(root, id), { recursive: true, force: true });
}

export function deletePage(id: string) {
  getPage(id);
  const cards = all<{ id: string }>('SELECT id FROM cards WHERE page_id = ?', id);
  run('DELETE FROM pages WHERE id = ?', id);
  for (const c of cards) removeCardFiles(c.id);
  emit('page', id);
}

// ---------------------------------------------------------------- cards

type CardRow = {
  id: string;
  page_id: string;
  title: string;
  stage: Stage;
  position: number;
  recipe: string;
  script: string;
  notes: string;
  labels: string;
  caption: string;
  stage_at: number;
  created_at: number;
  updated_at: number;
  inputs: number;
  versions: number;
  open_comments: number;
  render_id: string | null;
  render_status: RenderStatus | null;
  render_duration: number | null;
  render_poster: string | null;
  job_id: string | null;
  job_kind: JobKind | null;
  job_status: JobStatus | null;
  job_step: string | null;
  job_progress: number | null;
};

// One query gives the board everything a card shows: counts, the newest render, the job running on it.
const CARD_SELECT = `
  SELECT c.*,
    (SELECT COUNT(*) FROM inputs i WHERE i.card_id = c.id) AS inputs,
    (SELECT COUNT(*) FROM versions v WHERE v.card_id = c.id) AS versions,
    (SELECT COUNT(*) FROM comments m WHERE m.card_id = c.id AND m.status = 'open') AS open_comments,
    r.id AS render_id, r.status AS render_status, r.duration AS render_duration, r.poster AS render_poster,
    j.id AS job_id, j.kind AS job_kind, j.status AS job_status, j.step AS job_step, j.progress AS job_progress
  FROM cards c
  LEFT JOIN renders r ON r.id = (SELECT id FROM renders WHERE card_id = c.id AND status != 'cancelled' ORDER BY created_at DESC LIMIT 1)
  LEFT JOIN jobs j ON j.id = (SELECT id FROM jobs WHERE card_id = c.id AND status IN ('queued', 'waiting', 'running') ORDER BY created_at DESC LIMIT 1)`;

function toSummary(r: CardRow): CardSummary {
  return {
    id: r.id,
    pageId: r.page_id,
    title: r.title,
    stage: r.stage,
    position: r.position,
    recipe: r.recipe,
    inputs: r.inputs,
    versions: r.versions,
    openComments: r.open_comments,
    latestRender: r.render_id ? { id: r.render_id, status: r.render_status!, duration: r.render_duration, poster: r.render_poster ? `/media/poster/${r.render_id}` : null } : null,
    job: r.job_id ? { id: r.job_id, kind: r.job_kind!, status: r.job_status!, step: r.job_step, progress: r.job_progress ?? 0 } : null,
    stageAt: r.stage_at,
    updatedAt: r.updated_at,
  };
}

function toCard(r: CardRow): Card {
  return {
    ...toSummary(r),
    script: r.script,
    notes: r.notes,
    labels: { ...DEFAULT_LABELS, ...parseJson<Partial<DocLabels>>(r.labels, {}) },
    caption: r.caption,
    createdAt: r.created_at,
  };
}

/** The board: every card of a page (or of every page), trash left out unless asked for. */
export function listCards(opts: { pageId?: string; trash?: boolean } = {}): CardSummary[] {
  const where = [opts.trash ? "c.stage = 'trash'" : "c.stage != 'trash'"];
  const params: string[] = [];
  if (opts.pageId) {
    where.push('c.page_id = ?');
    params.push(opts.pageId);
  }
  return all<CardRow>(`${CARD_SELECT} WHERE ${where.join(' AND ')} ORDER BY c.position`, ...params).map(toSummary);
}

export function getCard(id: string): Card {
  const r = get<CardRow>(`${CARD_SELECT} WHERE c.id = ?`, id);
  if (!r) throw notFound('Card');
  return toCard(r);
}

const stage = z.enum(STAGES);
const recipe = z.string().refine((r) => RECIPES.some((x) => x.id === r), 'Unknown recipe');

export const cardInput = z.object({
  pageId: z.string(),
  title: z.string().trim().max(200).default(''),
  stage: stage.default('idea'),
  recipe: recipe.default('auto'),
  script: z.string().max(100_000).default(''),
  notes: z.string().max(100_000).default(''),
});

export function createCard(input: z.input<typeof cardInput>): Card {
  const c = cardInput.parse(input);
  getPage(c.pageId);
  const first = get<{ p: number | null }>('SELECT MIN(position) AS p FROM cards WHERE page_id = ? AND stage = ?', c.pageId, c.stage)?.p ?? null;
  const id = newId();
  const t = now();
  run(
    'INSERT INTO cards (id, page_id, title, stage, position, recipe, script, notes, labels, caption, stage_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id,
    c.pageId,
    c.title || 'Untitled',
    c.stage,
    between(null, first),
    c.recipe,
    c.script,
    c.notes,
    '{}',
    '',
    t,
    t,
    t,
  );
  emit('card', id, id);
  return getCard(id);
}

export const cardPatch = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  pageId: z.string().optional(),
  stage: stage.optional(),
  recipe: recipe.optional(),
  script: z.string().max(100_000).optional(),
  notes: z.string().max(100_000).optional(),
  labels: z.object({ script: z.string().max(40), notes: z.string().max(40) }).partial().optional(),
  caption: z.string().max(5_000).optional(),
  /** Drop between these two cards (board drag); the position is worked out here. */
  between: z.tuple([z.string().nullable(), z.string().nullable()]).optional(),
});

/**
 * Change a card. Moving to Ready goes through `approveCard` (it has conditions); here a stage is whatever I drag it
 * to. `author` decides whose draft the old script becomes when someone else changes it.
 */
export function updateCard(id: string, input: unknown, author: 'you' | 'claude' = 'you'): Card {
  const patch = cardPatch.parse(input);
  return tx(() => {
    const card = getCard(id);
    if (patch.pageId && patch.pageId !== card.pageId) getPage(patch.pageId);
    const nextStage = patch.stage ?? card.stage;
    let position = card.position;
    if (patch.between) {
      const [a, b] = patch.between.map((cid) => (cid ? (get<{ position: number }>('SELECT position FROM cards WHERE id = ?', cid)?.position ?? null) : null));
      position = between(a ?? null, b ?? null);
    } else if (nextStage !== card.stage) {
      const first = get<{ p: number | null }>('SELECT MIN(position) AS p FROM cards WHERE page_id = ? AND stage = ?', patch.pageId ?? card.pageId, nextStage)?.p ?? null;
      position = between(null, first);
    }
    const script = patch.script ?? card.script;
    const notes = patch.notes ?? card.notes;
    if ((script !== card.script || notes !== card.notes) && author === 'claude') saveDraft(id, 'you', card.script, card.notes, 'Before Claude wrote');
    run(
      'UPDATE cards SET title = ?, page_id = ?, stage = ?, position = ?, recipe = ?, script = ?, notes = ?, labels = ?, caption = ?, stage_at = ?, updated_at = ? WHERE id = ?',
      patch.title ?? card.title,
      patch.pageId ?? card.pageId,
      nextStage,
      position,
      patch.recipe ?? card.recipe,
      script,
      notes,
      JSON.stringify({ ...card.labels, ...patch.labels }),
      patch.caption ?? card.caption,
      nextStage !== card.stage ? now() : card.stageAt,
      now(),
      id,
    );
    emit('card', id, id);
    return getCard(id);
  });
}

/** Move a card to a stage without touching anything else (the engine does this as work starts and ends). */
export function setStage(id: string, next: Stage) {
  const card = getCard(id);
  if (card.stage === next) return;
  run('UPDATE cards SET stage = ?, stage_at = ?, updated_at = ? WHERE id = ?', next, now(), now(), id);
  emit('card', id, id);
}

/** Approve: the card goes to Ready. Refused while a comment is open or there's nothing finished to post. */
export function approveCard(id: string): Card {
  const card = getCard(id);
  if (card.openComments > 0) throw new HttpError(409, `${card.openComments} comment${card.openComments === 1 ? '' : 's'} still open`);
  const done = get<{ n: number }>("SELECT COUNT(*) AS n FROM renders WHERE card_id = ? AND status = 'done'", id)?.n ?? 0;
  const slides = get<{ n: number }>("SELECT COUNT(*) AS n FROM versions WHERE card_id = ? AND kind = 'carousel' AND slides > 0", id)?.n ?? 0;
  if (!done && !slides) throw new HttpError(409, 'Nothing finished to approve yet');
  setStage(id, 'ready');
  return getCard(id);
}

export function trashCard(id: string) {
  setStage(id, 'trash');
}

export function deleteCard(id: string) {
  getCard(id);
  run('DELETE FROM cards WHERE id = ?', id);
  removeCardFiles(id);
  emit('card', id, id);
}

// ---------------------------------------------------------------- drafts (script history)

export type Draft = { id: string; author: string; script: string; notes: string; note: string; createdAt: number };

export function saveDraft(cardId: string, author: 'you' | 'claude', script: string, notes: string, note: string) {
  if (!script.trim() && !notes.trim()) return;
  run('INSERT INTO drafts (id, card_id, author, script, notes, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', newId(), cardId, author, script, notes, note, now());
}

export const listDrafts = (cardId: string): Draft[] =>
  all<{ id: string; author: string; script: string; notes: string; note: string; created_at: number }>('SELECT * FROM drafts WHERE card_id = ? ORDER BY created_at DESC LIMIT 50', cardId).map((d) => ({
    id: d.id,
    author: d.author,
    script: d.script,
    notes: d.notes,
    note: d.note,
    createdAt: d.created_at,
  }));
