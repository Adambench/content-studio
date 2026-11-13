// A video's edit, from Claude Code: read it, change it, look at it, check it and render it, without writing a script
// for each step or reading the studio's source. Everything goes through the server's own modules (the same saves,
// checks and render queue the app uses); the running app's job queue does the renders.
//   npm run edit                                   recent cards with footage or an edit (help: this text)
//   npm run edit -- list [words]                   cards whose title has these words
//   npm run edit -- <card>                         the edit: versions, renders, check, story, clips with their words,
//                                                  overlays, sound, the footage on the card, open comments
//   npm run edit -- takes <card> [file…] [--words] each take's words as phrases between pauses (cut points), with times
//   npm run edit -- rewhisper <card> <file> <from> <to> ["<words>"]   Whisper that stretch of the file on its own and
//                                                  put its words in the transcript there (a rep `takes` marks ??); with
//                                                  the words said, Whisper's timings carry them (one word for one word;
//                                                  `~` joins a heard word onto the one before: "GoHighLevel ~")
//   npm run edit -- fit <card> <file>              a transcript from before words were fitted to a phone take's pauses:
//                                                  each word out of the silence (a clip's first word missing from captions)
//   npm run edit -- types [name…|lists|graphics|library]   the edit's types and option lists (instead of shared/edit.ts)
//   npm run edit -- arsenal <card>                 every move, and how often this page's recent edits used it
//   npm run edit -- set <card> "<message>" <path>=<json> …   change fields and save a version (see `set` below)
//   npm run edit -- get <card>                     the working copy into <work>/spec.json (prints the path only)
//   npm run edit -- add <card> <file> ["<name>"]  put a picture, video or recording on the card (a screenshot, a
//                                                  frame of a video I mention): its id for clips and scene images
//   npm run edit -- carousel <card> ["<message>" <png…|folder>]   a carousel (Instagram, 4:5 slides, 20 at most): the
//                                                  slides in order (a folder: its images by name) saved as a version
//                                                  authored by Claude; Review shows them, Approve posts them, the card
//                                                  exports them. --media <id,id…>: pictures already on the card instead.
//                                                  Without a message: its versions. Comments on it pin to a slide.
//   npm run edit -- put <card> <file> "<message>"  save a whole spec (.json) or a design (.mts: default export
//                                                  (spec, ctx) => spec) as a version authored by Claude
//                                                  (--dry --preview <overlayId> [--at 0,2]: a sheet of it, nothing saved)
//   npm run edit -- light <card>                   what the light fix does to each take (grade.light), before and after
//   npm run edit -- frames <card> <t…> [--source <file>] [--v <n>] [--px <width>]   one small contact sheet
//   npm run edit -- preview <card> <overlayId> [t…] [--px <width>]   an overlay as it will render, one sheet
//   npm run edit -- check <card>                   the check before a render (one Opus call), its report
//   npm run edit -- render <card> [--check] [--wait]   queue a render (--check: the check and Claude's fix first)
//   npm run edit -- wait <card>                    until the newest render finishes
//   npm run edit -- heard <card> [--v <n>]         Whisper the newest render: what it really says, ✂ at the cuts
// <card> is an id, an id prefix or words of the title. File ids may be shortened to their first 8 characters
// anywhere (set, put, --source). `--dry` on set/put prints the result without saving.
// set paths: clips.<id|index>.<field>=<json> · overlays.<id>.<field>=… · captions.position=0.72 · story.payoffAt=24
//   <path>=- deletes (an array item or a field) · clips+=<json> appends · clips.<id>+=<json> inserts after it.
//   A value that isn't JSON is taken as text (story.promise=Plain words work).
//
// A series episode (raw: me talking, cut tight, the tracker, my own screens as proof) is one short design file:
//   export default async (spec, ctx) => {
//     spec.clips = await ctx.cut('<file>', [['hook', 1.0, 4.44], ['last', 22.24, 25.64], …]);   // name, from, to: the
//       // times `takes` prints for the rep to keep. Cuts go into the pauses themselves; framing takes turns (wide,
//       // close on the face); a line over 5.5 s reframes once. 4th item: { frame: 'tight' }, { out: 87.6 }, { file }.
//     await ctx.episode({ day: 6, made: 0, open: 'title', title: '<my words>', proof: [{ on: 'booked', file: '<id>', at: 'meeting' }] });
//   };
//   day/made go on the tracker (days and goal carry on from the episode before, as do the captions); `open` is plain
//   (tracker from the first frame), title (my own words as a card, then the tracker) or cold (nothing until the
//   second line): left out, the one the series used least. The takes' light is put right (light: false keeps it).
//   Notes printed before the save say where a cut found no pause and what would fix it: settle each one.
// What goes on screen, in a raw episode:
//   · Proof beats graphics: a screenshot or recording of the thing I talk about, on the word that names it, 2–5 s,
//     5 s of me between two, never one that shows a private screen (look at it first: `frames --source`).
//   · Nothing repeats what I say. A label is read in a second: a few words, one idea, up as long as its topic.
//   · One thing to read at a time beside the captions; my face is never covered for a whole line.
//   · Milestones (first client, first $1k, a recap) may take library scenes (`types library`); a daily one doesn't.
import { execFile as execFileCb } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { and, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { CAPTION_PRESETS, clipStarts, EDIT_FORMATS, editDuration, GRAPHIC_INFO, GRAPHICS, normalizeEdit, timelineWords, TRANSITIONS, type EditOverlay, type EditSpec, type TimelineWord } from '../../shared/edit';
import { FONT_FAMILIES } from '../../shared/fonts';
import { BROLL_LAYOUTS, CLIP_MOTIONS, FILTER_LOOKS, OVERLAY_ANIMATIONS } from '../../shared/looks';
import { qualityText } from '../../shared/quality';
import { SCENE_FONTS, SCENE_SOUNDS } from '../../shared/scene';
import { libraryScene, SCENE_LIBRARY, SCENE_PRESETS, type ScenePreset, type SceneFill } from '../../shared/scene-library';
import { BUILTIN_SFX } from '../../shared/sfx';
import type { Transcript } from '../../shared/types';
import { runTool } from '../src/compute/run';
import { config } from '../src/config';
import { db, runMigrations, schema } from '../src/db';
import { requireBinary } from '../src/lib/bin';
import { extractAudio, extractFrames, gradeImage } from '../src/lib/ffmpeg';
import { getSetting } from '../src/lib/settings';
import { mediaPath, readTranscript, saveUpload, transcriptPath, type MediaRow } from '../src/services/media';
import { arsenalText } from '../src/studio/arsenal';
import { bandPauses, fitToPauses, pauses, refineWords, voiceEnvelope } from '../src/studio/clean-cuts';
import { cutLines, cutsSound, dressEpisode, openOf, takeSound, type CutOptions, type EpisodeOptions, type LineRow, type SeriesSoFar } from '../src/studio/episode';
import { findEditForPiece, latestQuality, listEditVersions, listRenders, saveEditVersion, specMedia, specTranscripts } from '../src/studio/edits';
import { lightOf, lightText } from '../src/studio/light';
import { listNotes } from '../src/studio/notes';
import { listCarousel, saveCarousel } from '../src/studio/carousel';
import { getPiece } from '../src/services/pieces';
import { previewOverlay } from '../src/studio/preview';
import { checkEdit } from '../src/studio/quality';
import { queueRender } from '../src/studio/render';

runMigrations();
const execFile = promisify(execFileCb);
const r2 = (n: number) => Math.round(n * 100) / 100;
const f2 = (n: number) => n.toFixed(2);
const short = (id: string) => id.slice(0, 8);

const argv = process.argv.slice(2);
const flags = new Set<string>(argv.filter((a) => a === '--dry' || a === '--wait' || a === '--check' || a === '--words'));
/** `--name value` options. */
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const VALUED = new Set(['--source', '--v', '--px', '--preview', '--at', '--media']);
const args = argv.filter((a, i) => !flags.has(a) && !VALUED.has(a) && !VALUED.has(argv[i - 1]));

// ---------- finding things ----------

type Piece = typeof schema.pieces.$inferSelect;

function findPiece(q: string | undefined): Piece {
  if (!q) throw new Error('Which card? An id, an id prefix or words of its title.');
  const all = db.select().from(schema.pieces).all();
  const exact = all.find((p) => p.id === q);
  if (exact) return exact;
  const byId = all.filter((p) => p.id.startsWith(q));
  if (byId.length === 1) return byId[0];
  const norm = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const words = norm(q).split(' ').filter(Boolean);
  // Each word starts a word of the title (“day 0” isn't “100 days”).
  const hits = all.filter((p) => words.every((w) => norm(p.title).split(' ').some((t) => t.startsWith(w))));
  if (hits.length === 1) return hits[0];
  if (!hits.length) throw new Error(`No card matches “${q}”.`);
  throw new Error(`“${q}” matches ${hits.length} cards:\n${hits.map((p) => `  ${short(p.id)} ${p.title} (${p.stage})`).join('\n')}`);
}

/** The card's own footage and recordings (never its renders), oldest first. */
function cardFiles(pieceId: string) {
  return db
    .select()
    .from(schema.media)
    .where(and(eq(schema.media.pieceId, pieceId), isNull(schema.media.assetType), ne(schema.media.source, 'render'), inArray(schema.media.kind, ['video', 'image', 'audio'])))
    .orderBy(schema.media.createdAt)
    .all();
}

function editOf(piece: Piece) {
  const edit = findEditForPiece(piece.id);
  if (!edit) throw new Error(`“${piece.title}” has no edit yet: \`set\` or \`put\` starts one (its footage: \`npm run edit -- takes ${short(piece.id)}\`).`);
  return edit;
}

/** The folder for this card's design files and pictures; it outlives the session. */
function workDir(pieceId: string) {
  const dir = join(config.dataDir, 'edit-work', pieceId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Full ids for shortened file ids in a spec: the workspace's files whose id starts with them. */
function fullIds(spec: EditSpec, workspaceId: string): EditSpec {
  const rows = db.select({ id: schema.media.id }).from(schema.media).where(eq(schema.media.workspaceId, workspaceId)).all();
  const full = (id: string) => {
    if (!id || id.length >= 36 || id.startsWith('builtin:')) return id;
    const hits = rows.filter((r) => r.id.startsWith(id));
    if (hits.length !== 1) throw new Error(`File id “${id}” matches ${hits.length} files.`);
    return hits[0].id;
  };
  for (const c of spec.clips) c.mediaId = full(c.mediaId);
  for (const o of spec.overlays) {
    if (o.type === 'image' || o.type === 'broll') o.mediaId = full(o.mediaId);
    if (o.type === 'scene') for (const e of o.elements) if (e.mediaId) e.mediaId = full(e.mediaId);
  }
  for (const s of spec.audio.sfx) s.mediaId = full(s.mediaId);
  if (spec.audio.voiceover) spec.audio.voiceover.mediaId = full(spec.audio.voiceover.mediaId);
  return spec;
}

// ---------- reading an edit ----------

async function wordsOf(spec: EditSpec) {
  return timelineWords(spec, await specTranscripts(spec, specMedia(spec)));
}

/**
 * Cuts that land in the voice: loud there and in no pause the voice band shows (Whisper's word times are too loose to
 * tell: they gave a clean cut a warning and trained nobody to read them). Where one clip runs on into the next
 * (a reframe), nothing is cut.
 */
async function cutWords(spec: EditSpec) {
  const rows = new Map(specMedia(spec).map((m) => [m.id, m]));
  const out = new Map<string, string>();
  const runsOn = (a: EditSpec['clips'][number] | undefined, b: EditSpec['clips'][number] | undefined) => !!a && !!b && a.mediaId === b.mediaId && Math.abs(a.out - b.in) < 0.02;
  for (const [i, c] of spec.clips.entries()) {
    const m = rows.get(c.mediaId);
    const s = m && c.volume > 0 ? await takeSound(m) : null;
    if (!s) continue;
    const word = (t: number) => {
      const w = s.words.find((x) => x.start - 0.05 < t && t < x.end + 0.05);
      return w ? ` (“${w.word.trim()}” ${f2(w.start)}–${f2(w.end)})` : '';
    };
    const a = !runsOn(spec.clips[i - 1], c) && cutsSound(s, c.in);
    const b = !runsOn(c, spec.clips[i + 1]) && cutsSound(s, c.out);
    if (a || b) out.set(c.id, [a && `in lands in sound${word(c.in)}`, b && `out lands in sound${word(c.out)}`].filter(Boolean).join(', '));
  }
  return out;
}

/** One line per clip: where it sits, what it cuts from the source, its look, the silence at its ends and its words. */
function clipLines(spec: EditSpec, words: TimelineWord[], names: Map<string, string>, clipped = new Map<string, string>()) {
  const starts = clipStarts(spec);
  return spec.clips.map((c, i) => {
    const ws = words.filter((w) => w.clipId === c.id);
    const end = starts[i] + c.out - c.in;
    const look = [c.zoom !== 1 && `z${c.zoom}`, c.focusX !== 0.5 || c.focusY !== 0.5 ? `f${c.focusX},${c.focusY}` : '', c.fit === 'whole' && 'whole', c.motion !== 'none' && c.motion, c.transition && `in:${c.transition.type}`, c.filter, c.volume !== 1 && `vol${c.volume}`]
      .filter(Boolean)
      .join(' ');
    const gaps = ws.length ? ` | lead ${f2(ws[0].start - starts[i])} tail ${f2(end - ws[ws.length - 1].end)}` : '';
    return `${c.id.padEnd(6)} ${f2(starts[i]).padStart(6)}–${f2(end).padStart(6)}  [${names.get(c.mediaId) ?? short(c.mediaId)} ${f2(c.in)}–${f2(c.out)}]${look ? ` ${look}` : ''}${gaps} | ${ws.map((w) => w.text).join(' ') || '(no words)'}${clipped.has(c.id) ? `  ⚠ ${clipped.get(c.id)}` : ''}`;
  });
}

function overlayLine(o: EditOverlay) {
  const when = `${f2(o.start)}–${f2(o.end)}`;
  const hides = 'hidesCaptions' in o && o.hidesCaptions ? ' (captions wait)' : '';
  switch (o.type) {
    case 'text':
      return `${o.id} text ${o.style} ${when} ${o.position} “${o.text}”${hides}`;
    case 'graphic':
      return `${o.id} graphic ${o.template} ${when} “${[o.text, o.sub, ...o.items].filter(Boolean).join(' / ')}”${hides}`;
    case 'image':
      return `${o.id} image ${when} ${short(o.mediaId)} at ${o.x},${o.y} w${o.width}`;
    case 'broll':
      return `${o.id} broll ${when} ${short(o.mediaId)} from ${o.in} ${o.layout}`;
    case 'scene': {
      if (o.preset) return `${o.id} scene ${o.preset} ${when} “${[o.fill?.text, o.fill?.sub, ...(o.fill?.items ?? [])].filter(Boolean).join(' / ')}”${hides}`;
      const said = o.elements.filter((e) => e.kind === 'text' && e.text?.trim()).map((e) => e.text!.replace(/\s+/g, ' ').slice(0, 30));
      return `${o.id} scene “${o.name}” ${when} ${o.elements.length} el ${o.tweens.length} tw${hides}: ${said.join(' · ') || '(no words)'}`;
    }
  }
}

async function show(piece: Piece) {
  const ws = db.select({ name: schema.workspaces.name }).from(schema.workspaces).where(eq(schema.workspaces.id, piece.workspaceId)).get();
  const files = cardFiles(piece.id);
  const edit = findEditForPiece(piece.id);
  const out = [`“${piece.title}” ${piece.id} · ${piece.stage} · ${ws?.name ?? ''}`];
  const fileLine = (m: MediaRow, used: boolean) =>
    `  ${short(m.id)} ${m.kind} ${m.originalName} ${m.durationMs ? `${f2(m.durationMs / 1000)} s` : ''} ${m.width ? `${m.width}x${m.height}` : ''} ${m.source}${m.kind === 'video' && m.transcriptStatus !== 'done' ? ` transcript ${m.transcriptStatus}` : ''}${used ? ' · in the edit' : ''}`;
  if (!edit) {
    out.push('No edit yet.', 'Files on the card:', ...files.map((m) => fileLine(m, false)));
    return out.join('\n');
  }
  const spec = normalizeEdit(edit.working);
  const rows = specMedia(spec);
  const names = new Map([...files, ...rows].map((m) => [m.id, short(m.id)] as const));
  const words = timelineWords(spec, await specTranscripts(spec, rows));
  const versions = listEditVersions(edit.id);
  const head = versions[0];
  const headSpec = head && db.select({ spec: schema.editVersions.spec }).from(schema.editVersions).where(eq(schema.editVersions.id, head.id)).get()?.spec;
  const unsaved = headSpec && JSON.stringify(normalizeEdit(headSpec)) !== JSON.stringify(spec);
  out.push(`versions: ${versions.slice(0, 4).map((v) => `v${v.number} ${v.author}: ${v.message}`).join(' · ')}${unsaved ? ' · the working copy has unsaved changes' : ''}`);
  for (const [i, r] of listRenders(edit.id, 3).entries()) {
    const file = r.mediaId ? db.select().from(schema.media).where(eq(schema.media.id, r.mediaId)).get() : undefined;
    out.push(`render v${r.versionNumber} ${r.status}${r.status === 'running' || r.status === 'queued' ? ` ${Math.round(r.progress * 100)}% ${r.stage}` : ''}${r.error ? `: ${r.error.slice(0, 160)}` : ''}${file && i === 0 ? ` → ${mediaPath(file)}` : ''}`);
  }
  const q = latestQuality(edit.id);
  if (q) out.push(`check v${q.versionNumber}: ${q.score}/100${q.lessons?.length ? `, breaks ${q.lessons.length} lesson(s)` : ''}. ${q.summary}`);
  const s = spec.story;
  out.push(`story: promise “${s.promise || '—'}” · payoff “${s.payoff || '—'}” at ${s.payoffAt ?? '—'}`);
  const c = spec.captions;
  const sfx = spec.audio.sfx.map((x) => `${x.mediaId.replace('builtin:', '')}@${x.at}`).join(' ');
  out.push(
    `${spec.format} · ${f2(editDuration(spec))} s · captions ${c.enabled ? `${c.preset} ×${c.maxWords} at ${c.position}${c.font ? ` ${c.font}` : ''}` : 'off'} · autoSfx ${spec.audio.autoSfx ? 'on' : 'off'}${sfx ? ` · sfx ${sfx}` : ''}${spec.audio.nasheed ? ' · nasheed (the creator’s)' : ''} · grade ${spec.grade.filter}${spec.grade.lutMediaId ? ' + LUT' : ''}${spec.grade.light ? ' · light fix on' : ''}${spec.watermark.mediaId ? ' · watermark' : ''}`,
  );
  out.push('clips (timeline · [file in–out] look | silence before the first and after the last word | words):', ...clipLines(spec, words, names, await cutWords(spec)));
  if (spec.overlays.length) out.push('overlays:', ...spec.overlays.map((o) => `  ${overlayLine(o)}`));
  const used = new Set(spec.clips.map((x) => x.mediaId));
  out.push('files on the card:', ...files.map((m) => fileLine(m, used.has(m.id))));
  const open = listNotes(piece.id).filter((n) => n.status === 'open');
  if (open.length) out.push(`${open.length} open comment(s): npm run notes -- ${short(piece.id)}`);
  return out.join('\n');
}

/** Each take's words as phrases between the voice's pauses: where a cut can land. */
async function takes(piece: Piece, only: string[]) {
  const files = cardFiles(piece.id).filter((m) => m.kind !== 'image' && (!only.length || only.some((q) => m.id.startsWith(q) || m.originalName.includes(q))));
  if (!files.length) return 'No footage or recordings matched.';
  const out: string[] = [];
  for (const m of files) {
    const t = await readTranscript(m.id);
    if (!t) {
      out.push(`== ${short(m.id)} ${m.originalName}: no transcript (${m.transcriptStatus})`);
      continue;
    }
    const env = await voiceEnvelope(mediaPath(m));
    const refined: Transcript = refineWords(t, env);
    const ws = refined.segments.flatMap((s) => s.words ?? []);
    // Quiet by the voice's level (softly: a noisy room never gets fully quiet), and by the voice band's room floor.
    const found = [...pauses(env, 0, env.seconds, undefined, true), ...(await bandPauses(mediaPath(m)))].sort((a, b) => a[0] - b[0]);
    // Overlapping pauses from the two finders as one.
    const gaps: [number, number][] = [];
    for (const g of found) {
      const last = gaps[gaps.length - 1];
      if (last && g[0] <= last[1]) last[1] = Math.max(last[1], g[1]);
      else gaps.push([g[0], g[1]]);
    }
    out.push(`== ${short(m.id)} ${m.originalName} ${f2(env.seconds)} s`);
    if (flags.has('--words')) {
      out.push(ws.map((w) => `${w.word.trim()}[${f2(w.start)}-${f2(w.end)}]`).join(' '));
      out.push(`pauses: ${gaps.map(([a, b]) => `${f2(a)}-${f2(b)}`).join(' ')}`);
      continue;
    }
    // A new line at a pause of 0.25 s or more between two words (~: a gap in Whisper's times with no quiet found
    // there); a shorter one (0.15 s+), also a clean cut point, is a · in the line (--words has its times).
    // Voice where Whisper wrote no words (a rep it skipped, a false start): over 0.5 s of sound in a gap of a second.
    const unheard = (a: number, b: number) => {
      if (b - a < 1) return;
      const quiet = gaps.reduce((n, [x, y]) => n + Math.max(0, Math.min(b, y) - Math.max(a, x)), 0);
      if (b - a - quiet > 0.5) out.push(`?? ${f2(a)}–${f2(b)} sound with no words in the transcript (a rep Whisper skipped?)`);
    };
    if (!ws.length) {
      out.push('(no words in the transcript)');
      unheard(0, env.seconds);
    }
    let line: string[] = [];
    let from = 0;
    let end = 0;
    const flush = (pause?: string) => {
      if (line.length) out.push(`${f2(from)}–${f2(end)} ${line.join(' ')}${pause ? `  ‖ ${pause}` : ''}`);
      line = [];
    };
    for (const [i, w] of ws.entries()) {
      if (i === 0) unheard(0, w.start);
      if (!line.length) from = w.start;
      // A word Whisper stretched over more than a second has sound in it that isn't the word.
      line.push(w.end - w.start > 1.2 ? `${w.word.trim()}(${f2(w.end - w.start)} s?)` : w.word.trim());
      end = w.end;
      const next = ws[i + 1];
      if (!next) {
        flush();
        unheard(w.end, env.seconds);
        continue;
      }
      // A pause between the two words: it reaches the gap between them and its middle lies between theirs.
      const mid = (x: { start: number; end: number }) => (x.start + x.end) / 2;
      const gap = gaps.find(([a, b]) => b - a >= 0.15 && a < next.start + 0.15 && b > w.end - 0.15 && (a + b) / 2 > mid(w) && (a + b) / 2 < mid(next));
      if (next.start - w.end >= 1) {
        flush(gap ? `${f2(gap[0])}-${f2(gap[1])}` : undefined);
        unheard(w.end, next.start);
      } else if (gap && gap[1] - gap[0] >= 0.25) flush(`${f2(gap[0])}-${f2(gap[1])}`);
      else if (!gap && next.start - w.end >= 0.3) flush(`~${f2(w.end)}-${f2(next.start)}`);
      else if (gap) line.push('·');
    }
  }
  return out.join('\n');
}

/** Type declarations from the shared files, by name, comments and all. */
function typesText(names: string[]) {
  const files = ['shared/edit.ts', 'shared/scene.ts', 'shared/looks.ts'].map((f) => readFileSync(resolve(import.meta.dirname, '../..', f), 'utf8'));
  const take = (name: string) => {
    for (const src of files) {
      const lines = src.split('\n');
      const at = lines.findIndex((l) => new RegExp(`^(export )?(type|const) ${name}\\b`).test(l));
      if (at < 0) continue;
      let start = at;
      while (start > 0 && /^\s*(\/\*\*|\*|\/\/)/.test(lines[start - 1])) start--;
      let depth = 0;
      for (let i = at; i < lines.length; i++) {
        for (const ch of lines[i]) depth += ch === '{' || ch === '[' || ch === '(' ? 1 : ch === '}' || ch === ']' || ch === ')' ? -1 : 0;
        if (depth <= 0 && /[;}\]]\s*$/.test(lines[i])) return lines.slice(start, i + 1).join('\n');
      }
    }
    return `// ${name}: not found`;
  };
  if (names[0] === 'lists') {
    return [
      `transitions: ${TRANSITIONS.join(' ')}`,
      `motions: ${CLIP_MOTIONS.join(' ')}`,
      `filters: ${FILTER_LOOKS.join(' ')}`,
      `caption presets: ${CAPTION_PRESETS.join(' ')}`,
      `fonts: ${FONT_FAMILIES.join(', ')} (scenes: ${SCENE_FONTS.join(', ')})`,
      `overlay animations: ${OVERLAY_ANIMATIONS.join(' ')}`,
      `broll layouts: ${BROLL_LAYOUTS.join(' ')}`,
      `graphics: ${GRAPHICS.join(' ')}`,
      `scene sounds: ${SCENE_SOUNDS.join(' ')}`,
      `library scenes: ${SCENE_PRESETS.join(' ')}`,
      `built-in sfx (builtin:<name>): ${BUILTIN_SFX.map((s) => s.name).join(' ')}`,
    ].join('\n');
  }
  if (names[0] === 'graphics') return GRAPHICS.map((g) => `${g}: ${GRAPHIC_INFO[g].hint}. ${Object.entries(GRAPHIC_INFO[g].fields).map(([k, v]) => `${k}=${v}`).join('; ')}`).join('\n');
  if (names[0] === 'library') return SCENE_PRESETS.map((p) => `${p}: ${SCENE_LIBRARY[p].hint}. ${Object.entries(SCENE_LIBRARY[p].fields).map(([k, v]) => `${k}=${v}`).join('; ')}`).join('\n');
  const list = names.length
    ? names
    : ['EditSpec', 'EditClip', 'ClipTransition', 'CaptionSettings', 'OverlayBase', 'TextOverlay', 'ImageOverlay', 'BrollOverlay', 'GraphicOverlay', 'SceneOverlay', 'SceneSpec', 'SceneElement', 'SceneTween', 'STYLE_PROPS', 'EditAudio', 'SfxCue', 'EditGrade', 'Textures', 'Watermark', 'EditStory'];
  return `${list.map(take).join('\n\n')}\n\n(option lists: \`types lists\`; templates: \`types graphics\`; library scenes: \`types library\`)`;
}

// ---------- changing an edit ----------

const DELETE = Symbol('delete');
const value = (raw: string): unknown => {
  if (raw === '-') return DELETE;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
};

/** An array item by id or index, or an object's field. */
function child(obj: unknown, key: string): { at: number | string; parent: Record<string | number, unknown> } {
  if (Array.isArray(obj)) {
    const i = /^\d+$/.test(key) ? Number(key) : obj.findIndex((x) => x && typeof x === 'object' && (x as { id?: string }).id === key);
    if (i < 0 || i >= obj.length) throw new Error(`No item “${key}” (ids: ${obj.map((x) => (x as { id?: string }).id).join(' ')})`);
    return { at: i, parent: obj as unknown as Record<number, unknown> };
  }
  if (!obj || typeof obj !== 'object') throw new Error(`“${key}” is inside something that isn't an object`);
  return { at: key, parent: obj as Record<string, unknown> };
}

function applySet(spec: EditSpec, expr: string) {
  const eqAt = expr.indexOf('=');
  if (eqAt < 1) throw new Error(`“${expr}”: write <path>=<value>`);
  let path = expr.slice(0, eqAt);
  const v = value(expr.slice(eqAt + 1));
  const insert = path.endsWith('+');
  if (insert) path = path.slice(0, -1);
  const keys = path.split('.');
  let obj: unknown = spec;
  for (const k of keys.slice(0, -1)) {
    const { at, parent } = child(obj, k);
    obj = parent[at];
  }
  const { at, parent } = child(obj, keys[keys.length - 1]);
  if (insert) {
    // clips+=… appends to the list; clips.<id>+=… goes after that item.
    const target = parent[at];
    if (Array.isArray(target)) target.push(v);
    else if (Array.isArray(parent)) (parent as unknown[]).splice((at as number) + 1, 0, v);
    else throw new Error(`“${path}+=”: not a list or an item in one`);
  } else if (v === DELETE) {
    if (Array.isArray(parent)) parent.splice(at as number, 1);
    else delete parent[at];
  } else parent[at] = v;
}

/** The workspace's files by id or the start of one. */
function mediaLookup(workspaceId: string) {
  const rows = db.select().from(schema.media).where(eq(schema.media.workspaceId, workspaceId)).all();
  return (id: string): MediaRow => {
    const hits = rows.filter((r) => r.id === id || (id.length >= 6 && r.id.startsWith(id)));
    if (hits.length !== 1) throw new Error(`File id “${id}” matches ${hits.length} files.`);
    return hits[0];
  };
}

/** The series' earlier episodes that have an edit: what each carries forward (the tracker's totals, the captions, how it opened). */
function seriesSoFar(piece: Piece): SeriesSoFar {
  if (!piece.seriesId) return [];
  return db
    .select()
    .from(schema.pieces)
    .where(eq(schema.pieces.seriesId, piece.seriesId))
    .all()
    .filter((p) => p.id !== piece.id && (p.episode ?? 0) < (piece.episode ?? Infinity))
    .sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0))
    .flatMap((p) => {
      const e = findEditForPiece(p.id);
      if (!e) return [];
      const s = normalizeEdit(e.working);
      const t = s.overlays.find((o) => o.id === 'kit-tracker');
      return [{ episode: p.episode ?? 0, title: p.title, tracker: t?.type === 'scene' && t.fill ? { text: t.fill.text, sub: t.fill.sub } : null, captions: s.captions, open: openOf(s) }];
    });
}

