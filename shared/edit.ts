// The video studio's edit document, shared by the server (compile + render), the web editor and Claude's tools.
// An edit is plain JSON; the server compiles it to a HyperFrames composition for preview and rendering.

import { bundledFamily } from './fonts';
import { BROLL_LAYOUTS, CLIP_MOTIONS, FILTER_LOOKS, NO_TEXTURES, OVERLAY_ANIMATIONS, type BrollLayout, type ClipMotion, type FilterLook, type OverlayAnimation, type Textures } from './looks';
import { normalizeRecipe, type Recipe } from './recipe';
import { normalizeScene, type SceneSpec } from './scene';
import { refitScene, sceneMaxSeconds } from './scene-library';
import { builtinSfxId } from './sfx';
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
  /** How this clip comes in after the one before it (ignored on the first clip); null = a straight cut. */
  transition: ClipTransition | null;
  /** A camera move over the clip (shared/looks.ts). */
  motion: ClipMotion;
  /** This clip's colour look; null = the video's (grade.filter). */
  filter: FilterLook | null;
};

// ---------- transitions ----------

export const TRANSITIONS = [
  'fade',
  'dip',
  'dip-white',
  'flash',
  'zoom',
  'zoom-out',
  'whip',
  'whip-up',
  'slide',
  'push',
  'drop',
  'blur',
  'glitch',
  'spin',
  'flip',
  'cube',
  'squeeze',
  'stretch',
  'gravity',
  'iris',
  'wipe',
  'diagonal',
  'blinds',
  'shutter',
  'light-leak',
  'burn',
  'shake',
  'bounce',
] as const;
export type TransitionType = (typeof TRANSITIONS)[number];
/** Each one's default length and the built-in sound it plays when `sound` is on (non-musical, shared/sfx.ts). */
export const TRANSITION_INFO: Record<TransitionType, { label: string; hint: string; duration: number; sound: string }> = {
  fade: { label: 'Crossfade', hint: 'One shot melts into the next', duration: 0.5, sound: 'whoosh-soft' },
  dip: { label: 'Dip to black', hint: 'A beat of black: a new section, or the end', duration: 0.6, sound: 'whoosh-soft' },
  'dip-white': { label: 'Dip to white', hint: 'A soft fade through white: a memory, a dream, a fresh start', duration: 0.6, sound: 'whoosh-soft' },
  flash: { label: 'Flash', hint: 'A burst of white light: energy, a reveal', duration: 0.3, sound: 'shutter' },
  zoom: { label: 'Zoom through', hint: 'Punches through into the next shot', duration: 0.36, sound: 'whoosh-fast' },
  'zoom-out': { label: 'Zoom out', hint: 'This shot shrinks away to show the next behind it: a step back, context', duration: 0.45, sound: 'whoosh-reverse' },
  whip: { label: 'Whip pan', hint: 'A fast blurred swipe sideways', duration: 0.3, sound: 'whoosh-fast' },
  'whip-up': { label: 'Whip tilt', hint: 'A fast blurred swipe upwards', duration: 0.3, sound: 'whoosh-fast' },
  slide: { label: 'Push up', hint: 'The next shot pushes this one up, like a scroll', duration: 0.4, sound: 'swish' },
  push: { label: 'Push sideways', hint: 'The next shot pushes this one off to the left, clean and smooth: the next point, the next step', duration: 0.45, sound: 'swish' },
  drop: { label: 'Drop in', hint: 'The next shot slides down over this one from the top', duration: 0.4, sound: 'swish' },
  blur: { label: 'Blur', hint: 'Soft focus out, and in on the next shot', duration: 0.5, sound: 'whoosh-soft' },
  glitch: { label: 'Glitch', hint: 'A digital stutter', duration: 0.3, sound: 'glitch' },
  spin: { label: 'Spin', hint: 'Spins out and the next shot spins in: playful, chaotic, a montage', duration: 0.45, sound: 'whoosh-fast' },
  flip: { label: 'Card flip', hint: 'Flips over in 3D like a card: before/after, the other side', duration: 0.5, sound: 'swish' },
  cube: { label: 'Cube turn', hint: 'Turns like the side of a cube: the next topic, a switch of place', duration: 0.55, sound: 'whoosh-soft' },
  squeeze: { label: 'Squeeze', hint: 'This shot squashes away sideways as the next one stretches in', duration: 0.4, sound: 'swish' },
  stretch: { label: 'Stretch', hint: 'A vertical smear into the next shot: speed, a jump in time', duration: 0.3, sound: 'whoosh-fast' },
  gravity: { label: 'Fall away', hint: 'This shot drops off the bottom, tumbling, to show the next: a failure, “forget that”', duration: 0.6, sound: 'whoosh-heavy' },
  iris: { label: 'Circle reveal', hint: 'The next shot opens from a circle in the middle: a reveal, a focus', duration: 0.5, sound: 'whoosh-soft' },
  wipe: { label: 'Wipe', hint: 'A hard edge sweeps across, left to right: a clean change of scene', duration: 0.45, sound: 'swish' },
  diagonal: { label: 'Diagonal wipe', hint: 'A slanted edge sweeps across: dynamic, sporty', duration: 0.45, sound: 'swish' },
  blinds: { label: 'Blinds', hint: 'Horizontal strips open onto the next shot: a list, a montage', duration: 0.55, sound: 'whoosh-soft' },
  shutter: { label: 'Shutter', hint: 'Black closes in from top and bottom, then opens on the next shot: a snapshot, a new scene', duration: 0.45, sound: 'shutter' },
  'light-leak': { label: 'Light leak', hint: 'A warm burst of film light washes across: memories, dreamy, summer', duration: 0.7, sound: 'whoosh-soft' },
  burn: { label: 'Burn out', hint: 'Overexposes to white-hot and back: intense, a big moment', duration: 0.5, sound: 'whoosh-heavy' },
  shake: { label: 'Impact cut', hint: 'A hard cut with a camera shake: a hit, a punchline, a shock', duration: 0.35, sound: 'hit' },
  bounce: { label: 'Bounce in', hint: 'The next shot pops up from below and bounces into place: light, fun', duration: 0.55, sound: 'bloop' },
};
/**
 * Only the pictures overlap: each shot runs a little past the cut (the source either side of the in/out points) while
 * the sound still cuts where it did, so the timeline, captions and timings never move.
 */
