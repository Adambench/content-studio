// The picture's looks and movement, as named choices: colour looks (CSS filters over the footage), camera moves on a
// clip, film textures over the whole video, b-roll layouts and how overlays come in. The server turns each into CSS
// and GSAP (server/src/studio/compose.ts); the editor and Claude pick them by name.

// ---------- colour looks ----------

export const FILTER_LOOKS = [
  'none',
  'bw',
  'noir',
  'sepia',
  'vintage',
  'warm',
  'cool',
  'vivid',
  'faded',
  'matte',
  'cinematic',
  'dreamy',
  'night',
  'sunset',
  'punchy',
  'cyber',
  'negative',
] as const;
export type FilterLook = (typeof FILTER_LOOKS)[number];

/** Each look's label, when it fits, and the CSS filter that makes it (applied over the footage, under the text). */
export const FILTER_LOOK_INFO: Record<FilterLook, { label: string; hint: string; css: string }> = {
  none: { label: 'Natural', hint: 'The footage as it is', css: 'none' },
  bw: { label: 'Black & white', hint: 'Timeless, serious, a flashback', css: 'grayscale(1) contrast(1.08)' },
  noir: { label: 'Noir', hint: 'Hard black and white: drama, a dark truth', css: 'grayscale(1) contrast(1.45) brightness(0.92)' },
  sepia: { label: 'Sepia', hint: 'Old photograph: history, “back then”', css: 'sepia(0.85) contrast(1.05) brightness(0.98)' },
  vintage: { label: 'Vintage', hint: 'Faded 70s film: nostalgia, memories', css: 'sepia(0.35) saturate(0.8) contrast(0.92) brightness(1.05) hue-rotate(-8deg)' },
  warm: { label: 'Warm', hint: 'Golden and cosy: lifestyle, food, family', css: 'sepia(0.18) saturate(1.2) brightness(1.03)' },
  cool: { label: 'Cool', hint: 'Blue and clean: tech, business, calm', css: 'saturate(0.9) hue-rotate(12deg) brightness(1.02) contrast(1.05)' },
  vivid: { label: 'Vivid', hint: 'Bright, saturated colour: travel, products', css: 'saturate(1.45) contrast(1.08)' },
  faded: { label: 'Faded', hint: 'Low-contrast, soft: aesthetic, quiet', css: 'contrast(0.82) saturate(0.75) brightness(1.08)' },
  matte: { label: 'Matte', hint: 'Lifted blacks, muted colour: modern and editorial', css: 'contrast(0.88) brightness(1.06) saturate(0.88)' },
  cinematic: { label: 'Cinematic', hint: 'Teal-leaning, contrasty film look: stories, trailers', css: 'contrast(1.15) saturate(0.85) sepia(0.12) hue-rotate(-12deg)' },
  dreamy: { label: 'Dreamy', hint: 'Soft, bright, slightly hazy: memories, calm', css: 'brightness(1.1) contrast(0.9) saturate(1.1) blur(0.6px)' },
  night: { label: 'Night', hint: 'Dark and blue: suspense, late-night talk', css: 'brightness(0.78) saturate(0.8) hue-rotate(18deg) contrast(1.1)' },
  sunset: { label: 'Sunset', hint: 'Orange-pink glow: warm endings, outdoors', css: 'sepia(0.3) saturate(1.5) hue-rotate(-18deg) brightness(1.04)' },
  punchy: { label: 'Punchy', hint: 'High contrast and colour: energy, sport, hype', css: 'contrast(1.3) saturate(1.3) brightness(1.02)' },
  cyber: { label: 'Cyber', hint: 'Magenta-cyan shift: tech, gaming, the future', css: 'hue-rotate(200deg) saturate(1.6) contrast(1.15)' },
  negative: { label: 'Negative', hint: 'Inverted colours for a beat: a twist, a shock', css: 'invert(1) hue-rotate(180deg)' },
};

// ---------- camera moves ----------

export const CLIP_MOTIONS = ['none', 'push-in', 'pull-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down', 'drift', 'punch', 'shake', 'handheld', 'tilt', 'pulse'] as const;
export type ClipMotion = (typeof CLIP_MOTIONS)[number];

export const CLIP_MOTION_INFO: Record<ClipMotion, { label: string; hint: string }> = {
  none: { label: 'Still', hint: 'No camera move (photos still get a slow push-in)' },
  'push-in': { label: 'Push in', hint: 'Slow zoom towards the subject: tension, focus, intimacy' },
  'pull-out': { label: 'Pull out', hint: 'Slow zoom back: a reveal, an ending, context' },
  'pan-left': { label: 'Pan left', hint: 'Drifts across to the left: photos, landscapes, b-roll' },
  'pan-right': { label: 'Pan right', hint: 'Drifts across to the right' },
  'pan-up': { label: 'Tilt up', hint: 'Rises up the frame: buildings, a reveal of a face' },
  'pan-down': { label: 'Tilt down', hint: 'Moves down the frame' },
  drift: { label: 'Drift', hint: 'A slow diagonal float with a slight turn: keeps a static shot alive' },
  punch: { label: 'Snap zoom', hint: 'Snaps in hard at the start, then settles: emphasis on the first word' },
  shake: { label: 'Impact shake', hint: 'A hard shake at the start: a hit, a shock, a slam' },
  handheld: { label: 'Handheld', hint: 'Gentle camera wobble all the way through: raw, vlog, documentary' },
  tilt: { label: 'Dutch tilt', hint: 'Slowly rolls off-level: unease, something is wrong' },
  pulse: { label: 'Pulse', hint: 'Breathes in and out once a second: energy without music' },
};

