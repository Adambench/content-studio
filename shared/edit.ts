// The video studio's edit document, shared by the server (compile + render), the web editor and Claude's tools.
// An edit is plain JSON; the server compiles it to a HyperFrames composition for preview and rendering.

import type { Transcript } from './types';

export const EDIT_FPS = 30;
/** Platforms cap short videos at 3 minutes (Reels, Shorts); longer edits still render but get a warning. */
export const SHORT_MAX_SECONDS = 180;
export const EDIT_MAX_SECONDS = 600;

export const EDIT_FORMATS = {
  '9:16': { width: 1080, height: 1920, label: 'Vertical 9:16', hint: 'TikTok, Reels, Shorts' },
  '4:5': { width: 1080, height: 1350, label: 'Portrait 4:5', hint: 'Instagram feed' },
  '1:1': { width: 1080, height: 1080, label: 'Square 1:1', hint: 'Feed posts' },
} as const;
export type EditFormat = keyof typeof EDIT_FORMATS;
const FORMAT_IDS = Object.keys(EDIT_FORMATS) as EditFormat[];

/** One shot on the main track. Clips play back to back in order. */
export type EditClip = {
  id: string;
  mediaId: string;
  /** In/out points in the source, in seconds. For a photo, `in` is 0 and `out` is how long it shows. */
  in: number;
  out: number;
  /** Reframe: the point of the source to keep in view when cropping to the output shape (0–1 each way). */
  focusX: number;
  focusY: number;
  /** Extra zoom on top of filling the frame; 1 = just fills it. */
  zoom: number;
  /** Clip sound, 0 = muted, 1 = as recorded. */
  volume: number;
};

export const CAPTION_PRESETS = ['bold', 'karaoke', 'clean', 'subtitle'] as const;
export type CaptionPreset = (typeof CAPTION_PRESETS)[number];
export const CAPTION_PRESET_LABELS: Record<CaptionPreset, { label: string; hint: string }> = {
  bold: { label: 'Bold', hint: 'Big words, the spoken one pops in your accent colour' },
  karaoke: { label: 'Karaoke', hint: 'Words light up as they’re said' },
  clean: { label: 'Clean', hint: 'Sentence case on a soft box' },
  subtitle: { label: 'Subtitle', hint: 'Small, two lines, low on screen' },
};

/** What switching to a preset also changes, so each looks right out of the box. */
export const CAPTION_PRESET_DEFAULTS: Record<CaptionPreset, Pick<CaptionSettings, 'uppercase' | 'maxWords' | 'position'>> = {
  bold: { uppercase: true, maxWords: 3, position: 0.68 },
  karaoke: { uppercase: true, maxWords: 4, position: 0.68 },
  clean: { uppercase: false, maxWords: 5, position: 0.72 },
  subtitle: { uppercase: false, maxWords: 8, position: 0.86 },
};

export type CaptionSettings = {
  enabled: boolean;
  preset: CaptionPreset;
  /** Vertical centre of the captions: 0 = top, 1 = bottom. */
  position: number;
  /** Size multiplier, 0.6–1.6. */
  size: number;
  color: string;
  /** Accent: the spoken word (bold, karaoke) and label overlays. */
  highlight: string;
  uppercase: boolean;
  /** Most words on screen at once. */
  maxWords: number;
  /** A brand font from the workspace's assets; null uses the preset's font. */
  fontMediaId: string | null;
};

export type OverlayAnimation = 'pop' | 'fade' | 'slide' | 'none';
export const OVERLAY_ANIMATIONS: OverlayAnimation[] = ['pop', 'fade', 'slide', 'none'];

type OverlayBase = { id: string; start: number; end: number };
export type TextOverlay = OverlayBase & {
  type: 'text';
  text: string;
  style: 'title' | 'label' | 'note';
  position: 'top' | 'center' | 'bottom';
  animation: OverlayAnimation;
};
export type ImageOverlay = OverlayBase & {
  type: 'image';
  mediaId: string;
  /** Centre of the image in the frame (0–1) and its width as a fraction of the frame width. */
  x: number;
  y: number;
  width: number;
  animation: OverlayAnimation;
};
/** Cutaway footage over the main track; the main track's sound keeps playing. */
export type BrollOverlay = OverlayBase & {
  type: 'broll';
  mediaId: string;
  /** Where in the b-roll source to start. */
  in: number;
  layout: 'full' | 'top' | 'pip';
  focusX: number;
  focusY: number;
};
export type EditOverlay = TextOverlay | ImageOverlay | BrollOverlay;

export type SfxCue = { id: string; mediaId: string; at: number; volume: number };

