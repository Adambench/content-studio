import { Briefcase, MoonStar, Scissors, User } from 'lucide-react';
import { KIND_INFO, WORKSPACE_KINDS, type WorkspaceKind } from '@shared/types';
import { cn } from '@/lib/utils';

export const KIND_ICONS: Record<WorkspaceKind, typeof User> = { personal: User, business: Briefcase, clipping: Scissors, islamic: MoonStar };

/** The kinds of workspace as cards to pick from. */
export function KindPicker({ value, onChange, labelledBy, compact }: { value: WorkspaceKind | null; onChange: (kind: WorkspaceKind) => void; labelledBy?: string; compact?: boolean }) {
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {WORKSPACE_KINDS.map((k) => {
        const Icon = KIND_ICONS[k];
        const selected = value === k;
        return (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(k)}
            className={cn(
              'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent/60 sm:flex-col sm:gap-2',
              selected && 'border-brand/60 bg-brand-soft hover:bg-brand-soft',
            )}
          >
            <span className={cn('grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground', selected && 'bg-brand text-white')}>
              <Icon className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">{KIND_INFO[k].label}</span>
              {!compact && <span className="block text-xs text-muted-foreground">{KIND_INFO[k].hint}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
