// The motion scene library (phase 12 step 4): ready-made scenes filled with the creator's words. Each one is a
// technique from the awesome-opus5-5-videos prompts (github.com/yihui-dev/awesome-opus5-5-videos, MIT: one shape that
// morphs through UI states, kinetic spoken-word typography, an aperture reveal, low-poly shards, a chart that draws
// itself, a cursor that drives the UI, ...) redone as scene data (shared/scene.ts): plain elements and GSAP tweens
// with explicit start states, nothing random, so every frame can be seeked. A library scene keeps its preset and
// words and is built again whenever the edit changes (its length, the frame, the accent colour), until it's
// redesigned by hand with write_scene and becomes a custom scene.
import { isMascotPose, type MascotPose } from './mascots';
import { normalizeFill, normalizeScene, SCENE_MAX_SECONDS, type SceneElement, type SceneSpec, type SceneTween } from './scene';

export const SCENE_PRESETS = [
  'kinetic-lines',
  'morph',
  'cursor-click',
  'island',
  'growth-line',
  'orbit',
  'flow',
  'card-deck',
  'odometer',
  'iris',
  'wipe',
  'fly-through',
  'shatter',
  'shine-title',
  'burst',
  'marquee',
  'terminal',
  'route',
  'clock',
  'mascot-explain',
  'mascot-says',
  'mascot-react',
  'ayah',
  'hadith',
  'speaker',
] as const;
export type ScenePreset = (typeof SCENE_PRESETS)[number];
export const isScenePreset = (p: unknown): p is ScenePreset => SCENE_PRESETS.includes(p as ScenePreset);

/** The words a library scene is filled with; each uses only some of them (SCENE_LIBRARY[p].fields). */
export type SceneFill = NonNullable<SceneSpec['fill']>;
/** The frame it's built for: its size and the accent colour (the captions' highlight). */
export type SceneFrame = { W: number; H: number; color: string };

type El = Omit<SceneElement, 'style'> & { style: Record<string, string | number> };
type Built = { background: string; elements: El[]; tweens: SceneTween[] };

type Info = {
  label: string;
  /** When it fits. */
  hint: string;
  /** What each field is for (unused ones are left out). */
  fields: { text?: string; sub?: string; items?: string; arabic?: string };
  /** The plain colour it's designed on, for *Behind it* (else a near black). */
  solid?: string;
  /** It shows the words being said itself (an ayah's meaning): the captions step aside while it's on. */
  hidesCaptions?: boolean;
  /** The words a new one starts with in the editor. */
  example: Partial<SceneFill>;
  /** How long it wants to be with these words; shorter, everything runs faster to fit. */
  seconds: (f: SceneFill) => number;
  build: (f: SceneFill, frame: SceneFrame, len: number) => Built;
};

const DARK = '#0b0c10';
const INK = '#0b0b0b';
const PANEL = '#16181d';
const EDGE = '2px solid rgba(255,255,255,.12)';
// The Islamic scenes' palette (Gentle Return's brand guide).
const DEEP = '#0E3A2D';
const NAVY = '#0B1426';
const GOLD = '#C9A45C';
const CREAM = '#F3EAD3';
const NASKH = 'Noto Naskh Arabic';
const r = Math.round;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const plain = (t: string) => t.replace(/\*/g, '');
const longest = (t: string) => Math.max(1, ...plain(t).split('\n').map((l) => l.trim().length));
/** A font size that fits the text's longest line across `width` px; `per` is a letter's width in ems. */
const fit = (t: string, width: number, max: number, min = 32, per = 0.6) => r(clamp(width / (longest(t) * per), min, max));
/** A font size for text that may wrap onto `lines` lines (its longest word still fits on one). */
const fitWrap = (t: string, width: number, lines: number, max: number, min = 32, per = 0.6) => {
  const word = Math.max(1, ...plain(t).split(/\s+/).map((w) => w.length));
  return r(clamp(Math.min((width * lines) / (Math.max(1, plain(t).length) * per), width / (word * per)), min, max));
};
/** A full-width strip that centres what's inside it. */
const row = (W: number, id: string, top: number, height: number, style: El['style'] = {}): El => ({
  id,
  kind: 'box',
  style: { left: 0, top: r(top), width: W, height: r(height), display: 'flex', 'align-items': 'center', 'justify-content': 'center', ...style },
});
const centred = { display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'text-align': 'center' };
/** Everything leaves together at the end. */
const exit = (ids: string[], len: number): SceneTween => ({ targets: ids.join(','), at: Math.max(0, len - 0.3), duration: 0.3, to: { opacity: 0 }, ease: 'power2.in', sound: 'none' });
const items = (f: SceneFill, min: number, max: number) => (f.items.length >= min ? f.items.slice(0, max) : []);

