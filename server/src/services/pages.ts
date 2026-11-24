// Pages (an Instagram account each): a name, a colour and a folder in ~/studio whose CLAUDE.md holds the page's style and lessons.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Page } from '../../../shared/types.ts';
import { config } from '../config.ts';
import { all, get, run } from '../db/db.ts';
import { between, emit, HttpError, newId, notFound, now } from '../lib/util.ts';

type PageRow = { id: string; slug: string; name: string; color: string; position: number; setup_id: string | null; created_at: number; updated_at: number };

const toPage = (r: PageRow): Page => ({ id: r.id, slug: r.slug, name: r.name, color: r.color, position: r.position, setupId: r.setup_id, createdAt: r.created_at, updatedAt: r.updated_at });

const SELECT = "SELECT p.*, (SELECT id FROM videos WHERE page_id = p.id AND kind = 'page' LIMIT 1) AS setup_id FROM pages p";

/** A folder name from a title: lower case, dashes, at most 48 characters. */
export function slugify(text: string, fallback = 'untitled'): string {
  const s = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return s || fallback;
}

export const listPages = () => all<PageRow>(`${SELECT} ORDER BY position`).map(toPage);

export function getPage(id: string): Page {
  const r = get<PageRow>(`${SELECT} WHERE p.id = ?`, id);
  if (!r) throw notFound('Page');
  return toPage(r);
}

export const pageDir = (b: Pick<Page, 'slug'>) => join(config.studioDir, b.slug);

/** The page's own CLAUDE.md (Claude Code loads it for every video in the folder) and its kit/ folder. */
export function ensurePageFiles(b: Page) {
  const dir = pageDir(b);
  mkdirSync(join(dir, 'kit'), { recursive: true });
  const file = join(dir, 'CLAUDE.md');
  if (!existsSync(file)) {
    writeFileSync(
      file,
      `# ${b.name}\n\nWho this page is, how it talks and how it looks, for every video in this folder. Claude writes it when it sets the page up (setup/) and keeps it current from my notes; I edit it too. Its look is in kit/.\n\n## Not set up yet\n\nFollow the studio's defaults, or ask me.\n\n## Lessons\n\nTicked lessons are followed, unticked ones are kept but ignored.\n\n`,
    );
  }
}

const pageInput = z.object({
  name: z.string().trim().max(60).optional(),
  /** Without a name yet (Claude suggests some), the folder is named after what I said the page is. */
  about: z.string().max(20_000).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

const COLORS = ['#e6b450', '#ef7a3c', '#7fb8a4', '#c49a6c', '#9b8cf0', '#6ea8ff', '#e879a6', '#a1a1aa'];

export function createPage(input: unknown): Page {
  const b = pageInput.parse(input);
  const name = b.name || 'New page';
  const base = b.name ? slugify(b.name, 'page') : slugify((b.about ?? '').split(/\s+/).slice(0, 4).join(' '), 'new-page');
  let slug = base;
  for (let i = 2; get('SELECT 1 FROM pages WHERE slug = ?', slug) || existsSync(join(config.studioDir, slug)); i++) slug = `${base}-${i}`;
  const last = get<{ p: number | null; c: number }>('SELECT MAX(position) AS p, COUNT(*) AS c FROM pages');
  const id = newId();
  run('INSERT INTO pages (id, slug, name, color, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, slug, name, b.color ?? COLORS[(last?.c ?? 0) % COLORS.length]!, between(last?.p ?? null, null), now(), now());
  const page = getPage(id);
  ensurePageFiles(page);
  emit('page', id);
  return page;
}

const pagePatch = z.object({ name: z.string().trim().min(1).max(60).optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), position: z.number().optional() });

/** The folder keeps its name when the page is renamed: Claude's sessions and my terminal paths stay valid. */
export function updatePage(id: string, input: unknown): Page {
  const patch = pagePatch.parse(input);
  const cur = getPage(id);
  run('UPDATE pages SET name = ?, color = ?, position = ?, updated_at = ? WHERE id = ?', patch.name ?? cur.name, patch.color ?? cur.color, patch.position ?? cur.position, now(), id);
  emit('page', id);
  return getPage(id);
}

/** Only a page without videos goes (its setup goes with it); its folder stays on disk (CLAUDE.md, kit/, setup/). */
export function deletePage(id: string) {
  getPage(id);
  if (get("SELECT 1 FROM videos WHERE page_id = ? AND kind != 'page'", id)) throw new HttpError(409, 'This page still has videos');
  run("DELETE FROM videos WHERE page_id = ? AND kind = 'page'", id);
  run('DELETE FROM pages WHERE id = ?', id);
  emit('page', id);
}
