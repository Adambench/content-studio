// Reframing that follows the speaker. `speakers.py` (the clip tools' OpenCV) finds the shots in a video and, in each,
// the faces and how much each one's mouth moves; here that becomes focus spans: a close-up stays on its face, a wide
// shot of two people goes to whoever is talking (holding at least a second and a half, so it doesn't flicker), and
// shots without a face sit in the middle. The main track's clips are then split where the focus changes.
import { readFile, writeFile } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { join } from 'node:path';
import { EDIT_FORMATS, newEditId, normalizeEdit, type EditClip, type EditFormat } from '../../../shared/edit';
import { run } from '../campaigns/sources';
import { config } from '../config';
import { db, schema } from '../db';
import { emit } from '../lib/events';
import { JobError } from '../jobs/queue';
import { clipToolsInstalled, toolsEnv, yunetModel } from '../services/cliptools';
import { getMedia, mediaPath } from '../services/media';
import { getEdit, saveEditVersion } from './edits';

export type SpeakerScan = {
  width: number;
  height: number;
  step: number;
  shots: { start: number; end: number; samples: number; tracks: { x: number; y: number; h: number; n: number; activity: [number, number][] }[] }[];
};

/** Where to look, from `start` to `end` (seconds of the video), and how far to zoom in. */
export type FocusSpan = { start: number; end: number; x: number; y: number; zoom: number };

/** Run the shot and speaker scan on a video (about a quarter of real time for 1080p). */
export async function scanSpeakers(file: string, opts: { track?: string } = {}): Promise<SpeakerScan> {
  if (!clipToolsInstalled()) throw new JobError('Install the clip tools first (Settings → Clip tools): they find the faces.', { retry: false });
  const out = await run(config.toolsPython, [join(config.scriptsDir, 'speakers.py'), file, '--model', yunetModel(), '--fps', '8'], {
    env: toolsEnv(),
    timeoutMs: 30 * 60_000,
    track: opts.track,
  });
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
  const push = (s: FocusSpan) => {
    const last = spans[spans.length - 1];
    if (last && Math.abs(last.x - s.x) < 0.04 && Math.abs(last.y - s.y) < 0.04 && Math.abs(last.zoom - s.zoom) < 0.05) last.end = s.end;
    else spans.push({ ...s, x: r3(s.x), y: r3(s.y) });
  };

  for (const shot of scan.shots) {
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
      const p = people[0];
      push({ start: shot.start, end: shot.end, x: p.x, y: faceY(p.y), zoom: zoomFor(p.h, cropH) });
      continue;
    }
    const left = Math.min(...people.map((p) => p.x - p.h * 0.35));
    const right = Math.max(...people.map((p) => p.x + p.h * 0.35));
    if (right - left <= cropW * 0.92) {
      // They fit side by side: keep both in.
      push({ start: shot.start, end: shot.end, x: (left + right) / 2, y: faceY(mean(people.map((p) => p.y))), zoom: 1 });
      continue;
    }
    // A wide shot: one window a second, whoever's mouth moves most; then smoothed so the frame holds ≥ 1.5 s.
    const WINDOW = 1;
    const count = Math.max(1, Math.ceil((shot.end - shot.start) / WINDOW));
    const winners: number[] = [];
    for (let w = 0; w < count; w++) {
      const a = shot.start + w * WINDOW;
      const b = a + WINDOW;
      const scores = people.map((p) => mean(p.activity.filter(([t]) => t >= a && t < b).map((x) => x[1])));
      const best = scores.indexOf(Math.max(...scores));
      winners.push(Math.max(...scores) > 0 ? best : (winners[w - 1] ?? best));
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
    runs = merged;
    for (const r of runs) {
      const p = people[r.who];
      push({ start: r.a, end: r.b, x: p.x, y: faceY(p.y), zoom: zoomFor(p.h, cropH) });
    }
  }
  // A sliver under 0.4 s (a flash, the first frame of a cut) joins its neighbour.
  for (let i = 0; i < spans.length; i++) {
    if (spans.length < 2 || spans[i].end - spans[i].start >= 0.4) continue;
    if (i > 0) spans[i - 1].end = spans[i].end;
    else spans[1].start = spans[0].start;
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
      const punch = Math.abs(own - 1.12) < 0.01 ? 1.12 : 1;
      const piece: EditClip = { ...clip, id: pieces.length ? newEditId() : clip.id, in: r3(a), out: r3(b), focusX: s.x, focusY: s.y, zoom: r3(Math.min(3, punch * s.zoom)) };
      const last = pieces[pieces.length - 1];
      // Slivers under 0.4 s aren't worth a reframe: they stay with the piece before.
      if (last && b - a < 0.4) last.out = piece.out;
      else pieces.push(piece);
    });
    // A sliver at the very start (the shot changes just after the clip begins) goes with the piece after it.
    if (pieces.length > 1 && pieces[0].out - pieces[0].in < 0.4) {
      pieces[1] = { ...pieces[1], id: pieces[0].id, in: pieces[0].in };
      pieces.shift();
    }
    out.push(...pieces);
  }
  return out;
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
