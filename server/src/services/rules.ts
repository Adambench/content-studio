// The rulebook every prompt and check reads. In order when they disagree: halal (locked) → my lessons → the page's
// style → the market's patterns → the base rules (the playbook's fundamentals).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';
import type { Rule, RuleSource, RuleStatus } from '../../../shared/types.ts';
import { config } from '../config.ts';
import { all, get, run, tx } from '../db/db.ts';
import { emit, HttpError, newId, notFound, now } from '../lib/util.ts';

type RuleRow = { id: string; page_id: string | null; format: string | null; source: RuleSource; topic: string; title: string; body: string; check_id: string | null; status: RuleStatus; locked: number; taught: number; seed_key: string | null; created_at: number; updated_at: number };

const toRule = (r: RuleRow): Rule => ({ id: r.id, pageId: r.page_id, format: r.format, source: r.source, topic: r.topic, title: r.title, body: r.body, check: r.check_id, status: r.status, locked: !!r.locked, taught: r.taught, createdAt: r.created_at, updatedAt: r.updated_at });

const ORDER = "CASE source WHEN 'halal' THEN 0 WHEN 'lesson' THEN 1 WHEN 'style' THEN 2 WHEN 'market' THEN 3 ELSE 4 END";

export function listRules(opts: { pageId?: string | null; source?: RuleSource } = {}): Rule[] {
  const where: string[] = [];
  const params: string[] = [];
  if (opts.pageId) {
    where.push('(page_id IS NULL OR page_id = ?)');
    params.push(opts.pageId);
  }
  if (opts.source) {
    where.push('source = ?');
    params.push(opts.source);
  }
  return all<RuleRow>(`SELECT * FROM rules ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${ORDER}, topic, created_at`, ...params).map(toRule);
}

export function getRule(id: string): Rule {
  const r = get<RuleRow>('SELECT * FROM rules WHERE id = ?', id);
  if (!r) throw notFound('Rule');
  return toRule(r);
}

export const ruleInput = z.object({
  pageId: z.string().nullable().default(null),
  format: z.string().nullable().default(null),
  source: z.enum(['lesson', 'market', 'style', 'base']).default('lesson'),
  topic: z.string().trim().max(60).default(''),
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(4_000),
  check: z.string().nullable().default(null),
  status: z.enum(['on', 'off', 'suggested']).default('on'),
});

export function createRule(input: z.input<typeof ruleInput>): Rule {
  const r = ruleInput.parse(input);
  const id = newId();
  const t = now();
  run('INSERT INTO rules (id, page_id, format, source, topic, title, body, check_id, status, locked, taught, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)', id, r.pageId, r.format, r.source, r.topic, r.title, r.body, r.check, r.status, t, t);
  emit('rule', id);
  return getRule(id);
}

export const rulePatch = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  body: z.string().trim().min(1).max(4_000).optional(),
  topic: z.string().trim().max(60).optional(),
  status: z.enum(['on', 'off', 'suggested']).optional(),
  pageId: z.string().nullable().optional(),
  format: z.string().nullable().optional(),
});

export function updateRule(id: string, input: unknown): Rule {
  const patch = rulePatch.parse(input);
  const cur = getRule(id);
  if (cur.locked && (patch.status === 'off' || patch.body || patch.title)) throw new HttpError(409, 'Halal rules can’t be changed or turned off');
  run(
    'UPDATE rules SET title = ?, body = ?, topic = ?, status = ?, page_id = ?, format = ?, updated_at = ? WHERE id = ?',
    patch.title ?? cur.title,
    patch.body ?? cur.body,
    patch.topic ?? cur.topic,
    patch.status ?? cur.status,
    patch.pageId === undefined ? cur.pageId : patch.pageId,
    patch.format === undefined ? cur.format : patch.format,
    now(),
    id,
  );
  emit('rule', id);
  return getRule(id);
}

/** A comment that repeats a lesson teaches it again: the rule counts how often I had to say it. */
export function teachAgain(id: string, sharper?: string) {
  const cur = getRule(id);
  run('UPDATE rules SET taught = taught + 1, body = ?, updated_at = ? WHERE id = ?', sharper?.trim() || cur.body, now(), id);
  emit('rule', id);
}

export function deleteRule(id: string) {
  const cur = getRule(id);
  if (cur.locked) throw new HttpError(409, 'Halal rules can’t be deleted');
  run('DELETE FROM rules WHERE id = ?', id);
  emit('rule', id);
}

/**
 * The rules for a prompt, compact: what applies to this page and format, strongest first. Off and suggested rules
 * are left out.
 */
