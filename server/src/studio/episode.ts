// A series episode from Claude Code on a few lines: the lines to keep (as `npm run edit -- takes` prints them) become
// clips whose cuts sit in the voice's pauses and whose framing changes at every cut, and the series' own dress goes on
// (the challenge tracker, the captions of the episode before, a way to open, my screenshots on the lines they prove).
// Mechanical: no model call. A design file reaches it through `ctx.cut` and `ctx.episode` (server/scripts/edit.ts).
import { EDIT_FORMATS, clipStarts, fillGeometry, type CaptionSettings, type EditClip, type EditOverlay, type EditSpec } from '../../../shared/edit';
import type { BrollLayout } from '../../../shared/looks';
import { libraryScene } from '../../../shared/scene-library';
import type { TranscriptWord } from '../../../shared/types';
import { mediaPath, readTranscript, type MediaRow } from '../services/media';
import { bandPauses, cutInSpeech, refineWords, snapCuts, voiceEnvelope, type Envelope } from './clean-cuts';
import { mainPerson, speakersOf } from './reframe';

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export type TakeSound = { env: Envelope; band: [number, number][]; words: TranscriptWord[] };
const sounds = new Map<string, Promise<TakeSound | null>>();

/** A take's voice: its loudness, its pauses by the voice band and its words fitted to the sound (kept for the run). */
export function takeSound(m: MediaRow): Promise<TakeSound | null> {
  if (!sounds.has(m.id))
    sounds.set(
      m.id,
      (async () => {
        if (m.kind === 'image') return null;
        const file = mediaPath(m);
        const [env, band, t] = await Promise.all([voiceEnvelope(file), bandPauses(file), readTranscript(m.id)]);
        return { env, band, words: t ? refineWords(t, env).segments.flatMap((s) => s.words ?? []) : [] };
      })().catch(() => null),
    );
  return sounds.get(m.id)!;
}

/** Whether a cut at `t` lands in the voice: loud there, and in no pause the voice band shows. */
export const cutsSound = (s: TakeSound, t: number) => cutInSpeech(s.env, t) >= 0.5 && !s.band.some(([a, b]) => t >= a - 0.01 && t <= b + 0.01);

/** A line to keep: a name for the clip, then from where to where in the take (the times `takes` prints for it). */
export type LineRow = [id: string, from: number, to: number, more?: Partial<EditClip> & { /** Another take than the first argument. */ file?: string; /** `close` or `tight` instead of its turn. */ frame?: 'wide' | 'close' | 'tight' }];

export type CutOptions = {
  /** How far a close shot punches in (1.2) and a tight one (1.36). */
  close?: number;
  tight?: number;
  /** The first line's framing; the rest take turns. */
  start?: 'wide' | 'close';
  /** A line longer than this many seconds changes framing once inside it, on a word near its middle (5.5; 0 = never). */
  split?: number;
  /** Silence kept before a line's first sound (0.08 s) and after its last (0.12 s). */
  lead?: number;
  tail?: number;
};

/**
 * Clips for these lines. Each cut is moved into the pause beside its words (`snapCuts`, with the voice band's pauses for
 * a phone take), so a typed time only has to bound the right words. Framing takes turns between wide and close so no
 * cut joins two shots framed alike, and a close shot is placed by the face in the take's scan: on the face, with the
 * chin no lower than in the wide shot (the captions sit under it). `notes` says what it couldn't do cleanly.
 */
