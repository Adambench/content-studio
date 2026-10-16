// What a format video draws on top of its background (shared/recipe.ts): a story's post card, a text conversation, or
// two talking characters. Timings come from the last build, so before the voice is made nothing is timed and only the
// first state shows. Seek-safe like the rest of the composition: explicit start states, no randomness.
import type { EditSpec } from '../../../shared/edit';
import type { ChatRecipe, DialogueRecipe, Recipe, StoryRecipe } from '../../../shared/recipe';
import { characterSvg } from './characters';
import { accent, esc, js, n, px } from './html';

export type RecipeContext = { W: number; H: number; color: string; font: (family: string) => string; duration: number };
export type ComposedRecipe = { html: string[]; tweens: string[]; css: string; helpers: string[] };

const initial = (name: string) => esc((name.trim()[0] ?? '?').toUpperCase());

const ICONS = {
  heart: '<svg viewBox="0 0 24 24" width="40" height="40"><path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.3 3 4.5 6.7 4.5c2.1 0 3.6 1.2 4.4 2.5.8-1.3 2.3-2.5 4.4-2.5 3.7 0 5.8 3.8 4.3 7.2C19.5 16.4 12 21 12 21z" fill="#f43f5e"/></svg>',
  comment: '<svg viewBox="0 0 24 24" width="40" height="40"><path d="M4 5h16v11H9l-5 4z" fill="none" stroke="#6b7280" stroke-width="2.2" stroke-linejoin="round"/></svg>',
  share: '<svg viewBox="0 0 24 24" width="40" height="40"><path d="M14 5l7 7-7 7v-4c-5 0-8 1.5-10 5 .5-6 3.5-10 10-11z" fill="none" stroke="#6b7280" stroke-width="2.2" stroke-linejoin="round"/></svg>',
};

function story(r: StoryRecipe, ctx: RecipeContext): ComposedRecipe {
  const { H, font, color } = ctx;
  if (r.titleEnd <= 0.3 || !r.title) return { html: [], tweens: [], css: '', helpers: [] };
  const end = Math.min(r.titleEnd, ctx.duration);
  const html = `<div id="rs" class="clip layer" data-start="0" data-duration="${n(end)}" data-track-index="2" style="z-index:30">
<div class="pc" style="top:${px(H * 0.42)}">
<div class="pc-head"><div class="pc-av">${initial(r.author || 'S')}</div><div><div class="pc-name">${esc(r.author || 'Storytime')}</div><div class="pc-meta">just now</div></div></div>
<div class="pc-title">${accent(esc(r.title))}</div>
<div class="pc-foot"><span>${ICONS.heart} 99+</span><span>${ICONS.comment} 214</span><span>${ICONS.share} Share</span></div>
</div></div>`;
  const tweens = [`tl.fromTo('#rs .pc', { scale: 0.8, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.35, ease: 'back.out(1.6)' }, 0);`];
  if (end > 1) tweens.push(`tl.to('#rs .pc', { scale: 0.92, opacity: 0, duration: 0.22, ease: 'power2.in' }, ${n(end - 0.24)});`);
  const css = `
.pc { position: absolute; left: 7%; right: 7%; transform: translateY(-50%); background: #fff; border-radius: 36px; padding: 40px 44px 34px; box-shadow: 0 24px 70px rgba(0,0,0,.45); }
.pc-head { display: flex; align-items: center; gap: 22px; margin-bottom: 26px; }
.pc-av { width: 84px; height: 84px; border-radius: 50%; background: ${color}; color: #111; display: grid; place-items: center; font: 800 42px/1 ${font('Montserrat')}; }
.pc-name { font: 700 36px/1.2 ${font('Inter')}; color: #111; }
.pc-meta { font: 500 28px/1.2 ${font('Inter')}; color: #6b7280; margin-top: 4px; }
.pc-title { font: 800 54px/1.22 ${font('Inter')}; color: #111; }
.pc .acc { color: #2563eb; }
.pc-foot { display: flex; gap: 46px; margin-top: 30px; font: 600 32px/1 ${font('Inter')}; color: #6b7280; }
.pc-foot span { display: flex; align-items: center; gap: 12px; }`;
  return { html: [html], tweens, css, helpers: [] };
}

