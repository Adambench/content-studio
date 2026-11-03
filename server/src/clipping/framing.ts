// Two framing touches a clip gets once it's cut: a game clip's hook fills the frame before the whole picture shows,
// and a podcast guest most viewers wouldn't know is named by an arrow that points at them as they first show.
import { clipGeometry, clipStarts, EDIT_FORMATS, newEditId, type EditClip, type EditSpec, type GraphicOverlay } from '../../../shared/edit';
import type { MomentSpeaker } from '../../../shared/clipping';
import type { SpeakerScan } from '../studio/reframe';

const round = (v: number) => Math.round(v * 1000) / 1000;

/**
 * A whole-picture clip opens full screen, the way the creator's own intro plays, until its first scene cut between
 * `min` and `max` seconds in (the hook is big; the text and the HUD after it show whole). No cut there: unchanged,
 * since switching mid-shot reads as a jump.
 */
export function fillHook(clips: EditClip[], scan: SpeakerScan | null, min = 1.2, max = 4.5): EditClip[] {
  const first = clips[0];
  if (!first || first.fit !== 'whole') return clips;
  let t = 0;
  for (let k = 0; k < clips.length; k++) {
    const c = clips[k];
    if (c.mediaId !== first.mediaId || c.fit !== 'whole') return clips;
    const cuts = (scan?.shots ?? []).map((s) => s.start).filter((b) => b > c.in + 0.05 && b < c.out - 0.3 && t + b - c.in >= min && t + b - c.in <= max);
    if (cuts.length) {
      const at = round(cuts[0]);
      const head = clips.slice(0, k).map((x) => ({ ...x, fit: 'fill' as const, focusX: 0.5, focusY: 0.5, zoom: 1 }));
      return [...head, { ...c, out: at, fit: 'fill', focusX: 0.5, focusY: 0.5, zoom: 1 }, { ...c, id: newEditId(), in: at }, ...clips.slice(k + 1)];
    }
    t += c.out - c.in;
    const next = clips[k + 1];
    // The edit's own cut, in range: everything before it fills.
    if (t >= min && t <= max && next) return [...clips.slice(0, k + 1).map((x) => ({ ...x, fit: 'fill' as const, focusX: 0.5, focusY: 0.5, zoom: 1 })), ...clips.slice(k + 1)];
    if (t > max) return clips;
  }
  return clips;
}

type Person = { x: number; y: number; h: number };

/**
 * The "Who's this" arrow for the moment's main speaker, at the first moment they're on screen from `after` on (never
 * in the first seconds with the hook card and the captions: one thing to look at a time), or null when it can't
 * tell who they are: the person seen talking in shots that make up at least `share` of the talking on screen (people
 * matched across shots by where the camera has them), so a host is never named as the guest.
 */
export function whoTag(spec: EditSpec, mediaId: string, scan: SpeakerScan, speaker: MomentSpeaker, src: { width?: number | null; height?: number | null }, share = 0.65, after = 0): GraphicOverlay | null {
  if (!speaker.name || speaker.known || !src.width || !src.height) return null;
  const { width: W, height: H } = EDIT_FORMATS[spec.format];
  const starts = clipStarts(spec);
  // Who talks in each shot: the face whose mouth moves most among the ones in a good part of it.
  const talker = (shot: SpeakerScan['shots'][number]): Person | null => {
    const seen = shot.tracks.filter((t) => t.n >= Math.max(2, shot.samples * 0.3));
    const biggest = Math.max(0, ...seen.map((t) => t.h));
    const framed = seen.filter((t) => t.h >= biggest * 0.45);
    const motion = (t: (typeof framed)[number]) => t.activity.reduce((n, a) => n + a[1], 0) / Math.max(1, t.activity.length);
    const best = [...framed].sort((a, b) => motion(b) - motion(a))[0];
    return best && motion(best) > 0.04 ? { x: best.x, y: best.y, h: best.h } : null;
  };
  const same = (a: Person, b: Person) => Math.abs(a.x - b.x) < 0.08 && Math.abs(a.y - b.y) < 0.1 && a.h / b.h > 0.7 && a.h / b.h < 1.4;
  // Every stretch of the finished video that shows a shot, with its talker.
  const shown: { t0: number; t1: number; clip: EditClip; who: Person; group: number }[] = [];
  const groups: { person: Person; seconds: number }[] = [];
  spec.clips.forEach((c, k) => {
    if (c.mediaId !== mediaId) return;
    for (const shot of scan.shots) {
      const a = Math.max(c.in, shot.start);
      const b = Math.min(c.out, shot.end);
      if (b - a < 0.2) continue;
      const who = talker(shot);
      if (!who) continue;
      let group = groups.findIndex((g) => same(g.person, who));
      if (group < 0) group = groups.push({ person: who, seconds: 0 }) - 1;
      groups[group].seconds += b - a;
      shown.push({ t0: starts[k] + a - c.in, t1: starts[k] + b - c.in, clip: c, who, group });
    }
  });
  const total = groups.reduce((n, g) => n + g.seconds, 0);
  const main = groups.reduce((best, g, i) => (g.seconds > (groups[best]?.seconds ?? -1) ? i : best), -1);
  if (main < 0 || groups[main].seconds < total * share) return null;
  // The first time they're on screen long enough to read it (a run of their shots, joined across the edit's cuts).
  const runs: { t0: number; t1: number; first: (typeof shown)[number] }[] = [];
  for (const s of shown.filter((x) => x.group === main).sort((a, b) => a.t0 - b.t0)) {
    const last = runs[runs.length - 1];
    if (last && s.t0 - last.t1 < 0.05) last.t1 = s.t1;
    else runs.push({ t0: s.t0, t1: s.t1, first: s });
  }
  const from = Math.max(after, 0.2);
  const run = runs.find((r) => r.t1 - Math.max(r.t0, from) >= 1.6);
  if (!run) return null;
  const start = round(Math.max(run.t0, from));
  const end = round(Math.min(run.t1, start + 3));
  // Their face on the finished frame, from the first clip of the run (the frame holds through a run of one shot).
  const { clip, who } = run.first;
  const g = clipGeometry(clip, src.width, src.height, W, H);
  const fx = g.left + who.x * g.width;
  const fy = g.top + who.y * g.height;
  const r = (who.h * g.height) / 2;
  // The tip sits at the cheek on the roomier side; the card goes below it, toward that edge of the frame.
  const tx = fx + (fx < W / 2 ? 1 : -1) * r * 0.8;
  const ty = fy + r * 0.2;
  return {
    id: newEditId(),
    type: 'graphic',
    template: 'who',
    start,
    end,
    text: speaker.name,
    sub: speaker.about,
    items: [],
    x: round(Math.min(0.94, Math.max(0.06, tx / W))),
    y: round(Math.min(0.9, Math.max(0.08, ty / H))),
    position: 'center',
    sound: true,
  } as GraphicOverlay;
}
