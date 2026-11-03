// The motion-graphics templates (GRAPHIC_INFO in shared/edit.ts), compiled into the composition. Each is a full-frame
// layer with its content positioned inside, in the brand's accent colour and fonts, animated on the main timeline with
// seek-safe tweens (fromTo with explicit start states, no randomness). Times are on the finished video.
import {
  commentLikeAt,
  graphicBeats,
  graphicWords,
  markerAt,
  priceNewAt,
  ratingStars,
  ratingStep,
  searchTypeSeconds,
  statCountSeconds,
  VERSUS_AT,
  type GraphicOverlay,
  type GraphicPosition,
} from '../../../shared/edit';
import { accent, esc, js, n, px } from './html';

const HEART = 'M12 20.5s-7.6-4.5-9.4-9.3C1.4 7.9 3.4 4.5 6.8 4.5c2.2 0 3.7 1.2 5.2 3 1.5-1.8 3-3 5.2-3 3.4 0 5.4 3.4 4.2 6.7-1.8 4.8-9.4 9.3-9.4 9.3z';
const BELL = 'M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22zm7-6v-5a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1z';
const STAR = 'M12 2.6l2.9 5.9 6.5.95-4.7 4.6 1.1 6.5L12 17.5l-5.8 3.05 1.1-6.5-4.7-4.6 6.5-.95z';
const LENS = '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 L21 21"/>';

/** A count-up from zero to a parsed number, in the same format, written into `selector` as it climbs. */
function countUp(selector: string, stat: NonNullable<ReturnType<typeof parseStat>>, duration: number, at: number) {
  const group = stat.grouped || stat.value >= 10000;
  const fmt = group ? ` const p = s.split('.'); s = p[0].replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',') + (p[1] ? '.' + p[1] : '');` : '';
  return `(() => { const el = document.querySelector(${js(selector)}); if (!el) return; const c = { v: 0 }; tl.fromTo(c, { v: 0 }, { v: ${stat.value}, duration: ${n(duration)}, ease: 'power2.out', onUpdate: () => { let s = c.v.toFixed(${stat.decimals});${fmt} el.textContent = ${js(stat.prefix)} + s + ${js(stat.suffix)}; } }, ${n(at)}); })();`;
}

export type GraphicContext = {
  W: number;
  H: number;
  /** The accent colour (the captions' highlight). */
  color: string;
  /** A font stack with the brand font first when there is one. */
  font: (family: string) => string;
};

export type ComposedGraphic = { html: string; tweens: string[] };

/** Where a template's content sits for each position. */
const Y = { top: 0.17, center: 0.47, bottom: 0.79 };

/** A phrase as word spans (accent words marked), for templates that animate word by word. */
const wordSpans = (text: string, cls: string) =>
  graphicWords(text)
    .map((w) => `<span class="${cls}${w.accent ? ' acc' : ''}">${esc(w.text)}</span>`)
    .join(' ');

/** "$1.2M" → prefix "$", value 1.2, 1 decimal, suffix "M"; thousands separators kept when the text has them. */
export function parseStat(text: string) {
  const m = /^(.*?)(\d[\d,]*(?:\.\d+)?)(.*)$/s.exec(text.trim());
  if (!m) return null;
  const digits = m[2].replace(/,/g, '');
  return { prefix: m[1], value: Number(digits), decimals: digits.includes('.') ? digits.split('.')[1].length : 0, grouped: m[2].includes(','), suffix: m[3] };
}

/** The script helper the count-up uses to format its number as it climbs. */
export const STAT_HELPER = `function __fmt(v, d, g) { const s = v.toFixed(d); if (!g) return s; const [a, b] = s.split('.'); return a.replace(/\\B(?=(\\d{3})+(?!\\d))/g, ',') + (b ? '.' + b : ''); }`;

