// Reframing that follows the speaker. `speakers.py` (the clip tools' OpenCV) finds the shots in a video and, in each,
// the faces and how much each one's mouth moves; here that becomes focus spans: a close-up stays on its face, a wide
// shot of two people goes to whoever is talking (holding at least a second and a half, so it doesn't flicker), and
// shots without a face sit in the middle. The main track's clips are then split where the focus changes. The frame
// never moves without a reason: it stays on the clip's main speaker unless someone else clearly talks for a while (a
// face in the source's own picture-in-picture, a nod from the listener, never takes it), and a speaker who leans
// about within a shot is framed on the whole stretch he moves in (no punch-in then), so he never drifts out of it.
import { readFile, writeFile } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { join } from 'node:path';
import { EDIT_FORMATS, newEditId, normalizeEdit, type EditClip, type EditFormat } from '../../../shared/edit';
import { config } from '../config';
import { db, schema } from '../db';
import { emit } from '../lib/events';
import { JobError } from '../jobs/queue';
import { clipToolsInstalled } from '../services/cliptools';
import { getMedia, mediaPath } from '../services/media';
import { getEdit, saveEditVersion } from './edits';
import { runTool } from '../compute/run';

export type SpeakerScan = {
  width: number;
  height: number;
  step: number;
  shots: {
    start: number;
    end: number;
    samples: number;
    /** `x0`–`x1`: how far the face moves sideways in the shot (scans from before 2026-11-03 don't have it). */
    tracks: { x: number; y: number; h: number; n: number; activity: [number, number][]; x0?: number; x1?: number }[];
  }[];
};

/**
 * Where to look, from `start` to `end` (seconds of the video), and how far to zoom in. `steady`: no punch-in on top.
 * `newShot`: it starts where the source cuts to another shot, so the framing before it never carries into it.
 */
export type FocusSpan = { start: number; end: number; x: number; y: number; zoom: number; steady?: boolean; newShot?: boolean };

type Track = SpeakerScan['shots'][number]['tracks'][number];
const samePerson = (a: Pick<Track, 'x' | 'y' | 'h'>, b: Pick<Track, 'x' | 'y' | 'h'>) => Math.abs(a.x - b.x) < 0.1 && Math.abs(a.y - b.y) < 0.12 && a.h / b.h > 0.7 && a.h / b.h < 1.4;

/** The person on screen the longest across the video's shots (where the camera has them): the one the frame stays on. */
export function mainPerson(scan: SpeakerScan): Pick<Track, 'x' | 'y' | 'h'> | null {
  const groups: { p: Pick<Track, 'x' | 'y' | 'h'>; seconds: number }[] = [];
  for (const shot of scan.shots) {
    const seen = shot.tracks.filter((t) => t.n >= Math.max(2, shot.samples * 0.3));
    for (const t of seen) {
      const seconds = ((shot.end - shot.start) * t.n) / Math.max(1, shot.samples);
      const g = groups.find((x) => samePerson(x.p, t));
      if (g) g.seconds += seconds;
      else groups.push({ p: { x: t.x, y: t.y, h: t.h }, seconds });
    }
  }
  return groups.sort((a, b) => b.seconds - a.seconds)[0]?.p ?? null;
}

/** Run the shot and speaker scan on a video (about a quarter of real time for 1080p). */
export async function scanSpeakers(file: string, opts: { track?: string } = {}): Promise<SpeakerScan> {
  if (!clipToolsInstalled()) throw new JobError('Install the clip tools first (Settings → Clip tools): they find the faces.', { retry: false });
  const out = await runTool('speakers', { video: file }, { fps: 8 }, { timeoutMs: 30 * 60_000, track: opts.track });
  return JSON.parse(out.trim().split('\n').pop() ?? '{}') as SpeakerScan;
}

