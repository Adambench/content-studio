// A page's Notes: free writing with no structure (shared/notebook.ts). The app picks each note's id and saves it
// whole as it's typed (`saveNote` makes it the first time). Deleting marks it, so Undo can bring it back; marked ones
// go for good after a month, and a blank one goes straight away.
import { and, desc, eq, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { NOTEBOOK_MAX, noteTitle, type NotebookNote } from '../../../shared/notebook';
import { db, now, schema } from '../db';
import { emit } from '../lib/events';
import { badRequest, notFound } from '../lib/http';
import { getWorkspace } from '../services/pieces';

type Row = typeof schema.notebook.$inferSelect;
const KEEP_DELETED = 30 * 86400_000;

const toNote = (r: Row): NotebookNote => ({ id: r.id, workspaceId: r.workspaceId, body: r.body, createdAt: r.createdAt, updatedAt: r.updatedAt });
const announce = (workspaceId: string, id: string) => emit({ type: 'changed', entity: 'notebook', workspaceId, id });

/** The page's notes, last written first. */
export function listNotebook(workspaceId: string) {
  return db
    .select()
    .from(schema.notebook)
    .where(and(eq(schema.notebook.workspaceId, workspaceId), isNull(schema.notebook.deletedAt)))
    .orderBy(desc(schema.notebook.updatedAt))
    .all()
    .map(toNote);
}

export function getNotebookNote(id: string) {
  const row = db.select().from(schema.notebook).where(eq(schema.notebook.id, id)).get();
  if (!row || row.deletedAt) throw notFound('That note is gone.');
  return row;
}

/** The note's words as they are now: made the first time, written over after (and brought back if it was deleted meanwhile). */
export function saveNote(workspaceId: string, id: string, body: string) {
  getWorkspace(workspaceId);
  if (body.length > NOTEBOOK_MAX) throw badRequest('That note is too long: split it in two.');
  const row = db.select().from(schema.notebook).where(eq(schema.notebook.id, id)).get();
  if (row && row.workspaceId !== workspaceId) throw badRequest('That note is on another page.');
  const saved = row
    ? row.body === body && !row.deletedAt
      ? row
      : db.update(schema.notebook).set({ body, deletedAt: null, updatedAt: now() }).where(eq(schema.notebook.id, id)).returning().get()
    : db.insert(schema.notebook).values({ id, workspaceId, body }).returning().get();
  if (saved !== row) announce(workspaceId, id);
  return toNote(saved);
}

export function deleteNote(id: string) {
  const row = getNotebookNote(id);
  if (!row.body.trim()) db.delete(schema.notebook).where(eq(schema.notebook.id, id)).run();
  else db.update(schema.notebook).set({ deletedAt: now() }).where(eq(schema.notebook.id, id)).run();
  announce(row.workspaceId, id);
}

export function restoreNote(id: string) {
  const row = db.select().from(schema.notebook).where(eq(schema.notebook.id, id)).get();
  if (!row) throw notFound('That note is gone.');
  const back = db.update(schema.notebook).set({ deletedAt: null }).where(eq(schema.notebook.id, id)).returning().get();
  announce(row.workspaceId, id);
  return toNote(back);
}

/** Deleted over a month ago, or left blank (a note started and emptied out, then the app closed) over a day ago. */
export function purgeDeletedNotes() {
  db.delete(schema.notebook)
    .where(
      or(
        and(isNotNull(schema.notebook.deletedAt), lt(schema.notebook.deletedAt, now() - KEEP_DELETED)),
        and(sql`trim(${schema.notebook.body}) = ''`, lt(schema.notebook.updatedAt, now() - 86400_000)),
      ),
    )
    .run();
}

/** The notes as Claude reads them (the chat's get_notebook): whole when they fit, else the start of each. */
export function notebookText(workspaceId: string, noteId?: string) {
  const notes = listNotebook(workspaceId).filter((n) => n.body.trim());
  if (noteId) {
    const n = notes.find((x) => x.id === noteId);
    if (!n) throw notFound('That note isn’t on this page.');
    return `Note “${noteTitle(n.body)}” [${n.id}], last written ${new Date(n.updatedAt).toISOString().slice(0, 10)}:\n\n${n.body}`;
  }
  if (!notes.length) return 'No notes on this page yet.';
  const whole = notes.reduce((t, n) => t + n.body.length, 0) <= 40_000;
  const each = whole ? Infinity : Math.max(800, Math.floor(40_000 / notes.length));
  return notes
    .map((n) => {
      const text = n.body.length > each ? `${n.body.slice(0, each)}… (${n.body.length - each} more characters: read it with noteId)` : n.body;
      return `## “${noteTitle(n.body)}” [${n.id}], last written ${new Date(n.updatedAt).toISOString().slice(0, 10)}\n\n${text}`;
    })
    .join('\n\n');
}