export async function cutLines(media: (id: string) => MediaRow, format: EditSpec['format'], file: string, rows: LineRow[], opts: CutOptions = {}): Promise<{ clips: EditClip[]; notes: string[] }> {
  const box = EDIT_FORMATS[format];
  const close = opts.close ?? 1.2;
  const tight = opts.tight ?? 1.36;
  const split = opts.split ?? 5.5;
  const notes: string[] = [];
  const faces = new Map<string, { x: number; y: number; h: number; w: number; hgt: number } | null>();
  const faceOf = async (m: MediaRow) => {
    if (!faces.has(m.id)) {
      const scan = m.kind === 'video' ? await speakersOf(m.id).catch(() => null) : null;
      const p = scan && mainPerson(scan);
      faces.set(m.id, p && scan ? { ...p, w: scan.width, hgt: scan.height } : null);
      if (m.kind === 'video' && !p) notes.push(`${m.id.slice(0, 8)}: no face found, so close shots zoom on the middle`);
    }
    return faces.get(m.id)!;
  };
  /** Where a shot at this zoom looks, so the face is in it and its chin sits where the wide shot has it or higher. */
  const frame = async (m: MediaRow, zoom: number) => {
    const f = await faceOf(m);
    if (!f) return { focusX: 0.5, focusY: zoom > 1 ? 0.48 : 0.5 };
    // A wide shot fills the frame: only which side of a wider picture it keeps is the face's.
    if (zoom <= 1) return { focusX: r3(f.x), focusY: 0.5 };
    const chin = f.y + f.h * 0.58;
    const wide = fillGeometry(f.w, f.hgt, box.width, box.height, f.x, 0.5, 1);
    const chinWide = (wide.top + chin * wide.height) / box.height;
    const at = Math.min(0.7, chinWide);
    const height = fillGeometry(f.w, f.hgt, box.width, box.height, f.x, 0.5, zoom).height;
    return { focusX: r3(f.x), focusY: r3(Math.min(1, Math.max(0, chin - ((at - 0.5) * box.height) / height))) };
  };

  const clips: EditClip[] = [];
  let turn: 'wide' | 'close' = opts.start ?? 'wide';
  for (const [id, from, to, more = {}] of rows) {
    const { file: other, frame: asked, ...fields } = more;
    const m = media(other ?? file);
    const s = await takeSound(m);
    let c: EditClip = { id, mediaId: m.id, in: from, out: to, focusX: 0.5, focusY: 0.5, zoom: 1, fit: 'fill', volume: 1, transition: null, motion: 'none', filter: null };
    if (s?.words.length) {
      const said = s.words.filter((w) => (w.start + w.end) / 2 >= from && (w.start + w.end) / 2 < to);
      if (!said.length) notes.push(`${id}: no words between ${from} and ${to}`);
      c = snapCuts([c], m.id, s.env, s.words, () => false, s.band, { lead: opts.lead ?? 0.08, tail: opts.tail ?? 0.12 })[0] ?? c;
      // No pause where a cut had to go: said with what would fix it, since only the words tell which it is.
      const k = said[0];
      const l = said[said.length - 1];
      if (k && fields.in === undefined && cutsSound(s, c.in)) {
        const prev = s.words[s.words.indexOf(k) - 1];
        notes.push(`${id}: “${k.word.trim()}” runs straight on from “${prev?.word.trim() ?? '…'}” (no pause): in ${c.in} is the quietest point between them`);
      }
      if (l && fields.out === undefined && cutsSound(s, c.out)) {
        const next = s.words[s.words.indexOf(l) + 1];
        const quiet = s.band.find(([a]) => a > c.out && a < Math.min(l.end + 1, next ? next.start : Infinity));
        notes.push(
          quiet
            ? `${id}: sound runs on ${r2(quiet[0] - l.end)} s after “${l.word.trim()}” (to ${r2(quiet[0])}): its tail, or a word Whisper didn't write. Out ${c.out} is the quietest point; { out: ${r2(quiet[0] + 0.08)} } keeps it all`
            : `${id}: “${l.word.trim()}” runs straight on into “${next?.word.trim() ?? '…'}” (no pause): out ${c.out} is the quietest point between them`,
        );
      }
    }
    // One framing a line, or two for a long one: the second starts on the word nearest its middle (the sound runs on).
    const parts: EditClip[] = [c];
    if (split > 0 && c.out - c.in > split && s?.words.length && fields.zoom === undefined && !asked) {
      const mid = (c.in + c.out) / 2;
      const inside = s.words.filter((w) => w.start > c.in + 1.5 && w.start < c.out - 1.5);
      const w = inside.sort((a, b) => Math.abs(a.start - mid) - Math.abs(b.start - mid))[0];
      if (w) {
        const at = r3(Math.max(c.in, w.start - 0.03));
        parts.splice(0, 1, { ...c, out: at }, { ...c, id: `${id}-b`, in: at });
      }
    }
    for (const p of parts) {
      const kind = asked ?? turn;
      const zoom = fields.zoom ?? (kind === 'tight' ? tight : kind === 'close' ? close : 1);
      clips.push({ ...p, zoom, ...(await frame(m, zoom)), ...fields });
      turn = zoom > 1 ? 'wide' : 'close';
    }
  }
  return { clips, notes };
}

