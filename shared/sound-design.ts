// Sound on every move (phase 12 step 3): each move in an edit gets a non-musical sound effect on its frame, picked by
// the kind of move (a pop for something springing in, a swish for a slide, a hit for a slam, typing for letters),
// unless a sound is already there. Worked out from the edit every time, like a graphic's or a transition's own
// sounds, so the timings follow every change. The app's own sounds for now; a recorded library joins the pools later.
import { clipStarts, editDuration, graphicSounds, recipeSounds, transitionSounds, type EditOverlay, type EditSpec, type SfxCue } from './edit';
import type { OverlayAnimation } from './looks';
import type { SceneElement, SceneSound, SceneTween } from './scene';
import { builtinSfxId } from './sfx';

export type MoveKind = Exclude<SceneSound, 'none'>;

/**
 * A move on screen and the kind of sound it wants. `scene` and `clip` moves aren't an overlay's own start. `length`:
 * how long a move that makes a sound all along (a line drawing, letters typing) goes on.
 */
export type Move = { at: number; kind: MoveKind; what: string; from: 'overlay' | 'scene' | 'clip'; quiet?: boolean; length?: number };

/** Kinds whose sound goes on as long as the move does: it stops with the move, never runs on into a pause. */
const ALONG: MoveKind[] = ['draw', 'typing'];
/** A drawn line's or typed text's sound outlasts the move by this much (the pen lifting off). */
const ALONG_TAIL = 0.15;

/**
 * The voice level the sounds' volumes are set for (a podcast's or a clip-on mic's). The final leveling (−14 LUFS)
 * raises a quieter voice, a phone's at about −33 LUFS, and every sound with it: so the sounds and the nasheed come down
 * by as much as the voice is quieter (and up as it's louder), and sit as far under the voice whatever the footage.
 */
export const VOICE_REF_LUFS = -16;
/** How much the sounds' volumes are scaled for a voice this loud (LUFS, as cut); 1 when it isn't known. */
export const soundLevel = (voiceLufs: number | null | undefined) =>
  voiceLufs === null || voiceLufs === undefined || !Number.isFinite(voiceLufs) ? 1 : Math.min(2, Math.max(0.05, 10 ** ((voiceLufs - VOICE_REF_LUFS) / 20)));

/** The sounds each kind takes turns with, how loud, and how far ahead of the frame they start (whooshes peak late). */
const POOLS: Record<MoveKind, { names: string[]; volume: number; lead: number; rank: number }> = {
  hit: { names: ['hit', 'punch', 'boom-short'], volume: 0.55, lead: 0, rank: 5 },
  slam: { names: ['slam', 'hit'], volume: 0.55, lead: 0, rank: 5 },
  thud: { names: ['thud', 'knock'], volume: 0.5, lead: 0, rank: 4 },
  pop: { names: ['pop', 'bubble', 'pop-high'], volume: 0.5, lead: 0, rank: 3 },
  glitch: { names: ['glitch', 'stutter'], volume: 0.45, lead: 0, rank: 3 },
  zoom: { names: ['whoosh-fast'], volume: 0.5, lead: 0.1, rank: 2 },
  whip: { names: ['whoosh-whip'], volume: 0.5, lead: 0.08, rank: 2 },
  whoosh: { names: ['whoosh-soft', 'whoosh-fast'], volume: 0.4, lead: 0.12, rank: 2 },
  swish: { names: ['swish', 'swipe'], volume: 0.4, lead: 0.04, rank: 2 },
  focus: { names: ['focus'], volume: 0.4, lead: 0, rank: 1 },
  typing: { names: ['typing'], volume: 0.35, lead: 0, rank: 1 },
  draw: { names: ['pen-scribble'], volume: 0.3, lead: 0, rank: 1 },
  tick: { names: ['tick', 'click-soft'], volume: 0.35, lead: 0, rank: 0 },
};

/** How a text or picture overlay comes in (server/src/studio/motion.ts) and when it lands. Fades make no sound. */
const ENTRANCES: Partial<Record<OverlayAnimation, [MoveKind, number]>> = {
  pop: ['pop', 0],
  pulse: ['pop', 0],
  bounce: ['pop', 0],
  slide: ['swish', 0],
  float: ['swish', 0],
  flip: ['swish', 0],
  wipe: ['swish', 0],
  drop: ['thud', 0.2],
  zoom: ['hit', 0.1],
  spin: ['whip', 0],
  blur: ['focus', 0],
  typewriter: ['typing', 0],
  shake: ['slam', 0],
  glitch: ['glitch', 0],
};