/** How far each camera move has the picture zoomed at the clip's start and end (server/src/studio/motion.ts draws them). */
export const MOTION_SCALE: Record<ClipMotion, [number, number]> = {
  none: [1, 1],
  'push-in': [1, 1.16],
  'pull-out': [1.16, 1],
  'pan-left': [1.15, 1.15],
  'pan-right': [1.15, 1.15],
  'pan-up': [1.15, 1.15],
  'pan-down': [1.15, 1.15],
  drift: [1.08, 1.14],
  punch: [1.28, 1],
  shake: [1.06, 1.06],
  handheld: [1.06, 1.06],
  tilt: [1.12, 1.12],
  pulse: [1, 1],
};

// ---------- textures over the whole video ----------

export type Textures = {
  /** Film grain, 0–1. */
  grain: number;
  /** Darkened corners, 0–1. */
  vignette: number;
  /** CRT / VHS lines, 0–1. */
  scanlines: number;
  /** A warm light leak drifting across, 0–1. */
  leak: number;
  /** Cinema bars top and bottom. */
  letterbox: boolean;
  /** A coloured frame around the picture, 0 = none, else its thickness as a fraction of the width (0.01–0.06). */
  border: number;
};
export const NO_TEXTURES: Textures = { grain: 0, vignette: 0, scanlines: 0, leak: 0, letterbox: false, border: 0 };

export const TEXTURE_INFO: Record<keyof Textures, { label: string; hint: string }> = {
  grain: { label: 'Film grain', hint: 'Analogue texture: cinematic, vintage, hides soft footage' },
  vignette: { label: 'Vignette', hint: 'Dark corners pull the eye to the centre' },
  scanlines: { label: 'Scanlines', hint: 'Old TV / VHS lines: retro, gaming, “found footage”' },
  leak: { label: 'Light leak', hint: 'Warm light washing across: memories, dreamy, summer' },
  letterbox: { label: 'Cinema bars', hint: 'Black bars top and bottom: a film, a trailer, a serious moment' },
  border: { label: 'Frame', hint: 'A coloured border in the accent colour: a brand frame, a scrapbook' },
};

// ---------- b-roll layouts ----------

export const BROLL_LAYOUTS = ['full', 'top', 'bottom', 'pip', 'circle', 'phone', 'card', 'split'] as const;
export type BrollLayout = (typeof BROLL_LAYOUTS)[number];
export const BROLL_LAYOUT_INFO: Record<BrollLayout, { label: string; hint: string }> = {
  full: { label: 'Full screen', hint: 'Cut away completely' },
  top: { label: 'Top half', hint: 'The speaker stays in the bottom half' },
  bottom: { label: 'Bottom half', hint: 'The speaker stays in the top half' },
  pip: { label: 'Picture in picture', hint: 'A small rounded window, top right' },
  circle: { label: 'Circle', hint: 'A round window, top right: a face, a reaction' },
  phone: { label: 'Phone', hint: 'Inside a phone in the middle: apps, screen recordings, posts' },
  card: { label: 'Tilted card', hint: 'A framed, slightly turned photo card: proof, a memory' },
  split: { label: 'Side by side', hint: 'Left half, the speaker on the right: comparisons' },
};

// ---------- overlay animations ----------

export const OVERLAY_ANIMATIONS = ['pop', 'fade', 'slide', 'drop', 'zoom', 'blur', 'bounce', 'spin', 'flip', 'wipe', 'typewriter', 'shake', 'glitch', 'float', 'pulse', 'none'] as const;
export type OverlayAnimation = (typeof OVERLAY_ANIMATIONS)[number];
export const OVERLAY_ANIMATION_INFO: Record<OverlayAnimation, { label: string; hint: string }> = {
  pop: { label: 'Pop', hint: 'Springs in from small' },
  fade: { label: 'Fade', hint: 'Fades in' },
  slide: { label: 'Slide up', hint: 'Rises in from below' },
  drop: { label: 'Drop', hint: 'Falls in from above and lands' },
  zoom: { label: 'Zoom', hint: 'Shrinks in from huge: a slam' },
  blur: { label: 'Focus', hint: 'Comes into focus from a blur' },
  bounce: { label: 'Bounce', hint: 'Bounces in, playful' },
  spin: { label: 'Spin', hint: 'Spins in' },
  flip: { label: 'Flip', hint: 'Flips round in 3D like a card' },
  wipe: { label: 'Wipe', hint: 'Revealed left to right' },
  typewriter: { label: 'Typewriter', hint: 'Types out letter by letter' },
  shake: { label: 'Shake', hint: 'Lands with a shake: an alarm, a warning' },
  glitch: { label: 'Glitch', hint: 'Stutters in digitally' },
  float: { label: 'Float', hint: 'Fades in and gently bobs while it’s up' },
  pulse: { label: 'Pulse', hint: 'Pops in and keeps pulsing: a call to action' },
  none: { label: 'None', hint: 'Just appears' },
};
