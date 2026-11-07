// A video's edit, from Claude Code: read it, change it, look at it, check it and render it, without writing a script
// for each step or reading the studio's source. Everything goes through the server's own modules (the same saves,
// checks and render queue the app uses); the running app's job queue does the renders.
//   npm run edit                                   recent cards with footage or an edit (help: this text)
//   npm run edit -- list [words]                   cards whose title has these words
//   npm run edit -- <card>                         the edit: versions, renders, check, story, clips with their words,
//                                                  overlays, sound, the footage on the card, open comments
//   npm run edit -- takes <card> [file…] [--words] each take's words as phrases between pauses (cut points), with times
//   npm run edit -- types [name…|lists|graphics|library]   the edit's types and option lists (instead of shared/edit.ts)
//   npm run edit -- arsenal <card>                 every move, and how often this page's recent edits used it
//   npm run edit -- set <card> "<message>" <path>=<json> …   change fields and save a version (see `set` below)
//   npm run edit -- get <card>                     the working copy into <work>/spec.json (prints the path only)
//   npm run edit -- put <card> <file> "<message>"  save a whole spec (.json) or a design (.mts: default export
//                                                  (spec, ctx) => spec) as a version authored by Claude
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
import { execFile as execFileCb } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
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
import { extractAudio, extractFrames } from '../src/lib/ffmpeg';
import { getSetting } from '../src/lib/settings';
import { mediaPath, readTranscript, type MediaRow } from '../src/services/media';
import { arsenalText } from '../src/studio/arsenal';
import { pauses, refineWords, voiceEnvelope } from '../src/studio/clean-cuts';
import { findEditForPiece, latestQuality, listEditVersions, listRenders, saveEditVersion, specMedia, specTranscripts } from '../src/studio/edits';
import { listNotes } from '../src/studio/notes';
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
const VALUED = new Set(['--source', '--v', '--px']);
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

/** Words of the source a clip's in or out point falls inside (by Whisper's times): a cut that clips a word. */
async function cutWords(spec: EditSpec) {
  const transcripts = await specTranscripts(spec, specMedia(spec));
  const out = new Map<string, string>();
  for (const c of spec.clips) {
    const ws = transcripts[c.mediaId]?.segments.flatMap((x) => x.words ?? []) ?? [];
    const inside = (t: number) => ws.find((w) => w.start + 0.03 < t && t < w.end - 0.03);
    const a = inside(c.in);
    const b = inside(c.out);
    if (a || b) out.set(c.id, [a && `in cuts “${a.word.trim()}” ${f2(a.start)}–${f2(a.end)}`, b && `out cuts “${b.word.trim()}” ${f2(b.start)}–${f2(b.end)}`].filter(Boolean).join(', '));
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
    `${spec.format} · ${f2(editDuration(spec))} s · captions ${c.enabled ? `${c.preset} ×${c.maxWords} at ${c.position}${c.font ? ` ${c.font}` : ''}` : 'off'} · autoSfx ${spec.audio.autoSfx ? 'on' : 'off'}${sfx ? ` · sfx ${sfx}` : ''}${spec.audio.nasheed ? ' · nasheed (the creator’s)' : ''} · grade ${spec.grade.filter}${spec.grade.lutMediaId ? ' + LUT' : ''}${spec.watermark.mediaId ? ' · watermark' : ''}`,
  );
  out.push('clips (timeline · [file in–out] look | silence before the first and after the last word | words):', ...clipLines(spec, words, names, await cutWords(spec)));
  if (spec.overlays.length) out.push('overlays:', ...spec.overlays.map((o) => `  ${overlayLine(o)}`));
  const used = new Set(spec.clips.map((x) => x.mediaId));
  out.push('files on the card:', ...files.map((m) => fileLine(m, used.has(m.id))));
  const open = listNotes(piece.id).filter((n) => n.status === 'open');
  if (open.length) out.push(`${open.length} open comment(s): npm run notes -- ${short(piece.id)}`);
  return out.join('\n');
}

/**
 * Pauses by the voice band (150–4000 Hz) against the room's own floor: phone takes whose room tone sits above
 * voiceEnvelope's quiet level (capped at 20 dB under the voice) show no pauses there, but do here.
 */
async function bandPauses(file: string, min = 0.12): Promise<[number, number][]> {
  const { stdout } = await execFile(requireBinary('ffmpeg'), ['-v', 'error', '-i', file, '-map', '0:a:0', '-ac', '1', '-ar', '16000', '-af', 'highpass=f=150,lowpass=f=4000', '-f', 'f32le', 'pipe:1'], {
    encoding: 'buffer',
    maxBuffer: 1024 * 1024 * 1024,
  });
  const buf = stdout as unknown as Buffer;
  const x = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4));
  const hop = 160;
  const db = Array.from({ length: Math.floor(x.length / hop) }, (_, i) => {
    let sum = 0;
    for (let j = i * hop; j < (i + 1) * hop; j++) sum += x[j] * x[j];
    return 10 * Math.log10(sum / hop + 1e-12);
  });
  const sorted = db.filter((v) => v > -110).sort((a, b) => a - b);
  const level = (sorted[Math.floor(0.08 * sorted.length)] ?? -100) + 8;
  const out: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= db.length; i++) {
    const quiet = i < db.length && [db[i - 1], db[i], db[i + 1]].filter((v) => v === undefined || v < level).length >= 2;
    if (quiet && start < 0) start = i;
    if (!quiet && start >= 0) {
      if ((i - start) / 100 >= min) out.push([start / 100, i / 100]);
      start = -1;
    }
  }
  return out;
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

/** What a design file gets besides the spec: timeline times of the cut, the words and library scenes. */
function designContext(spec: EditSpec, words: TimelineWord[]) {
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
    retime: () => designContext(spec, words),
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
  if (flags.has('--dry')) return `dry run (nothing saved): ${total}\n${lines.join('\n')}`;
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

async function preview(piece: Piece, overlayId: string, times: number[]) {
  const edit = editOf(piece);
  const px = Number(opt('px')) || 300;
  const { images, times: at } = await previewOverlay(edit.id, overlayId, times.length ? times : undefined);
  const dir = workDir(piece.id);
  const shots = images.map((img: Buffer, i: number) => {
    const f = join(dir, `pv-${i}.jpg`);
    writeFileSync(f, img);
    return f;
  });
  const made = await sheets(shots, join(dir, `preview-${overlayId}`), px);
  shots.forEach((f) => rmSync(f, { force: true }));
  return `${overlayId}, left to right at ${at.map((t: number) => f2(t)).join(', ')} s into it (the working copy):\n${made.join('\n')}`;
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
        const made = await mod.default(spec, designContext(spec, await wordsOf(spec)));
        if (made) spec = made;
      }
      return save(p, spec, message || 'Claude edit');
    }
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
