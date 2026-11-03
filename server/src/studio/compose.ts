import {
  DUCK_LEVEL,
  EDIT_FORMATS,
  captionPages,
  clipLength,
  clipStarts,
  editDuration,
  clipGeometry,
  fillGeometry,
  speechSpans,
  timelineWords,
  transitionWindows,
  type BrollOverlay,
  type EditSpec,
} from '../../../shared/edit';
import { ARABIC_FONT, BUNDLED_FONTS, type FontSubset } from '../../../shared/fonts';
import { isScenePreset, SCENE_LIBRARY } from '../../../shared/scene-library';
import { captionCss, captionHtml, CAPTION_STYLE, captionTweens } from './captions';
import { animateIn, filterCss, lookStyle, motionState, motionStyle, motionTweens, splitChars, textureLayers } from './motion';
import { LEAK_LAYER, OUTGOING_ON_TOP, transitionTweens, WHITE_LAYER } from './transitions';
import { builtinSfx } from '../../../shared/sfx';
import { allSounds } from '../../../shared/sound-design';
import { composeGraphic, graphicsCss, STAT_HELPER } from './graphics';
import { composeRecipe } from './recipe-layers';
import { composeScene, sceneCss } from './scene';
import type { MascotId } from '../../../shared/mascots';
import { accent, attrJson, esc, js, n, px } from './html';
import type { AssetType, MediaKind, Transcript } from '../../../shared/types';

/**
 * Compiles an edit into a HyperFrames composition: one HTML page whose timed elements (data-start / data-duration)
 * and paused GSAP timeline describe every frame. The live preview and the render use the same page; only where the
 * pictures come from differs (preview copies vs. full-quality segments cut for the render).
 */

export type ComposeMedia = { id: string; kind: MediaKind; assetType: AssetType | null; width: number | null; height: number | null; durationMs: number | null };
/**
 * Where a moving picture comes from, and the moment in that file the clip starts. `duration` is how long the file is
 * when that isn't the media's own length (a segment cut for the render); `silent` when the file has no sound at all
 * (a screen recording). Null while it's being prepared.
 */
/** `framed`: the file is already the whole frame (a `whole` clip the render laid out over its blurred copy). */
export type ComposeSource = { src: string; mediaStart: number; duration?: number; silent?: boolean; framed?: boolean } | null;

export type ComposeInput = {
  spec: EditSpec;
  media: Map<string, ComposeMedia>;
  transcripts: Record<string, Transcript | null>;
  clipSource: (index: number) => ComposeSource;
  brollSource: (overlayIndex: number) => ComposeSource;
  /** Original files: fonts, logos, the nasheed, sound effects (including the built-in ones, `builtin:<name>`). */
  fileUrl: (mediaId: string) => string;
  /** One of the bundled caption fonts. */
  fontUrl: (file: string) => string;
  scripts: string[];
  preview: boolean;
  /** The page's own mascot, for scene mascots that don't name one. */
  mascot?: MascotId | null;
  /**
   * The Android app's WebView shows the preview from another origin: media is requested with CORS (so the runtime can
   * route audio through Web Audio), and videos get a blank poster instead of the WebView's grey play button.
   */
  forApp?: boolean;
};

/** Caption and title fonts that ship with the app (shared/fonts.ts). */
export { BUNDLED_FONTS };
const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
const ARABIC = 'U+0600-06FF,U+0750-077F,U+0870-088E,U+0890-0891,U+0897-08E1,U+08E3-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FE74,U+FE76-FEFC';
const RANGES: Record<FontSubset, string> = { latin: LATIN, 'latin-ext': LATIN_EXT, arabic: ARABIC };

const VOICE_FX = {
  version: 1,
  nodes: [
    { type: 'highpass', id: 'v1', label: 'Remove rumble', params: { frequency: 85, q: 0.707, poles: '2' } },
    { type: 'compressor', id: 'v2', label: 'Even out', params: { threshold: -22, ratio: 3, attack: 8, release: 180, knee: 2.83, makeup: 4, mix: 1 } },
    { type: 'peaking', id: 'v3', label: 'Presence', params: { frequency: 3500, gain: 2.5, q: 0.9 } },
  ],
};
const MASTER_FX = { version: 1, nodes: [{ type: 'truepeak', id: 'm1', label: 'Delivery ceiling', params: { ceiling: -1, lookahead: 3, release: 80 } }] };