export type EditAudio = {
  musicMediaId: string | null;
  /** Where in the music track to start, in seconds. */
  musicStart: number;
  musicVolume: number;
  /** Lower the music while someone speaks. */
  duck: boolean;
  /** Level of all clip sound. */
  voiceVolume: number;
  /** Rumble cut, gentle compression and presence on the clip sound. */
  enhanceVoice: boolean;
  /** Normalise the final mix to −14 LUFS, what TikTok, Instagram and YouTube play at. */
  normalize: boolean;
  sfx: SfxCue[];
};

export type EditGrade = { lutMediaId: string | null; intensity: number };
export type Watermark = { mediaId: string | null; corner: 'tl' | 'tr' | 'bl' | 'br'; opacity: number; size: number };

export type EditSpec = {
  v: 1;
  format: EditFormat;
  clips: EditClip[];
  captions: CaptionSettings;
  overlays: EditOverlay[];
  audio: EditAudio;
  grade: EditGrade;
  watermark: Watermark;
};

/** The reusable look of a brand's videos, saved per workspace. */
export type EditTemplate = {
  format: EditFormat;
  captions: CaptionSettings;
  grade: EditGrade;
  watermark: Watermark;
  audio: Omit<EditAudio, 'sfx' | 'musicStart'>;
};

export const DUCK_LEVEL = 0.3;
export const LOUDNESS_TARGET = -14;

export function emptyEdit(): EditSpec {
  return {
    v: 1,
    format: '9:16',
    clips: [],
    captions: {
      enabled: true,
      preset: 'bold',
      position: 0.68,
      size: 1,
      color: '#ffffff',
      highlight: '#facc15',
      uppercase: true,
      maxWords: 3,
      fontMediaId: null,
    },
    overlays: [],
    audio: { musicMediaId: null, musicStart: 0, musicVolume: 0.25, duck: true, voiceVolume: 1, enhanceVoice: false, normalize: true, sfx: [] },
    grade: { lutMediaId: null, intensity: 1 },
    watermark: { mediaId: null, corner: 'tr', opacity: 0.85, size: 0.16 },
  };
}

export const newEditId = () => crypto.randomUUID().replace(/-/g, '').slice(0, 10);

const num = (v: unknown, fallback: number, min = -Infinity, max = Infinity) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.min(max, Math.max(min, n));
};
const str = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);
const idOrNull = (v: unknown) => (typeof v === 'string' && v ? v : null);
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => (options.includes(v as T) ? (v as T) : fallback);
const color = (v: unknown, fallback: string) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback);
const round = (n: number) => Math.round(n * 1000) / 1000;
type Loose = Record<string, unknown>;
const obj = (v: unknown): Loose => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Loose) : {});
const list = (v: unknown): Loose[] => (Array.isArray(v) ? v.map(obj) : []);

function normalizeCaptions(input: unknown, base = emptyEdit().captions): CaptionSettings {
  const c = obj(input);
  return {
    enabled: typeof c.enabled === 'boolean' ? c.enabled : base.enabled,
    preset: oneOf(c.preset, CAPTION_PRESETS, base.preset),
    position: round(num(c.position, base.position, 0.05, 0.95)),
    size: round(num(c.size, base.size, 0.6, 1.6)),
    color: color(c.color, base.color),
    highlight: color(c.highlight, base.highlight),
    uppercase: typeof c.uppercase === 'boolean' ? c.uppercase : base.uppercase,
    maxWords: Math.round(num(c.maxWords, base.maxWords, 1, 8)),
    fontMediaId: c.fontMediaId === undefined ? base.fontMediaId : idOrNull(c.fontMediaId),
  };
}

function normalizeAudio(input: unknown, base = emptyEdit().audio): EditAudio {
  const a = obj(input);
  return {
    musicMediaId: a.musicMediaId === undefined ? base.musicMediaId : idOrNull(a.musicMediaId),
    musicStart: round(num(a.musicStart, base.musicStart, 0)),
    musicVolume: round(num(a.musicVolume, base.musicVolume, 0, 1)),
    duck: typeof a.duck === 'boolean' ? a.duck : base.duck,
    voiceVolume: round(num(a.voiceVolume, base.voiceVolume, 0, 2)),
    enhanceVoice: typeof a.enhanceVoice === 'boolean' ? a.enhanceVoice : base.enhanceVoice,
    normalize: typeof a.normalize === 'boolean' ? a.normalize : base.normalize,
    sfx: list(a.sfx ?? base.sfx)
      .filter((s) => typeof s.mediaId === 'string')
      .map((s) => ({ id: str(s.id, '') || newEditId(), mediaId: s.mediaId as string, at: round(num(s.at, 0, 0)), volume: round(num(s.volume, 0.8, 0, 2)) })),
  };
}

