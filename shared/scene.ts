import { FONT_FAMILIES } from './fonts';
import { isMascot, isMascotPose, type MascotId, type MascotPose } from './mascots';

// A scene: a motion graphic Claude designs itself (with the HyperFrames and GSAP skills' know-how), stored as data, not
// code. Elements are boxes, text, shapes and library images styled with an allow-list of CSS; tweens are GSAP tweens
// written as JSON. The server builds the HTML and the timeline from them with everything escaped, so a scene can't
// run script, load anything from outside the library, or reach the app — whatever Claude was told in a transcript.

export const SCENE_MAX_ELEMENTS = 40;
export const SCENE_MAX_TWEENS = 80;
export const SCENE_MAX_SECONDS = 20;

/** The sound a tween can ask for on its frame (shared/sound-design.ts), or `none` to stay silent. */
export const SCENE_SOUNDS = ['none', 'pop', 'swish', 'whoosh', 'zoom', 'whip', 'hit', 'slam', 'thud', 'tick', 'typing', 'draw', 'focus', 'glitch'] as const;
export type SceneSound = (typeof SCENE_SOUNDS)[number];

export type SceneElement = {
  /** Lowercase letters, digits and dashes; tweens target it by this. */
  id: string;
  kind: 'box' | 'text' | 'image' | 'path' | 'mascot';
  /** text: what it says; *word* for the accent colour, a line break with \n. */
  text?: string;
  /** text: wrap each word or letter so a tween can stagger them (target "<id>.words" / "<id>.chars"). */
  split?: 'words' | 'chars';
  /** image: a picture from the library (a logo, a photo, a sticker). */
  mediaId?: string;
  /** path: SVG path data in frame pixels (the frame is 1080 wide). */
  d?: string;
  /** path: start undrawn so a tween of strokeDashoffset from 1 to 0 draws it on. */
  draw?: boolean;
  /** mascot: which one (shared/mascots.ts); left out, the page's own. */
  mascot?: MascotId;
  /** mascot: the pose it starts in (default idle); a tween's `pose` changes it. */
  pose?: MascotPose;
  /** mascot: faces the other way (it points to your left). */
  flip?: boolean;
  /** A box this one sits inside (its position is then relative to that box). */
  parent?: string;
  style: Record<string, string>;
};

export type SceneTween = {
  /** Element ids, comma-separated; "<id>.words" or "<id>.chars" for the parts of split text. */
  targets: string;
  /** Seconds from the scene's start. */
  at: number;
  duration: number;
  /** Start values (a fromTo); without it the tween goes from wherever the element is. */
  from?: Record<string, string | number>;
  to: Record<string, string | number>;
  ease?: string;
  /** Seconds between targets, or where the stagger starts from ("center", "end", "edges" or an index). */
  stagger?: number | { each: number; from: 'start' | 'center' | 'end' | 'edges' | number };
  repeat?: number;
  /** Seconds to wait between repeats. */
  repeatDelay?: number;
  yoyo?: boolean;
  /** Thrown like a real object (Physics2D): speed in px/s, direction in degrees, gravity in px/s². */
  physics?: { velocity: number; angle: number; gravity?: number; friction?: number };
  /** The sound on its frame when *Sound on every move* is on; left out, it's picked from the move. */
  sound?: SceneSound;
  /** Mascots only: the pose they move into over the tween (written as `to: { pose }`); held until the next. */
  pose?: MascotPose;
};

export type SceneSpec = {
  /** What it is, for the overlay list ("Before/after split", "Price drop"). */
  name: string;
  /** Behind the elements: nothing (the video shows), a dim of the video, or a solid colour. */
  background: 'none' | 'dim' | string;
  elements: SceneElement[];
  tweens: SceneTween[];
  /** A scene from the library (shared/scene-library.ts): built again from its words whenever the edit changes. */
  preset?: string;
  fill?: { text: string; sub: string; items: string[] };
};