const GRAPHICS_CSS_MARK = '/* graphics */';
const SCENE_CSS_MARK = '/* scenes */';

export function composeEdit(input: ComposeInput) {
  const { spec, media } = input;
  const { width: W, height: H } = EDIT_FORMATS[spec.format];
  const duration = Math.max(editDuration(spec), input.preview ? 1 : 0.1);
  const BLANK_GIF = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const app = input.forApp ? { media: ' crossorigin="anonymous"', video: ` crossorigin="anonymous" poster="${BLANK_GIF}"` } : { media: '', video: '' };
  const starts = clipStarts(spec);
  const body: string[] = [];
  const css: string[] = [];
  const tl: string[] = [];
  const sizeOf = (id: string) => {
    const m = media.get(id);
    return { w: m?.width || W, h: m?.height || H };
  };

  // ---------- main track ----------
  let anyClipAudio = false;
  spec.clips.forEach((clip, i) => {
    const m = media.get(clip.mediaId);
    const start = starts[i];
    const len = clipLength(clip);
    const timing = `data-start="${n(start)}" data-duration="${n(len)}" data-track-index="0"`;
    const source = m ? input.clipSource(i) : null;
    if (!m || !source) {
      body.push(`<div id="c${i}" class="clip ph" ${timing}><span>${m ? 'Preparing this clip…' : 'Missing file'}</span></div>`);
      return;
    }
    const { w, h } = sizeOf(clip.mediaId);
    const g = source.framed ? { left: 0, top: 0, width: W, height: H } : clipGeometry(clip, w, h, W, H);
    const box = `left:${px(g.left)};top:${px(g.top)};width:${px(g.width)};height:${px(g.height)}`;
    // Camera moves turn about the middle of the frame.
    const origin = `transform-origin:${px(-g.left + W / 2)} ${px(-g.top + H / 2)}${lookStyle(clip.filter ?? spec.grade.filter)}`;
    if (clip.motion !== 'none') tl.push(...motionTweens(`#c${i}`, clip.motion, start, len, W, H));
    if (m.kind === 'image') {
      body.push(`<img id="c${i}" class="clip pic" src="${esc(source.src)}" alt="" ${timing} style="${box};${clip.motion === 'none' ? `transform-origin:${n(clip.focusX * 100)}% ${n(clip.focusY * 100)}%${lookStyle(clip.filter ?? spec.grade.filter)}` : origin}">`);
      // A slow push-in keeps photos alive.
      if (clip.motion === 'none') tl.push(`tl.fromTo('#c${i}', { scale: 1 }, { scale: 1.07, duration: ${n(len)}, ease: 'none' }, ${n(start)});`);
      return;
    }
    const audible = clip.volume > 0 && spec.audio.voiceVolume > 0 && !source.silent;
    anyClipAudio ||= audible;
    const sound = audible ? `data-has-audio="true" data-volume="${n(clip.volume)}" data-audio-group="voice"` : 'muted';
    // A whole picture over a blurred, darkened copy of itself (the render bakes that into the file instead).
    if (clip.fit === 'whole' && !source.framed) {
      const f = fillGeometry(w, h, W, H, 0.5, 0.5, 1.1);
      body.push(`<video id="cb${i}" class="pic" src="${esc(source.src)}"${app.video} ${timing} data-media-start="${n(source.mediaStart)}" muted playsinline preload="auto" style="left:${px(f.left)};top:${px(f.top)};width:${px(f.width)};height:${px(f.height)};filter:blur(32px) brightness(.45)"></video>`);
    }
    body.push(`<video id="c${i}" class="pic" src="${esc(source.src)}"${app.video} ${timing} data-media-start="${n(source.mediaStart)}" ${sound} playsinline preload="auto" style="${box};${origin}"></video>`);
  });
  if (!spec.clips.length && input.preview) {
    body.push(`<div id="c0" class="clip ph" data-start="0" data-duration="${n(duration)}" data-track-index="0"><span>Add footage to start editing</span></div>`);
  }

  // ---------- transitions ----------
  // Over the cut, a muted copy of each shot runs on past it (the outgoing one past its out point, the incoming one
  // from before its in point) on a black backing; the transition animates those copies. The clips' own sound still cuts
  // at the cut, so nothing else moves.
  for (const w of transitionWindows(spec)) {
    const pics: string[] = [];
    // A photo's slow push-in: where it is at that moment (the outgoing one has finished it).
    const scales = { a: 1, b: 1 };
    // Where the frame sits inside each copy, for transitions that cut shapes out of it.
    const frames = { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } };
    for (const [side, i] of [['a', w.index - 1], ['b', w.index]] as const) {
      const clip = spec.clips[i];
      const m = media.get(clip.mediaId);
      const source = m ? input.clipSource(i) : null;
      if (!m || !source) break;
      const { w: sw, h: sh } = sizeOf(clip.mediaId);
      const g = source.framed ? { left: 0, top: 0, width: W, height: H } : clipGeometry(clip, sw, sh, W, H);
      frames[side] = { x: -g.left, y: -g.top };
      // Only the frame's part of the picture shows, so pushes and slides don't reveal what the crop leaves out.
      const inset = [-g.top, g.width + g.left - W, g.height + g.top - H, -g.left].map(px).join(' ');
      const z = side === 'a' ? (OUTGOING_ON_TOP.includes(w.type) ? 8 : 6) : 7;
      // Held where the clip's camera move has it at the cut (its end for the outgoing shot, its start for the next).
      const held = motionStyle(motionState(clip.motion, side === 'a' ? 1 : 0, W, H)) + lookStyle(clip.filter ?? spec.grade.filter);
      const style = `left:${px(g.left)};top:${px(g.top)};width:${px(g.width)};height:${px(g.height)};clip-path:inset(${inset});transform-origin:${px(-g.left + W / 2)} ${px(-g.top + H / 2)};z-index:${z}${held}`;
      const timing = `data-start="${n(w.start)}" data-duration="${n(w.end - w.start)}" data-track-index="5"`;
      const id = `t${side}${w.index}`;
      if (m.kind === 'image') {
        if (side === 'a' && clip.motion === 'none') scales.a = 1.07;
        pics.push(`<img id="${id}" class="clip pic" src="${esc(source.src)}" alt="" ${timing} style="${style};transform:scale(${scales[side]})">`);
        continue;
      }
      const len = clipLength(clip);
      const fileLen = source.duration ?? (m.durationMs ? source.mediaStart - clip.in + m.durationMs / 1000 : Infinity);
      // The picture either side of the cut, pulled back inside the file when it ends (or starts) right at the cut.
      const want = side === 'a' ? source.mediaStart + len - (w.at - w.start) : source.mediaStart - (w.at - w.start);
      const from = Math.max(0, Math.min(want, fileLen - (w.end - w.start) - 0.02));
      pics.push(`<video id="${id}" class="pic" src="${esc(source.src)}"${app.video} ${timing} data-media-start="${n(from)}" muted playsinline preload="auto" style="${style}"></video>`);
    }
    if (pics.length < 2) continue;
    body.push(`<div id="tk${w.index}" class="clip layer" data-start="${n(w.start)}" data-duration="${n(w.end - w.start)}" data-track-index="5" style="background:#000;z-index:5"></div>`, ...pics);
    const layer = `class="clip layer" data-start="${n(w.start)}" data-duration="${n(w.end - w.start)}" data-track-index="5"`;
    if (WHITE_LAYER.includes(w.type)) body.push(`<div id="tw${w.index}" ${layer} style="background:#fff;opacity:0;z-index:9"></div>`);
    if (LEAK_LAYER.includes(w.type))
      body.push(
        `<div id="tl${w.index}" ${layer} style="z-index:9;overflow:hidden;mix-blend-mode:screen"><div id="tx${w.index}" style="position:absolute;left:${px(-W * 1.4)};top:${px(-H * 0.15)};width:${px(W * 1.4)};height:${px(H * 1.3)};opacity:0;background:radial-gradient(ellipse 45% 35% at 40% 40%, rgba(255,170,70,.95), transparent 70%),radial-gradient(ellipse 35% 30% at 65% 65%, rgba(255,80,120,.75), transparent 70%),radial-gradient(ellipse 30% 45% at 55% 20%, rgba(255,235,150,.8), transparent 70%)"></div></div>`,
      );
    const lookOf = (i: number) => {
      const css = filterCss(spec.clips[i].filter ?? spec.grade.filter);
      return css === 'none' ? '' : css;
    };
    tl.push(...transitionTweens(w, W, H, scales, frames.a, frames.b, { a: lookOf(w.index - 1), b: lookOf(w.index) }));
  }

  // ---------- film textures ----------
  // (Colour looks are a filter on each picture: clips, the transitions' copies and b-roll.)
  const textures = textureLayers(spec.grade.textures, duration, W, H, spec.captions.highlight);
  body.push(...textures.html);
  tl.push(...textures.tweens);

  // ---------- overlays ----------
  // Arabic letters in any font (a name of Allah in a caption, a title) are drawn in Naskh.
  const fontStack = (family: string) => `${spec.captions.fontMediaId ? `'Brand', ` : ''}'${family}', '${ARABIC_FONT.family}', sans-serif`;
  const graphicCtx = { W, H, color: spec.captions.highlight, font: fontStack };
  const helpers = new Set<string>();
  spec.overlays.forEach((o, i) => {
    const start = Math.min(o.start, duration);
    const len = Math.max(0.1, Math.min(o.end, duration) - start);
    if (o.end <= 0 || o.start >= duration) return;
    const timing = `data-start="${n(start)}" data-duration="${n(len)}" data-track-index="${o.type === 'broll' ? 1 : 2}"`;
    if (o.type === 'graphic') {
      const g = composeGraphic({ ...o, start, end: start + len }, i, graphicCtx);
      // Full-screen ones (a section card, a word slam) cover the captions; the rest sit under them.
      const z = o.template === 'chapter' || o.template === 'kinetic' ? 45 : 30;
      body.push(`<div id="o${i}" class="clip layer g g-${o.template}" ${timing} style="z-index:${z}">${g.html}</div>`);
      tl.push(...g.tweens);
      if (o.template === 'stat') helpers.add(STAT_HELPER);
      if (!css.includes(GRAPHICS_CSS_MARK)) css.push(GRAPHICS_CSS_MARK, graphicsCss(graphicCtx));
      return;
    }
    if (o.type === 'scene') {
      const sceneCtx = { ...graphicCtx, fileUrl: input.fileUrl, mascot: input.mascot };
      const sc = composeScene({ ...o, start, end: start + len }, i, sceneCtx);
      body.push(`<div id="o${i}" class="clip layer sc" ${timing} style="z-index:35">${sc.html}</div>`);
      tl.push(...sc.tweens);
      sc.helpers.forEach((h) => helpers.add(h));
      if (!css.includes(SCENE_CSS_MARK)) css.push(SCENE_CSS_MARK, sceneCss(sceneCtx));
      return;
    }
    if (o.type === 'broll') {
      const m = media.get(o.mediaId);
      const source = m ? input.brollSource(i) : null;
      if (!m || !source) {
        if (input.preview) body.push(`<div id="o${i}" class="clip ph broll" ${timing}><span>Preparing b-roll…</span></div>`);
        return;
      }
      const box = brollBox(o.layout, W, H);
      const { w, h } = sizeOf(o.mediaId);
      const g = fillGeometry(w, h, box.w, box.h, o.focusX, o.focusY, 1);
      // Clip to the layout's box; the picture itself is sized to fill it.
      const inset = [-g.top, g.width + g.left - box.w, g.height + g.top - box.h, -g.left].map(px).join(' ');
      const round = box.radius ? ` round ${px(box.radius)}` : '';
      // Windows pop in about their own middle; a card sits tilted.
      const origin = `transform-origin:${px(box.w / 2 - g.left)} ${px(box.h / 2 - g.top)}`;
      const style = `left:${px(box.x + g.left)};top:${px(box.y + g.top)};width:${px(g.width)};height:${px(g.height)};clip-path:inset(${inset}${round});z-index:10;${origin}${box.tilt ? `;rotate:${box.tilt}deg` : ''}${lookStyle(spec.grade.filter)}`;
      const frame = brollFrame(o.layout, box, i, timing);
      if (frame) body.push(frame);
      if (m.kind === 'image') {
        body.push(`<img id="o${i}" class="clip pic" src="${esc(source.src)}" alt="" ${timing} style="${style}">`);
        // A full-screen still drifts in slowly, like a photo on the main track (a window's edges would grow with it).
        if (o.layout === 'full') tl.push(`tl.fromTo('#o${i}', { scale: 1 }, { scale: 1.08, duration: ${n(len)}, ease: 'none' }, ${n(start)});`);
      }
      else body.push(`<video id="o${i}" class="pic" src="${esc(source.src)}"${app.video} ${timing} data-media-start="${n(source.mediaStart)}" muted playsinline preload="auto" style="${style}"></video>`);
      const targets = js(frame ? `#o${i}, #of${i} .bf` : `#o${i}`);
      if (['full', 'top', 'bottom', 'split'].includes(o.layout)) tl.push(`tl.fromTo(${targets}, { opacity: 0 }, { opacity: 1, duration: 0.15 }, ${n(start)});`);
      else tl.push(`tl.fromTo(${targets}, { opacity: 0, scale: 0.8 }, { opacity: 1, scale: 1, duration: 0.3, ease: 'back.out(1.8)' }, ${n(start)});`);
      return;
    }
    if (o.type === 'image') {
      const { w, h } = sizeOf(o.mediaId);
      const width = o.width * W;
      body.push(
        `<div id="o${i}" class="clip layer" ${timing} style="z-index:20"><div class="anchor" style="left:${px(o.x * W - width / 2)};top:${px(o.y * H - (width * h) / w / 2)};width:${px(width)}"><img class="oi" src="${esc(input.fileUrl(o.mediaId))}" alt=""></div></div>`,
      );
      tl.push(...animateIn(`#o${i} .oi`, o.animation, start, len));
      return;
    }
    const y = o.y ?? (o.position === 'top' ? 0.15 : o.position === 'center' ? 0.5 : 0.8);
    let text = accent(esc(o.text)).replace(/\n/g, '<br>');
    const chars = o.animation === 'typewriter' ? [...o.text.replace(/[*\s]/g, '')].length : 0;
    if (chars) text = splitChars(text);
    body.push(`<div id="o${i}" class="clip layer t-${o.style}" ${timing}><div class="line" style="top:${px(y * H)}"><div class="oi">${text}</div></div></div>`);
    tl.push(...animateIn(`#o${i} .oi`, o.animation, start, len, chars));
  });

  // ---------- format video (a story's card, a conversation, two characters) ----------
  if (spec.recipe) {
    const r = composeRecipe(spec, { W, H, color: spec.captions.highlight, font: fontStack, duration });
    body.push(...r.html);
    tl.push(...r.tweens);
    r.helpers.forEach((h) => helpers.add(h));
    if (r.css) css.push(r.css);
  }

  // ---------- captions ----------
  const words = timelineWords(spec, input.transcripts);
  if (spec.captions.enabled && words.length) {
    const c = spec.captions;
    // A scene that shows the words itself (an ayah and its meaning) keeps the captions off while it's on.
    // So does a hook card that asks for it: one thing to read at a time.
    const quiet = spec.overlays.filter((o) => (o.type === 'scene' && isScenePreset(o.preset) && SCENE_LIBRARY[o.preset].hidesCaptions) || ((o.type === 'text' || o.type === 'graphic') && o.hidesCaptions));
    const pages = captionPages(words, c, duration).filter((p) => !quiet.some((o) => (p.start + p.end) / 2 >= o.start && (p.start + p.end) / 2 < o.end));
    pages.forEach((p, i) => {
      body.push(`<div id="p${i}" class="clip layer cap" data-start="${n(p.start)}" data-duration="${n(p.end - p.start)}" data-track-index="3"><div class="line"><div class="ci">${captionHtml(c.preset, p, i)}</div></div></div>`);
      tl.push(...captionTweens(c.preset, c, p, i));
    });
    css.push(captionCss(c.preset, c, fontStack(c.font ?? CAPTION_STYLE[c.preset].family), H));
  }

  // ---------- watermark ----------
  const wmId = spec.watermark.mediaId;
  if (wmId && media.has(wmId)) {
    const wm = spec.watermark;
    const margin = W * 0.045;
    const pos = `${wm.corner[0] === 't' ? `top:${px(margin)}` : `bottom:${px(margin)}`};${wm.corner[1] === 'l' ? `left:${px(margin)}` : `right:${px(margin)}`}`;
    body.push(
      `<div id="wm" class="clip layer" data-start="0" data-duration="${n(duration)}" data-track-index="4" style="z-index:50"><img src="${esc(input.fileUrl(wmId))}" alt="" style="position:absolute;${pos};width:${px(wm.size * W)};opacity:${n(wm.opacity)}"></div>`,
    );
  }

  // ---------- sound ----------
  if (anyClipAudio) body.push(`<hf-audio-group id="voice" data-label="Voice" data-volume="${n(spec.audio.voiceVolume)}"${spec.audio.enhanceVoice ? ` data-fx-chain="${attrJson(VOICE_FX)}"` : ''}></hf-audio-group>`);
  // Narration (a format video's voices, or the creator's recorded voice), from the start.
  const vo = spec.audio.voiceover;
  const voMedia = vo ? media.get(vo.mediaId) : undefined;
  if (vo && voMedia?.kind === 'audio' && vo.volume > 0) {
    const len = Math.min(duration, voMedia.durationMs ? voMedia.durationMs / 1000 : duration);
    body.push(`<audio id="vo" src="${esc(input.fileUrl(voMedia.id))}"${app.media} data-start="0" data-duration="${n(len)}" data-track-index="8" data-volume="${n(vo.volume)}"></audio>`);
  }
  // Never music: the one track an edit can have is a vocal-only nasheed, and only a nasheed asset plays.
  const track = spec.audio.nasheed;
  const nasheed = track ? media.get(track.mediaId) : undefined;
  if (track && nasheed?.assetType === 'nasheed') {
    const full = track.volume;
    const spans = track.duck ? speechSpans(words, 0.9) : [];
    const trackLen = nasheed.durationMs ? nasheed.durationMs / 1000 : Infinity;
    // Loop the track by laying copies end to end when it's shorter than the video.
    let at = 0;
    let offset = Math.min(track.start, Number.isFinite(trackLen) ? Math.max(0, trackLen - 1) : track.start);
    for (let k = 0; at < duration - 0.05 && k < 20; k++) {
      const len = Math.min(duration - at, trackLen - offset);
      if (len <= 0.05) break;
      const lane = duckLane(spans, at, len, full, full * DUCK_LEVEL);
      const fades = `${k === 0 ? ' data-fade-in="0.3"' : ''}${at + len >= duration - 0.05 ? ` data-fade-out="${n(Math.min(1.5, len / 2))}"` : ''}`;
      body.push(
        `<audio id="n${k}" src="${esc(input.fileUrl(nasheed.id))}"${app.media} data-start="${n(at)}" data-duration="${n(len)}" data-media-start="${n(offset)}" data-track-index="6" data-volume="${n(full)}"${fades}${lane ? ` data-automation="${attrJson(lane)}"` : ''}></audio>`,
      );
      at += len;
      offset = 0;
    }
  }
  allSounds(spec).forEach((s, i) => {
    const builtin = builtinSfx(s.mediaId);
    const m = media.get(s.mediaId);
    if (s.at >= duration || (!builtin && m?.assetType !== 'sfx')) return;
    const seconds = builtin ? builtin.seconds : m?.durationMs ? m.durationMs / 1000 : Infinity;
    const len = Math.min(duration - s.at, seconds);
    body.push(`<audio id="s${i}" src="${esc(input.fileUrl(s.mediaId))}"${app.media} data-start="${n(s.at)}" data-duration="${n(len)}" data-track-index="7" data-volume="${n(s.volume)}"></audio>`);
  });

  // ---------- page ----------
  const face = (family: string, weight: string, file: string, range: string) =>
    `@font-face { font-family: '${family}'; font-style: normal; font-weight: ${weight}; font-display: block; src: url(${input.fontUrl(file)}) format('woff2'); unicode-range: ${range}; }`;
  const fontFaces = BUNDLED_FONTS.flatMap((f) => f.files.map((file, i) => face(f.family, f.weight, file, RANGES[f.subsets?.[i] ?? (i === 0 ? 'latin' : 'latin-ext')])));
  if (spec.captions.fontMediaId) fontFaces.push(`@font-face { font-family: 'Brand'; font-display: block; src: url(${input.fileUrl(spec.captions.fontMediaId)}); }`);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=${W}, height=${H}">