export type ClipTransition = { type: TransitionType; duration: number; sound: boolean };
export const TRANSITION_MIN = 0.15;
export const TRANSITION_MAX = 1.2;

export const CAPTION_PRESETS = [
  'bold',
  'karaoke',
  'clean',
  'subtitle',
  'pop',
  'box',
  'marker',
  'reveal',
  'bounce',
  'impact',
  'neon',
  'outline',
  'retro',
  'glitch',
  'comic',
  'handwritten',
  'editorial',
  'typewriter',
  'minimal',
  'arcade',
] as const;
export type CaptionPreset = (typeof CAPTION_PRESETS)[number];
export const CAPTION_PRESET_LABELS: Record<CaptionPreset, { label: string; hint: string }> = {
  bold: { label: 'Bold', hint: 'Big words, the spoken one pops in your accent colour' },
  karaoke: { label: 'Karaoke', hint: 'Words light up as they’re said' },
  clean: { label: 'Clean', hint: 'Sentence case on a soft box' },
  subtitle: { label: 'Subtitle', hint: 'Small, two lines, low on screen' },
  pop: { label: 'One word', hint: 'One huge word at a time, each popping in: fast, high energy' },
  box: { label: 'Highlight box', hint: 'The spoken word sits in a box of your accent colour' },
  marker: { label: 'Marker', hint: 'A highlighter swipes behind the spoken word' },
  reveal: { label: 'Word reveal', hint: 'Words appear only as they’re said' },
  bounce: { label: 'Bounce', hint: 'Each word bounces up as it’s said: playful' },
  impact: { label: 'Impact', hint: 'Tall condensed capitals, stacked tight: hype, motivation' },
  neon: { label: 'Neon', hint: 'Glowing tube letters in your accent colour: night, tech, gaming' },
  outline: { label: 'Outline', hint: 'Hollow letters that fill in as each word is said' },
  retro: { label: 'Retro 3D', hint: 'A hard offset shadow in the accent colour: 80s, bold, loud' },
  glitch: { label: 'Glitch', hint: 'Red/cyan split letters that jitter on each word: tech, edgy' },
  comic: { label: 'Comic', hint: 'Comic-book capitals that slam in tilted: reactions, fun' },
  handwritten: { label: 'Handwritten', hint: 'Marker handwriting: personal, raw, DIY' },
  editorial: { label: 'Editorial', hint: 'Elegant serif, sentence case, the spoken word in italics: stories, luxury' },
  typewriter: { label: 'Typewriter', hint: 'Monospace letters typed out as they’re said: tech, investigations' },
  minimal: { label: 'Minimal', hint: 'Small lowercase, no box or outline: calm, aesthetic' },
  arcade: { label: 'Arcade', hint: 'Pixel letters: games, retro, nerdy' },
};

/** What switching to a preset also changes, so each looks right out of the box. */
export const CAPTION_PRESET_DEFAULTS: Record<CaptionPreset, Pick<CaptionSettings, 'uppercase' | 'maxWords' | 'position'>> = {
  bold: { uppercase: true, maxWords: 3, position: 0.68 },
  karaoke: { uppercase: true, maxWords: 4, position: 0.68 },
  clean: { uppercase: false, maxWords: 5, position: 0.72 },
  subtitle: { uppercase: false, maxWords: 8, position: 0.86 },
  pop: { uppercase: true, maxWords: 1, position: 0.62 },
  box: { uppercase: true, maxWords: 3, position: 0.68 },
  marker: { uppercase: false, maxWords: 4, position: 0.7 },
  reveal: { uppercase: true, maxWords: 4, position: 0.68 },
  bounce: { uppercase: true, maxWords: 3, position: 0.68 },
  impact: { uppercase: true, maxWords: 2, position: 0.64 },
  neon: { uppercase: true, maxWords: 3, position: 0.68 },
  outline: { uppercase: true, maxWords: 3, position: 0.68 },
  retro: { uppercase: true, maxWords: 3, position: 0.66 },
  glitch: { uppercase: true, maxWords: 3, position: 0.68 },
  comic: { uppercase: true, maxWords: 3, position: 0.66 },
  handwritten: { uppercase: false, maxWords: 4, position: 0.7 },
  editorial: { uppercase: false, maxWords: 5, position: 0.72 },
  typewriter: { uppercase: false, maxWords: 5, position: 0.72 },
  minimal: { uppercase: false, maxWords: 5, position: 0.78 },
  arcade: { uppercase: true, maxWords: 3, position: 0.7 },
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
  /** A brand font from the workspace's assets; null uses `font` or the preset's font. */
  fontMediaId: string | null;
  /** One of the app's own fonts (shared/fonts.ts) instead of the preset's; null = the preset's. */
  font: string | null;
};

export { OVERLAY_ANIMATIONS, type OverlayAnimation } from './looks';

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
  layout: BrollLayout;
  focusX: number;
  focusY: number;
};

// ---------- motion graphics ----------