type Kit = { media: (id: string) => MediaRow; series: SeriesSoFar; notes: string[] };

/** What a design file gets besides the spec: timeline times of the cut, the words, library scenes and the episode kit. */
function designContext(spec: EditSpec, words: TimelineWord[], kit: Kit) {
  const starts = clipStarts(spec);
  const byId = new Map(spec.clips.map((c, i) => [c.id, { c, start: starts[i] }]));
  const get = (id: string) => {
    const x = byId.get(id);
    if (!x) throw new Error(`No clip “${id}”`);
    return x;
  };
  const { width: W, height: H } = EDIT_FORMATS[spec.format];
  return {
    W,
    H,
    r2,
    words,
    /** The timeline second of second `source` of clip `id`'s file. */
    at: (id: string, source: number) => r2(get(id).start + source - get(id).c.in),
    start: (id: string) => r2(get(id).start),
    end: (id: string) => r2(get(id).start + get(id).c.out - get(id).c.in),
    /** Where the timeline is now (call again after changing spec.clips). */
    retime: () => designContext(spec, words, kit),
    /**
     * Clips for the lines to keep, [name, from, to] as `takes` prints them: each cut moved into the pause beside its
     * words, framing by turns (wide, close on the face), a long line reframed once inside it. `spec.clips = await ctx.cut(…)`.
     */
    cut: async (file: string, rows: LineRow[], opts?: CutOptions) => {
      const made = await cutLines(kit.media, spec.format, file, rows, opts);
      kit.notes.push(...made.notes);
      return made.clips;
    },
    /** The series' dress on the clips now in `spec`: tracker, captions, opening, proof shots (studio/episode.ts). */
    episode: async (opts: EpisodeOptions) => void kit.notes.push(...(await dressEpisode(spec, opts, kit.media, kit.series))),
    /** A scene from the library, filled with these words (put it in overlays with an id, start and end). */
    library: (preset: ScenePreset, fill: Partial<SceneFill>, seconds?: number) => ({ type: 'scene' as const, ...libraryScene(preset, fill, { W, H, color: spec.captions.highlight }, seconds) }),
  };
}
export type DesignContext = ReturnType<typeof designContext>;