/** A library video's scan, kept beside its frames so the same footage isn't scanned twice. */
export async function speakersOf(mediaId: string) {
  const cache = join(config.framesDir, `speakers-${mediaId}.json`);
  try {
    return JSON.parse(await readFile(cache, 'utf8')) as SpeakerScan;
  } catch {
    const scan = await scanSpeakers(mediaPath(getMedia(mediaId)));
    await writeFile(cache, JSON.stringify(scan));
    return scan;
  }
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Talking faces sit a little above the middle of the frame. */
const faceY = (y: number) => Math.max(0, y - 0.05);

/** Zoom so a small face (a wide shot) reads like a medium shot, never more than 1.6×. */
function zoomFor(h: number, cropH: number) {
  const target = 0.17;
  const onScreen = h / cropH;
  return onScreen >= target ? 1 : r3(Math.min(1.6, target / onScreen));
}

/**
 * Focus spans for a video framed into `format`. The fraction of the source's width a full-height crop shows decides
 * whether two people fit together or the frame has to pick one.
 */
export function focusSpans(scan: SpeakerScan, format: EditFormat): FocusSpan[] {
  const out = EDIT_FORMATS[format];
  const srcAspect = scan.width / Math.max(1, scan.height);
  const outAspect = out.width / out.height;
  // Crop size as a fraction of the source: full height and part of the width (a wide source in a tall frame), or
  // full width and part of the height (a tall source in a wider frame).
  const cropW = srcAspect > outAspect ? outAspect / srcAspect : 1;
  const cropH = srcAspect > outAspect ? 1 : srcAspect / outAspect;
  const spans: FocusSpan[] = [];
  // The start of the shot being framed, when the source cuts to it.
  let cut = -1;
  const push = (s: FocusSpan) => {
    const last = spans[spans.length - 1];
    if (last && Math.abs(last.x - s.x) < 0.04 && Math.abs(last.y - s.y) < 0.04 && Math.abs(last.zoom - s.zoom) < 0.05 && !!last.steady === !!s.steady) last.end = s.end;
    else spans.push({ ...s, x: r3(s.x), y: r3(s.y), ...(cut >= 0 && Math.abs(s.start - cut) < 1e-6 && { newShot: true }) });
  };
  const main = mainPerson(scan);
  /** One person framed: on the middle of where they move; when that needs the whole crop, no punch-in on top. */
  const one = (p: Track, shot: { start: number; end: number }, start = shot.start, end = shot.end) => {
    const zoom = zoomFor(p.h, cropH);
    const x0 = p.x0 ?? p.x;
    const x1 = p.x1 ?? p.x;
    // The face and a little room either side of it, at each end of its stretch.
    const needed = x1 - x0 + p.h * 0.75;
    const window = cropW / zoom;
    const moves = x1 - x0 > 0.02;
    push({ start, end, x: moves ? (x0 + x1) / 2 : p.x, y: faceY(p.y), zoom, ...(moves && needed > window / 1.12 && { steady: true }) });
  };

  for (const [k, shot] of scan.shots.entries()) {
    cut = k ? shot.start : -1;
    // Faces seen in a good part of the shot and not tiny next to the biggest (someone in the background).
    const seen = shot.tracks.filter((t) => t.n >= Math.max(2, shot.samples * 0.3));
    const biggest = Math.max(0, ...seen.map((t) => t.h));
    const framed = seen.filter((t) => t.h >= biggest * 0.45);
    // Real people move (a photo or a poster behind them doesn't). A shot with only still faces (a listener who keeps
    // very still, a photo on screen) frames on the biggest one.
    const moving = framed.filter((t) => mean(t.activity.map((a) => a[1])) > 0.04);
    const people = moving.length ? moving : framed.filter((t) => t.h === biggest).slice(0, 1);
    if (!people.length) {
      push({ start: shot.start, end: shot.end, x: 0.5, y: 0.5, zoom: 1 });
      continue;
    }
    if (people.length === 1) {
      one(people[0], shot);
      continue;
    }
    const left = Math.min(...people.map((p) => p.x - p.h * 0.35));
    const right = Math.max(...people.map((p) => p.x + p.h * 0.35));
    if (right - left <= cropW * 0.92) {
      // They fit side by side: keep both in.
      push({ start: shot.start, end: shot.end, x: (left + right) / 2, y: faceY(mean(people.map((p) => p.y))), zoom: 1 });
      continue;
    }
    // A wide shot: one window a second, whoever's mouth moves most; then smoothed so the frame holds ≥ 1.5 s. The
    // person the frame is on keeps it unless another face is clearly busier (half as much again).
    // Home is the main speaker when the camera has them where it usually does, else a face clearly bigger than the
    // rest (the person this camera is on; a small face beside them is a listener far off or a picture in the picture).
    const bySize = people.map((p, i) => ({ h: p.h, i })).sort((a, b) => b.h - a.h);
    const dominant = bySize.length > 1 && bySize[0].h >= bySize[1].h * 1.3 ? bySize[0].i : -1;
    const known = main ? people.findIndex((p) => samePerson(p, main)) : -1;
    const home = known >= 0 ? known : dominant;
    const WINDOW = 1;
    const count = Math.max(1, Math.ceil((shot.end - shot.start) / WINDOW));
    const winners: number[] = [];
    for (let w = 0; w < count; w++) {
      const a = shot.start + w * WINDOW;
      const b = a + WINDOW;
      const scores = people.map((p) => mean(p.activity.filter(([t]) => t >= a && t < b).map((x) => x[1])));
      let best = scores.indexOf(Math.max(...scores));
      if (home >= 0 && best !== home && scores[best] < scores[home] * 1.5) best = home;
      winners.push(Math.max(...scores) > 0 ? best : (winners[w - 1] ?? (home >= 0 ? home : best)));
    }
    // Median of three windows, so a one-second blip doesn't switch.
    const smooth = winners.map((v, i) => {
      const around = [winners[i - 1] ?? v, v, winners[i + 1] ?? v];
      return around.filter((x) => x === v).length >= 2 ? v : around[0] === around[2] ? around[0] : v;
    });
    let runs: { who: number; a: number; b: number }[] = [];
    smooth.forEach((who, i) => {
      const a = shot.start + i * WINDOW;
      const b = Math.min(shot.end, a + WINDOW);
      const last = runs[runs.length - 1];
      if (last && last.who === who) last.b = b;
      else runs.push({ who, a, b });
    });
    // Runs under 1.5 s join the one before (or after, at the start).
    const merged: typeof runs = [];
    for (const r of runs) {
      const last = merged[merged.length - 1];
      if (last && r.b - r.a < 1.5) last.b = r.b;
      else merged.push({ ...r });
    }
    if (merged.length > 1 && merged[0].b - merged[0].a < 1.5) {
      merged[1].a = merged[0].a;
      merged.shift();
    }
    // Away from the main speaker only for someone who talks a while (2.5 s): a nod, a laugh or a face in the
    // source's own picture-in-picture doesn't move the frame.
    if (home >= 0) for (const r of merged) if (r.who !== home && r.b - r.a < 2.5) r.who = home;
    runs = merged;
    for (const r of runs) one(people[r.who], shot, r.a, r.b);
  }
  // A sliver under 0.4 s within a shot joins its neighbour. One that is a shot of its own keeps its own framing: the
  // framing of the shot before, carried into another, shows whatever sits there (a can on the table, the other camera).
  for (let i = 0; i < spans.length; i++) {
    if (spans.length < 2 || spans[i].end - spans[i].start >= 0.4) continue;
    if (i > 0 && !spans[i].newShot) spans[i - 1].end = spans[i].end;
    else if (i + 1 < spans.length && !spans[i + 1].newShot) spans[i + 1] = { ...spans[i + 1], start: spans[i].start, ...(spans[i].newShot && { newShot: true }) };
    else continue;
    spans.splice(i, 1);
    i--;
  }
  return spans;
}

/**
 * Split the main track's clips of one video where the focus changes and give each piece its span's focus. A piece's
 * own zoom (a punch-in) stays on top of the span's.
 */
export function applyFocusSpans(clips: EditClip[], mediaId: string, spans: FocusSpan[]): EditClip[] {
  if (!spans.length) return clips;
  const out: EditClip[] = [];
  for (const clip of clips) {
    if (clip.mediaId !== mediaId) {
      out.push(clip);
      continue;
    }
    const inside = spans.filter((s) => s.end > clip.in + 0.01 && s.start < clip.out - 0.01);
    if (!inside.length) {
      out.push(clip);
      continue;
    }
    const pieces: EditClip[] = [];
    inside.forEach((s, i) => {
      const a = i === 0 ? clip.in : Math.max(clip.in, s.start);
      const b = i === inside.length - 1 ? clip.out : Math.min(clip.out, s.end);
      if (b - a <= 0.01) return;
      // Tightening's punch-in (1.12×) stays on top of the span's zoom; any other zoom is the frame's own, replaced (so
      // following the speaker twice gives the same result).
      // A piece already framed on this span carries the span's zoom times its punch-in.
      const onSpan = Math.abs(clip.focusX - s.x) < 0.002 && Math.abs(clip.focusY - s.y) < 0.002;
      const own = onSpan && s.zoom > 0 ? clip.zoom / s.zoom : clip.zoom;
      const punch = Math.abs(own - 1.12) < 0.01 && !s.steady ? 1.12 : 1;
      const piece: EditClip = { ...clip, id: pieces.length ? newEditId() : clip.id, in: r3(a), out: r3(b), focusX: s.x, focusY: s.y, zoom: r3(Math.min(3, punch * s.zoom)), ...(pieces.length && { transition: null }) };
      const last = pieces[pieces.length - 1];
      // Slivers under 0.4 s aren't worth a reframe: they stay with the piece before, within a shot (never into another
      // shot: that one's own framing, or the crop shows the wrong thing).
      if (last && b - a < 0.4 && !s.newShot) last.out = piece.out;
      else pieces.push(piece);
    });
    // A sliver at the very start (just before the focus changes within the shot) goes with the piece after it.
    if (pieces.length > 1 && pieces[0].out - pieces[0].in < 0.4 && !inside.find((s) => Math.abs(s.start - pieces[1].in) < 0.002)?.newShot) {
      pieces[1] = { ...pieces[1], id: pieces[0].id, in: pieces[0].in };
      pieces.shift();
    }
    out.push(...pieces);
  }
  return out;
}

/** Clips of one video with stretches of it taken out (seconds of the video): what's left either side stays. */
export function withoutRanges(clips: EditClip[], mediaId: string, ranges: { start: number; end: number }[]): EditClip[] {
  if (!ranges.length) return clips;
  return clips.flatMap((c) => {
    if (c.mediaId !== mediaId) return [c];
    let parts: [number, number][] = [[c.in, c.out]];
    for (const r of ranges) parts = parts.flatMap(([a, b]) => (r.end <= a || r.start >= b ? [[a, b] as [number, number]] : ([[a, Math.min(b, r.start)], [Math.max(a, r.end), b]] as [number, number][]).filter(([x, y]) => y - x >= 0.3)));
    return parts.map(([a, b], i) => ({ ...c, id: i ? newEditId() : c.id, in: r3(a), out: r3(b), ...(i && { transition: null }) }));
  });
}

/**
 * A clip that runs across a cut in the source (made longer by hand) split there, the part after it framed on its own
 * shot: one framing held through a camera change lands on the wrong spot. The part before keeps its framing.
 */
export function followShotChanges(clips: EditClip[], mediaId: string, spans: FocusSpan[]): { clips: EditClip[]; split: number } {
  let split = 0;
  const out = clips.flatMap((c) => {
    if (c.mediaId !== mediaId || c.fit === 'whole' || !spans.some((s) => s.newShot && s.start > c.in + 0.05 && s.start < c.out - 0.05)) return [c];
    const pieces = applyFocusSpans([c], mediaId, spans);
    if (pieces.length < 2) return [c];
    split++;
    pieces[0] = { ...pieces[0], focusX: c.focusX, focusY: c.focusY, zoom: c.zoom };
    return pieces;
  });
  return { clips: out, split };
}

/**
 * Clips of one video trimmed off a sliver of another shot at either end: the source cuts just after a clip starts or
 * just before it ends, and a few frames of the product on the table, a drink or the other camera flash past. Trimmed
 * when nothing is said in the sliver (a word in it keeps it, framed on its own shot); `words` are the video's.
 */
export function trimSlivers(clips: EditClip[], mediaId: string, shots: { start: number }[], words: { start: number; end: number }[], max = 0.45): EditClip[] {
  const cuts = shots.slice(1).map((s) => s.start);
  const silent = (a: number, b: number) => !words.some((w) => w.end > a + 0.03 && w.start < b - 0.03);
  return clips.map((c) => {
    if (c.mediaId !== mediaId) return c;
    let a = c.in;
    let b = c.out;
    const head = cuts.filter((t) => t > a + 0.01 && t < a + max).pop();
    if (head !== undefined && silent(a, head)) a = head;
    const tail = cuts.find((t) => t < b - 0.01 && t > b - max);
    if (tail !== undefined && silent(tail, b)) b = tail;
    return (a !== c.in || b !== c.out) && b - a >= 0.5 ? { ...c, in: r3(a), out: r3(b) } : c;
  });
}

/** The `edit.reframe` job: "Follow the speaker" on an edit's footage, saved as a new version. */
export async function reframeEdit({ editId, author }: { editId: string; author: 'you' | 'claude' }) {
  const edit = getEdit(editId);
  let spec = normalizeEdit(edit.working);
  const videos = [...new Set(spec.clips.map((c) => c.mediaId))].filter((id) => {
    const m = db.select({ kind: schema.media.kind }).from(schema.media).where(eq(schema.media.id, id)).get();
    return m?.kind === 'video';
  });
  if (!videos.length) throw new JobError('There’s no video footage on the main track to reframe.', { retry: false });
  let changed = 0;
  for (const id of videos) {
    const spans = focusSpans(await speakersOf(id), spec.format);
    const before = spec.clips.length;
    spec = { ...spec, clips: applyFocusSpans(spec.clips, id, spans) };
    changed += spec.clips.length - before + spans.length;
  }
  saveEditVersion(editId, { author, message: 'Follow the speaker: reframed on whoever is talking', spec });
  emit({ type: 'job', jobType: 'edit.reframe', status: 'done', message: changed ? 'Reframed to follow the speaker' : 'Nothing to reframe' });
}

export function onReframeFailed(_payload: unknown, message: string) {
  emit({ type: 'job', jobType: 'edit.reframe', status: 'error', message });
}
