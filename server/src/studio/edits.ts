import { and, asc, desc, eq, inArray, isNotNull, isNull, max, ne } from 'drizzle-orm';
import { applyTemplate, emptyEdit, normalizeEdit, normalizeTemplate, type EditClip, type EditSpec } from '../../../shared/edit';
import { normalizeDirections } from '../../../shared/direction';
import { builtinSfx, isBuiltinSfx } from '../../../shared/sfx';
import type { Transcript } from '../../../shared/types';
import { db, newId, now, schema } from '../db';
import { emit } from '../lib/events';
import { badRequest, notFound } from '../lib/http';
import { enqueue } from '../jobs/queue';
import { readTranscript, type MediaRow } from '../services/media';
import { getPiece, getWorkspace, type Author } from '../services/pieces';

export type EditRow = typeof schema.edits.$inferSelect;

export function getEdit(id: string) {
  const edit = db.select().from(schema.edits).where(eq(schema.edits.id, id)).get();
  if (!edit) throw notFound('Edit not found');
  return edit;
}

export function findEditForPiece(pieceId: string) {
  return db.select().from(schema.edits).where(eq(schema.edits.pieceId, pieceId)).orderBy(asc(schema.edits.createdAt)).get();
}

function announce(edit: Pick<EditRow, 'id' | 'workspaceId' | 'pieceId'>, by: Author) {
  emit({ type: 'changed', entity: 'edits', workspaceId: edit.workspaceId, id: edit.id, pieceId: edit.pieceId });
  emit({ type: 'edit', editId: edit.id, pieceId: edit.pieceId, by });
}

/** Footage that can go on the main track: the piece's videos and photos, oldest first, never its own renders. */
function pieceFootage(pieceId: string) {
  return db
    .select()
    .from(schema.media)
    .where(and(eq(schema.media.pieceId, pieceId), isNull(schema.media.assetType), inArray(schema.media.kind, ['video', 'image']), ne(schema.media.source, 'render')))
    .orderBy(asc(schema.media.createdAt))
    .all();
}

export function clipFromMedia(m: Pick<MediaRow, 'id' | 'kind' | 'durationMs'>): EditClip {
  const length = m.kind === 'image' ? 3 : Math.max(0.5, (m.durationMs ?? 3000) / 1000);
  return { id: crypto.randomUUID().slice(0, 8), mediaId: m.id, in: 0, out: Math.round(length * 1000) / 1000, focusX: 0.5, focusY: 0.5, zoom: 1, fit: 'fill', volume: 1, transition: null, motion: 'none', filter: null };
}

/** A new edit of a piece: the page's template, the footage on the main track and the chosen direction's story. */
export function startingSpec(pieceId: string, footage: Parameters<typeof clipFromMedia>[0][] = pieceFootage(pieceId)) {
  const piece = getPiece(pieceId);
  const ws = getWorkspace(piece.workspaceId);
  let spec = emptyEdit();
  if (ws.editTemplate) spec = applyTemplate(spec, normalizeTemplate(ws.editTemplate));
  spec.clips = footage.map(clipFromMedia);
  // The chosen direction already names the promise and the payoff.
  const chosen = normalizeDirections(piece.directions)?.chosen;
  if (chosen) spec.story = { promise: chosen.promise, payoff: chosen.payoff, payoffAt: null };
  return spec;
}

/** Start a piece's edit: the brand's video template, with the piece's footage laid end to end. */
export function createEdit(pieceId: string, by: Author) {
  const existing = findEditForPiece(pieceId);
  if (existing) return existing;
  const ws = getWorkspace(getPiece(pieceId).workspaceId);
  const spec = startingSpec(pieceId);
  const id = newId();
  db.insert(schema.edits).values({ id, workspaceId: ws.id, pieceId, working: spec }).run();
  saveEditVersion(id, { author: by, message: spec.clips.length ? `Started from ${spec.clips.length} clip${spec.clips.length === 1 ? '' : 's'}` : 'Started' });
  ensureProxies(spec);
  return getEdit(id);
}

