// Lessons from my comments on finished videos: every comment Claude fixes also teaches the general rule behind it
// (a Knowledge rule, source `comments`, active at once), so the same mistake doesn't come back in the next video.
// A second comment about the same thing joins the lesson it repeats (its count goes up, and its words can be made
// sharper). Every prompt that picks, makes or judges a video lists them (`lessonsText`), and the check before a render
// tests each one against the edit (studio/quality.ts).
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { KNOWLEDGE_TOPICS, RULE_BODY_MAX, RULE_TITLE_MAX, type KnowledgeRule, type KnowledgeTopic } from '../../../shared/knowledge';
import { db, now, schema } from '../db';
import { emit } from '../lib/events';
import { badRequest, notFound } from '../lib/http';
import { createRule, toRule, updateRule } from './knowledge';

export type LessonInput = {
  /** An existing lesson this comment repeats. */
  id?: string;
  topic?: KnowledgeTopic;
  /** The rule's name: what to always or never do ("Never end a clip on an unfinished sentence"). */
  title?: string;
  /** The rule itself, general enough for any video (with an existing id: its sharper wording, replacing the old). */
  rule?: string;
  /** Only for this page's videos (default: every page). */
  pageOnly?: boolean;
};

type Taught = NonNullable<KnowledgeRule['taught']>;

/** How many comments taught each lesson, and the newest one. */
export function taughtBy(ids: string[]): Map<string, Taught> {
  const out = new Map<string, Taught>();
  if (!ids.length) return out;
  const rows = db
    .select({ lessonId: schema.videoNotes.lessonId, text: schema.videoNotes.text, pieceId: schema.videoNotes.pieceId, workspaceId: schema.videoNotes.workspaceId, title: schema.pieces.title })
    .from(schema.videoNotes)
    .innerJoin(schema.pieces, eq(schema.pieces.id, schema.videoNotes.pieceId))
    .where(inArray(schema.videoNotes.lessonId, ids))
    .orderBy(desc(schema.videoNotes.createdAt))
    .all();
  for (const r of rows) {
    const t = out.get(r.lessonId!) ?? { count: 0, last: { text: r.text, pieceId: r.pieceId, workspaceId: r.workspaceId, title: r.title } };
    t.count++;
    out.set(r.lessonId!, t);
  }
  return out;
}

/** The lessons (active ones unless `all`), for every page or also `workspaceId`'s own, most taught first. */
export function listLessons(opts: { workspaceId?: string | null; all?: boolean } = {}): KnowledgeRule[] {
  const rows = db
    .select()
    .from(schema.knowledge)
    .where(
      and(
        eq(schema.knowledge.source, 'comments'),
        opts.all ? undefined : eq(schema.knowledge.status, 'active'),
        opts.workspaceId === undefined ? undefined : opts.workspaceId ? or(isNull(schema.knowledge.workspaceId), eq(schema.knowledge.workspaceId, opts.workspaceId)) : isNull(schema.knowledge.workspaceId),
      ),
    )
    .all();
  const taught = taughtBy(rows.map((r) => r.id));
  return rows
    .map((r) => ({ ...toRule(r), taught: taught.get(r.id) ?? { count: 0, last: null } }))
    .sort((a, b) => b.taught!.count - a.taught!.count || a.createdAt - b.createdAt);
}

const times = (n: number) => (n > 1 ? ` (said ${n} times)` : '');

/**
 * The lessons as a prompt section, or '' when there are none. They hold like the playbook's rules, above the playbook
 * where they disagree (they're the creator's own corrections); the halal rules still come first.
 */
export function lessonsText(workspaceId?: string | null, opts: { ids?: boolean } = {}) {
  const lessons = listLessons({ workspaceId: workspaceId ?? null });
  if (!lessons.length) return '';
  return [
    `# Lessons from the creator's comments on finished videos`,
    `Each one is a mistake an earlier video made and the creator had to point out. They hold for every video and clip, above the playbook where they disagree (the halal rules still come first). Before you finish, check what you made against each one: the creator must never have to say any of them again.`,
    ...lessons.map((l) => `- ${opts.ids ? `[${l.id}] ` : ''}**${l.title}**${times(l.taught!.count)}: ${l.body.replace(/\s*\n+\s*/g, ' ')}`),
  ].join('\n\n');
}

/** Record what a comment taught: a new lesson, or one it repeats (sharpened when `rule` is given). Returns the lesson. */
export function learnFromNote(noteId: string, input: LessonInput): KnowledgeRule {
  const note = db.select().from(schema.videoNotes).where(eq(schema.videoNotes.id, noteId)).get();
  if (!note) throw notFound('Comment not found');
  let lessonId: string;
  if (input.id) {
    const row = db.select().from(schema.knowledge).where(eq(schema.knowledge.id, input.id)).get();
    if (!row || row.source !== 'comments') throw badRequest(`${input.id} isn’t one of the lessons from your comments.`);
    if (input.rule?.trim() || input.title?.trim() || (input.topic && input.topic !== row.topic) || row.status !== 'active')
      updateRule(row.id, {
        ...(input.title?.trim() && { title: input.title.trim().slice(0, RULE_TITLE_MAX) }),
        ...(input.rule?.trim() && { body: input.rule.trim().slice(0, RULE_BODY_MAX) }),
        ...(input.topic && input.topic !== row.topic && { topic: input.topic }),
        // Taught again: a lesson turned off comes back on.
        status: 'active',
      });
    lessonId = row.id;
  } else {
    const title = input.title?.trim();
    const rule = input.rule?.trim();
    if (!title || !rule) throw badRequest('A new lesson needs a title and the rule (or the id of the lesson this comment repeats).');
    if (!input.topic || !(KNOWLEDGE_TOPICS as readonly string[]).includes(input.topic)) throw badRequest(`The lesson's topic is one of: ${KNOWLEDGE_TOPICS.join(', ')}.`);
    lessonId = createRule({
      topic: input.topic,
      title: title.slice(0, RULE_TITLE_MAX),
      body: rule.slice(0, RULE_BODY_MAX),
      source: 'comments',
      status: 'active',
      note: `From the comment “${note.text.slice(0, 300)}”`,
      workspaceId: input.pageOnly ? note.workspaceId : null,
    }).id;
  }
  db.update(schema.videoNotes).set({ lessonId }).where(eq(schema.videoNotes.id, noteId)).run();
  emit({ type: 'changed', entity: 'notes', workspaceId: note.workspaceId, pieceId: note.pieceId, id: note.id });
  emit({ type: 'changed', entity: 'knowledge', id: lessonId });
  db.update(schema.knowledge).set({ updatedAt: now() }).where(eq(schema.knowledge.id, lessonId)).run();
  return listLessons({ all: true }).find((l) => l.id === lessonId)!;
}

/** Comments fixed or closed without a lesson (the ones Claude Code or an older app fixed), oldest first. */
export function notesWithoutLesson() {
  return db
    .select({ id: schema.videoNotes.id, text: schema.videoNotes.text, pieceId: schema.videoNotes.pieceId, status: schema.videoNotes.status })
    .from(schema.videoNotes)
    .where(and(isNull(schema.videoNotes.lessonId), sql`${schema.videoNotes.status} != 'open'`))
    .orderBy(schema.videoNotes.createdAt)
    .all();
}