/** Save `spec` as a version by Claude (or, with --dry, only say what it would be), then the clips as they now are. */
async function save(piece: Piece, input: EditSpec, message: string) {
  const spec = fullIds(normalizeEdit(input), piece.workspaceId);
  // What normalizing threw away (an overlay with no type, a clip with no file) is said, never lost quietly.
  const dropped = (['clips', 'overlays'] as const).flatMap((k) => {
    const before = Array.isArray(input[k]) ? input[k].length : 0;
    return before > spec[k].length ? [`${before - spec[k].length} of ${before} ${k} were invalid and left out (ids kept: ${spec[k].map((x) => x.id).join(' ') || 'none'})`] : [];
  });
  const words = await wordsOf(spec);
  const files = new Map(cardFiles(piece.id).map((m) => [m.id, short(m.id)]));
  const lines = [...clipLines(spec, words, files, await cutWords(spec)), ...spec.overlays.map((o) => `  ${overlayLine(o)}`)];
  const total = `${f2(editDuration(spec))} s, ${spec.clips.length} clips, ${spec.overlays.length} overlays`;
  if (dropped.length) lines.unshift(`⚠ ${dropped.join('; ')}`);
  if (flags.has('--dry')) {
    // Look before saving: every version saved is one more for me to watch.
    const look = opt('preview');
    const sheet = look ? `\n${await preview(piece, look, [], { spec, workspaceId: piece.workspaceId })}` : '';
    return `dry run (nothing saved): ${total}\n${lines.join('\n')}${sheet}`;
  }
  let edit = findEditForPiece(piece.id);
  if (!edit) {
    const { createEdit } = await import('../src/studio/edits');
    edit = createEdit(piece.id, 'claude');
  }
  const { version, unchanged } = saveEditVersion(edit.id, { author: 'claude', message, spec });
  return `${unchanged ? `unchanged (still v${version.number})` : `saved v${version.number}`}: ${total}\n${lines.join('\n')}`;
}