export const GRAPHICS = [
  'lowerThird',
  'stat',
  'list',
  'quote',
  'callout',
  'chapter',
  'cta',
  'progress',
  'kinetic',
  'checklist',
  'chart',
  'wall',
  'versus',
  'timeline',
  'ranking',
  'steps',
  'compare',
  'ring',
  'rating',
  'price',
  'comment',
  'notification',
  'search',
  'highlight',
  'reveal',
  'question',
  'definition',
  'ticker',
  'circle',
] as const;
export type GraphicTemplate = (typeof GRAPHICS)[number];
export type GraphicPosition = 'top' | 'center' | 'bottom';

/**
 * The motion-graphics templates. `fields` names what each one uses (and how the editor labels it); unused fields are
 * kept but ignored. `seconds` is how long a new one lasts.
 */
export const GRAPHIC_INFO: Record<
  GraphicTemplate,
  { label: string; hint: string; seconds: number; position: GraphicPosition | null; fields: { text?: string; sub?: string; items?: string; point?: boolean }; example: Partial<Pick<GraphicOverlay, 'text' | 'sub' | 'items'>> }
> = {
  lowerThird: { label: 'Name tag', hint: 'Who’s speaking: a name and a line about them', seconds: 4, position: 'bottom', fields: { text: 'Name', sub: 'Who they are' }, example: { text: 'Mark Manson', sub: 'Author, Subtle Art' } },
  stat: { label: 'Big number', hint: 'A number that counts up, with what it means', seconds: 3, position: 'center', fields: { text: 'The number (e.g. $1.2M, 87%, 10,000)', sub: 'What it is' }, example: { text: '87%', sub: 'of bombers never came back' } },
  list: { label: 'List', hint: 'Points that tick in one by one', seconds: 6, position: 'center', fields: { text: 'Heading (optional)', items: 'Points, one per line (up to 6)' }, example: { text: '3 rules', items: ['Start before you’re ready', 'Ship every day', 'Ask for feedback'] } },
  quote: { label: 'Quote', hint: 'A line worth keeping, with who said it', seconds: 4, position: 'center', fields: { text: 'The quote', sub: 'Who said it' }, example: { text: 'Look at *what survived*, not what failed.', sub: 'Abraham Wald' } },
  callout: { label: 'Arrow callout', hint: 'Points at something on screen', seconds: 2.5, position: null, fields: { text: 'Label', point: true }, example: { text: 'Look here' } },
  chapter: { label: 'Section title', hint: 'A full-screen card between parts', seconds: 1.6, position: null, fields: { sub: 'Small line above (e.g. Step 2)', text: 'Title' }, example: { sub: 'Step 2', text: 'Find the *real* problem' } },
  cta: { label: 'Follow prompt', hint: 'A nudge to follow, save or comment', seconds: 2.5, position: 'center', fields: { text: 'What it says' }, example: { text: 'Follow for part 2' } },
  progress: { label: 'Progress bar', hint: 'A thin bar that fills as the video plays', seconds: 0, position: 'top', fields: {}, example: {} },
  checklist: { label: 'Checklist', hint: 'Boxes that tick one by one: what to do, what you get', seconds: 6, position: 'center', fields: { text: 'Heading (optional)', items: 'Points, one per line (up to 6)' }, example: { text: 'Before you post', items: ['Hook in 2 seconds', 'Captions on', 'No music'] } },
  chart: { label: 'Bar chart', hint: 'Bars that grow to the numbers said; compare a few things', seconds: 5, position: 'center', fields: { text: 'Title (optional)', items: 'One bar per line as “Name: number” (up to 6)' }, example: { text: 'Views per video', items: ['Before: 800', 'After: 12000'] } },
  wall: { label: 'Headline wall', hint: 'A stack of headlines or comments that pile in: proof, or the noise around a topic', seconds: 5, position: 'center', fields: { text: 'Small line above (optional)', items: 'One headline per line (up to 6)' }, example: { text: 'They said', items: ['It will never work', 'Nobody wants this', 'Too late to start'] } },
  kinetic: { label: 'Word slam', hint: 'A phrase slammed in word by word, full screen', seconds: 2.2, position: null, fields: { text: 'The phrase (*word* for the accent colour)' }, example: { text: 'Stop *guessing*' } },
  versus: { label: 'Versus', hint: 'Two sides face off with a VS slam: this or that, the old way against the new', seconds: 3.5, position: 'center', fields: { text: 'Left side', sub: 'Right side' }, example: { text: 'Posting daily', sub: 'Posting *better*' } },
  timeline: { label: 'Timeline', hint: 'Moments in order on a line that lights up: a story, a history, a journey', seconds: 6, position: 'center', fields: { text: 'Heading (optional)', items: 'One moment per line as “When: what happened” (up to 6)' }, example: { text: 'How it went', items: ['2021: First video', '2023: 10k followers', '2025: Full time'] } },
  ranking: { label: 'Countdown', hint: 'A ranked list revealed from last place up to #1: top 3, top 5', seconds: 6, position: 'center', fields: { text: 'Heading (optional)', items: 'Ranked, #1 first, one per line (up to 6)' }, example: { text: 'Best habits', items: ['Sleep', 'Walking', 'Reading'] } },
  steps: { label: 'Steps', hint: 'How-to steps shown one at a time along a progress line', seconds: 6, position: 'center', fields: { text: 'Heading (optional)', items: 'Steps, one per line (up to 6)' }, example: { text: 'How to start', items: ['Pick one topic', 'Post for 30 days', 'Keep what works'] } },
  compare: { label: 'Pros & cons', hint: 'Two columns that fill point by point: pros and cons, or any two-sided comparison', seconds: 6, position: 'center', fields: { text: 'Heading (optional)', sub: 'Column names (optional, e.g. Pros | Cons)', items: 'One per line, “+” for the left column, “-” for the right (up to 6)' }, example: { text: 'Posting daily', items: ['+ Fast feedback', '+ Builds the habit', '- Easy to burn out', '- Quality can slip'] } },
  ring: { label: 'Percent ring', hint: 'A ring that fills while the number counts: a share, a rate, a completion', seconds: 3, position: 'center', fields: { text: 'The number (e.g. 73% or 3/4)', sub: 'What it is' }, example: { text: '73%', sub: 'quit in the first year' } },
  rating: { label: 'Star rating', hint: 'Stars that fill to a score: a review, a verdict', seconds: 3, position: 'center', fields: { text: 'The score (e.g. 4.5 or 8/10)', sub: 'What’s rated' }, example: { text: '4.5', sub: 'Worth the hype' } },
  price: { label: 'Price drop', hint: 'An old price struck through, then the new one slams in: a deal, a cost, a saving', seconds: 3, position: 'center', fields: { text: 'New price', sub: 'Old price (optional)' }, example: { text: '$49', sub: '$199' } },
  comment: { label: 'Comment', hint: 'A viewer’s comment as a reply bubble: answering a comment or question', seconds: 4, position: 'center', fields: { text: 'The comment', sub: 'Who wrote it (e.g. @sam)' }, example: { text: 'How do you stay *consistent*?', sub: '@sam' } },
  notification: { label: 'Notification', hint: 'A phone notification sliding down: a message, an alert, a reminder', seconds: 3, position: 'top', fields: { text: 'Title', sub: 'Message' }, example: { text: 'Reminder', sub: 'Post today’s video' } },
  search: { label: 'Search bar', hint: 'A search typing itself out: what people look up, the question behind the video', seconds: 3.5, position: 'center', fields: { text: 'What gets typed', items: 'Suggestions under it (optional, up to 3)' }, example: { text: 'how to start a podcast', items: ['how to start a podcast for free', 'how to start a podcast with no audience'] } },
  highlight: { label: 'Highlighter', hint: 'A phrase whose key words get swiped with a marker', seconds: 3, position: 'center', fields: { text: 'The phrase (*words* get the marker; none marked = all of it)' }, example: { text: 'Consistency beats *talent*' } },
  reveal: { label: 'Blur reveal', hint: 'Words that come into focus letter by letter: a reveal, a name, a punchline', seconds: 2.5, position: 'center', fields: { text: 'The words (*word* for the accent colour)' }, example: { text: 'The *answer*' } },
  question: { label: 'Question', hint: 'A big question mark and the question the video answers', seconds: 3, position: null, fields: { text: 'The question' }, example: { text: 'Why do *most* channels quit?' } },
  definition: { label: 'Definition', hint: 'A dictionary card: a word or term and what it means', seconds: 4.5, position: 'center', fields: { text: 'The word', sub: 'What it means' }, example: { text: 'Hook', sub: 'The first two seconds that decide if anyone stays.' } },
  ticker: { label: 'News ticker', hint: 'Headlines scrolling across a strip: news, updates, the buzz around a topic', seconds: 5, position: 'bottom', fields: { sub: 'Label on the left (optional, e.g. NEW)', items: 'Headlines, one per line (up to 6)' }, example: { sub: 'New', items: ['New video every Monday', 'Part 2 is out now', 'Ask your questions below'] } },
  circle: { label: 'Circle it', hint: 'A hand-drawn circle around something on screen', seconds: 2.5, position: null, fields: { text: 'Label (optional)', point: true }, example: { text: 'This one' } },
};

