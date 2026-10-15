import {
  DUCK_LEVEL,
  EDIT_FORMATS,
  captionPages,
  clipLength,
  clipStarts,
  editDuration,
  fillGeometry,
  speechSpans,
  timelineWords,
  type CaptionPreset,
  type EditSpec,
  type OverlayAnimation,
} from '../../../shared/edit';
import { builtinSfx } from '../../../shared/sfx';
import type { AssetType, MediaKind, Transcript } from '../../../shared/types';

/**
 * Compiles an edit into a HyperFrames composition: one HTML page whose timed elements (data-start / data-duration)
 * and paused GSAP timeline describe every frame. The live preview and the render use the same page; only where the
 * pictures come from differs (preview copies vs. full-quality segments cut for the render).
 */

export type ComposeMedia = { id: string; kind: MediaKind; assetType: AssetType | null; width: number | null; height: number | null; durationMs: number | null };
/** Where a moving picture comes from, and the moment in that file the clip starts. Null while it's being prepared. */
export type ComposeSource = { src: string; mediaStart: number } | null;

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
  /**
   * The Android app's WebView shows the preview from another origin: media is requested with CORS (so the runtime can
   * route audio through Web Audio), and videos get a blank poster instead of the WebView's grey play button.
   */
  forApp?: boolean;
};

/** Caption and title fonts that ship with the app (SIL Open Font License). */
export const BUNDLED_FONTS = [
  { family: 'Montserrat', weight: '100 900', files: ['montserrat-latin-wght-normal.woff2', 'montserrat-latin-ext-wght-normal.woff2'] },
  { family: 'Inter', weight: '100 900', files: ['inter-latin-wght-normal.woff2', 'inter-latin-ext-wght-normal.woff2'] },
  { family: 'Anton', weight: '400', files: ['anton-latin-400-normal.woff2', 'anton-latin-ext-400-normal.woff2'] },
];
const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';

const CAPTION_STYLE: Record<CaptionPreset, { family: string; weight: number; size: number; line: number }> = {
  bold: { family: 'Montserrat', weight: 900, size: 78, line: 1.08 },
  karaoke: { family: 'Montserrat', weight: 800, size: 70, line: 1.1 },
  clean: { family: 'Inter', weight: 700, size: 56, line: 1.25 },
  subtitle: { family: 'Inter', weight: 600, size: 50, line: 1.3 },
};