// ---------- looking ----------

/** Pictures side by side, each `px` wide, up to six to a sheet. Returns the sheets' paths. */
async function sheets(files: string[], out: string, px: number) {
  const made: string[] = [];
  for (let s = 0, k = 0; s < files.length; s += 6, k++) {
    const chunk = files.slice(s, s + 6);
    const dest = `${out}${files.length > 6 ? `-${k + 1}` : ''}.jpg`;
    const scale = chunk.map((_, i) => `[${i}:v]scale=${px}:-2[s${i}]`).join(';');
    const stack = chunk.length > 1 ? `${scale};${chunk.map((_, i) => `[s${i}]`).join('')}hstack=${chunk.length}` : `[0:v]scale=${px}:-2`;
    await execFile(requireBinary('ffmpeg'), ['-y', '-v', 'error', ...chunk.flatMap((f) => ['-i', f]), '-filter_complex', stack, '-q:v', '4', dest]);
    made.push(dest);
  }
  return made;
}

/** The newest finished render of the card (or of edit version `n`). */
function renderFile(piece: Piece, n?: number) {
  const edit = editOf(piece);
  const r = listRenders(edit.id, 50).find((x) => x.status === 'done' && x.mediaId && (n === undefined || x.versionNumber === n));
  if (!r) throw new Error(n === undefined ? 'No finished render yet.' : `No finished render of v${n}.`);
  const m = db.select().from(schema.media).where(eq(schema.media.id, r.mediaId!)).get()!;
  return { r, m, file: mediaPath(m) };
}