export function composeGraphic(o: GraphicOverlay, i: number, ctx: GraphicContext): ComposedGraphic {
  const { W, H, color } = ctx;
  const id = `#o${i}`;
  const sel = (part: string) => js(`${id} ${part}`);
  const s = o.start;
  const len = o.end - o.start;
  const t = (offset: number) => n(s + offset);
  const exitAt = n(o.end - 0.3);
  const y = Y[o.position] * H;
  const tweens: string[] = [];
  /** Fade a part out at the end, unless the graphic is too short to read. */
  const exit = (part: string, extra = '') => len > 1.2 && tweens.push(`tl.to(${sel(part)}, { opacity: 0${extra}, duration: 0.28, ease: 'power2.in' }, ${exitAt});`);
  /**
   * The newer templates sit in a full-width `.gw` wrapper: pinned from the top or bottom edge (so a tall one never
   * leaves the frame) or centred. Only its opacity is animated; the moves happen inside it.
   */
  const place = (pos: GraphicPosition) => (pos === 'top' ? `top:${px(H * 0.11)}` : pos === 'bottom' ? `bottom:${px(H * 0.19)}` : `top:${px(H * 0.47)};transform:translateY(-50%)`);
  const wrap = (inner: string, pos: GraphicPosition = o.position) => `<div class="gw" style="${place(pos)}">${inner}</div>`;
  const heading = (cls: string) => (o.text ? `<div class="${cls}">${accent(esc(o.text))}</div>` : '');
  /**
   * A font size (px) at which the longest word (or, with `whole`, all of the text on one line) fits `width`, at most
   * `base`; `em` is the font's rough character width. Keeps long words from breaking mid-word or leaving the frame.
   */
  const fit = (text: string, base: number, width: number, em = 0.66, whole = false) => {
    const chars = whole ? Array.from(text.replace(/\*/g, '')).length : Math.max(0, ...graphicWords(text).map((w) => Array.from(w.text).length));
    return Math.round(Math.min(base, width / Math.max(1, chars * em)));
  };
  let html = '';

  switch (o.template) {
    case 'lowerThird': {
      html = `<div class="lt" style="left:${px(W * 0.07)};top:${px(y)}"><div class="lt-bar"></div><div class="lt-body"><div class="lt-name">${accent(esc(o.text || ' '))}</div>${o.sub ? `<div class="lt-sub">${accent(esc(o.sub))}</div>` : ''}</div></div>`;
      tweens.push(
        `tl.fromTo(${sel('.lt-bar')}, { scaleY: 0 }, { scaleY: 1, duration: 0.3, ease: 'power3.out' }, ${t(0)});`,
        `tl.fromTo(${sel('.lt-body')}, { clipPath: 'inset(0% 100% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.5, ease: 'power3.out' }, ${t(0.1)});`,
        `tl.fromTo(${sel('.lt-name')}, { x: -30, opacity: 0 }, { x: 0, opacity: 1, duration: 0.4, ease: 'power3.out' }, ${t(0.18)});`,
      );
      if (o.sub) tweens.push(`tl.fromTo(${sel('.lt-sub')}, { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: 'power2.out' }, ${t(0.35)});`);
      exit('.lt', ', x: -40');
      break;
    }

    case 'who': {
      // The arrow's tip is the point (beside the speaker's head); the name card sits below it, clear of the captions
      // (above it when the tip is low), toward the nearer edge of the frame, and a drawn arrow curves up to the tip.
      const tx = o.x * W;
      const ty = o.y * H;
      const side = o.x < 0.5 ? -1 : 1;
      const name = o.text || ' ';
      const nameSize = fit(name, 58, W * 0.7, 0.62, true);
      const subSize = o.sub ? fit(o.sub, 34, W * 0.7, 0.55, true) : 0;
      const chars = (s: string) => Array.from(s.replace(/\*/g, '')).length;
      const cw = Math.min(W * 0.8, Math.max(chars(name) * nameSize * 0.62, chars(o.sub) * subSize * 0.55) + 60);
      const ch = nameSize * 1.1 + (o.sub ? subSize * 1.25 + 8 : 0) + 34;
      const cx = Math.min(W * 0.96 - cw / 2, Math.max(W * 0.04 + cw / 2, tx + side * W * 0.2));
      const under = Math.min(ty + H * 0.15, H * 0.6 - ch);
      const below = under >= ty + H * 0.05;
      const top = below ? under : Math.max(H * 0.04, ty - H * 0.12 - ch);
      const x0 = cx + Math.max(-cw * 0.3, Math.min(cw * 0.3, tx - cx));
      const y0 = below ? top - 16 : top + ch + 16;
      const dx = tx - x0;
      const dy = ty - y0;
      const dist = Math.max(1, Math.hypot(dx, dy));
      // Bowed out toward the card's side, like an arrow drawn by hand.
      let px_ = -dy / dist;
      let py_ = dx / dist;
      if (px_ * side < 0) [px_, py_] = [-px_, -py_];
      const cX = (x0 + tx) / 2 + px_ * dist * 0.28;
      const cY = (y0 + ty) / 2 + py_ * dist * 0.28;
      const ex = tx - cX;
      const ey = ty - cY;
      const el = Math.max(1, Math.hypot(ex, ey));
      const [ux, uy] = [ex / el, ey / el];
      const wing = (a: number) => `${n(tx - (ux * Math.cos(a) - uy * Math.sin(a)) * 42)} ${n(ty - (ux * Math.sin(a) + uy * Math.cos(a)) * 42)}`;
      html =
        `<svg class="wh-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><g class="wh-g"><path class="wh-line" d="M ${n(x0)} ${n(y0)} Q ${n(cX)} ${n(cY)} ${n(tx)} ${n(ty)}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/>` +
        `<path class="wh-head" d="M ${wing(0.55)} L ${n(tx)} ${n(ty)} L ${wing(-0.55)}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/></g></svg>` +
        `<div class="wh-at" style="left:${px(cx)};top:${px(top)}"><div class="wh-card"><div class="wh-name" style="font-size:${nameSize}px">${accent(esc(name))}</div>${o.sub ? `<div class="wh-sub" style="font-size:${subSize}px">${accent(esc(o.sub))}</div>` : ''}</div></div>`;
      tweens.push(
        `tl.fromTo(${sel('.wh-card')}, { y: 26, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: 'power3.out' }, ${t(0)});`,
        `tl.fromTo(${sel('.wh-line')}, { attr: { 'stroke-dashoffset': 1 } }, { attr: { 'stroke-dashoffset': 0 }, duration: 0.38, ease: 'power2.inOut' }, ${t(0.18)});`,
        `tl.fromTo(${sel('.wh-head')}, { attr: { 'stroke-dashoffset': 1 } }, { attr: { 'stroke-dashoffset': 0 }, duration: 0.14, ease: 'power2.out' }, ${t(0.54)});`,
      );
      // The tip nudges toward the speaker a few times while it's up.
      if (len > 1.6) tweens.push(`tl.fromTo(${sel('.wh-g')}, { x: 0, y: 0 }, { x: ${n(ux * 14)}, y: ${n(uy * 14)}, duration: 0.26, ease: 'sine.inOut', yoyo: true, repeat: ${len > 2.6 ? 3 : 1} }, ${t(0.75)});`);
      exit('.wh-svg');
      exit('.wh-at');
      break;
    }

    case 'stat': {
      const stat = parseStat(o.text);
      html = `<div class="st" style="top:${px(y)}"><div class="st-num"><span class="st-v">${esc(o.text || '0')}</span></div>${o.sub ? `<div class="st-sub">${accent(esc(o.sub))}</div>` : ''}</div>`;
      tweens.push(`tl.fromTo(${sel('.st-num')}, { scale: 0.5, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(2)' }, ${t(0)});`);
      if (stat) {
        // Counts from zero in the same format: same decimals, separators, prefix and suffix.
        tweens.push(
          `(() => { const el = document.querySelector(${js(`${id} .st-v`)}); const c = { v: 0 }; tl.fromTo(c, { v: 0 }, { v: ${stat.value}, duration: ${n(statCountSeconds(o))}, ease: 'power2.out', onUpdate: () => { el.textContent = ${js(stat.prefix)} + __fmt(c.v, ${stat.decimals}, ${stat.grouped || stat.value >= 10000}) + ${js(stat.suffix)}; } }, ${t(0)}); })();`,
        );
      }
      if (o.sub) tweens.push(`tl.fromTo(${sel('.st-sub')}, { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: 'power2.out' }, ${t(0.35)});`);
      exit('.st', ', scale: 0.92');
      break;
    }

    case 'list': {
      const beats = graphicBeats(o);
      const items = o.items.length ? o.items : ['Add your points'];
      html = `<div class="ls" style="top:${px(y)}">${o.text ? `<div class="ls-h">${accent(esc(o.text))}</div>` : ''}<ol class="ls-items">${items
        .map((it, k) => `<li class="ls-i ls-i${k}"><span class="ls-n">${k + 1}</span><span class="ls-t">${accent(esc(it))}</span></li>`)
        .join('')}</ol></div>`;
      tweens.push(`tl.fromTo(${sel('.ls')}, { scale: 0.92, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, ease: 'power3.out' }, ${t(0)});`);
      if (o.text) tweens.push(`tl.fromTo(${sel('.ls-h')}, { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: 'power2.out' }, ${t(0.1)});`);
      items.forEach((_, k) => {
        const at = n(beats[k] ?? s + 0.45);
        tweens.push(
          `tl.fromTo(${sel(`.ls-i${k}`)}, { x: -40, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3, ease: 'back.out(1.6)' }, ${at});`,
          `tl.fromTo(${sel(`.ls-i${k} .ls-n`)}, { scale: 0 }, { scale: 1, duration: 0.3, ease: 'back.out(3)' }, ${at});`,
        );
      });
      exit('.ls');
      break;
    }

    case 'checklist': {
      const beats = graphicBeats(o);
      const items = o.items.length ? o.items : ['Add your points'];
      html = `<div class="cl" style="top:${px(y)}">${o.text ? `<div class="cl-h">${accent(esc(o.text))}</div>` : ''}<ul class="cl-items">${items
        .map((it, k) => `<li class="cl-i cl-i${k}"><svg class="cl-box" viewBox="0 0 64 64"><rect x="4" y="4" width="56" height="56" rx="14"/><path class="cl-tick" d="M16 34 L28 46 L50 20" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/></svg><span class="cl-t">${accent(esc(it))}</span></li>`)
        .join('')}</ul></div>`;
      tweens.push(`tl.fromTo(${sel('.cl')}, { scale: 0.94, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, ease: 'power3.out' }, ${t(0)});`);
      items.forEach((_, k) => {
        const at = beats[k] ?? s + 0.45;
        tweens.push(
          `tl.fromTo(${sel(`.cl-i${k}`)}, { x: -30, opacity: 0 }, { x: 0, opacity: 1, duration: 0.25, ease: 'power2.out' }, ${n(at - 0.1)});`,
          `tl.fromTo(${sel(`.cl-i${k} .cl-tick`)}, { attr: { 'stroke-dashoffset': 1 } }, { attr: { 'stroke-dashoffset': 0 }, duration: 0.28, ease: 'power2.out' }, ${n(at + 0.12)});`,
          `tl.fromTo(${sel(`.cl-i${k} .cl-box`)}, { scale: 1 }, { scale: 1.18, duration: 0.12, ease: 'power2.out', yoyo: true, repeat: 1 }, ${n(at + 0.3)});`,
        );
      });
      exit('.cl');
      break;
    }

    case 'chart': {
      const beats = graphicBeats(o);
      // "Name: 120" (or "Name 120"): the number is the last one in the line; a line with none counts as 0.
      const bars = (o.items.length ? o.items : ['Add: 1', 'your bars: 2']).slice(0, 6).map((it) => {
        const m = /^(.*?)[\s:=-]*(-?\d[\d,]*(?:\.\d+)?)\s*(%|[a-zA-Z$€£]{0,2})\s*$/.exec(it.trim());
        const unit = { k: 1e3, m: 1e6, b: 1e9 }[m?.[3]?.toLowerCase() as 'k'] ?? 1;
        return m ? { label: m[1].trim() || it.trim(), value: Math.max(0, Number(m[2].replace(/,/g, '')) * unit), text: m[2] + m[3] } : { label: it.trim(), value: 0, text: '' };
      });
      const max = Math.max(1, ...bars.map((b) => b.value));
      html = `<div class="bc" style="top:${px(y)}">${o.text ? `<div class="bc-h">${accent(esc(o.text))}</div>` : ''}${bars
        .map((b, k) => `<div class="bc-r bc-r${k}"><div class="bc-l">${esc(b.label)}</div><div class="bc-track"><div class="bc-bar" style="width:${n((b.value / max) * 100)}%"></div></div><div class="bc-v">${esc(b.text)}</div></div>`)
        .join('')}</div>`;
      tweens.push(`tl.fromTo(${sel('.bc')}, { opacity: 0 }, { opacity: 1, duration: 0.25 }, ${t(0)});`);
      bars.forEach((_, k) => {
        const at = beats[k] ?? s + 0.45;
        tweens.push(
          `tl.fromTo(${sel(`.bc-r${k}`)}, { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.25, ease: 'power2.out' }, ${n(at - 0.1)});`,
          `tl.fromTo(${sel(`.bc-r${k} .bc-bar`)}, { scaleX: 0 }, { scaleX: 1, duration: 0.7, ease: 'power3.out' }, ${n(at)});`,
          `tl.fromTo(${sel(`.bc-r${k} .bc-v`)}, { opacity: 0 }, { opacity: 1, duration: 0.2 }, ${n(at + 0.45)});`,
        );
      });
      exit('.bc');
      break;
    }

    case 'wall': {
      const beats = graphicBeats(o);
      const items = o.items.length ? o.items : ['Add your headlines'];
      const tilt = [-3, 2.4, -1.6, 3, -2.4, 1.6];
      html = `<div class="wl" style="top:${px(y)}">${o.text ? `<div class="wl-h">${accent(esc(o.text))}</div>` : ''}${items
        .map((it, k) => `<div class="wl-c wl-c${k}" style="transform:rotate(${tilt[k % tilt.length]}deg) translateX(${k % 2 ? 26 : -26}px)">${accent(esc(it))}</div>`)
        .join('')}</div>`;
      items.forEach((_, k) => {
        const at = beats[k] ?? s + 0.45;
        tweens.push(`tl.fromTo(${sel(`.wl-c${k}`)}, { y: -140, scale: 1.25, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.3, ease: 'back.out(1.8)' }, ${n(at)});`);
      });
      if (o.text) tweens.push(`tl.fromTo(${sel('.wl-h')}, { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3 }, ${t(0)});`);
      exit('.wl');
      break;
    }

    case 'quote': {
      html = `<div class="qt-bg"></div><div class="qt" style="top:${px(y)}"><div class="qt-mark">“</div><div class="qt-text">${wordSpans(o.text || ' ', 'qw')}</div>${o.sub ? `<div class="qt-by">— ${esc(o.sub)}</div>` : ''}</div>`;
      const words = graphicWords(o.text).length;
      tweens.push(
        `tl.fromTo(${sel('.qt-bg')}, { opacity: 0 }, { opacity: 1, duration: 0.3 }, ${t(0)});`,
        `tl.fromTo(${sel('.qt-mark')}, { scale: 0, rotation: -12 }, { scale: 1, rotation: 0, duration: 0.4, ease: 'back.out(2.2)' }, ${t(0)});`,
        `tl.fromTo(${sel('.qw')}, { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: 'power2.out', stagger: 0.06 }, ${t(0.15)});`,
      );
      if (o.sub) tweens.push(`tl.fromTo(${sel('.qt-by')}, { opacity: 0 }, { opacity: 1, duration: 0.3 }, ${t(Math.min(len * 0.6, 0.3 + words * 0.06))});`);
      exit('.qt');
      exit('.qt-bg');
      break;
    }

    case 'callout': {
      const tx = o.x * W;
      const ty = o.y * H;
      // The label sits above the target, or below it near the top of the frame, kept inside the frame.
      const above = o.y > 0.3;
      const lx = Math.min(W * 0.72, Math.max(W * 0.28, tx));
      const ly = above ? Math.max(H * 0.08, ty - 300) : Math.min(H * 0.9, ty + 300);
      const fromY = ly + (above ? 52 : -52);
      const dx = tx - lx;
      const dy = ty - fromY;
      const dist = Math.max(1, Math.hypot(dx, dy));
      const ex = tx - (dx / dist) * 78;
      const ey = ty - (dy / dist) * 78;
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      html =
        `<svg class="co-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><path class="co-line" d="M ${n(lx)} ${n(fromY)} L ${n(ex)} ${n(ey)}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"/>` +
        `<polygon class="co-head" points="0,-20 30,0 0,20" transform="translate(${n(ex)} ${n(ey)}) rotate(${n(angle)})"/></svg>` +
        `<div class="co-ring" style="left:${px(tx - 62)};top:${px(ty - 62)}"></div>` +
        `<div class="co-label" style="left:${px(lx)};top:${px(ly)}"><span>${accent(esc(o.text || ' '))}</span></div>`;
      tweens.push(
        `tl.fromTo(${sel('.co-label span')}, { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, ease: 'back.out(2.2)' }, ${t(0)});`,
        `tl.fromTo(${sel('.co-line')}, { attr: { 'stroke-dashoffset': 1 } }, { attr: { 'stroke-dashoffset': 0 }, duration: 0.3, ease: 'power2.out' }, ${t(0.15)});`,
        `tl.fromTo(${sel('.co-head')}, { opacity: 0 }, { opacity: 1, duration: 0.08 }, ${t(0.42)});`,
        `tl.fromTo(${sel('.co-ring')}, { scale: 0 }, { scale: 1, duration: 0.35, ease: 'back.out(3)' }, ${t(0.4)});`,
      );
      if (len > 1.6) tweens.push(`tl.fromTo(${sel('.co-ring')}, { scale: 1 }, { scale: 1.15, duration: 0.3, ease: 'sine.inOut', yoyo: true, repeat: 3 }, ${t(0.85)});`);
      exit('.co-svg');
      exit('.co-ring');
      exit('.co-label');
      break;
    }

    case 'chapter': {
      html = `<div class="ch-bg"><div class="ch">${o.sub ? `<div class="ch-k">${esc(o.sub)}</div><div class="ch-bar"></div>` : ''}<div class="ch-t">${accent(esc(o.text || ' '))}</div></div></div>`;
      tweens.push(
        `tl.fromTo(${sel('.ch-bg')}, { yPercent: 100 }, { yPercent: 0, duration: 0.35, ease: 'power3.out' }, ${t(0)});`,
        `tl.fromTo(${sel('.ch-t')}, { scale: 0.8, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(1.7)' }, ${t(0.28)});`,
      );
      if (o.sub)
        tweens.push(
          `tl.fromTo(${sel('.ch-k')}, { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: 'power2.out' }, ${t(0.2)});`,
          `tl.fromTo(${sel('.ch-bar')}, { scaleX: 0 }, { scaleX: 1, duration: 0.35, ease: 'power3.out' }, ${t(0.25)});`,
        );
      if (len > 1) tweens.push(`tl.to(${sel('.ch-bg')}, { yPercent: -100, duration: 0.32, ease: 'power3.in' }, ${n(o.end - 0.32)});`);
      break;
    }

    case 'cta': {
      html = `<div class="cta" style="top:${px(y)}"><div class="cta-pill"><span class="cta-ic">+</span><span class="cta-t">${accent(esc(o.text || ' '))}</span></div></div>`;
      tweens.push(
        `tl.fromTo(${sel('.cta-pill')}, { y: 120, scale: 0.7, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.45, ease: 'back.out(2)' }, ${t(0)});`,
        `tl.fromTo(${sel('.cta-ic')}, { rotation: -90 }, { rotation: 0, duration: 0.4, ease: 'power3.out' }, ${t(0.1)});`,
      );
      if (len > 1.8) tweens.push(`tl.fromTo(${sel('.cta-pill')}, { scale: 1 }, { scale: 1.06, duration: 0.18, ease: 'sine.inOut', yoyo: true, repeat: 3 }, ${t(0.9)});`);
      exit('.cta-pill', ', y: 80');
      break;
    }

    case 'progress': {
      html = `<div class="pg" style="${o.position === 'bottom' ? 'bottom:0' : 'top:0'}"><div class="pg-fill"></div></div>`;
      tweens.push(`tl.fromTo(${sel('.pg-fill')}, { scaleX: 0 }, { scaleX: 1, duration: ${n(len)}, ease: 'none' }, ${t(0)});`);
      break;
    }

    case 'kinetic': {
      const beats = graphicBeats(o);
      html = `<div class="kn-bg"></div><div class="kn"><div class="kn-in">${graphicWords(o.text || ' ')
        .map((w, k) => `<span class="kw kw${k}${w.accent ? ' acc' : ''}">${esc(w.text)}</span>`)
        .join(' ')}</div></div>`;
      tweens.push(`tl.fromTo(${sel('.kn-bg')}, { opacity: 0 }, { opacity: 1, duration: 0.2 }, ${t(0)});`);
      beats.forEach((at, k) => {
        tweens.push(`tl.fromTo(${sel(`.kw${k}`)}, { scale: 1.9, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.16, ease: 'power4.out' }, ${n(at)});`);
        tweens.push(`tl.fromTo(${sel('.kn-in')}, { y: 7 }, { y: 0, duration: 0.12, ease: 'power2.out' }, ${n(at + 0.12)});`);
      });
      exit('.kn-in');
      exit('.kn-bg');
      break;
    }

    case 'versus': {
      // Two lines of items work too, when text and sub are empty.
      const [a, b] = !o.text && !o.sub && o.items.length >= 2 ? o.items : [o.text || 'This', o.sub || 'That'];
      html = wrap(`<div class="vs"><div class="vs-a"><div class="vs-t" style="font-size:${fit(a, 76, W * 0.88 - 112)}px">${accent(esc(a))}</div></div><div class="vs-b"><div class="vs-t" style="font-size:${fit(b, 76, W * 0.88 - 112)}px">${accent(esc(b))}</div></div><div class="vs-badge">VS</div></div>`);
      tweens.push(
        `tl.fromTo(${sel('.vs-a')}, { xPercent: -112, opacity: 0 }, { xPercent: 0, opacity: 1, duration: 0.42, ease: 'power3.out' }, ${t(0)});`,
        `tl.fromTo(${sel('.vs-b')}, { xPercent: 112, opacity: 0 }, { xPercent: 0, opacity: 1, duration: 0.42, ease: 'power3.out' }, ${t(VERSUS_AT.right)});`,
        `tl.fromTo(${sel('.vs-a .vs-t')}, { y: 26, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: 'power2.out' }, ${t(0.2)});`,
        `tl.fromTo(${sel('.vs-b .vs-t')}, { y: -26, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: 'power2.out' }, ${t(VERSUS_AT.right + 0.2)});`,
        `tl.fromTo(${sel('.vs-badge')}, { scale: 3.2, rotation: -50, opacity: 0 }, { scale: 1, rotation: 0, opacity: 1, duration: 0.22, ease: 'power4.in' }, ${t(VERSUS_AT.badge)});`,
        `tl.fromTo(${sel('.vs')}, { x: -18 }, { x: 0, duration: 0.45, ease: 'elastic.out(1, 0.3)' }, ${t(VERSUS_AT.badge + 0.22)});`,
      );
      if (len > 2.2) tweens.push(`tl.fromTo(${sel('.vs-badge')}, { scale: 1 }, { scale: 1.1, duration: 0.2, ease: 'sine.inOut', yoyo: true, repeat: 3, immediateRender: false }, ${t(1.2)});`);
      exit('.gw');
      break;
    }

    case 'timeline': {
      const beats = graphicBeats(o);
      // "2021: First video" → when + what; a line without a separator is all "what".
      const rows = (o.items.length ? o.items : ['Then: add your moments']).map((it) => {
        const m = /^(.{1,18}?)\s*(?::|–|—|\s-\s)\s*(.+)$/.exec(it.trim());
        return m ? { when: m[1], what: m[2] } : { when: '', what: it.trim() };
      });
      html = wrap(
        `<div class="tm">${heading('tm-h')}${rows
          .map(
            (r, k) =>
              `<div class="tm-i tm-i${k}">${k < rows.length - 1 ? '<div class="tm-seg"><div class="tm-fill"></div></div>' : ''}<div class="tm-dot"></div><div class="tm-b">${r.when ? `<div class="tm-d">${accent(esc(r.when))}</div>` : ''}<div class="tm-t">${accent(esc(r.what))}</div></div></div>`,
          )
          .join('')}</div>`,
      );
      tweens.push(`tl.fromTo(${sel('.tm')}, { scale: 0.94, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, ease: 'power3.out' }, ${t(0)});`);
      rows.forEach((_, k) => {
        const at = beats[k] ?? s + 0.45 + k * 0.5;
        tweens.push(
          `tl.fromTo(${sel(`.tm-i${k} .tm-b`)}, { x: -36, opacity: 0 }, { x: 0, opacity: 1, duration: 0.32, ease: 'power2.out' }, ${n(at)});`,
          `tl.fromTo(${sel(`.tm-i${k} .tm-dot`)}, { scale: 0.55, backgroundColor: '#1c1c1f', borderColor: 'rgba(255,255,255,0.35)' }, { scale: 1, backgroundColor: ${js(color)}, borderColor: ${js(color)}, duration: 0.35, ease: 'back.out(3)' }, ${n(at)});`,
        );
        if (k > 0) tweens.push(`tl.fromTo(${sel(`.tm-i${k - 1} .tm-fill`)}, { scaleY: 0 }, { scaleY: 1, duration: 0.3, ease: 'power2.inOut' }, ${n(at - 0.3)});`);
      });
      exit('.gw');
      break;
    }

    case 'ranking': {
      // The first line is #1; they come in from the last place up.
      const beats = graphicBeats(o);
      const items = o.items.length ? o.items : ['Your #1', 'Your #2', 'Your #3'];
      html = wrap(
        `<div class="rk">${heading('rk-h')}${items
          .map((it, k) => `<div class="rk-c rk-c${k}${k === 0 ? ' rk-top' : ''}"><div class="rk-n"><span class="rk-hash">#</span>${k + 1}</div><div class="rk-t">${accent(esc(it))}</div></div>`)
          .join('')}</div>`,
      );
      if (o.text) tweens.push(`tl.fromTo(${sel('.rk-h')}, { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: 'power2.out' }, ${t(0)});`);
      items.forEach((_, step) => {
        const k = items.length - 1 - step;
        const at = beats[step] ?? s + 0.45 + step * 0.5;
        tweens.push(
          `tl.fromTo(${sel(`.rk-c${k}`)}, { x: ${step % 2 ? 160 : -160}, opacity: 0 }, { x: 0, opacity: 1, duration: 0.36, ease: 'back.out(1.5)' }, ${n(at)});`,
          `tl.fromTo(${sel(`.rk-c${k} .rk-n`)}, { scale: 1.9 }, { scale: 1, duration: 0.3, ease: 'power4.out' }, ${n(at + 0.04)});`,
        );
        if (k === 0 && o.end - at > 1) tweens.push(`tl.fromTo(${sel('.rk-top')}, { scale: 1 }, { scale: 1.05, duration: 0.16, ease: 'sine.inOut', yoyo: true, repeat: 1, immediateRender: false }, ${n(at + 0.4)});`);
      });
      exit('.gw');
      break;
    }

    case 'steps': {
      const beats = graphicBeats(o);
      const items = o.items.length ? o.items : ['Add your steps'];
      const N = items.length;
      const pct = (k: number) => (N === 1 ? 50 : (k / (N - 1)) * 100);
      html = wrap(
        `<div class="sp">${heading('sp-h')}<div class="sp-bar">${items
          .slice(1)
          .map((_, j) => `<div class="sp-seg" style="left:${n(pct(j))}%;width:${n(pct(j + 1) - pct(j))}%"><div class="sp-fill sp-f${j}"></div></div>`)
          .join('')}${items.map((_, k) => `<div class="sp-dot sp-d${k}" style="left:calc(${n(pct(k))}% - 44px)">${k + 1}</div>`).join('')}</div><div class="sp-cards">${items
          .map((it, k) => `<div class="sp-c sp-c${k}"><div class="sp-k">Step ${k + 1}<span> / ${N}</span></div><div class="sp-t">${accent(esc(it))}</div></div>`)
          .join('')}</div></div>`,
      );
      tweens.push(`tl.fromTo(${sel('.sp')}, { scale: 0.94, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, ease: 'power3.out' }, ${t(0)});`);
      items.forEach((_, k) => {
        const at = beats[k] ?? s + 0.45 + k * 0.6;
        tweens.push(
          `tl.fromTo(${sel(`.sp-d${k}`)}, { scale: 0.7, backgroundColor: '#1c1c1f', borderColor: 'rgba(255,255,255,0.3)', color: 'rgba(255,255,255,0.55)' }, { scale: 1, backgroundColor: ${js(color)}, borderColor: ${js(color)}, color: '#111111', duration: 0.35, ease: 'back.out(3)' }, ${n(at)});`,
          `tl.fromTo(${sel(`.sp-c${k}`)}, { y: 44, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: 'power3.out' }, ${n(at)});`,
        );
        if (k > 0) tweens.push(`tl.fromTo(${sel(`.sp-f${k - 1}`)}, { scaleX: 0 }, { scaleX: 1, duration: 0.3, ease: 'power2.inOut' }, ${n(at - 0.3)});`);
        // Each step makes way for the next.
        if (k < N - 1) tweens.push(`tl.fromTo(${sel(`.sp-c${k}`)}, { y: 0, opacity: 1 }, { y: -44, opacity: 0, duration: 0.24, ease: 'power2.in', immediateRender: false }, ${n((beats[k + 1] ?? at + 0.6) - 0.24)});`);
      });
      exit('.gw');
      break;
    }

    case 'compare': {
      const beats = graphicBeats(o);
      const raw = o.items.length ? o.items : ['+ Add a pro', '- Add a con'];
      const PRO = /^\s*(?:\+|pros?\s*:|✓|✔)\s*/i;
      const CON = /^\s*(?:-|−|–|cons?\s*:|✗|✘|×)\s*/i;
      // Unmarked lines: the first half goes left, the rest right.
      const marked = raw.some((it) => PRO.test(it) || CON.test(it));
      const rows = raw.map((it, k) => {
        const pro = marked ? !CON.test(it) : k < Math.ceil(raw.length / 2);
        return { pro, k, text: it.replace(pro ? PRO : CON, '').trim() || it.trim() };
      });
      const [la, lb] = o.sub.includes('|') ? o.sub.split('|').map((x) => x.trim()) : ['Pros', 'Cons'];
      const row = (r: (typeof rows)[number]) =>
        `<div class="pc-i pc-i${r.k}"><svg class="pc-ic" viewBox="0 0 48 48"><circle cx="24" cy="24" r="22"/><path d="${r.pro ? 'M14 25 L21 32 L34 17' : 'M17 17 L31 31 M31 17 L17 31'}"/></svg><span>${accent(esc(r.text))}</span></div>`;
      html = wrap(
        `<div class="pc">${heading('pc-h')}<div class="pc-cols"><div class="pc-col pc-a"><div class="pc-hd">${esc(la || 'Pros')}</div>${rows.filter((r) => r.pro).map(row).join('')}</div><div class="pc-col pc-b"><div class="pc-hd">${esc(lb || 'Cons')}</div>${rows
          .filter((r) => !r.pro)
          .map(row)
          .join('')}</div></div></div>`,
      );
      tweens.push(
        `tl.fromTo(${sel('.pc')}, { scale: 0.94, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, ease: 'power3.out' }, ${t(0)});`,
        `tl.fromTo(${sel('.pc-hd')}, { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: 'power2.out', stagger: 0.1 }, ${t(0.1)});`,
      );
      rows.forEach((r) => {
        const at = beats[r.k] ?? s + 0.45 + r.k * 0.5;
        tweens.push(
          `tl.fromTo(${sel(`.pc-i${r.k}`)}, { x: ${r.pro ? -34 : 34}, opacity: 0 }, { x: 0, opacity: 1, duration: 0.3, ease: 'power2.out' }, ${n(at)});`,
          `tl.fromTo(${sel(`.pc-i${r.k} .pc-ic`)}, { scale: 0 }, { scale: 1, duration: 0.3, ease: 'back.out(3)' }, ${n(at + 0.05)});`,
        );
      });
      exit('.gw');
      break;
    }

    case 'ring': {
      const stat = parseStat(o.text);
      // "73%" fills 73 % of the ring; "3/4" three quarters; a number over 100 with no "of" fills it.
      const of = stat && /^\s*\/\s*(\d+(?:\.\d+)?)/.exec(stat.suffix);
      const frac = stat ? Math.max(0, Math.min(1, stat.value / (of ? Number(of[1]) || 1 : 100))) : 0;
      const count = statCountSeconds(o);
      const size = (o.text || '0').length > 5 ? ' xs' : (o.text || '0').length > 3 ? ' sm' : '';
      html = wrap(
        `<div class="rg"><div class="rg-ring"><svg class="rg-svg" viewBox="0 0 400 400"><circle class="rg-track" cx="200" cy="200" r="166"/><circle class="rg-arc" cx="200" cy="200" r="166" pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="1" transform="rotate(-90 200 200)"/></svg><div class="rg-num${size}"><span class="rg-v">${esc(o.text || '0')}</span></div></div>${o.sub ? `<div class="rg-sub">${accent(esc(o.sub))}</div>` : ''}</div>`,
      );
      tweens.push(
        `tl.fromTo(${sel('.rg-ring')}, { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.4, ease: 'back.out(1.7)' }, ${t(0)});`,
        `tl.fromTo(${sel('.rg-arc')}, { opacity: 0 }, { opacity: 1, duration: 0.05 }, ${t(0.1)});`,
        `tl.fromTo(${sel('.rg-arc')}, { attr: { 'stroke-dashoffset': 1 } }, { attr: { 'stroke-dashoffset': ${n(1 - frac)} }, duration: ${n(count)}, ease: 'power2.out' }, ${t(0.1)});`,
      );
      if (stat) tweens.push(countUp(`${id} .rg-v`, stat, count, s + 0.1));
      if (len > count + 0.6) tweens.push(`tl.fromTo(${sel('.rg-num')}, { scale: 1 }, { scale: 1.12, duration: 0.14, ease: 'power2.out', yoyo: true, repeat: 1 }, ${t(0.1 + count)});`);
      if (o.sub) tweens.push(`tl.fromTo(${sel('.rg-sub')}, { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: 'power2.out' }, ${t(0.35)});`);
      exit('.gw');
      break;
    }

    case 'rating': {
      const stars = ratingStars(o.text);
      const step = ratingStep(o);
      const stat = parseStat(o.text);
      const fills = [0, 1, 2, 3, 4].map((k) => Math.max(0, Math.min(1, stars - k)));
      html = wrap(
        `<div class="rt"><div class="rt-num"><span class="rt-v">${esc(o.text || '0')}</span></div><div class="rt-stars">${fills
          .map((_, k) => `<div class="rt-s rt-s${k}"><svg class="rt-e" viewBox="0 0 24 24"><path d="${STAR}"/></svg><svg class="rt-f" viewBox="0 0 24 24"><path d="${STAR}"/></svg></div>`)
          .join('')}</div>${o.sub ? `<div class="rt-sub">${accent(esc(o.sub))}</div>` : ''}</div>`,
      );
      tweens.push(
        `tl.fromTo(${sel('.rt-num')}, { scale: 0.5, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(2)' }, ${t(0)});`,
        `tl.fromTo(${sel('.rt-stars')}, { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: 'power2.out' }, ${t(0.05)});`,
      );
      fills.forEach((f, k) => {
        tweens.push(
          `tl.fromTo(${sel(`.rt-s${k}`)}, { scale: 0 }, { scale: 1, duration: 0.3, ease: 'back.out(2.6)' }, ${t(0.08 + k * 0.05)});`,
          `tl.fromTo(${sel(`.rt-s${k} .rt-f`)}, { clipPath: 'inset(0% 100% 0% 0%)' }, { clipPath: 'inset(0% ${n(100 - f * 100)}% 0% 0%)', duration: ${n(step + 0.06)}, ease: 'power1.out' }, ${t(0.35 + k * step)});`,
        );
      });
      if (stat) tweens.push(countUp(`${id} .rt-v`, stat, 5 * step + 0.06, s + 0.35));
      if (len > 0.9 + 5 * step) tweens.push(`tl.fromTo(${sel('.rt-stars')}, { scale: 1 }, { scale: 1.06, duration: 0.14, ease: 'power2.out', yoyo: true, repeat: 1, immediateRender: false }, ${t(0.4 + 5 * step)});`);
      if (o.sub) tweens.push(`tl.fromTo(${sel('.rt-sub')}, { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: 'power2.out' }, ${t(0.3)});`);
      exit('.gw');
      break;
    }

    case 'price': {
      const old = o.sub.trim();
      const at = priceNewAt(o);
      html = wrap(`<div class="pr">${old ? `<div class="pr-old" style="font-size:${fit(old, 100, W * 0.86, 0.68, true)}px"><span>${esc(old)}</span><i class="pr-x"></i></div>` : ''}<div class="pr-tag" style="font-size:${fit(o.text || ' ', 210, W * 0.9 - 220, 0.5, true)}px"><i class="pr-hole"></i><span class="pr-new">${accent(esc(o.text || ' '))}</span></div></div>`);
      if (old)
        tweens.push(
          `tl.fromTo(${sel('.pr-old')}, { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: 'power2.out' }, ${t(0)});`,
          `tl.fromTo(${sel('.pr-x')}, { scaleX: 0, rotation: -9 }, { scaleX: 1, rotation: -9, duration: 0.28, ease: 'power2.out' }, ${t(0.35)});`,
          `tl.fromTo(${sel('.pr-old span')}, { opacity: 1 }, { opacity: 0.5, duration: 0.3 }, ${t(0.62)});`,
        );
      tweens.push(
        `tl.fromTo(${sel('.pr-tag')}, { scale: 2.4, rotation: -18, opacity: 0 }, { scale: 1, rotation: -4, opacity: 1, duration: 0.24, ease: 'power4.in' }, ${t(at)});`,
        `tl.fromTo(${sel('.pr')}, { y: 14 }, { y: 0, duration: 0.45, ease: 'elastic.out(1, 0.3)' }, ${t(at + 0.24)});`,
      );
      if (len > at + 1.4) tweens.push(`tl.fromTo(${sel('.pr-tag')}, { rotation: -4 }, { rotation: 2, duration: 0.18, ease: 'sine.inOut', yoyo: true, repeat: 1, immediateRender: false }, ${t(at + 0.8)});`);
      exit('.gw');
      break;
    }

    case 'comment': {
      const handle = o.sub.trim();
      const initial = (/[\p{L}\p{N}]/u.exec(handle || o.text)?.[0] ?? '?').toUpperCase();
      html = wrap(
        `<div class="cm"><div class="cm-av">${esc(initial)}</div><div class="cm-b">${handle ? `<div class="cm-u">${esc(handle)}</div>` : ''}<div class="cm-t">${wordSpans(o.text || ' ', 'cmw')}</div><div class="cm-f">Reply</div></div><div class="cm-like"><svg class="cm-h0" viewBox="0 0 24 24"><path d="${HEART}"/></svg><svg class="cm-h1" viewBox="0 0 24 24"><path d="${HEART}"/></svg></div></div>`,
      );
      tweens.push(
        `tl.fromTo(${sel('.cm')}, { scale: 0.55, y: 70, opacity: 0 }, { scale: 1, y: 0, opacity: 1, duration: 0.42, ease: 'back.out(1.8)' }, ${t(0)});`,
        `tl.fromTo(${sel('.cmw')}, { y: 14, opacity: 0 }, { y: 0, opacity: 1, duration: 0.22, ease: 'power2.out', stagger: 0.04 }, ${t(0.2)});`,
        `tl.fromTo(${sel('.cm-h1')}, { scale: 0 }, { scale: 1, duration: 0.4, ease: 'back.out(4)' }, ${t(commentLikeAt(o))});`,
      );
      exit('.gw');
      break;
    }

    case 'notification': {
      const top = o.position === 'top';
      html = `<div class="gw" style="${top ? `top:${px(H * 0.05)}` : place(o.position)}"><div class="nt"><div class="nt-ic"><svg viewBox="0 0 24 24"><path d="${BELL}"/></svg></div><div class="nt-b"><div class="nt-r"><span class="nt-t">${accent(esc(o.text || ' '))}</span><span class="nt-now">now</span></div>${o.sub ? `<div class="nt-s">${accent(esc(o.sub))}</div>` : ''}</div></div></div>`;
      // From above the frame at the top; elsewhere it drops in a little way and fades.
      const from = top ? `y: ${n(-(H * 0.05 + 360))}, opacity: 1` : 'y: -110, opacity: 0';
      tweens.push(
        `tl.fromTo(${sel('.nt')}, { ${from} }, { y: 0, opacity: 1, duration: 0.5, ease: 'back.out(1.3)' }, ${t(0)});`,
        `tl.fromTo(${sel('.nt-ic svg')}, { rotation: -24 }, { rotation: 0, duration: 0.8, ease: 'elastic.out(1.2, 0.25)' }, ${t(0.3)});`,
      );
      if (len > 1.2) tweens.push(`tl.to(${sel('.nt')}, { ${from}, duration: 0.3, ease: 'power2.in' }, ${exitAt});`);
      break;
    }

    case 'search': {
      const q = o.text.replace(/\*/g, '') || 'Search';
      const typeAt = s + 0.35;
      const typeEnd = typeAt + searchTypeSeconds(o);
      const sugg = o.items.slice(0, 3).map((x) => x.replace(/\*/g, ''));
      // Suggestions show the typed part plain and the rest bold, as search boxes do.
      const suggest = (x: string) => (x.toLowerCase().startsWith(q.toLowerCase()) ? `${esc(x.slice(0, q.length))}<b>${esc(x.slice(q.length))}</b>` : `<b>${esc(x)}</b>`);
      html = wrap(
        `<div class="sr"><div class="sr-bar"><svg class="sr-ic" viewBox="0 0 24 24">${LENS}</svg><div class="sr-q"><span class="sr-v"></span><span class="sr-cur"></span></div></div>${
          sugg.length ? `<div class="sr-list">${sugg.map((x, k) => `<div class="sr-s sr-s${k}"><svg viewBox="0 0 24 24">${LENS}</svg><span>${suggest(x)}</span></div>`).join('')}</div>` : ''
        }</div>`,
      );
      tweens.push(
        `tl.fromTo(${sel('.sr-bar')}, { scale: 0.8, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(1.8)' }, ${t(0)});`,
        `(() => { const el = document.querySelector(${js(`${id} .sr-v`)}); if (!el) return; const q = Array.from(${js(q)}); const c = { v: 0 }; tl.fromTo(c, { v: 0 }, { v: q.length, duration: ${n(typeEnd - typeAt)}, ease: 'none', onUpdate: () => { el.textContent = q.slice(0, Math.round(c.v)).join(''); } }, ${n(typeAt)}); })();`,
        `tl.fromTo(${sel('.sr-bar')}, { scale: 1 }, { scale: 0.96, duration: 0.08, ease: 'power2.out', yoyo: true, repeat: 1, immediateRender: false }, ${n(typeEnd + 0.1)});`,
      );
      // The cursor stays lit while typing, then blinks.
      const blinks = Math.floor((o.end - typeEnd) / 0.5) - 1;
      if (blinks > 0) tweens.push(`tl.fromTo(${sel('.sr-cur')}, { opacity: 1 }, { opacity: 0, duration: 0.5, ease: 'steps(1)', yoyo: true, repeat: ${blinks} }, ${n(typeEnd)});`);
      if (sugg.length) tweens.push(`tl.fromTo(${sel('.sr-s')}, { y: -16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.25, ease: 'power2.out', stagger: 0.08 }, ${n(typeEnd + 0.25)});`, `tl.fromTo(${sel('.sr-list')}, { opacity: 0 }, { opacity: 1, duration: 0.2 }, ${n(typeEnd + 0.2)});`);
      exit('.gw');
      break;
    }

    case 'highlight': {
      // Runs of *marked* words (or the whole phrase when none are) get a marker swiped behind them.
      const words = graphicWords(o.text || ' ');
      const any = words.some((w) => w.accent);
      const parts: string[] = [];
      let run: string[] = [];
      let runs = 0;
      const flush = () => {
        if (run.length) parts.push(`<span class="hl-m hl-m${runs++}">${run.join(' ')}</span>`);
        run = [];
      };
      words.forEach((w) => {
        if (!any || w.accent) run.push(esc(w.text));
        else {
          flush();
          parts.push(esc(w.text));
        }
      });
      flush();
      html = wrap(`<div class="hl" style="font-size:${fit(o.text, 96, W * 0.86)}px">${parts.join(' ')}</div>`);
      tweens.push(`tl.fromTo(${sel('.hl')}, { y: 40, scale: 0.94, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.35, ease: 'power3.out' }, ${t(0)});`);
      for (let k = 0; k < runs; k++)
        tweens.push(
          `tl.fromTo(${sel(`.hl-m${k}`)}, { backgroundSize: '0% 76%', color: '#ffffff', webkitTextStrokeColor: '#000000' }, { backgroundSize: '100% 76%', color: '#111111', webkitTextStrokeColor: ${js(color)}, duration: 0.4, ease: 'power2.inOut' }, ${t(markerAt(o, k))});`,
        );
      exit('.gw');
      break;
    }

    case 'reveal': {
      const words = graphicWords(o.text || ' ');
      const letters = words.reduce((a, w) => a + Array.from(w.text).length, 0);
      const stagger = Math.min(0.07, Math.min(1.3, len * 0.5) / Math.max(1, letters));
      html = wrap(`<div class="rv" style="font-size:${fit(o.text, 112, W * 0.86, 0.86)}px">${words.map((w) => `<span class="rv-wd${w.accent ? ' acc' : ''}">${Array.from(w.text).map((c) => `<span class="rv-c">${esc(c)}</span>`).join('')}</span>`).join(' ')}</div>`);
      tweens.push(
        `tl.fromTo(${sel('.rv-c')}, { opacity: 0, scale: 1.5, filter: 'blur(26px)' }, { opacity: 1, scale: 1, filter: 'blur(0px)', duration: 0.45, ease: 'power2.out', stagger: ${n(stagger)} }, ${t(0.05)});`,
        `tl.fromTo(${sel('.rv')}, { scale: 1.08 }, { scale: 1, duration: ${n(Math.min(len, 0.6 + letters * stagger))}, ease: 'power2.out' }, ${t(0)});`,
      );
      exit('.gw');
      break;
    }

    case 'question': {
      html = `<div class="qn-bg"></div>${wrap(`<div class="qn"><div class="qn-mark">?</div><div class="qn-t" style="font-size:${fit(o.text, 76, W * 0.84)}px">${wordSpans(o.text || ' ', 'qnw')}</div></div>`, 'center')}`;
      tweens.push(
        `tl.fromTo(${sel('.qn-bg')}, { opacity: 0 }, { opacity: 1, duration: 0.25 }, ${t(0)});`,
        `tl.fromTo(${sel('.qn-mark')}, { y: -260, rotation: -30, scale: 0.4, opacity: 0 }, { y: 0, rotation: 0, scale: 1, opacity: 1, duration: 0.5, ease: 'back.out(1.6)' }, ${t(0)});`,
        `tl.fromTo(${sel('.qnw')}, { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 0.3, ease: 'power2.out', stagger: 0.06 }, ${t(0.3)});`,
      );
      if (len > 2) tweens.push(`tl.fromTo(${sel('.qn-mark')}, { rotation: 0 }, { rotation: 9, duration: 0.22, ease: 'sine.inOut', yoyo: true, repeat: 3, immediateRender: false }, ${t(0.7)});`);
      exit('.gw');
      exit('.qn-bg');
      break;
    }

    case 'definition': {
      html = wrap(`<div class="df"><div class="df-w" style="font-size:${fit(o.text, 112, W * 0.86 - 132)}px">${accent(esc(o.text || ' '))}</div><div class="df-line"></div>${o.sub ? `<div class="df-s"><span class="df-n">1.</span>${accent(esc(o.sub))}</div>` : ''}</div>`);
      tweens.push(
        `tl.fromTo(${sel('.df')}, { y: 60, rotation: -3, opacity: 0 }, { y: 0, rotation: 0, opacity: 1, duration: 0.42, ease: 'back.out(1.5)' }, ${t(0)});`,
        `tl.fromTo(${sel('.df-w')}, { clipPath: 'inset(0% 100% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.5, ease: 'power3.out' }, ${t(0.15)});`,
        `tl.fromTo(${sel('.df-line')}, { scaleX: 0 }, { scaleX: 1, duration: 0.35, ease: 'power3.out' }, ${t(0.45)});`,
      );
      if (o.sub) tweens.push(`tl.fromTo(${sel('.df-s')}, { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: 'power2.out' }, ${t(0.55)});`);
      exit('.gw');
      break;
    }

    case 'ticker': {
      const heads = o.items.length ? o.items : o.text ? [o.text] : ['Add your headlines'];
      const one = heads.map((h) => `<span class="tk-i">${accent(esc(h))}</span><i class="tk-dot"></i>`).join('');
      // Enough copies of the headlines to keep the strip full for the whole scroll (a generous guess at their width).
      const speed = 230;
      const copyWidth = Math.max(240, heads.reduce((a, h) => a + h.length, 0) * 20 + heads.length * 90);
      const copies = Math.min(40, Math.ceil((W + speed * len) / copyWidth) + 1);
      html = wrap(`<div class="tk">${o.sub ? `<div class="tk-l">${esc(o.sub)}</div>` : ''}<div class="tk-v"><div class="tk-track">${one.repeat(copies)}</div></div></div>`);
      tweens.push(
        `tl.fromTo(${sel('.tk')}, { scaleY: 0 }, { scaleY: 1, duration: 0.3, ease: 'power3.out' }, ${t(0)});`,
        `tl.fromTo(${sel('.tk-track')}, { x: ${n(W * 0.15)} }, { x: ${n(W * 0.15 - speed * len)}, duration: ${n(len)}, ease: 'none' }, ${t(0)});`,
      );
      if (o.sub) tweens.push(`tl.fromTo(${sel('.tk-l')}, { xPercent: -110 }, { xPercent: 0, duration: 0.35, ease: 'power3.out' }, ${t(0.12)});`);
      exit('.gw');
      break;
    }

    case 'circle': {
      const cx = o.x * W;
      const cy = o.y * H;
      const rx = W * 0.17;
      const ry = W * 0.12;
      // A loose, slightly spiralling loop that overshoots its start, like a circle drawn by hand.
      const pts: string[] = [];
      for (let k = 0; k <= 72; k++) {
        const f = k / 72;
        const a = -2.3 + f * 1.12 * 2 * Math.PI;
        const g = 1 + 0.08 * f + 0.025 * Math.sin(a * 3);
        pts.push(`${n(cx + Math.cos(a) * rx * g)} ${n(cy + Math.sin(a) * ry * g)}`);
      }
      const above = o.y > 0.3;
      // The label is kept inside the frame by its rough width.
      const size = fit(o.text, 64, W * 0.9, 0.64, true);
      const half = Math.min(W * 0.46, (Array.from(o.text.replace(/\*/g, '')).length * size * 0.64) / 2);
      const lx = Math.min(W - W * 0.04 - half, Math.max(W * 0.04 + half, cx));
      const ly = above ? cy - ry * 1.2 - 80 : cy + ry * 1.2 + 80;
      html =
        `<svg class="ci-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><path class="ci-p" d="M ${pts.join(' L ')}" pathLength="1" stroke-dasharray="1 1" stroke-dashoffset="1" transform="rotate(-8 ${n(cx)} ${n(cy)})"/></svg>` +
        (o.text ? `<div class="ci-l" style="left:${px(lx)};top:${px(ly)}"><span style="font-size:${size}px">${accent(esc(o.text))}</span></div>` : '');
      tweens.push(
        `tl.fromTo(${sel('.ci-p')}, { opacity: 0 }, { opacity: 1, duration: 0.04 }, ${t(0)});`,
        `tl.fromTo(${sel('.ci-p')}, { attr: { 'stroke-dashoffset': 1 } }, { attr: { 'stroke-dashoffset': 0 }, duration: 0.55, ease: 'power2.inOut' }, ${t(0)});`,
      );
      if (o.text) tweens.push(`tl.fromTo(${sel('.ci-l span')}, { scale: 0.5, rotation: -14, opacity: 0 }, { scale: 1, rotation: -4, opacity: 1, duration: 0.35, ease: 'back.out(2.2)' }, ${t(0.4)});`);
      exit('.ci-svg');
      exit('.ci-l');
      break;
    }
  }
  return { html, tweens };
}

/** Styles for every template (added once when an edit has graphics). */
export function graphicsCss(ctx: GraphicContext) {
  const { W, H, color, font } = ctx;
  const stroke = '-webkit-text-stroke: 0.14em #000; paint-order: stroke fill; text-shadow: 0 0.05em 0.16em rgba(0,0,0,.5);';
  return `
.g .acc { color: ${color}; }
.g-lowerThird .lt { position: absolute; display: flex; align-items: stretch; gap: 18px; transform: translateY(-50%); max-width: 86%; }
.lt-bar { width: 12px; flex: none; border-radius: 6px; background: ${color}; transform-origin: 50% 100%; }
.lt-body { background: rgba(10,10,10,.84); border-radius: 18px; padding: 22px 34px 24px; }
.lt-name { font: 800 58px/1.1 ${font('Montserrat')}; color: #fff; }
.lt-sub { font: 600 38px/1.25 ${font('Inter')}; color: rgba(255,255,255,.82); margin-top: 6px; }
.g-stat .st { position: absolute; left: 0; right: 0; transform: translateY(-50%); text-align: center; }
.st-num { font: 400 230px/1 ${font('Anton')}; color: ${color}; -webkit-text-stroke: 0.05em #000; paint-order: stroke fill; text-shadow: 0 0.04em 0.2em rgba(0,0,0,.5); }
.st-sub { font: 800 54px/1.15 ${font('Montserrat')}; color: #fff; text-transform: uppercase; max-width: 80%; margin: 18px auto 0; ${stroke} }
.g-list .ls { position: absolute; left: 7%; right: 7%; transform: translateY(-50%); background: rgba(10,10,10,.8); border-radius: 36px; padding: 44px 46px; box-sizing: border-box; }
.ls-h { font: 900 70px/1.08 ${font('Montserrat')}; color: #fff; margin-bottom: 28px; }
.ls-items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 22px; }
.ls-i { display: flex; align-items: center; gap: 24px; }
.ls-n { flex: none; width: 76px; height: 76px; border-radius: 50%; background: ${color}; color: #111; display: grid; place-items: center; font: 900 42px/1 ${font('Montserrat')}; }
.ls-t { font: 700 48px/1.2 ${font('Inter')}; color: #fff; }
.g-checklist .cl { position: absolute; left: 7%; right: 7%; transform: translateY(-50%); background: rgba(10,10,10,.8); border-radius: 36px; padding: 44px 46px; box-sizing: border-box; }
.cl-h { font: 900 68px/1.08 ${font('Montserrat')}; color: #fff; margin-bottom: 26px; }
.cl-items { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 22px; }
.cl-i { display: flex; align-items: center; gap: 24px; }
.cl-box { flex: none; width: 76px; height: 76px; overflow: visible; }
.cl-box rect { fill: none; stroke: ${color}; stroke-width: 6; }
.cl-tick { fill: none; stroke: ${color}; stroke-width: 9; stroke-linecap: round; stroke-linejoin: round; }
.cl-t { font: 700 48px/1.2 ${font('Inter')}; color: #fff; }
.g-chart .bc { position: absolute; left: 7%; right: 7%; transform: translateY(-50%); background: rgba(10,10,10,.8); border-radius: 36px; padding: 40px 44px; box-sizing: border-box; }
.bc-h { font: 900 62px/1.08 ${font('Montserrat')}; color: #fff; margin-bottom: 26px; }
.bc-r { display: grid; grid-template-columns: 24% 1fr 17%; align-items: center; gap: 16px; margin-top: 20px; }
.bc-l { font: 700 38px/1.15 ${font('Inter')}; color: rgba(255,255,255,.9); overflow-wrap: anywhere; }
.bc-track { height: 56px; border-radius: 14px; background: rgba(255,255,255,.12); overflow: hidden; }
.bc-bar { height: 100%; border-radius: 14px; background: ${color}; transform-origin: 0 50%; }
.bc-v { font: 800 44px/1 ${font('Montserrat')}; color: #fff; }
.g-wall .wl { position: absolute; left: 6%; right: 6%; transform: translateY(-50%); display: flex; flex-direction: column; gap: 18px; }
.wl-h { font: 800 44px/1.2 ${font('Inter')}; color: ${color}; text-transform: uppercase; letter-spacing: .14em; text-align: center; text-shadow: 0 2px 10px rgba(0,0,0,.6); }
.wl-c { background: #f4f1ea; color: #15130f; border-radius: 10px; padding: 24px 30px; font: 800 52px/1.15 ${font('Montserrat')}; box-shadow: 0 14px 34px rgba(0,0,0,.45); }
.wl-c .acc { color: #fff; background: #15130f; padding: 0 .2em; border-radius: 6px; }
.qt-bg { position: absolute; inset: 0; background: rgba(0,0,0,.5); }
.g-quote .qt { position: absolute; left: 8%; right: 8%; transform: translateY(-50%); }
.qt-mark { font: 400 300px/0.8 ${font('Anton')}; color: ${color}; height: 150px; transform-origin: 20% 60%; }
.qt-text { font: 800 66px/1.18 ${font('Montserrat')}; color: #fff; ${stroke} }
.qw { display: inline-block; }
.qt-by { font: 600 40px/1.2 ${font('Inter')}; color: rgba(255,255,255,.88); margin-top: 26px; }
.co-svg { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; overflow: visible; }
.co-line { stroke: ${color}; stroke-width: 10; fill: none; stroke-linecap: round; }
.co-head { fill: ${color}; }
.co-ring { position: absolute; width: 124px; height: 124px; box-sizing: border-box; border: 9px solid ${color}; border-radius: 50%; box-shadow: 0 0 0 4px rgba(0,0,0,.35); }
.co-label { position: absolute; width: 0; height: 0; display: flex; align-items: center; justify-content: center; }
.co-label span { flex: none; white-space: nowrap; font: 800 50px/1 ${font('Montserrat')}; color: #111; background: ${color}; padding: 20px 34px; border-radius: 999px; box-shadow: 0 10px 30px rgba(0,0,0,.35); }
.wh-svg { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; overflow: visible; filter: drop-shadow(0 4px 6px rgba(0,0,0,.55)); }
.wh-line, .wh-head { stroke: ${color}; stroke-width: 13; fill: none; stroke-linecap: round; stroke-linejoin: round; }
.wh-at { position: absolute; width: 0; height: 0; display: flex; justify-content: center; align-items: flex-start; }
.wh-card { flex: none; white-space: nowrap; background: ${color}; color: #111; border-radius: 16px; padding: 16px 30px 18px; box-shadow: 0 12px 30px rgba(0,0,0,.4); text-align: center; }
.wh-name { font-weight: 900; line-height: 1.1; font-family: ${font('Montserrat')}; }
.wh-sub { font-weight: 700; line-height: 1.25; margin-top: 8px; font-family: ${font('Inter')}; color: rgba(17,17,17,.78); }
.wh-card .acc { color: #fff; }
.ch-bg { position: absolute; inset: 0; background: #0d0d0f; display: flex; align-items: center; justify-content: center; }
.ch { width: 84%; text-align: center; }
.ch-k { font: 700 44px/1.2 ${font('Inter')}; color: ${color}; text-transform: uppercase; letter-spacing: .2em; }
.ch-bar { width: 120px; height: 10px; border-radius: 5px; background: ${color}; margin: 26px auto 30px; }
.ch-t { font: 900 112px/1.04 ${font('Montserrat')}; color: #fff; }
.g-cta .cta { position: absolute; left: 0; right: 0; height: 0; display: flex; align-items: center; justify-content: center; }
.cta-pill { display: flex; align-items: center; gap: 22px; background: #fff; color: #111; border-radius: 999px; padding: 20px 44px 20px 20px; box-shadow: 0 12px 40px rgba(0,0,0,.35); font: 800 52px/1 ${font('Montserrat')}; white-space: nowrap; }
.cta-ic { width: 76px; height: 76px; border-radius: 50%; background: ${color}; color: #111; display: grid; place-items: center; font: 900 60px/1 ${font('Montserrat')}; }
.g-cta .acc { color: inherit; text-decoration: underline; text-decoration-color: ${color}; text-decoration-thickness: .12em; }
.pg { position: absolute; left: 0; right: 0; height: 14px; background: rgba(255,255,255,.22); }
.pg-fill { height: 100%; background: ${color}; transform-origin: 0 50%; }
.kn-bg { position: absolute; inset: 0; background: rgba(0,0,0,.62); }
.kn { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
.kn-in { max-width: 86%; text-align: center; font: 400 170px/1.02 ${font('Anton')}; text-transform: uppercase; color: #fff; }
.kw { display: inline-block; margin: 0 .06em; }
/* One colour for the whole line (a colour change makes it harder to read): the accent words are just bigger. */
.kn-in .acc { color: inherit; font-size: 1.14em; }
.gw { position: absolute; left: 0; right: 0; }
.vs { position: relative; margin: 0 6%; display: flex; flex-direction: column; gap: 18px; }
.vs-a, .vs-b { min-height: 250px; box-sizing: border-box; border-radius: 36px; display: flex; align-items: center; justify-content: center; text-align: center; box-shadow: 0 16px 44px rgba(0,0,0,.4); }
.vs-a { background: rgba(14,14,16,.9); padding: 48px 56px 112px; }
.vs-b { background: ${color}; padding: 112px 56px 48px; }
.vs-t { font: 900 76px/1.06 ${font('Montserrat')}; color: #fff; overflow-wrap: anywhere; }
.vs-b .vs-t { color: #111; }
.vs-b .acc { color: #fff; -webkit-text-stroke: .1em #111; paint-order: stroke fill; }
.vs-badge { position: absolute; left: calc(50% - 92px); top: calc(50% - 92px); width: 184px; height: 184px; box-sizing: border-box; border-radius: 50%; background: #fff; color: #111; border: 12px solid #111; display: grid; place-items: center; font: 400 96px/1 ${font('Anton')}; box-shadow: 0 10px 36px rgba(0,0,0,.5); }
.tm { margin: 0 7%; background: rgba(10,10,10,.82); border-radius: 36px; padding: 44px 46px 34px; }
.tm-h { font: 900 64px/1.08 ${font('Montserrat')}; color: #fff; margin-bottom: 18px; }
.tm-i { position: relative; display: flex; align-items: flex-start; gap: 32px; padding: 12px 0; }
.tm-seg { position: absolute; left: 22px; top: 64px; bottom: -12px; width: 8px; background: rgba(255,255,255,.16); }
.tm-fill { height: 100%; background: ${color}; transform-origin: 50% 0; }
.tm-dot { position: relative; flex: none; width: 52px; height: 52px; box-sizing: border-box; border-radius: 50%; border: 8px solid rgba(255,255,255,.35); background: #1c1c1f; }
.tm-b { min-width: 0; padding-top: 2px; }
.tm-d { font: 800 34px/1.15 ${font('Montserrat')}; color: ${color}; letter-spacing: .04em; margin-bottom: 4px; }
.tm-t { font: 700 46px/1.18 ${font('Inter')}; color: #fff; }
.rk { margin: 0 7%; display: flex; flex-direction: column; gap: 16px; }
.rk-h { font: 900 66px/1.08 ${font('Montserrat')}; color: #fff; text-align: center; margin-bottom: 8px; ${stroke} }
.rk-c { display: flex; align-items: center; gap: 24px; background: rgba(12,12,14,.88); border-radius: 26px; padding: 16px 36px 16px 20px; box-shadow: 0 12px 30px rgba(0,0,0,.35); }
.rk-n { flex: none; width: 140px; text-align: center; font: 400 96px/1 ${font('Anton')}; color: ${color}; }
.rk-hash { font-size: .5em; vertical-align: .62em; margin-right: 4px; opacity: .8; }
.rk-t { min-width: 0; font: 800 50px/1.15 ${font('Montserrat')}; color: #fff; overflow-wrap: anywhere; }
.rk-top { background: ${color}; }
.rk-top .rk-n, .rk-top .rk-t { color: #111; }
.rk-top .acc { color: #fff; -webkit-text-stroke: .1em #111; paint-order: stroke fill; }
.sp { margin: 0 7%; background: rgba(10,10,10,.82); border-radius: 36px; padding: 44px 46px 50px; }
.sp-h { font: 900 62px/1.08 ${font('Montserrat')}; color: #fff; margin-bottom: 30px; }
.sp-bar { position: relative; height: 88px; margin: 0 44px; }
.sp-seg { position: absolute; top: 40px; height: 8px; background: rgba(255,255,255,.18); }
.sp-fill { height: 100%; background: ${color}; transform-origin: 0 50%; }
.sp-dot { position: absolute; top: 0; width: 88px; height: 88px; box-sizing: border-box; border-radius: 50%; border: 6px solid rgba(255,255,255,.3); background: #1c1c1f; color: rgba(255,255,255,.55); display: grid; place-items: center; font: 900 40px/1 ${font('Montserrat')}; }
.sp-cards { display: grid; margin-top: 40px; }
.sp-c { grid-area: 1 / 1; }
.sp-k { font: 800 34px/1.1 ${font('Inter')}; color: ${color}; text-transform: uppercase; letter-spacing: .14em; margin-bottom: 12px; }
.sp-k span { color: rgba(255,255,255,.45); }
.sp-t { font: 800 66px/1.12 ${font('Montserrat')}; color: #fff; }
.pc { margin: 0 5%; background: rgba(10,10,10,.84); border-radius: 36px; padding: 40px 30px 46px; }
.pc-h { font: 900 62px/1.08 ${font('Montserrat')}; color: #fff; text-align: center; margin-bottom: 30px; }
.pc-cols { display: grid; grid-template-columns: 1fr 1fr; }
.pc-col { min-width: 0; padding: 0 22px; }
.pc-col + .pc-col { border-left: 4px solid rgba(255,255,255,.14); }
.pc-hd { font: 900 46px/1 ${font('Montserrat')}; text-transform: uppercase; letter-spacing: .04em; padding-bottom: 16px; border-bottom: 6px solid; }
.pc-a .pc-hd { color: ${color}; border-color: ${color}; }
.pc-b .pc-hd { color: #ff6464; border-color: #ff6464; }
.pc-i { display: flex; align-items: flex-start; gap: 16px; margin-top: 24px; font: 700 40px/1.22 ${font('Inter')}; color: #fff; }
.pc-i span { min-width: 0; overflow-wrap: anywhere; }
.pc-ic { flex: none; width: 50px; height: 50px; }
.pc-a .pc-ic circle { fill: ${color}; }
.pc-b .pc-ic circle { fill: #ff6464; }
.pc-ic path { fill: none; stroke: #111; stroke-width: 5.5; stroke-linecap: round; stroke-linejoin: round; }
.rg { display: flex; flex-direction: column; align-items: center; }
.rg-ring { position: relative; width: 600px; height: 600px; }
.rg-svg { width: 100%; height: 100%; overflow: visible; filter: drop-shadow(0 8px 24px rgba(0,0,0,.45)); }
.rg-track { fill: rgba(10,10,10,.6); stroke: rgba(255,255,255,.18); stroke-width: 36; }
.rg-arc { fill: none; stroke: ${color}; stroke-width: 36; stroke-linecap: round; }
.rg-num { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font: 400 170px/1 ${font('Anton')}; color: #fff; }
.rg-num.sm { font-size: 130px; }
.rg-num.xs { font-size: 96px; }
.rg-sub { font: 800 54px/1.15 ${font('Montserrat')}; color: #fff; text-transform: uppercase; text-align: center; max-width: 84%; margin-top: 26px; ${stroke} }
.rt { display: flex; flex-direction: column; align-items: center; }
.rt-num { font: 400 200px/1 ${font('Anton')}; color: ${color}; -webkit-text-stroke: 0.05em #000; paint-order: stroke fill; text-shadow: 0 0.04em 0.2em rgba(0,0,0,.5); }
.rt-stars { display: flex; gap: 14px; margin-top: 20px; padding: 22px 30px; background: rgba(10,10,10,.72); border-radius: 999px; }
.rt-s { position: relative; width: 136px; height: 136px; }
.rt-s svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.rt-e path { fill: rgba(255,255,255,.2); }
.rt-f path { fill: ${color}; }
.rt-sub { font: 800 54px/1.15 ${font('Montserrat')}; color: #fff; text-transform: uppercase; text-align: center; max-width: 84%; margin-top: 26px; ${stroke} }
.pr { display: flex; flex-direction: column; align-items: center; gap: 34px; filter: drop-shadow(0 14px 30px rgba(0,0,0,.45)); }
.pr-old { position: relative; font: 800 100px/1 ${font('Montserrat')}; color: #fff; ${stroke} }
.pr-x { position: absolute; left: -8%; right: -8%; top: calc(50% - 7px); height: 14px; border-radius: 7px; background: #ff4d4d; transform-origin: 0 50%; }
.pr-tag { position: relative; background: ${color}; color: #111; font: 400 210px/1 ${font('Anton')}; padding: 36px 80px 36px 140px; clip-path: polygon(80px 0, 100% 0, 100% 100%, 80px 100%, 0 50%); white-space: nowrap; }
.pr-hole { position: absolute; left: 58px; top: calc(50% - 20px); width: 40px; height: 40px; border-radius: 50%; background: rgba(0,0,0,.7); }
.pr-new .acc { color: #fff; -webkit-text-stroke: .06em #111; paint-order: stroke fill; }
.cm { margin: 0 6%; display: flex; align-items: flex-start; gap: 26px; background: #fff; border-radius: 34px; padding: 34px 32px 30px; box-shadow: 0 18px 50px rgba(0,0,0,.4); transform-origin: 12% 100%; }
.cm-av { flex: none; width: 96px; height: 96px; border-radius: 50%; background: ${color}; color: #111; display: grid; place-items: center; font: 900 46px/1 ${font('Montserrat')}; }
.cm-b { flex: 1; min-width: 0; }
.cm-u { font: 700 34px/1.2 ${font('Inter')}; color: #6b6b72; margin-bottom: 8px; }
.cm-t { font: 700 50px/1.24 ${font('Inter')}; color: #111; }
.cmw { display: inline-block; }
.cm .acc { color: #111; background: ${color}; padding: 0 .12em; border-radius: 8px; }
.cm-f { margin-top: 16px; font: 600 32px/1 ${font('Inter')}; color: #8a8a92; }
.cm-like { flex: none; position: relative; width: 60px; height: 60px; margin-top: 30px; }
.cm-like svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.cm-h0 path { fill: none; stroke: #9a9aa2; stroke-width: 2; }
.cm-h1 path { fill: #ff3b5c; }
.nt { margin: 0 4%; display: flex; align-items: center; gap: 28px; background: rgba(246,246,248,.97); border-radius: 44px; padding: 30px 36px; box-shadow: 0 20px 50px rgba(0,0,0,.4); }
.nt-ic { flex: none; width: 104px; height: 104px; border-radius: 26px; background: ${color}; display: grid; place-items: center; }
.nt-ic svg { width: 62px; height: 62px; fill: #111; transform-origin: 50% 12%; }
.nt-b { flex: 1; min-width: 0; }
.nt-r { display: flex; align-items: baseline; justify-content: space-between; gap: 20px; }
.nt-t { font: 800 44px/1.2 ${font('Inter')}; color: #111; }
.nt-now { flex: none; font: 500 32px/1 ${font('Inter')}; color: #8a8a92; }
.nt-s { font: 500 40px/1.28 ${font('Inter')}; color: #3a3a40; margin-top: 6px; }
.nt .acc { color: #111; background: ${color}; padding: 0 .12em; border-radius: 6px; }
.sr { margin: 0 6%; }
.sr-bar { display: flex; align-items: center; gap: 26px; background: #fff; border-radius: 60px; padding: 32px 44px; box-shadow: 0 18px 50px rgba(0,0,0,.4); }
.sr-ic { flex: none; width: 60px; height: 60px; fill: none; stroke: #111; stroke-width: 2.6; stroke-linecap: round; }
.sr-q { flex: 1; min-width: 0; min-height: 1.2em; font: 600 52px/1.2 ${font('Inter')}; color: #111; overflow-wrap: anywhere; }
.sr-cur { display: inline-block; width: 5px; height: 1.05em; margin-left: 4px; vertical-align: -0.16em; background: #111; }
.sr-list { margin-top: 14px; background: #fff; border-radius: 34px; padding: 12px 0; box-shadow: 0 18px 50px rgba(0,0,0,.35); }
.sr-s { display: flex; align-items: center; gap: 24px; padding: 18px 44px; font: 400 42px/1.2 ${font('Inter')}; color: #222; }
.sr-s svg { flex: none; width: 44px; height: 44px; fill: none; stroke: #8a8a92; stroke-width: 2.4; stroke-linecap: round; }
.sr-s b { font-weight: 800; }
.hl { margin: 0 7%; text-align: center; font: 900 96px/1.28 ${font('Montserrat')}; color: #fff; ${stroke} }
.hl-m { background: linear-gradient(${color}, ${color}) no-repeat 0 60% / 0% 76%; -webkit-box-decoration-break: clone; box-decoration-break: clone; padding: 0 .1em; border-radius: .1em; text-shadow: none; }
.rv { margin: 0 7%; text-align: center; font: 900 112px/1.12 ${font('Montserrat')}; color: #fff; text-transform: uppercase; ${stroke} }
.rv-wd { display: inline-block; white-space: nowrap; }
.rv-c { display: inline-block; }
.qn-bg { position: absolute; inset: 0; background: rgba(0,0,0,.55); }
.qn { margin: 0 8%; text-align: center; }
.qn-mark { display: inline-block; font: 400 380px/0.9 ${font('Anton')}; color: ${color}; -webkit-text-stroke: 0.04em #000; paint-order: stroke fill; text-shadow: 0 0.03em 0.15em rgba(0,0,0,.5); transform-origin: 50% 85%; }
.qn-t { font: 800 76px/1.15 ${font('Montserrat')}; color: #fff; margin-top: 24px; ${stroke} }
.qnw { display: inline-block; }
.df { margin: 0 7%; background: #f4f1ea; color: #15130f; border-radius: 30px; border-left: 16px solid ${color}; padding: 56px 58px 60px; box-shadow: 0 20px 50px rgba(0,0,0,.45); }
.df-w { font: 900 112px/1.05 ${font('Montserrat')}; letter-spacing: -.01em; overflow-wrap: anywhere; }
.df .acc { color: #15130f; background: ${color}; padding: 0 .1em; }
.df-line { width: 160px; height: 10px; border-radius: 5px; background: #15130f; margin: 30px 0 28px; transform-origin: 0 50%; }
.df-s { font: 600 46px/1.32 ${font('Inter')}; color: #3b372f; }
.df-n { font-weight: 900; color: #15130f; margin-right: .35em; }
.tk { display: flex; align-items: stretch; height: 112px; background: rgba(12,12,14,.94); border-top: 6px solid ${color}; box-shadow: 0 10px 30px rgba(0,0,0,.4); overflow: hidden; }
.tk-l { flex: none; position: relative; z-index: 1; display: flex; align-items: center; padding: 0 34px; background: ${color}; color: #111; font: 900 42px/1 ${font('Montserrat')}; text-transform: uppercase; letter-spacing: .05em; white-space: nowrap; }
.tk-v { flex: 1; min-width: 0; overflow: hidden; display: flex; align-items: center; }
.tk-track { flex: none; display: flex; align-items: center; width: max-content; white-space: nowrap; font: 800 46px/1 ${font('Inter')}; color: #fff; }
.tk-i { flex: none; }
.tk-dot { flex: none; width: 16px; height: 16px; margin: 0 40px; background: ${color}; transform: rotate(45deg); }
.ci-svg { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; overflow: visible; filter: drop-shadow(0 4px 10px rgba(0,0,0,.45)); }
.ci-p { fill: none; stroke: ${color}; stroke-width: 13; stroke-linecap: round; stroke-linejoin: round; }
.ci-l { position: absolute; width: 0; height: 0; display: flex; align-items: center; justify-content: center; }
.ci-l span { flex: none; display: inline-block; white-space: nowrap; font: 900 64px/1 ${font('Montserrat')}; color: ${color}; ${stroke} }`;
}
