// Write (a script in my voice) and Hooks (other first lines to take or leave). Both read the page (its voice, niche,
// style), my lessons, what works in the niche, and a few of the page's own scripts so the voice is mine.

import { z } from 'zod';
import type { Card, Page } from '../../../shared/types.ts';
import { all } from '../db/db.ts';
import { rulesText } from '../services/rules.ts';
import { skill } from './claude.ts';

function ownScripts(page: Page, except: string): string {
  const rows = all<{ title: string; script: string }>(
    "SELECT title, script FROM cards WHERE page_id = ? AND id != ? AND length(script) > 80 AND stage IN ('review', 'ready', 'posted') ORDER BY updated_at DESC LIMIT 3",
    page.id,
    except,
  );
  return rows.map((r) => `### ${r.title}\n${r.script.slice(0, 1800)}`).join('\n\n');
}

function pageBlock(page: Page) {
  const s = page.settings;
  return [`Page: ${page.name}`, s.niche && `Niche: ${s.niche}`, s.voice && `How it talks: ${s.voice}`, s.style && `Its style: ${s.style}`].filter(Boolean).join('\n');
}

function system(page: Page, card: Card) {
  return [
    'You write short vertical videos (Instagram Reels first, 20–60 s) for one creator. English. Plain words a stranger understands on the first hearing. No AI tells: no em dashes, no "game-changer", no "let\'s dive in", no rhetorical lists of three.',
    'The halal rules and my lessons below are hard rules. Never suggest music.',
    rulesText({ pageId: page.id, format: card.recipe, sources: ['halal', 'lesson', 'style', 'market'] }),
    '# How attention works (apply silently, never as a checklist)',
    skill('content-principles'),
    '# Hooks',
    skill('playbook', 'references/hooks.md'),
    '# Keeping people watching',
    skill('playbook', 'references/retention.md'),
  ].join('\n\n');
}

export const writeSchema = z.object({
  title: z.string().describe('A short working title, 2–6 words'),
  script: z.string().describe('What is said, line by line (one spoken sentence a line), in the creator’s voice'),
  why: z.string().describe('One sentence: the promise of the first line and where it is paid'),
});

export function writePrompt(page: Page, card: Card, instruction: string) {
  const prompt = [
    pageBlock(page),
    `Card: ${card.title}`,
    card.notes.trim() && `${card.labels.notes} (what I want, my notes about the day or the idea):\n${card.notes.trim()}`,
    card.script.trim() && `My current ${card.labels.script.toLowerCase()} (keep what is mine and good; improve the rest):\n${card.script.trim()}`,
    instruction.trim() && `What I asked for now: ${instruction.trim()}`,
    ownScripts(page, card.id) && `Scripts of mine on this page, for the voice (don't copy their topics):\n${ownScripts(page, card.id)}`,
    'Write the script. One idea. The first line is the hook: it opens on a sentence a stranger can follow and makes a promise; the payoff comes before the end; it ends on a finished thought (and my sign-off if my scripts have one). Short spoken sentences.',
  ]
    .filter(Boolean)
    .join('\n\n');
  return { system: system(page, card), prompt };
}

export const hooksSchema = z.object({
  hooks: z
    .array(z.object({ line: z.string().describe('The new first line, said out loud'), why: z.string().describe('Why it stops the scroll, in a few words') }))
    .min(3)
    .max(5),
});

export function hooksPrompt(page: Page, card: Card) {
  const prompt = [
    pageBlock(page),
    `Card: ${card.title}`,
    `The ${card.labels.script.toLowerCase()}:\n${card.script.trim() || '(empty)'}`,
    card.notes.trim() && `${card.labels.notes}:\n${card.notes.trim()}`,
    'Give 3–5 other first lines I could say instead of my first line. Each must lead straight into my second line, keep my meaning and my voice, and be something I would really say. Different kinds (a bold claim, a question, a number, a confession, the end result first). Never rewrite the rest.',
  ]
    .filter(Boolean)
    .join('\n\n');
  return { system: system(page, card), prompt };
}
