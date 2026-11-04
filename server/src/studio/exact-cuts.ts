// Cuts exact to the frame, at every render. The source's camera changes (the speaker scan's `cuts`, read from every
// frame) decide where the framing changes, so a frame of one shot never wears another shot's crop. Where a cut lands
// just before or after a camera change, the few frames of the shot on the other side (a flash: a chair, a mic, the
// other camera) show the frame of the shot they join, held, while the sound plays on. Nothing moves on the timeline:
// every clip keeps its sound and its length, so captions, graphics and comments stay where they are.
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import { EDIT_FORMATS, clipStarts, fillGeometry, newEditId, transitionWindows, type EditClip, type EditFormat, type EditSpec } from '../../../shared/edit';
import { config } from '../config';
import { db, schema } from '../db';
import { requireBinary } from '../lib/bin';
import { focusSpans, speakersOf, type FocusSpan, type SpeakerScan } from './reframe';

const execFileP = promisify(execFile);

/** A clip as rendered: its picture plays from `playFrom` to `playTo` (seconds of the source) and holds still outside. */
export type RenderClip = EditClip & { playFrom?: number; playTo?: number };

/** A shot this short at a clip's start or end, cut in or out beside a camera change, is held instead of shown. */
export const EDGE_SLIVER = 0.4;
/** A shot of the source this short inside a clip (a flash) is held too. */
export const SHORT_SHOT = 0.2;
/** How far from a camera change the scans before 2026-11-04 could put it (they looked at every 4th frame). */
const LATE = 0.15;
/** Under this much left out between two clips of one shot, the second reads as the first going on (a twitch). */
const NEARLY_NOTHING = 0.15;
/** A camera change shows in a crop when the part of the picture in it changes by this much (mean, of 0–255). */
const VISIBLE = 8;

const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** The camera changes of a scan (the first frame of each new shot). */
export const scanCuts = (scan: SpeakerScan) => scan.cuts ?? scan.shots.slice(1).map((s) => s.start);

/** The part of the source a clip shows (0–1 each way). */
function viewOf(clip: EditClip, scan: SpeakerScan, format: EditFormat) {
  if (clip.fit === 'whole' || !scan.width || !scan.height) return { x0: 0, x1: 1, y0: 0, y1: 1 };
  const box = EDIT_FORMATS[format];
  const g = fillGeometry(scan.width, scan.height, box.width, box.height, clip.focusX, clip.focusY, clip.zoom);
  return { x0: -g.left / g.width, x1: (box.width - g.left) / g.width, y0: -g.top / g.height, y1: (box.height - g.top) / g.height };
}

/** How much the part of the picture a clip shows changes at a camera change (0–255; not known: all of it). */
function changeInView(grid: number[] | null | undefined, v: ReturnType<typeof viewOf>) {
  if (!grid || grid.length !== 144) return 255;
  const [c0, c1] = [Math.max(0, Math.floor(v.x0 * 16)), Math.min(16, Math.ceil(v.x1 * 16))];
  const [r0, r1] = [Math.max(0, Math.floor(v.y0 * 9)), Math.min(9, Math.ceil(v.y1 * 9))];
  let sum = 0;
  let n = 0;
  for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) [sum, n] = [sum + grid[r * 16 + c], n + 1];
  return n ? sum / n : 255;
}

/**
 * The clips of one video made exact to its camera changes (`spans`: its focus spans in the edit's format). Returns the
 * clips as rendered and what changed, in words.
 */