/** CSS properties a scene element may set, and whether a bare number means pixels. */
const STYLE_PROPS: Record<string, boolean> = {
  left: true,
  top: true,
  right: true,
  bottom: true,
  width: true,
  height: true,
  'max-width': true,
  'min-width': true,
  'max-height': true,
  'min-height': true,
  inset: true,
  padding: true,
  'padding-top': true,
  'padding-bottom': true,
  'padding-left': true,
  'padding-right': true,
  margin: true,
  'margin-top': true,
  'margin-bottom': true,
  'margin-left': true,
  'margin-right': true,
  gap: true,
  'font-size': true,
  'letter-spacing': true,
  'border-radius': true,
  'border-width': true,
  position: false,
  display: false,
  'flex-direction': false,
  'flex-wrap': false,
  'align-items': false,
  'justify-content': false,
  'text-align': false,
  'white-space': false,
  'box-sizing': false,
  overflow: false,
  'z-index': false,
  opacity: false,
  'line-height': false,
  'font-weight': false,
  'font-family': false,
  'font-style': false,
  'text-transform': false,
  color: false,
  background: false,
  'background-color': false,
  border: false,
  'border-color': false,
  'border-style': false,
  'box-shadow': false,
  'text-shadow': false,
  '-webkit-text-stroke': false,
  'paint-order': false,
  filter: false,
  'clip-path': false,
  'transform-origin': false,
  stroke: false,
  'stroke-width': true,
  'stroke-linecap': false,
  'stroke-linejoin': false,
  fill: false,
  perspective: true,
  'perspective-origin': false,
  'transform-style': false,
  'backface-visibility': false,
  transform: false,
  rotate: false,
  scale: false,
  translate: false,
  'mix-blend-mode': false,
  isolation: false,
  'backdrop-filter': false,
  'background-image': false,
  'background-size': false,
  'background-position': false,
  'background-repeat': false,
  'background-clip': false,
  '-webkit-background-clip': false,
  'background-blend-mode': false,
  '-webkit-text-fill-color': false,
  'text-decoration': false,
  'text-decoration-color': false,
  'text-decoration-thickness': true,
  'text-underline-offset': true,
  'word-spacing': true,
  'text-indent': true,
  'text-wrap': false,
  'word-break': false,
  'font-variant-numeric': false,
  outline: false,
  'outline-offset': true,
  'aspect-ratio': false,
  'object-fit': false,
  'object-position': false,
  'mask-image': false,
  '-webkit-mask-image': false,
  visibility: false,
  flex: false,
  'flex-grow': false,
  'flex-shrink': false,
  'flex-basis': true,
  'align-self': false,
  'align-content': false,
  'justify-self': false,
  'place-items': false,
  'place-content': false,
  'grid-template-columns': false,
  'grid-template-rows': false,
  'grid-column': false,
  'grid-row': false,
  'row-gap': true,
  'column-gap': true,
  'border-top': false,
  'border-bottom': false,
  'border-left': false,
  'border-right': false,
  'border-top-left-radius': true,
  'border-top-right-radius': true,
  'border-bottom-left-radius': true,
  'border-bottom-right-radius': true,
  'stroke-dasharray': false,
  'stroke-opacity': false,
  'fill-opacity': false,
};

/** The fonts a scene can use: the app's own (shared/fonts.ts), or the brand font set in the captions. */
export const SCENE_FONTS = [...FONT_FAMILIES, 'Brand'];

/**
 * GSAP properties a tween may animate (transforms in 2D and 3D, opacity, colours, size and place, filters, clipping,
 * line drawing), plus the plugins the page loads: `text` types text out (TextPlugin), `innerText` counts a number up,
 * `motionPath` moves along SVG path data or a path element ("#id"), `morphSVG` turns a path into another ("#id" or
 * path data), `drawSVG` draws part of a path ("0% 100%").
 */
