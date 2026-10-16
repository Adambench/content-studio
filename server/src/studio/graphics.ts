// The motion-graphics templates (GRAPHIC_INFO in shared/edit.ts), compiled into the composition. Each is a full-frame
// layer with its content positioned inside, in the brand's accent colour and fonts, animated on the main timeline with
// seek-safe tweens (fromTo with explicit start states, no randomness). Times are on the finished video.
import { graphicBeats, graphicWords, statCountSeconds, type GraphicOverlay } from '../../../shared/edit';
import { accent, esc, js, n, px } from './html';

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
.kw { display: inline-block; margin: 0 .06em; }`;
}