/**
 * Check every file an edit points at belongs to this workspace and is the right kind, and keep clip in/out points
 * inside their sources. `strict` (Claude) refuses with a message to act on; otherwise references to files that are
 * gone (deleted from the library) are dropped, so an edit never becomes unsaveable. Sound effects are sound-effect
 * assets or the app's own; the nasheed plays only a nasheed asset (and is dropped rather than refused, since Claude
 * never sets it).
 */
export function validateSpec(workspaceId: string, input: EditSpec, strict: boolean): EditSpec {
  const spec = normalizeEdit(input);
  const ids = new Set<string>();
  spec.clips.forEach((c) => ids.add(c.mediaId));
  spec.recipe?.backgrounds.forEach((id) => ids.add(id));
  spec.overlays.forEach((o) => (o.type === 'image' || o.type === 'broll') && ids.add(o.mediaId));
  spec.overlays.forEach((o) => o.type === 'scene' && o.elements.forEach((e) => e.mediaId && ids.add(e.mediaId)));
  spec.audio.sfx.forEach((s) => !isBuiltinSfx(s.mediaId) && ids.add(s.mediaId));
  for (const id of [spec.audio.nasheed?.mediaId, spec.audio.voiceover?.mediaId, spec.grade.lutMediaId, spec.watermark.mediaId, spec.captions.fontMediaId]) if (id) ids.add(id);
  const rows = ids.size ? db.select().from(schema.media).where(inArray(schema.media.id, [...ids])).all() : [];
  const byId = new Map(rows.map((r) => [r.id, r]));
  const check = (id: string, what: string, ok: (m: MediaRow) => boolean): MediaRow | null => {
    const m = byId.get(id);
    const problem = !m || m.workspaceId !== workspaceId ? `${what}: file ${id} isn’t in this workspace’s library.` : !ok(m) ? `${what}: “${m.originalName}” is the wrong kind of file.` : null;
    if (problem && strict) throw badRequest(problem);
    return problem ? null : m!;
  };
  const picture = (m: MediaRow) => m.kind === 'video' || m.kind === 'image';

  spec.clips = spec.clips.flatMap((c, i) => {
    const m = check(c.mediaId, `Clip ${i + 1}`, picture);
    if (!m) return [];
    if (m.kind === 'image') return [{ ...c, in: 0, out: Math.max(0.3, c.out - c.in) }];
    const len = m.durationMs ? m.durationMs / 1000 : Infinity;
    const start = Math.min(c.in, Math.max(0, len - 0.2));
    return [{ ...c, in: start, out: Math.min(Math.max(c.out, start + 0.1), len) }];
  });
  spec.overlays = spec.overlays.filter(
    (o) => (o.type === 'image' ? check(o.mediaId, 'Image overlay', (m) => m.kind === 'image') : o.type === 'broll' ? check(o.mediaId, 'B-roll', picture) : true),
  );
  // A scene's pictures: only images from this workspace's library.
  spec.overlays = spec.overlays.map((o) =>
    o.type === 'scene' ? { ...o, elements: o.elements.filter((e) => !e.mediaId || check(e.mediaId, `Scene “${o.name}”, element ${e.id}`, (m) => m.kind === 'image')) } : o,
  );
  spec.audio.sfx = spec.audio.sfx.filter((s) => {
    if (!isBuiltinSfx(s.mediaId)) return check(s.mediaId, 'Sound effect', (m) => m.assetType === 'sfx' && m.kind === 'audio');
    if (builtinSfx(s.mediaId)) return true;
    if (strict) throw badRequest(`Sound effect: there's no built-in sound called ${s.mediaId}.`);
    return false;
  });
  const nasheed = spec.audio.nasheed && byId.get(spec.audio.nasheed.mediaId);
  if (spec.audio.nasheed && (!nasheed || nasheed.workspaceId !== workspaceId || nasheed.assetType !== 'nasheed' || nasheed.kind !== 'audio')) spec.audio.nasheed = null;
  // Narration is speech made here or a voice memo recorded here: never an uploaded track (that's how music would get in).
  if (spec.audio.voiceover && !check(spec.audio.voiceover.mediaId, 'Voiceover', (m) => m.kind === 'audio' && !m.assetType && ['capture', 'share', 'upload'].includes(m.source))) {
    spec.audio.voiceover = null;
  }
  // A format's backgrounds are pictures from this library.
  if (spec.recipe) {
    const backgrounds = spec.recipe.backgrounds.filter((id) => {
      const m = byId.get(id);
      return !!m && m.workspaceId === workspaceId && picture(m);
    });
    spec.recipe = { ...spec.recipe, backgrounds };
  }
  if (spec.grade.lutMediaId && !check(spec.grade.lutMediaId, 'Colour grade', (m) => m.assetType === 'lut' || /\.cube$/i.test(m.originalName))) spec.grade.lutMediaId = null;
  if (spec.watermark.mediaId && !check(spec.watermark.mediaId, 'Watermark', (m) => m.kind === 'image')) spec.watermark.mediaId = null;
  if (spec.captions.fontMediaId && !check(spec.captions.fontMediaId, 'Caption font', (m) => m.assetType === 'font' || /\.(ttf|otf|woff2?)$/i.test(m.originalName))) {
    spec.captions.fontMediaId = null;
  }
  return spec;
}

