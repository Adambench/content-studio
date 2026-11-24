// What Claude follows, as plain files Claude Code loads by itself: ~/studio/CLAUDE.md (written by the app on every
// start: how to work, halal; locked), ~/studio/lessons.md (lessons for every page) and each page's CLAUDE.md
// (style and lessons). Claude and I both edit the lessons and styles; a lesson is a "- [x] " line, unticked = ignored.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Brain, Lesson } from '../../../shared/types.ts';
import { config } from '../config.ts';
import { emit, HttpError } from '../lib/util.ts';
import { ensurePageFiles, getPage, listPages, pageDir } from './pages.ts';

export const HALAL = [
  'No music or instruments in anything you make, ever, and music in any footage is removed. Sound effects, ambience and voice are fine; a vocal nasheed only when I ask for one.',
  'No women on camera: in my footage, in stock, in anything drawn.',
  'Nothing haram shown, said or promoted.',
  'Religion: every ayah and hadith is cited (collection and number) and its wording checked on two sources; no rulings; nothing tied to another religion, even loosely (names, symbols, words).',
  'Gentle Return never shows my face.',
];

export const studioClaudeMd = () => join(config.studioDir, 'CLAUDE.md');
const lessonsFile = () => join(config.studioDir, 'lessons.md');
const marketFile = () => join(config.studioDir, 'market.md');

function studioInstructions(): string {
  return `# Content Studio

Written by the app on every start: edits here are lost. Lessons go in lessons.md or the page's CLAUDE.md.

You are the editor of my studio on this machine (ai-server: a GTX 1070, NVENC, Linux). Each folder here is a page
(one Instagram account): its CLAUDE.md says who it is, how it talks and looks; kit/ holds its look (logo, avatar,
fonts, colours, templates: use them); setup/ is where it was set up with me. Every other folder inside a page is one
video or carousel. You work in one video's folder; the app shows me your messages, the steps you report and every
version you save. I make Instagram content: Reels (9:16) and carousels (4:5). Make it production-grade and made to
hold attention; the skills (playbook first) say how.

## How to work

- Say little: one or two short sentences. I watch the video, not your text. No lists of what you did.
- Report progress with the studio tools: \`progress\` at each real step (in plain words, e.g. "Cutting the
  retakes"), \`ask\` when only I can decide (2 to 4 options, then end your turn), \`save_version\` for every finished
  render I should watch, \`notes_fixed\` when my notes are done, \`lesson\` for every general rule a note teaches
  (and change the skill or the code that caused it when it's general), \`set_title\` and \`set_caption\`.
- Never approve, post or publish anything anywhere. Approving is my click; posting is mine.
- Render with the \`render\` tool (one GPU job at a time, NVENC). Footage goes into a HyperFrames project as a hard
  link (a symbolic link to outside the project renders black).
- Check every render before saving it: frames at each cut (a contact sheet), loudness (about -14 LUFS), captions
  inside the safe area, no word cut off, nothing from the halal list. Fix and render again before I see it.
- Files: \`files/\` holds what I gave (takes, voice, photos; read the names). Work in \`work/\`. Keep
  \`project.md\` up to date: what this is, the decisions, what's left. Never delete anything outside this studio.
- No more footage coming and the script covered (every line has a take, sign-off included)? Start without asking.
- Don't touch the machine itself: no sudo, Docker, Ollama, Open WebUI, systemd, Tailscale or network settings.

## Halal (always, no exceptions)

${HALAL.map((h) => `- ${h}`).join('\n')}

## Lessons for every page

@lessons.md
`;
}

/** On every start: the studio's own CLAUDE.md as the app says, and lessons.md if it isn't there yet. */
export function ensureStudioFiles() {
  writeFileSync(studioClaudeMd(), studioInstructions());
  if (!existsSync(lessonsFile())) writeFileSync(lessonsFile(), '# Lessons for every page\n\nTicked lessons are followed, unticked ones are kept but ignored.\n\n');
  for (const b of listPages()) ensurePageFiles(b);
}

const LESSON = /^- \[( |x|X)\] (.+)$/;

function parseLessons(text: string): Lesson[] {
  return text.split('\n').flatMap((l, i) => {
    const m = l.match(LESSON);
    return m ? [{ text: m[2]!.trim(), on: m[1] !== ' ', line: i }] : [];
  });
}

const read = (f: string) => (existsSync(f) ? readFileSync(f, 'utf8') : '');

/** The skills Claude Code on ai-server loads (~/.claude/skills): name and the first line of the description. */
function skills(): { name: string; description: string }[] {
  const dir = join(homedir(), '.claude/skills');
  const repo = config.skillsDir;
  const names = new Set<string>();
  for (const d of [dir, repo]) if (existsSync(d)) for (const n of readdirSync(d)) names.add(n);
  return [...names].sort().flatMap((name) => {
    const f = [join(dir, name, 'SKILL.md'), join(repo, name, 'SKILL.md')].find(existsSync);
    if (!f) return [];
    const m = readFileSync(f, 'utf8').match(/^description:\s*(.+)$/m);
    const description = (m?.[1] ?? '').replace(/^["']|["']$/g, '').split(/(?<=\.)\s/)[0]!.slice(0, 140);
    return [{ name, description }];
  });
}

export function brain(): Brain {
  return {
    halal: HALAL,
    lessons: parseLessons(read(lessonsFile())),
    pages: listPages().map((b) => {
      const file = join(pageDir(b), 'CLAUDE.md');
      const text = read(file);
      return { pageId: b.id, name: b.name, color: b.color, file, text, lessons: parseLessons(text) };
    }),
    market: read(marketFile()),
    skills: skills(),
  };
}

/** The file a scope's lessons live in: 'all' → lessons.md, a page id → that page's CLAUDE.md. */
function scopeFile(scope: string): string {
  if (scope === 'all') return lessonsFile();
  const b = getPage(scope);
  ensurePageFiles(b);
  return join(pageDir(b), 'CLAUDE.md');
}

export function toggleLesson(scope: string, line: number, on: boolean) {
  const file = scopeFile(scope);
  const lines = read(file).split('\n');
  const m = lines[line]?.match(LESSON);
  if (!m) throw new HttpError(409, 'That lesson moved: reload');
  lines[line] = `- [${on ? 'x' : ' '}] ${m[2]}`;
  writeFileSync(file, lines.join('\n'));
  emit('brain', scope);
}

/** A new lesson (Claude's `lesson` tool, or mine), ticked. In a page's CLAUDE.md it goes under "## Lessons". */
export function addLesson(scope: string, text: string) {
  const file = scopeFile(scope);
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, 400);
  if (!clean) return;
  let body = read(file);
  if (parseLessons(body).some((l) => l.text.toLowerCase() === clean.toLowerCase())) return;
  if (scope !== 'all' && !/^## Lessons/m.test(body)) body = `${body.trimEnd()}\n\n## Lessons\n\n`;
  writeFileSync(file, `${body.trimEnd()}\n- [x] ${clean}\n`);
  emit('brain', scope);
}

/** A page's CLAUDE.md as I typed it in Brain. */
export function writePageFile(pageId: string, text: string) {
  const file = scopeFile(pageId);
  writeFileSync(file, text.endsWith('\n') ? text : `${text}\n`);
  emit('brain', pageId);
}
