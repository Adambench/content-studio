// The one-off move to Phase 14 (PLAN.md): runs once at start, after a copy of the database.
// - My ideas become video cards (Ideas = videos): my own top-level ideas and a series' episodes, with their scripts;
//   their sub-ideas become bullet notes; Claude's ideas, saved posts and pictures stay behind in the old table.
// - Videos I locked in from Ideas lose Claude's flesh-out: their draft is my words again.
// - Every page gets the one board's stages; Gentle Return (an Islamic page) is hidden; Long Story Short's orange dot,
//   too close to Personal brand's amber, turns violet.
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { and, asc, desc, eq, isNull } from 'drizzle-orm';
import { BOARD_STAGES, normalizeDraft } from '../../../shared/types';
import { config } from '../config';
import { getSetting, setSetting } from '../lib/settings';
import { createPiece, saveVersion } from '../services/pieces';
import { db, now, rawDb, schema } from './index';

type Idea = typeof schema.ideas.$inferSelect;

export function migratePhase14() {
  if (getSetting('phase14')) return;
  const dir = join(config.dataDir, 'backups');
  mkdirSync(dir, { recursive: true });
  const backup = join(dir, `${new Date().toISOString().slice(0, 10)}-before-phase14.sqlite`);
  if (!existsSync(backup)) rawDb.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);

  const pages = db.select().from(schema.workspaces).all();
  db.transaction((tx) => {
    for (const w of pages) {
      const hidden = w.kind === 'islamic' ? true : w.hidden;
      const color = w.color === 'orange' && pages.some((o) => o.id !== w.id && o.color === 'amber') ? 'violet' : w.color;
      tx.update(schema.workspaces).set({ stages: BOARD_STAGES, hidden, color, updatedAt: now() }).where(eq(schema.workspaces.id, w.id)).run();
    }
  });

  let moved = 0;
  for (const w of pages.filter((p) => p.kind !== 'clipping')) moved += moveIdeas(w.id);
  setSetting('phase14', Date.now());
  console.log(`[phase14] database copied to ${backup}; ${moved} ideas are video cards now`);
}

/** My ideas on one page become its video cards. */
function moveIdeas(workspaceId: string) {
  const ideas = db
    .select()
    .from(schema.ideas)
    .where(and(eq(schema.ideas.workspaceId, workspaceId), isNull(schema.ideas.deletedAt)))
    .orderBy(asc(schema.ideas.position))
    .all();
  const kids = new Map<string, Idea[]>();
  for (const i of ideas) kids.set(i.parentId ?? '', [...(kids.get(i.parentId ?? '') ?? []), i]);
  const mine = (i: Idea) => i.by !== 'claude' && i.kind !== 'saved' && i.kind !== 'picture';
  const bullets = (id: string, depth = 0): string[] => (kids.get(id) ?? []).filter(mine).flatMap((k) => [`${'  '.repeat(depth)}• ${k.title.trim()}`, ...bullets(k.id, depth + 1)]);

  // Locked-in videos first: my words back in place of Claude's flesh-out.
  for (const i of ideas.filter((x) => x.pieceId)) restoreMine(i.pieceId!);

  let n = 0;
  let position = Date.now();
  const move = (i: Idea, series?: { name: string; episode: number }) => {
    const title = i.title.trim().replace(/^"(.*)"$/, '$1') || 'Untitled';
    const script = (i.script ?? '').replace(/\s+$/, '');
    const notes = [(i.body ?? '').trim(), ...bullets(i.id)].filter(Boolean).join('\n');
    const piece = i.pieceId ? db.select().from(schema.pieces).where(eq(schema.pieces.id, i.pieceId)).get() : undefined;
    if (piece) {
      // The card exists: my latest words from the idea are its script and notes (the lock-in also listed Claude's
      // sub-ideas there, which go).
      const branch = piece.activeBranchId ? db.select().from(schema.branches).where(eq(schema.branches.id, piece.activeBranchId)).get() : undefined;
      if (branch) {
        const draft = normalizeDraft(branch.working);
        saveVersion(branch.id, { author: 'you', message: 'Your script and notes, from Ideas', content: { ...draft, hook: '', script: script || draft.script, notes } });
      }
      db.update(schema.pieces)
        .set({ title, series: series?.name ?? null, episode: series?.episode ?? null, updatedAt: now() })
        .where(eq(schema.pieces.id, piece.id))
        .run();
    } else {
      const { pieceId } = createPiece(workspaceId, { title, stage: script ? 'script' : 'idea', content: { script, notes }, author: 'you', message: 'From Ideas' });
      db.update(schema.pieces)
        .set({ series: series?.name ?? null, episode: series?.episode ?? null, position: position++ })
        .where(eq(schema.pieces.id, pieceId))
        .run();
    }
    n++;
  };

  for (const root of (kids.get('') ?? []).filter(mine)) {
    if (root.kind === 'series') {
      const name = root.title.trim();
      (kids.get(root.id) ?? []).filter(mine).forEach((ep, k) => move(ep, { name, episode: k + 1 }));
    } else move(root);
  }
  return n;
}

/** A locked-in video whose newest version is Claude's flesh-out goes back to the version before it. */
function restoreMine(pieceId: string) {
  const piece = db.select().from(schema.pieces).where(eq(schema.pieces.id, pieceId)).get();
  if (!piece?.activeBranchId) return;
  const [head, before] = db.select().from(schema.versions).where(eq(schema.versions.branchId, piece.activeBranchId)).orderBy(desc(schema.versions.number)).limit(2).all();
  if (!head || !before || head.author !== 'claude' || !/^Fleshed out/i.test(head.message)) return;
  const mine = normalizeDraft(before.content);
  saveVersion(piece.activeBranchId, { author: 'you', message: 'Back to your words (Claude’s flesh-out is in the history)', content: { ...mine, hook: '' } });
}