export const SCENE_LIBRARY: Record<ScenePreset, Info> = {
  'kinetic-lines': {
    label: 'Kinetic lines',
    hint: 'A short speech staged in type: each line comes in its own way and stacks, and the last one slams down on a line of its own',
    fields: { items: 'The lines in order, one per line (2–5; the last is the big one)' },
    example: { items: ['Nobody was coming', 'so I *started*', 'badly, every day', 'Now it *works*'] },
    seconds: (f) => 2.3 + 0.9 * clamp(f.items.length, 1, 5),
    build: (f, { W, H, color }, len): Built => {
      const lines = items(f, 1, 5);
      const n = lines.length;
      const last = n - 1;
      const sizes = lines.map((l, i) => (i === last ? fit(l, 860, 230, 90, 0.46) : fit(l, 860, 104, 44, 0.57)));
      const heights = sizes.map((s, i) => r(s * (i === last ? 1.05 : 1.2)));
      const gap = 24;
      const total = heights.reduce((a, b) => a + b, 0) + gap * last + 40;
      const tops: number[] = [];
      let y = r(H * 0.46 - total / 2);
      for (const h of heights) {
        tops.push(y);
        y += h + gap;
      }
      // The lines spread over the scene; the last waits a held breath, then has time to sit.
      const step = last ? clamp((len - 0.6 - 1.4) / last, 0.45, 1.4) : 0;
      const at = (i: number) => 0.2 + i * step + (i === last && last ? 0.4 : 0);
      const elements: El[] = [];
      const tweens: SceneTween[] = [];
      lines.forEach((l, i) => {
        const end = i === last;
        const kind = end ? 'slam' : (['words', 'slide', 'chars'] as const)[i % 3];
        elements.push({ id: `m${i}`, kind: 'text', text: String(i + 1).padStart(2, '0'), style: { left: 56, top: tops[i] + r((heights[i] - 30) / 2), 'font-size': 24, 'font-family': 'JetBrains Mono', 'font-weight': 500, color: '#8a8f98' } });
        elements.push({
          id: `l${i}`,
          kind: 'text',
          text: l,
          ...(kind === 'words' || kind === 'chars' ? { split: kind } : {}),
          style: {
            left: 130,
            top: tops[i],
            width: 900,
            height: heights[i],
            'font-size': sizes[i],
            'font-family': end ? 'Anton' : 'Playfair Display',
            'font-weight': end ? 400 : 700,
            'line-height': end ? 1.05 : 1.2,
            'white-space': 'nowrap',
            ...(end ? { 'text-transform': 'uppercase', 'transform-origin': 'left center' } : {}),
            ...(kind === 'words' ? { overflow: 'hidden' } : {}),
          },
        });
        tweens.push({ targets: `m${i}`, at: at(i), duration: 0.3, from: { opacity: 0 }, to: { opacity: 1 }, sound: 'none' });
        if (kind === 'words') tweens.push({ targets: `l${i}.words`, at: at(i), duration: 0.55, from: { yPercent: 100, opacity: 0 }, to: { yPercent: 0, opacity: 1 }, ease: 'power3.out', stagger: 0.07 });
        if (kind === 'slide') tweens.push({ targets: `l${i}`, at: at(i), duration: 0.55, from: { x: -140, opacity: 0, filter: 'blur(10px)' }, to: { x: 0, opacity: 1, filter: 'blur(0px)' }, ease: 'expo.out' });
        if (kind === 'chars') tweens.push({ targets: `l${i}.chars`, at: at(i), duration: 0.01, from: { opacity: 0 }, to: { opacity: 1 }, stagger: 0.035, ease: 'none' });
        if (kind === 'slam') tweens.push({ targets: `l${i}`, at: at(i), duration: 0.4, from: { scale: 1.9, opacity: 0 }, to: { scale: 1, opacity: 1 }, ease: 'power4.out', sound: 'hit' });
        // The line before steps back as the next one speaks.
        if (i > 0) tweens.push({ targets: `l${i - 1},m${i - 1}`, at: at(i), duration: 0.3, to: { opacity: 0.4 }, sound: 'none' });
      });
      if (n) {
        elements.push({ id: 'floor', kind: 'box', style: { left: 130, top: tops[last] + heights[last] + 16, width: 880, height: 10, background: color, 'transform-origin': 'left center' } });
        tweens.push({ targets: 'floor', at: at(last) + 0.35, duration: 0.55, from: { scaleX: 0 }, to: { scaleX: 1 }, ease: 'expo.inOut', sound: 'swish' });
      }
      return { background: DARK, elements, tweens };
    },
  },

  morph: {
    label: 'Shape morph',
    hint: 'One shape that never cuts: a button you press, a loader, a tick, then a card with the result. Doing something and what it got',
    fields: { text: 'The button (a word or two)', sub: 'What it turns into (the result)' },
    example: { text: 'Post', sub: '+12,400 views' },
    seconds: () => 5,
    build: (f, { W, H, color }, len): Built => {
      const cy = r(H * 0.46);
      const card = Math.min(900, W - 120);
      return {
        background: 'dim',
        elements: [
          row(W, 'stage', cy - 260, 520),
          { id: 'shape', kind: 'box', parent: 'stage', style: { position: 'relative', width: 560, height: 170, 'border-radius': 85, background: color, 'box-shadow': '0 30px 80px rgba(0,0,0,.45)', 'flex-shrink': 0 } },
          { id: 'label', kind: 'text', parent: 'shape', text: plain(f.text), style: { position: 'absolute', inset: 0, ...centred, 'font-size': fit(f.text, 460, 76, 34), color: INK } },
          { id: 'ring', kind: 'box', parent: 'shape', style: { position: 'absolute', left: 35, top: 35, width: 120, height: 120, 'border-radius': '50%', border: '10px solid rgba(0,0,0,.18)', 'border-top': `10px solid ${INK}`, opacity: 0 } },
          { id: 'tick', kind: 'path', parent: 'shape', d: 'M58 98 L84 124 L132 70', draw: true, style: { stroke: INK, 'stroke-width': 14 } },
          { id: 'result', kind: 'text', parent: 'shape', text: plain(f.sub), style: { position: 'absolute', inset: 0, ...centred, padding: '0 40px', 'font-size': fit(f.sub, card - 80, 110, 40), color: INK, opacity: 0 } },
        ],
        tweens: [
          { targets: 'shape', at: 0, duration: 0.45, from: { scale: 0.6, opacity: 0 }, to: { scale: 1, opacity: 1 }, ease: 'back.out(1.6)' },
          { targets: 'shape', at: 0.9, duration: 0.1, to: { scale: 0.93 }, ease: 'power2.out', yoyo: true, repeat: 1, sound: 'tick' },
          { targets: 'label', at: 1.1, duration: 0.2, to: { opacity: 0, filter: 'blur(10px)' }, sound: 'none' },
          { targets: 'shape', at: 1.15, duration: 0.45, to: { width: 190, height: 190, borderRadius: 95 }, ease: 'expo.inOut' },
          { targets: 'ring', at: 1.45, duration: 0.25, from: { opacity: 0, scale: 0.5 }, to: { opacity: 1, scale: 1 }, ease: 'power3.out', sound: 'none' },
          { targets: 'ring', at: 1.45, duration: 1.3, from: { rotation: 0 }, to: { rotation: 540 }, ease: 'none' },
          { targets: 'ring', at: 2.6, duration: 0.15, to: { opacity: 0, scale: 0.6 }, sound: 'none' },
          { targets: 'tick', at: 2.7, duration: 0.35, from: { strokeDashoffset: 1 }, to: { strokeDashoffset: 0 }, ease: 'power2.out', sound: 'pop' },
          { targets: 'tick', at: 3.35, duration: 0.15, to: { opacity: 0 }, sound: 'none' },
          { targets: 'shape', at: 3.4, duration: 0.5, to: { width: card, height: 300, borderRadius: 48 }, ease: 'expo.inOut', sound: 'whoosh' },
          { targets: 'result', at: 3.65, duration: 0.35, from: { opacity: 0, filter: 'blur(12px)', scale: 0.9 }, to: { opacity: 1, filter: 'blur(0px)', scale: 1 }, ease: 'power3.out', sound: 'none' },
          exit(['stage'], len),
        ],
      };
    },
  },

  'cursor-click': {
    label: 'Cursor click',
    hint: 'A pointer glides in and clicks a button, and a confirmation drops in: sign up, book, buy, the action you want',
    fields: { text: 'The button', sub: 'What pops up after the click' },
    example: { text: 'Book a call', sub: 'Booked: Monday 10:00' },
    seconds: () => 4,
    build: (f, { W, H, color }, len): Built => {
      const cy = r(H * 0.46);
      const top = cy - 230;
      // The button's centre: the card's column is two bars and the button, centred in the card.
      const by = top + 290;
      return {
        background: 'dim',
        elements: [
          { id: 'card', kind: 'box', style: { left: r((W - 820) / 2), top, width: 820, height: 460, background: PANEL, 'border-radius': 40, border: EDGE, 'box-shadow': '0 40px 120px rgba(0,0,0,.5)', display: 'flex', 'flex-direction': 'column', 'align-items': 'center', 'justify-content': 'center', gap: 34 } },
          { id: 'bar1', kind: 'box', parent: 'card', style: { width: 520, height: 26, 'border-radius': 13, background: 'rgba(255,255,255,.14)' } },
          { id: 'bar2', kind: 'box', parent: 'card', style: { width: 380, height: 26, 'border-radius': 13, background: 'rgba(255,255,255,.08)' } },
          { id: 'button', kind: 'box', parent: 'card', style: { height: 130, padding: '0 64px', 'border-radius': 65, background: color, display: 'flex', 'align-items': 'center', 'flex-shrink': 0 } },
          { id: 'button-label', kind: 'text', parent: 'button', text: plain(f.text), style: { 'font-size': fit(f.text, 600, 58, 30), color: INK, 'white-space': 'nowrap' } },
          { id: 'ripple', kind: 'box', style: { left: r(W / 2) - 60, top: by - 60, width: 120, height: 120, 'border-radius': '50%', border: `6px solid ${color}`, opacity: 0 } },
          { id: 'toast', kind: 'box', style: { left: r((W - 780) / 2), top: r(H * 0.1), width: 780, height: 130, 'border-radius': 34, background: '#ffffff', display: 'flex', 'align-items': 'center', gap: 24, padding: '0 36px', 'box-shadow': '0 30px 80px rgba(0,0,0,.4)' } },
          { id: 'toast-dot', kind: 'box', parent: 'toast', style: { width: 48, height: 48, 'border-radius': '50%', background: color, 'flex-shrink': 0 } },
          { id: 'toast-text', kind: 'text', parent: 'toast', text: plain(f.sub), style: { 'font-size': fit(f.sub, 600, 46, 26, 0.58), 'font-family': 'Inter', 'font-weight': 700, color: INK, 'white-space': 'nowrap' } },
          { id: 'cursor', kind: 'path', d: 'M0 0 L0 99 L25 75 L43 115 L63 106 L45 68 L78 68 Z', style: { fill: '#ffffff', stroke: INK, 'stroke-width': 5, filter: 'drop-shadow(0 8px 12px rgba(0,0,0,.45))' } },
        ],
        tweens: [
          { targets: 'card', at: 0, duration: 0.5, from: { y: 60, opacity: 0, scale: 0.96 }, to: { y: 0, opacity: 1, scale: 1 }, ease: 'power3.out' },
          { targets: 'cursor', at: 0.25, duration: 1, from: { x: W - 120, y: r(H * 0.85), opacity: 0 }, to: { x: r(W / 2) + 40, y: by + 24, opacity: 1 }, ease: 'power3.inOut', sound: 'none' },
          { targets: 'button', at: 1.3, duration: 0.09, to: { scale: 0.92 }, yoyo: true, repeat: 1, ease: 'power2.out', sound: 'tick' },
          { targets: 'cursor', at: 1.3, duration: 0.09, to: { scale: 0.85 }, yoyo: true, repeat: 1, sound: 'none' },
          { targets: 'ripple', at: 1.36, duration: 0.6, from: { scale: 0.4 }, to: { scale: 2.8 }, ease: 'power2.out', sound: 'none' },
          { targets: 'ripple', at: 1.36, duration: 0.01, to: { opacity: 0.9 }, sound: 'none' },
          { targets: 'ripple', at: 1.4, duration: 0.55, to: { opacity: 0 }, sound: 'none' },
          { targets: 'toast', at: 1.6, duration: 0.55, from: { y: -260, opacity: 0 }, to: { y: 0, opacity: 1 }, ease: 'back.out(1.4)', sound: 'pop' },
          { targets: 'cursor', at: 2.2, duration: 0.9, to: { x: r(W * 0.7), y: by + 220 }, ease: 'power2.inOut', sound: 'none' },
          exit(['card', 'toast', 'cursor'], len),
        ],
      };
    },
  },

  island: {
    label: 'Phone island',
    hint: 'A black pill at the top grows into a live card with your line, then shrinks away: a win, an alert, a reminder',
    fields: { text: 'Title', sub: 'Detail (optional)' },
    example: { text: 'New sale', sub: '$49 · just now' },
    seconds: () => 3.6,
    build: (f, { W, H, color }, len): Built => {
      const wide = Math.min(940, W - 100);
      const words = [f.text, f.sub].filter(Boolean);
      return {
        background: 'none',
        elements: [
          row(W, 'stage', r(H * 0.07), 240, { 'align-items': 'flex-start' }),
          { id: 'pill', kind: 'box', parent: 'stage', style: { position: 'relative', width: 280, height: 84, 'border-radius': 42, background: '#000000', overflow: 'hidden', 'box-shadow': '0 20px 60px rgba(0,0,0,.5)', 'flex-shrink': 0 } },
          { id: 'icon', kind: 'box', parent: 'pill', style: { position: 'absolute', left: 34, top: 50, width: 100, height: 100, 'border-radius': '50%', background: color, border: '8px solid rgba(255,255,255,.3)' } },
          { id: 'title', kind: 'text', parent: 'pill', text: f.text, style: { position: 'absolute', left: 166, top: f.sub ? 46 : 70, right: 40, 'font-size': fit(f.text, wide - 220, 50, 30), 'font-family': 'Inter', 'font-weight': 800, 'white-space': 'nowrap' } },
          ...(f.sub ? [{ id: 'detail', kind: 'text' as const, parent: 'pill', text: plain(f.sub), style: { position: 'absolute', left: 166, top: 110, right: 40, 'font-size': fit(f.sub, wide - 220, 36, 24), 'font-family': 'Inter', 'font-weight': 600, color: 'rgba(255,255,255,.65)', 'white-space': 'nowrap' } }] : []),
        ],
        tweens: [
          { targets: 'pill', at: 0, duration: 0.3, from: { scale: 0.7, opacity: 0 }, to: { scale: 1, opacity: 1 }, ease: 'back.out(2)', sound: 'none' },
          { targets: 'pill', at: 0.35, duration: 0.6, to: { width: wide, height: 200, borderRadius: 60 }, ease: 'back.out(1.3)', sound: 'pop' },
          { targets: 'icon', at: 0.7, duration: 0.4, from: { scale: 0, opacity: 0 }, to: { scale: 1, opacity: 1 }, ease: 'back.out(2.2)', sound: 'none' },
          ...(words.length ? [{ targets: f.sub ? 'title,detail' : 'title', at: 0.75, duration: 0.4, from: { opacity: 0, x: -24, filter: 'blur(8px)' }, to: { opacity: 1, x: 0, filter: 'blur(0px)' }, stagger: 0.08, ease: 'power3.out', sound: 'none' as const }] : []),
          { targets: f.sub ? 'icon,title,detail' : 'icon,title', at: Math.max(1.4, len - 1), duration: 0.2, to: { opacity: 0 }, sound: 'none' },
          { targets: 'pill', at: Math.max(1.5, len - 0.85), duration: 0.45, to: { width: 280, height: 84, borderRadius: 42 }, ease: 'power3.inOut', sound: 'swish' },
          { targets: 'pill', at: Math.max(1.9, len - 0.35), duration: 0.3, to: { opacity: 0, scale: 0.7 }, sound: 'none' },
        ],
      };
    },
  },

  'growth-line': {
    label: 'Growth line',
    hint: 'A line chart that draws itself, a dot riding its tip, and the end value popping out: growth, a trend, a result over time',
    fields: { text: 'Title (optional)', sub: 'The end value (e.g. $12,400)', items: 'Points along the line, one number per line (3–10)' },
    example: { text: 'Monthly revenue', sub: '$12,400', items: ['300', '450', '400', '900', '1600', '2800', '5200', '12400'] },
    seconds: () => 4.5,
    build: (f, { W, H, color }, len): Built => {
      const parsed = f.items.map((v) => parseFloat(v.replace(/[^0-9.-]/g, ''))).filter((v) => Number.isFinite(v)).slice(0, 10);
      const vals = parsed.length >= 2 ? parsed : [1, 2, 3, 5, 8];
      const cy = r(H * 0.48);
      const half = Math.min(260, r(H * 0.2));
      const [x0, x1, yTop, yBot] = [110, W - 110, cy - half, cy + half];
      const lo = Math.min(0, ...vals);
      const hi = Math.max(...vals);
      const pts = vals.map((v, i) => ({ x: r(x0 + (i * (x1 - x0)) / (vals.length - 1)), y: r(yBot - ((v - lo) / (hi - lo || 1)) * (yBot - yTop)) }));
      let d = `M${pts[0].x} ${pts[0].y}`;
      for (let i = 1; i < pts.length; i++) {
        const [a, b] = [pts[i - 1], pts[i]];
        const mx = r((a.x + b.x) / 2);
        d += ` C${mx} ${a.y} ${mx} ${b.y} ${b.x} ${b.y}`;
      }
      const end = pts[pts.length - 1];
      const D = clamp(len - 2.2, 1.2, 2.6);
      // Small whole numbers count up; anything with separators or decimals just appears.
      const m = /^(.*?)(\d[\d,]*(?:\.\d+)?)(.*)$/.exec(plain(f.sub));
      const count = m && !/[,.]/.test(m[2]) && Number(m[2]) <= 99999 ? { pre: m[1], value: Number(m[2]), post: m[3] } : null;
      const tipSize = fit(f.sub || '0', 520, 64, 36, 0.62);
      const tip: El[] = count
        ? [
            ...(count.pre ? [{ id: 'tip-pre', kind: 'text' as const, parent: 'tip', text: count.pre, style: { 'font-size': tipSize, color: INK } }] : []),
            { id: 'tip-num', kind: 'text', parent: 'tip', text: String(count.value), style: { 'font-size': tipSize, color: INK, 'font-variant-numeric': 'tabular-nums' } },
            ...(count.post ? [{ id: 'tip-post', kind: 'text' as const, parent: 'tip', text: count.post, style: { 'font-size': tipSize, color: INK } }] : []),
          ]
        : [{ id: 'tip-text', kind: 'text', parent: 'tip', text: plain(f.sub), style: { 'font-size': tipSize, color: INK, 'white-space': 'nowrap' } }];
      const grid = [0, 1, 2].map((k) => ({ id: `g${k}`, kind: 'box' as const, style: { left: x0, top: r(yTop + (k * (yBot - yTop)) / 3), width: x1 - x0, height: 2, background: 'rgba(255,255,255,.1)', 'transform-origin': 'left center' } }));
      return {
        background: 'dim',
        elements: [
          ...(f.text ? [{ id: 'title', kind: 'text' as const, text: f.text, style: { left: 60, width: W - 120, top: yTop - 190, 'text-align': 'center', 'font-size': fit(f.text, W - 120, 64, 36) } }] : []),
          ...grid,
          { id: 'base', kind: 'box', style: { left: x0, top: yBot, width: x1 - x0, height: 3, background: 'rgba(255,255,255,.35)', 'transform-origin': 'left center' } },
          { id: 'area', kind: 'path', d: `${d} L${x1} ${yBot} L${x0} ${yBot} Z`, style: { fill: color, 'fill-opacity': 0.16, stroke: 'none', opacity: 0 } },
          { id: 'line', kind: 'path', d, draw: true, style: { stroke: color, 'stroke-width': 10 } },
          { id: 'dot', kind: 'box', style: { left: 0, top: 0, width: 38, height: 38, 'border-radius': '50%', background: color, border: '7px solid #ffffff', opacity: 0 } },
          { id: 'tip-anchor', kind: 'box', style: { left: end.x - 600, top: Math.max(yTop - 120, end.y - 150), width: 600, height: 110, display: 'flex', 'justify-content': 'flex-end', 'align-items': 'flex-end' } },
          { id: 'tip', kind: 'box', parent: 'tip-anchor', style: { display: 'flex', 'align-items': 'center', padding: '10px 28px', 'border-radius': 22, background: color, 'transform-origin': 'right bottom', 'box-shadow': '0 16px 40px rgba(0,0,0,.4)' } },
          ...tip,
        ],
        tweens: [
          ...(f.text ? [{ targets: 'title', at: 0, duration: 0.45, from: { opacity: 0, y: 30 }, to: { opacity: 1, y: 0 }, ease: 'power3.out' }] : []),
          { targets: 'g0,g1,g2,base', at: 0.1, duration: 0.6, from: { scaleX: 0 }, to: { scaleX: 1 }, stagger: 0.08, ease: 'expo.out', sound: 'none' },
          { targets: 'line', at: 0.45, duration: D, from: { strokeDashoffset: 1 }, to: { strokeDashoffset: 0 }, ease: 'power1.inOut', sound: 'whoosh' },
          { targets: 'dot', at: 0.45, duration: 0.2, from: { opacity: 0, xPercent: -50, yPercent: -50, scale: 0.5 }, to: { opacity: 1, xPercent: -50, yPercent: -50, scale: 1 }, sound: 'none' },
          { targets: 'dot', at: 0.45, duration: D, to: { motionPath: d }, ease: 'power1.inOut', sound: 'none' },
          { targets: 'area', at: 0.45 + D * 0.5, duration: D * 0.6, to: { opacity: 1 }, sound: 'none' },
          { targets: 'tip', at: 0.45 + D, duration: 0.45, from: { scale: 0.4, opacity: 0 }, to: { scale: 1, opacity: 1 }, ease: 'back.out(2)' },
          ...(count ? [{ targets: 'tip-num', at: 0.45 + D, duration: 0.7, from: { innerText: 0 }, to: { innerText: count.value }, ease: 'power2.out', sound: 'none' as const }] : []),
          exit(['title', 'g0', 'g1', 'g2', 'base', 'area', 'line', 'dot', 'tip-anchor'].filter((id) => id !== 'title' || f.text), len),
        ],
      };
    },
  },

  orbit: {
    label: 'Orbit',
    hint: 'One idea in the middle and what feeds it circling around on a ring: the parts of a system, what a habit touches',
    fields: { text: 'In the middle', items: 'Around it, one per line (3–6)' },
    example: { text: 'Discipline', items: ['Sleep', 'Prayer', 'Training', 'Reading', 'Work'] },
    seconds: () => 5,
    build: (f, { W, H, color }, len): Built => {
      const around = items(f, 1, 6);
      const cx = r(W / 2);
      const cy = r(H * 0.46);
      const R = r(Math.min(330, H * 0.3 - 50));
      const elements: El[] = [
        { id: 'ring', kind: 'box', style: { left: cx - R, top: cy - R, width: 2 * R, height: 2 * R, 'border-radius': '50%', border: '3px dashed rgba(255,255,255,.22)' } },
        { id: 'spin', kind: 'box', style: { left: cx - R, top: cy - R, width: 2 * R, height: 2 * R } },
      ];
      around.forEach((_, k) => {
        const a = ((-90 + (k * 360) / around.length) * Math.PI) / 180;
        const [c, s] = [Math.cos(a), Math.sin(a)];
        elements.push({ id: `s${k}`, kind: 'path', parent: 'spin', d: `M${r(R + 160 * c)} ${r(R + 160 * s)} L${r(R + (R - 70) * c)} ${r(R + (R - 70) * s)}`, draw: true, style: { stroke: 'rgba(255,255,255,.35)', 'stroke-width': 4 } });
      });
      around.forEach((t, k) => {
        const a = ((-90 + (k * 360) / around.length) * Math.PI) / 180;
        elements.push({ id: `a${k}`, kind: 'box', parent: 'spin', style: { position: 'absolute', left: r(R + R * Math.cos(a)), top: r(R + R * Math.sin(a)), width: 0, height: 0, display: 'flex', 'align-items': 'center', 'justify-content': 'center' } });
        elements.push({ id: `p${k}`, kind: 'text', parent: `a${k}`, text: t, style: { padding: '16px 30px', 'border-radius': 999, background: PANEL, border: EDGE, 'font-size': fit(t, 300, 44, 28), 'font-weight': 700, 'white-space': 'nowrap', 'flex-shrink': 0 } });
      });
      elements.push({ id: 'core', kind: 'box', style: { left: cx - 150, top: cy - 150, width: 300, height: 300, 'border-radius': '50%', background: color, ...centred, 'box-shadow': '0 0 0 18px rgba(255,255,255,.06)' } });
      elements.push({ id: 'core-text', kind: 'text', parent: 'core', text: plain(f.text), style: { 'font-size': fitWrap(f.text, 250, 2, 60, 28, 0.6), color: INK, 'text-align': 'center', 'line-height': 1.05, padding: '0 20px' } });
      const ids = (p: string) => around.map((_, k) => `${p}${k}`).join(',');
      return {
        background: 'dim',
        elements,
        tweens: [
          { targets: 'core', at: 0, duration: 0.55, from: { scale: 0, opacity: 0 }, to: { scale: 1, opacity: 1 }, ease: 'back.out(1.7)' },
          { targets: 'ring', at: 0.2, duration: 0.7, from: { scale: 0.7, opacity: 0 }, to: { scale: 1, opacity: 1 }, ease: 'expo.out', sound: 'none' },
          ...(around.length
            ? [
                { targets: ids('s'), at: 0.5, duration: 0.35, from: { strokeDashoffset: 1 }, to: { strokeDashoffset: 0 }, stagger: 0.14, sound: 'none' as const },
                { targets: ids('p'), at: 0.6, duration: 0.45, from: { scale: 0, opacity: 0 }, to: { scale: 1, opacity: 1 }, stagger: 0.14, ease: 'back.out(2)' },
                // The ring turns slowly; its labels turn back so they stay upright.
                { targets: 'spin', at: 0, duration: len, from: { rotation: 0 }, to: { rotation: 36 }, ease: 'none' },
                { targets: ids('a'), at: 0, duration: len, from: { rotation: 0 }, to: { rotation: -36 }, ease: 'none' },
              ]
            : []),
          exit(['ring', 'spin', 'core'], len),
        ],
      };
    },
  },

  flow: {
    label: 'Flow',
    hint: 'Steps as boxes joined by lines that draw in turn, a dot travelling down them: a process, a funnel, cause and effect',
    fields: { text: 'Heading (optional)', items: 'Steps in order, one per line (2–5)' },
    example: { text: 'How a sale happens', items: ['Post', 'They save it', 'They follow', 'They buy'] },
    seconds: (f) => 1.5 + clamp(f.items.length, 2, 5),
    build: (f, { W, H, color }, len): Built => {
      const steps = items(f, 1, 5);
      const n = steps.length;
      const avail = H * 0.6;
      const gap = n > 1 ? Math.min(80, r((avail * 0.25) / (n - 1))) : 0;
      const nodeH = r(Math.min(140, (avail - gap * (n - 1)) / Math.max(1, n)));
      const head = f.text ? r(nodeH * 0.6) + 50 : 0;
      const total = n * nodeH + (n - 1) * gap + head;
      const first = r(H * 0.47 - total / 2) + head;
      const top = (i: number) => first + i * (nodeH + gap);
      const step = clamp((len - 1.3) / Math.max(1, n), 0.6, 1.6);
      const t = (i: number) => 0.25 + i * step;
      const elements: El[] = [];
      const tweens: SceneTween[] = [];
      if (f.text) {
        elements.push({ id: 'head', kind: 'text', text: f.text, style: { left: 60, width: W - 120, top: first - head, 'text-align': 'center', 'font-size': fit(f.text, W - 120, r(nodeH * 0.5), 34) } });
        tweens.push({ targets: 'head', at: 0, duration: 0.45, from: { opacity: 0, y: 30 }, to: { opacity: 1, y: 0 }, ease: 'power3.out' });
      }
      steps.forEach((s, i) => {
        elements.push({ id: `n${i}`, kind: 'box', style: { left: r((W - 760) / 2), top: top(i), width: 760, height: nodeH, 'border-radius': 30, background: PANEL, border: '3px solid rgba(255,255,255,.12)', display: 'flex', 'align-items': 'center', gap: 26, padding: '0 36px' } });
        elements.push({ id: `b${i}`, kind: 'text', parent: `n${i}`, text: String(i + 1), style: { width: r(nodeH * 0.5), height: r(nodeH * 0.5), 'border-radius': '50%', background: color, color: INK, ...centred, 'font-size': r(nodeH * 0.27), 'flex-shrink': 0 } });
        elements.push({ id: `t${i}`, kind: 'text', parent: `n${i}`, text: s, style: { 'font-size': fit(s, 560, r(nodeH * 0.36), 26), 'font-weight': 700, 'white-space': 'nowrap' } });
        tweens.push({ targets: `n${i}`, at: t(i), duration: 0.45, from: { scale: 0.6, opacity: 0 }, to: { scale: 1, opacity: 1 }, ease: 'back.out(1.8)', sound: 'pop' });
        tweens.push({ targets: `n${i}`, at: t(i) + 0.1, duration: 0.25, to: { borderColor: color }, sound: 'none' });
      });
      for (let i = 0; i + 1 < n; i++) {
        const d = `M${r(W / 2)} ${top(i) + nodeH + 6} L${r(W / 2)} ${top(i + 1) - 6}`;
        elements.push({ id: `c${i}`, kind: 'path', d, draw: true, style: { stroke: color, 'stroke-width': 6 } });
        tweens.push({ targets: `c${i}`, at: t(i + 1) - 0.4, duration: 0.4, from: { strokeDashoffset: 1 }, to: { strokeDashoffset: 0 }, ease: 'power1.inOut', sound: 'none' });
        tweens.push({ targets: 'dot', at: t(i + 1) - 0.4, duration: 0.4, to: { motionPath: d }, ease: 'power1.inOut', sound: 'none' });
      }
      if (n > 1) {
        elements.push({ id: 'dot', kind: 'box', style: { left: 0, top: 0, width: 26, height: 26, 'border-radius': '50%', background: '#ffffff', 'box-shadow': `0 0 24px ${color}`, opacity: 0 } });
        tweens.push({ targets: 'dot', at: t(1) - 0.42, duration: 0.1, from: { opacity: 0, xPercent: -50, yPercent: -50 }, to: { opacity: 1, xPercent: -50, yPercent: -50 }, sound: 'none' });
        tweens.push({ targets: 'dot', at: t(n - 1) + 0.05, duration: 0.2, to: { opacity: 0 }, sound: 'none' });
      }
      tweens.push(exit([...(f.text ? ['head'] : []), ...steps.map((_, i) => `n${i}`), ...steps.slice(1).map((_, i) => `c${i}`)], len));
      return { background: 'dim', elements, tweens };
    },
  },

  'card-deck': {
    label: 'Card deck',
    hint: 'Cards stacked in depth that flip away one by one to the next point: tips, reasons, rules, a countdown',
    fields: { text: 'Heading (optional)', items: 'One card per line (2–5)' },
    example: { text: '3 habits', items: ['Wake before *Fajr*', 'One hard task first', 'Walk after *Isha*'] },
    seconds: (f) => 2.4 + 1.1 * (clamp(f.items.length, 2, 5) - 1),
    build: (f, { W, H, color }, len): Built => {
      const cards = items(f, 1, 5);
      const n = cards.length;
      const ch = Math.min(520, r(H * 0.27));
      const cy = r(H * 0.5);
      const y = (p: number) => -p * 42;
      const scale = (p: number) => 1 - p * 0.07;
      const fade = (p: number) => (p > 2 ? 0 : 1 - p * 0.22);
      const step = n > 1 ? Math.max(0.9, (len - 2.4) / (n - 1)) : 0;
      const elements: El[] = [];
      const tweens: SceneTween[] = [];
      if (f.text) {
        elements.push({ id: 'head', kind: 'text', text: f.text, style: { left: 60, width: W - 120, top: cy - r(ch / 2) - 210, 'text-align': 'center', 'font-size': fit(f.text, W - 120, 72, 36) } });
        tweens.push({ targets: 'head', at: 0, duration: 0.45, from: { opacity: 0, y: 30 }, to: { opacity: 1, y: 0 }, ease: 'power3.out' });
      }
      // The first card is on top, so it comes last in the page.
      for (let j = n - 1; j >= 0; j--) {
        elements.push({ id: `k${j}`, kind: 'box', style: { left: r((W - 820) / 2), top: cy - r(ch / 2), width: 820, height: ch, 'border-radius': 44, background: PANEL, border: '2px solid rgba(255,255,255,.1)', 'box-shadow': '0 30px 80px rgba(0,0,0,.5)', padding: '56px 64px', display: 'flex', 'flex-direction': 'column', 'justify-content': 'center', gap: 22, overflow: 'hidden' } });
        elements.push({ id: `k${j}-bar`, kind: 'box', parent: `k${j}`, style: { position: 'absolute', left: 0, top: 0, width: '100%', height: 12, background: color } });
        elements.push({ id: `k${j}-num`, kind: 'text', parent: `k${j}`, text: `${String(j + 1).padStart(2, '0')} / ${String(n).padStart(2, '0')}`, style: { 'font-size': 28, 'font-family': 'JetBrains Mono', 'font-weight': 500, color: 'rgba(255,255,255,.5)' } });
        elements.push({ id: `k${j}-text`, kind: 'text', parent: `k${j}`, text: cards[j], style: { 'font-size': fitWrap(cards[j], 690, 2, r(ch * 0.17), 40, 0.58), 'line-height': 1.1 } });
        tweens.push({ targets: `k${j}`, at: 0.1 + (n - 1 - j) * 0.07, duration: 0.6, from: { y: r(H * 0.5), opacity: 0, rotation: j % 2 ? 5 : -5, scale: scale(j) }, to: { y: y(j), opacity: fade(j), rotation: 0, scale: scale(j) }, ease: 'expo.out', sound: j === n - 1 ? 'whoosh' : 'none' });
      }
      for (let k = 0; k + 1 < n; k++) {
        const at = 1.2 + k * step;
        tweens.push({ targets: `k${k}`, at, duration: 0.5, to: { y: -r(H * 0.3), rotationX: 70, opacity: 0, transformPerspective: 1400 }, ease: 'power2.in' });
        for (let j = k + 1; j < n; j++) tweens.push({ targets: `k${j}`, at: at + 0.12, duration: 0.5, to: { y: y(j - k - 1), scale: scale(j - k - 1), opacity: fade(j - k - 1) }, ease: 'power3.out', sound: 'none' });
      }
      tweens.push(exit([...(f.text ? ['head'] : []), ...cards.map((_, j) => `k${j}`)], len));
      return { background: 'dim', elements, tweens };
    },
  },

  odometer: {
    label: 'Rolling number',
    hint: 'A number whose digits roll into place like a counter, then lands with a hit: a total, a price, a year, a milestone',
    fields: { text: 'The number (e.g. 1,000,000, $49, 2026)', sub: 'What it is' },
    example: { text: '1,000,000', sub: 'views in 30 days' },
    seconds: () => 3,
    build: (f, { W, H, color }, len): Built => {
      const chars = [...plain(f.text).trim()].slice(0, 12);
      const s = fit(chars.join(''), 960, 240, 80, 0.68);
      const lh = r(s * 1.1);
      const cw = r(s * 0.7);
      const cy = r(H * 0.45);
      const elements: El[] = [row(W, 'num', cy - r(lh / 2), lh, { 'align-items': 'flex-start', 'mask-image': 'linear-gradient(180deg, transparent 0%, #000 18%, #000 82%, transparent 100%)', '-webkit-mask-image': 'linear-gradient(180deg, transparent 0%, #000 18%, #000 82%, transparent 100%)' })];
      const tweens: SceneTween[] = [];
      const font = { 'font-size': s, 'line-height': `${lh}px`, 'font-family': 'Montserrat', 'font-weight': 900, color, 'font-variant-numeric': 'tabular-nums' };
      const digits = chars.filter((c) => /\d/.test(c)).length;
      let k = 0;
      chars.forEach((c, i) => {
        if (!/\d/.test(c)) {
          elements.push({ id: `c${i}`, kind: 'text', parent: 'num', text: c, style: { ...font, height: lh, 'white-space': 'pre', 'flex-shrink': 0 } });
          return;
        }
        const d = Number(c);
        elements.push({ id: `c${i}`, kind: 'box', parent: 'num', style: { position: 'relative', width: cw, height: lh, overflow: 'hidden', 'flex-shrink': 0 } });
        // A strip of digits rolls up: once round, then on to its own.
        elements.push({ id: `r${i}`, kind: 'text', parent: `c${i}`, text: [...Array.from({ length: 10 }, (_, x) => x), ...Array.from({ length: d + 1 }, (_, x) => x)].join('\n'), style: { ...font, position: 'absolute', left: 0, top: 0, width: cw, 'text-align': 'center' } });
        tweens.push({ targets: `r${i}`, at: 0.15, duration: 0.9 + k * 0.14, from: { y: 0 }, to: { y: -(10 + d) * lh }, ease: 'power3.out', sound: k === 0 ? 'whoosh' : 'none' });
        k++;
      });
      const land = 0.15 + 0.9 + Math.max(0, digits - 1) * 0.14;
      if (digits) tweens.push({ targets: 'num', at: land, duration: 0.1, to: { scale: 1.05 }, yoyo: true, repeat: 1, sound: 'hit' });
      if (f.sub) {
        elements.push({ id: 'sub', kind: 'text', text: f.sub, style: { left: 60, width: W - 120, top: cy + r(lh / 2) + 20, 'text-align': 'center', 'font-size': fit(f.sub, W - 120, 56, 30), 'font-weight': 700 } });
        tweens.push({ targets: 'sub', at: land, duration: 0.45, from: { opacity: 0, y: 24 }, to: { opacity: 1, y: 0 }, ease: 'power3.out', sound: 'none' });
      }
      tweens.push(exit(f.sub ? ['num', 'sub'] : ['num'], len));
      return { background: 'dim', elements, tweens };
    },
  },

  iris: {
    label: 'Iris reveal',
    hint: 'A circle opens from the middle and reveals the next line in the accent colour: the turn, the answer, a new part',
    fields: { text: 'Before the turn', sub: 'What the circle reveals' },
    example: { text: 'Everyone said *wait*', sub: 'So I started' },
    seconds: () => 3.4,
    build: (f, { W, H, color }): Built => {
      const cy = r(H * 0.46);
      const at = `50% ${r((cy / H) * 100)}%`;
      return {
        background: DARK,
        elements: [
          row(W, 'first-row', cy - 200, 400),
          { id: 'first', kind: 'text', parent: 'first-row', text: f.text, split: 'words', style: { 'font-size': fitWrap(f.text, 940, 2, 120, 48, 0.62), 'text-align': 'center', padding: '0 70px', 'line-height': 1.1 } },
          { id: 'ring', kind: 'box', style: { left: r(W / 2) - 100, top: cy - 100, width: 200, height: 200, 'border-radius': '50%', border: '6px solid #ffffff', opacity: 0 } },
          { id: 'panel', kind: 'box', style: { left: 0, top: 0, width: W, height: H, background: color, 'clip-path': `circle(0% at ${at})`, ...centred } },
          { id: 'second', kind: 'text', parent: 'panel', text: plain(f.sub), style: { 'font-size': fitWrap(f.sub, 940, 2, 140, 48, 0.62), 'font-weight': 900, color: INK, padding: '0 70px', 'line-height': 1.05 } },
        ],
        tweens: [
          { targets: 'first.words', at: 0, duration: 0.45, from: { opacity: 0, y: 40 }, to: { opacity: 1, y: 0 }, stagger: 0.06, ease: 'power3.out' },
          { targets: 'first', at: 1.3, duration: 0.5, to: { scale: 0.9, opacity: 0.4 }, ease: 'power2.in', sound: 'none' },
          { targets: 'ring', at: 1.3, duration: 0.5, from: { scale: 0.2 }, to: { scale: 1.6 }, ease: 'power2.out', sound: 'none' },
          { targets: 'ring', at: 1.3, duration: 0.01, to: { opacity: 1 }, sound: 'none' },
          { targets: 'ring', at: 1.4, duration: 0.4, to: { opacity: 0 }, sound: 'none' },
          { targets: 'panel', at: 1.45, duration: 0.8, from: { clipPath: `circle(0% at ${at})` }, to: { clipPath: `circle(140% at ${at})` }, ease: 'expo.inOut', sound: 'whoosh' },
          { targets: 'second', at: 1.85, duration: 0.5, from: { scale: 0.85, opacity: 0, y: 30 }, to: { scale: 1, opacity: 1, y: 0 }, ease: 'power3.out', sound: 'none' },
        ],
      };
    },
  },

  wipe: {
    label: 'Before / after wipe',
    hint: 'A bright line sweeps across and wipes the old way into the new: before and after, myth and truth, them and you',
    fields: { text: 'Before', sub: 'After', items: 'Their labels (optional): two lines, e.g. Before / After' },
    example: { text: 'Posting *whatever*', sub: 'Posting with a plan', items: ['Before', 'After'] },
    seconds: () => 3.5,
    build: (f, { W, H, color }): Built => {
      const [tagA, tagB] = [f.items[0] || 'Before', f.items[1] || 'After'];
      const panel = { left: 0, top: 0, width: W, height: H, display: 'flex', 'flex-direction': 'column', 'align-items': 'center', 'justify-content': 'center', gap: 30, padding: '0 80px', 'text-align': 'center' };
      const tag = { 'font-size': 30, 'font-family': 'JetBrains Mono', 'font-weight': 600, 'letter-spacing': 8, 'text-transform': 'uppercase' };
      return {
        background: DARK,
        elements: [
          { id: 'before', kind: 'box', style: { ...panel, background: '#17181d' } },
          { id: 'before-tag', kind: 'text', parent: 'before', text: plain(tagA), style: { ...tag, color: 'rgba(255,255,255,.5)' } },
          { id: 'before-text', kind: 'text', parent: 'before', text: f.text, style: { 'font-size': fitWrap(f.text, 920, 2, 130, 48, 0.62), 'line-height': 1.08 } },
          { id: 'after', kind: 'box', style: { ...panel, background: color, 'clip-path': 'inset(0% 100% 0% 0%)' } },
          { id: 'after-tag', kind: 'text', parent: 'after', text: plain(tagB), style: { ...tag, color: 'rgba(0,0,0,.55)' } },
          { id: 'after-text', kind: 'text', parent: 'after', text: plain(f.sub), style: { 'font-size': fitWrap(f.sub, 920, 2, 130, 48, 0.62), 'font-weight': 900, color: INK, 'line-height': 1.08 } },
          { id: 'bar', kind: 'box', style: { left: -7, top: 0, width: 14, height: H, background: '#ffffff', 'box-shadow': '0 0 50px rgba(255,255,255,.7)' } },
        ],
        tweens: [
          { targets: 'before-tag', at: 0, duration: 0.4, from: { opacity: 0 }, to: { opacity: 1 }, sound: 'none' },
          { targets: 'before-text', at: 0.05, duration: 0.5, from: { opacity: 0, y: 40 }, to: { opacity: 1, y: 0 }, ease: 'power3.out' },
          { targets: 'after', at: 1.4, duration: 0.75, from: { clipPath: 'inset(0% 100% 0% 0%)' }, to: { clipPath: 'inset(0% 0% 0% 0%)' }, ease: 'expo.inOut', sound: 'whoosh' },
          { targets: 'bar', at: 1.4, duration: 0.75, from: { x: -90 }, to: { x: W + 60 }, ease: 'expo.inOut', sound: 'none' },
          { targets: 'after-text', at: 1.4, duration: 1.1, from: { scale: 1.08 }, to: { scale: 1 }, ease: 'power3.out', sound: 'none' },
        ],
      };
    },
  },

  'fly-through': {
    label: 'Fly through',
    hint: 'A huge word the camera flies into, through its letters, out onto the next line: a hard turn, a new chapter',
    fields: { text: 'The big word', sub: 'What’s on the other side' },
    example: { text: 'Next', sub: 'Part two' },
    seconds: () => 3,
    build: (f, { W, H, color }): Built => {
      const cy = r(H * 0.46);
      // The camera flies into the middle letter (through its stroke, or its hole), not the gap between two.
      const word = plain(f.text).trim();
      const aim = r(((Math.floor(word.length / 2) + 0.5) / Math.max(1, word.length)) * 100);
      return {
        background: DARK,
        elements: [
          row(W, 'word-row', cy - 300, 600),
          { id: 'word', kind: 'text', parent: 'word-row', text: word, style: { 'font-size': fit(f.text, 960, 460, 140, 0.45), 'font-family': 'Anton', 'font-weight': 400, 'text-transform': 'uppercase', 'line-height': 1, color, 'white-space': 'nowrap', 'transform-origin': `${aim}% 52%` } },
          { id: 'panel', kind: 'box', style: { left: 0, top: 0, width: W, height: H, background: color, opacity: 0 } },
          row(W, 'sub-row', cy - 300, 600),
          { id: 'sub', kind: 'text', parent: 'sub-row', text: plain(f.sub), style: { 'font-size': fitWrap(f.sub, 920, 2, 150, 50, 0.62), 'font-weight': 900, color: INK, 'text-align': 'center', padding: '0 80px', 'line-height': 1.05 } },
        ],
        tweens: [
          { targets: 'word', at: 0, duration: 0.45, from: { scale: 0.75, opacity: 0 }, to: { scale: 1, opacity: 1 }, ease: 'power3.out', sound: 'thud' },
          { targets: 'word', at: 0.95, duration: 0.6, to: { scale: 30 }, ease: 'expo.in', sound: 'whoosh' },
          { targets: 'panel', at: 1.5, duration: 0.01, to: { opacity: 1 }, sound: 'none' },
          { targets: 'word', at: 1.52, duration: 0.01, to: { opacity: 0 }, sound: 'none' },
          { targets: 'sub', at: 1.55, duration: 0.5, from: { scale: 1.5, opacity: 0 }, to: { scale: 1, opacity: 1 }, ease: 'power4.out', sound: 'hit' },
        ],
      };
    },
  },

  shatter: {
    label: 'Shards',
    hint: 'A word that flies in as sharp shards and locks together with a hit: a name, a reveal, a big claim',
    fields: { text: 'The word or short phrase' },
    example: { text: 'Halal *income*' },
    seconds: () => 3,
    build: (f, { W, H }, len): Built => {
      const s = fit(f.text, 960, 220, 80, 0.62);
      const lines = Math.max(1, Math.ceil((plain(f.text).length * 0.62 * s) / 960));
      const h = r(s * 1.1 * lines + 40);
      const box = { left: 60, width: W - 120, top: r(H * 0.46 - h / 2), height: h, 'padding-top': 20, 'text-align': 'center', 'font-size': s, 'font-weight': 900, 'line-height': 1.1 };
      // Ten triangles that tile the word's box, fanned from a point just off its centre.
      const rim = [[0, 0], [30, 0], [62, 0], [100, 0], [100, 40], [100, 100], [70, 100], [38, 100], [0, 100], [0, 55]];
      const dx = [-420, 380, -260, 300, 460, -380, 240, -300, 120, -150];
      const dy = [-520, -380, 460, 520, -200, 260, -460, 380, 600, -600];
      const turn = [-50, 40, -30, 60, -70, 35, -45, 25, 80, -60];
      const shards: El[] = rim.map(([x, y], i) => {
        const [nx, ny] = rim[(i + 1) % rim.length];
        return { id: `f${i}`, kind: 'text', text: f.text, style: { ...box, 'clip-path': `polygon(52% 48%, ${x}% ${y}%, ${nx}% ${ny}%)` } };
      });
      return {
        background: 'dim',
        elements: [...shards, { id: 'whole', kind: 'text', text: f.text, style: { ...box, opacity: 0 } }],
        tweens: [
          ...shards.map((_, i): SceneTween => ({ targets: `f${i}`, at: i * 0.04, duration: 0.75, from: { x: dx[i], y: dy[i], rotation: turn[i], opacity: 0 }, to: { x: 0, y: 0, rotation: 0, opacity: 1 }, ease: 'expo.out', sound: i ? 'none' : 'whoosh' })),
          { targets: 'whole', at: 1.1, duration: 0.3, from: { opacity: 0, scale: 1.06 }, to: { opacity: 1, scale: 1 }, ease: 'power3.out', sound: 'hit' },
          { targets: shards.map((e) => e.id).join(','), at: 1.12, duration: 0.05, to: { opacity: 0 }, sound: 'none' },
          exit(['whole'], len),
        ],
      };
    },
  },

  'shine-title': {
    label: 'Shine title',
    hint: 'A clean title that comes into focus as a sheen of light slides across it, a line settling under it: an opener, a brand line',
    fields: { text: 'Title', sub: 'Line under it (optional)' },
    example: { text: 'The halal way to scale', sub: 'A 60-second guide' },
    seconds: () => 3,
    build: (f, { W, H, color }, len): Built => {
      const cy = r(H * 0.45);
      return {
        background: 'dim',
        elements: [
          row(W, 'title-row', cy - 220, 400),
          {
            id: 'title',
            kind: 'text',
            parent: 'title-row',
            text: plain(f.text),
            style: {
              'font-size': fitWrap(f.text, 940, 2, 150, 56, 0.62),
              'font-weight': 900,
              'line-height': 1.05,
              'text-align': 'center',
              padding: '0 70px',
              'background-image': `linear-gradient(100deg, #ffffff 0%, #ffffff 40%, ${color} 50%, #ffffff 60%, #ffffff 100%)`,
              'background-size': '250% 100%',
              'background-position': '100% 0%',
              '-webkit-background-clip': 'text',
              'background-clip': 'text',
              '-webkit-text-fill-color': 'transparent',
            },
          },
          { id: 'rule', kind: 'box', style: { left: r(W / 2) - 120, top: cy + 200, width: 240, height: 8, 'border-radius': 4, background: color } },
          ...(f.sub ? [{ id: 'sub', kind: 'text' as const, text: f.sub, style: { left: 60, width: W - 120, top: cy + 240, 'text-align': 'center', 'font-size': fit(f.sub, W - 120, 46, 28), 'font-family': 'Inter', 'font-weight': 600, color: 'rgba(255,255,255,.82)' } }] : []),
        ],
        tweens: [
          { targets: 'title', at: 0, duration: 0.9, from: { opacity: 0, letterSpacing: '24px', filter: 'blur(14px)' }, to: { opacity: 1, letterSpacing: '0px', filter: 'blur(0px)' }, ease: 'expo.out', sound: 'focus' },
          { targets: 'title', at: 0.6, duration: 1.5, from: { backgroundPosition: '100% 0%' }, to: { backgroundPosition: '0% 0%' }, ease: 'power2.inOut', sound: 'none' },
          { targets: 'rule', at: 0.8, duration: 0.6, from: { scaleX: 0 }, to: { scaleX: 1 }, ease: 'expo.out', sound: 'none' },
          ...(f.sub ? [{ targets: 'sub', at: 1, duration: 0.5, from: { opacity: 0, y: 20 }, to: { opacity: 1, y: 0 }, ease: 'power3.out', sound: 'none' as const }] : []),
          exit(['title-row', 'rule', ...(f.sub ? ['sub'] : [])], len),
        ],
      };
    },
  },

  burst: {
    label: 'Burst',
    hint: 'A word or number slams in and throws out a burst of sparks: a win, a launch, a milestone',
    fields: { text: 'The word or number', sub: 'A line under it (optional)' },
    example: { text: '10K', sub: 'followers' },
    seconds: () => 2.5,
    build: (f, { W, H, color }, len): Built => {
      const cx = r(W / 2);
      const cy = r(H * 0.45);
      const s = fit(f.text, 900, 300, 100, 0.66);
      const sparks: El[] = Array.from({ length: 16 }, (_, i) => {
        const [w, h] = i % 2 ? [14, 48] : [24, 24];
        return { id: `x${i}`, kind: 'box', style: { left: cx - w / 2, top: cy - h / 2, width: w, height: h, 'border-radius': i % 2 ? 7 : 5, background: i % 4 < 2 ? color : '#ffffff', rotate: `${r(i * 22.5 + 90)}deg`, opacity: 0 } };
      });
      return {
        background: 'dim',
        elements: [
          { id: 'shock', kind: 'box', style: { left: cx - 100, top: cy - 100, width: 200, height: 200, 'border-radius': '50%', border: `8px solid ${color}`, opacity: 0 } },
          ...sparks,
          row(W, 'core-row', cy - r(s * 0.7), r(s * 1.4)),
          { id: 'core', kind: 'text', parent: 'core-row', text: f.text, style: { 'font-size': s, 'font-weight': 900, 'line-height': 1, 'white-space': 'nowrap' } },
          ...(f.sub ? [{ id: 'sub', kind: 'text' as const, text: f.sub, style: { left: 60, width: W - 120, top: cy + r(s * 0.7) + 10, 'text-align': 'center', 'font-size': fit(f.sub, W - 120, 60, 30), 'font-weight': 700 } }] : []),
        ],
        tweens: [
          { targets: 'core', at: 0, duration: 0.35, from: { scale: 2.2, opacity: 0 }, to: { scale: 1, opacity: 1 }, ease: 'power4.out' },
          { targets: 'shock', at: 0.28, duration: 0.6, from: { scale: 0.3 }, to: { scale: 3.2 }, ease: 'power2.out', sound: 'none' },
          { targets: 'shock', at: 0.28, duration: 0.01, to: { opacity: 1 }, sound: 'none' },
          { targets: 'shock', at: 0.32, duration: 0.55, to: { opacity: 0 }, sound: 'none' },
          { targets: sparks.map((e) => e.id).join(','), at: 0.28, duration: 0.01, to: { opacity: 1 }, sound: 'none' },
          ...sparks.map((e, i): SceneTween => ({ targets: e.id, at: 0.28, duration: 1.1, to: { scale: 1 }, physics: { velocity: 1100 + (i % 3) * 250, angle: r(i * 22.5 + (i % 2 ? 6 : -6)), gravity: 1500 }, sound: 'none' })),
          { targets: sparks.map((e) => e.id).join(','), at: 0.6, duration: 0.8, to: { opacity: 0 }, ease: 'power1.in', sound: 'none' },
          ...(f.sub ? [{ targets: 'sub', at: 0.6, duration: 0.45, from: { opacity: 0, y: 30 }, to: { opacity: 1, y: 0 }, ease: 'power3.out' }] : []),
          exit(['core-row', ...(f.sub ? ['sub'] : [])], len),
        ],
      };
    },
  },

  marquee: {
    label: 'Word rows',
    hint: 'Big words in tilted rows that slide past each other, one row in the accent colour: energy, a vibe, what it’s all about',
    fields: { items: 'Words or short phrases, one per line (2–6)' },
    example: { items: ['Discipline', 'Patience', 'Tawakkul', 'Consistency', 'Intention'] },
    seconds: () => 3.5,
    build: (f, { W, H, color }, len): Built => {
      const words = items(f, 1, 6).map(plain);
      const rows = words.length ? Array.from({ length: clamp(words.length, 4, 6) }, (_, i) => words[i % words.length]) : [];
      const m = rows.length;
      const fs = Math.min(260, r((H * 0.82) / Math.max(1, m)));
      const total = m * fs + (m - 1) * 12;
      const mid = Math.floor(m / 2);
      const elements: El[] = [{ id: 'rows', kind: 'box', style: { left: -240, top: r((H - total) / 2), width: W + 480, display: 'flex', 'flex-direction': 'column', gap: 12, rotate: '-8deg' } }];
      const tweens: SceneTween[] = [];
      rows.forEach((w, i) => {
        const outline = i % 2 === 1 && i !== mid;
        elements.push({
          id: `w${i}`,
          kind: 'text',
          parent: 'rows',
          text: Array(5).fill(w).join(' • '),
          style: { 'font-size': fs, 'font-family': 'Anton', 'font-weight': 400, 'line-height': 1, 'white-space': 'nowrap', 'text-transform': 'uppercase', color: i === mid ? color : outline ? 'transparent' : '#ffffff', ...(outline ? { '-webkit-text-stroke': '3px #ffffff' } : {}) },
        });
        tweens.push({ targets: `w${i}`, at: i * 0.05, duration: 0.7, from: { xPercent: i % 2 ? -30 : 30, opacity: 0 }, to: { xPercent: 0, opacity: 1 }, ease: 'expo.out', sound: i ? 'none' : 'whoosh' });
        tweens.push({ targets: `w${i}`, at: 0, duration: len, from: { x: i % 2 ? -700 : 0 }, to: { x: i % 2 ? 0 : -700 }, ease: 'none' });
      });
      return { background: DARK, elements, tweens };
    },
  },

  terminal: {
    label: 'Terminal',
    hint: 'A terminal window types commands out line by line and prints what they did: building, automating, a tech how-to',
    fields: { text: 'Window title (optional)', items: 'Lines, one per line; a line starting with “$ ” is typed out (up to 6)' },
    example: { text: 'studio', items: ['$ make video --topic sales', 'Script, voice and scenes ready', '$ render', 'Done in 42 s'] },
    seconds: (f) => 1.2 + f.items.slice(0, 6).reduce((s, l) => s + (l.startsWith('$') ? Math.max(0.3, l.length * 0.045) + 0.35 : 0.3), 0) + 1,
    build: (f, { W, H, color }, len): Built => {
      const lines = items(f, 1, 6).map((l) => ({ typed: l.startsWith('$'), text: l.replace(/^\$\s?/, '') }));
      const longestLine = Math.max(1, ...lines.map((l) => l.text.length + (l.typed ? 2 : 0)));
      const fs = r(clamp(880 / (longestLine * 0.6), 24, 40));
      const lineH = r(fs * 2);
      const winH = 110 + lines.length * lineH + 50;
      const top = r(H * 0.46 - winH / 2);
      const mono = { 'font-family': 'JetBrains Mono', 'font-weight': 500, 'font-size': fs, 'line-height': 1.3, 'white-space': 'pre' };
      const elements: El[] = [
        { id: 'win', kind: 'box', style: { left: 60, top, width: W - 120, height: winH, background: '#0d1117', 'border-radius': 32, border: '2px solid rgba(255,255,255,.1)', 'box-shadow': '0 40px 120px rgba(0,0,0,.6)', overflow: 'hidden' } },
        ...['#ff5f57', '#febc2e', '#28c840'].map((c, i) => ({ id: `dot${i}`, kind: 'box' as const, parent: 'win', style: { position: 'absolute', left: 34 + i * 36, top: 32, width: 22, height: 22, 'border-radius': '50%', background: c } })),
        ...(f.text ? [{ id: 'name', kind: 'text' as const, parent: 'win', text: plain(f.text), style: { position: 'absolute', left: 0, top: 24, width: '100%', 'text-align': 'center', 'font-size': 26, 'font-family': 'JetBrains Mono', 'font-weight': 500, color: 'rgba(255,255,255,.45)' } }] : []),
        { id: 'rule', kind: 'box', parent: 'win', style: { position: 'absolute', left: 0, top: 84, width: '100%', height: 2, background: 'rgba(255,255,255,.06)' } },
      ];
      const tweens: SceneTween[] = [{ targets: 'win', at: 0, duration: 0.5, from: { y: 80, opacity: 0, scale: 0.97 }, to: { y: 0, opacity: 1, scale: 1 }, ease: 'power3.out' }];
      const start = 44 + r(fs * 1.2);
      let t = 0.6;
      lines.forEach((l, i) => {
        const y = 110 + i * lineH;
        const last = i === lines.length - 1;
        if (l.typed) {
          elements.push({ id: `p${i}`, kind: 'text', parent: 'win', text: '$', style: { ...mono, position: 'absolute', left: 44, top: y, color } });
          elements.push({ id: `l${i}`, kind: 'text', parent: 'win', text: '', style: { ...mono, position: 'absolute', left: start, top: y, color: '#ffffff' } });
          const d = Math.max(0.3, l.text.length * 0.045);
          tweens.push({ targets: `p${i}`, at: t, duration: 0.05, from: { opacity: 0 }, to: { opacity: 1 }, sound: 'none' });
          tweens.push({ targets: `l${i}`, at: t, duration: d, to: { text: l.text.slice(0, 300) }, ease: 'none', sound: 'typing' });
          tweens.push({ targets: 'cursor', at: t, duration: 0, to: { x: 0, y: i * lineH }, sound: 'none' });
          tweens.push({ targets: 'cursor', at: t, duration: d, to: { x: r(l.text.length * 0.6 * fs) }, ease: `steps(${clamp(l.text.length, 1, 99)})`, sound: 'none' });
          t += d + 0.35;
        } else {
          elements.push({ id: `l${i}`, kind: 'text', parent: 'win', text: l.text, style: { ...mono, position: 'absolute', left: 44, top: y, color: last ? color : 'rgba(255,255,255,.72)' } });
          tweens.push({ targets: `l${i}`, at: t, duration: 0.05, from: { opacity: 0 }, to: { opacity: 1 }, sound: 'tick' });
          t += 0.3;
        }
      });
      elements.push({ id: 'cursor', kind: 'box', parent: 'win', style: { position: 'absolute', left: start, top: 110 + r(fs * 0.1), width: r(fs * 0.6), height: r(fs * 1.15), background: color, opacity: 0 } });
      tweens.push({ targets: 'cursor', at: 0.55, duration: 0.05, to: { opacity: 1 }, sound: 'none' });
      tweens.push({ targets: 'cursor', at: t, duration: 0.3, to: { opacity: 0 }, yoyo: true, repeat: 7, sound: 'none' });
      tweens.push(exit(['win'], len));
      return { background: 'dim', elements, tweens };
    },
  },

  route: {
    label: 'Route',
    hint: 'A route draws itself from one place to another with a marker travelling it: a journey, from here to there, A to B',
    fields: { text: 'From', sub: 'To' },
    example: { text: 'Makkah', sub: 'Madinah' },
    seconds: () => 3.5,
    build: (f, { W, H, color }, len): Built => {
      const cy = r(H * 0.46);
      const dy = Math.min(300, r(H * 0.16));
      const [ax, ay, bx, by] = [240, cy + dy, W - 240, cy - dy];
      const d = `M${ax} ${ay} Q${ax + 60} ${by - 40} ${bx} ${by}`;
      const D = 1.5;
      const pin = (id: string, x: number, y: number): El => ({ id, kind: 'box', style: { left: x - 30, top: y - 30, width: 60, height: 60, 'border-radius': '50%', background: color, border: '9px solid #ffffff', 'box-shadow': '0 10px 30px rgba(0,0,0,.45)' } });
      const label = (id: string, text: string, x: number, top: number): El => ({ id, kind: 'text', text, style: { left: clamp(x - 260, 20, W - 540), width: 520, top, 'text-align': 'center', 'font-size': fit(text, 500, 64, 32), 'font-weight': 800 } });
      return {
        background: 'dim',
        elements: [
          { id: 'trail', kind: 'path', d, style: { stroke: 'rgba(255,255,255,.3)', 'stroke-width': 8, 'stroke-dasharray': '2 22', opacity: 0 } },
          { id: 'route', kind: 'path', d, draw: true, style: { stroke: color, 'stroke-width': 10 } },
          { id: 'pulse', kind: 'box', style: { left: bx - 60, top: by - 60, width: 120, height: 120, 'border-radius': '50%', border: `6px solid ${color}`, opacity: 0 } },
          pin('pin-a', ax, ay),
          pin('pin-b', bx, by),
          { id: 'mover', kind: 'box', style: { left: 0, top: 0, width: 30, height: 30, 'border-radius': '50%', background: '#ffffff', 'box-shadow': `0 0 24px ${color}`, opacity: 0 } },
          label('from', f.text, ax, ay + 56),
          label('to', f.sub, bx, by - 140),
        ],
        tweens: [
          { targets: 'pin-a', at: 0, duration: 0.45, from: { scale: 0, opacity: 0 }, to: { scale: 1, opacity: 1 }, ease: 'back.out(2.2)' },
          { targets: 'from', at: 0.15, duration: 0.4, from: { opacity: 0, y: 20 }, to: { opacity: 1, y: 0 }, ease: 'power3.out', sound: 'none' },
          { targets: 'trail', at: 0.2, duration: 0.5, to: { opacity: 1 }, sound: 'none' },
          { targets: 'route', at: 0.5, duration: D, from: { strokeDashoffset: 1 }, to: { strokeDashoffset: 0 }, ease: 'power1.inOut', sound: 'whoosh' },
          { targets: 'mover', at: 0.5, duration: 0.15, from: { opacity: 0, xPercent: -50, yPercent: -50 }, to: { opacity: 1, xPercent: -50, yPercent: -50 }, sound: 'none' },
          { targets: 'mover', at: 0.5, duration: D, to: { motionPath: d }, ease: 'power1.inOut', sound: 'none' },
          { targets: 'mover', at: 0.5 + D, duration: 0.2, to: { opacity: 0 }, sound: 'none' },
          { targets: 'pin-b', at: 0.45 + D, duration: 0.45, from: { scale: 0, opacity: 0 }, to: { scale: 1, opacity: 1 }, ease: 'back.out(2.2)' },
          { targets: 'pulse', at: 0.5 + D, duration: 0.8, from: { scale: 0.6 }, to: { scale: 2.4 }, ease: 'power2.out', sound: 'none' },
          { targets: 'pulse', at: 0.5 + D, duration: 0.01, to: { opacity: 0.8 }, sound: 'none' },
          { targets: 'pulse', at: 0.55 + D, duration: 0.7, to: { opacity: 0 }, sound: 'none' },
          { targets: 'to', at: 0.6 + D, duration: 0.4, from: { opacity: 0, y: -20 }, to: { opacity: 1, y: 0 }, ease: 'power3.out', sound: 'none' },
          exit(['trail', 'route', 'pin-a', 'pin-b', 'from', 'to'], len),
        ],
      };
    },
  },

  clock: {
    label: 'Time passing',
    hint: 'A clock whose hands spin through the hours, then the line lands: time passing, a deadline, later that day',
    fields: { text: 'What it says (e.g. 3 hours later)' },
    example: { text: '*3 hours* later' },
    seconds: () => 3,
    build: (f, { W, H, color }, len): Built => {
      const R = r(Math.min(240, H * 0.14));
      const cx = r(W / 2);
      const cy = r(H * 0.42);
      let ticks = '';
      for (let k = 0; k < 12; k++) {
        const a = (k * 30 * Math.PI) / 180;
        const inner = R - (k % 3 ? 44 : 60);
        ticks += `M${r(R + inner * Math.sin(a))} ${r(R - inner * Math.cos(a))} L${r(R + (R - 26) * Math.sin(a))} ${r(R - (R - 26) * Math.cos(a))} `;
      }
      const hand = (id: string, w: number, len: number, bg: string): El => ({ id, kind: 'box', parent: 'face', style: { position: 'absolute', left: R - w / 2, top: R - len, width: w, height: len, 'border-radius': w / 2, background: bg, 'transform-origin': '50% 100%' } });
      return {
        background: 'dim',
        elements: [
          { id: 'face', kind: 'box', style: { left: cx - R, top: cy - R, width: 2 * R, height: 2 * R, 'border-radius': '50%', background: 'rgba(0,0,0,.35)', 'box-shadow': 'inset 0 0 0 10px #ffffff, 0 30px 80px rgba(0,0,0,.4)' } },
          { id: 'ticks', kind: 'path', parent: 'face', d: ticks.trim(), style: { stroke: '#ffffff', 'stroke-width': 7 } },
          hand('hours', 16, r(R * 0.5), '#ffffff'),
          hand('minutes', 10, r(R * 0.78), color),
          { id: 'hub', kind: 'box', parent: 'face', style: { position: 'absolute', left: R - 18, top: R - 18, width: 36, height: 36, 'border-radius': '50%', background: color, border: '6px solid #ffffff' } },
          { id: 'say', kind: 'text', text: f.text, style: { left: 60, width: W - 120, top: cy + R + 60, 'text-align': 'center', 'font-size': fit(f.text, W - 120, 100, 44) } },
        ],
        tweens: [
          { targets: 'face', at: 0, duration: 0.5, from: { scale: 0.6, opacity: 0 }, to: { scale: 1, opacity: 1 }, ease: 'back.out(1.6)' },
          { targets: 'minutes', at: 0.45, duration: 1.7, from: { rotation: 0 }, to: { rotation: 1080 }, ease: 'power2.inOut', sound: 'whoosh' },
          { targets: 'hours', at: 0.45, duration: 1.7, from: { rotation: 0 }, to: { rotation: 90 }, ease: 'power2.inOut', sound: 'none' },
          { targets: 'say', at: 1.9, duration: 0.45, from: { opacity: 0, y: 30 }, to: { opacity: 1, y: 0 }, ease: 'power3.out', sound: 'pop' },
          { targets: 'face', at: 2.15, duration: 0.1, to: { scale: 1.04 }, yoyo: true, repeat: 1, sound: 'none' },
          exit(['face', 'say'], len),
        ],
      };
    },
  },

  // The page's mascot (shared/mascots.ts), drawn on its rig: it walks, points, talks and reacts.
  'mascot-explain': {
    label: 'Mascot explains',
    hint: 'The page’s mascot walks in and points at a card with the line: a lesson, a rule, the key fact',
    fields: { text: 'The line it points at', sub: 'A second line under it (optional)' },
    example: { text: 'Sell *before* you build', sub: 'Ten people paying beats a perfect product' },
    seconds: (f) => clamp(3 + wordCount(`${f.text} ${f.sub}`) * 0.2, 3.5, 8),
    build: (f, { W, H, color }, len): Built => {
      const { mw, mh, feet } = mascotSize(H, 600);
      const top = feet - mh;
      // Its box has room for its arms: the empty left part hangs off the frame. Its finger is 93 % across, 44 % down.
      const left = -r(mw * 0.3);
      const cardL = r(left + mw * 0.93 + 30);
      const cardW = W - cardL - 48;
      const size = fitWrap(f.text, cardW - 64, 3, 84, 38);
      const subSize = f.sub ? fitWrap(f.sub, cardW - 64, 3, 42, 26) : 0;
      const cardH = r(size * 1.15 * Math.min(3, Math.ceil((plain(f.text).length * size * 0.6) / (cardW - 64))) + (f.sub ? subSize * 1.3 * Math.min(3, Math.ceil((plain(f.sub).length * subSize * 0.55) / (cardW - 64))) + 20 : 0) + 64);
      const cardT = r(clamp(top + mh * 0.44 - cardH / 2, H * 0.1, feet - cardH));
      const t = Math.min(1, len / 4);
      return {
        background: 'none',
        elements: [
          { id: 'm', kind: 'mascot', pose: 'walk', style: { left, top, width: mw, height: mh } },
          { id: 'card', kind: 'box', style: { left: cardL, top: cardT, width: cardW, padding: 32, background: '#ffffff', 'border-radius': 28, 'box-shadow': '0 18px 50px rgba(0,0,0,.28)', 'transform-origin': 'left center', display: 'flex', 'flex-direction': 'column', gap: 18 } },
          { id: 'line', kind: 'text', parent: 'card', text: f.text, style: { 'font-size': size, 'line-height': 1.15, color: '#111111', 'font-weight': 800 } },
          ...(f.sub ? [{ id: 'sub', kind: 'text' as const, parent: 'card', text: f.sub, style: { 'font-size': subSize, 'line-height': 1.3, color: '#555555', 'font-weight': 600, 'font-family': 'Inter' } }] : []),
          { id: 'bar', kind: 'box', parent: 'card', style: { width: 90, height: 8, 'border-radius': 4, background: color, 'transform-origin': 'left center' } },
        ],
        tweens: [
          { targets: 'm', at: 0, duration: 1.0 * t, from: { x: -mw * 0.7 }, to: { x: 0 }, ease: 'power1.out', sound: 'none' },
          { targets: 'm', at: 1.0 * t, duration: 0.3, to: { pose: 'point' } },
          { targets: 'card', at: 1.15 * t, duration: 0.45, from: { scale: 0.6, opacity: 0 }, to: { scale: 1, opacity: 1 }, ease: 'back.out(1.7)' },
          ...(f.sub ? [{ targets: 'sub', at: 1.5 * t, duration: 0.4, from: { opacity: 0, y: 14 }, to: { opacity: 1, y: 0 }, ease: 'power2.out', sound: 'none' as const }] : []),
          { targets: 'bar', at: 1.45 * t, duration: 0.45, from: { scaleX: 0 }, to: { scaleX: 1 }, ease: 'expo.out', sound: 'swish' },
          exit(['m', 'card'], len),
        ],
      };
    },
  },

  'mascot-says': {
    label: 'Mascot says',
    hint: 'The page’s mascot pops up and says the line in a speech bubble: a hook, a question, a punchline',
    fields: { text: 'What it says' },
    example: { text: 'Nobody tells you *this* about money' },
    seconds: (f) => clamp(2.2 + wordCount(f.text) * 0.32, 3, 10),
    build: (f, { W, H }, len): Built => {
      const { mw, mh, feet } = mascotSize(H, 620);
      const top = feet - mh;
      const bw = Math.min(860, W - 120);
      const size = fitWrap(f.text, bw - 80, 3, 76, 36);
      const lines = Math.min(3, Math.ceil((plain(f.text).length * size * 0.6) / (bw - 80)));
      const bh = r(lines * size * 1.2 + 76);
      // Just above its head (the top 8 % of its box is air).
      const bt = r(Math.max(H * 0.08, top + mh * 0.06 - bh - 30));
      const words = wordCount(f.text);
      return {
        background: 'none',
        elements: [
          { id: 'm', kind: 'mascot', pose: 'talk', style: { left: r((W - mw) / 2), top, width: mw, height: mh } },
          { id: 'tail', kind: 'box', style: { left: r(W / 2 - 22), top: bt + bh - 26, width: 44, height: 44, background: '#ffffff', transform: 'rotate(45deg)', 'border-radius': 6 } },
          { id: 'bubble', kind: 'box', style: { left: r((W - bw) / 2), top: bt, width: bw, height: bh, padding: '0 40px', background: '#ffffff', 'border-radius': 40, 'box-shadow': '0 16px 44px rgba(0,0,0,.25)', 'transform-origin': 'center bottom', ...centred } },
          { id: 'say', kind: 'text', parent: 'bubble', text: f.text, split: 'words', style: { 'font-size': size, 'line-height': 1.2, color: '#111111', 'font-weight': 800 } },
        ],
        tweens: [
          { targets: 'm', at: 0, duration: 0.5, from: { y: 260, opacity: 0 }, to: { y: 0, opacity: 1 }, ease: 'back.out(1.4)' },
          { targets: 'bubble,tail', at: 0.35, duration: 0.4, from: { scale: 0.5, opacity: 0 }, to: { scale: 1, opacity: 1 }, ease: 'back.out(2)', sound: 'pop' },
          { targets: 'say.words', at: 0.5, duration: 0.25, from: { opacity: 0, y: 12 }, to: { opacity: 1, y: 0 }, ease: 'power2.out', stagger: clamp((len - 1.6) / Math.max(1, words), 0.06, 0.3), ...(words > 8 ? { sound: 'none' as const } : {}) },
          // Done talking: it waits with a smile.
          { targets: 'm', at: Math.max(0.6, len - 0.9), duration: 0.25, to: { pose: 'idle' } },
          exit(['m', 'bubble', 'tail'], len),
        ],
      };
    },
  },

  'mascot-react': {
    label: 'Mascot reacts',
    hint: 'The page’s mascot pops up bottom left as a sticker with a white outline and reacts: the payoff, a twist, a win',
    fields: { sub: 'The reaction: cheer, shock, think, point or wave (cheer when left out; optional)', text: 'A word on it, e.g. NO WAY (optional)' },
    example: { sub: 'shock', text: 'No *way*' },
    seconds: () => 2.4,
    build: (f, { W, H, color }, len): Built => {
      const { mw, mh, feet } = mascotSize(H, 500, 0.78);
      const top = feet - mh;
      // Bottom left: the right side is under the app's buttons. Its box's empty left part hangs off the frame.
      const left = -r(mw * 0.12);
      const want = f.sub.trim().toLowerCase();
      const pose: MascotPose = isMascotPose(want) ? want : 'cheer';
      const size = f.text ? fit(f.text, 420, 96, 44, 0.62) : 0;
      return {
        background: 'none',
        elements: [
          { id: 'm', kind: 'mascot', pose: 'idle', style: { left, top, width: mw, height: mh, 'transform-origin': 'center bottom', filter: 'drop-shadow(6px 0 0 #fff) drop-shadow(-6px 0 0 #fff) drop-shadow(0 6px 0 #fff) drop-shadow(0 -6px 0 #fff)' } },
          ...(f.text
            ? [{ id: 'tag', kind: 'text' as const, text: f.text, style: { left: r(left + mw * 0.42), top: r(top - size * 0.9), padding: '10px 26px', background: '#ffffff', color: '#111111', 'font-size': size, 'font-weight': 900, 'text-transform': 'uppercase', 'border-radius': 18, transform: 'rotate(-6deg)', 'white-space': 'nowrap', 'box-shadow': `0 8px 0 ${color}` } }]
            : []),
        ],
        tweens: [
          { targets: 'm', at: 0, duration: 0.35, from: { scale: 0, rotation: -12 }, to: { scale: 1, rotation: 0 }, ease: 'back.out(2)' },
          { targets: 'm', at: 0.2, duration: 0.25, to: { pose } },
          ...(f.text ? [{ targets: 'tag', at: 0.45, duration: 0.3, from: { scale: 1.8, opacity: 0 }, to: { scale: 1, opacity: 1 }, ease: 'power4.out' }] : []),
          { targets: f.text ? 'm,tag' : 'm', at: Math.max(0.6, len - 0.3), duration: 0.3, to: { scale: 0 }, ease: 'back.in(1.7)', sound: 'none' },
        ],
      };
    },
  },

  // Islamic pages (Gentle Return's look): flat deep green or navy, gold lines and 8-point stars, cream words; slow
  // fades and drifting light, nothing snappy, and no sounds. The Arabic is never typed by Claude: an ayah's comes
  // from the Quran text by its reference (server/src/islamic/quran.ts), anything else from the creator.
  ayah: {
    label: 'Ayah',
    hint: 'An ayah in Arabic inside a gold arch, its meaning under it and the reference in gold: give the reference, the Arabic and the meaning are filled in from the Quran text',
    fields: { sub: 'The reference, e.g. 94:5-6 (the Arabic and the meaning are filled in from it)', text: 'The meaning (filled in from the translation)', arabic: 'The Arabic (filled in from the Quran text)' },
    example: { sub: 'Ash-Sharh 94:5–6', text: 'For indeed, with hardship [will be] ease. Indeed, with hardship [will be] ease.', arabic: 'فَإِنَّ مَعَ الْعُسْرِ يُسْرًا ﴿٥﴾ إِنَّ مَعَ الْعُسْرِ يُسْرًا ﴿٦﴾' },
    solid: DEEP,
    hidesCaptions: true,
    seconds: (f) => clamp(3.5 + wordCount(f.text) * 0.36 + letters(f.arabic ?? '') * 0.03, 6, 20),
    build: (f, { W, H }, len): Built => {
      const cx = r(W / 2);
      const ah = r(H * 0.4);
      const aw = r(Math.min(W * 0.8, ah * 1.12));
      const top = r(H * 0.11);
      const bottom = top + ah;
      // The Arabic sits in the arch's straight part and the lower curve.
      const boxT = r(top + aw * 0.4);
      const boxW = aw - 110;
      const boxH = bottom - 40 - boxT;
      const n = Math.max(1, letters(f.arabic ?? ''));
      const size = r(clamp(Math.sqrt((boxW * boxH) / (n * 0.95)), 36, 104));
      const meanW = W - 160;
      const meanT = bottom + r(H * 0.035);
      const meanH = r(H * 0.75) - meanT - 80;
      const meanSize = r(clamp(Math.sqrt((meanW * meanH) / (Math.max(1, plain(f.text).length) * 0.55 * 1.35)), 26, 60));
      const stars = [
        [0.12, 0.07, 16],
        [0.86, 0.1, 12],
        [0.08, 0.6, 10],
        [0.92, 0.55, 14],
        [0.2, 0.88, 11],
        [0.8, 0.9, 13],
      ];
      return {
        background: DEEP,
        elements: [
          ...stars.map(([x, y, R], i) => ({ id: `s${i}`, kind: 'path' as const, d: star8(W * x, H * y, R), style: { fill: GOLD, opacity: 0 } })),
          { id: 'arch', kind: 'path', d: arch(cx, top, bottom, aw), draw: true, style: { fill: 'none', stroke: GOLD, 'stroke-width': 4 } },
          { id: 'arch2', kind: 'path', d: arch(cx, top + 22, bottom, aw - 36), draw: true, style: { fill: 'none', stroke: GOLD, 'stroke-width': 1.5, opacity: 0.7 } },
          { id: 'tip', kind: 'path', d: star8(cx, top - 34, 22), style: { fill: GOLD } },
          { id: 'ar-box', kind: 'box', style: { left: cx - r(boxW / 2), top: boxT, width: boxW, height: boxH, ...centred } },
          { id: 'ar', kind: 'text', parent: 'ar-box', text: f.arabic ?? '', style: { 'font-family': NASKH, 'font-size': size, 'line-height': 1.95, color: CREAM, direction: 'rtl', 'font-weight': 500 } },
          { id: 'mean-box', kind: 'box', style: { left: 80, top: meanT, width: meanW, height: meanH, ...centred } },
          { id: 'mean', kind: 'text', parent: 'mean-box', text: f.text, style: { 'font-family': 'Playfair Display', 'font-style': 'italic', 'font-size': meanSize, 'line-height': 1.35, color: CREAM } },
          row(W, 'cite', meanT + meanH + 24, 56),
          { id: 'cite-t', kind: 'text', parent: 'cite', text: f.sub, style: { 'font-family': 'Inter', 'font-weight': 600, 'font-size': 30, 'letter-spacing': '0.22em', 'text-transform': 'uppercase', color: GOLD } },
        ],
        tweens: [
          { targets: 'arch,arch2', at: 0, duration: 1.8, from: { strokeDashoffset: 1 }, to: { strokeDashoffset: 0 }, ease: 'power1.inOut', sound: 'none' },
          { targets: 'tip', at: 0.9, duration: 1, from: { scale: 0, opacity: 0, rotation: -45, transformOrigin: '50% 50%' }, to: { scale: 1, opacity: 1, rotation: 0 }, ease: 'power2.out', sound: 'none' },
          { targets: stars.map((_, i) => `s${i}`).join(','), at: 0.3, duration: 1.4, from: { opacity: 0 }, to: { opacity: 0.35 }, ease: 'sine.inOut', stagger: 0.25, sound: 'none' },
          // Stars glimmer in turn for as long as it holds.
          { targets: stars.map((_, i) => `s${i}`).join(','), at: 2, duration: 1.6, to: { opacity: 0.12 }, ease: 'sine.inOut', yoyo: true, repeat: Math.max(1, Math.floor((len - 3) / 1.6)), stagger: 0.4, sound: 'none' },
          { targets: 'ar', at: 1, duration: 1.4, from: { opacity: 0, y: 24 }, to: { opacity: 1, y: 0 }, ease: 'power2.out', sound: 'none' },
          { targets: 'mean', at: 2.1, duration: 1.2, from: { opacity: 0, y: 16 }, to: { opacity: 1, y: 0 }, ease: 'power2.out', sound: 'none' },
          { targets: 'cite-t', at: 2.8, duration: 1, from: { opacity: 0, letterSpacing: '0.5em' }, to: { opacity: 1, letterSpacing: '0.22em' }, ease: 'power2.out', sound: 'none' },
          slowExit(['arch', 'arch2', 'tip', 'ar', 'mean', 'cite-t', ...stars.map((_, i) => `s${i}`)], len),
        ],
      };
    },
  },

  hadith: {
    label: 'Hadith',
    hint: 'A hadith in English on night blue in a fine gold frame, who said it above and the collection and number in gold under it',
    fields: { text: 'The hadith as its collection translates it', sub: 'The collection and number, e.g. Sahih al-Bukhari 6416', items: 'The line above it, e.g. The Prophet ﷺ said (optional)', arabic: 'The Arabic, pasted from the collection (optional)' },
    example: { text: 'Be in this world as if you were a stranger or a traveller.', sub: 'Sahih al-Bukhari 6416', items: ['The Prophet ﷺ said'] },
    solid: NAVY,
    hidesCaptions: true,
    seconds: (f) => clamp(3.2 + wordCount(f.text) * 0.36 + letters(f.arabic ?? '') * 0.025, 5, 20),
    build: (f, { W, H }, len): Built => {
      const fw = W - 120;
      const ft = r(H * 0.14);
      const fb = r(H * 0.76);
      const fh = fb - ft;
      const head = f.items[0] ?? '';
      const innerW = fw - 140;
      const hasAr = !!f.arabic;
      const arH = hasAr ? r(fh * 0.3) : 0;
      const textH = fh - 260 - arH;
      const size = r(clamp(Math.sqrt((innerW * textH) / (Math.max(1, plain(f.text).length) * 0.55 * 1.35)), 30, 84));
      const arSize = hasAr ? r(clamp(Math.sqrt((innerW * arH) / (Math.max(1, letters(f.arabic ?? '')) * 0.95)), 30, 64)) : 0;
      const cx = r(W / 2);
      return {
        background: NAVY,
        elements: [
          { id: 'frame', kind: 'box', style: { left: 60, top: ft, width: fw, height: fh, border: `2px solid ${GOLD}`, 'border-radius': 6 } },
          { id: 'frame2', kind: 'box', style: { left: 78, top: ft + 18, width: fw - 36, height: fh - 36, border: `1px solid ${GOLD}`, opacity: 0.55, 'border-radius': 4 } },
          ...[
            [60, ft],
            [60 + fw, ft],
            [60, fb],
            [60 + fw, fb],
          ].map(([x, y], i) => ({ id: `c${i}`, kind: 'path' as const, d: star8(x, y, 16), style: { fill: GOLD, stroke: NAVY, 'stroke-width': 4, 'paint-order': 'stroke' } })),
          { id: 'top-star', kind: 'path', d: star8(cx, ft, 26), style: { fill: GOLD, stroke: NAVY, 'stroke-width': 6, 'paint-order': 'stroke' } },
          ...(head ? [row(W, 'head', ft + 70, 60), { id: 'head-t', kind: 'text' as const, parent: 'head', text: head, style: { 'font-family': 'Inter', 'font-weight': 600, 'font-size': 30, 'letter-spacing': '0.2em', 'text-transform': 'uppercase', color: GOLD } }] : []),
          ...(hasAr
            ? [
                { id: 'ar-box', kind: 'box' as const, style: { left: cx - r(innerW / 2), top: ft + 150, width: innerW, height: arH, ...centred } },
                { id: 'ar', kind: 'text' as const, parent: 'ar-box', text: f.arabic ?? '', style: { 'font-family': NASKH, 'font-size': arSize, 'line-height': 1.9, color: GOLD, direction: 'rtl' } },
              ]
            : []),
          { id: 'say-box', kind: 'box', style: { left: cx - r(innerW / 2), top: ft + 150 + arH, width: innerW, height: textH, ...centred } },
          { id: 'say', kind: 'text', parent: 'say-box', text: `“${f.text.replace(/^["“]|["”]$/g, '')}”`, split: 'words', style: { 'font-family': 'Playfair Display', 'font-style': 'italic', 'font-size': size, 'line-height': 1.35, color: CREAM } },
          { id: 'rule', kind: 'box', style: { left: cx - 60, top: fb - 104, width: 120, height: 2, background: GOLD } },
          row(W, 'cite', fb - 88, 56),
          { id: 'cite-t', kind: 'text', parent: 'cite', text: f.sub, style: { 'font-family': 'Inter', 'font-weight': 600, 'font-size': 28, 'letter-spacing': '0.2em', 'text-transform': 'uppercase', color: GOLD } },
        ],
        tweens: [
          { targets: 'frame,frame2', at: 0, duration: 1.2, from: { opacity: 0, scale: 0.97 }, to: { opacity: 1, scale: 1 }, ease: 'power2.out', sound: 'none' },
          { targets: 'c0,c1,c2,c3', at: 0.4, duration: 0.9, from: { opacity: 0, scale: 0, transformOrigin: '50% 50%' }, to: { opacity: 1, scale: 1 }, ease: 'power2.out', stagger: 0.12, sound: 'none' },
          { targets: 'top-star', at: 0.6, duration: 1.1, from: { opacity: 0, rotation: -45, transformOrigin: '50% 50%' }, to: { opacity: 1, rotation: 0 }, ease: 'power2.out', sound: 'none' },
          { targets: 'top-star', at: 1.8, duration: Math.max(1, len - 2.4), to: { rotation: 45 }, ease: 'none', sound: 'none' },
          ...(head ? [{ targets: 'head-t', at: 0.8, duration: 0.9, from: { opacity: 0 }, to: { opacity: 1 }, ease: 'sine.out', sound: 'none' as const }] : []),
          ...(hasAr ? [{ targets: 'ar', at: 1, duration: 1.2, from: { opacity: 0, y: 16 }, to: { opacity: 1, y: 0 }, ease: 'power2.out', sound: 'none' as const }] : []),
          { targets: 'say.words', at: hasAr ? 1.8 : 1.1, duration: 0.7, from: { opacity: 0, y: 10 }, to: { opacity: 1, y: 0 }, ease: 'power1.out', stagger: clamp((len * 0.55) / Math.max(1, wordCount(f.text)), 0.04, 0.22), sound: 'none' },
          { targets: 'rule', at: 2.2, duration: 0.9, from: { scaleX: 0 }, to: { scaleX: 1 }, ease: 'power2.inOut', sound: 'none' },
          { targets: 'cite-t', at: 2.5, duration: 0.9, from: { opacity: 0 }, to: { opacity: 1 }, ease: 'sine.out', sound: 'none' },
          slowExit(['frame', 'frame2', 'c0', 'c1', 'c2', 'c3', 'top-star', 'say', 'rule', 'cite-t', ...(head ? ['head-t'] : []), ...(hasAr ? ['ar'] : [])], len),
        ],
      };
    },
  },

  speaker: {
    label: 'Speaker',
    hint: 'A quiet name tag at the top for a lecture clip: who is speaking (a gold bar, the name, where it’s from). Keep it on for the whole clip',
    fields: { text: 'Who is speaking, e.g. Mufti Menk', sub: 'Where it’s from, e.g. the lecture or the channel (optional)' },
    example: { text: 'Mufti Menk', sub: 'Lecture: Hope in hard times' },
    seconds: () => 5,
    build: (f, { W, H }, len): Built => {
      const size = fit(f.text, W * 0.62, 56, 34, 0.5);
      const subSize = f.sub ? fit(f.sub, W * 0.62, 26, 20, 0.62) : 0;
      const h = r(size * 1.25 + (f.sub ? subSize * 1.6 : 0) + 44);
      const top = r(H * 0.1);
      return {
        background: 'none',
        elements: [
          { id: 'tag', kind: 'box', style: { left: 56, top, height: h, padding: '22px 34px 22px 30px', background: 'rgba(14,58,45,.88)', 'border-radius': 14, display: 'flex', 'flex-direction': 'column', 'justify-content': 'center', 'border-left': `6px solid ${GOLD}`, 'box-sizing': 'border-box' } },
          { id: 'name', kind: 'text', parent: 'tag', text: f.text, style: { 'font-family': 'Playfair Display', 'font-weight': 700, 'font-size': size, 'line-height': 1.2, color: CREAM, 'white-space': 'nowrap' } },
          ...(f.sub ? [{ id: 'from', kind: 'text' as const, parent: 'tag', text: f.sub, style: { 'font-family': 'Inter', 'font-weight': 600, 'font-size': subSize, 'letter-spacing': '0.14em', 'text-transform': 'uppercase', color: GOLD, 'margin-top': 8, 'white-space': 'nowrap' } }] : []),
        ],
        tweens: [
          { targets: 'tag', at: 0, duration: 0.9, from: { opacity: 0, x: -30 }, to: { opacity: 1, x: 0 }, ease: 'power2.out', sound: 'none' },
          { targets: 'name', at: 0.3, duration: 0.8, from: { opacity: 0 }, to: { opacity: 1 }, ease: 'sine.out', sound: 'none' },
          ...(f.sub ? [{ targets: 'from', at: 0.55, duration: 0.8, from: { opacity: 0 }, to: { opacity: 1 }, ease: 'sine.out', sound: 'none' as const }] : []),
          slowExit(['tag'], len),
        ],
      };
    },
  },
};

