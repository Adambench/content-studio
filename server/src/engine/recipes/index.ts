// The recipes. Each one turns what's attached to a card into a checked render; any page may use any of them, and a
// card's notes steer them. "auto" asks Claude which fits.

import type { Card } from '../../../../shared/types.ts';
import { recipeInfo } from '../../../../shared/recipes.ts';
import type { JobContext } from '../../jobs/runner.ts';

export type Recipe = {
  id: string;
  make: (ctx: JobContext, card: Card) => Promise<void>;
};

const recipes = new Map<string, Recipe>();

export function registerRecipe(r: Recipe) {
  recipes.set(r.id, r);
}

export function recipeFor(id: string): Recipe {
  const found = recipes.get(id);
  if (found) return found;
  return {
    id,
    make: async () => {
      throw new Error(`${recipeInfo(id).label} isn't built yet`);
    },
  };
}
