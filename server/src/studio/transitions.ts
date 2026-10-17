import type { TransitionType, TransitionWindow } from '../../../shared/edit';
import { js, n } from './html';

/** Where the frame sits inside each copy's own box (pixels), so clip-path shapes line up with what's on screen. */
export type FrameBox = { x: number; y: number };

/** Transitions that cover the cut with a full-frame white layer (`#tw<i>`) or a light leak (`#tx<i>`). */
export const WHITE_LAYER: TransitionType[] = ['flash', 'dip-white', 'burn'];
export const LEAK_LAYER: TransitionType[] = ['light-leak'];
/** Transitions where the outgoing shot has to sit on top of the incoming one (it leaves to show the next). */
export const OUTGOING_ON_TOP: TransitionType[] = ['gravity', 'zoom-out'];

/** Rectangle points as a polygon, in a copy's own pixels. */
const poly = (pts: [number, number][]) => `polygon(${pts.map(([x, y]) => `${n(x)}px ${n(y)}px`).join(', ')})`;

/**
 * GSAP for one transition: `#ta<i>` is the outgoing shot, `#tb<i>` the incoming one (on top unless OUTGOING_ON_TOP),
 * `#tw<i>` a white layer, `#tx<i>` a light leak. Everything is seek-safe: fromTo with explicit start states, no
 * randomness. `fa`/`fb` are where the frame sits inside each copy.
 */
export function transitionTweens(w: TransitionWindow, W: number, H: number, scales: { a: number; b: number }, fa: FrameBox, fb: FrameBox, looks: { a: string; b: string }): string[] {
  const tweens = shotTweens(w, W, H, scales, fa, fb);
  // Each shot's colour look stays under whatever filter the transition animates on it.
  const keep = (tween: string) => {
    const look = tween.includes(`("#ta${w.index}"`) ? looks.a : tween.includes(`("#tb${w.index}"`) ? looks.b : '';
    if (!look) return tween;
    return tween.replace(/filter: '([^']*)'/g, (_, v: string) => `filter: '${v === 'none' ? look : `${v} ${look}`}'`);
  };
  return tweens.map(keep);
}

