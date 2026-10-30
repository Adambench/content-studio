// Builds a scene overlay (shared/scene.ts) into composition HTML and GSAP tweens. Everything that reaches the page is
// escaped or comes from normalizeScene's allow-lists, so a scene is markup and data only, never script.
import { graphicWords, type SceneOverlay } from '../../../shared/edit';
import { jointTransforms, LOOP_HALF, mascotPose, mascotSvg, MOUTH_HALF, poseKeys, shadowWidth, switches, type MascotId, type MascotKey } from '../../../shared/mascots';
import { sceneWiggles, type SceneElement, type SceneTween } from '../../../shared/scene';
import { accent, esc, js, n } from './html';

/** `mascot`: the page's own, for mascot elements that don't name one. */
export type SceneContext = { W: number; H: number; color: string; font: (family: string) => string; fileUrl: (mediaId: string) => string; mascot?: MascotId | null };

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
      case 'mascot': {
        const m = mascotOf(el, ctx);
        const key = poseKeys(m, mascotPose(m, el.pose ?? 'idle'))[0];
        return `<div id="${id}" class="se sm"${styleAttr(el.style, ctx, base)}>${mascotSvg(m, key, { prefix: `${id}-r`, flip: el.flip })}</div>`;
      }
    }
  };

  const bg = o.background === 'dim' ? '<div class="sc-bg" style="background:rgba(0,0,0,.6)"></div>' : o.background !== 'none' ? `<div class="sc-bg" style="background:${esc(o.background)}"></div>` : '';
  const html = bg + (children.get(undefined) ?? []).map((el) => render(el, true)).join('');

  const mascots = o.elements.filter((el) => el.kind === 'mascot').flatMap((el) => mascotTweens(el, mascotOf(el, ctx), `${domId(i, el.id)}-r`, o));
  const tweens = o.tweens.filter((t) => Object.keys(t.to).length).map((t) => {
    const targets = t.targets
      .split(',')
      .map((x) => {
        const [id, part] = x.split('.');
        return `#${domId(i, id)}${part === 'words' ? ' .sw' : part === 'chars' ? ' .sch' : ''}`;
      })
      .join(', ');
    const to = asAttrs(withIds(t.to, i));
    const vars = {
      ...to,
      duration: t.duration,
      ...(t.ease && { ease: t.ease }),
      ...(t.stagger && { stagger: t.stagger }),
      ...(t.repeat && { repeat: t.repeat }),
      ...(t.repeatDelay && { repeatDelay: t.repeatDelay }),
      ...(t.yoyo && { yoyo: true }),
      // A count-up shows whole numbers.
      ...('innerText' in to && { snap: { innerText: 1 } }),
      ...(t.physics && { physics2D: t.physics }),
    };
    const at = n(o.start + t.at);
    return t.from ? `tl.fromTo(${js(targets)}, ${js(asAttrs(withIds(t.from, i)))}, ${js(vars)}, ${at});` : `tl.to(${js(targets)}, ${js(vars)}, ${at});`;
  });
  tweens.push(...mascots);
  // Wiggle eases are made on the page before the timeline uses them.
  const helpers = sceneWiggles(o).map((name) => {
    const [kind, count] = name.split('-');
    return `if (window.CustomWiggle) CustomWiggle.create(${js(name)}, { wiggles: ${Number(count)}, type: ${js(kind === 'shake' ? 'uniform' : 'easeOut')} });`;
  });
  return { html, tweens, helpers };
}

const mascotOf = (el: SceneElement, ctx: SceneContext): MascotId => el.mascot ?? ctx.mascot ?? 'founder';

/**
 * A mascot's poses as tweens of its joints: each pose tween turns every joint that differs from where it is to the new
 * pose (parts like a pointing finger or a face switch halfway); a looping pose (walk, wave, talk) swings between its two
 * keys until the next pose. Every tween has its start values, so any frame can be seeked.
 */
