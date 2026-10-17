// How each caption preset looks and moves: its font, CSS, how a chunk comes in, and what happens to each word as it's
// said (it lights up, appears, or types out). compose.ts lays out the chunks; this file styles and times them.

import type { CaptionPage, CaptionPreset, CaptionSettings } from '../../../shared/edit';
import { esc, js, n, px } from './html';

type Style = { family: string; weight: number; size: number; line: number };

export const CAPTION_STYLE: Record<CaptionPreset, Style> = {
  bold: { family: 'Montserrat', weight: 900, size: 78, line: 1.08 },
  karaoke: { family: 'Montserrat', weight: 800, size: 70, line: 1.1 },
  clean: { family: 'Inter', weight: 700, size: 56, line: 1.25 },
  subtitle: { family: 'Inter', weight: 600, size: 50, line: 1.3 },
  pop: { family: 'Montserrat', weight: 900, size: 118, line: 1 },
  box: { family: 'Montserrat', weight: 900, size: 72, line: 1.3 },
  marker: { family: 'Montserrat', weight: 800, size: 68, line: 1.3 },
  reveal: { family: 'Montserrat', weight: 900, size: 76, line: 1.08 },
  bounce: { family: 'Montserrat', weight: 900, size: 76, line: 1.1 },
  impact: { family: 'Anton', weight: 400, size: 124, line: 0.98 },
  neon: { family: 'Montserrat', weight: 800, size: 72, line: 1.15 },
  outline: { family: 'Montserrat', weight: 900, size: 80, line: 1.08 },
  retro: { family: 'Anton', weight: 400, size: 104, line: 1.05 },
  glitch: { family: 'Montserrat', weight: 900, size: 76, line: 1.08 },
  comic: { family: 'Bangers', weight: 400, size: 100, line: 1.05 },
  handwritten: { family: 'Permanent Marker', weight: 400, size: 72, line: 1.15 },
  editorial: { family: 'Playfair Display', weight: 700, size: 66, line: 1.2 },
  typewriter: { family: 'JetBrains Mono', weight: 600, size: 50, line: 1.35 },
  minimal: { family: 'Inter', weight: 500, size: 46, line: 1.3 },
  arcade: { family: 'Press Start 2P', weight: 400, size: 42, line: 1.6 },
};

/** What the spoken word changes to while it's said (and back after), or how words come in. */
type WordMode = { kind: 'highlight'; on: Record<string, unknown>; off: Record<string, unknown> } | { kind: 'appear' | 'bounce' | 'type' | 'marker' | 'jitter' } | { kind: 'none' };

function wordMode(preset: CaptionPreset, c: CaptionSettings): WordMode {
  const hl = (on: Record<string, unknown>, off: Record<string, unknown>): WordMode => ({ kind: 'highlight', on, off });
  switch (preset) {
    case 'bold':
      return hl({ color: c.highlight, scale: 1.1 }, { color: c.color, scale: 1 });
    case 'karaoke':
      return hl({ color: c.highlight, opacity: 1 }, { color: c.color, opacity: 1 });
    case 'box':
      return hl({ backgroundColor: c.highlight, color: '#111111', scale: 1.06 }, { backgroundColor: 'rgba(0,0,0,0)', color: c.color, scale: 1 });
    case 'neon':
      return hl({ opacity: 1, scale: 1.06 }, { opacity: 0.55, scale: 1 });
    case 'outline':
      return hl({ color: c.highlight }, { color: 'rgba(0,0,0,0)' });
    case 'retro':
    case 'comic':
    case 'handwritten':
    case 'arcade':
    case 'impact':
      return hl({ color: c.highlight }, { color: c.color });
    case 'editorial':
      return hl({ color: c.highlight, fontStyle: 'italic' }, { color: c.color, fontStyle: 'normal' });
    case 'reveal':
      return { kind: 'appear' };
    case 'bounce':
      return { kind: 'bounce' };
    case 'typewriter':
      return { kind: 'type' };
    case 'marker':
      return { kind: 'marker' };
    case 'glitch':
      return { kind: 'jitter' };
    default:
      return { kind: 'none' };
  }
}

/** The chunk's words as spans; typewriter splits each word into letters. */
export function captionHtml(preset: CaptionPreset, page: CaptionPage, i: number) {
  return page.words
    .map((w, j) => {
      const text = preset === 'bold' || preset === 'pop' || preset === 'impact' ? w.text.replace(/[,.;:]+$/, '') : w.text;
      const inner = preset === 'typewriter' ? [...text].map((ch) => `<span class="ch">${esc(ch)}</span>`).join('') : esc(text);
      return `<span class="w" id="p${i}w${j}">${inner}</span>`;
    })
    .join(' ');
}

