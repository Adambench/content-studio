// The app's own sound effects (server/assets/sfx, built by server/scripts/make-sfx.py): non-musical, CC0 or made
// here, shared by every workspace. A sound-effect cue points at one as `builtin:<name>` instead of a library file.

export const BUILTIN_SFX_PREFIX = 'builtin:';

export const SFX_GROUPS = {
  transition: 'Transitions',
  buildup: 'Build-ups',
  impact: 'Impacts',
  pop: 'Pops',
  click: 'Clicks',
  ding: 'Dings',
  glitch: 'Glitches',
} as const;
export type SfxGroup = keyof typeof SFX_GROUPS;

export type BuiltinSfx = { name: string; label: string; use: string; group: SfxGroup; seconds: number };

export const BUILTIN_SFX: BuiltinSfx[] = [
  { name: 'whoosh-fast', group: 'transition', label: 'Whoosh, fast', use: 'A quick cut, a zoom or a punch-in', seconds: 0.42 },
  { name: 'whoosh-soft', group: 'transition', label: 'Whoosh, soft', use: 'A gentle change of scene or topic', seconds: 0.85 },
  { name: 'whoosh-heavy', group: 'transition', label: 'Whoosh, heavy', use: 'A big transition, a b-roll cutaway', seconds: 1 },
  { name: 'swish', group: 'transition', label: 'Swish', use: 'Text or a sticker sliding in', seconds: 0.24 },
  { name: 'whoosh-reverse', group: 'transition', label: 'Reverse whoosh', use: 'Sucks in just before a cut or a reveal', seconds: 0.9 },
  { name: 'riser-short', group: 'buildup', label: 'Riser, short', use: 'One second of build-up into a reveal', seconds: 1.2 },
  { name: 'riser-long', group: 'buildup', label: 'Riser, long', use: 'Tension before the payoff', seconds: 2.6 },
  { name: 'riser-tonal', group: 'buildup', label: 'Sweep up', use: 'A rising sweep into a number or a punchline', seconds: 1.8 },
  { name: 'boom', group: 'impact', label: 'Boom', use: 'The big reveal, the hook card landing', seconds: 1.8 },
  { name: 'boom-short', group: 'impact', label: 'Boom, short', use: 'A stat or a word that hits hard', seconds: 0.9 },
  { name: 'hit', group: 'impact', label: 'Hit', use: 'Punches in a key word', seconds: 0.65 },
  { name: 'thud', group: 'impact', label: 'Thud', use: 'Something dropping into place', seconds: 0.53 },
  { name: 'knock', group: 'impact', label: 'Knock', use: 'A dry wooden knock on a cut', seconds: 0.33 },
  { name: 'slam', group: 'impact', label: 'Slam', use: 'A metallic slam: “no”, “stop”, a hard truth', seconds: 0.49 },
  { name: 'pop', group: 'pop', label: 'Pop', use: 'Text, an emoji or a sticker popping in', seconds: 0.12 },
  { name: 'pop-high', group: 'pop', label: 'Pop, light', use: 'Small labels and list items', seconds: 0.09 },
  { name: 'bloop', group: 'pop', label: 'Bloop', use: 'A playful drop for light moments', seconds: 0.19 },
  { name: 'click', group: 'click', label: 'Click', use: 'Pressing a button on screen', seconds: 0.1 },
  { name: 'click-soft', group: 'click', label: 'Click, soft', use: 'Quiet steps through a list', seconds: 0.09 },
  { name: 'mouse-click', group: 'click', label: 'Mouse click', use: 'Screen recordings and demos', seconds: 0.06 },
  { name: 'tick', group: 'click', label: 'Tick', use: 'Counting up or ticking items off', seconds: 0.04 },
  { name: 'toggle', group: 'click', label: 'Toggle', use: 'Before/after, switching something on', seconds: 0.14 },
  { name: 'typing', group: 'click', label: 'Typing', use: 'Text typing itself out', seconds: 1.1 },
  { name: 'shutter', group: 'click', label: 'Camera shutter', use: 'A freeze frame or a photo', seconds: 0.32 },
  { name: 'scroll', group: 'click', label: 'Scroll', use: 'Scrolling a feed or a page', seconds: 1 },
  { name: 'ding', group: 'ding', label: 'Ding', use: 'A highlight, the right answer, a lesson', seconds: 1.6 },
  { name: 'ping', group: 'ding', label: 'Ping', use: 'A small highlight or a notification', seconds: 0.7 },
  { name: 'ding-glass', group: 'ding', label: 'Glass clink', use: 'A light, bright accent', seconds: 0.28 },
  { name: 'glitch', group: 'glitch', label: 'Glitch', use: 'A digital stutter on a jump cut', seconds: 0.35 },
  { name: 'static', group: 'glitch', label: 'Static', use: 'A TV-static burst between scenes', seconds: 0.6 },
  { name: 'buzzer', group: 'glitch', label: 'Buzzer', use: 'Wrong answer, a myth busted', seconds: 0.5 },
];

const BY_NAME = new Map(BUILTIN_SFX.map((s) => [s.name, s]));

export const builtinSfxId = (name: string) => `${BUILTIN_SFX_PREFIX}${name}`;
export const isBuiltinSfx = (id: string) => id.startsWith(BUILTIN_SFX_PREFIX);
/** The built-in sound an id points at, if it's one. */
export const builtinSfx = (id: string) => (isBuiltinSfx(id) ? BY_NAME.get(id.slice(BUILTIN_SFX_PREFIX.length)) : undefined);
