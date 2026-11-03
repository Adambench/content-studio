import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { and, asc, eq, isNull, max, ne, or } from 'drizzle-orm';
import { KNOWLEDGE_TOPIC_INFO, KNOWLEDGE_TOPICS, type KnowledgeRule, type KnowledgeSource, type KnowledgeStatus, type KnowledgeTopic } from '../../../shared/knowledge';
import { config } from '../config';
import { db, newId, now, schema } from '../db';
import { emit } from '../lib/events';
import { badRequest, notFound } from '../lib/http';
import { taughtBy } from './lessons';

type Row = typeof schema.knowledge.$inferSelect;

const isTopic = (t: string): t is KnowledgeTopic => (KNOWLEDGE_TOPICS as readonly string[]).includes(t);
const isLocked = (r: Pick<Row, 'topic' | 'seedKey'>) => r.topic === 'halal' && !!r.seedKey;

export function toRule(r: Row): KnowledgeRule {
  return {
    id: r.id,
    workspaceId: r.workspaceId,
    topic: r.topic,
    title: r.title,
    body: r.body,
    source: r.source,
    status: r.status,
    edited: !!r.seedKey && (r.title !== r.seedTitle || r.body !== r.seedBody),
    locked: isLocked(r),
    note: r.note,
    referenceId: r.referenceId,
    position: r.position,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

type Seed = { key: string; topic: KnowledgeTopic; title: string; body: string; position: number };

/** The playbook's references as rules: the text before the first `##` (under the file's title), then one per `##` section; no sources. */
function readSeeds(): Seed[] {
  const dir = join(config.pluginDir, 'skills/playbook/references');
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  } catch {
    return [];
  }
  return files.flatMap((file) => {
    const topic = file.replace(/\.md$/, '');
    if (!isTopic(topic)) return [];
    const text = readFileSync(join(dir, file), 'utf8').replace(/\r\n/g, '\n');
    const [head, ...sections] = text.split(/^## /m);
    const title = /^# (.+)$/m.exec(head)?.[1]?.trim() ?? KNOWLEDGE_TOPIC_INFO[topic].label;
    const intro = head.replace(/^# .+$/m, '').trim();
    const out: Seed[] = intro ? [{ key: `${topic}#`, topic, title, body: intro, position: 0 }] : [];
    sections.forEach((s, i) => {
      const nl = s.indexOf('\n');
      const heading = (nl < 0 ? s : s.slice(0, nl)).trim();
      if (!heading || heading === 'Sources') return;
      out.push({ key: `${topic}#${heading}`, topic, title: heading, body: (nl < 0 ? '' : s.slice(nl + 1)).trim(), position: i + 1 });
    });
    return out;
  });
}

/**
 * At start: bring the seeded rules in line with the playbook shipped with this version. A seeded rule I haven't
 * changed follows the playbook; one I have keeps my words (its seed is still updated, for *Back to the playbook*).
 * A section the playbook dropped goes too, unless I changed it, then it stays as mine.
 */
export function syncKnowledge() {
  const seeds = readSeeds();
  if (!seeds.length) return;
  const rows = db.select().from(schema.knowledge).where(isNull(schema.knowledge.workspaceId)).all();
  const byKey = new Map(rows.filter((r) => r.seedKey).map((r) => [r.seedKey!, r]));
  const keys = new Set(seeds.map((s) => s.key));
  let changed = false;
  db.transaction((tx) => {
    for (const s of seeds) {
      const r = byKey.get(s.key);
      if (!r) {
        tx.insert(schema.knowledge).values({ id: newId(), topic: s.topic, title: s.title, body: s.body, source: 'playbook', seedKey: s.key, seedTitle: s.title, seedBody: s.body, position: s.position }).run();
        changed = true;
        continue;
      }
      if (r.seedTitle === s.title && r.seedBody === s.body) continue;
      const untouched = r.title === r.seedTitle && r.body === r.seedBody;
      tx.update(schema.knowledge)
        .set({ seedTitle: s.title, seedBody: s.body, ...(untouched ? { title: s.title, body: s.body, updatedAt: now() } : {}) })
        .where(eq(schema.knowledge.id, r.id))
        .run();
      changed = true;
    }
    for (const r of byKey.values()) {
      if (keys.has(r.seedKey!)) continue;
      if (r.title === r.seedTitle && r.body === r.seedBody) tx.delete(schema.knowledge).where(eq(schema.knowledge.id, r.id)).run();
      else tx.update(schema.knowledge).set({ seedKey: null, seedTitle: null, seedBody: null, source: 'you' }).where(eq(schema.knowledge.id, r.id)).run();
      changed = true;
    }
  });
  if (changed) emit({ type: 'changed', entity: 'knowledge' });
}

export function listKnowledge(): KnowledgeRule[] {
  const rows = db.select().from(schema.knowledge).orderBy(asc(schema.knowledge.topic), asc(schema.knowledge.position), asc(schema.knowledge.createdAt)).all();
  const taught = taughtBy(rows.filter((r) => r.source === 'comments').map((r) => r.id));
  return rows.map((r) => (r.source === 'comments' ? { ...toRule(r), taught: taught.get(r.id) ?? { count: 0, last: null } } : toRule(r)));
}

function getRow(id: string) {
  const r = db.select().from(schema.knowledge).where(eq(schema.knowledge.id, id)).get();
  if (!r) throw notFound('Rule not found');
  return r;
}

export function createRule(input: { topic: KnowledgeTopic; title: string; body: string; source?: KnowledgeSource; status?: KnowledgeStatus; note?: string; workspaceId?: string | null; referenceId?: string | null }) {
  const last = db.select({ n: max(schema.knowledge.position) }).from(schema.knowledge).where(eq(schema.knowledge.topic, input.topic)).get();
  const id = newId();
  db.insert(schema.knowledge)
    .values({
      id,
      workspaceId: input.workspaceId ?? null,
      topic: input.topic,
      title: input.title.trim(),
      body: input.body.trim(),
      source: input.source ?? 'you',
      status: input.status ?? 'active',
      note: input.note?.trim() ?? '',
      referenceId: input.referenceId ?? null,
      position: (last?.n ?? 0) + 1,
    })
    .run();
  emit({ type: 'changed', entity: 'knowledge', id });
  return toRule(getRow(id));
}

export function updateRule(id: string, patch: { title?: string; body?: string; status?: KnowledgeStatus; topic?: KnowledgeTopic }) {
  const r = getRow(id);
  if (isLocked(r) && (patch.title !== undefined || patch.body !== undefined || patch.topic !== undefined || (patch.status && patch.status !== 'active')))
    throw badRequest('The halal rules from the playbook can’t be changed or turned off. Add a rule of your own instead.');
  const values: Partial<Row> = { updatedAt: now() };
  if (patch.title !== undefined) {
    if (!patch.title.trim()) throw badRequest('A rule needs a title.');
    values.title = patch.title.trim();
  }
  if (patch.body !== undefined) values.body = patch.body.trim();
  if (patch.topic !== undefined) values.topic = patch.topic;
  if (patch.status !== undefined) values.status = patch.status;
  db.update(schema.knowledge).set(values).where(eq(schema.knowledge.id, id)).run();
  emit({ type: 'changed', entity: 'knowledge', id });
  return toRule(getRow(id));
}

/** A seeded rule back to the playbook's words. */
export function resetRule(id: string) {
  const r = getRow(id);
  if (!r.seedKey || r.seedTitle === null || r.seedBody === null) throw badRequest('This rule isn’t from the playbook.');
  return updateRule(id, { title: r.seedTitle, body: r.seedBody });
}

export function deleteRule(id: string) {
  const r = getRow(id);
  if (isLocked(r)) throw badRequest('The halal rules from the playbook can’t be deleted.');
  // A seeded rule would only come back at the next start: it's turned off instead.
  if (r.seedKey) return updateRule(id, { status: 'off' });
  db.delete(schema.knowledge).where(eq(schema.knowledge.id, id)).run();
  emit({ type: 'changed', entity: 'knowledge', id });
  return null;
}

/** A rule deleted by mistake, back (the app keeps the card until the undo toast goes). */
export function restoreRule(rule: KnowledgeRule) {
  if (db.select({ id: schema.knowledge.id }).from(schema.knowledge).where(eq(schema.knowledge.id, rule.id)).get()) return updateRule(rule.id, { status: rule.status });
  // Its reference may have gone meanwhile.
  const referenceId = rule.referenceId && db.select({ id: schema.referenceVideos.id }).from(schema.referenceVideos).where(eq(schema.referenceVideos.id, rule.referenceId)).get() ? rule.referenceId : null;
  db.insert(schema.knowledge)
    .values({ id: rule.id, workspaceId: rule.workspaceId, topic: rule.topic, title: rule.title, body: rule.body, source: rule.source, status: rule.status, note: rule.note, referenceId, position: rule.position, createdAt: rule.createdAt })
    .run();
  emit({ type: 'changed', entity: 'knowledge', id: rule.id });
  return toRule(getRow(rule.id));
}

/**
 * The live rules of some topics as Markdown, for prompts: each topic under its heading, its rules in order. Only
 * active ones, for every page or for `workspaceId`'s. Empty when there are none.
 */
export function knowledgeText(topics: readonly KnowledgeTopic[], workspaceId?: string | null) {
  if (!topics.length) return '';
  const rows = db
    .select()
    .from(schema.knowledge)
    .where(
      and(
        eq(schema.knowledge.status, 'active'),
        // Lessons from my comments have their own section (knowledge/lessons.ts `lessonsText`).
        ne(schema.knowledge.source, 'comments'),
        workspaceId ? or(isNull(schema.knowledge.workspaceId), eq(schema.knowledge.workspaceId, workspaceId)) : isNull(schema.knowledge.workspaceId),
      ),
    )
    .orderBy(asc(schema.knowledge.position), asc(schema.knowledge.createdAt))
    .all();
  return topics
    .map((topic) => {
      const own = rows.filter((r) => r.topic === topic);
      if (!own.length) return '';
      const [first, ...rest] = own;
      // The seeded intro is the topic's own opening paragraph, under the topic's title.
      const intro = first.seedKey === `${topic}#` ? first.body : '';
      const rules = intro ? rest : own;
      return [`# ${KNOWLEDGE_TOPIC_INFO[topic].label}`, intro, ...rules.map((r) => `## ${r.title}\n\n${r.body}`)].filter(Boolean).join('\n\n');
    })
    .filter(Boolean)
    .join('\n\n---\n\n');
}

export const hasKnowledge = () => !!db.select({ id: schema.knowledge.id }).from(schema.knowledge).limit(1).get();