const wordCount = (t: string) => plain(t).split(/\s+/).filter(Boolean).length;

/** Arabic letters, without the vowel marks (they take no width). */
const letters = (t: string) => t.replace(/[ً-ٰٟۖ-ۭ\s]/g, '').length;
const slowExit = (ids: string[], len: number): SceneTween => ({ targets: ids.join(','), at: Math.max(0, len - 0.7), duration: 0.7, to: { opacity: 0 }, ease: 'sine.in', sound: 'none' });
/** An 8-point star (two squares, one turned 45°) around cx, cy: SVG path data. */
function star8(cx: number, cy: number, R: number) {
  const pts: string[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (Math.PI / 8) * i - Math.PI / 2;
    const d = i % 2 ? R * 0.7654 : R;
    pts.push(`${r(cx + d * Math.cos(a))} ${r(cy + d * Math.sin(a))}`);
  }
  return `M${pts.join('L')}Z`;
}
/** A pointed arch `w` wide on cx, its tip at `top`, its sides down to `bottom`. */
function arch(cx: number, top: number, bottom: number, w: number) {
  const x0 = r(cx - w / 2);
  const x1 = r(cx + w / 2);
  const spring = r(top + w * 0.55);
  return `M${x0} ${bottom}L${x0} ${spring}C${x0} ${r(spring - w * 0.3)} ${r(cx - w * 0.2)} ${r(top + w * 0.12)} ${r(cx)} ${top}C${r(cx + w * 0.2)} ${r(top + w * 0.12)} ${x1} ${r(spring - w * 0.3)} ${x1} ${spring}L${x1} ${bottom}`;
}
/** A mascot's box for the frame: `width` in 9:16, smaller on shorter frames, its feet at `ground` of the height. */
function mascotSize(H: number, width: number, ground = 0.8) {
  const mw = r(width * Math.min(1, H / 1920 + 0.2));
  return { mw, mh: r(mw * 1.19), feet: r(H * ground) };
}