function normalizeGrade(input: unknown, base = emptyEdit().grade): EditGrade {
  const g = obj(input);
  return { lutMediaId: g.lutMediaId === undefined ? base.lutMediaId : idOrNull(g.lutMediaId), intensity: round(num(g.intensity, base.intensity, 0, 1)) };
}

function normalizeWatermark(input: unknown, base = emptyEdit().watermark): Watermark {
  const w = obj(input);
  return {
    mediaId: w.mediaId === undefined ? base.mediaId : idOrNull(w.mediaId),
    corner: oneOf(w.corner, ['tl', 'tr', 'bl', 'br'] as const, base.corner),
    opacity: round(num(w.opacity, base.opacity, 0.1, 1)),
    size: round(num(w.size, base.size, 0.05, 0.5)),
  };
}

function normalizeClip(input: Loose): EditClip | null {
  if (typeof input.mediaId !== 'string' || !input.mediaId) return null;
  const inPoint = round(num(input.in, 0, 0));
  const out = round(num(input.out, inPoint + 3, inPoint + 0.1));
  return {
    id: str(input.id, '') || newEditId(),
    mediaId: input.mediaId,
    in: inPoint,
    out,
    focusX: round(num(input.focusX, 0.5, 0, 1)),
    focusY: round(num(input.focusY, 0.5, 0, 1)),
    zoom: round(num(input.zoom, 1, 1, 3)),
    volume: round(num(input.volume, 1, 0, 2)),
  };
}

function normalizeOverlay(input: Loose): EditOverlay | null {
  const start = round(num(input.start, 0, 0));
  const base = { id: str(input.id, '') || newEditId(), start, end: round(num(input.end, start + 2, start + 0.1)) };
  const animation = oneOf(input.animation, OVERLAY_ANIMATIONS, 'pop');
  switch (input.type) {
    case 'text':
      if (typeof input.text !== 'string' || !input.text.trim()) return null;
      return {
        ...base,
        type: 'text',
        text: input.text.slice(0, 300),
        style: oneOf(input.style, ['title', 'label', 'note'] as const, 'title'),
        position: oneOf(input.position, ['top', 'center', 'bottom'] as const, 'top'),
        animation,
      };
    case 'image':
      if (typeof input.mediaId !== 'string') return null;
      return { ...base, type: 'image', mediaId: input.mediaId, x: round(num(input.x, 0.5, 0, 1)), y: round(num(input.y, 0.3, 0, 1)), width: round(num(input.width, 0.4, 0.05, 1)), animation };
    case 'broll':
      if (typeof input.mediaId !== 'string') return null;
      return {
        ...base,
        type: 'broll',
        mediaId: input.mediaId,
        in: round(num(input.in, 0, 0)),
        layout: oneOf(input.layout, ['full', 'top', 'pip'] as const, 'full'),
        focusX: round(num(input.focusX, 0.5, 0, 1)),
        focusY: round(num(input.focusY, 0.5, 0, 1)),
      };
    default:
      return null;
  }
}

/** Fill in and clamp everything, so older or hand-written (or Claude-written) edits always have the full shape. */
export function normalizeEdit(input: unknown): EditSpec {
  const e = obj(input);
  const base = emptyEdit();
  return {
    v: 1,
    format: oneOf(e.format, FORMAT_IDS, base.format),
    clips: list(e.clips).map(normalizeClip).filter((c): c is EditClip => !!c),
    captions: normalizeCaptions(e.captions),
    overlays: list(e.overlays)
      .map(normalizeOverlay)
      .filter((o): o is EditOverlay => !!o)
      .sort((a, b) => a.start - b.start),
    audio: normalizeAudio(e.audio),
    grade: normalizeGrade(e.grade),
    watermark: normalizeWatermark(e.watermark),
  };
}

export function templateFromEdit(spec: EditSpec): EditTemplate {
  const { sfx: _sfx, musicStart: _start, ...audio } = spec.audio;
  return { format: spec.format, captions: spec.captions, grade: spec.grade, watermark: spec.watermark, audio };
}

export function normalizeTemplate(input: unknown): EditTemplate {
  const t = obj(input);
  return templateFromEdit(normalizeEdit({ ...t, audio: { ...obj(t.audio), sfx: [] } }));
}