/** GSAP for one chunk: how it comes in and what each word does as it's said. */
export function captionTweens(preset: CaptionPreset, c: CaptionSettings, page: CaptionPage, i: number): string[] {
  const tl: string[] = [];
  const ci = js(`#p${i} .ci`);
  const at = n(page.start);
  switch (preset) {
    case 'bold':
    case 'box':
      tl.push(`tl.fromTo(${ci}, { scale: 0.86 }, { scale: 1, duration: 0.14, ease: 'back.out(3)' }, ${at});`);
      break;
    case 'pop':
      tl.push(`tl.fromTo(${ci}, { scale: 0.5, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.16, ease: 'back.out(3)' }, ${at});`);
      break;
    case 'impact':
      tl.push(`tl.fromTo(${ci}, { scale: 1.35, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.12, ease: 'power4.out' }, ${at});`);
      break;
    case 'comic':
      tl.push(`tl.fromTo(${ci}, { scale: 1.5, rotation: -10, opacity: 0 }, { scale: 1, rotation: -3, opacity: 1, duration: 0.18, ease: 'back.out(2.5)' }, ${at});`);
      break;
    case 'clean':
    case 'editorial':
      tl.push(`tl.fromTo(${ci}, { opacity: 0 }, { opacity: 1, duration: 0.12 }, ${at});`);
      break;
    case 'minimal':
      tl.push(`tl.fromTo(${ci}, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.25, ease: 'power2.out' }, ${at});`);
      break;
    case 'neon':
      // Flickers on like a tube.
      [0, 1, 0.3, 1].forEach((o, k) => tl.push(`tl.set(${ci}, { opacity: ${o} }, ${n(page.start + k * 0.035)});`));
      break;
    case 'arcade':
      tl.push(`tl.fromTo(${ci}, { opacity: 0 }, { opacity: 1, duration: 0.12, ease: 'steps(3)' }, ${at});`);
      break;
    case 'retro':
    case 'handwritten':
    case 'outline':
    case 'glitch':
      tl.push(`tl.fromTo(${ci}, { scale: 0.9, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.12, ease: 'power2.out' }, ${at});`);
      break;
    default:
      break;
  }
  const mode = wordMode(preset, c);
  page.words.forEach((w, j) => {
    const el = js(`#p${i}w${j}`);
    const next = page.words[j + 1];
    switch (mode.kind) {
      case 'highlight':
        tl.push(`tl.set(${el}, ${js(mode.on)}, ${n(w.start)});`);
        if (next) tl.push(`tl.set(${el}, ${js(mode.off)}, ${n(next.start)});`);
        break;
      case 'appear':
        tl.push(`tl.fromTo(${el}, { opacity: 0, y: 18 }, { opacity: 1, y: 0, duration: 0.12, ease: 'power2.out' }, ${n(w.start)});`);
        break;
      case 'bounce':
        tl.push(`tl.fromTo(${el}, { opacity: 0, y: 46, scale: 0.7 }, { opacity: 1, y: 0, scale: 1, duration: 0.32, ease: 'back.out(3)' }, ${n(w.start)});`);
        break;
      case 'type': {
        const letters = [...w.text].length;
        const step = Math.min(0.05, Math.max(0.012, (w.end - w.start) / Math.max(1, letters)));
        tl.push(`tl.fromTo(${js(`#p${i}w${j} .ch`)}, { opacity: 0 }, { opacity: 1, duration: 0.001, stagger: ${n(step)} }, ${n(w.start)});`);
        break;
      }
      case 'marker':
        // The marked word turns dark on the highlighter, like ink under a marker.
        tl.push(`tl.fromTo(${el}, { backgroundSize: '0% 78%', color: ${js(c.color)}, textShadow: '0 0.04em 0.12em rgba(0,0,0,.7)' }, { backgroundSize: '100% 78%', color: '#111111', textShadow: 'none', duration: 0.16, ease: 'power2.out' }, ${n(w.start)});`);
        if (next) tl.push(`tl.to(${el}, { backgroundSize: '0% 78%', color: ${js(c.color)}, textShadow: '0 0.04em 0.12em rgba(0,0,0,.7)', duration: 0.1 }, ${n(next.start)});`);
        break;
      case 'jitter':
        [
          [-7, 3],
          [6, -2],
          [-3, 1],
          [0, 0],
        ].forEach(([x, y], k) => tl.push(`tl.set(${el}, { x: ${x}, y: ${y}, color: ${js(k < 3 ? c.highlight : c.color)} }, ${n(w.start + k * 0.04)});`));
        break;
      case 'none':
        break;
    }
  });
  return tl;
}

/** The preset's look. `family` is the font stack it ends up with. */
export function captionCss(preset: CaptionPreset, c: CaptionSettings, family: string, H: number) {
  const style = CAPTION_STYLE[preset];
  const acc = c.highlight;
  const base = `
.cap { z-index: 40; }
.cap .line { top: ${px(c.position * H)}; }
.cap .ci { font-family: ${family}; font-weight: ${style.weight}; font-size: ${px(style.size * c.size)}; line-height: ${style.line}; color: ${c.color};
  text-transform: ${c.uppercase ? 'uppercase' : 'none'}; max-width: ${preset === 'subtitle' ? 88 : 84}%; }
.cap .w { display: inline-block; margin: 0 ${['subtitle', 'clean', 'minimal', 'editorial', 'typewriter'].includes(preset) ? '0' : '0.07em'}; }`;
  const stroke = (em: number) => `-webkit-text-stroke: ${em}em #000; paint-order: stroke fill;`;
  const extra: Record<CaptionPreset, string> = {
    bold: `.cap .w { ${stroke(0.16)} text-shadow: 0 0.05em 0.14em rgba(0,0,0,.55); }`,
    karaoke: `.cap .w { opacity: .5; ${stroke(0.12)} }`,
    clean: `.cap .ci { background: rgba(0,0,0,.62); padding: .22em .55em; border-radius: .38em; box-decoration-break: clone; -webkit-box-decoration-break: clone; }`,
    subtitle: `.cap .ci { text-shadow: 0 2px 4px rgba(0,0,0,.9), 0 0 14px rgba(0,0,0,.6); }`,
    pop: `.cap .w { ${stroke(0.14)} text-shadow: 0 0.06em 0.16em rgba(0,0,0,.6); color: ${c.color}; }`,
    box: `.cap .w { padding: 0 .14em; border-radius: .16em; text-shadow: 0 0.04em 0.12em rgba(0,0,0,.65); background-color: rgba(0,0,0,0); }`,
    marker: `.cap .w { padding: 0 .1em; background-image: linear-gradient(${acc}, ${acc}); background-repeat: no-repeat; background-position: 0 60%; background-size: 0% 78%; border-radius: .12em; text-shadow: 0 0.04em 0.12em rgba(0,0,0,.7); }`,
    reveal: `.cap .w { opacity: 0; ${stroke(0.14)} text-shadow: 0 0.05em 0.14em rgba(0,0,0,.5); }`,
    bounce: `.cap .w { opacity: 0; ${stroke(0.14)} text-shadow: 0 0.05em 0.14em rgba(0,0,0,.5); }`,
    impact: `.cap .ci { letter-spacing: .01em; } .cap .w { text-shadow: 0 0.04em 0.1em rgba(0,0,0,.7), 0 0 .5em rgba(0,0,0,.35); }`,
    neon: `.cap .w { color: #fff; opacity: .55; text-shadow: 0 0 .06em #fff, 0 0 .18em ${acc}, 0 0 .42em ${acc}, 0 0 .9em ${acc}; }`,
    outline: `.cap .w { color: rgba(0,0,0,0); -webkit-text-stroke: .045em ${c.color}; text-shadow: 0 0 .3em rgba(0,0,0,.35); }`,
    retro: `.cap .w { text-shadow: .055em .055em 0 ${acc}, .11em .11em 0 #000; }`,
    glitch: `.cap .w { text-shadow: .05em 0 0 rgba(255,0,70,.85), -.05em 0 0 rgba(0,235,255,.85), 0 .04em .12em rgba(0,0,0,.6); }`,
    comic: `.cap .ci { transform: rotate(-3deg); } .cap .w { ${stroke(0.1)} text-shadow: .06em .07em 0 #000; letter-spacing: .02em; }`,
    handwritten: `.cap .w { text-shadow: 0 .04em .14em rgba(0,0,0,.75), 0 0 .4em rgba(0,0,0,.3); }`,
    editorial: `.cap .ci { text-shadow: 0 .03em .16em rgba(0,0,0,.7); }`,
    typewriter: `.cap .ci { background: rgba(0,0,0,.6); padding: .18em .5em; border-radius: .18em; box-decoration-break: clone; -webkit-box-decoration-break: clone; } .cap .ch { opacity: 0; }`,
    minimal: `.cap .ci { text-transform: ${c.uppercase ? 'uppercase' : 'lowercase'}; letter-spacing: .01em; text-shadow: 0 1px 3px rgba(0,0,0,.8), 0 0 10px rgba(0,0,0,.45); }`,
    arcade: `.cap .w { text-shadow: .12em .12em 0 #000; }`,
  };
  return `${base}\n${extra[preset]}`;
}