/** The ways an episode opens: the tracker there from the first frame, my own words as a title card first, or bare. */
export const EPISODE_OPENS = ['plain', 'title', 'cold'] as const;
export type EpisodeOpen = (typeof EPISODE_OPENS)[number];

export type EpisodeOptions = {
  /** The tracker: day 5 of 100, $0 made of $100,000. What's left out comes from the episode before. */
  day: number | string;
  days?: number;
  made?: number | string;
  goal?: number | string;
  /** How it opens; left out, the one the series' recent episodes used least (`title` only with `title` words). */
  open?: EpisodeOpen;
  /** The title card's words: my own, as I say them. */
  title?: string;
  /** My screenshots and screen recordings, each on the line it proves (the clip's name). */
  proof?: {
    on: string;
    file: string;
    as?: BrollLayout;
    /** When it comes in: a word of the line (it lands 0.3 s before that word) or seconds into the line (0.15). */
    at?: number | string;
    /** How long it stays (to the line's end, 5 s at most). */
    seconds?: number;
    /** Where a recording starts. */
    from?: number;
  }[];
  captions?: Partial<CaptionSettings>;
  /** false: the takes' light stays as filmed (it's put right otherwise: `grade.light`). */
  light?: boolean;
};

/** What the series' earlier episodes carry into this one. */
export type SeriesSoFar = { episode: number; title: string; tracker: { text: string; sub: string } | null; captions: CaptionSettings; /** null: edited before the series had this dress. */ open: EpisodeOpen | null }[];

/** How an edit opens, read back from what `dressEpisode` put on it. */
export function openOf(spec: EditSpec): EpisodeOpen | null {
  if (spec.overlays.some((o) => o.id === 'kit-open')) return 'title';
  const t = spec.overlays.find((o) => o.id === 'kit-tracker');
  return t ? (t.start > 0.5 ? 'cold' : 'plain') : null;
}

const KIT = /^kit-/;

/**
 * The series' dress on an edit whose clips are set: the tracker, the captions of the episode before, the opening and
 * the proof shots. It replaces only what it put there before (ids starting `kit-`); anything else on the edit stays.
 */