/** How long a library scene wants to be with these words. */
export const sceneSeconds = (preset: ScenePreset, fill: SceneFill) => Math.min(SCENE_MAX_SECONDS, Math.round(SCENE_LIBRARY[preset].seconds(fill) * 10) / 10);

/**
 * A library scene built for a frame and a length (its own when left out): plain scene data, checked by normalizeScene
 * like any other. Shorter than it wants, everything runs faster to fit; longer, it holds. `problems` should stay empty.
 */
export function libraryScene(preset: ScenePreset, fill: Partial<SceneFill>, frame: SceneFrame, len?: number, background?: string): SceneSpec & { problems: string[] } {
  const info = SCENE_LIBRARY[preset];
  const f = normalizeFill(fill);
  const natural = sceneSeconds(preset, f);
  const length = Math.min(SCENE_MAX_SECONDS, len ?? natural);
  const built = info.build(f, frame, Math.max(length, natural));
  const k = length < natural ? length / natural : 1;
  const tweens =
    k < 1
      ? built.tweens.map((t) => ({
          ...t,
          at: t.at * k,
          duration: t.duration * k,
          ...(typeof t.stagger === 'number' ? { stagger: t.stagger * k } : t.stagger ? { stagger: { ...t.stagger, each: t.stagger.each * k } } : {}),
          ...(t.repeatDelay ? { repeatDelay: t.repeatDelay * k } : {}),
        }))
      : built.tweens;
  const problems: string[] = [];
  const spec = normalizeScene({ name: info.label, background: background ?? built.background, elements: built.elements, tweens, preset, fill: f }, length, problems);
  return { ...spec, problems };
}

/** A library scene built again for where it is now (its length, the frame, the accent); any other scene as it is. */
export function refitScene<T extends SceneSpec & { start: number; end: number }>(o: T, frame: SceneFrame): T {
  if (!isScenePreset(o.preset) || !o.fill) return o;
  const { problems: _, ...s } = libraryScene(o.preset, o.fill, frame, o.end - o.start, o.background);
  return { ...o, elements: s.elements, tweens: s.tweens, fill: s.fill };
}
