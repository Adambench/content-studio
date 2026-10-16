// Builds a scene overlay (shared/scene.ts) into composition HTML and GSAP tweens. Everything that reaches the page is
// escaped or comes from normalizeScene's allow-lists, so a scene is markup and data only, never script.
import { graphicWords, type SceneOverlay } from '../../../shared/edit';
import type { SceneElement } from '../../../shared/scene';
import { accent, esc, js, n } from './html';

export type SceneContext = { W: number; H: number; color: string; font: (family: string) => string; fileUrl: (mediaId: string) => string };

const domId = (i: number, id: string) => `o${i}-${id}`;

function styleAttr(style: Record<string, string>, ctx: SceneContext, base = '') {
  const parts = Object.entries(style).map(([k, v]) => {
    if (k === 'font-family') return `${k}:${ctx.font(v.replace(/'/g, ''))}`;
    return `${k}:${v}`;
  });
  const all = [base, ...parts].filter(Boolean).join(';');
  return all ? ` style="${esc(all)}"` : '';
}

/** Text with its accent words, line breaks, and (when split) a span per word or letter for staggered tweens. */
function textHtml(el: SceneElement) {
  const text = el.text ?? '';
  if (!el.split) return accent(esc(text)).replace(/\n/g, '<br>');
  return text
    .split('\n')
    .map((line) =>
      graphicWords(line)
        .map((w) => {
          const cls = w.accent ? ' acc' : '';
          if (el.split === 'words') return `<span class="sw${cls}">${esc(w.text)}</span>`;
          // Letters stay together as a word, so a line never breaks inside one.
          return `<span class="swd${cls}">${[...w.text].map((c) => `<span class="sch">${esc(c)}</span>`).join('')}</span>`;
        })
        .join(' '),
    )
    .join('<br>');
}

export function composeScene(o: SceneOverlay, i: number, ctx: SceneContext) {
  const { W, H } = ctx;
  const children = new Map<string | undefined, SceneElement[]>();
  for (const el of o.elements) children.set(el.parent, [...(children.get(el.parent) ?? []), el]);

  const render = (el: SceneElement, top: boolean): string => {
    const id = domId(i, el.id);
    // Top-level elements are placed on the frame; nested ones flow inside their box unless they say otherwise.
    const base = top && !el.style.position ? 'position:absolute' : '';
    switch (el.kind) {
      case 'box':
        return `<div id="${id}" class="se"${styleAttr(el.style, ctx, base)}>${(children.get(el.id) ?? []).map((c) => render(c, false)).join('')}</div>`;
      case 'text':
        return `<div id="${id}" class="se st"${styleAttr(el.style, ctx, base)}>${textHtml(el)}</div>`;
      case 'image':
        return `<img id="${id}" class="se" alt="" src="${esc(ctx.fileUrl(el.mediaId!))}"${styleAttr(el.style, ctx, base)}>`;
      case 'path': {
        const draw = el.draw ? ' pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"' : '';
        return `<svg class="sp" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><path id="${id}" d="${esc(el.d!)}"${draw}${styleAttr(el.style, ctx)}/></svg>`;
      }
    }
  };

  const bg = o.background === 'dim' ? '<div class="sc-bg" style="background:rgba(0,0,0,.6)"></div>' : o.background !== 'none' ? `<div class="sc-bg" style="background:${esc(o.background)}"></div>` : '';
  const html = bg + (children.get(undefined) ?? []).map((el) => render(el, true)).join('');

  const tweens = o.tweens.map((t) => {
    const targets = t.targets
      .split(',')
      .map((x) => {
        const [id, part] = x.split('.');
        return `#${domId(i, id)}${part === 'words' ? ' .sw' : part === 'chars' ? ' .sch' : ''}`;
      })
      .join(', ');
    const vars = { ...t.to, duration: t.duration, ...(t.ease && { ease: t.ease }), ...(t.stagger && { stagger: t.stagger }), ...(t.repeat && { repeat: t.repeat }), ...(t.yoyo && { yoyo: true }) };
    const at = n(o.start + t.at);
    return t.from ? `tl.fromTo(${js(targets)}, ${js(t.from)}, ${js(vars)}, ${at});` : `tl.to(${js(targets)}, ${js(vars)}, ${at});`;
  });
  return { html, tweens };
}

/** Defaults scene elements build on (once per edit with scenes). */
export function sceneCss(ctx: SceneContext) {
  return `
.sc .sc-bg { position: absolute; inset: 0; }
.sc .se { box-sizing: border-box; }
.sc .st { font: 800 64px/1.15 ${ctx.font('Montserrat')}; color: #fff; }
.sc .acc { color: ${ctx.color}; }
.sc .sw, .sc .swd, .sc .sch { display: inline-block; }
.sc .swd { white-space: nowrap; }
.sc .sp { position: absolute; left: 0; top: 0; overflow: visible; }
.sc .sp path { stroke: ${ctx.color}; stroke-width: 8; fill: none; stroke-linecap: round; stroke-linejoin: round; }`;
}