/** Only the creator adds, changes or removes the nasheed: whatever Claude sends, the edit keeps the one it had. */
function withAuthorNasheed(edit: EditRow, input: EditSpec, by: Author): EditSpec {
  if (by !== 'claude') return input;
  const spec = normalizeEdit(input);
  return { ...spec, audio: { ...spec.audio, nasheed: normalizeEdit(edit.working).audio.nasheed } };
}

/** Autosave of the live edit. */
export function updateEditWorking(editId: string, input: EditSpec, by: Author) {
  const edit = getEdit(editId);
  const spec = validateSpec(edit.workspaceId, withAuthorNasheed(edit, input, by), by === 'claude');
  db.update(schema.edits).set({ working: spec, workingUpdatedAt: now() }).where(eq(schema.edits.id, editId)).run();
  ensureProxies(spec);
  announce(edit, by);
  return getEdit(editId);
}

/** Snapshot the live edit (optionally replacing it first) as a new version. */
export function saveEditVersion(editId: string, input: { author: Author; message?: string; spec?: EditSpec }) {
  const edit = getEdit(editId);
  const spec = input.spec ? validateSpec(edit.workspaceId, withAuthorNasheed(edit, input.spec, input.author), input.author === 'claude') : normalizeEdit(edit.working);
  const head = edit.headVersionId ? db.select().from(schema.editVersions).where(eq(schema.editVersions.id, edit.headVersionId)).get() : undefined;
  if (head && JSON.stringify(normalizeEdit(head.spec)) === JSON.stringify(spec)) {
    if (input.spec) updateEditWorking(editId, spec, input.author);
    return { version: head, unchanged: true };
  }
  const last = db.select({ n: max(schema.editVersions.number) }).from(schema.editVersions).where(eq(schema.editVersions.editId, editId)).get();
  const version = {
    id: newId(),
    editId,
    number: (last?.n ?? 0) + 1,
    author: input.author,
    message: input.message?.trim() || (input.author === 'claude' ? 'Claude edit' : 'Saved'),
    spec,
    createdAt: now(),
  };
  db.transaction((tx) => {
    tx.insert(schema.editVersions).values(version).run();
    tx.update(schema.edits).set({ headVersionId: version.id, working: spec, workingUpdatedAt: now() }).where(eq(schema.edits.id, editId)).run();
  });
  ensureProxies(spec);
  announce(edit, input.author);
  return { version, unchanged: false };
}

export function restoreEditVersion(versionId: string) {
  const v = db.select().from(schema.editVersions).where(eq(schema.editVersions.id, versionId)).get();
  if (!v) throw notFound('Version not found');
  return saveEditVersion(v.editId, { author: 'you', message: `Restored v${v.number}`, spec: normalizeEdit(v.spec) });
}