const VOICE_FX = {
  version: 1,
  nodes: [
    { type: 'highpass', id: 'v1', label: 'Remove rumble', params: { frequency: 85, q: 0.707, poles: '2' } },
    { type: 'compressor', id: 'v2', label: 'Even out', params: { threshold: -22, ratio: 3, attack: 8, release: 180, knee: 2.83, makeup: 4, mix: 1 } },
    { type: 'peaking', id: 'v3', label: 'Presence', params: { frequency: 3500, gain: 2.5, q: 0.9 } },
  ],
};
const MASTER_FX = { version: 1, nodes: [{ type: 'truepeak', id: 'm1', label: 'Delivery ceiling', params: { ceiling: -1, lookahead: 3, release: 80 } }] };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const attrJson = (v: unknown) => esc(JSON.stringify(v));
const n = (v: number) => String(Math.round(v * 1000) / 1000);
const px = (v: number) => `${Math.round(v * 100) / 100}px`;
const js = (v: unknown) => JSON.stringify(v);

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
    const g = fillGeometry(w, h, W, H, clip.focusX, clip.focusY, clip.zoom);
    const box = `left:${px(g.left)};top:${px(g.top)};width:${px(g.width)};height:${px(g.height)}`;
    if (m.kind === 'image') {
      body.push(`<img id="c${i}" class="clip pic" src="${esc(source.src)}" alt="" ${timing} style="${box};transform-origin:${n(clip.focusX * 100)}% ${n(clip.focusY * 100)}%">`);
      // A slow push-in keeps photos alive.
      tl.push(`tl.fromTo('#c${i}', { scale: 1 }, { scale: 1.07, duration: ${n(len)}, ease: 'none' }, ${n(start)});`);
      return;
    }
    const audible = clip.volume > 0 && spec.audio.voiceVolume > 0;
    anyClipAudio ||= audible;
    const sound = audible ? `data-has-audio="true" data-volume="${n(clip.volume)}" data-audio-group="voice"` : 'muted';
    body.push(`<video id="c${i}" class="pic" src="${esc(source.src)}"${app.video} ${timing} data-media-start="${n(source.mediaStart)}" ${sound} playsinline preload="auto" style="${box}"></video>`);
  });
  if (!spec.clips.length && input.preview) {
    body.push(`<div id="c0" class="clip ph" data-start="0" data-duration="${n(duration)}" data-track-index="0"><span>Add footage to start editing</span></div>`);
  }

  // ---------- overlays ----------
  const fontStack = (family: string) => (spec.captions.fontMediaId ? `'Brand', '${family}', sans-serif` : `'${family}', sans-serif`);
  spec.overlays.forEach((o, i) => {
    const start = Math.min(o.start, duration);
    const len = Math.max(0.1, Math.min(o.end, duration) - start);
    if (o.end <= 0 || o.start >= duration) return;
    const timing = `data-start="${n(start)}" data-duration="${n(len)}" data-track-index="${o.type === 'broll' ? 1 : 2}"`;
    if (o.type === 'broll') {
      const m = media.get(o.mediaId);
      const source = m ? input.brollSource(i) : null;
      if (!m || !source) {
        if (input.preview) body.push(`<div id="o${i}" class="clip ph broll" ${timing}><span>Preparing b-roll…</span></div>`);
        return;
      }
      const box = o.layout === 'full' ? { x: 0, y: 0, w: W, h: H } : o.layout === 'top' ? { x: 0, y: 0, w: W, h: H / 2 } : { x: W * 0.52, y: H * 0.07, w: W * 0.42, h: W * 0.42 * 1.25 };
      const { w, h } = sizeOf(o.mediaId);
      const g = fillGeometry(w, h, box.w, box.h, o.focusX, o.focusY, 1);
      // Clip to the layout's box; the picture itself is sized to fill it.
      const inset = [-g.top, g.width + g.left - box.w, g.height + g.top - box.h, -g.left].map(px).join(' ');
      const round = o.layout === 'pip' ? ' round 28px' : '';
      const style = `left:${px(box.x + g.left)};top:${px(box.y + g.top)};width:${px(g.width)};height:${px(g.height)};clip-path:inset(${inset}${round});z-index:10`;
      if (m.kind === 'image') body.push(`<img id="o${i}" class="clip pic" src="${esc(source.src)}" alt="" ${timing} style="${style}">`);
      else body.push(`<video id="o${i}" class="pic" src="${esc(source.src)}"${app.video} ${timing} data-media-start="${n(source.mediaStart)}" muted playsinline preload="auto" style="${style}"></video>`);
      tl.push(`tl.fromTo('#o${i}', { opacity: 0 }, { opacity: 1, duration: 0.15 }, ${n(start)});`);
      return;
    }
    if (o.type === 'image') {
      const { w, h } = sizeOf(o.mediaId);
      const width = o.width * W;
      body.push(
        `<div id="o${i}" class="clip layer" ${timing} style="z-index:20"><div class="anchor" style="left:${px(o.x * W - width / 2)};top:${px(o.y * H - (width * h) / w / 2)};width:${px(width)}"><img class="oi" src="${esc(input.fileUrl(o.mediaId))}" alt=""></div></div>`,
      );
      tl.push(...animate(`#o${i} .oi`, o.animation, start, len));
      return;
    }
    const y = o.position === 'top' ? 0.15 : o.position === 'center' ? 0.5 : 0.8;
    body.push(`<div id="o${i}" class="clip layer t-${o.style}" ${timing}><div class="line" style="top:${px(y * H)}"><div class="oi">${esc(o.text).replace(/\n/g, '<br>')}</div></div></div>`);
    tl.push(...animate(`#o${i} .oi`, o.animation, start, len));
  });

  // ---------- captions ----------
  const words = timelineWords(spec, input.transcripts);
  if (spec.captions.enabled && words.length) {
    const c = spec.captions;
    const style = CAPTION_STYLE[c.preset];
    const pages = captionPages(words, c, duration);
    pages.forEach((p, i) => {
      const spans = p.words.map((w, j) => `<span class="w" id="p${i}w${j}">${esc(c.preset === 'bold' ? w.text.replace(/[,.;:]+$/, '') : w.text)}</span>`).join(' ');
      body.push(`<div id="p${i}" class="clip layer cap" data-start="${n(p.start)}" data-duration="${n(p.end - p.start)}" data-track-index="3"><div class="line"><div class="ci">${spans}</div></div></div>`);
      if (c.preset === 'bold') tl.push(`tl.fromTo('#p${i} .ci', { scale: 0.86 }, { scale: 1, duration: 0.14, ease: 'back.out(3)' }, ${n(p.start)});`);
      if (c.preset === 'clean') tl.push(`tl.fromTo('#p${i} .ci', { opacity: 0 }, { opacity: 1, duration: 0.1 }, ${n(p.start)});`);
      if (c.preset === 'bold' || c.preset === 'karaoke') {
        p.words.forEach((w, j) => {
          const on = c.preset === 'bold' ? { color: c.highlight, scale: 1.1 } : { color: c.highlight, opacity: 1 };
          const off = c.preset === 'bold' ? { color: c.color, scale: 1 } : { color: c.color, opacity: 1 };
          tl.push(`tl.set('#p${i}w${j}', ${js(on)}, ${n(w.start)});`);
          const next = p.words[j + 1];
          if (next) tl.push(`tl.set('#p${i}w${j}', ${js(off)}, ${n(next.start)});`);
        });
      }
    });
    css.push(`
.cap { z-index: 40; }
.cap .line { top: ${px(c.position * H)}; }
.cap .ci { font-family: ${fontStack(style.family)}; font-weight: ${style.weight}; font-size: ${px(style.size * c.size)}; line-height: ${style.line}; color: ${c.color};
  text-transform: ${c.uppercase ? 'uppercase' : 'none'}; max-width: ${c.preset === 'subtitle' ? 88 : 84}%; }
.cap .w { display: inline-block; margin: 0 ${c.preset === 'bold' || c.preset === 'karaoke' ? '0.07em' : '0'}; }
${
  c.preset === 'bold'
    ? `.cap .w { -webkit-text-stroke: 0.16em #000; paint-order: stroke fill; text-shadow: 0 0.05em 0.14em rgba(0,0,0,.55); }`
    : c.preset === 'karaoke'
      ? `.cap .w { opacity: .5; -webkit-text-stroke: 0.12em #000; paint-order: stroke fill; }`
      : c.preset === 'clean'
        ? `.cap .ci { background: rgba(0,0,0,.62); padding: .22em .55em; border-radius: .38em; box-decoration-break: clone; -webkit-box-decoration-break: clone; }`
        : `.cap .ci { text-shadow: 0 2px 4px rgba(0,0,0,.9), 0 0 14px rgba(0,0,0,.6); }`
}`);
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
  spec.audio.sfx.forEach((s, i) => {
    const builtin = builtinSfx(s.mediaId);
    const m = media.get(s.mediaId);
    if (s.at >= duration || (!builtin && m?.assetType !== 'sfx')) return;
    const seconds = builtin ? builtin.seconds : m?.durationMs ? m.durationMs / 1000 : Infinity;
    const len = Math.min(duration - s.at, seconds);
    body.push(`<audio id="s${i}" src="${esc(input.fileUrl(s.mediaId))}"${app.media} data-start="${n(s.at)}" data-duration="${n(len)}" data-track-index="7" data-volume="${n(s.volume)}"></audio>`);
  });

  // ---------- page ----------
  const fontFaces = BUNDLED_FONTS.flatMap((f) =>
    f.files.map(
      (file, i) => `@font-face { font-family: '${f.family}'; font-style: normal; font-weight: ${f.weight}; font-display: block; src: url(${input.fontUrl(file)}) format('woff2'); unicode-range: ${i === 0 ? LATIN : LATIN_EXT}; }`,
    ),
  );
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
const tl = gsap.timeline({ paused: true });
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

function animate(target: string, kind: OverlayAnimation, start: number, len: number) {
  const out: string[] = [];
  const t = js(target);
  if (kind === 'pop') out.push(`tl.fromTo(${t}, { scale: 0.6, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.28, ease: 'back.out(2.2)' }, ${n(start)});`);
  if (kind === 'fade') out.push(`tl.fromTo(${t}, { opacity: 0 }, { opacity: 1, duration: 0.3 }, ${n(start)});`);
  if (kind === 'slide') out.push(`tl.fromTo(${t}, { y: 60, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: 'power3.out' }, ${n(start)});`);
  if (kind !== 'none' && len > 0.6) out.push(`tl.to(${t}, { opacity: 0, duration: 0.2 }, ${n(start + len - 0.2)});`);
  return out;
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