/** An animated motion-graphics template, in the brand's accent colour and fonts. */
export type GraphicOverlay = OverlayBase & {
  type: 'graphic';
  template: GraphicTemplate;
  /** The main words (a name, a number, a title, a quote); *word* shows in the accent colour. */
  text: string;
  /** The second line (who they are, what the number means, who said it). */
  sub: string;
  /** A list's points. */
  items: string[];
  /** A callout's target on the frame (0–1). */
  x: number;
  y: number;
  position: GraphicPosition;
  /** Its own sound effects (a pop per point, a whoosh on a section card…), built in and non-musical. */
  sound: boolean;
};

/** A motion graphic Claude designed (shared/scene.ts): boxes, text, shapes and images with GSAP tweens, as data. */
export type SceneOverlay = OverlayBase & { type: 'scene' } & SceneSpec;

export type EditOverlay = TextOverlay | ImageOverlay | BrollOverlay | GraphicOverlay | SceneOverlay;

/** A phrase split into words, with the ones inside *stars* marked as accent. */
export function graphicWords(text: string) {
  let on = false;
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((raw) => {
      // A star opens at the start of a word (after any opening punctuation) and closes at its end (before any closing).
      if (/^[^\w*]*\*/.test(raw)) on = true;
      const word = { text: raw.replace(/\*/g, ''), accent: on };
      if (/\*[^\w*]*$/.test(raw.replace(/^[^\w*]*\*/, ''))) on = false;
      return word;
    })
    .filter((w) => w.text);
}

/** How long a big number takes to count up. */
export const statCountSeconds = (o: Pick<GraphicOverlay, 'start' | 'end'>) => Math.min(1.4, (o.end - o.start) * 0.5);

/** How long a search bar takes to type its query (it starts 0.35 s in). */
export const searchTypeSeconds = (o: Pick<GraphicOverlay, 'start' | 'end' | 'text'>) =>
  Math.min(1.6, Math.max(0.3, (o.end - o.start) * 0.45), Math.max(0.4, Array.from(o.text.replace(/\*/g, '')).length * 0.06));

