// Hooks and Directions on a script (PLAN.md Phase 14): help writing it, with the viral skills. Claude never rewrites
// my words: hooks are other first lines to take or leave, directions are ways to build the video, one line each.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { normalizeDraft } from '../../../shared/types';
import { askStructured } from '../claude/oneshot';
import { playbook } from '../claude/plugin';
import { config } from '../config';
import { db, schema } from '../db';
import { badRequest } from '../lib/http';
import { countUse } from '../toolbox/uses';
import { getPiece, getWorkspace } from './pieces';
import { seriesText } from './series';

const skillCache = new Map<string, string>();

/** A skill's instructions (its SKILL.md without the front matter) for a prompt: background prompts load no skills. */
function skill(name: string) {
  let text = skillCache.get(name);
  if (text === undefined) {
    try {
      text = readFileSync(join(config.pluginDir, 'skills', name, 'SKILL.md'), 'utf8')
        .replace(/^---\n[\s\S]*?\n---\n/, '')
        .trim();
    } catch {
      text = '';
    }
    skillCache.set(name, text);
  }
  if (!text) return '';
  countUse('skill', name);
  return `# Skill: ${name}\n\n${text}`;
}

function load(pieceId: string) {
  const piece = getPiece(pieceId);
  const ws = getWorkspace(piece.workspaceId);
  const branch = piece.activeBranchId ? db.select().from(schema.branches).where(eq(schema.branches.id, piece.activeBranchId)).get() : undefined;
  return { piece, ws, draft: normalizeDraft(branch?.working) };
}

function about(ws: ReturnType<typeof getWorkspace>) {
  return [`Page: ${ws.name}`, ws.niche && `Niche: ${ws.niche}`, ws.brandGuide && `Brand guide:\n${ws.brandGuide}`, ws.voiceMemory && `How I write:\n${ws.voiceMemory}`].filter(Boolean).join('\n\n');
}

/** How the words reach the viewer: on camera, or (an Islamic page) the creator's recorded voice over visuals. */
const spoken = (ws: ReturnType<typeof getWorkspace>) => (ws.kind === 'islamic' ? 'spoken in their own recorded voice over visuals (their face is never seen)' : 'spoken on camera');

const threeOf = (key: string) => ({
  type: 'object',
  properties: { [key]: { type: 'array', items: { type: 'string' }, minItems: 3, maxItems: 3 } },
  required: [key],
  additionalProperties: false,
});

const tidy = (list: string[]) =>
  list
    .map((s) => s.trim().replace(/^["“]+|["”]+$/g, ''))
    .filter(Boolean)
    .slice(0, 3);

/** Three other first lines for the script, in my voice. */
export async function hookOptions(pieceId: string): Promise<string[]> {
  const { piece, ws, draft } = load(pieceId);
  if (!draft.script.trim()) throw badRequest('Write the script first.');
  const system = [
    playbook('hooks', 'halal'),
    skill('viral-hooks'),
    skill('content-principles'),
    `You help a creator with the first line of a short vertical video${ws.kind === 'islamic' ? '' : ' they wrote themselves'}. Never rewrite the script. Offer exactly 3 alternative first lines (hooks) they can take or leave: in their voice, true to what the script says (no claim it does not make), ${spoken(ws)}, each under 20 words, each a different kind of hook. In a series, every hook keeps the series' format. Plain text: no quotes, emoji or hashtags.`,
  ]
    .filter(Boolean)
    .join('\n\n---\n\n');
  const prompt = [about(ws), seriesText(pieceId), `Title: ${piece.title}`, `Script (its first line is the hook now):\n${draft.script}`, draft.notes.trim() && `Their notes (effects and edit wishes):\n${draft.notes}`]
    .filter(Boolean)
    .join('\n\n');
  const res = await askStructured<{ hooks: string[] }>({ task: 'ideas', now: true, system, prompt, schema: threeOf('hooks') });
  return tidy(res.hooks);
}

/** Three ways to build the video: an angle or a structure each, one line. */
export async function scriptDirections(pieceId: string): Promise<string[]> {
  const { piece, ws, draft } = load(pieceId);
  const system = [
    playbook('content-model', 'hooks', 'retention', 'halal'),
    skill('viral-short-form'),
    skill('content-principles'),
    `You help a creator decide how to build a short vertical video ${ws.kind === 'islamic' ? 'they record in their own voice (their face is never seen)' : 'they write and film themselves'}. Offer exactly 3 directions: different angles or structures for it (how it opens, what carries the middle, how it ends), each one line under 25 words that starts with a 2–3 word name and a colon. Concrete to this idea, never generic advice; in a series, true to its format. Do not write the script.`,
  ]
    .filter(Boolean)
    .join('\n\n---\n\n');
  const prompt = [about(ws), seriesText(pieceId), `Title: ${piece.title}`, draft.script.trim() ? `Script so far:\n${draft.script}` : 'No script yet.', draft.notes.trim() && `Their notes:\n${draft.notes}`]
    .filter(Boolean)
    .join('\n\n');
  const res = await askStructured<{ directions: string[] }>({ task: 'ideas', now: true, system, prompt, schema: threeOf('directions') });
  return tidy(res.directions);
}