export function exactClips(clips: RenderClip[], mediaId: string, scan: SpeakerScan, spans: FocusSpan[], format: EditFormat): { clips: RenderClip[]; changes: string[] } {
  const cuts = scanCuts(scan);
  if (!cuts.length || !clips.some((c) => c.mediaId === mediaId)) return { clips, changes: [] };
  const half = 0.5 / (scan.fps ?? 30);
  const changes: string[] = [];
  const mine = (c: EditClip | undefined): c is RenderClip => !!c && c.mediaId === mediaId;
  // Two pieces of one stretch of the source, back to back (the sound runs straight on).
  const joined = (a: EditClip | undefined, b: EditClip | undefined) => mine(a) && mine(b) && Math.abs(a.out - b.in) < 0.02 && !b.transition && a.fit === b.fit;
  const cutAt = (t: number, within = half) => cuts.reduce<number | undefined>((best, c) => (Math.abs(c - t) <= within && (best === undefined || Math.abs(c - t) < Math.abs(best - t)) ? c : best), undefined);
  const between = (a: number, b: number) => cuts.filter((c) => c > a + half && c < b - half);
  /** The shot a frame is in (`t`: the middle of the frame): how many camera changes come before it. */
  const shotOf = (t: number) => cuts.filter((c) => c <= t).length;
  const spanAt = (t: number) => spans.find((s) => t >= s.start && t < s.end);
  const spanOver = (a: number, b: number) => {
    let best: FocusSpan | undefined;
    let most = 0;
    for (const s of spans) {
      const o = Math.min(b, s.end) - Math.max(a, s.start);
      if (o > most) [best, most] = [s, o];
    }
    return best;
  };
  const sameFocus = (c: Pick<EditClip, 'focusX' | 'focusY'>, s: FocusSpan) => Math.abs(c.focusX - s.x) < 0.04 && Math.abs(c.focusY - s.y) < 0.04;
  /** Whether the camera change at `c` shows in what `clip` frames. */
  const shows = (c: number, clip: EditClip) => changeInView(scan.cutGrids?.[cuts.indexOf(c)], viewOf(clip, scan, format)) >= VISIBLE;
  /** Whether the picture changes where `a` runs into `b` at the camera change `c`: the framing moves, or the change shows. */
  const visible = (c: number, a: EditClip, b: EditClip) => a.focusX !== b.focusX || a.focusY !== b.focusY || a.zoom !== b.zoom || shows(c, a);
  /** `b` (its first frame at `bt`) reads as `a` going on: one framing, no camera move, nearly nothing left out, one shot. */
  const goesOn = (a: EditClip | undefined, b: EditClip | undefined, at: number, bt: number) =>
    mine(a) && mine(b) && a.fit === b.fit && a.motion === 'none' && b.motion === 'none' && !b.transition && b.in - a.out >= -0.02 && b.in - a.out < NEARLY_NOTHING && shotOf(at) === shotOf(bt);
  const at = (c: EditClip) => `${c.in.toFixed(2)}–${c.out.toFixed(2)} s`;

  let out: RenderClip[] = clips.map((c) => ({ ...c }));

  // 1. A framing change between two pieces of one stretch that sits a few frames off a camera change (older scans were
  //    late) moves onto it. Both move by the same amount, so the sound and the timeline stay as they were.
  for (let i = 1; i < out.length; i++) {
    const [a, b] = [out[i - 1], out[i]];
    if (!joined(a, b)) continue;
    const c = cutAt(b.in, LATE);
    if (c === undefined || Math.abs(c - b.in) < 1e-3 || c - a.in < 4 * half || b.out - c < 4 * half) continue;
    out[i - 1] = { ...a, out: r4(a.out + c - b.in) };
    out[i] = { ...b, in: r4(c) };
    changes.push(`the framing change at ${b.in.toFixed(2)} s moved onto the camera change at ${c.toFixed(3)} s`);
  }

  // 2. A clip that runs across a camera change where the framing changes (the shot after it has a focus span of its
  //    own) is split there. A piece on the clip's own span keeps the clip's framing, punch-in and all; the others take
  //    their shot's span.
  out = out.flatMap((clip) => {
    if (!mine(clip) || clip.fit === 'whole' || !spans.length) return [clip];
    const inner = between(clip.in, clip.out).filter((c) => spanAt(c - half) !== spanAt(c + half));
    if (!inner.length) return [clip];
    const edges = [clip.in, ...inner, clip.out];
    const parts = edges.slice(1).map((b, k) => ({ a: edges[k], b, span: spanOver(edges[k], b) }));
    const base = parts.find((p) => p.span && sameFocus(clip, p.span))?.span;
    // Tightening's punch-in (1.12×) stays on top of each shot's own zoom.
    const own = base && base.zoom > 0 ? clip.zoom / base.zoom : clip.zoom;
    const punch = Math.abs(own - 1.12) < 0.02 ? 1.12 : 1;
    const longest = parts.reduce((x, y) => (y.b - y.a > x.b - x.a ? y : x));
    const pieces: RenderClip[] = [];
    for (const p of parts) {
      const keep = !p.span || sameFocus(clip, p.span) || (!base && p === longest);
      const f = keep ? { focusX: clip.focusX, focusY: clip.focusY, zoom: clip.zoom } : { focusX: p.span!.x, focusY: p.span!.y, zoom: r4(Math.min(3, p.span!.zoom * (p.span!.steady ? 1 : punch))) };
      const last = pieces[pieces.length - 1];
      if (last && last.focusX === f.focusX && last.focusY === f.focusY && last.zoom === f.zoom) last.out = r4(p.b);
      else pieces.push({ ...clip, ...f, id: pieces.length ? newEditId() : clip.id, in: r4(p.a), out: r4(p.b), ...(pieces.length && { transition: null }) });
    }
    if (pieces.length > 1) changes.push(`${at(clip)} split at the camera change${pieces.length > 2 ? 's' : ''} ${pieces.slice(1).map((p) => p.in.toFixed(3)).join(', ')} s, each shot on its own framing`);
    return pieces;
  });

  // 3. A piece too short to show beside a camera change joins a piece it's back to back with. At the start or end of a
  //    stretch (a sliver of the shot the source cuts to or from): when the clip before ends on that shot with nearly
  //    nothing left out, the sliver takes its framing (that clip going on); otherwise the frame beside it holds over
  //    it. Inside a stretch, a flash of another shot holds the frame before it, and a sliver of one shot on a framing
  //    of its own (a framing change just before or after a camera change) goes on the framing of the rest of its shot.
  for (let i = 0; i < out.length; i++) {
    const p = out[i];
    if (!mine(p)) continue;
    const prev = out[i - 1];
    const next = out[i + 1];
    const len = p.out - p.in;
    const jp = joined(prev, p);
    const jn = joined(p, next);
    const cIn = jp ? cutAt(p.in) : undefined;
    const cOut = jn ? cutAt(p.out) : undefined;
    const camIn = cIn !== undefined && visible(cIn, prev!, p);
    const camOut = cOut !== undefined && visible(cOut, p, next!);
    if (!jp && camOut && len < EDGE_SLIVER && goesOn(prev, p, prev!.out - half, p.in + half)) {
      if (p.focusX === prev!.focusX && p.focusY === prev!.focusY && p.zoom === prev!.zoom) continue;
      out[i] = { ...p, focusX: prev!.focusX, focusY: prev!.focusY, zoom: prev!.zoom };
      changes.push(`${at(p)}: a sliver before the camera change goes on the framing of the clip before`);
      continue;
    }
    if (!jn && camIn && len < EDGE_SLIVER && goesOn(p, next, p.out - half, next!.in + half)) {
      if (p.focusX === next!.focusX && p.focusY === next!.focusY && p.zoom === next!.zoom) continue;
      out[i] = { ...p, focusX: next!.focusX, focusY: next!.focusY, zoom: next!.zoom };
      changes.push(`${at(p)}: a sliver after the camera change goes on the framing of the clip after`);
      continue;
    }
    if (!jp && camOut && len < EDGE_SLIVER) {
      out[i + 1] = { ...next!, id: p.id, in: p.in, playFrom: next!.playFrom ?? next!.in, transition: p.transition };
      changes.push(`${at(p)}: a sliver before the camera change holds the next shot's first frame`);
    } else if (!jn && camIn && len < EDGE_SLIVER) {
      out[i - 1] = { ...prev!, out: p.out, playTo: prev!.playTo ?? prev!.out };
      changes.push(`${at(p)}: a sliver after the camera change holds the last shot's last frame`);
    } else if (jp && jn && camIn && camOut && len < SHORT_SHOT) {
      out[i - 1] = { ...prev!, out: p.out, playTo: prev!.playTo ?? prev!.out };
      changes.push(`${at(p)}: a flash of another shot holds the frame before it`);
    } else if (jp && jn && camIn !== camOut && len < EDGE_SLIVER) {
      if (camIn) out[i + 1] = { ...next!, in: p.in };
      else out[i - 1] = { ...prev!, out: p.out };
      changes.push(`${at(p)}: a sliver on a framing of its own goes on its shot's framing`);
    } else continue;
    out.splice(i, 1);
    i = Math.max(-1, i - 2);
  }

  // 4. Camera changes just inside a stretch's start or end where the framing doesn't change (it suits both shots, or
  //    the picture shows whole), when the change shows in the crop: the sliver goes on the framing of the clip before
  //    (or after) when that clip ends (or starts) on its shot with nearly nothing left out, else the frame beside it
  //    holds over it.
  for (let i = 0; i < out.length; i++) {
    const p = out[i];
    if (!mine(p)) continue;
    const prev = out[i - 1];
    if (!joined(prev, p)) {
      const window = between(p.in, Math.min(p.out, p.in + EDGE_SLIVER));
      const c = window[window.length - 1];
      if (c !== undefined && p.out - c >= SHORT_SHOT && c > (p.playFrom ?? p.in) + half && shows(c, p)) {
        if (window.length === 1 && goesOn(prev, p, prev!.out - half, p.in + half)) {
          out.splice(i, 1, { ...p, out: r4(c), focusX: prev!.focusX, focusY: prev!.focusY, zoom: prev!.zoom, playFrom: undefined }, { ...p, id: newEditId(), in: r4(c), transition: null });
          changes.push(`${at(p)}: the sliver before the camera change at ${c.toFixed(3)} s goes on the framing of the clip before`);
          i++;
        } else {
          out[i] = { ...p, playFrom: r4(c) };
          changes.push(`${at(p)}: holds the frame at the camera change ${c.toFixed(3)} s over the sliver before it`);
        }
      }
    }
    const q = out[i];
    const next = out[i + 1];
    if (!joined(q, next)) {
      const window = between(Math.max(q.in, q.out - EDGE_SLIVER), q.out);
      const c = window[0];
      if (c !== undefined && c - q.in >= SHORT_SHOT && c < (q.playTo ?? q.out) - half && shows(c, q)) {
        if (window.length === 1 && goesOn(q, next, q.out - half, next!.in + half)) {
          out.splice(i, 1, { ...q, out: r4(c), playTo: undefined }, { ...q, id: newEditId(), in: r4(c), focusX: next!.focusX, focusY: next!.focusY, zoom: next!.zoom, transition: null, playTo: undefined });
          changes.push(`${at(q)}: the sliver after the camera change at ${c.toFixed(3)} s goes on the framing of the clip after`);
          i++;
        } else {
          out[i] = { ...q, playTo: r4(c) };
          changes.push(`${at(q)}: holds the frame before the camera change ${c.toFixed(3)} s over the sliver after it`);
        }
      }
    }
  }
  return { clips: out, changes };
}

