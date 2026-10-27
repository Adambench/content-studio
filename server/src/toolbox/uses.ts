import { sql } from 'drizzle-orm';
import type { ToolKind } from '../../../shared/toolbox';
import { db, now, schema } from '../db';

/** One more use of a skill, studio tool or model, for the Toolbox. Never throws: counting must not break the work. */
export function countUse(kind: ToolKind, name: string) {
  if (!name) return;
  try {
    const at = now();
    db.insert(schema.toolUses)
      .values({ kind, name, count: 1, lastAt: at })
      .onConflictDoUpdate({ target: [schema.toolUses.kind, schema.toolUses.name], set: { count: sql`${schema.toolUses.count} + 1`, lastAt: at } })
      .run();
  } catch (err) {
    console.warn('[toolbox] couldn’t count a use', err);
  }
}

/** A chat tool call by its SDK name: a studio tool, a skill opened with Skill (or the local chat's read_skill), the web. */
export function countToolCall(name: string, input: Record<string, unknown>) {
  if (name === 'Skill' || name === 'read_skill') {
    const skill = String(input.skill ?? input.name ?? '').replace(/^[^:]+:/, '');
    if (skill) countUse('skill', skill);
    return;
  }
  // Reading a skill's own files is part of using it, not a tool.
  if (name === 'Read') return;
  countUse('tool', name === 'web_fetch' ? 'WebFetch' : name.replace(/^mcp__[^_]+__/, ''));
}

/** Claude's model family (opus, sonnet, haiku) from an alias or a full id. */
export const claudeFamily = (model: string) => /opus|sonnet|haiku|fable/.exec(model)?.[0] ?? model;

export function listUses() {
  const out = new Map<string, { count: number; lastAt: number }>();
  for (const r of db.select().from(schema.toolUses).all()) out.set(`${r.kind}:${r.name}`, { count: r.count, lastAt: r.lastAt });
  return out;
}
