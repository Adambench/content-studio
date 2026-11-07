// A page's series, for Claude Code (the app shows them under a page's Series).
//   npm run series                                     every page's series: what each follows, its episodes
//   npm run series -- <seriesId>                       one series with every episode's script and notes
//   npm run series -- new <page> "<name>" ["<about>"]  a new series on a page (its name or id)
//   npm run series -- about <seriesId> "<about>"       what every episode follows
//   npm run series -- episode <seriesId> "<title>" [--script <file>] [--notes <file>] [--film]
//                                                      a new card as the next episode, with Claude's script and notes
//                                                      (Writing; --film: Ready to film)
//   npm run series -- write <pieceId> [--script <file>] [--notes <file>] [--film]
//                                                      Claude's script and notes on a card, as a new version
//   npm run series -- add <pieceId> <seriesId|none>    a card as the series' next episode (none: out of its series)
//   npm run series -- order <seriesId> <pieceId>…      the episodes in this order
// Reads and writes the app's database directly; the app shows the change when its window is next focused.
import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { normalizeDraft } from '../../shared/types';
import { db, runMigrations, schema } from '../src/db';
import { getPiece, saveVersion } from '../src/services/pieces';
import { addEpisode, createSeries, getSeries, listSeries, orderEpisodes, setPieceSeries, updateSeries } from '../src/services/series';

runMigrations();
const argv = process.argv.slice(2);

/** A `--flag <file>` value, read from the file. */
function fileFlag(name: string) {
  const at = argv.indexOf(name);
  if (at < 0) return undefined;
  const path = argv[at + 1];
  if (!path) throw new Error(`${name} <file>`);
  argv.splice(at, 2);
  return readFileSync(path, 'utf8').replace(/\s+$/, '');
}
const script = fileFlag('--script');
const notes = fileFlag('--notes');
const film = argv.includes('--film');
const args = argv.filter((x) => x !== '--film');

function page(nameOrId: string) {
  const all = db.select().from(schema.workspaces).all();
  const w = all.find((x) => x.id === nameOrId || x.id.startsWith(nameOrId)) ?? all.find((x) => x.name.toLowerCase() === nameOrId.toLowerCase());
  if (!w) throw new Error(`No page “${nameOrId}”: ${all.map((x) => x.name).join(', ')}`);
  return w;
}

function draftOf(pieceId: string) {
  const p = getPiece(pieceId);
  const branch = p.activeBranchId ? db.select().from(schema.branches).where(eq(schema.branches.id, p.activeBranchId)).get() : undefined;
  return { piece: p, branchId: branch?.id, draft: normalizeDraft(branch?.working) };
}

/** Claude's script and notes on a card, and the column it waits in. */
function write(pieceId: string, message: string) {
  const { branchId, draft } = draftOf(pieceId);
  if (!branchId) throw new Error('That card has no draft.');
  if (script !== undefined || notes !== undefined) saveVersion(branchId, { author: 'claude', message, content: { ...draft, script: script ?? draft.script, notes: notes ?? draft.notes } });
  if (film) db.update(schema.pieces).set({ stage: 'film' }).where(eq(schema.pieces.id, pieceId)).run();
}

const line = (s: ReturnType<typeof getSeries>) =>
  [`[${s.id}] ${s.name} (${s.episodes.length} episode${s.episodes.length === 1 ? '' : 's'})`, s.about && `  ${s.about.replace(/\n+/g, '\n  ')}`, ...s.episodes.map((e) => `  Ep ${e.episode} · ${e.column} · ${e.title} [${e.id}]`)].filter(Boolean).join('\n');

const [cmd, a, b, ...more] = args;
if (cmd === 'new') {
  if (!a || !b) throw new Error('Usage: series new <page> "<name>" ["<about>"]');
  console.log(line(createSeries(page(a).id, { name: b, about: more.join(' ') })));
} else if (cmd === 'about') {
  if (!a || !b) throw new Error('Usage: series about <seriesId> "<about>"');
  console.log(line(updateSeries(a, { about: [b, ...more].join(' ') })));
} else if (cmd === 'episode') {
  if (!a || !b) throw new Error('Usage: series episode <seriesId> "<title>" [--script <file>] [--notes <file>] [--film]');
  const { pieceId, episode } = addEpisode(a, { title: b, script, notes, author: 'claude' });
  if (film) db.update(schema.pieces).set({ stage: 'film' }).where(eq(schema.pieces.id, pieceId)).run();
  console.log(`Ep ${episode}: ${b} [${pieceId}]`);
} else if (cmd === 'write') {
  if (!a || (script === undefined && notes === undefined && !film)) throw new Error('Usage: series write <pieceId> [--script <file>] [--notes <file>] [--film]');
  write(a, 'Claude’s script and notes');
  console.log(`Saved on ${getPiece(a).title}`);
} else if (cmd === 'add') {
  if (!a || !b) throw new Error('Usage: series add <pieceId> <seriesId|none>');
  setPieceSeries(a, b === 'none' ? null : b);
  const p = getPiece(a);
  console.log(p.seriesId ? `${p.title}: Ep ${p.episode} of ${getSeries(p.seriesId).name}` : `${p.title}: no series`);
} else if (cmd === 'order') {
  if (!a || !b) throw new Error('Usage: series order <seriesId> <pieceId>…');
  console.log(line(orderEpisodes(a, [b, ...more])));
} else if (cmd) {
  const s = getSeries(cmd);
  console.log(line(s));
  for (const e of s.episodes) {
    const { draft } = draftOf(e.id);
    console.log(`\n── Ep ${e.episode}: ${e.title} [${e.id}] · ${e.column}\n${draft.labels?.script ?? "Script"}:\n${draft.script || '(empty)'}\n\n${draft.labels?.notes ?? "Notes"}:\n${draft.notes || '(empty)'}`);
  }
} else {
  const pages = db.select().from(schema.workspaces).all();
  let any = false;
  for (const w of pages) {
    const list = listSeries(w.id);
    if (!list.length) continue;
    any = true;
    console.log(`# ${w.name}${w.hidden ? ' (hidden)' : ''}\n${list.map(line).join('\n\n')}\n`);
  }
  if (!any) console.log('No series yet.');
}