function chat(r: ChatRecipe, ctx: RecipeContext): ComposedRecipe {
  const { font } = ctx;
  const items = r.messages
    .map((m, k) => `<div class="cm cm-${m.from}" id="cm${k}"><div class="cm-clip"><div class="cb">${esc(m.text)}</div></div></div>`)
    .join('');
  const html = `<div id="rc" class="clip layer" data-start="0" data-duration="${n(ctx.duration)}" data-track-index="2" style="z-index:20">
<div class="cp"><div class="cp-head"><span class="cp-back">‹</span><div class="cp-av">${initial(r.contact)}</div><div class="cp-name">${esc(r.contact)}</div></div>
<div class="cp-area"><div class="cp-list">${items}</div></div></div></div>`;
  // Each message grows in at the bottom when its voice starts, pushing the earlier ones up (layout does the rest).
  const tweens = r.messages.flatMap((m, k) => {
    const at = n(Math.min(m.at, Math.max(0, ctx.duration - 0.2)));
    return [
      `tl.fromTo('#cm${k}', { gridTemplateRows: '0fr' }, { gridTemplateRows: '1fr', duration: 0.18, ease: 'power2.out' }, ${at});`,
      `tl.fromTo('#cm${k} .cb', { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.22, ease: 'back.out(2)' }, ${at});`,
    ];
  });
  const css = `
.cp { position: absolute; left: 4%; right: 4%; top: 6%; height: 56%; background: #fff; border-radius: 44px; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 24px 70px rgba(0,0,0,.45); }
.cp-head { flex: none; height: 168px; position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; background: #f6f6f8; border-bottom: 2px solid #e5e5ea; }
.cp-back { position: absolute; left: 34px; top: 44px; font: 400 76px/1 ${font('Inter')}; color: #0a84ff; }
.cp-av { width: 80px; height: 80px; border-radius: 50%; background: linear-gradient(#a1a1aa, #71717a); color: #fff; display: grid; place-items: center; font: 700 40px/1 ${font('Inter')}; }
.cp-name { font: 600 32px/1.1 ${font('Inter')}; color: #111; }
.cp-area { flex: 1; position: relative; overflow: hidden; }
.cp-list { position: absolute; left: 0; right: 0; bottom: 0; padding: 0 28px 28px; display: flex; flex-direction: column; }
.cm { display: grid; grid-template-rows: 0fr; }
.cm-clip { overflow: hidden; min-height: 0; display: flex; }
.cm-them .cm-clip { justify-content: flex-start; }
.cm-me .cm-clip { justify-content: flex-end; }
.cb { max-width: 74%; margin-top: 14px; font: 500 44px/1.28 ${font('Inter')}; padding: 20px 30px; border-radius: 40px; box-sizing: border-box; }
.cm-them .cb { background: #e9e9eb; color: #111; border-bottom-left-radius: 12px; transform-origin: 0% 100%; }
.cm-me .cb { background: #0a84ff; color: #fff; border-bottom-right-radius: 12px; transform-origin: 100% 100%; }`;
  return { html: [html], tweens, css, helpers: [] };
}

const MOUTH_HELPER = `function __mouth(sel, frames) { for (const f of frames) { tl.set(sel + ' .mouth > *', { opacity: 0 }, f[0]); tl.set(sel + ' .m' + f[1], { opacity: 1 }, f[0]); } }`;

