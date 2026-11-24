// Brands (pages): a name, a colour and a folder in ~/studio whose CLAUDE.md holds the brand's style and lessons.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { Brand } from '../../../shared/types.ts';
import { config } from '../config.ts';
import { all, get, run } from '../db/db.ts';
import { between, emit, HttpError, newId, notFound, now } from '../lib/util.ts';

type BrandRow = { id: string; slug: string; name: string; color: string; position: number; created_at: number; updated_at: number };

const toBrand = (r: BrandRow): Brand => ({ id: r.id, slug: r.slug, name: r.name, color: r.color, position: r.position, createdAt: r.created_at, updatedAt: r.updated_at });

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

export const listBrands = () => all<BrandRow>('SELECT * FROM brands ORDER BY position').map(toBrand);

export function getBrand(id: string): Brand {
  const r = get<BrandRow>('SELECT * FROM brands WHERE id = ?', id);
  if (!r) throw notFound('Brand');
  return toBrand(r);
}

export const brandDir = (b: Pick<Brand, 'slug'>) => join(config.studioDir, b.slug);

/** The brand's own CLAUDE.md: Claude Code loads it for every video in the folder. */
export function ensureBrandFiles(b: Brand) {
  const dir = brandDir(b);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, 'CLAUDE.md');
  if (!existsSync(file)) {
    writeFileSync(
      file,
      `# ${b.name}\n\nThis brand's style and lessons, for every video in this folder. Claude keeps it up to date from my notes; I edit it too.\n\n## Style\n\n- Nothing yet: ask me, or follow the studio's defaults.\n\n## Lessons\n\nTicked lessons are followed, unticked ones are kept but ignored.\n\n`,
    );
  }
}

const brandInput = z.object({ name: z.string().trim().min(1).max(60), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#a1a1aa') });

export function createBrand(input: unknown): Brand {
  const b = brandInput.parse(input);
  let slug = slugify(b.name, 'brand');
  for (let i = 2; get('SELECT 1 FROM brands WHERE slug = ?', slug); i++) slug = `${slugify(b.name, 'brand')}-${i}`;
  const last = get<{ p: number | null }>('SELECT MAX(position) AS p FROM brands')?.p ?? null;
  const id = newId();
  run('INSERT INTO brands (id, slug, name, color, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, slug, b.name, b.color, between(last, null), now(), now());
  const brand = getBrand(id);
  ensureBrandFiles(brand);
  emit('brand', id);
  return brand;
}

const brandPatch = z.object({ name: z.string().trim().min(1).max(60).optional(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), position: z.number().optional() });

/** The folder keeps its name when the brand is renamed: Claude's sessions and my terminal paths stay valid. */
export function updateBrand(id: string, input: unknown): Brand {
  const patch = brandPatch.parse(input);
  const cur = getBrand(id);
  run('UPDATE brands SET name = ?, color = ?, position = ?, updated_at = ? WHERE id = ?', patch.name ?? cur.name, patch.color ?? cur.color, patch.position ?? cur.position, now(), id);
  emit('brand', id);
  return getBrand(id);
}

/** Only an empty brand goes; its folder stays on disk (its CLAUDE.md may be worth keeping). */
export function deleteBrand(id: string) {
  getBrand(id);
  if (get('SELECT 1 FROM videos WHERE brand_id = ?', id)) throw new HttpError(409, 'This brand still has videos');
  run('DELETE FROM brands WHERE id = ?', id);
  emit('brand', id);
}