/** A highlighter's marked runs of words (all of the phrase is one run when none are marked). */
export function markerRuns(text: string) {
  const words = graphicWords(text);
  const any = words.some((w) => w.accent);
  if (!any) return words.length ? 1 : 0;
  return words.filter((w, k) => w.accent && !(k > 0 && words[k - 1].accent)).length;
}
/** When a highlighter's marker `k` swipes, seconds into it. */
export const markerAt = (o: Pick<GraphicOverlay, 'start' | 'end'>, k: number) => Math.min(0.4 + k * 0.35, Math.max(0.2, o.end - o.start - 0.8));

/** A star rating's score as stars out of five: "4.5" → 4.5, "8/10" → 4, "92%" → 4.6. */
export function ratingStars(text: string) {
  const m = /(\d+(?:[.,]\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?)|(%))?/.exec(text);
  if (!m) return 0;
  const v = Number(m[1].replace(',', '.'));
  const max = m[2] ? Number(m[2]) : m[3] ? 100 : v <= 5 ? 5 : v <= 10 ? 10 : 100;
  return Math.max(0, Math.min(5, (v / (max || 5)) * 5));
}
/** The gap between a star rating's stars filling (the first fills 0.35 s in). */
export const ratingStep = (o: Pick<GraphicOverlay, 'start' | 'end'>) => Math.min(0.18, Math.max(0.06, ((o.end - o.start) * 0.5) / 5));

/** When a versus card's sides and badge come in, and when a price drop's new price lands, seconds into it. */
export const VERSUS_AT = { right: 0.18, badge: 0.45 };
export const priceNewAt = (o: Pick<GraphicOverlay, 'sub'>) => (o.sub.trim() ? 0.75 : 0.1);
/** When a comment's like pops, seconds into it. */
export const commentLikeAt = (o: Pick<GraphicOverlay, 'start' | 'end' | 'text'>) => Math.min(Math.max(0.3, o.end - o.start - 0.6), 0.45 + graphicWords(o.text).length * 0.04);

/** When a graphic's parts come in (seconds on the finished video): a list's points, slammed words. */
export function graphicBeats(o: GraphicOverlay): number[] {
  const len = o.end - o.start;
  if (['list', 'checklist', 'wall', 'chart', 'timeline', 'ranking', 'steps', 'compare'].includes(o.template)) {
    const step = Math.min(1.2, Math.max(0.35, (len - 1.2) / Math.max(1, o.items.length)));
    return o.items.map((_, k) => round(o.start + 0.45 + k * step));
  }
  if (o.template === 'kinetic') {
    const words = graphicWords(o.text);
    const step = Math.min(0.4, (len * 0.6) / Math.max(1, words.length));
    return words.map((_, k) => round(o.start + 0.15 + k * step));
  }
  return [];
}

/** A format video's own sounds: a pop as each text message lands (a swish for sent ones), a pop for a story's card. */
export function recipeSounds(spec: Pick<EditSpec, 'recipe'>): SfxCue[] {
  const r = spec.recipe;
  if (!r) return [];
  if (r.kind === 'chat')
    return r.messages.filter((m) => m.end > m.at).map((m, k) => ({ id: `r-${k}`, mediaId: builtinSfxId(m.from === 'me' ? 'swish' : 'pop-high'), at: round(m.at), volume: 0.5 }));
  if (r.kind === 'story' && r.titleEnd > 0.3) return [{ id: 'r-card', mediaId: builtinSfxId('pop'), at: 0, volume: 0.5 }];
  return [];
}