${input.scripts.map((s) => `<script src="${esc(s)}"></script>`).join('\n')}
<style>
${fontFaces.join('\n')}
html, body { margin: 0; background: #000; }
#root { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; background: #000; }
.pic { position: absolute; object-fit: cover; display: block; }
.ph { position: absolute; inset: 0; display: grid; place-items: center; background: #111; color: #888; font: 500 40px 'Inter', sans-serif; }
.ph.broll { background: #1a1a1a; }
/* Timed elements are full-frame layers (HyperFrames gives zero-height ones the full height); what they show is
   positioned inside them. A .line is a zero-height row that centres its text on its own top edge. */
.layer { position: absolute; inset: 0; pointer-events: none; }
.anchor { position: absolute; }
.anchor .oi { width: 100%; display: block; }
.line { position: absolute; left: 0; right: 0; height: 0; display: flex; align-items: center; justify-content: center; text-align: center; }
.line .oi, .line .ci { box-sizing: border-box; }
.t-title { z-index: 30; }
.t-title .oi { font-family: ${fontStack('Montserrat')}; font-weight: 900; font-size: 92px; line-height: 1.05; color: #fff; max-width: 86%; -webkit-text-stroke: 0.14em #000; paint-order: stroke fill; text-shadow: 0 0.05em 0.16em rgba(0,0,0,.5); }
.t-label { z-index: 30; }
.t-label .oi { font-family: ${fontStack('Montserrat')}; font-weight: 800; font-size: 54px; line-height: 1.15; color: #111; background: ${spec.captions.highlight}; padding: .28em .6em; border-radius: .45em; max-width: 84%; }
.t-note { z-index: 30; }
.t-title .oi:has(.acc) { font-weight: 640; }
.t-title .acc { font-weight: 900; }
.t-note .acc { font-weight: 800; }
.t-label .acc { color: #fff; }
.t-note .oi { font-family: ${fontStack('Inter')}; font-weight: 600; font-size: 44px; line-height: 1.3; color: #fff; max-width: 84%; text-shadow: 0 2px 6px rgba(0,0,0,.85); }
hf-audio-group { display: none !important; }
${css.join('\n')}
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${n(duration)}" data-width="${W}" data-height="${H}" data-fx-chain="${attrJson(MASTER_FX)}">
${body.join('\n')}
</div>
<script>
window.__timelines = window.__timelines || {};
// GSAP's plugins (all loaded from the app's own copy): eases, typing, paths, shapes, physics.
gsap.registerPlugin(...[window.CustomEase, window.CustomWiggle, window.CustomBounce, window.TextPlugin, window.MotionPathPlugin, window.MorphSVGPlugin, window.DrawSVGPlugin, window.Physics2DPlugin].filter(Boolean));
const tl = gsap.timeline({ paused: true });
${[...helpers].join('\n')}
${tl.join('\n')}
tl.set({}, {}, ${n(duration)});
window.__timelines.main = tl;
</script>${
    input.forApp
      ? `
<script>
// The WebView keeps the (blank) poster up until a video has played or seeked, and the runtime doesn't seek one that's
// already at the right time: seek it once so its first frame shows.
document.querySelectorAll('video').forEach((v) => v.addEventListener('loadeddata', () => { if (v.paused) v.currentTime = v.currentTime; }, { once: true }));
</script>`
      : ''
  }
</body>
</html>
`;
  return { html, duration };
}

/** Where a b-roll layout puts the picture, its corner rounding and tilt. */
function brollBox(layout: BrollOverlay['layout'], W: number, H: number) {
  switch (layout) {
    case 'full':
      return { x: 0, y: 0, w: W, h: H, radius: 0, tilt: 0 };
    case 'top':
      return { x: 0, y: 0, w: W, h: H / 2, radius: 0, tilt: 0 };
    case 'bottom':
      return { x: 0, y: H / 2, w: W, h: H / 2, radius: 0, tilt: 0 };
    case 'split':
      return { x: 0, y: 0, w: W / 2, h: H, radius: 0, tilt: 0 };
    case 'pip':
      return { x: W * 0.52, y: H * 0.07, w: W * 0.42, h: W * 0.42 * 1.25, radius: 28, tilt: 0 };
    case 'circle': {
      const size = W * 0.38;
      return { x: W * 0.56, y: H * 0.07, w: size, h: size, radius: size / 2, tilt: 0 };
    }
    case 'phone': {
      const w = W * 0.56;
      const h = Math.min(H * 0.72, w * 2.05);
      return { x: (W - w) / 2, y: (H - h) / 2, w, h, radius: w * 0.09, tilt: 0 };
    }
    case 'card': {
      const w = W * 0.72;
      const h = Math.min(H * 0.55, w * 1.15);
      return { x: (W - w) / 2, y: H * 0.42 - h / 2, w, h, radius: 6, tilt: -4 };
    }
  }
}

/** The phone's body or the card's white border, behind (card) or over (phone) the picture. */
function brollFrame(layout: BrollOverlay['layout'], box: ReturnType<typeof brollBox>, i: number, timing: string) {
  if (layout === 'phone') {
    const bezel = box.w * 0.035;
    return `<div id="of${i}" class="clip layer" ${timing} style="z-index:11"><div class="bf" style="position:absolute;left:${px(box.x - bezel)};top:${px(box.y - bezel)};width:${px(box.w + bezel * 2)};height:${px(box.h + bezel * 2)};border:${px(bezel)} solid #0b0b0d;border-radius:${px(box.radius + bezel)};box-sizing:border-box;box-shadow:0 30px 80px rgba(0,0,0,.55), inset 0 0 0 2px #2a2a2e;transform-origin:50% 50%"><div style="position:absolute;left:50%;top:${px(bezel * 0.6)};width:${px(box.w * 0.3)};height:${px(bezel * 1.1)};margin-left:${px(-box.w * 0.15)};background:#0b0b0d;border-radius:${px(bezel)}"></div></div></div>`;
  }
  if (layout === 'card') {
    const pad = box.w * 0.04;
    return `<div id="of${i}" class="clip layer" ${timing} style="z-index:9"><div class="bf" style="position:absolute;left:${px(box.x - pad)};top:${px(box.y - pad)};width:${px(box.w + pad * 2)};height:${px(box.h + pad * 3.2)};background:#fafaf7;border-radius:8px;box-shadow:0 24px 60px rgba(0,0,0,.5);transform-origin:${px(box.w / 2 + pad)} ${px(box.h / 2 + pad)};rotate:${box.tilt}deg"></div></div>`;
  }
  return null;
}

/** Nasheed volume lane (clip-relative time) that dips under speech. */
function duckLane(spans: [number, number][], clipStart: number, clipLen: number, full: number, low: number) {
  const points: { t: number; v: number }[] = [{ t: 0, v: full }];
  for (const [s, e] of spans) {
    const a = s - clipStart;
    const b = e - clipStart;
    if (b < 0 || a > clipLen) continue;
    const down = Math.max(points[points.length - 1].t + 0.01, a - 0.2);
    points.push({ t: down, v: full }, { t: Math.max(down + 0.01, a), v: low }, { t: Math.max(down + 0.02, b), v: low }, { t: Math.max(down + 0.03, b + 0.35), v: full });
  }
  if (points.length === 1) return null;
  // The lane format allows 512 points; a three-minute video stays well under.
  return { version: 1, lanes: [{ target: 'volume', points: points.slice(0, 512).map((p) => ({ t: Math.round(p.t * 1000) / 1000, v: Math.round(p.v * 1000) / 1000 })) }] };
}
