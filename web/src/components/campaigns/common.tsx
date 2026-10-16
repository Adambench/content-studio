import { CircleCheck, Film, FolderOpen, HardDriveUpload, Link2, ShieldAlert, ShieldX, Tv } from 'lucide-react';
import { CAMPAIGN_STATUS_LABELS, HALAL_LABELS, money, type CampaignStatus, type HalalVerdict, type SourceKind } from '@shared/campaigns';
import { PlatformIcon } from '@/components/publish/common';
import { WorkspaceDot } from '@/components/WorkspaceDot';
import { Badge } from '@/components/ui/badge';
import { Toggle } from '@/components/ui/toggle';
import type { Workspace } from '@/lib/types';
import { cn } from '@/lib/utils';

export function HalalBadge({ verdict, className }: { verdict: HalalVerdict | null; className?: string }) {
  if (!verdict) return null;
  if (verdict === 'ok')
    return (
      <Badge variant="secondary" className={cn('gap-1 text-emerald-400', className)}>
        <CircleCheck /> Halal check passed
      </Badge>
    );
  if (verdict === 'flag')
    return (
      <Badge variant="secondary" className={cn('gap-1 text-amber-400', className)}>
        <ShieldAlert /> {HALAL_LABELS.flag}
      </Badge>
    );
  return (
    <Badge variant="destructive" className={cn('gap-1', className)}>
      <ShieldX /> {HALAL_LABELS.reject}
    </Badge>
  );
}

export function StatusBadge({ status, reading, rejected, className }: { status: CampaignStatus; reading?: boolean; rejected?: boolean; className?: string }) {
  if (rejected && status === 'to_confirm' && !reading) return null;
  if (reading || status === 'reading')
    return (
      <Badge variant="secondary" className={className}>
        Reading…
      </Badge>
    );
  return (
    <Badge variant={status === 'to_confirm' ? 'default' : status === 'active' ? 'secondary' : 'outline'} className={cn(status === 'to_confirm' && 'bg-brand text-white', className)}>
      {CAMPAIGN_STATUS_LABELS[status]}
    </Badge>
  );
}

/** How much of the budget is left, as a bar. */
export function BudgetBar({ left, total, className }: { left: number | null; total: number | null; className?: string }) {
  if (left === null && total === null) return <p className={cn('text-xs text-muted-foreground', className)}>Budget not given</p>;
  const pct = left !== null && total ? Math.max(0, Math.min(100, (left / total) * 100)) : null;
  return (
    <div className={cn('space-y-1', className)}>
      <p className="text-xs text-muted-foreground">
        <span className="text-foreground tabular-nums">{money(left)}</span> left{total ? <span className="tabular-nums"> of {money(total)}</span> : null}
      </p>
      {pct !== null && (
        <div className="h-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Budget left">
          <div className={cn('h-full rounded-full', pct < 15 ? 'bg-amber-400' : 'bg-emerald-400')} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

const DAY = 86_400_000;
export function deadlineText(ms: number | null) {
  if (!ms) return null;
  const days = Math.ceil((ms - Date.now()) / DAY);
  const date = new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  if (days < 0) return `Ended ${date}`;
  if (days === 0) return `Ends today`;
  return `Ends ${date} · ${days === 1 ? 'tomorrow' : `in ${days} days`}`;
}

export function rateText(rate: number | null) {
  return rate === null ? null : `${money(rate)} / 1K views`;
}

export function PageChips({ pageIds, workspaces, className }: { pageIds: string[]; workspaces: Workspace[]; className?: string }) {
  const pages = workspaces.filter((w) => pageIds.includes(w.id));
  if (!pages.length) return null;
  return (
    <span className={cn('flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground', className)}>
      {pages.map((w) => (
        <span key={w.id} className="inline-flex min-w-0 items-center gap-1">
          <WorkspaceDot color={w.color} className="size-2" />
          <span className="truncate">{w.name}</span>
        </span>
      ))}
    </span>
  );
}

/** Pick the pages a campaign posts on. Pages with the Campaigns module come first. */
export function PagePicker({ value, onChange, workspaces }: { value: string[]; onChange: (ids: string[]) => void; workspaces: Workspace[] }) {
  const sorted = [...workspaces].sort((a, b) => Number(b.modules.includes('campaigns')) - Number(a.modules.includes('campaigns')));
  return (
    <div className="flex flex-wrap gap-2">
      {sorted.map((w) => {
        const on = value.includes(w.id);
        return (
          <Toggle
            key={w.id}
            variant="outline"
            size="sm"
            pressed={on}
            onPressedChange={(p) => onChange(p ? [...value, w.id] : value.filter((id) => id !== w.id))}
            className={cn('gap-1.5', on && 'border-foreground/40')}
          >
            <WorkspaceDot color={w.color} className="size-2" />
            {w.name}
          </Toggle>
        );
      })}
    </div>
  );
}

export function SourceKindIcon({ kind, className }: { kind: SourceKind; className?: string }) {
  const c = cn('size-4 shrink-0 text-muted-foreground', className);
  if (kind === 'youtube') return <PlatformIcon platform="youtube" className={className} />;
  if (kind === 'twitch' || kind === 'kick') return <Tv className={c} aria-hidden />;
  if (kind === 'drive') return <FolderOpen className={c} aria-hidden />;
  if (kind === 'file') return <HardDriveUpload className={c} aria-hidden />;
  if (kind === 'link') return <Link2 className={c} aria-hidden />;
  return <Film className={c} aria-hidden />;
}