/** The built-in sounds of graphics that have `sound` on. */
export function graphicSounds(spec: Pick<EditSpec, 'overlays'>): SfxCue[] {
  const cues: SfxCue[] = [];
  const cue = (o: GraphicOverlay, k: number, name: string, at: number, volume = 0.6) => cues.push({ id: `g-${o.id}-${k}`, mediaId: builtinSfxId(name), at: round(Math.max(0, at)), volume });
  for (const o of spec.overlays) {
    if (o.type !== 'graphic' || !o.sound) continue;
    const beats = graphicBeats(o);
    switch (o.template) {
      case 'lowerThird':
        cue(o, 0, 'swish', o.start + 0.05);
        break;
      case 'stat':
        cue(o, 0, 'pop', o.start);
        cue(o, 1, 'ding-glass', o.start + statCountSeconds(o), 0.5);
        break;
      case 'list':
      case 'checklist':
      case 'wall':
        beats.forEach((t, k) => cue(o, k, 'pop-high', t));
        break;
      case 'chart':
        cue(o, 0, 'whoosh-soft', o.start, 0.4);
        if (beats.length) cue(o, 1, 'ding-glass', beats[beats.length - 1] + 0.7, 0.5);
        break;
      case 'quote':
        cue(o, 0, 'whoosh-soft', o.start - 0.1, 0.5);
        break;
      case 'callout':
        cue(o, 0, 'pop', o.start);
        cue(o, 1, 'pop-high', o.start + 0.4, 0.5);
        break;
      case 'chapter':
        cue(o, 0, 'whoosh-heavy', o.start - 0.15, 0.55);
        break;
      case 'cta':
        cue(o, 0, 'bloop', o.start + 0.05);
        break;
      case 'kinetic':
        beats.forEach((t, k) => cue(o, k, 'knock', t, 0.5));
        break;
      case 'versus':
        cue(o, 0, 'whoosh-fast', o.start - 0.05, 0.45);
        cue(o, 1, 'swish', o.start + VERSUS_AT.right, 0.5);
        cue(o, 2, 'slam', o.start + VERSUS_AT.badge + 0.2, 0.55);
        break;
      case 'timeline':
      case 'compare':
        beats.forEach((t, k) => cue(o, k, 'pop-high', t, 0.5));
        break;
      case 'ranking':
        beats.forEach((t, k) => cue(o, k, k === beats.length - 1 ? 'hit' : 'knock', t, 0.5));
        if (beats.length) cue(o, beats.length, 'ding-glass', beats[beats.length - 1] + 0.3, 0.45);
        break;
      case 'steps':
        beats.forEach((t, k) => cue(o, k, 'click', t, 0.55));
        break;
      case 'ring':
        cue(o, 0, 'pop', o.start);
        cue(o, 1, 'ding-glass', o.start + 0.1 + statCountSeconds(o), 0.5);
        break;
      case 'rating': {
        const step = ratingStep(o);
        for (let k = 0; k < Math.ceil(ratingStars(o.text)); k++) cue(o, k, 'tick', o.start + 0.35 + k * step, 0.5);
        cue(o, 5, 'ding-glass', o.start + 0.35 + 5 * step + 0.1, 0.45);
        break;
      }
      case 'price':
        if (o.sub.trim()) cue(o, 0, 'swish', o.start + 0.35, 0.5);
        cue(o, 1, 'hit', o.start + priceNewAt(o) + 0.2, 0.55);
        break;
      case 'comment':
        cue(o, 0, 'pop', o.start);
        cue(o, 1, 'pop-high', o.start + commentLikeAt(o), 0.45);
        break;
      case 'notification':
        cue(o, 0, 'ping', o.start + 0.1, 0.5);
        break;
      case 'search':
        cue(o, 0, 'typing', o.start + 0.35, 0.5);
        cue(o, 1, 'click', o.start + 0.45 + searchTypeSeconds(o), 0.5);
        break;
      case 'highlight':
        for (let k = 0; k < markerRuns(o.text); k++) cue(o, k, 'swish', o.start + markerAt(o, k), 0.5);
        break;
      case 'reveal':
        cue(o, 0, 'whoosh-soft', o.start - 0.1, 0.45);
        break;
      case 'question':
        cue(o, 0, 'thud', o.start + 0.25, 0.55);
        break;
      case 'definition':
        cue(o, 0, 'swish', o.start + 0.05, 0.5);
        cue(o, 1, 'pop-high', o.start + 0.55, 0.4);
        break;
      case 'ticker':
        cue(o, 0, 'whoosh-soft', o.start - 0.05, 0.4);
        break;
      case 'circle':
        cue(o, 0, 'swish', o.start + 0.05, 0.55);
        break;
    }
  }
  return cues;
}

/** `mediaId` is a sound-effect asset or one of the app's own sounds (`builtin:<name>`, shared/sfx.ts). */
export type SfxCue = { id: string; mediaId: string; at: number; volume: number };

/**
 * A vocal-only nasheed under the video. There's no music track: this is the only one an edit can have, only the
 * creator sets it (edits Claude saves keep whatever was there), and it plays only nasheed assets.
 */
export type NasheedTrack = {
  mediaId: string;
  /** Where in the nasheed to start, in seconds. */
  start: number;
  volume: number;
  /** Lower it while someone speaks. */
  duck: boolean;
};

/**
 * Narration from the start of the video: speech made on this computer (a format video's voices) or a voice memo the
 * creator recorded — never an uploaded track, so music can't come in this way. Its words become the captions.
 */
export type VoiceoverTrack = { mediaId: string; volume: number };

export type EditAudio = {
  nasheed: NasheedTrack | null;
  voiceover: VoiceoverTrack | null;
  /** Level of all clip sound. */
  voiceVolume: number;
  /** Rumble cut, gentle compression and presence on the clip sound. */
  enhanceVoice: boolean;
  /** Normalise the final mix to −14 LUFS, what TikTok, Instagram and YouTube play at. */
  normalize: boolean;
  sfx: SfxCue[];
  /** A sound effect on the frame of every move that has none (shared/sound-design.ts). */
  autoSfx: boolean;
};

/** A LUT (graded with FFmpeg), a colour look over the footage and film textures over the whole video. */
export type EditGrade = { lutMediaId: string | null; intensity: number; filter: FilterLook; textures: Textures };
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
  /** A format video's words and voices (shared/recipe.ts); null for a filmed edit. */
  recipe: Recipe | null;
  /** The content model: what the hook promises and where it's paid (shared/quality.ts checks it before render). */
  story: EditStory;
};

/** Every video has a hook (a promise), content that builds toward it and a payoff: named here, checked before render. */
export type EditStory = {
  /** What the first 1–3 s promise the viewer. */
  promise: string;
  /** What they get for staying: the answer, the reveal, the result. */
  payoff: string;
  /** The second on the finished video where it lands; null = not placed yet. */
  payoffAt: number | null;
};
export const STORY_TEXT_MAX = 300;

/** The reusable look of a brand's videos, saved per workspace. Never a nasheed: that's agreed edit by edit. */
export type EditTemplate = {
  format: EditFormat;
  captions: CaptionSettings;
  grade: EditGrade;
  watermark: Watermark;
  audio: Omit<EditAudio, 'sfx' | 'nasheed' | 'voiceover'>;
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
      font: null,
    },
    overlays: [],
    audio: { nasheed: null, voiceover: null, voiceVolume: 1, enhanceVoice: false, normalize: true, sfx: [], autoSfx: true },
    grade: { lutMediaId: null, intensity: 1, filter: 'none', textures: { ...NO_TEXTURES } },
    watermark: { mediaId: null, corner: 'tr', opacity: 0.85, size: 0.16 },
    recipe: null,
    story: { promise: '', payoff: '', payoffAt: null },
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
    font: c.font === undefined ? base.font : bundledFamily(c.font),
  };
}