/** Apply a brand template's look to an edit, keeping its footage, overlays and sound effects. */
export function applyTemplate(spec: EditSpec, template: EditTemplate): EditSpec {
  return normalizeEdit({ ...spec, format: template.format, captions: template.captions, grade: template.grade, watermark: template.watermark, audio: { ...template.audio, musicStart: spec.audio.musicStart, sfx: spec.audio.sfx } });
}

// ---------- timeline ----------

export const clipLength = (c: Pick<EditClip, 'in' | 'out'>) => Math.max(0, c.out - c.in);

/** Where each clip starts in the finished video. */
export function clipStarts(spec: Pick<EditSpec, 'clips'>) {
  let t = 0;
  return spec.clips.map((c) => {
    const start = t;
    t += clipLength(c);
    return start;
  });
}

export function editDuration(spec: Pick<EditSpec, 'clips'>) {
  return round(spec.clips.reduce((sum, c) => sum + clipLength(c), 0));
}

/** The clip playing at a moment of the finished video. */
export function clipAt(spec: Pick<EditSpec, 'clips'>, time: number) {
  const starts = clipStarts(spec);
  for (let i = spec.clips.length - 1; i >= 0; i--) if (time >= starts[i]) return { index: i, clip: spec.clips[i], start: starts[i] };
  return null;
}

/** A spoken word placed on the finished video's timeline, with where it came from. */
export type TimelineWord = { start: number; end: number; text: string; clipId: string; mediaId: string; sourceStart: number };

const cleanWord = (w: string) => w.replace(/\s+/g, ' ').trim();

/** Every transcribed word that survives the cuts, in output time. */
export function timelineWords(spec: Pick<EditSpec, 'clips'>, transcripts: Record<string, Transcript | null | undefined>): TimelineWord[] {
  const starts = clipStarts(spec);
  const out: TimelineWord[] = [];
  spec.clips.forEach((clip, i) => {
    const t = transcripts[clip.mediaId];
    if (!t) return;
    for (const seg of t.segments) {
      if (seg.end <= clip.in || seg.start >= clip.out) continue;
      for (const w of seg.words ?? []) {
        const text = cleanWord(w.word);
        if (!text) continue;
        const mid = (w.start + w.end) / 2;
        // A word belongs to the clip that holds most of it.
        if (mid < clip.in || mid >= clip.out) continue;
        out.push({
          start: round(starts[i] + Math.max(0, w.start - clip.in)),
          end: round(starts[i] + Math.min(clipLength(clip), w.end - clip.in)),
          text,
          clipId: clip.id,
          mediaId: clip.mediaId,
          sourceStart: w.start,
        });
      }
    }
  });
  return out;
}

export type CaptionWord = { start: number; end: number; text: string };
export type CaptionPage = { start: number; end: number; words: CaptionWord[] };

/** Group words into the chunks shown on screen at once. A cut always starts a new chunk. */
export function captionPages(words: (Pick<TimelineWord, 'start' | 'end' | 'text'> & { clipId?: string })[], settings: Pick<CaptionSettings, 'maxWords' | 'preset'>, duration: number): CaptionPage[] {
  const maxChars = settings.preset === 'subtitle' ? 64 : settings.maxWords <= 2 ? 16 : 14 + settings.maxWords * 5;
  const pages: CaptionPage[] = [];
  let cur: CaptionWord[] = [];
  let clip: string | undefined;
  const flush = () => {
    if (cur.length) pages.push({ start: cur[0].start, end: cur[cur.length - 1].end, words: cur });
    cur = [];
  };
  for (const w of words) {
    const last = cur[cur.length - 1];
    const chars = cur.reduce((n, x) => n + x.text.length + 1, 0);
    if (last && (cur.length >= settings.maxWords || w.start - last.end > 0.6 || chars + w.text.length > maxChars || /[.!?]$/.test(last.text) || w.clipId !== clip)) flush();
    cur.push({ start: w.start, end: w.end, text: w.text });
    clip = w.clipId;
  }
  flush();
  // Hold each chunk until the next one (briefly), and never flash shorter than a few frames.
  for (let i = 0; i < pages.length; i++) {
    const next = pages[i + 1]?.start ?? duration;
    pages[i].end = round(Math.min(next, Math.max(pages[i].end + 0.25, pages[i].start + 0.4)));
    pages[i].start = round(pages[i].start);
  }
  return pages.filter((p) => p.end > p.start);
}

/** Stretches of speech in output time (for ducking music), merging short pauses. */
export function speechSpans(words: Pick<TimelineWord, 'start' | 'end'>[], mergeGap = 0.6): [number, number][] {
  const spans: [number, number][] = [];
  for (const w of words) {
    const last = spans[spans.length - 1];
    if (last && w.start - last[1] <= mergeGap) last[1] = Math.max(last[1], w.end);
    else spans.push([w.start, w.end]);
  }
  return spans;
}