export function rulesText(opts: { pageId?: string | null; format?: string | null; sources?: RuleSource[] } = {}): string {
  const rules = listRules({ pageId: opts.pageId ?? null }).filter(
    (r) => r.status === 'on' && (!r.format || !opts.format || r.format === opts.format) && (!opts.sources || opts.sources.includes(r.source)),
  );
  const heading: Record<RuleSource, string> = { halal: 'Halal (never broken)', lesson: 'My lessons (from my comments)', style: "The page's style", market: 'What works in the niche now', base: 'Fundamentals' };
  const out: string[] = [];
  for (const source of ['halal', 'lesson', 'style', 'market', 'base'] as RuleSource[]) {
    const group = rules.filter((r) => r.source === source);
    if (!group.length) continue;
    out.push(`## ${heading[source]}`);
    for (const r of group) out.push(`- **${r.title}**${r.taught > 1 ? ` (said ${r.taught}×)` : ''}: ${r.body.replace(/\s+/g, ' ')}`);
  }
  return out.join('\n');
}

// ---------------------------------------------------------------- seeds

const HALAL: { key: string; title: string; body: string; check?: string }[] = [
  { key: 'halal.music', title: 'No music, ever', check: 'no-music', body: 'Nothing made contains music or musical instruments: no tracks, beds, stingers, jingles, beat drops or trending sounds. Non-musical sound effects are fine. The line is instruments: sound made only by voices (a hum, wordless voices, a nasheed without instruments) is not music.' },
  { key: 'halal.nasheed', title: 'A nasheed only by my choice', body: 'A vocal-only nasheed goes in an edit only when I chose it for that edit. Claude may suggest one, never add one.' },
  { key: 'halal.source-music', title: 'Music in footage is taken out', check: 'no-music', body: 'Music in any source footage or stock clip is removed (voice isolation) or the clip is not used.' },
  { key: 'halal.women', title: 'No women on camera', body: 'Never show a woman on camera, however she is dressed: in stock, b-roll, references shown on screen or any footage.' },
  { key: 'halal.haram', title: 'Nothing haram shown or promoted', body: 'No gambling or betting mechanics, alcohol, drugs, smoking or vaping, dating, immodest imagery, interest-based finance, music promotion, or anything else haram.' },
  { key: 'halal.religion', title: 'Religion: cited, no rulings, nothing from other religions', body: 'Never give rulings. Quote the Quran or a hadith only with its reference (sahih hadith only), shown on screen. Nothing tied to another religion, even loosely (gods, crosses, temples, other religions\' terms).' },
  { key: 'halal.gentle-return', title: 'Gentle Return never shows my face', body: 'On the Islamic page my face is never seen; no prophet, companion or named righteous person is ever depicted, drawn or acted.' },
];

/**
 * The playbook's references become base rules (one per ## section), refreshed when the playbook changes unless I
 * changed the rule myself. The halal rules are locked.
 */
export function seedRules() {
  tx(() => {
    for (const h of HALAL) upsertSeed(`seed:${h.key}`, { source: 'halal', topic: 'halal', title: h.title, body: h.body, check: h.check ?? null, locked: true });
    const dir = join(config.skillsDir, 'playbook/references');
    if (!existsSync(dir)) return;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.md') && !['halal.md', 'clipping.md'].includes(f))) {
      const topic = basename(file, '.md');
      const text = readFileSync(join(dir, file), 'utf8');
      for (const section of text.split(/^## /m).slice(1)) {
        const [titleLine, ...rest] = section.split('\n');
        const title = (titleLine ?? '').trim();
        const body = rest.join('\n').trim();
        if (!title || body.length < 40) continue;
        upsertSeed(`seed:playbook:${topic}:${title.toLowerCase()}`, { source: 'base', topic, title, body: body.slice(0, 4_000), check: null, locked: false });
      }
    }
  });
}

function upsertSeed(key: string, r: { source: RuleSource; topic: string; title: string; body: string; check: string | null; locked: boolean }) {
  const cur = get<RuleRow & { updated_at: number; created_at: number }>('SELECT * FROM rules WHERE seed_key = ?', key);
  const t = now();
  if (!cur) {
    run('INSERT INTO rules (id, page_id, format, source, topic, title, body, check_id, status, locked, taught, seed_key, created_at, updated_at) VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)', newId(), r.source, r.topic, r.title, r.body, r.check, 'on', r.locked ? 1 : 0, key, t, t);
    return;
  }
  // Mine once edited (updated after it was created, by more than the seeding itself): leave it alone.
  const edited = !cur.locked && cur.updated_at > cur.created_at + 1000;
  if (!edited && (cur.body !== r.body || cur.title !== r.title)) run('UPDATE rules SET title = ?, body = ?, check_id = ?, created_at = ?, updated_at = ? WHERE id = ?', r.title, r.body, r.check, t, t, cur.id);
}
