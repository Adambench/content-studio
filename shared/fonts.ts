// Fonts that ship with the app (server/assets/fonts, Latin + Latin Extended, OFL or Apache 2.0): captions, titles,
// motion graphics and scenes use them by family name. A workspace's own brand font comes in as 'Brand'.

export type FontSubset = 'latin' | 'latin-ext' | 'arabic';
/** `subsets` names each file's characters (default Latin, then Latin Extended). */
export type StudioFont = { family: string; weight: string; files: string[]; subsets?: FontSubset[]; label: string; hint: string };

export const BUNDLED_FONTS: StudioFont[] = [
  { family: 'Montserrat', weight: '100 900', files: ['montserrat-latin-wght-normal.woff2', 'montserrat-latin-ext-wght-normal.woff2'], label: 'Montserrat', hint: 'Bold geometric sans: the default for punchy captions' },
  { family: 'Inter', weight: '100 900', files: ['inter-latin-wght-normal.woff2', 'inter-latin-ext-wght-normal.woff2'], label: 'Inter', hint: 'Neutral and very readable: subtitles, notes, UI' },
  { family: 'Anton', weight: '400', files: ['anton-latin-400-normal.woff2', 'anton-latin-ext-400-normal.woff2'], label: 'Anton', hint: 'Tall, heavy, condensed: big hook words' },
  { family: 'Bebas Neue', weight: '400', files: ['bebas-neue-latin-400-normal.woff2', 'bebas-neue-latin-ext-400-normal.woff2'], label: 'Bebas Neue', hint: 'Clean condensed capitals: titles, sports, news' },
  { family: 'Oswald', weight: '200 700', files: ['oswald-latin-wght-normal.woff2', 'oswald-latin-ext-wght-normal.woff2'], label: 'Oswald', hint: 'Condensed sans with many weights: documentary, data' },
  { family: 'Playfair Display', weight: '400 900', files: ['playfair-display-latin-wght-normal.woff2', 'playfair-display-latin-ext-wght-normal.woff2'], label: 'Playfair Display', hint: 'High-contrast serif: editorial, luxury, quotes' },
  { family: 'DM Serif Display', weight: '400', files: ['dm-serif-display-latin-400-normal.woff2', 'dm-serif-display-latin-ext-400-normal.woff2'], label: 'DM Serif Display', hint: 'Warm display serif: storytelling, lifestyle' },
  { family: 'Caveat', weight: '400 700', files: ['caveat-latin-wght-normal.woff2', 'caveat-latin-ext-wght-normal.woff2'], label: 'Caveat', hint: 'Handwriting: personal notes, annotations' },
  { family: 'Permanent Marker', weight: '400', files: ['permanent-marker-latin-400-normal.woff2'], label: 'Permanent Marker', hint: 'Thick marker strokes: raw, energetic, DIY' },
  { family: 'Bangers', weight: '400', files: ['bangers-latin-400-normal.woff2', 'bangers-latin-ext-400-normal.woff2'], label: 'Bangers', hint: 'Comic-book capitals: fun, reactions, sound words' },
  { family: 'Fredoka', weight: '300 700', files: ['fredoka-latin-wght-normal.woff2', 'fredoka-latin-ext-wght-normal.woff2'], label: 'Fredoka', hint: 'Round and friendly: kids, food, light topics' },
  { family: 'JetBrains Mono', weight: '100 800', files: ['jetbrains-mono-latin-wght-normal.woff2', 'jetbrains-mono-latin-ext-wght-normal.woff2'], label: 'JetBrains Mono', hint: 'Monospace: code, tech, typewriter text' },
  { family: 'Press Start 2P', weight: '400', files: ['press-start-2p-latin-400-normal.woff2', 'press-start-2p-latin-ext-400-normal.woff2'], label: 'Press Start 2P', hint: 'Pixel arcade letters: games, retro (use small)' },
  {
    family: 'Noto Naskh Arabic',
    weight: '400 700',
    files: ['noto-naskh-arabic-arabic-wght-normal.woff2', 'noto-naskh-arabic-latin-wght-normal.woff2', 'noto-naskh-arabic-latin-ext-wght-normal.woff2'],
    subsets: ['arabic', 'latin', 'latin-ext'],
    label: 'Noto Naskh Arabic',
    hint: 'Arabic script (ayat, du’as, names of Allah); every other font draws Arabic letters with it too',
  },
];

/** The Arabic letters' file: every other family borrows it, so Arabic never falls back to a system font. */
export const ARABIC_FONT = { family: 'Noto Naskh Arabic', file: 'noto-naskh-arabic-arabic-wght-normal.woff2' };

export const FONT_FAMILIES = BUNDLED_FONTS.map((f) => f.family);
export type FontFamily = string;

/** The bundled family a name points at (case and spacing don't matter), if any. */
export function bundledFamily(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const key = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return FONT_FAMILIES.find((f) => f.toLowerCase().replace(/[^a-z0-9]/g, '') === key) ?? null;
}