function shotTweens(w: TransitionWindow, W: number, H: number, scales: { a: number; b: number }, fa: FrameBox, fb: FrameBox): string[] {
  const a = js(`#ta${w.index}`);
  const b = js(`#tb${w.index}`);
  // One tween per shot, so each keeps its own colour look under the transition's filters.
  const each = (tween: (t: string) => string) => [tween(a), tween(b)];
  const white = js(`#tw${w.index}`);
  const s = n(w.start);
  const m = n(w.at);
  const half = w.at - w.start;
  const d = n(w.end - w.start);
  const h = n(half);
  const { a: sa, b: sb } = scales;
  // The incoming shot shows from the cut on (for the transitions that hand over at the middle).
  const showB = `tl.fromTo(${b}, { opacity: 0 }, { opacity: 1, duration: 0.001 }, ${m});`;
  const hideB = `tl.fromTo(${b}, { opacity: 0 }, { opacity: 0, duration: 0.001 }, ${s});`;
  const frameA = (inset: number) => poly([[fa.x, fa.y + inset], [fa.x + W, fa.y + inset], [fa.x + W, fa.y + H - inset], [fa.x, fa.y + H - inset]]);
  const frameB = (inset: number) => poly([[fb.x, fb.y + inset], [fb.x + W, fb.y + inset], [fb.x + W, fb.y + H - inset], [fb.x, fb.y + H - inset]]);
  switch (w.type) {
    case 'fade':
      return [`tl.fromTo(${b}, { opacity: 0 }, { opacity: 1, duration: ${d}, ease: 'sine.inOut' }, ${s});`];
    case 'dip':
      return [`tl.fromTo(${a}, { opacity: 1 }, { opacity: 0, duration: ${h}, ease: 'power1.in' }, ${s});`, `tl.fromTo(${b}, { opacity: 0 }, { opacity: 1, duration: ${h}, ease: 'power1.out' }, ${m});`];
    case 'dip-white':
      return [
        hideB,
        `tl.fromTo(${white}, { opacity: 0 }, { opacity: 1, duration: ${h}, ease: 'power1.in' }, ${s});`,
        showB,
        `tl.to(${white}, { opacity: 0, duration: ${h}, ease: 'power1.out' }, ${m});`,
      ];
    case 'flash':
      return [
        `tl.fromTo(${white}, { opacity: 0 }, { opacity: 0.95, duration: ${h}, ease: 'power2.in' }, ${s});`,
        `tl.fromTo(${a}, { filter: 'brightness(1)' }, { filter: 'brightness(2.4)', duration: ${h}, ease: 'power2.in' }, ${s});`,
        showB,
        `tl.fromTo(${b}, { filter: 'brightness(2.4)' }, { filter: 'brightness(1)', duration: ${h}, ease: 'power2.out' }, ${m});`,
        `tl.to(${white}, { opacity: 0, duration: ${h}, ease: 'power2.out' }, ${m});`,
      ];
    case 'burn':
      return [
        `tl.fromTo(${a}, { filter: 'brightness(1) saturate(1)' }, { filter: 'brightness(3.2) saturate(0.3)', duration: ${h}, ease: 'power2.in' }, ${s});`,
        `tl.fromTo(${white}, { opacity: 0 }, { opacity: 0.85, duration: ${h}, ease: 'power3.in' }, ${s});`,
        showB,
        `tl.fromTo(${b}, { filter: 'brightness(3.2) saturate(0.3)' }, { filter: 'brightness(1) saturate(1)', duration: ${h}, ease: 'power2.out' }, ${m});`,
        `tl.to(${white}, { opacity: 0, duration: ${h}, ease: 'power2.out' }, ${m});`,
      ];
    case 'light-leak': {
      const leak = js(`#tx${w.index}`);
      return [
        `tl.fromTo(${leak}, { x: 0, opacity: 0 }, { x: ${n(W * 2.2)}, duration: ${d}, ease: 'sine.inOut' }, ${s});`,
        `tl.to(${leak}, { opacity: 1, duration: ${n(half * 0.8)}, ease: 'sine.out' }, ${s});`,
        `tl.to(${leak}, { opacity: 0, duration: ${n(half * 0.8)}, ease: 'sine.in' }, ${n(w.end - half * 0.8)});`,
        `tl.fromTo(${a}, { filter: 'brightness(1)' }, { filter: 'brightness(1.5)', duration: ${h}, ease: 'sine.in' }, ${s});`,
        `tl.fromTo(${b}, { opacity: 0, filter: 'brightness(1.5)' }, { opacity: 1, duration: ${n(half * 0.8)}, ease: 'sine.inOut' }, ${n(w.at - half * 0.4)});`,
        `tl.to(${b}, { filter: 'brightness(1)', duration: ${h}, ease: 'sine.out' }, ${m});`,
      ];
    }
    case 'zoom':
      return [
        `tl.fromTo(${a}, { scale: ${sa}, filter: 'blur(0px)' }, { scale: ${n(sa * 1.6)}, filter: 'blur(14px)', duration: ${h}, ease: 'power3.in' }, ${s});`,
        showB,
        `tl.fromTo(${b}, { scale: ${n(sb * 1.5)}, filter: 'blur(14px)' }, { scale: ${sb}, filter: 'blur(0px)', duration: ${h}, ease: 'power3.out' }, ${m});`,
      ];
    case 'zoom-out':
      // The outgoing shot is on top here.
      return [
        `tl.fromTo(${a}, { scale: ${sa}, opacity: 1, rotation: 0 }, { scale: ${n(sa * 0.25)}, opacity: 0, rotation: -6, duration: ${d}, ease: 'power3.in' }, ${s});`,
        `tl.fromTo(${b}, { scale: ${n(sb * 1.2)} }, { scale: ${sb}, duration: ${d}, ease: 'power2.out' }, ${s});`,
      ];
    case 'whip':
      return [
        `tl.fromTo(${a}, { x: 0 }, { x: ${-W}, duration: ${d}, ease: 'power4.inOut' }, ${s});`,
        `tl.fromTo(${b}, { x: ${W} }, { x: 0, duration: ${d}, ease: 'power4.inOut' }, ${s});`,
        ...each((t) => `tl.fromTo(${t}, { filter: 'blur(0px)' }, { filter: 'blur(18px)', duration: ${h}, ease: 'power2.in' }, ${s});`),
        ...each((t) => `tl.to(${t}, { filter: 'blur(0px)', duration: ${h}, ease: 'power2.out' }, ${m});`),
      ];
    case 'whip-up':
      return [
        `tl.fromTo(${a}, { y: 0 }, { y: ${-H}, duration: ${d}, ease: 'power4.inOut' }, ${s});`,
        `tl.fromTo(${b}, { y: ${H} }, { y: 0, duration: ${d}, ease: 'power4.inOut' }, ${s});`,
        ...each((t) => `tl.fromTo(${t}, { filter: 'blur(0px)' }, { filter: 'blur(18px)', duration: ${h}, ease: 'power2.in' }, ${s});`),
        ...each((t) => `tl.to(${t}, { filter: 'blur(0px)', duration: ${h}, ease: 'power2.out' }, ${m});`),
      ];
    case 'slide':
      return [
        `tl.fromTo(${a}, { y: 0 }, { y: ${-H}, duration: ${d}, ease: 'power3.inOut' }, ${s});`,
        `tl.fromTo(${b}, { y: ${H} }, { y: 0, duration: ${d}, ease: 'power3.inOut' }, ${s});`,
        ...each((t) => `tl.fromTo(${t}, { filter: 'blur(0px)' }, { filter: 'blur(6px)', duration: ${h}, ease: 'power2.in' }, ${s});`),
        ...each((t) => `tl.to(${t}, { filter: 'blur(0px)', duration: ${h}, ease: 'power2.out' }, ${m});`),
      ];
    case 'push':
      return [`tl.fromTo(${a}, { x: 0 }, { x: ${-W}, duration: ${d}, ease: 'power3.inOut' }, ${s});`, `tl.fromTo(${b}, { x: ${W} }, { x: 0, duration: ${d}, ease: 'power3.inOut' }, ${s});`];
    case 'drop':
      return [
        `tl.fromTo(${a}, { y: 0, filter: 'brightness(1)' }, { y: ${n(H * 0.25)}, filter: 'brightness(0.5)', duration: ${d}, ease: 'power3.inOut' }, ${s});`,
        `tl.fromTo(${b}, { y: ${-H} }, { y: 0, duration: ${d}, ease: 'power3.inOut' }, ${s});`,
      ];
    case 'bounce':
      return [
        `tl.fromTo(${a}, { scale: ${sa}, filter: 'brightness(1)' }, { scale: ${n(sa * 0.9)}, filter: 'brightness(0.55)', duration: ${d}, ease: 'power2.in' }, ${s});`,
        `tl.fromTo(${b}, { y: ${H} }, { y: 0, duration: ${d}, ease: 'bounce.out' }, ${s});`,
      ];
    case 'blur':
      return [
        `tl.fromTo(${a}, { filter: 'blur(0px)' }, { filter: 'blur(26px)', duration: ${n(half * 1.3)}, ease: 'sine.in' }, ${s});`,
        `tl.fromTo(${b}, { opacity: 0, filter: 'blur(26px)' }, { opacity: 1, filter: 'blur(0px)', duration: ${n(half * 1.4)}, ease: 'sine.out' }, ${n(w.end - half * 1.4)});`,
      ];
    case 'spin':
      return [
        `tl.fromTo(${a}, { rotation: 0, scale: ${sa}, opacity: 1 }, { rotation: -120, scale: ${n(sa * 0.3)}, opacity: 0, duration: ${h}, ease: 'power3.in' }, ${s});`,
        showB,
        `tl.fromTo(${b}, { rotation: 120, scale: ${n(sb * 0.3)} }, { rotation: 0, scale: ${sb}, duration: ${h}, ease: 'power3.out' }, ${m});`,
      ];
    case 'flip':
      return [
        `tl.fromTo(${a}, { rotationY: 0, transformPerspective: 1800 }, { rotationY: 90, duration: ${h}, ease: 'power2.in' }, ${s});`,
        showB,
        `tl.fromTo(${b}, { rotationY: -90, transformPerspective: 1800 }, { rotationY: 0, duration: ${h}, ease: 'power2.out' }, ${m});`,
      ];
    case 'cube': {
      // Both faces turn about the cube's centre, half a frame behind the screen.
      const depth = n(W / 2);
      return [
        `tl.fromTo(${a}, { rotationY: 0, transformPerspective: 2400, transformOrigin: '${n(fa.x + W / 2)}px ${n(fa.y + H / 2)}px -${depth}px' }, { rotationY: -90, duration: ${d}, ease: 'power2.inOut' }, ${s});`,
        `tl.fromTo(${b}, { rotationY: 90, transformPerspective: 2400, transformOrigin: '${n(fb.x + W / 2)}px ${n(fb.y + H / 2)}px -${depth}px' }, { rotationY: 0, duration: ${d}, ease: 'power2.inOut' }, ${s});`,
        ...each((t) => `tl.fromTo(${t}, { filter: 'brightness(1)' }, { filter: 'brightness(0.7)', duration: ${h}, ease: 'sine.in' }, ${s});`),
        ...each((t) => `tl.to(${t}, { filter: 'brightness(1)', duration: ${h}, ease: 'sine.out' }, ${m});`),
      ];
    }
    case 'squeeze':
      return [
        `tl.fromTo(${a}, { scaleX: ${sa}, transformOrigin: '${n(fa.x)}px 50%' }, { scaleX: 0, duration: ${d}, ease: 'power3.inOut' }, ${s});`,
        `tl.fromTo(${b}, { scaleX: 0, transformOrigin: '${n(fb.x + W)}px 50%' }, { scaleX: ${sb}, duration: ${d}, ease: 'power3.inOut' }, ${s});`,
      ];
    case 'stretch':
      return [
        `tl.fromTo(${a}, { scaleY: ${sa}, filter: 'blur(0px)' }, { scaleY: ${n(sa * 3)}, filter: 'blur(16px)', duration: ${h}, ease: 'power3.in' }, ${s});`,
        showB,
        `tl.fromTo(${b}, { scaleY: ${n(sb * 3)}, filter: 'blur(16px)' }, { scaleY: ${sb}, filter: 'blur(0px)', duration: ${h}, ease: 'power3.out' }, ${m});`,
      ];
    case 'gravity':
      // The outgoing shot is on top: it tips and falls away to show the next one.
      return [
        `tl.fromTo(${a}, { y: 0, rotation: 0, transformOrigin: '${n(fa.x)}px ${n(fa.y + H)}px' }, { y: ${n(H * 1.15)}, rotation: 14, duration: ${d}, ease: 'power2.in' }, ${s});`,
        `tl.fromTo(${b}, { filter: 'brightness(0.6)' }, { filter: 'brightness(1)', duration: ${d}, ease: 'sine.out' }, ${s});`,
      ];
    case 'iris': {
      const cx = n(fb.x + W / 2);
      const cy = n(fb.y + H / 2);
      const r = n(Math.hypot(W, H) / 2 + 4);
      return [`tl.fromTo(${b}, { clipPath: 'circle(0px at ${cx}px ${cy}px)' }, { clipPath: 'circle(${r}px at ${cx}px ${cy}px)', duration: ${d}, ease: 'power2.inOut' }, ${s});`];
    }
    case 'wipe': {
      const from = poly([[fb.x, fb.y], [fb.x, fb.y], [fb.x, fb.y + H], [fb.x, fb.y + H]]);
      const to = poly([[fb.x, fb.y], [fb.x + W, fb.y], [fb.x + W, fb.y + H], [fb.x, fb.y + H]]);
      return [`tl.fromTo(${b}, { clipPath: ${js(from)} }, { clipPath: ${js(to)}, duration: ${d}, ease: 'power2.inOut' }, ${s});`];
    }
    case 'diagonal': {
      const slant = W * 0.45;
      const shape = (p: number) => {
        const top = fb.x + p * (W + slant);
        return poly([[fb.x - slant, fb.y], [top, fb.y], [top - slant, fb.y + H], [fb.x - slant, fb.y + H]]);
      };
      return [`tl.fromTo(${b}, { clipPath: ${js(shape(0))} }, { clipPath: ${js(shape(1))}, duration: ${d}, ease: 'power2.inOut' }, ${s});`];
    }
    case 'blinds': {
      const strips = 8;
      const strip = H / strips;
      // One polygon of every strip, joined along the left edge; each opens from its middle.
      const shape = (open: number) => {
        const pts: [number, number][] = [];
        for (let k = 0; k < strips; k++) {
          const top = fb.y + k * strip + ((1 - open) * strip) / 2;
          const bottom = top + open * strip;
          pts.push([fb.x, top], [fb.x + W, top], [fb.x + W, bottom], [fb.x, bottom]);
        }
        return poly(pts);
      };
      return [`tl.fromTo(${b}, { clipPath: ${js(shape(0))} }, { clipPath: ${js(shape(1.02))}, duration: ${d}, ease: 'power2.inOut' }, ${s});`];
    }
    case 'shutter':
      return [
        `tl.fromTo(${a}, { clipPath: ${js(frameA(0))} }, { clipPath: ${js(frameA(H / 2))}, duration: ${h}, ease: 'power3.in' }, ${s});`,
        showB,
        `tl.fromTo(${b}, { clipPath: ${js(frameB(H / 2))} }, { clipPath: ${js(frameB(0))}, duration: ${h}, ease: 'power3.out' }, ${m});`,
      ];
    case 'shake': {
      // A hard cut, then the new shot shakes like the camera took a hit.
      const steps = [
        [-30, 16, -1.4],
        [26, -12, 1.1],
        [-18, 9, -0.7],
        [12, -6, 0.45],
        [-6, 3, -0.2],
        [0, 0, 0],
      ];
      const step = Math.max(0.025, (w.end - w.at) / steps.length);
      return [
        showB,
        `tl.fromTo(${b}, { scale: ${n(sb * 1.08)}, filter: 'brightness(1.6)' }, { scale: ${sb}, filter: 'brightness(1)', duration: ${n(w.end - w.at)}, ease: 'power2.out' }, ${m});`,
        ...steps.map(([x, y, r], k) => `tl.set(${b}, { x: ${x}, y: ${y}, rotation: ${r} }, ${n(w.at + k * step)});`),
      ];
    }
    case 'glitch': {
      // A fixed stutter: the shots jump sideways, skew and shift colour, the incoming one taking over halfway.
      const steps = [
        { x: -46, skew: 8, hue: 90, on: 'a' },
        { x: 34, skew: -6, hue: -60, on: 'a' },
        { x: -18, skew: 12, hue: 160, on: 'b' },
        { x: 52, skew: -10, hue: -120, on: 'a' },
        { x: -30, skew: 5, hue: 40, on: 'b' },
        { x: 14, skew: -3, hue: 0, on: 'b' },
      ];
      const step = (w.end - w.start) / (steps.length + 1);
      const out = [hideB];
      steps.forEach((st, k) => {
        const t = n(w.start + step * (k + 0.5));
        const target = st.on === 'a' ? a : b;
        out.push(`tl.set(${b}, { opacity: ${st.on === 'b' ? 1 : 0} }, ${t});`);
        out.push(`tl.set(${target}, { x: ${st.x}, skewX: ${st.skew}, filter: 'hue-rotate(${st.hue}deg) contrast(1.6) saturate(1.8)' }, ${t});`);
      });
      out.push(`tl.set(${b}, { opacity: 1, x: 0, skewX: 0, filter: 'none' }, ${n(w.end - step / 2)});`);
      return out;
    }
  }
}