function mascotTweens(el: SceneElement, id: MascotId, P: string, o: { start: number; end: number; tweens: SceneTween[] }) {
  const len = o.end - o.start;
  const out: string[] = [];
  const at = (t: number) => n(o.start + t);
  const change = (a: MascotKey, b: MascotKey, t: number, duration: number, ease: string, vars: Record<string, unknown> = {}) => {
    const ta = jointTransforms(id, a);
    const tb = jointTransforms(id, b);
    for (const j of Object.keys(tb)) {
      if (ta[j] !== tb[j]) out.push(`tl.fromTo(${js(`.${P}-${j}`)}, ${js({ attr: { transform: ta[j] } })}, ${js({ attr: { transform: tb[j] }, duration, ease, ...vars })}, ${at(t)});`);
    }
    if (shadowWidth(id, a) !== shadowWidth(id, b)) out.push(`tl.fromTo(${js(`.${P}-sh`)}, ${js({ attr: { rx: shadowWidth(id, a) } })}, ${js({ attr: { rx: shadowWidth(id, b) }, duration, ease, ...vars })}, ${at(t)});`);
    const sa = switches(id, a);
    const sb = switches(id, b);
    for (const k of Object.keys(sb)) if (sa[k] !== sb[k]) out.push(`tl.set(${js(`.${P}-${k}`)}, ${js({ attr: { opacity: sb[k] ? 1 : 0 } })}, ${at(t + duration / 2)});`);
  };
  /** Swings a looping pose from `from` to `until`; returns the key it ends on. */
  const loop = (pose: ReturnType<typeof mascotPose>, from: number, until: number, start: MascotKey): MascotKey => {
    const [a, b] = poseKeys(id, pose);
    const half = LOOP_HALF[pose];
    if (!b || !half) return start;
    const swings = Math.floor((until - from) / half);
    if (swings >= 1) change(a, b, from, half, 'sine.inOut', { repeat: swings - 1, yoyo: true });
    // A talking face opens and shuts its mouth while it's held, and ends shut.
    if ((id === 'host' || id === 'blok') && a.mood === 'talk') {
      for (let t = from, open = true; t < until - 0.01; t += MOUTH_HALF, open = !open) {
        out.push(`tl.set(${js(`.${P}-mo`)}, ${js({ attr: { opacity: open ? 1 : 0 } })}, ${at(t)});`, `tl.set(${js(`.${P}-ms`)}, ${js({ attr: { opacity: open ? 0 : 1 } })}, ${at(t)});`);
      }
      out.push(`tl.set(${js(`.${P}-mo`)}, ${js({ attr: { opacity: 0 } })}, ${at(until)});`, `tl.set(${js(`.${P}-ms`)}, ${js({ attr: { opacity: 1 } })}, ${at(until)});`);
    }
    return swings % 2 ? b : a;
  };

  const events = o.tweens.filter((t) => t.pose && t.targets.split(',').includes(el.id)).sort((a, b) => a.at - b.at);
  const first = mascotPose(id, el.pose ?? 'idle');
  let key = loop(first, 0, events[0]?.at ?? len, poseKeys(id, first)[0]);
  events.forEach((t, k) => {
    const pose = mascotPose(id, t.pose!);
    const target = poseKeys(id, pose)[0];
    const duration = Math.max(0.05, t.duration);
    change(key, target, t.at, duration, t.ease ?? 'power2.inOut');
    key = loop(pose, t.at + duration, events[k + 1]?.at ?? len, target);
  });
  return out;
}

/** A line's dash offset is tweened as its attribute: as CSS, GSAP rounds it to whole pixels and a 1 → 0 draw snaps on halfway. */
function asAttrs(vars: Record<string, string | number>): Record<string, unknown> {
  if (!('strokeDashoffset' in vars)) return vars;
  const { strokeDashoffset, ...rest } = vars;
  return { ...rest, attr: { 'stroke-dashoffset': strokeDashoffset } };
}

/** A path tween names another element of the scene as "#id": point it at that element on the page. */
function withIds(vars: SceneTween['to'], i: number) {
  const out = { ...vars };
  for (const key of ['motionPath', 'morphSVG'] as const) {
    const v = out[key];
    if (typeof v === 'string' && v.startsWith('#')) out[key] = `#${domId(i, v.slice(1))}`;
  }
  return out;
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
.sc .sp path { stroke: ${ctx.color}; stroke-width: 8; fill: none; stroke-linecap: round; stroke-linejoin: round; }
.sc .sm svg { display: block; width: 100%; height: 100%; overflow: visible; }`;
}