/** Whether an overlay's entrance is a move that wants a sound (a fade is too soft for one). */
export const entranceWantsSound = (a: OverlayAnimation) => a in ENTRANCES;

const round = (n: number) => Math.round(n * 1000) / 1000;
const num = (v: unknown) => {
  const x = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(x) ? x : null;
};
const words = (text = '') => text.replace(/\*/g, '').split(/\s+/).filter(Boolean).length;
const chars = (text = '') => text.replace(/[*\s]/g, '').length;

/** What kind of move a scene tween is, if it's one that wants a sound. `el`: its first target, for sizes. */
function tweenKind(t: SceneTween, big: boolean, el?: SceneElement): { kind: MoveKind; quiet?: boolean } | null {
  const from = t.from ?? {};
  const to = t.to;
  // A mascot changing pose: a jump or a start pops, other gestures stay quiet.
  if (t.pose && !Object.keys(to).length) return t.pose === 'cheer' || t.pose === 'shock' ? { kind: 'pop', quiet: true } : null;
  if ('strokeDashoffset' in to || 'strokeDashoffset' in from) return { kind: t.duration >= 0.5 ? 'draw' : 'swish' };
  if (t.physics) return { kind: 'whoosh' };
  // Steady motion (a spin, a drift, a scroll) is texture, not a move.
  if (t.ease === 'none' || t.ease === 'linear') return null;
  const dist = (k: string) => Math.abs((num(from[k]) ?? 0) - (num(to[k]) ?? num(from[k]) ?? 0));
  // A shape changing size (a pill becoming a card) from what it was set to.
  const grow = (k: 'width' | 'height') => {
    const a = num(from[k]) ?? num(el?.style[k]);
    const b = num(to[k]);
    return a === null || b === null ? 0 : Math.abs(b - a);
  };
  const move = Math.max(dist('x'), dist('y'), dist('left'), dist('top'), 5 * Math.max(dist('xPercent'), dist('yPercent')));
  const turn = Math.max(dist('rotation'), dist('rotationX'), dist('rotationY'));
  const s0 = num(from.scale);
  const s1 = num(to.scale) ?? 1;
  if (num(to.opacity) === 0 || num(to.autoAlpha) === 0 || num(to.scale) === 0) return move >= 150 ? { kind: 'swish', quiet: true } : null;
  if (s0 !== null && s0 >= 1.8 && s1 <= 1.2) return { kind: 'hit' };
  if (turn >= 90) return { kind: 'whip' };
  if (move >= 150) return { kind: t.duration <= 0.5 ? 'swish' : 'whoosh' };
  if (s0 !== null && s0 <= 0.6 && s1 >= 0.8) return { kind: big ? 'hit' : 'pop' };
  if (Math.max(grow('width'), grow('height')) >= 150) return { kind: 'swish' };
  const appears = num(from.opacity) === 0 || num(from.autoAlpha) === 0;
  return appears && move >= 30 ? { kind: 'swish', quiet: true } : null;
}

