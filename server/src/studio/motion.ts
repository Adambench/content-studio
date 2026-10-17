// Camera moves on clips, colour looks and film textures, and how overlays come in: the CSS and GSAP for the named
// choices in shared/looks.ts. Everything is seek-safe (fromTo / set with fixed values, finite repeats, no randomness).

import { FILTER_LOOK_INFO, type ClipMotion, type FilterLook, type OverlayAnimation, type Textures } from '../../../shared/looks';
import { js, n, px } from './html';

type MotionState = { scale: number; x: number; y: number; rotation: number };
const REST: MotionState = { scale: 1, x: 0, y: 0, rotation: 0 };

/** The move's start and end (a pan travels inside the extra room its zoom gives). */
function motionEnds(motion: ClipMotion, W: number, H: number): { from: MotionState; to: MotionState; ease: string } | null {
  const ax = W * 0.06;
  const ay = H * 0.06;
  const s = (scale: number, x = 0, y = 0, rotation = 0): MotionState => ({ scale, x, y, rotation });
  switch (motion) {
    case 'push-in':
      return { from: s(1), to: s(1.16), ease: 'none' };
    case 'pull-out':
      return { from: s(1.16), to: s(1), ease: 'none' };
    case 'pan-left':
      return { from: s(1.15, ax), to: s(1.15, -ax), ease: 'none' };
    case 'pan-right':
      return { from: s(1.15, -ax), to: s(1.15, ax), ease: 'none' };
    case 'pan-up':
      return { from: s(1.15, 0, -ay), to: s(1.15, 0, ay), ease: 'none' };
    case 'pan-down':
      return { from: s(1.15, 0, ay), to: s(1.15, 0, -ay), ease: 'none' };
    case 'drift':
      return { from: s(1.08, -ax / 2, ax / 3, -0.6), to: s(1.14, ax / 2, -ax / 3, 0.6), ease: 'none' };
    case 'tilt':
      return { from: s(1.12, 0, 0, 0), to: s(1.12, 0, 0, 3.5), ease: 'none' };
    default:
      return null;
  }
}

/** Where a clip's camera move has the picture at the start (`at` = 0) or end (`at` = 1) of the clip: transitions start their copies there. */
export function motionState(motion: ClipMotion, at: 0 | 1, W: number, H: number): MotionState {
  const ends = motionEnds(motion, W, H);
  if (ends) return at === 0 ? ends.from : ends.to;
  if (motion === 'punch') return at === 0 ? { ...REST, scale: 1.28 } : REST;
  if (motion === 'shake' || motion === 'handheld') return { ...REST, scale: 1.06 };
  return REST;
}

