// Format videos made from words instead of footage: a story read over background footage, a fake text conversation,
// two characters talking. The recipe (on the edit) holds what's said and by which voice; building it (the
// `format.build` job) speaks it with Kokoro on this computer, times every line, and lays out the edit around it.

/** Kokoro's English voices that read well (Kokoro's own grades), by accent. */
export const VOICES = [
  { id: 'af_heart', label: 'Heart', who: 'US woman, warm' },
  { id: 'af_bella', label: 'Bella', who: 'US woman, bright' },
  { id: 'af_nicole', label: 'Nicole', who: 'US woman, soft and close' },
  { id: 'af_sarah', label: 'Sarah', who: 'US woman, even' },
  { id: 'am_michael', label: 'Michael', who: 'US man, steady' },
  { id: 'am_fenrir', label: 'Fenrir', who: 'US man, deep' },
  { id: 'am_puck', label: 'Puck', who: 'US man, lively' },
  { id: 'am_adam', label: 'Adam', who: 'US man, plain' },
  { id: 'bf_emma', label: 'Emma', who: 'British woman' },
  { id: 'bf_isabella', label: 'Isabella', who: 'British woman, crisp' },
  { id: 'bm_george', label: 'George', who: 'British man' },
  { id: 'bm_fable', label: 'Fable', who: 'British man, storyteller' },
  // Not Kokoro: the creator's own voice, cloned from their recording (Settings → My voice) on a home PC.
  { id: 'clone', label: 'My voice', who: 'your own voice, cloned' },
] as const;
export const CLONE_VOICE = 'clone';
export type VoiceId = (typeof VOICES)[number]['id'];
const VOICE_IDS = VOICES.map((v) => v.id) as string[];
export const voiceLabel = (id: string) => {
  const v = VOICES.find((x) => x.id === id);
  return v ? `${v.label} (${v.who})` : id;
};

/** Built-in 2D characters (drawn in SVG, mouths that move with the voice). */
export const CHARACTERS = [
  { id: 'sam', label: 'Sam', hint: 'Round face, short dark hair' },
  { id: 'max', label: 'Max', hint: 'Glasses and a beard' },
  { id: 'lina', label: 'Lina', hint: 'Hijab, round face' },
  { id: 'bolt', label: 'Bolt', hint: 'A friendly robot' },
] as const;
export type CharacterId = (typeof CHARACTERS)[number]['id'];
const CHARACTER_IDS = CHARACTERS.map((c) => c.id) as string[];

/** A line on the finished video: from `at` to `end` seconds (set when the recipe is built). */
type Timed = { at: number; end: number };

export type StoryRecipe = {
  kind: 'story';
  /** Read first, on a post card (the hook). */
  title: string;
  /** The story itself. */
  text: string;
  /** Shown on the post card as who posted it. */
  author: string;
  voice: string;
  speed: number;
  /** When the title has been read: the card goes, the captions start. */
  titleEnd: number;
};

export type ChatMessage = Timed & { from: 'them' | 'me'; text: string };
export type ChatRecipe = {
  kind: 'chat';
  /** The other person's name at the top of the conversation. */
  contact: string;
  voices: { them: string; me: string };
  speed: number;
  messages: ChatMessage[];
};

export type DialogueLine = Timed & { who: 0 | 1; text: string };
export type CastMember = { name: string; look: CharacterId; voice: string };
export type DialogueRecipe = {
  kind: 'dialogue';
  cast: [CastMember, CastMember];
  speed: number;
  lines: DialogueLine[];
  /** How open the speaker's mouth is, 15 times a second over the whole voice track: digits 0–4. */
  mouth: string;
};

export type Recipe = (StoryRecipe | ChatRecipe | DialogueRecipe) & {
  /** Background footage, played muted back to back (empty = a built-in moving background). */
  backgrounds: string[];
  /** What was spoken at the last build; when the words or voices change, the voice has to be made again. */
  builtFrom: string | null;
};
export type RecipeKind = Recipe['kind'];

export const RECIPE_INFO: Record<RecipeKind, { label: string; hint: string }> = {
  story: { label: 'Story + gameplay', hint: 'A story read aloud over background footage, with big captions and a post card for the hook' },
  chat: { label: 'Fake texts', hint: 'A text conversation that plays out message by message, each one read aloud' },
  dialogue: { label: 'Talking characters', hint: 'Two drawn characters talk it out, their mouths moving with the voices' },
};