/** The moves in a scene: each tween that moves something (once, not on its repeats), each step of a short stagger. */
export function sceneMoves(o: Extract<EditOverlay, { type: 'scene' }>): Move[] {
  const els = new Map<string, SceneElement>(o.elements.map((e) => [e.id, e]));
  const len = o.end - o.start;
  const out: Move[] = [];
  for (const t of o.tweens) {
    if (t.at >= len) continue;
    const targets = t.targets.split(',').map((s) => s.trim()).filter(Boolean);
    const parts = targets.map((s) => {
      const [id, part] = s.split('.');
      const el = els.get(id);
      return { el, count: part === 'words' ? words(el?.text) : part === 'chars' ? chars(el?.text) : 1, part };
    });
    if (t.sound === 'none') continue;
    const big = parts.some(({ el }) => (num(el?.style['font-size']) ?? 0) >= 140 || (el?.kind === 'box' && (num(el.style.width) ?? 0) >= 700));
    // A tween can name its sound; otherwise it's read from the move.
    const found = t.sound ? { kind: t.sound } : tweenKind(t, big, parts[0]?.el);
    const letters = parts.some((p) => p.part === 'chars');
    // Split text that only fades in still types (letters) or ticks (words) as it appears.
    const appears = [t.from?.opacity, t.from?.autoAlpha].some((v) => num(v) === 0) || [t.to.opacity, t.to.autoAlpha].some((v) => num(v) === 1);
    const kind = found ?? (!appears ? null : letters ? { kind: 'typing' as const } : parts.some((p) => p.part === 'words') ? { kind: 'tick' as const } : null);
    if (!kind) continue;
    const name = parts[0]?.el?.text ? `“${parts[0].el.text.replace(/\*/g, '').slice(0, 24)}”` : (parts[0]?.el?.id ?? 'element');
    const n = parts.reduce((sum, p) => sum + p.count, 0);
    const each = typeof t.stagger === 'number' ? t.stagger : (t.stagger?.each ?? 0);
    const from = typeof t.stagger === 'object' ? t.stagger.from : 'start';
    const steps = from === 'center' || from === 'edges' ? Math.ceil(n / 2) : n;
    // Letters type as one sound; a few words or items each get theirs; a fast, long stagger gets one at its start.
    const beats = !letters && steps > 1 && steps <= 8 && each >= 0.08 ? steps : 1;
    // A sound that goes on with the move lasts as long as it: one beat's tween, or the whole stagger for one sound.
    const length = ALONG.includes(kind.kind) ? round(t.duration + (beats === 1 ? each * Math.max(0, steps - 1) : 0) + ALONG_TAIL) : undefined;
    for (let k = 0; k < beats; k++) {
      const at = o.start + t.at + k * each + (kind.kind === 'thud' ? Math.min(0.2, t.duration * 0.4) : 0);
      if (at < o.end) out.push({ at: round(at), kind: kind.kind, what: `${name} in scene${o.name ? ` “${o.name}”` : ''}`, from: 'scene', quiet: kind.quiet, ...(length && { length }) });
    }
  }
  return out;
}

/** Every move in the edit that wants a sound on its frame. */
export function editMoves(spec: EditSpec): Move[] {
  const out: Move[] = [];
  const starts = clipStarts(spec);
  spec.clips.forEach((c, i) => {
    if (c.motion === 'punch') out.push({ at: starts[i], kind: 'zoom', what: 'snap zoom', from: 'clip' });
    if (c.motion === 'shake') out.push({ at: starts[i], kind: 'hit', what: 'impact shake', from: 'clip' });
  });
  for (const o of spec.overlays) {
    if (o.type === 'scene') out.push(...sceneMoves(o));
    else if (o.type === 'text' || o.type === 'image') {
      const entrance = ENTRANCES[o.animation];
      if (entrance) out.push({ at: round(o.start + entrance[1]), kind: entrance[0], what: o.type === 'text' ? `text “${o.text.replace(/\*/g, '').slice(0, 30)}”` : 'picture', from: 'overlay' });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** The sounds placed on moves that have none yet. `taken`: every other sound in the edit. */
export function motionSounds(spec: EditSpec, taken: SfxCue[] = baseSounds(spec)): SfxCue[] {
  if (!spec.audio.autoSfx) return [];
  const duration = editDuration(spec);
  const near = (at: number) => taken.some((c) => c.at >= at - 0.12 && c.at <= at + 0.25);
  const kept: Move[] = [];
  for (const m of editMoves(spec)) {
    if (m.at >= duration - 0.05 || near(m.at)) continue;
    // Two moves on almost the same frame get one sound, the stronger kind.
    const last = kept.at(-1);
    if (last && m.at - last.at < 0.1) {
      if (POOLS[m.kind].rank > POOLS[last.kind].rank) kept[kept.length - 1] = m;
      continue;
    }
    kept.push(m);
  }
  const turn = new Map<MoveKind, number>();
  return kept.map((m, k) => {
    const pool = POOLS[m.kind];
    const i = turn.get(m.kind) ?? 0;
    turn.set(m.kind, i + 1);
    return { id: `m-${k}`, mediaId: builtinSfxId(pool.names[i % pool.names.length]), at: round(Math.max(0, m.at - pool.lead)), volume: round(pool.volume * (m.quiet ? 0.7 : 1)), ...(m.length && { length: m.length }) };
  });
}

/** The edit's own cues and the ones its transitions, graphics and format bring. */
export function baseSounds(spec: EditSpec): SfxCue[] {
  return [...spec.audio.sfx, ...transitionSounds(spec), ...graphicSounds(spec), ...recipeSounds(spec)];
}

/** Every sound that plays in the finished video. */
export function allSounds(spec: EditSpec): SfxCue[] {
  const base = baseSounds(spec);
  return [...base, ...motionSounds(spec, base)];
}
