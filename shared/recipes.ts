// The engine's recipes as the UI and the CLI see them. A recipe is a default way to make something, never a limit:
// a card on any page can use any recipe, mix them, or leave it to Claude ("auto").

import type { InputRole, VersionKind } from './types.ts';

export type RecipeInfo = {
  id: string;
  label: string;
  output: VersionKind;
  /** What it works from, in the order it asks for them. */
  wants: { role: Exclude<InputRole, null>; label: string; optional?: boolean }[];
  about: string;
};

export const RECIPES: RecipeInfo[] = [
  {
    id: 'auto',
    label: 'Auto',
    output: 'video',
    wants: [],
    about: 'Claude reads the card (script, notes, what is attached) and picks the recipe and its options.',
  },
  {
    id: 'talking-head',
    label: 'Talking head',
    output: 'video',
    wants: [
      { role: 'take', label: 'Takes' },
      { role: 'proof', label: 'Screenshots', optional: true },
      { role: 'broll', label: 'B-roll', optional: true },
    ],
    about: 'My takes cut tight on the pauses, the best take of each line, light, grade and voice fixed, captions.',
  },
  {
    id: 'voiceover',
    label: 'Voiceover',
    output: 'video',
    wants: [
      { role: 'voice', label: 'My voice' },
      { role: 'broll', label: 'Footage', optional: true },
    ],
    about: 'My recorded voice over footage, stock and drawn scenes; my face never shown.',
  },
  {
    id: 'ugc',
    label: 'UGC',
    output: 'video',
    wants: [
      { role: 'take', label: 'Takes', optional: true },
      { role: 'product', label: 'Product', optional: true },
      { role: 'broll', label: 'Product shots', optional: true },
    ],
    about: 'A product or offer sold the way people talk about it: a hook, the product in use, my words, a call to action.',
  },
  {
    id: 'carousel',
    label: 'Carousel',
    output: 'carousel',
    wants: [{ role: 'product', label: 'Products', optional: true }],
    about: 'Slides in the brand kit, one idea a slide, copy from what works in the niche.',
  },
  {
    id: 'explainer',
    label: 'Motion explainer',
    output: 'video',
    wants: [{ role: 'voice', label: 'My voice', optional: true }],
    about: 'Designed motion: kinetic type, icons, diagrams and scenes written for this video, sound on the motion.',
  },
  {
    id: 'graded',
    label: 'Graded shots',
    output: 'video',
    wants: [{ role: 'broll', label: 'Footage' }],
    about: 'Footage matched, graded to a look and finished like film, so it pops.',
  },
  {
    id: 'custom',
    label: 'Custom',
    output: 'video',
    wants: [],
    about: 'Anything no recipe covers: Claude works with every capability, guided by the notes.',
  },
];

export const recipeInfo = (id: string): RecipeInfo => RECIPES.find((r) => r.id === id) ?? RECIPES[0]!;

export const ROLE_LABEL: Record<Exclude<InputRole, null>, string> = {
  take: 'Take',
  voice: 'Voice',
  proof: 'Screenshot',
  product: 'Product',
  broll: 'B-roll',
  logo: 'Logo',
  reference: 'Reference',
};
