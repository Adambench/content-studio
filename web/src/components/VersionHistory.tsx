import { useQuery } from '@tanstack/react-query';
import { GitBranchPlus, RotateCcw, Sparkles, User } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { DraftContent } from '@shared/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { api, errorMessage } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import type { Branch, Version } from '@/lib/types';
import { cn } from '@/lib/utils';
import { DiffView } from './DiffView';

export function VersionHistory({ open, onOpenChange, branch, current, onRestored, onBranch }: { open: boolean; onOpenChange: (o: boolean) => void; branch: Branch; current: DraftContent; onRestored: () => void; onBranch: (versionId: string, number: number) => void }) {
  const [selected, setSelected] = useState<string | null>(null);
  const versionId = selected ?? branch.versions[0]?.id ?? null;
  const version = useQuery({ queryKey: ['version', versionId], queryFn: () => api<Version>(`/versions/${versionId}`), enabled: !!versionId && open });
  const [busy, setBusy] = useState(false);

  async function restore() {
    if (!versionId) return;
    setBusy(true);
    try {
      const r = await api<{ number: number }>(`/versions/${versionId}/restore`, { body: {} });
      toast.success(`Restored — saved as v${r.number}`);
      onRestored();
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-3xl">
        <SheetHeader className="border-b">
          <SheetTitle>History · {branch.name}</SheetTitle>
          <SheetDescription>Compare any version with your current draft, restore it, or start a new alternative from it.</SheetDescription>
        </SheetHeader>
        <div className="grid min-h-0 flex-1 md:grid-cols-[15rem_minmax(0,1fr)]">
          <ol className="max-h-56 overflow-y-auto border-b p-2 md:max-h-none md:border-r md:border-b-0">
            {branch.versions.map((v) => (
              <li key={v.id}>
                <button type="button" onClick={() => setSelected(v.id)} className={cn('w-full rounded-md px-2.5 py-2 text-left hover:bg-accent', v.id === versionId && 'bg-accent')}>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium tabular-nums">v{v.number}</span>
                    <Badge variant="outline" className={cn('h-4 gap-1 px-1.5 text-[10px]', v.author === 'claude' && 'border-brand/40 text-brand')}>
                      {v.author === 'claude' ? <Sparkles className="size-2.5" /> : <User className="size-2.5" />}
                      {v.author === 'claude' ? 'Claude' : 'You'}
                    </Badge>
                    <span className="ml-auto text-xs text-muted-foreground">{timeAgo(v.createdAt)}</span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{v.message}</p>
                </button>
              </li>
            ))}
            {!branch.versions.length && <p className="p-3 text-sm text-muted-foreground">No saved versions yet. Use “Save version” to create one.</p>}
          </ol>
          <div className="min-h-0 overflow-y-auto p-4">
            {version.data ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="mr-auto text-sm">
                    Changes from <span className="font-medium">v{version.data.number}</span> to your current draft
                  </p>
                  <Button size="sm" variant="outline" onClick={() => onBranch(version.data!.id, version.data!.number)}>
                    <GitBranchPlus /> New alternative from here
                  </Button>
                  <Button size="sm" onClick={restore} disabled={busy}>
                    {busy ? <Spinner /> : <RotateCcw />} Restore v{version.data.number}
                  </Button>
                </div>
                <DiffView before={version.data.content} after={current} />
              </div>
            ) : versionId ? (
              <Spinner />
            ) : null}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