const TWEEN_PROPS = new Set([
  'x',
  'y',
  'z',
  'rotationX',
  'rotationY',
  'rotationZ',
  'transformPerspective',
  'width',
  'height',
  'left',
  'top',
  'right',
  'bottom',
  'fontSize',
  'letterSpacing',
  'lineHeight',
  'boxShadow',
  'textShadow',
  'backgroundPosition',
  'backgroundSize',
  'backgroundImage',
  'strokeDasharray',
  'strokeWidth',
  'borderWidth',
  'padding',
  'text',
  'innerText',
  'motionPath',
  'morphSVG',
  'drawSVG',
  'xPercent',
  'yPercent',
  'scale',
  'scaleX',
  'scaleY',
  'rotation',
  'skewX',
  'skewY',
  'opacity',
  'autoAlpha',
  'color',
  'backgroundColor',
  'borderColor',
  'borderRadius',
  'filter',
  'clipPath',
  'strokeDashoffset',
  'fill',
  'stroke',
  'transformOrigin',
]);

const EASE =
  /^(none|linear|(power[0-4]|back|elastic|bounce|circ|expo|sine|quad|cubic|quart|quint|strong)(\.(in|out|inOut))?(\(\d+(\.\d+)?(,\s*\d+(\.\d+)?)?\))?|steps\(\d{1,2}\)|slow(\(\d(\.\d+)?(,\s*\d(\.\d+)?)?\))?|expoScale\(\d+(\.\d+)?,\d+(\.\d+)?\)|(wiggle|shake)-\d{1,2})$/;