export function listEditVersions(editId: string) {
  return db
    .select({ id: schema.editVersions.id, number: schema.editVersions.number, author: schema.editVersions.author, message: schema.editVersions.message, createdAt: schema.editVersions.createdAt })
    .from(schema.editVersions)
    .where(eq(schema.editVersions.editId, editId))
    .orderBy(desc(schema.editVersions.number))
    .all();
}

/** Ids of files shown as moving pictures (main track and b-roll), which the preview needs browser-friendly copies of. */
export function pictureMediaIds(spec: EditSpec) {
  return [...new Set([...spec.clips.map((c) => c.mediaId), ...spec.overlays.flatMap((o) => (o.type === 'broll' ? [o.mediaId] : []))])];
}

/** Queue preview copies for footage that doesn't have one yet. */
export function ensureProxies(spec: EditSpec) {
  const ids = pictureMediaIds(spec);
  if (!ids.length) return;
  const missing = db
    .select({ id: schema.media.id, workspaceId: schema.media.workspaceId })
    .from(schema.media)
    .where(and(inArray(schema.media.id, ids), eq(schema.media.proxyStatus, 'none')))
    .all();
  for (const m of missing) {
    db.update(schema.media).set({ proxyStatus: 'queued' }).where(eq(schema.media.id, m.id)).run();
    enqueue('media.proxy', { mediaId: m.id }, { maxAttempts: 2 });
    emit({ type: 'changed', entity: 'media', workspaceId: m.workspaceId, id: m.id });
  }
}

/** Every library file an edit refers to. */
export function specMedia(spec: EditSpec) {
  const ids = new Set(pictureMediaIds(spec));
  spec.overlays.forEach((o) => o.type === 'image' && ids.add(o.mediaId));
  spec.overlays.forEach((o) => o.type === 'scene' && o.elements.forEach((e) => e.mediaId && ids.add(e.mediaId)));
  spec.audio.sfx.forEach((s) => !isBuiltinSfx(s.mediaId) && ids.add(s.mediaId));
  for (const id of [spec.audio.nasheed?.mediaId, spec.audio.voiceover?.mediaId, spec.grade.lutMediaId, spec.watermark.mediaId, spec.captions.fontMediaId]) if (id) ids.add(id);
  return ids.size ? db.select().from(schema.media).where(inArray(schema.media.id, [...ids])).all() : [];
}

/** Transcripts of the main-track footage and the voiceover, for captions, ducking the nasheed and tightening. */
export async function specTranscripts(spec: EditSpec, rows: MediaRow[]) {
  const ids = new Set(spec.clips.map((c) => c.mediaId));
  if (spec.audio.voiceover) ids.add(spec.audio.voiceover.mediaId);
  const out: Record<string, Transcript | null> = {};
  for (const m of rows) if (ids.has(m.id)) out[m.id] = m.transcriptStatus === 'done' ? await readTranscript(m.id) : null;
  return out;
}

export function listRenders(editId: string, limit = 20) {
  return db.select().from(schema.renders).where(eq(schema.renders.editId, editId)).orderBy(desc(schema.renders.createdAt)).limit(limit).all();
}

/** The newest quality report among an edit's versions (studio/quality.ts), for the editor. */
export function latestQuality(editId: string) {
  return (
    db
      .select({ quality: schema.editVersions.quality })
      .from(schema.editVersions)
      .where(and(eq(schema.editVersions.editId, editId), isNotNull(schema.editVersions.quality)))
      .orderBy(desc(schema.editVersions.number))
      .get()?.quality ?? null
  );
}

/** Everything the editor needs in one go. */
export async function editDetail(editId: string) {
  const edit = getEdit(editId);
  const spec = normalizeEdit(edit.working);
  const rows = specMedia(spec);
  return {
    ...edit,
    working: spec,
    versions: listEditVersions(edit.id),
    quality: latestQuality(edit.id),
    renders: listRenders(edit.id),
    media: rows,
    transcripts: await specTranscripts(spec, rows),
  };
}