export const NASHEED_DEFAULTS = { start: 0, volume: 0.25, duck: true };

function normalizeNasheed(input: unknown): NasheedTrack | null {
  const n = obj(input);
  if (typeof n.mediaId !== 'string' || !n.mediaId) return null;
  return {
    mediaId: n.mediaId,
    start: round(num(n.start, NASHEED_DEFAULTS.start, 0)),
    volume: round(num(n.volume, NASHEED_DEFAULTS.volume, 0, 1)),
    duck: typeof n.duck === 'boolean' ? n.duck : NASHEED_DEFAULTS.duck,
  };
}

/** Older edits had a music track (musicMediaId…): it's dropped, never carried over. */
function normalizeAudio(input: unknown, base = emptyEdit().audio): EditAudio {
  const a = obj(input);
  const vo = obj(a.voiceover);
  return {
    nasheed: a.nasheed === undefined ? base.nasheed : normalizeNasheed(a.nasheed),
    voiceover: a.voiceover === undefined ? base.voiceover : typeof vo.mediaId === 'string' && vo.mediaId ? { mediaId: vo.mediaId, volume: round(num(vo.volume, 1, 0, 2)) } : null,
    voiceVolume: round(num(a.voiceVolume, base.voiceVolume, 0, 2)),
    enhanceVoice: typeof a.enhanceVoice === 'boolean' ? a.enhanceVoice : base.enhanceVoice,
    normalize: typeof a.normalize === 'boolean' ? a.normalize : base.normalize,
    autoSfx: typeof a.autoSfx === 'boolean' ? a.autoSfx : base.autoSfx,
    sfx: list(a.sfx ?? base.sfx)
      .filter((s) => typeof s.mediaId === 'string')
      .map((s) => ({ id: str(s.id, '') || newEditId(), mediaId: s.mediaId as string, at: round(num(s.at, 0, 0)), volume: round(num(s.volume, 0.8, 0, 2)) })),
  };
}

