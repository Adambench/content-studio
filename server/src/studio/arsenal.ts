import { desc, eq } from 'drizzle-orm';
import { ARSENAL, arsenalUsed, readyArsenal, type ArsenalItem } from '../../../shared/arsenal';
import { db, schema } from '../db';

/** How often each arsenal item appears in the workspace's most recently changed edits (one count per edit). */
export function recentArsenalUse(workspaceId: string, edits = 8, excludePieceId?: string) {
  const rows = db
    .select({ pieceId: schema.edits.pieceId, working: schema.edits.working })
    .from(schema.edits)
    .where(eq(schema.edits.workspaceId, workspaceId))
    .orderBy(desc(schema.edits.workingUpdatedAt))
    .limit(edits + 1)
    .all()
    .filter((r) => r.pieceId !== excludePieceId)
    .slice(0, edits);
  const counts = new Map<string, number>();
  for (const r of rows) for (const id of arsenalUsed(r.working)) counts.set(id, (counts.get(id) ?? 0) + 1);
  return { edits: rows.length, counts };
}

/** The arsenal as text for a prompt or a tool reply: each item, when it fits, and how often the page used it lately. */
export function arsenalText(workspaceId: string, opts: { kind?: ArsenalItem['kind']; excludePieceId?: string } = {}) {
  const { edits, counts } = recentArsenalUse(workspaceId, 8, opts.excludePieceId);
  const items = (opts.kind ? ARSENAL.filter((a) => a.kind === opts.kind) : ARSENAL).filter((a) => a.ready || !opts.kind);
  return {
    recentEdits: edits,
    items: items.map((a) => ({ id: a.id, kind: a.kind, label: a.label, use: a.use, how: a.how, ready: a.ready, usedInRecentEdits: counts.get(a.id) ?? 0 })),
    unusedLately: readyArsenal().filter((a) => !counts.get(a.id)).map((a) => a.id),
  };
}
