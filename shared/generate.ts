// Pictures and short video clips made on the home server (stable-diffusion.cpp: FLUX.1-schnell for stills, Wan 2.1
// 1.3B for clips). Halal: nothing generated shows a person or an animal, any living being. The prompt asks for an
// empty scene, a negative prompt backs it (video), and every result is looked at before it's kept (ai task
// `pictures`); a failed look is made again with a new seed. Video clips take 20–60 minutes each on a GTX 1070, so they wait for the night.

import type { BrollLayout } from './looks';

export const GEN_KINDS = ['image', 'video'] as const;
export type GenKind = (typeof GEN_KINDS)[number];

export const GEN_PURPOSES = ['broll', 'background', 'cover'] as const;
export type GenPurpose = (typeof GEN_PURPOSES)[number];
export const GEN_PURPOSE_INFO: Record<GenPurpose, { label: string; hint: string; style: string }> = {
  broll: { label: 'B-roll', hint: 'A cutaway shot that shows what’s being said', style: 'cinematic photo, natural light, shallow depth of field, sharp detail' },
  background: { label: 'Background', hint: 'A calm backdrop for text, a scene or a story video', style: 'soft, uncluttered background with empty space in the middle, gentle light, muted colours' },
  cover: { label: 'Cover', hint: 'A bold first frame with room for a title', style: 'striking, high-contrast editorial photo with a clear subject and empty space at the top for a title' },
};

export const GEN_ASPECTS = ['9:16', '16:9', '1:1'] as const;
export type GenAspect = (typeof GEN_ASPECTS)[number];
/** Sizes in pixels (multiples of 64 for FLUX, 16 for Wan; Wan 1.3B is trained at 480p). */
export const GEN_SIZES: Record<GenAspect, Record<GenKind, [number, number]>> = {
  '9:16': { image: [768, 1344], video: [480, 832] },
  '16:9': { image: [1344, 768], video: [832, 480] },
  '1:1': { image: [1024, 1024], video: [624, 624] },
};
/** Wan 2.1 makes 16 frames a second: 81 frames ≈ 5 s. */
export const VIDEO_FRAMES = 81;
export const VIDEO_FPS = 16;

export type GenerateRequest = {
  kind: GenKind;
  /** What it shows, in plain words (places, objects, nature, food, buildings, light, weather, textures, screens). */
  prompt: string;
  purpose: GenPurpose;
  aspect: GenAspect;
  /** The video it's for (it lands in that package's files). */
  pieceId: string | null;
  /** Put it into the piece's edit as b-roll from `start` to `end` (seconds) when it's made. */
  place: { start: number; end: number; layout: BrollLayout } | null;
};

/** The halal rule, as the chat is told it (prompts for the models are worded positively: see `generationPrompt`). */
export const NO_LIVING_BEINGS = 'No people, no faces, no hands, no human figures or silhouettes, no animals, birds, fish or insects. No text, letters or logos.';
/**
 * What every picture prompt ends with. Diffusion models read "no people" as a mention of people, so the prompt
 * describes an empty scene instead; the negative prompt (clips) and the check after each one do the rest.
 */
const EMPTY_SCENE = 'An empty, uninhabited scene, a still life of places and things only, clean surfaces without lettering.';
/** The video model also takes a negative prompt (FLUX.1-schnell doesn't: it runs without guidance). */
export const NEGATIVE_PROMPT =
  'people, person, human, man, woman, child, face, hands, fingers, body, silhouette, crowd, statue, doll, animal, bird, fish, insect, pet, text, letters, watermark, logo, alcohol, cigarette, nudity, blurry, low quality, distorted';

export function generationPrompt(r: Pick<GenerateRequest, 'prompt' | 'purpose' | 'kind'>) {
  const motion = r.kind === 'video' ? ' Slow, smooth camera movement; the scene moves gently.' : '';
  return `${r.prompt.trim().replace(/\s+/g, ' ').replace(/\.$/, '')}. ${GEN_PURPOSE_INFO[r.purpose].style}.${motion} ${EMPTY_SCENE}`;
}

export type GenerationSettings = {
  /** Video clips run between these hours (local time, 0–23; from > to wraps past midnight). */
  videoFrom: number;
  videoTo: number;
};
export const DEFAULT_GENERATION: GenerationSettings = { videoFrom: 23, videoTo: 7 };

export function inVideoWindow(s: GenerationSettings, at = new Date()) {
  const h = at.getHours();
  if (s.videoFrom === s.videoTo) return true;
  return s.videoFrom < s.videoTo ? h >= s.videoFrom && h < s.videoTo : h >= s.videoFrom || h < s.videoTo;
}

/** Milliseconds until the window opens (0 when it's open). */
export function msUntilVideoWindow(s: GenerationSettings, at = new Date()) {
  if (inVideoWindow(s, at)) return 0;
  const next = new Date(at);
  next.setMinutes(0, 0, 0);
  next.setHours(s.videoFrom);
  if (next <= at) next.setDate(next.getDate() + 1);
  return next.getTime() - at.getTime();
}