/** Wiggle eases a scene names (`wiggle-6` eases out, `shake-6` shakes evenly), made with CustomWiggle on the page. */
export const sceneWiggles = (spec: Pick<SceneSpec, 'tweens'>) => [...new Set(spec.tweens.map((t) => t.ease).filter((e): e is string => !!e && /^(wiggle|shake)-\d+$/.test(e)))];
const ID = /^[a-z][a-z0-9-]{0,30}$/;
const PATH = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/;
/** Plain CSS values only: no urls, no imports, no escapes, nothing that ends a declaration or a tag. */
const SAFE_VALUE = /^[#a-zA-Z0-9.,%()\s+\-/]*$/;
// GSAP's random() would make every render different.
const BAD_VALUE = /url\(|expression|image-set|element\(|attr\(|var\(|env\(|random\(|\/\*/i;

const round = (n: number) => Math.round(n * 1000) / 1000;
const num = (v: unknown, fallback: number, min: number, max: number) => Math.min(max, Math.max(min, typeof v === 'number' && Number.isFinite(v) ? v : fallback));

function cssValue(prop: string, value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return STYLE_PROPS[prop] ? `${round(value)}px` : String(round(value));
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v || v.length > 160) return null;
  if (prop === 'font-family') {
    const font = SCENE_FONTS.find((f) => v.toLowerCase().includes(f.toLowerCase()));
    return font ? `'${font}'` : null;
  }
  if (!SAFE_VALUE.test(v) || BAD_VALUE.test(v)) return null;
  if (prop === 'position' && !['absolute', 'relative'].includes(v)) return null;
  return v;
}

/** Keep only allowed properties with plain values; report what was dropped. */
function cleanStyle(input: unknown, problems: string[], where: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  for (const [rawKey, value] of Object.entries(input as Record<string, unknown>)) {
    // camelCase from habit (backgroundColor) is fine.
    const key = rawKey.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).replace(/^webkit-/, '-webkit-');
    if (!(key in STYLE_PROPS)) {
      problems.push(`${where}: style "${rawKey}" isn't allowed`);
      continue;
    }
    const v = cssValue(key, value);
    if (v === null) problems.push(`${where}: ${rawKey} value "${String(value).slice(0, 40)}" isn't allowed`);
    else out[key] = v;
  }
  return out;
}

function cleanVars(input: unknown, problems: string[], where: string): Record<string, string | number> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const out: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!TWEEN_PROPS.has(key)) {
      problems.push(`${where}: can't animate "${key}"`);
      continue;
    }
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = round(value);
    else if (typeof value === 'string' && (key === 'motionPath' || key === 'morphSVG') && (/^#[a-z][a-z0-9-]{0,30}$/.test(value) || (PATH.test(value) && value.length <= 2000))) out[key] = value;
    else if (typeof value === 'string' && key === 'text' && value.length <= 300 && !/[<>]/.test(value)) out[key] = value;
    else if (typeof value === 'string' && value.length <= 120 && SAFE_VALUE.test(value) && !BAD_VALUE.test(value)) out[key] = value;
    else problems.push(`${where}: ${key} value "${String(value).slice(0, 40)}" isn't allowed`);
  }
  return out;
}

/**
 * Fill in and clean a scene: unknown styles, values and tween properties are dropped, ids are made unique, tweens
 * point only at elements that exist and stay inside the scene's length. `problems` lists what was dropped (Claude is
 * told, so it can fix it).
 */
export function normalizeScene(input: unknown, length: number, problems: string[] = []): SceneSpec {
  const s = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const ids = new Set<string>();
  const elements: SceneElement[] = [];
  for (const [k, raw] of (Array.isArray(s.elements) ? s.elements : []).slice(0, SCENE_MAX_ELEMENTS).entries()) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as Record<string, unknown>;
    let id = typeof e.id === 'string' && ID.test(e.id) ? e.id : `e${k + 1}`;
    while (ids.has(id)) id = `${id}-${k}`;
    const kind = (['box', 'text', 'image', 'path', 'mascot'] as const).find((x) => x === e.kind) ?? 'box';
    const el: SceneElement = { id, kind, style: cleanStyle(e.style, problems, `element ${id}`) };
    if (kind === 'text') {
      el.text = typeof e.text === 'string' ? e.text.slice(0, 300) : '';
      if (e.split === 'words' || e.split === 'chars') el.split = e.split;
    }
    if (kind === 'image') {
      if (typeof e.mediaId !== 'string' || !e.mediaId) {
        problems.push(`element ${id}: an image needs a mediaId from the library`);
        continue;
      }
      el.mediaId = e.mediaId;
    }
    if (kind === 'path') {
      if (typeof e.d !== 'string' || !PATH.test(e.d) || e.d.length > 2000) {
        problems.push(`element ${id}: path data "d" is missing or not plain SVG path commands`);
        continue;
      }
      el.d = e.d.trim();
      el.draw = e.draw === true;
    }
    if (kind === 'mascot') {
      if (e.mascot !== undefined && !isMascot(e.mascot)) problems.push(`element ${id}: no mascot "${String(e.mascot).slice(0, 20)}" (the page's own is used)`);
      if (isMascot(e.mascot)) el.mascot = e.mascot;
      el.pose = isMascotPose(e.pose) ? e.pose : 'idle';
      if (e.pose !== undefined && !isMascotPose(e.pose)) problems.push(`element ${id}: no pose "${String(e.pose).slice(0, 20)}"`);
      if (e.flip === true) el.flip = true;
    }
    if (typeof e.parent === 'string' && ids.has(e.parent) && elements.find((p) => p.id === e.parent)?.kind === 'box') el.parent = e.parent;
    ids.add(id);
    elements.push(el);
  }

  const splits = new Map(elements.filter((e) => e.split).map((e) => [e.id, e.split!]));
  const tweens: SceneTween[] = [];
  for (const [k, raw] of (Array.isArray(s.tweens) ? s.tweens : []).slice(0, SCENE_MAX_TWEENS).entries()) {
    if (!raw || typeof raw !== 'object') continue;
    const t = raw as Record<string, unknown>;
    const where = `tween ${k + 1}`;
    const targets = (typeof t.targets === 'string' ? t.targets : '')
      .split(',')
      .map((x) => x.trim())
      .filter((x) => {
        const [id, part] = x.split('.');
        const ok = ids.has(id) && (!part || splits.get(id) === part);
        if (!ok) problems.push(`${where}: no element "${x}"${part ? ' (split the text first)' : ''}`);
        return ok;
      });
    // A mascot's pose is the rig's to change, not a CSS property.
    const { pose: toPose, ...rawTo } = t.to && typeof t.to === 'object' ? (t.to as Record<string, unknown>) : {};
    // Written as `to: { pose }`, kept as the tween's `pose`.
    const rawPose = toPose ?? t.pose;
    let pose: MascotPose | undefined;
    if (rawPose !== undefined) {
      if (!isMascotPose(rawPose)) problems.push(`${where}: no pose "${String(rawPose).slice(0, 20)}"`);
      else if (!targets.every((x) => elements.find((e) => e.id === x)?.kind === 'mascot')) problems.push(`${where}: only mascots have a pose`);
      else pose = rawPose;
    }
    const to = cleanVars(rawTo, problems, where) ?? {};
    if (!targets.length || (!Object.keys(to).length && !pose)) continue;
    const at = round(num(t.at, 0, 0, length));
    const tween: SceneTween = { targets: targets.join(','), at, duration: round(num(t.duration, 0.4, 0, Math.max(0, length - at))), to };
    if (pose) tween.pose = pose;
    const from = cleanVars(t.from, problems, where);
    if (from && Object.keys(from).length) tween.from = from;
    if (typeof t.ease === 'string' && EASE.test(t.ease.replace(/\s/g, ''))) tween.ease = t.ease.replace(/\s/g, '');
    else if (t.ease !== undefined) problems.push(`${where}: unknown ease "${String(t.ease).slice(0, 30)}"`);
    if (typeof t.stagger === 'number') tween.stagger = round(num(t.stagger, 0, 0, 2));
    else if (t.stagger && typeof t.stagger === 'object') {
      const st = t.stagger as Record<string, unknown>;
      const from = typeof st.from === 'number' ? Math.round(num(st.from, 0, 0, 200)) : (['start', 'center', 'end', 'edges'] as const).find((f) => f === st.from) ?? 'start';
      tween.stagger = { each: round(num(st.each, 0.05, 0, 2)), from };
    }
    if (typeof t.repeatDelay === 'number') tween.repeatDelay = round(num(t.repeatDelay, 0, 0, 5));
    if (t.physics && typeof t.physics === 'object') {
      const ph = t.physics as Record<string, unknown>;
      tween.physics = { velocity: round(num(ph.velocity, 600, 0, 6000)), angle: round(num(ph.angle, -90, -360, 360)), gravity: round(num(ph.gravity, 1200, -6000, 6000)), friction: round(num(ph.friction, 0, 0, 1)) };
    }
    // Finite repeats only: the render has to know when the scene ends.
    if (typeof t.repeat === 'number') tween.repeat = Math.round(num(t.repeat, 0, 0, 20));
    if (t.yoyo === true) tween.yoyo = true;
    const sound = SCENE_SOUNDS.find((x) => x === t.sound);
    if (sound) tween.sound = sound;
    else if (t.sound !== undefined) problems.push(`${where}: unknown sound "${String(t.sound).slice(0, 20)}"`);
    tweens.push(tween);
  }

  const bg = typeof s.background === 'string' ? s.background : 'none';
  const scene: SceneSpec = {
    name: typeof s.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 60) : 'Scene',
    background: bg === 'dim' || /^#[0-9a-f]{6}$/i.test(bg) ? bg.toLowerCase() : 'none',
    elements,
    tweens,
  };
  if (typeof s.preset === 'string' && ID.test(s.preset)) {
    scene.preset = s.preset;
    scene.fill = normalizeFill(s.fill);
  }
  return scene;
}

/** A library scene's words: a main line, a second line and a list. */
export function normalizeFill(input: unknown): NonNullable<SceneSpec['fill']> {
  const f = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const line = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  return {
    text: line(f.text, 300),
    sub: line(f.sub, 200),
    items: (Array.isArray(f.items) ? f.items : []).map((i) => line(i, 120)).filter(Boolean).slice(0, 8),
  };
}