function dialogue(r: DialogueRecipe, ctx: RecipeContext): ComposedRecipe {
  const { H, font, duration } = ctx;
  const html = `<div id="rd" class="clip layer" data-start="0" data-duration="${n(duration)}" data-track-index="2" style="z-index:25">
${r.cast
  .map(
    (c, k) =>
      `<div class="dc" id="ch${k}" style="${k ? 'right' : 'left'}:1%"><div class="dc-in"><div class="dc-name">${esc(c.name)}</div>${characterSvg(c.look)}</div></div>`,
  )
  .join('\n')}
</div>`;
  const tweens: string[] = [];
  for (const k of [0, 1]) {
    // Breathing, and a blink every few seconds (the two never in step).
    const sway = 1.1 + k * 0.23;
    tweens.push(`tl.fromTo('#ch${k} .chr', { y: 0 }, { y: -8, duration: ${n(sway)}, ease: 'sine.inOut', yoyo: true, repeat: ${Math.max(0, Math.floor(duration / sway) - 1)} }, 0);`);
    for (let t = 1.4 + k * 1.1; t < duration - 0.2; t += 3.3 + (k ? 0.5 : 0)) {
      tweens.push(`tl.fromTo('#ch${k} .eyes', { scaleY: 1 }, { scaleY: 0.1, duration: 0.06, yoyo: true, repeat: 1, ease: 'power1.inOut' }, ${n(t)});`);
    }
    tweens.push(`tl.fromTo('#ch${k} .dc-in', { scale: 1, opacity: 1 }, { scale: 1, opacity: 1, duration: 0.01 }, 0);`);
  }
  // Whoever is talking leans in; the other steps back a little.
  for (const line of r.lines) {
    if (line.end <= line.at) continue;
    const other = line.who ? 0 : 1;
    tweens.push(
      `tl.to('#ch${line.who} .dc-in', { scale: 1.05, opacity: 1, duration: 0.15, ease: 'power2.out' }, ${n(line.at)});`,
      `tl.to('#ch${other} .dc-in', { scale: 0.95, opacity: 0.82, duration: 0.15, ease: 'power2.out' }, ${n(line.at)});`,
    );
  }
  // The speaker's mouth follows the voice (15 levels a second, only changes written); the other's stays shut.
  const frames: [number, number][][] = [[], []];
  const last = [0, 0];
  for (const line of r.lines) {
    for (let f = Math.floor(line.at * 15); f < Math.ceil(line.end * 15) && f < r.mouth.length; f++) {
      const level = Number(r.mouth[f]) || 0;
      if (level !== last[line.who]) {
        frames[line.who].push([Math.round((f / 15) * 1000) / 1000, level]);
        last[line.who] = level;
      }
    }
    if (last[line.who] !== 0) {
      frames[line.who].push([Math.round(line.end * 1000) / 1000, 0]);
      last[line.who] = 0;
    }
  }
  frames.forEach((list, k) => list.length && tweens.push(`__mouth('#ch${k}', ${js(list)});`));
  const css = `
.dc { position: absolute; bottom: -1%; width: 48%; height: ${px(H * 0.4)}; }
.dc-in { position: relative; width: 100%; height: 100%; transform-origin: 50% 100%; }
.chr { display: block; width: 100%; height: 100%; }
.chr .eyes { transform-box: fill-box; transform-origin: center; }
.dc-name { position: absolute; top: -8px; left: 50%; transform: translateX(-50%); z-index: 2; white-space: nowrap; font: 700 36px/1 ${font('Inter')}; color: #fff; background: rgba(0,0,0,.6); padding: 12px 24px; border-radius: 999px; }`;
  return { html: [html], tweens, css, helpers: [MOUTH_HELPER] };
}

export function composeRecipe(spec: EditSpec, ctx: RecipeContext): ComposedRecipe {
  const r: Recipe | null = spec.recipe;
  if (!r) return { html: [], tweens: [], css: '', helpers: [] };
  if (r.kind === 'story') return story(r, ctx);
  if (r.kind === 'chat') return chat(r, ctx);
  return dialogue(r, ctx);
}