// ---------- tightening (silence and filler removal) ----------

const FILLERS = new Set(['um', 'uh', 'umm', 'uhm', 'erm', 'er', 'ah', 'hmm', 'mm', 'eh']);
export const isFiller = (word: string) => FILLERS.has(word.toLowerCase().replace(/[^a-z]/g, ''));

export type TightenOptions = {
  /** Pauses longer than this are cut (seconds). */
  maxPause: number;
  removeFillers: boolean;
  /** Alternate a slight zoom between consecutive cuts of the same shot, so jump cuts feel intentional. */
  punchIn: boolean;
};
export const TIGHTEN_PRESETS: Record<'natural' | 'tight', TightenOptions> = {
  natural: { maxPause: 0.7, removeFillers: false, punchIn: false },
  tight: { maxPause: 0.35, removeFillers: true, punchIn: true },
};

/** Speech ranges in a source (seconds), from transcript words. Fillers count as silence when asked. */
export function speechRangesFromTranscript(t: Transcript, removeFillers: boolean): [number, number][] {
  return t.segments
    .flatMap((s) => s.words ?? [])
    .filter((w) => cleanWord(w.word) && !(removeFillers && isFiller(w.word)))
    .map((w) => [w.start, w.end] as [number, number]);
}

/**
 * Split clips around the pauses between speech. `speech` maps each media id to its speech ranges in source time
 * (null = unknown, the clip is kept as it is). Each kept piece gets a little air before and after.
 */
export function tightenClips(clips: EditClip[], speech: Record<string, [number, number][] | null>, opts: TightenOptions): EditClip[] {
  const lead = 0.08;
  const tail = 0.14;
  const out: EditClip[] = [];
  for (const clip of clips) {
    const ranges = speech[clip.mediaId];
    if (!ranges) {
      out.push(clip);
      continue;
    }
    const inside = ranges.filter(([s, e]) => e > clip.in && s < clip.out).sort((a, b) => a[0] - b[0]);
    if (!inside.length) continue; // nothing said in this clip: drop it
    const keep: [number, number][] = [];
    for (const [s, e] of inside) {
      const start = Math.max(clip.in, s - lead);
      const end = Math.min(clip.out, e + tail);
      const last = keep[keep.length - 1];
      // Padded pieces closer than the allowed pause (or overlapping) stay one piece.
      if (last && start - last[1] <= Math.max(0, opts.maxPause - lead - tail)) last[1] = Math.max(last[1], end);
      else keep.push([start, end]);
    }
    keep
      .filter(([s, e]) => e - s >= 0.2)
      .forEach(([s, e], i) => out.push({ ...clip, id: i === 0 ? clip.id : newEditId(), in: round(s), out: round(e) }));
  }
  if (opts.punchIn) {
    let alt = false;
    for (let i = 0; i < out.length; i++) {
      const sameShot = i > 0 && out[i - 1].mediaId === out[i].mediaId;
      alt = sameShot ? !alt : false;
      out[i] = { ...out[i], zoom: alt ? Math.max(out[i].zoom, 1.12) : out[i].zoom > 1.12 ? out[i].zoom : 1 };
    }
  }
  return out;
}

/** Split a clip at a moment of the finished video. */
export function splitClipAt(spec: EditSpec, time: number): EditSpec {
  const hit = clipAt(spec, time);
  if (!hit) return spec;
  const cut = round(hit.clip.in + (time - hit.start));
  if (cut - hit.clip.in < 0.1 || hit.clip.out - cut < 0.1) return spec;
  const clips = [...spec.clips];
  clips.splice(hit.index, 1, { ...hit.clip, out: cut }, { ...hit.clip, id: newEditId(), in: cut });
  return { ...spec, clips };
}

/**
 * Where a source of `srcW`×`srcH` sits inside a `boxW`×`boxH` frame: scaled to fill it (times `zoom`) and shifted so the
 * focus point is as central as the edges allow. Returns pixel geometry for absolute positioning.
 */
export function fillGeometry(srcW: number, srcH: number, boxW: number, boxH: number, focusX: number, focusY: number, zoom = 1) {
  const scale = Math.max(boxW / srcW, boxH / srcH) * zoom;
  const width = srcW * scale;
  const height = srcH * scale;
  const left = -Math.min(Math.max(focusX * width - boxW / 2, 0), width - boxW);
  const top = -Math.min(Math.max(focusY * height - boxH / 2, 0), height - boxH);
  return { width: round(width), height: round(height), left: round(left), top: round(top) };
}