async function frames(piece: Piece, times: number[]) {
  if (!times.length) throw new Error('Which seconds? e.g. frames <card> 0.5 3 7.2');
  const px = Number(opt('px')) || 300;
  const src = opt('source');
  let file: string;
  let what: string;
  if (src) {
    const m = cardFiles(piece.id).find((x) => x.id.startsWith(src) || x.originalName.includes(src));
    if (!m) throw new Error(`No file “${src}” on the card.`);
    file = mediaPath(m);
    what = `${short(m.id)} ${m.originalName} (seconds of the file)`;
  } else {
    const v = opt('v');
    const x = renderFile(piece, v ? Number(v) : undefined);
    file = x.file;
    what = `the render of v${x.r.versionNumber} (seconds of the video)`;
  }
  const dir = workDir(piece.id);
  const tmp = join(dir, 'tmp');
  mkdirSync(tmp, { recursive: true });
  try {
    const shots = await extractFrames(file, times, (i) => join(tmp, `f${i}.jpg`), Math.max(px, 300));
    const made = await sheets(shots, join(dir, 'frames'), px);
    return `${what}, left to right at ${times.join(', ')} s:\n${made.join('\n')}`;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** What the light fix does to each camera take of the edit, with a frame before and after to look at. */
async function light(piece: Piece) {
  const spec = normalizeEdit(editOf(piece).working);
  const rows = new Map(specMedia(spec).map((m) => [m.id, m]));
  const dir = workDir(piece.id);
  const out = [`light fix ${spec.grade.light ? 'on' : 'off'} (set <card> "<message>" grade.light=${spec.grade.light ? 'false' : 'true'})`];
  const shots: string[] = [];
  for (const id of new Set(spec.clips.map((c) => c.mediaId))) {
    const m = rows.get(id);
    if (!m || m.kind !== 'video') continue;
    const fix = await lightOf(m);
    out.push(`${short(id)} ${m.originalName}: ${fix ? `${lightText(fix.fix)} (its colour was ${fix.fix.was.colour.join(' ')}, middle brightness ${fix.fix.was.middle})` : 'fine as it is'}`);
    if (!fix) continue;
    const c = spec.clips.find((x) => x.mediaId === id)!;
    const [before] = await extractFrames(mediaPath(m), [(c.in + c.out) / 2], () => join(dir, `light-${short(id)}-a.jpg`), 600);
    const after = join(dir, `light-${short(id)}-b.jpg`);
    await gradeImage(before, after, { file: fix.cube, intensity: 1 }, dir);
    shots.push(before, after);
  }
  if (shots.length) {
    const made = await sheets(shots, join(dir, 'light'), Number(opt('px')) || 300);
    shots.forEach((f) => rmSync(f, { force: true }));
    out.push('before, after:', ...made);
  }
  return out.join('\n');
}

async function preview(piece: Piece, overlayId: string, times: number[], given?: { spec: EditSpec; workspaceId: string }) {
  const px = Number(opt('px')) || 300;
  const at0 = times.length ? times : (opt('at') ?? '').split(',').map(Number).filter((n) => Number.isFinite(n) && n >= 0);
  const { images, times: at } = await previewOverlay(given ? null : editOf(piece).id, overlayId, at0.length ? at0 : undefined, given);
  const dir = workDir(piece.id);
  const shots = images.map((img: Buffer, i: number) => {
    const f = join(dir, `pv-${i}.jpg`);
    writeFileSync(f, img);
    return f;
  });
  const made = await sheets(shots, join(dir, `preview-${overlayId}`), px);
  shots.forEach((f) => rmSync(f, { force: true }));
  return `${overlayId}, left to right at ${at.map((t: number) => f2(t)).join(', ')} s into it (${given ? 'the dry run' : 'the working copy'}):\n${made.join('\n')}`;
}

/** What the finished video says, phrase by phrase, with ✂ where its version cuts from one clip to the next. */
async function heard(piece: Piece) {
  const v = opt('v');
  const { r, file } = renderFile(piece, v ? Number(v) : undefined);
  const dir = workDir(piece.id);
  const wav = join(dir, 'heard.wav');
  const json = join(dir, 'heard.json');
  await extractAudio(file, wav);
  await runTool('transcribe', { audio: wav, json }, { model: getSetting('whisperModel') ?? 'small', language: 'en' }, { timeoutMs: 15 * 60_000 });
  const t = JSON.parse(readFileSync(json, 'utf8')) as Transcript;
  rmSync(wav, { force: true });
  rmSync(json, { force: true });
  const spec = r.versionId ? normalizeEdit(db.select({ spec: schema.editVersions.spec }).from(schema.editVersions).where(eq(schema.editVersions.id, r.versionId)).get()?.spec) : null;
  const cuts = spec ? clipStarts(spec).slice(1) : [];
  const ws = t.segments.flatMap((s) => s.words ?? []);
  const out: string[] = [];
  let line: string[] = [];
  let from = 0;
  let cut = 0;
  for (const [i, w] of ws.entries()) {
    if (!line.length) from = w.start;
    while (cut < cuts.length && cuts[cut] <= w.start) {
      line.push(`✂${f2(cuts[cut])}`);
      cut++;
    }
    line.push(w.word.trim());
    const next = ws[i + 1];
    if (!next || next.start - w.end > 0.5 || line.length >= 16) {
      out.push(`${f2(from)}–${f2(w.end)} ${line.join(' ')}`);
      line = [];
    }
  }
  return `What the render of v${r.versionNumber} says (Whisper):\n${out.join('\n')}`;
}

/**
 * Whisper one stretch of a card's file alone and put its words in the file's transcript in place of what was there.
 * Phone takes with several reps lose all but the first to Whisper; heard on their own, they come back. The transcript
 * as it was is kept in the card's work folder.
 */
async function rewhisper(piece: Piece, q: string, from: number, to: number, said?: string) {
  const m = cardFiles(piece.id).find((x) => x.id.startsWith(q) || x.originalName.includes(q));
  if (!m) throw new Error(`No file “${q}” on the card.`);
  if (!(to > from)) throw new Error('Usage: rewhisper <card> <file> <from> <to> (seconds of the file)');
  const t = await readTranscript(m.id);
  if (!t) throw new Error(`${short(m.id)} has no transcript yet.`);
  const dir = workDir(piece.id);
  const wav = join(dir, 'rewhisper.wav');
  const json = join(dir, 'rewhisper.json');
  await execFile(requireBinary('ffmpeg'), ['-y', '-v', 'error', '-ss', String(from), '-to', String(to), '-i', mediaPath(m), '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
  await runTool('transcribe', { audio: wav, json }, { model: getSetting('whisperModel') ?? 'small', language: 'en' }, { timeoutMs: 15 * 60_000 });
  const heardT = JSON.parse(readFileSync(json, 'utf8')) as Transcript;
  rmSync(wav, { force: true });
  rmSync(json, { force: true });
  const fresh = heardT.segments
    .flatMap((s) => s.words ?? [])
    .map((w) => ({ ...w, start: r2(w.start + from), end: r2(Math.min(w.end + from, to)) }))
    .filter((w) => w.start < to)
    // Whisper splits a hyphenated word in two ("re -hit", "allergy -existing"): one word again.
    .reduce<{ word: string; start: number; end: number }[]>((ws, w) => {
      const prev = ws[ws.length - 1];
      if (prev && /^-\S/.test(w.word.trim())) Object.assign(prev, { word: prev.word + w.word.trim(), end: w.end });
      else ws.push({ ...w });
      return ws;
    }, []);
  // Out of the pauses beside them (Whisper gives a line's first word the silence before it).
  const gaps = await bandPauses(mediaPath(m));
  fitToPauses({ segments: [{ start: from, end: to, text: '', words: fresh }] } as unknown as Transcript, gaps).segments[0].words!.forEach((w, i) => Object.assign(fresh[i], { start: w.start, end: w.end }));
  if (!fresh.length) return `Whisper heard no words in ${f2(from)}–${f2(to)}: the transcript is unchanged.`;
  if (said) {
    // Whisper's timings, the words I know were said (a name, a number it heard wrong).
    const words = said.split(/\s+/).filter(Boolean);
    if (words.length !== fresh.length) throw new Error(`Whisper heard ${fresh.length} words, not ${words.length}: ${fresh.map((w) => w.word.trim()).join(' ')} (the transcript is unchanged)`);
    // “~” for a heard word joins it onto the one before: a name Whisper heard as two words (“GoHighLevel ~”).
    const joined: typeof fresh = [];
    fresh.forEach((w, i) => {
      if (words[i] === '~' && joined.length) joined[joined.length - 1].end = w.end;
      else joined.push({ ...w, word: ` ${words[i]}` });
    });
    fresh.splice(0, fresh.length, ...joined);
  }
  const backup = join(dir, `transcript-${short(m.id)}-${Date.now()}.json`);
  writeFileSync(backup, JSON.stringify(t));
  const inside = (w: { start: number; end: number }) => (w.start + w.end) / 2 >= from && (w.start + w.end) / 2 < to;
  const before = t.segments.flatMap((s) => (s.words ?? []).filter(inside).map((w) => w.word.trim()));
  for (const s of t.segments) s.words = s.words?.filter((w) => !inside(w));
  // The new words as their own segment, in time order with the rest.
  t.segments.push({ start: fresh[0].start, end: fresh[fresh.length - 1].end, text: fresh.map((w) => w.word).join('').trim(), words: fresh } as (typeof t.segments)[number]);
  for (const s of t.segments) if (s.words) s.text = s.words.map((w) => w.word).join('').trim();
  t.segments = t.segments.filter((s) => s.text.trim() || !s.words).sort((a, b) => a.start - b.start);
  t.text = t.segments.map((s) => s.text.trim()).join(' ');
  writeFileSync(transcriptPath(m.id), JSON.stringify(t));
  db.update(schema.media).set({ transcriptText: t.text }).where(eq(schema.media.id, m.id)).run();
  const line = (ws: { word: string; start: number; end: number }[]) => ws.map((w) => `${w.word.trim()}[${f2(w.start)}]`).join(' ');
  return `${short(m.id)} ${f2(from)}–${f2(to)}\n  was: ${before.join(' ') || '(nothing)'}\n  now: ${line(fresh)}\n(the old transcript: ${backup})`;
}

/** A transcript made before words were fitted to a phone take's pauses: every word moved out of the silence. */
async function fit(piece: Piece, q: string) {
  const m = cardFiles(piece.id).find((x) => x.id.startsWith(q) || x.originalName.includes(q));
  if (!m) throw new Error(`No file “${q}” on the card.`);
  const t = await readTranscript(m.id);
  if (!t) throw new Error(`${short(m.id)} has no transcript yet.`);
  const fitted = fitToPauses(t, await bandPauses(mediaPath(m)));
  const was = t.segments.flatMap((s) => s.words ?? []);
  const now = fitted.segments.flatMap((s) => s.words ?? []);
  const moved = now.filter((w, i) => w.start !== was[i].start || w.end !== was[i].end);
  if (!moved.length) return `${short(m.id)}: every word already sits outside the pauses.`;
  writeFileSync(join(workDir(piece.id), `transcript-${short(m.id)}-${Date.now()}.json`), JSON.stringify(t));
  writeFileSync(transcriptPath(m.id), JSON.stringify(fitted));
  return `${short(m.id)}: ${moved.length} of ${now.length} words moved out of the pauses (${moved.slice(0, 8).map((w) => `${w.word.trim()}@${f2(w.start)}`).join(' ')}${moved.length > 8 ? ' …' : ''})`;
}

async function waitFor(piece: Piece) {
  const edit = editOf(piece);
  const started = Date.now();
  let last = '';
  // Under ten minutes, so one shell call holds it; run `wait` again after.
  while (Date.now() - started < 9 * 60_000) {
    const r = listRenders(edit.id, 1)[0];
    if (!r) return 'No render.';
    const now = `${r.status} ${r.stage}`;
    if (now !== last) {
      console.log(`v${r.versionNumber} ${r.status}: ${r.stage} ${Math.round(r.progress * 100)}%`);
      last = now;
    }
    if (r.status === 'done') {
      const m = r.mediaId ? db.select().from(schema.media).where(eq(schema.media.id, r.mediaId)).get() : undefined;
      return `done in ${Math.round((r.elapsedMs ?? 0) / 1000)} s${m ? ` → ${mediaPath(m)}` : ''}`;
    }
    if (r.status === 'error' || r.status === 'cancelled') return `${r.status}: ${r.error ?? ''}`;
    if (r.status === 'queued' && Date.now() - started > 90_000 && r.stage === 'Waiting') console.log('Still waiting after 90 s: is the app running?');
    await new Promise((res) => setTimeout(res, 5000));
  }
  return 'Still rendering: `npm run edit -- wait <card>` again.';
}

// ---------- the commands ----------

function recent(words?: string) {
  const rows = db.select().from(schema.pieces).orderBy(desc(schema.pieces.updatedAt)).all();
  const withEdit = new Set(db.select({ p: schema.edits.pieceId }).from(schema.edits).all().map((x) => x.p));
  const withFiles = new Set(db.select({ p: schema.media.pieceId }).from(schema.media).where(ne(schema.media.source, 'render')).all().map((x) => x.p));
  const norm = (s: string) => s.toLowerCase();
  const list = rows.filter((p) => (words ? words.split(/\s+/).every((w) => norm(p.title).includes(norm(w))) : withEdit.has(p.id) || withFiles.has(p.id))).slice(0, 15);
  return list.map((p) => `${short(p.id)} ${p.stage.padEnd(10)} ${withEdit.has(p.id) ? 'edit' : withFiles.has(p.id) ? 'footage' : '-'.padEnd(4)}  ${p.title}`).join('\n') || 'No cards.';
}

const [cmd, ...rest] = args;
// Errors as one line, never a stack trace.
process.on('uncaughtException', (e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
const out = await (async () => {
  switch (cmd) {
    case undefined:
      return recent();
    case 'help':
      return readFileSync(import.meta.filename, 'utf8').split('\nimport ')[0].replace(/^\/\/ ?/gm, '');
    case 'list':
      return recent(rest.join(' '));
    case 'takes':
      return takes(findPiece(rest[0]), rest.slice(1));
    case 'types':
      return typesText(rest);
    case 'fit':
      return fit(findPiece(rest[0]), rest[1] ?? '');
    case 'rewhisper':
      return rewhisper(findPiece(rest[0]), rest[1] ?? '', Number(rest[2]), Number(rest[3]), rest[4]);
    case 'arsenal': {
      const p = findPiece(rest[0]);
      return arsenalText(p.workspaceId, { excludePieceId: p.id });
    }
    case 'set': {
      const p = findPiece(rest[0]);
      const [message, ...exprs] = rest.slice(1);
      if (!message || !exprs.length) throw new Error('Usage: set <card> "<message>" <path>=<json> …');
      const spec = normalizeEdit(editOf(p).working);
      for (const e of exprs) applySet(spec, e);
      return save(p, spec, message);
    }
    case 'get': {
      const p = findPiece(rest[0]);
      const file = join(workDir(p.id), 'spec.json');
      writeFileSync(file, JSON.stringify(normalizeEdit(editOf(p).working), null, 1));
      return `${file} (${Math.round(readFileSync(file).length / 1024)} KB)`;
    }
    case 'put': {
      const p = findPiece(rest[0]);
      const [file, message] = rest.slice(1);
      if (!file || !existsSync(file)) throw new Error('Usage: put <card> <spec.json | design.mts> "<message>"');
      const current = findEditForPiece(p.id);
      let spec = normalizeEdit(current?.working ?? {});
      if (/\.(json)$/.test(file)) spec = JSON.parse(readFileSync(file, 'utf8'));
      else {
        const mod = await import(resolve(file));
        const kit: Kit = { media: mediaLookup(p.workspaceId), series: seriesSoFar(p), notes: [] };
        const made = await mod.default(spec, designContext(spec, await wordsOf(spec), kit));
        if (made) spec = made;
        if (kit.notes.length) console.log(kit.notes.map((n) => `· ${n}`).join('\n'));
      }
      return save(p, spec, message || 'Claude edit');
    }
    case 'add': {
      const p = findPiece(rest[0]);
      const file = rest[1];
      if (!file || !existsSync(file)) throw new Error('Usage: add <card> <file> ["<name>"]');
      const MIME: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.mp3': 'audio/mpeg' };
      const ext = extname(file).toLowerCase();
      if (!MIME[ext]) throw new Error(`${ext || 'A file with no extension'}: only ${Object.keys(MIME).join(' ')}`);
      const name = rest[2] ? `${rest[2]}${ext}` : basename(file);
      const m = await saveUpload(p.workspaceId, { stream: createReadStream(file), filename: name, mimetype: MIME[ext] }, { pieceId: p.id, source: 'upload' });
      return `${short(m.id)} ${m.kind} ${m.originalName} on “${p.title}”`;
    }
    case 'carousel': {
      const p = findPiece(rest[0]);
      const [message, ...paths] = rest.slice(1);
      if (!message) {
        const list = listCarousel(p.id);
        return list.length ? list.map((v) => `v${v.number} ${v.author.padEnd(6)} ${v.slides.length} slides  ${v.message}\n   ${v.slides.map((x) => short(x.mediaId)).join(' ')}`).join('\n') : `“${p.title}” has no carousel.`;
      }
      const media = opt('media')?.split(',').map((x) => x.trim()).filter(Boolean);
      const files = paths.flatMap((f) => {
        if (!existsSync(f)) throw new Error(`${f}: no such file or folder`);
        if (!statSync(f).isDirectory()) return [f];
        return readdirSync(f).filter((x) => /\.(png|jpe?g|webp)$/i.test(x)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((x) => join(f, x));
      });
      const ids = media?.map((m) => {
        const row = db.select({ id: schema.media.id }).from(schema.media).where(eq(schema.media.pieceId, p.id)).all().find((r) => r.id.startsWith(m));
        if (!row) throw new Error(`${m}: not a file on “${p.title}”`);
        return row.id;
      });
      if (!files.length && !ids?.length) throw new Error('Usage: carousel <card> "<message>" <png…|folder>   (or --media <id,id…>)');
      const v = await saveCarousel(p.id, { files, mediaIds: ids }, message, 'claude');
      return `v${v.number} of “${p.title}”: ${v.mediaIds.length} slides (${getPiece(p.id).stage})`;
    }
    case 'light':
      return light(findPiece(rest[0]));
    case 'frames':
      return frames(findPiece(rest[0]), rest.slice(1).map(Number).filter(Number.isFinite));
    case 'preview': {
      if (!rest[1]) throw new Error('Usage: preview <card> <overlayId> [seconds into it…]');
      return preview(findPiece(rest[0]), rest[1], rest.slice(2).map(Number).filter(Number.isFinite));
    }
    case 'check': {
      const report = await checkEdit(editOf(findPiece(rest[0])).id, 'claude');
      return qualityText(report);
    }
    case 'render': {
      const p = findPiece(rest[0]);
      const r = queueRender(editOf(p).id, 'claude', { check: flags.has('--check') });
      console.log(`queued the render of v${r.versionNumber}${flags.has('--check') ? ', after the check' : ''}`);
      return flags.has('--wait') ? waitFor(p) : '';
    }
    case 'wait':
      return waitFor(findPiece(rest[0]));
    case 'heard':
      return heard(findPiece(rest[0]));
    default:
      return show(findPiece([cmd, ...rest].join(' ')));
  }
})();
if (out) console.log(out);
process.exit(0);
