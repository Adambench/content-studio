// The creator's comments on finished videos, for Claude Code (the app's chat uses get_notes / resolve_note).
//   npm run notes                         every video with open comments, each comment with its context
//   npm run notes -- <pieceId> [--all]    one video's (--all: fixed and closed ones too)
//   npm run notes -- fix <noteId> "<what changed>"       mark it fixed, with the answer the creator sees
//   npm run notes -- answer <noteId> "<reply>"           answer it and leave it open (couldn't, or they choose)
// Reads and writes the app's database directly; the page picks the change up within ~20 s.
import { runMigrations } from '../src/db';
import { getNote, notesText, piecesWithOpenNotes, updateNote } from '../src/studio/notes';

runMigrations();
const [cmd, a, ...rest] = process.argv.slice(2).filter((x) => x !== '--all');
const all = process.argv.includes('--all');

if (cmd === 'fix' || cmd === 'answer') {
  const reply = rest.join(' ').trim();
  if (!a || !reply) throw new Error(`Usage: notes ${cmd} <noteId> "<${cmd === 'fix' ? 'what changed' : 'reply'}>"`);
  getNote(a);
  const n = updateNote(a, { reply, status: cmd === 'fix' ? 'fixed' : 'open' });
  console.log(`${n.status}: ${n.text}\n  → ${n.reply}`);
} else if (cmd) {
  console.log(await notesText(cmd, { all }));
} else {
  const pieces = piecesWithOpenNotes();
  if (!pieces.length) console.log('No open comments.');
  for (const p of pieces) console.log(`${await notesText(p.pieceId)}\n`);
}
process.exit(0);
