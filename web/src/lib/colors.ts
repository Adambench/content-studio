import type { WorkspaceColor } from '@shared/types';

/** Static class names so Tailwind can see them. */
export const COLOR_DOT: Record<WorkspaceColor, string> = {
  violet: 'bg-violet-500',
  blue: 'bg-blue-500',
  cyan: 'bg-cyan-500',
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  orange: 'bg-orange-500',
  rose: 'bg-rose-500',
  pink: 'bg-pink-500',
};

export const COLOR_SOFT: Record<WorkspaceColor, string> = {
  violet: 'bg-violet-500/15 text-violet-300',
  blue: 'bg-blue-500/15 text-blue-300',
  cyan: 'bg-cyan-500/15 text-cyan-300',
  emerald: 'bg-emerald-500/15 text-emerald-300',
  amber: 'bg-amber-500/15 text-amber-300',
  orange: 'bg-orange-500/15 text-orange-300',
  rose: 'bg-rose-500/15 text-rose-300',
  pink: 'bg-pink-500/15 text-pink-300',
};