/**
 * Where a clip's picture must stop short of its transition handles (seconds of the source taken past its in and out
 * for a transition): a camera change inside a handle would show a few frames of another shot under the transition.
 */
export function handlePlay(clip: Pick<RenderClip, 'in' | 'out' | 'playFrom' | 'playTo'>, from: number, to: number, cuts: number[], fps = 30) {
  const half = 0.5 / fps;
  const before = cuts.filter((c) => c > from + half && c <= clip.in + half);
  const after = cuts.filter((c) => c >= clip.out - half && c < to - half);
  const playFrom = Math.max(clip.playFrom ?? from, ...before);
  const playTo = Math.min(clip.playTo ?? to, ...after);
  return playFrom > from + half || playTo < to - half ? { from: playFrom, to: playTo } : null;
}

/** Videos longer than this aren't scanned when they're rendered (a long recording's first render would wait minutes). */
const SCAN_AT_RENDER_MAX = 30 * 60;

/** The clips as rendered, each video's camera changes (seconds) and frame rate, and what was made exact, in words. */
export type RenderPlan = { clips: RenderClip[]; cuts: Map<string, { cuts: number[]; fps: number }>; changes: string[] };

/**
 * An edit's clips as they render: each video's camera changes (scanned once and kept; `addCuts` scans it again with
 * these added), then `exactClips`.
 */