export async function dressEpisode(spec: EditSpec, opts: EpisodeOptions, media: (id: string) => MediaRow, series: SeriesSoFar): Promise<string[]> {
  const notes: string[] = [];
  const { width: W, height: H } = EDIT_FORMATS[spec.format];
  const starts = clipStarts(spec);
  const total = spec.clips.reduce((n, c) => n + c.out - c.in, 0);
  const last = [...series].reverse().find((e) => e.tracker);
  spec.overlays = spec.overlays.filter((o) => !KIT.test(o.id));

  spec.grade = { ...spec.grade, light: opts.light !== false };
  // The captions of the episode before (whatever it was edited with), unless said.
  const before = series[series.length - 1];
  if (opts.captions || before) spec.captions = { ...spec.captions, ...(before?.captions ?? {}), ...(opts.captions ?? {}) };

  // The opening: said, or the one used least so far (the oldest on a tie), so episodes side by side don't all start alike.
  const used = series.flatMap((e) => (e.open ? [e.open] : []));
  const choices = EPISODE_OPENS.filter((o) => o !== 'title' || !!opts.title?.trim());
  const open = opts.open ?? [...choices].sort((a, b) => used.filter((u) => u === a).length - used.filter((u) => u === b).length || used.lastIndexOf(a) - used.lastIndexOf(b))[0];
  const firstEnd = spec.clips[0] ? starts[0] + spec.clips[0].out - spec.clips[0].in : 0;
  let trackerFrom = 0;
  if (open === 'title') {
    if (!opts.title?.trim()) throw new Error('open "title" needs `title`: the words of the card (my own).');
    const end = r2(Math.min(2.6, Math.max(1.6, firstEnd)));
    spec.overlays.push({ id: 'kit-open', type: 'text', text: opts.title.trim(), style: 'title', position: 'top', animation: 'pop', hidesCaptions: true, start: 0, end });
    trackerFrom = end;
  } else if (open === 'cold') trackerFrom = r2(firstEnd);
  notes.push(`open: ${open}${used.length ? ` (the series so far: ${EPISODE_OPENS.map((o) => `${o} ×${used.filter((u) => u === o).length}`).join(', ')})` : ''}`);

  // The tracker: the totals stay the series', the day and the money are this episode's.
  const was = last?.tracker;
  const part = (s: string | undefined, i: number) => s?.split('/')[i]?.trim();
  const money = (v: number | string | undefined, old: string | undefined) => (v === undefined ? old : typeof v === 'number' ? `$${v.toLocaleString('en-US')}` : v);
  const days = opts.days ?? Number(part(was?.text, 1)?.replace(/[^\d.]/g, '') || 0);
  const made = money(opts.made, part(was?.sub, 0));
  const goal = money(opts.goal, part(was?.sub, 1));
  const fill = { text: `Day ${opts.day}${days ? ` / ${days}` : ''}`, sub: made ? `${made}${goal ? ` / ${goal}` : ''}` : '' };
  if (total - trackerFrom > 1) {
    const { problems, ...scene } = libraryScene('tracker', fill, { W, H, color: spec.captions.highlight }, r2(total - trackerFrom));
    if (problems.length) notes.push(`tracker: ${problems.join('; ')}`);
    spec.overlays.push({ id: 'kit-tracker', type: 'scene', start: trackerFrom, end: r2(total), ...scene });
    notes.push(`tracker: ${fill.text} · ${fill.sub || 'no money line'}${opts.made === undefined && was ? ' (the money as in the episode before: say `made` when it changed)' : ''}`);
  }

  // Proof: my own screens over the line that talks about them, in on the word that names them.
  const shown: { on: string; start: number; end: number }[] = [];
  for (const [n, p] of (opts.proof ?? []).entries()) {
    const idx = spec.clips.map((c, i) => (c.id === p.on || c.id.startsWith(`${p.on}-`) ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) throw new Error(`proof: no line “${p.on}” (lines: ${spec.clips.map((c) => c.id).join(' ')})`);
    const m = media(p.file);
    const from = starts[idx[0]];
    const to = starts[idx[idx.length - 1]] + spec.clips[idx[idx.length - 1]].out - spec.clips[idx[idx.length - 1]].in;
    let start = from + (typeof p.at === 'number' ? p.at : 0.15);
    if (typeof p.at === 'string') {
      const plain = (t: string) => t.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
      let at: number | null = null;
      for (const i of idx) {
        const c = spec.clips[i];
        const w = (await takeSound(media(c.mediaId)))?.words.find((x) => (x.start + x.end) / 2 >= c.in && (x.start + x.end) / 2 < c.out && plain(x.word) === plain(p.at as string));
        if (w) {
          at = starts[i] + w.start - c.in;
          break;
        }
      }
      if (at === null) throw new Error(`proof on “${p.on}”: the line doesn't say “${p.at}”.`);
      start = Math.max(from, at - 0.3);
    }
    start = r2(start);
    const end = r2(Math.min(total, p.seconds ? start + p.seconds : Math.max(start + 1.8, Math.min(to - 0.1, start + 5))));
    const tall = (m.height ?? 0) > (m.width ?? 0);
    const o: EditOverlay = { id: `kit-proof-${n + 1}`, type: 'broll', mediaId: m.id, in: p.from ?? 0, layout: p.as ?? (tall ? 'phone' : 'card'), focusX: 0.5, focusY: 0.5, start, end };
    spec.overlays.push(o);
    if (end - start < 2) notes.push(`proof on “${p.on}”: only ${r2(end - start)} s on screen (2 s to read it)`);
    const close = shown.find((s) => start - s.end < 5 && s.start - end < 5);
    if (close) notes.push(`proof on “${p.on}”: under 5 s of me between it and the one on “${close.on}”`);
    shown.push({ on: p.on, start, end });
  }
  return notes;
}
