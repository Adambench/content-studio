// The creator's comments on finished videos, for Claude Code (the app's chat uses get_notes / resolve_note).
//   npm run notes                         every video with open comments, each comment with its context, then the lessons
//   npm run notes -- <pieceId> [--all]    one video's (--all: fixed and closed ones too)
//   npm run notes -- fix <noteId> "<what changed>" <lesson>      mark it fixed, with the answer the creator sees
//   npm run notes -- answer <noteId> "<reply>" [<lesson>]         answer it and leave it open (couldn't, or they choose)
//   npm run notes -- learn <noteId> <lesson>                      record a comment's lesson on its own
//   npm run notes -- lessons                                      every lesson, with how many comments taught it
// <lesson> is what the comment teaches every later video, one of:
//   --lesson <lessonId> ["<sharper rule>"]                         it repeats a lesson (optionally reworded)
//   --new <topic> "<title>" "<rule>" [--page]                      a new lesson (--page: only this page's videos)
//   --one-off "<why>"                                              it holds for this video alone
// Reads and writes the app's database directly; the page picks the change up within ~20 s.
import { KNOWLEDGE_TOPICS, type KnowledgeTopic } from '../../shared/knowledge';
import { runMigrations } from '../src/db';
import { learnFromNote, listLessons, type LessonInput } from '../src/knowledge/lessons';
import { getNote, LESSON_HOWTO, notesText, piecesWithOpenNotes, updateNote } from '../src/studio/notes';
import { lessonsText } from '../src/knowledge/lessons';

runMigrations();
const argv = process.argv.slice(2);
const all = argv.includes('--all');
const pageOnly = argv.includes('--page');
const args = argv.filter((x) => x !== '--all' && x !== '--page');

/** The lesson flags, and the arguments before them. */
function splitLesson(list: string[]): { rest: string[]; lesson: LessonInput | null; oneOff: string | null } {
  const at = list.findIndex((x) => x === '--lesson' || x === '--new' || x === '--one-off');
  if (at < 0) return { rest: list, lesson: null, oneOff: null };
  const [flag, ...more] = list.slice(at);
  const rest = list.slice(0, at);
  if (flag === '--one-off') return { rest, lesson: null, oneOff: more.join(' ').trim() || 'one-off' };
  if (flag === '--lesson') {
    if (!more[0]) throw new Error('--lesson <lessonId> ["<sharper rule>"]');
    return { rest, lesson: { id: more[0], rule: more.slice(1).join(' ').trim() || undefined }, oneOff: null };
  }
  const [topic, title, ...rule] = more;
  if (!(KNOWLEDGE_TOPICS as readonly string[]).includes(topic)) throw new Error(`--new <topic> "<title>" "<rule>": the topic is one of ${KNOWLEDGE_TOPICS.join(', ')}`);
  if (!title || !rule.length) throw new Error('--new <topic> "<title>" "<rule>"');
  return { rest, lesson: { topic: topic as KnowledgeTopic, title, rule: rule.join(' '), pageOnly }, oneOff: null };
}

const [cmd, a] = args;
if (cmd === 'fix' || cmd === 'answer') {
  const { rest, lesson, oneOff } = splitLesson(args.slice(2));
  const reply = rest.join(' ').trim();
  if (!a || !reply) throw new Error(`Usage: notes ${cmd} <noteId> "<${cmd === 'fix' ? 'what changed' : 'reply'}>" <--lesson id | --new topic "title" "rule" | --one-off "why">`);
  getNote(a);
  if (cmd === 'fix' && !lesson && !oneOff) throw new Error(`Name what it teaches too (--lesson <id>, --new <topic> "<title>" "<rule>" or --one-off "<why>").\n\n${LESSON_HOWTO}`);
  const learned = lesson ? learnFromNote(a, lesson) : null;
  const n = updateNote(a, { reply, status: cmd === 'fix' ? 'fixed' : 'open' });
  console.log(`${n.status}: ${n.text}\n  → ${n.reply}${learned ? `\n  lesson ${learned.id}: ${learned.title} (${learned.taught?.count ?? 1}×)` : oneOff ? `\n  one-off: ${oneOff}` : ''}`);
} else if (cmd === 'learn') {
  const { lesson } = splitLesson(args.slice(2));
  if (!a || !lesson) throw new Error('Usage: notes learn <noteId> <--lesson id ["rule"] | --new topic "title" "rule">');
  const learned = learnFromNote(a, lesson);
  console.log(`lesson ${learned.id}: ${learned.title} (${learned.taught?.count ?? 1}×)`);
} else if (cmd === 'lessons') {
  const lessons = listLessons({ all: true });
  if (!lessons.length) console.log('No lessons yet.');
  for (const l of lessons) console.log(`[${l.id}] ${l.topic} · ${l.title} (${l.taught?.count ?? 0}×${l.status === 'active' ? '' : `, ${l.status}`}${l.workspaceId ? ', one page' : ''})\n    ${l.body.replace(/\n+/g, ' ')}`);
} else if (cmd) {
  console.log(await notesText(cmd, { all }));
} else {
  const pieces = piecesWithOpenNotes();
  if (!pieces.length) console.log('No open comments.');
  for (const p of pieces) console.log(`${await notesText(p.pieceId, { lessons: false })}\n`);
  if (pieces.length) console.log(`${LESSON_HOWTO}\n\n${lessonsText(null, { ids: true }) || 'No lessons yet: every comment fixed starts one.'}`);
}
process.exit(0);