export async function exactPlan(spec: EditSpec, opts: { addCuts?: Map<string, number[]> } = {}): Promise<RenderPlan> {
  let clips: RenderClip[] = spec.clips;
  const cuts = new Map<string, { cuts: number[]; fps: number }>();
  const changes: string[] = [];
  for (const id of new Set(spec.clips.map((c) => c.mediaId))) {
    const m = db.select({ kind: schema.media.kind, durationMs: schema.media.durationMs }).from(schema.media).where(eq(schema.media.id, id)).get();
    if (m?.kind !== 'video' || (m.durationMs ?? 0) / 1000 > SCAN_AT_RENDER_MAX) continue;
    const scan = await speakersOf(id, { addCuts: opts.addCuts?.get(id) }).catch((err: Error) => (console.warn(`[render] camera changes of ${id}: ${err.message}`), null));
    if (!scan) continue;
    cuts.set(id, { cuts: scanCuts(scan), fps: scan.fps ?? 30 });
    const r = exactClips(clips, id, scan, focusSpans(scan, spec.format), spec.format);
    clips = r.clips;
    changes.push(...r.changes);
  }
  return { clips, cuts, changes };
}

/** The frames of a video file where most of the picture changes at once (the speaker scan's rule), and its frame time. */
export async function pictureChanges(file: string, signal?: AbortSignal): Promise<{ times: number[]; frame: number }> {
  const dir = await mkdtemp(join(config.tmpDir, 'scd-'));
  try {
    await execFileP(requireBinary('ffmpeg'), ['-hide_banner', '-nostats', '-v', 'error', '-i', file, '-map', '0:V:0', '-vf', 'scdet=threshold=100,metadata=mode=print:file=scd.txt', '-f', 'null', '-'], { cwd: dir, signal });
    const t: number[] = [];
    const d: number[] = [];
    for (const line of (await readFile(join(dir, 'scd.txt'), 'utf8')).split('\n')) {
      const m = /^frame:\d+\s+pts:\S+\s+pts_time:(-?[\d.]+)/.exec(line);
      if (m) [t[t.length], d[d.length]] = [Number(m[1]), 0];
      else if (line.startsWith('lavfi.scd.mafd=') && d.length) d[d.length - 1] = Number(line.slice(15));
    }
    const frame = t.length > 1 ? (t[t.length - 1] - t[0]) / (t.length - 1) : 1 / 30;
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
    const times = d.flatMap((v, i) => {
      if (!i || v < 4) return [];
      const around = d.slice(Math.max(1, i - 6), i + 7).filter((_, k) => Math.max(1, i - 6) + k !== i);
      return v >= 8 * Math.max(median(around), 0.05) ? [t[i]] : [];
    });
    return { times, frame };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** What the check of a finished video found. */
export type CutCheck = {
  /** Picture changes inside a clip's footage that the plan didn't make: camera changes the scan missed (source seconds). */
  missed: { mediaId: string; source: number; at: number }[];
  /** Picture changes a few frames after another (seconds of the video): a flash. */
  flashes: number[];
};

/**
 * The finished video checked against the plan: every picture change should be a cut, a framing change or a camera
 * change the plan knows of. One that isn't, inside a clip's footage, is a camera change the scan missed (the framing
 * didn't follow it); two a few frames apart are a flash. Graphics, B-roll and transitions change the picture
 * themselves: those stretches aren't judged.
 */
export async function checkCuts(file: string, spec: EditSpec, plan: RenderPlan, signal?: AbortSignal): Promise<CutCheck> {
  const { times, frame } = await pictureChanges(file, signal);
  const drawn = { clips: plan.clips };
  const starts = clipStarts(drawn);
  const expected: number[] = [];
  plan.clips.forEach((c, i) => {
    if (i) expected.push(starts[i]);
    for (const cut of plan.cuts.get(c.mediaId)?.cuts ?? []) if (cut > (c.playFrom ?? c.in) && cut < (c.playTo ?? c.out)) expected.push(starts[i] + cut - c.in);
  });
  const busy: [number, number][] = [
    [0, 0.5],
    ...transitionWindows(drawn).map((w) => [w.start - 2 * frame, w.end + 2 * frame] as [number, number]),
    ...spec.overlays.flatMap((o): [number, number][] =>
      o.type === 'broll' || o.type === 'scene' ? [[o.start - 2 * frame, o.end + 2 * frame]] : [[o.start - 2 * frame, o.start + 0.6], [o.end - 0.6, o.end + 2 * frame]],
    ),
  ];
  const free = (t: number) => !busy.some(([a, b]) => t >= a && t <= b);
  const seen = times.filter(free);
  const missed = seen.flatMap((t) => {
    if (expected.some((e) => Math.abs(e - t) <= frame * 1.5)) return [];
    let i = starts.length - 1;
    while (i > 0 && starts[i] > t + frame / 2) i--;
    const c = plan.clips[i];
    if (!c || !plan.cuts.has(c.mediaId)) return [];
    const source = c.in + (t - starts[i]);
    // Held frames don't change: a change there is something else.
    if (source < (c.playFrom ?? c.in) || source >= (c.playTo ?? c.out)) return [];
    return [{ mediaId: c.mediaId, source: Math.round(source * 10000) / 10000, at: t }];
  });
  const flashes = seen.filter((t, k) => k > 0 && t - seen[k - 1] <= frame * 4.5);
  return { missed, flashes };
}
