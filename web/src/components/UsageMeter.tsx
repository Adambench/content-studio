import type { ClaudeUsage } from '@shared/types';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { resetsIn } from '@/lib/format';
import { useSettings } from '@/lib/queries';
import { cn } from '@/lib/utils';

function Bar({ value }: { value: number }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn('h-full rounded-full transition-all', pct >= 90 ? 'bg-destructive' : pct >= 70 ? 'bg-amber-400' : 'bg-brand')} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** Claude Pro usage for the current 5-hour window, as last reported by the SDK. */
export function UsageMeter({ usage: given, className }: { usage?: ClaudeUsage | null; className?: string }) {
  const { data } = useSettings();
  const usage = given ?? data?.claudeUsage;
  const five = usage?.fiveHour && usage.fiveHour.resetsAt > Date.now() ? usage.fiveHour : undefined;
  if (!usage) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn('space-y-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground', className)} tabIndex={0}>
          <div className="flex justify-between">
            <span>Claude usage</span>
            <span className="tabular-nums">{five ? `${Math.round(five.utilization * 100)}%` : '—'}</span>
          </div>
          <Bar value={five?.utilization ?? 0} />
        </div>
      </TooltipTrigger>
      <TooltipContent side="right" className="max-w-56">
        {usage.status === 'rejected' ? 'Limit reached. ' : ''}
        {five ? `Current 5-hour window resets in ${resetsIn(five.resetsAt)}.` : 'Updated after your next Claude request.'}
        {usage.sevenDay && ` Weekly: ${Math.round(usage.sevenDay.utilization * 100)}%.`}
      </TooltipContent>
    </Tooltip>
  );
}