function normalizeGrade(input: unknown, base = emptyEdit().grade): EditGrade {
  const g = obj(input);
  const t = obj(g.textures);
  const bt = base.textures;
  const amount = (k: 'grain' | 'vignette' | 'scanlines' | 'leak') => round(num(t[k], bt[k], 0, 1));
  return {
    lutMediaId: g.lutMediaId === undefined ? base.lutMediaId : idOrNull(g.lutMediaId),
    intensity: round(num(g.intensity, base.intensity, 0, 1)),
    filter: oneOf(g.filter, FILTER_LOOKS, base.filter),
    textures: {
      grain: amount('grain'),
      vignette: amount('vignette'),
      scanlines: amount('scanlines'),
      leak: amount('leak'),
      letterbox: typeof t.letterbox === 'boolean' ? t.letterbox : bt.letterbox,
      border: round(num(t.border, bt.border, 0, 0.06)),
    },
  };
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

function normalizeTransition(input: unknown): ClipTransition | null {
  const t = obj(input);
  if (!TRANSITIONS.includes(t.type as TransitionType)) return null;
  const type = t.type as TransitionType;
  return { type, duration: round(num(t.duration, TRANSITION_INFO[type].duration, TRANSITION_MIN, TRANSITION_MAX)), sound: typeof t.sound === 'boolean' ? t.sound : false };
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
    transition: normalizeTransition(input.transition),
    motion: oneOf(input.motion, CLIP_MOTIONS, 'none'),
    filter: FILTER_LOOKS.includes(input.filter as FilterLook) ? (input.filter as FilterLook) : null,
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
    case 'graphic': {
      if (!GRAPHICS.includes(input.template as GraphicTemplate)) return null;
      const template = input.template as GraphicTemplate;
      const items = (Array.isArray(input.items) ? input.items : []).filter((i): i is string => typeof i === 'string').map((i) => i.trim().slice(0, 120)).filter(Boolean).slice(0, 6);
      return {
        ...base,
        type: 'graphic',
        template,
        text: str(input.text, '').slice(0, 300),
        sub: str(input.sub, '').slice(0, 200),
        items,
        x: round(num(input.x, 0.5, 0, 1)),
        y: round(num(input.y, 0.5, 0, 1)),
        position: oneOf(input.position, ['top', 'center', 'bottom'] as const, GRAPHIC_INFO[template].position ?? 'center'),
        sound: typeof input.sound === 'boolean' ? input.sound : true,
      };
    }
    case 'scene': {
      const end = Math.min(base.end, base.start + sceneMaxSeconds(input.preset));
      return { ...base, end, type: 'scene', ...normalizeScene(input, end - base.start) };
    }
    case 'broll':
      if (typeof input.mediaId !== 'string') return null;
      return {
        ...base,
        type: 'broll',
        mediaId: input.mediaId,
        in: round(num(input.in, 0, 0)),
        layout: oneOf(input.layout, BROLL_LAYOUTS, 'full'),
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
  return fitLibraryScenes({
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
    recipe: normalizeRecipe(e.recipe),
    story: normalizeStory(e.story),
  });
}

/** Library scenes built again for the edit as it is now: their length, the frame and the accent colour. */
export function fitLibraryScenes(spec: EditSpec): EditSpec {
  if (!spec.overlays.some((o) => o.type === 'scene' && o.preset)) return spec;
  const { width: W, height: H } = EDIT_FORMATS[spec.format];
  const frame = { W, H, color: spec.captions.highlight };
  return { ...spec, overlays: spec.overlays.map((o) => (o.type === 'scene' ? refitScene(o, frame) : o)) };
}

function normalizeStory(input: unknown): EditStory {
  const s = obj(input);
  const at = s.payoffAt;
  return {
    promise: str(s.promise, '').trim().slice(0, STORY_TEXT_MAX),
    payoff: str(s.payoff, '').trim().slice(0, STORY_TEXT_MAX),
    payoffAt: typeof at === 'number' && Number.isFinite(at) && at >= 0 ? round(Math.min(at, EDIT_MAX_SECONDS)) : null,
  };
}

export function templateFromEdit(spec: EditSpec): EditTemplate {
  const { sfx: _sfx, nasheed: _nasheed, voiceover: _voiceover, ...audio } = spec.audio;
  return { format: spec.format, captions: spec.captions, grade: spec.grade, watermark: spec.watermark, audio };
}

export function normalizeTemplate(input: unknown): EditTemplate {
  const t = obj(input);
  return templateFromEdit(normalizeEdit({ ...t, audio: { ...obj(t.audio), sfx: [], nasheed: null, voiceover: null } }));
}

/** Apply a brand template's look to an edit, keeping its footage, overlays, nasheed, voiceover and sound effects. */
export function applyTemplate(spec: EditSpec, template: EditTemplate): EditSpec {
  return normalizeEdit({
    ...spec,
    format: template.format,
    captions: template.captions,
    grade: template.grade,
    watermark: template.watermark,
    audio: { ...template.audio, nasheed: spec.audio.nasheed, voiceover: spec.audio.voiceover, sfx: spec.audio.sfx },
  });
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

/** A transition's window on the finished video: the cut at `at`, the pictures overlapping from `start` to `end`. */
export type TransitionWindow = { index: number; type: TransitionType; start: number; end: number; at: number; sound: boolean };

/**
 * Where each transition plays. Half of it sits either side of the cut, never more than 45 % of either clip, so two
 * transitions around a short clip can't overlap.
 */
export function transitionWindows(spec: Pick<EditSpec, 'clips'>): TransitionWindow[] {
  const starts = clipStarts(spec);
  const out: TransitionWindow[] = [];
  spec.clips.forEach((c, j) => {
    if (j === 0 || !c.transition) return;
    const half = Math.min(c.transition.duration / 2, clipLength(spec.clips[j - 1]) * 0.45, clipLength(c) * 0.45);
    if (half < 0.04) return;
    out.push({ index: j, type: c.transition.type, start: round(starts[j] - half), end: round(starts[j] + half), at: round(starts[j]), sound: c.transition.sound });
  });
  return out;
}

/** How much source each clip needs past its in and out points for the transitions around it (seconds). */
export function transitionHandles(spec: Pick<EditSpec, 'clips'>) {
  const handles = spec.clips.map(() => ({ before: 0, after: 0 }));
  for (const w of transitionWindows(spec)) {
    handles[w.index].before = w.at - w.start;
    handles[w.index - 1].after = w.end - w.at;
  }
  return handles;
}

/** The built-in sounds of transitions that have `sound` on, as cues on the finished video. */
export function transitionSounds(spec: Pick<EditSpec, 'clips'>): SfxCue[] {
  return transitionWindows(spec)
    .filter((w) => w.sound)
    .map((w) => {
      const name = TRANSITION_INFO[w.type].sound;
      // Whooshes peak in their middle: centre them on the cut. Short clicks land just before it.
      const lead = name.startsWith('whoosh') || name === 'swish' ? Math.min(0.35, w.at - w.start + 0.12) : 0.06;
      return { id: `tr-${w.index}`, mediaId: builtinSfxId(name), at: round(Math.max(0, w.at - lead)), volume: 0.7 };
    });
}

/** A spoken word placed on the finished video's timeline, with where it came from. */
export type TimelineWord = { start: number; end: number; text: string; clipId: string; mediaId: string; sourceStart: number };

const cleanWord = (w: string) => w.replace(/\s+/g, ' ').trim();

/** The voiceover's place in `timelineWords` (it isn't a clip). */
export const VOICEOVER_CLIP = 'voiceover';

/**
 * Every transcribed word that survives the cuts, in output time: the main track's (muted clips say nothing) and the
 * voiceover's. A story's title is on its post card, so its words aren't captioned.
 */
export function timelineWords(
  spec: Pick<EditSpec, 'clips'> & { audio?: Pick<EditAudio, 'voiceover'>; recipe?: Recipe | null },
  transcripts: Record<string, Transcript | null | undefined>,
): TimelineWord[] {
  const starts = clipStarts(spec);
  const out: TimelineWord[] = [];
  const vo = spec.audio?.voiceover;
  const voT = vo ? transcripts[vo.mediaId] : null;
  if (vo && voT) {
    const from = spec.recipe?.kind === 'story' ? spec.recipe.titleEnd - 0.05 : 0;
    for (const seg of voT.segments)
      for (const w of seg.words ?? []) {
        const text = cleanWord(w.word);
        if (text && w.start >= from) out.push({ start: round(w.start), end: round(w.end), text, clipId: VOICEOVER_CLIP, mediaId: vo.mediaId, sourceStart: w.start });
      }
  }
  spec.clips.forEach((clip, i) => {
    const t = transcripts[clip.mediaId];
    if (!t || clip.volume === 0) return;
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
  return out.sort((a, b) => a.start - b.start);
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

/** Stretches of speech in output time (for ducking the nasheed), merging short pauses. */
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
      // Only the first piece keeps the way the clip came in.
      .forEach(([s, e], i) => out.push({ ...clip, id: i === 0 ? clip.id : newEditId(), in: round(s), out: round(e), ...(i > 0 && { transition: null }) }));
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
  clips.splice(hit.index, 1, { ...hit.clip, out: cut }, { ...hit.clip, id: newEditId(), in: cut, transition: null });
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