export const MESSAGE_PAUSE = 0.35;
export const LINE_PAUSE = 0.25;
export const TITLE_PAUSE = 0.6;

const round = (n: number) => Math.round(n * 1000) / 1000;
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const voice = (v: unknown, fallback: string) => (typeof v === 'string' && VOICE_IDS.includes(v) ? v : fallback);
const time = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? round(v) : 0);
const speed = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? round(Math.min(1.4, Math.max(0.7, v))) : 1.05);

export function normalizeRecipe(input: unknown): Recipe | null {
  if (!input || typeof input !== 'object') return null;
  const r = input as Record<string, unknown>;
  const common = {
    backgrounds: (Array.isArray(r.backgrounds) ? r.backgrounds : []).filter((x): x is string => typeof x === 'string' && !!x).slice(0, 10),
    builtFrom: typeof r.builtFrom === 'string' ? r.builtFrom : null,
  };
  switch (r.kind) {
    case 'story':
      return { kind: 'story', title: text(r.title, 300), text: text(r.text, 6000), author: text(r.author, 40), voice: voice(r.voice, 'am_michael'), speed: speed(r.speed), titleEnd: time(r.titleEnd), ...common };
    case 'chat': {
      const v = (r.voices && typeof r.voices === 'object' ? r.voices : {}) as Record<string, unknown>;
      const messages = (Array.isArray(r.messages) ? r.messages : [])
        .filter((m): m is Record<string, unknown> => !!m && typeof m === 'object')
        .map((m) => ({ from: m.from === 'me' ? ('me' as const) : ('them' as const), text: text(m.text, 400), at: time(m.at), end: time(m.end) }))
        .filter((m) => m.text)
        .slice(0, 60);
      return { kind: 'chat', contact: text(r.contact, 40) || 'Unknown', voices: { them: voice(v.them, 'af_heart'), me: voice(v.me, 'am_michael') }, speed: speed(r.speed), messages, ...common };
    }
    case 'dialogue': {
      const castIn = Array.isArray(r.cast) ? r.cast : [];
      const member = (m: unknown, i: number): CastMember => {
        const c = (m && typeof m === 'object' ? m : {}) as Record<string, unknown>;
        return {
          name: text(c.name, 30) || (i ? 'Max' : 'Sam'),
          look: (typeof c.look === 'string' && CHARACTER_IDS.includes(c.look) ? c.look : i ? 'max' : 'sam') as CharacterId,
          voice: voice(c.voice, i ? 'bm_george' : 'am_michael'),
        };
      };
      const lines = (Array.isArray(r.lines) ? r.lines : [])
        .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object')
        .map((l) => ({ who: l.who === 1 ? (1 as const) : (0 as const), text: text(l.text, 400), at: time(l.at), end: time(l.end) }))
        .filter((l) => l.text)
        .slice(0, 80);
      return { kind: 'dialogue', cast: [member(castIn[0], 0), member(castIn[1], 1)], speed: speed(r.speed), lines, mouth: typeof r.mouth === 'string' ? r.mouth.replace(/[^0-4]/g, '').slice(0, 15 * 600) : '', ...common };
    }
    default:
      return null;
  }
}

/** The speech a recipe makes, in order: what's read, by which voice, and the pause after it. */
export function recipeSpeech(r: Recipe): { text: string; voice: string; speed: number; pause: number }[] {
  switch (r.kind) {
    case 'story':
      return [
        { text: r.title, voice: r.voice, speed: r.speed, pause: TITLE_PAUSE },
        { text: r.text, voice: r.voice, speed: r.speed, pause: 0.5 },
      ];
    case 'chat':
      return r.messages.map((m) => ({ text: m.text, voice: r.voices[m.from], speed: r.speed, pause: MESSAGE_PAUSE }));
    case 'dialogue':
      return r.lines.map((l) => ({ text: l.text, voice: r.cast[l.who].voice, speed: r.speed, pause: LINE_PAUSE }));
  }
}

/** A fingerprint of the speech: when it differs from `builtFrom`, the voice needs making again. */
export const speechSignature = (r: Recipe) => JSON.stringify(recipeSpeech(r).map((s) => [s.text, s.voice, s.speed]));
export const recipeNeedsBuild = (r: Recipe) => r.builtFrom !== speechSignature(r);
