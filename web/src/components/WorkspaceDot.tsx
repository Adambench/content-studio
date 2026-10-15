import type { WorkspaceColor } from '@shared/types';
import { COLOR_DOT } from '@/lib/colors';
import { cn } from '@/lib/utils';

export function WorkspaceDot({ color, className }: { color: WorkspaceColor; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-2.5 shrink-0 rounded-full', COLOR_DOT[color], className)} />;
}
