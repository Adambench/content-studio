// References (phase 12 step 7): videos I paste on the Knowledge page to learn from. Each is downloaded and measured
// (server/src/knowledge/measure.ts: cuts, changes on screen, motion, sound effects and whether they land on the
// changes, speech pace, the first 3 s), then one model call reads it (the hook, the beats, the promise and its payoff)
// and drafts lessons, which land as suggested Knowledge rules for my OK. Never copied: moves, not words.

export type ReferencePlatform = 'youtube' | 'tiktok' | 'instagram';

/** queued → measuring → drafting (the lessons) → done; `error` keeps whatever was measured. */
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
  /** A bed under the voice (music or a constant ambience); null when it couldn't be told. */
  background: 'none' | 'some' | 'bed' | null;
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

export const BEAT_KINDS = ['hook', 'setup', 'build', 're-hook', 'payoff', 'cta', 'end'] as const;
export type BeatKind = (typeof BEAT_KINDS)[number];
export const BEAT_LABELS: Record<BeatKind, string> = { hook: 'Hook', setup: 'Setup', build: 'Build', 're-hook': 'Re-hook', payoff: 'Payoff', cta: 'Call to action', end: 'End' };

/** The model's read of it, from the numbers, the words and the frames. */
export type ReferenceRead = {
  summary: string;
  hook: { picture: string; words: string; text: string; why: string };
  /** The promise the opening makes, and what pays it. */
  promise: string;
  payoff: string;
  payoffAt: number | null;
  beats: { at: number; kind: BeatKind; what: string }[];
  motion: string;
  sound: string;
  /** Music, anything haram, claims to check. */
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
  /** The lessons drafted from it (Knowledge rules), whatever became of them. */
  lessons: { id: string; title: string; status: 'active' | 'proposed' | 'off' }[];
  createdAt: number;
  measuredAt: number | null;
};

/** One a page has in its own videos, to set beside a reference: the same measures, from the latest edits. */
export type OwnMeasures = { videos: number; changesPer10: number | null; longestStill: number | null; soundOnChange: number | null; firstWordAt: number | null };
