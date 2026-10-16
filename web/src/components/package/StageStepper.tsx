import { ChevronRight } from 'lucide-react';
import { Fragment } from 'react';
import type { Stage } from '@shared/types';
import { cn } from '@/lib/utils';

/** Where a video is in the pipeline; a click moves it. */
export function StageStepper({ stages, current, onChange, className }: { stages: Stage[]; current: string; onChange: (stage: string) => void; className?: string }) {
  const at = stages.findIndex((s) => s.id === current);
  return (
    <ol className={cn('flex min-w-0 items-center gap-0.5 overflow-x-auto [scrollbar-width:none]', className)} aria-label="Stage">
      {stages.map((s, i) => (
        <Fragment key={s.id}>
          {i > 0 && <ChevronRight className="size-3 shrink-0 text-muted-foreground/40" aria-hidden />}
          <li className="shrink-0">
            <button
              type="button"
              onClick={() => i !== at && onChange(s.id)}
              aria-current={i === at ? 'step' : undefined}
              className={cn(
                'h-6 rounded-full px-2.5 text-xs transition-colors',
                i === at ? 'bg-brand font-medium text-white' : i < at ? 'text-foreground/80 hover:bg-accent' : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {s.name}
            </button>
          </li>
        </Fragment>
      ))}
    </ol>
  );
}