/** CSS individual transform properties for a copy held at a motion state (they stack under GSAP's own transform). */
export function motionStyle(m: MotionState) {
  if (m.scale === 1 && !m.x && !m.y && !m.rotation) return '';
  return `;scale:${n(m.scale)};translate:${px(m.x)} ${px(m.y)};rotate:${n(m.rotation)}deg`;
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;
const state = (m: MotionState) => ({ scale: r3(m.scale), x: r3(m.x), y: r3(m.y), rotation: r3(m.rotation) });

/** The tweens of a clip's camera move on `#c<i>`, over its time on the finished video. */
export function motionTweens(sel: string, motion: ClipMotion, start: number, len: number, W: number, H: number): string[] {
  const t = js(sel);
  const ends = motionEnds(motion, W, H);
  if (ends) return [`tl.fromTo(${t}, ${js(state(ends.from))}, { ...${js(state(ends.to))}, duration: ${n(len)}, ease: '${ends.ease}' }, ${n(start)});`];
  switch (motion) {
    case 'punch':
      return [`tl.fromTo(${t}, { scale: 1.28 }, { scale: 1, duration: ${n(Math.min(0.45, len))}, ease: 'power3.out' }, ${n(start)});`];
    case 'pulse': {
      const beats = Math.max(1, Math.floor(len / 0.5));
      return [`tl.fromTo(${t}, { scale: 1 }, { scale: 1.05, duration: ${n(len / beats)}, ease: 'sine.inOut', yoyo: true, repeat: ${beats - 1} }, ${n(start)});`];
    }
    case 'shake': {
      const kicks: [number, number, number][] = [
        [-26, 14, -1.2],
        [22, -12, 1],
        [-16, 8, -0.7],
        [12, -6, 0.5],
        [-7, 4, -0.25],
        [3, -2, 0.1],
        [0, 0, 0],
      ];
      const step = Math.min(0.05, len / kicks.length);
      return [`tl.set(${t}, { scale: 1.06, x: 0, y: 0, rotation: 0 }, ${n(start)});`, ...kicks.map(([x, y, r], k) => `tl.set(${t}, { x: ${x}, y: ${y}, rotation: ${r} }, ${n(start + (k + 1) * step)});`)];
    }
    case 'handheld': {
      // A slow wander from a fixed list of offsets, eased from one to the next.
      const path: [number, number, number][] = [
        [6, -4, 0.3],
        [-5, 3, -0.25],
        [3, 6, 0.15],
        [-7, -2, -0.3],
        [4, -5, 0.2],
        [-2, 4, -0.1],
        [7, 2, 0.25],
        [-4, -6, -0.2],
      ];
      const step = 0.7;
      const count = Math.min(400, Math.max(1, Math.ceil(len / step)));
      const keyframes = Array.from({ length: count }, (_, k) => {
        const [x, y, r] = path[k % path.length];
        return { x, y, rotation: r, duration: r3(Math.min(step, len / count)), ease: 'sine.inOut' };
      });
      return [`tl.fromTo(${t}, { scale: 1.06, x: 0, y: 0, rotation: 0 }, { keyframes: ${js(keyframes)} }, ${n(start)});`];
    }
    default:
      return [];
  }
}

// ---------- colour looks and textures ----------

export const filterCss = (look: FilterLook) => FILTER_LOOK_INFO[look].css;

/** A picture's colour look as a style declaration (empty for none). */
export const lookStyle = (look: FilterLook) => (look === 'none' ? '' : `;filter:${filterCss(look)}`);

const NOISE = `data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='256' height='256'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`,
)}`;

/** Film textures over the whole video, under the overlays and captions. */
export function textureLayers(t: Textures, duration: number, W: number, H: number, accentColor: string) {
  const html: string[] = [];
  const tweens: string[] = [];
  const timing = `data-start="0" data-duration="${n(duration)}" data-track-index="9"`;
  if (t.leak > 0) {
    html.push(
      `<div id="fx-leak" class="clip layer" ${timing} style="z-index:16;overflow:hidden;mix-blend-mode:screen;opacity:${n(0.25 + t.leak * 0.6)}"><div class="leak" style="position:absolute;left:${px(-W * 0.6)};top:${px(-H * 0.1)};width:${px(W * 1.6)};height:${px(H * 1.2)};background:radial-gradient(ellipse 38% 30% at 30% 35%, rgba(255,150,60,.85), transparent 70%),radial-gradient(ellipse 30% 26% at 62% 60%, rgba(255,70,110,.6), transparent 70%),radial-gradient(ellipse 26% 40% at 80% 25%, rgba(255,220,120,.55), transparent 70%)"></div></div>`,
    );
    const cycle = 7;
    const repeats = Math.max(0, Math.ceil(duration / cycle) - 1);
    tweens.push(`tl.fromTo('#fx-leak .leak', { x: 0, opacity: 0.55 }, { x: ${n(W * 0.6)}, opacity: 1, duration: ${cycle}, ease: 'sine.inOut', yoyo: true, repeat: ${repeats} }, 0);`);
  }
  if (t.grain > 0) {
    html.push(
      `<div id="fx-grain" class="clip layer" ${timing} style="z-index:17;mix-blend-mode:overlay;opacity:${n(0.12 + t.grain * 0.5)};background-image:url(&quot;${NOISE}&quot;);background-size:256px 256px"></div>`,
    );
    // Jump the noise to a new place 12 times a second, so it crawls like film grain.
    const cycle = 8 / 12;
    const repeats = Math.max(0, Math.ceil(duration / cycle) - 1);
    tweens.push(`tl.fromTo('#fx-grain', { backgroundPosition: '0px 0px' }, { backgroundPosition: '904px 584px', duration: ${n(cycle)}, ease: 'steps(8)', repeat: ${repeats} }, 0);`);
  }
  if (t.scanlines > 0) {
    const a = n(0.12 + t.scanlines * 0.4);
    html.push(
      `<div id="fx-lines" class="clip layer" ${timing} style="z-index:17;background:repeating-linear-gradient(0deg, rgba(0,0,0,${a}) 0px, rgba(0,0,0,${a}) 2px, transparent 2px, transparent 6px)"></div>`,
    );
  }
  if (t.vignette > 0) {
    html.push(`<div id="fx-vignette" class="clip layer" ${timing} style="z-index:18;background:radial-gradient(ellipse at center, transparent 50%, rgba(0,0,0,${n(0.3 + t.vignette * 0.6)}) 100%)"></div>`);
  }
  if (t.letterbox) {
    const bar = px(H * 0.1);
    html.push(
      `<div id="fx-bars" class="clip layer" ${timing} style="z-index:19"><div style="position:absolute;left:0;right:0;top:0;height:${bar};background:#000"></div><div style="position:absolute;left:0;right:0;bottom:0;height:${bar};background:#000"></div></div>`,
    );
  }
  if (t.border > 0) {
    html.push(`<div id="fx-border" class="clip layer" ${timing} style="z-index:19;box-shadow:inset 0 0 0 ${px(t.border * W)} ${accentColor}"></div>`);
  }
  return { html, tweens };
}

// ---------- overlays coming in ----------

/** Wrap each visible character of escaped HTML (tags kept whole) so a typewriter can show them one by one. */
export function splitChars(html: string) {
  return html.replace(/(<[^>]*>)|(&[#a-z0-9]+;|[^<&\s])/gi, (whole, tag: string | undefined, ch: string | undefined) => (tag ? tag : `<span class="ch">${ch}</span>`));
}

/** How an overlay (`target`, its timed layer `layer`) comes in, and fades out at its end. */
export function animateIn(target: string, kind: OverlayAnimation, start: number, len: number, chars = 0): string[] {
  const out: string[] = [];
  const t = js(target);
  const at = n(start);
  switch (kind) {
    case 'pop':
      out.push(`tl.fromTo(${t}, { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.28, ease: 'back.out(2.2)' }, ${at});`);
      break;
    case 'fade':
      out.push(`tl.fromTo(${t}, { opacity: 0 }, { opacity: 1, duration: 0.3 }, ${at});`);
      break;
    case 'slide':
      out.push(`tl.fromTo(${t}, { y: 60, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: 'power3.out' }, ${at});`);
      break;
    case 'drop':
      out.push(`tl.fromTo(${t}, { y: -160, opacity: 0 }, { y: 0, opacity: 1, duration: 0.55, ease: 'bounce.out' }, ${at});`);
      break;
    case 'zoom':
      out.push(`tl.fromTo(${t}, { scale: 2.4, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, ease: 'power4.out' }, ${at});`);
      break;
    case 'blur':
      out.push(`tl.fromTo(${t}, { filter: 'blur(24px)', opacity: 0 }, { filter: 'blur(0px)', opacity: 1, duration: 0.45, ease: 'power2.out' }, ${at});`);
      break;
    case 'bounce':
      out.push(`tl.fromTo(${t}, { y: 140, scale: 0.8, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.7, ease: 'elastic.out(1, 0.5)' }, ${at});`);
      break;
    case 'spin':
      out.push(`tl.fromTo(${t}, { rotation: -200, scale: 0, opacity: 0 }, { rotation: 0, scale: 1, opacity: 1, duration: 0.55, ease: 'back.out(1.6)' }, ${at});`);
      break;
    case 'flip':
      out.push(`tl.fromTo(${t}, { rotationX: 90, transformPerspective: 900, opacity: 0 }, { rotationX: 0, opacity: 1, duration: 0.5, ease: 'power3.out' }, ${at});`);
      break;
    case 'wipe':
      out.push(`tl.fromTo(${t}, { clipPath: 'inset(-20% 100% -20% -2%)' }, { clipPath: 'inset(-20% -2% -20% -2%)', duration: 0.5, ease: 'power2.inOut' }, ${at});`);
      break;
    case 'typewriter': {
      if (chars > 0) {
        const step = Math.min(0.06, (len * 0.6) / chars);
        out.push(`tl.fromTo(${js(`${target} .ch`)}, { opacity: 0 }, { opacity: 1, duration: 0.001, stagger: ${n(step)} }, ${at});`);
      } else out.push(`tl.fromTo(${t}, { clipPath: 'inset(-20% 100% -20% -2%)' }, { clipPath: 'inset(-20% -2% -20% -2%)', duration: 0.6, ease: 'steps(12)' }, ${at});`);
      break;
    }
    case 'shake': {
      out.push(`tl.fromTo(${t}, { opacity: 0, scale: 1.2 }, { opacity: 1, scale: 1, duration: 0.12, ease: 'power2.out' }, ${at});`);
      [-18, 15, -11, 8, -4, 0].forEach((x, k) => out.push(`tl.set(${t}, { x: ${x}, rotation: ${n(x / 6)} }, ${n(start + 0.12 + k * 0.045)});`));
      break;
    }
    case 'glitch': {
      const steps: [number, number, number, number][] = [
        [1, -24, 10, 90],
        [0, 0, 0, 0],
        [1, 18, -8, -70],
        [1, -10, 5, 160],
        [0, 0, 0, 0],
        [1, 6, -3, 30],
        [1, 0, 0, 0],
      ];
      steps.forEach(([o, x, sk, hue], k) => out.push(`tl.set(${t}, { opacity: ${o}, x: ${x}, skewX: ${sk}, filter: 'hue-rotate(${hue}deg)' }, ${n(start + k * 0.045)});`));
      out.push(`tl.set(${t}, { filter: 'none' }, ${n(start + steps.length * 0.045)});`);
      break;
    }
    case 'float': {
      out.push(`tl.fromTo(${t}, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.4, ease: 'power2.out' }, ${at});`);
      const swings = Math.floor((len - 0.6) / 1.2);
      if (swings > 0) out.push(`tl.fromTo(${t}, { y: 0 }, { y: -16, duration: 1.2, ease: 'sine.inOut', yoyo: true, repeat: ${swings - 1} }, ${n(start + 0.4)});`);
      break;
    }
    case 'pulse': {
      out.push(`tl.fromTo(${t}, { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.28, ease: 'back.out(2.2)' }, ${at});`);
      const beats = Math.floor((len - 0.5) / 0.45);
      if (beats > 0) out.push(`tl.fromTo(${t}, { scale: 1 }, { scale: 1.08, duration: 0.45, ease: 'sine.inOut', yoyo: true, repeat: ${beats - 1} }, ${n(start + 0.28)});`);
      break;
    }
    case 'none':
      break;
  }
  if (kind !== 'none' && len > 0.6) out.push(`tl.to(${t}, { opacity: 0, duration: 0.2 }, ${n(start + len - 0.2)});`);
  return out;
}
