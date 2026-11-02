// References: videos that moved me, dropped on the Knowledge page as inspiration for a page. Each is downloaded and
// measured (server/src/knowledge/measure.ts: cuts, changes on screen, motion, sound, speech pace), then one model call
// reads how it's built and why it works, as ingredients I mark *want* or *not for me*. A page's style is written from
// what I marked across its references (`PageStyle`), and every prompt for that page follows it. Inspiration, never a
// copy: the moves and the feel, never the words.

export type ReferencePlatform = 'youtube' | 'tiktok' | 'instagram';

/** queued → measuring → drafting (the read) → done; `error` keeps whatever was measured. */
export type ReferenceStatus = 'queued' | 'measuring' | 'drafting' | 'done' | 'error';

/** Measured, never judged. Times in seconds of the video. */
export type ReferenceMeasures = {
  seconds: number;
  width: number;
  height: number;
  cuts: number[];
  cutsPerSecond: number;
  /** Everything that changes on screen: cuts, and the picture starting to move (or moving much more). */
  changes: number[];
  changesPer10: number;
  /** The longest stretch where the picture stays still. */
  longestStill: { at: number; seconds: number };
  /** Share of the video where the picture moves (0–1). */
  moving: number;
  /** How much moves, every half second (0–1). */
  motion: number[];
  /** Sound-effect hits. */
  sounds: number[];
  soundsPer10: number;
  /** Share of the changes with a sound on their frame; null with no changes. */
  soundOnChange: number | null;
  /** Share of the sounds that land on a change; null with no sounds. */
  soundsOnChanges: number | null;
  /** Where the hits were found: what isn't voice (Demucs, or a video with no speech), only the pauses in the speech, or nowhere. */
  soundsFrom: 'rest' | 'pauses' | 'none';
  /**
   * A bed in what isn't voice (Demucs' rest: an ambience, a pad, a hum, or instruments: the numbers can't tell which);
   * null when it couldn't be told.
   */
  background: 'none' | 'some' | 'bed' | null;
  /** Share of the pauses between words where the voice track still sounds (humming, voices without words); null untold. */
  voiceBed?: number | null;
  /** Music's beat (seconds between beats) when the hits fall on a steady grid; those hits aren't in `sounds`. */
  beat: number | null;
  words: number;
  wordsPerSecond: number | null;
  firstWordAt: number | null;
  /** What's said in the first 3 s. */
  firstWords: string;
  /** The first 3 s. */
  hook: { changes: number; sounds: number; firstChangeAt: number | null };
};

/**
 * What a reference is made of, one choice at a time, for me to take or leave: the idea, how the story is told, the
 * look and its quality, the voice, the words on screen, the pace, the sound, the feel.
 */
export const INGREDIENT_ASPECTS = ['idea', 'story', 'visuals', 'quality', 'voice', 'text', 'pace', 'sound', 'feel'] as const;
export type IngredientAspect = (typeof INGREDIENT_ASPECTS)[number];
export const ASPECT_LABELS: Record<IngredientAspect, string> = {
  idea: 'Idea',
  story: 'Story',
  visuals: 'Visuals',
  quality: 'Quality',
  voice: 'Voice',
  text: 'Text on screen',
  pace: 'Pace',
  sound: 'Sound',
  feel: 'Feel',
};
/** `want`: my videos take it; `skip`: not for me; null: not marked. */
export type IngredientMark = 'want' | 'skip' | null;
export type Ingredient = {
  id: string;
  aspect: IngredientAspect;
  /** A few words, e.g. "Calm illustrated night scenes". */
  name: string;
  /** How this video does it, concretely (with times where it helps). */
  what: string;
  /** What it does for the viewer. */
  why: string;
  /** The second it shows best, if one does. */
  at: number | null;
  mark: IngredientMark;
  note: string;
};

/** The model's read of it, from the numbers, the words and the frames: how it's made and why it works, never a grade. */
export type ReferenceRead = {
  summary: string;
  /** Why it moves people: the heart of it. */
  why: string;
  /** How it's built over time, in plain steps (the opening, the turn, the close). */
  shape: { at: number; what: string }[];
  /** Only what's real: something haram shown or promoted, a claim to source, instruments heard. */
  cautions: string[];
};

export type ReferenceVideo = {
  id: string;
  /** null = for every page. */
  workspaceId: string | null;
  url: string;
  platform: ReferencePlatform;
  title: string;
  channel: string;
  views: number | null;
  postedAt: number | null;
  status: ReferenceStatus;
  /** What it's doing now, while it runs. */
  step: string;
  error: string | null;
  measures: ReferenceMeasures | null;
  read: ReferenceRead | null;
  /** What's said, a line per sentence. */
  lines: { at: number; text: string }[];
  hasFrames: boolean;
  /** What it's made of, each marked by me (or not yet). */
  ingredients: Ingredient[];
  /** What moved me, in my words. */
  note: string;
  createdAt: number;
  measuredAt: number | null;
};

/** One a page has in its own videos, to set beside a reference: the same measures, from the latest edits. */
export type OwnMeasures = { videos: number; changesPer10: number | null; longestStill: number | null; soundOnChange: number | null; firstWordAt: number | null };

/** A page's style, written from what I marked on its references (and every page's), and editable by me. */
export type PageStyle = {
  workspaceId: string;
  body: string;
  status: 'idle' | 'building' | 'error';
  error: string | null;
  builtAt: number | null;
  /** References it was written from. */
  references: number;
  /** Marks, notes or references changed since it was written. */
  stale: boolean;
  /** I changed the words since it was written. */
  edited: boolean;
};
