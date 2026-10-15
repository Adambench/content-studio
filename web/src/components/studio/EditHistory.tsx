import { useQuery } from '@tanstack/react-query';
import { RotateCcw, Sparkles, User } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { CAPTION_PRESET_LABELS, EDIT_FORMATS, editDuration, type EditSpec } from '@shared/edit';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { api, errorMessage } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import type { EditVersion } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useStudio } from './context';
import { preciseClock } from './controls';

/** What a version contains, in a few lines. */
function summary(spec: EditSpec, names: (id: string) => string) {
  const files = [...new Set(spec.clips.map((c) => c.mediaId))].map(names);
  return [
    `${EDIT_FORMATS[spec.format].label}, ${preciseClock(editDuration(spec))} long`,
    `${spec.clips.length} clip${spec.clips.length === 1 ? '' : 's'} from ${files.join(', ') || 'no footage'}`,
    spec.captions.enabled ? `${CAPTION_PRESET_LABELS[spec.captions.preset].label} captions` : 'No captions',
    spec.overlays.length ? `${spec.overlays.length} overlay${spec.overlays.length === 1 ? '' : 's'}` : null,
    spec.audio.nasheed ? `Nasheed: ${names(spec.audio.nasheed.mediaId)}` : null,
    spec.audio.sfx.length ? `${spec.audio.sfx.length} sound effect${spec.audio.sfx.length === 1 ? '' : 's'}` : null,
    spec.grade.lutMediaId ? `Grade: ${names(spec.grade.lutMediaId)}` : null,
  ].filter(Boolean);
}

export function EditHistory({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { edit, media, serverAction } = useStudio();
  const [selected, setSelected] = useState<string | null>(null);
  const versionId = selected ?? edit.versions[0]?.id ?? null;
  const version = useQuery({ queryKey: ['edit-version', versionId], queryFn: () => api<EditVersion>(`/edit-versions/${versionId}`), enabled: !!versionId && open });
  const [busy, setBusy] = useState(false);
  const names = (id: string) => media.get(id)?.originalName ?? 'a removed file';

  async function restore() {
    if (!versionId) return;
    setBusy(true);
    try {
      const r = await serverAction(() => api<{ number: number }>(`/edit-versions/${versionId}/restore`, { body: {} }));
      if (r) toast.success(`Restored — saved as v${r.number}`);
      onOpenChange(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-2xl">
        <SheetHeader className="border-b">
          <SheetTitle>Edit history</SheetTitle>
          <SheetDescription>Every saved version of this video — yours, Claude’s and each one you rendered. Restoring saves a new version, so nothing is lost.</SheetDescription>
        </SheetHeader>
        <div className="grid min-h-0 flex-1 md:grid-cols-[15rem_minmax(0,1fr)]">
          <ol className="max-h-56 overflow-y-auto border-b p-2 md:max-h-none md:border-r md:border-b-0">
            {edit.versions.map((v) => (
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
          </ol>
          <div className="min-h-0 overflow-y-auto p-4">
            {version.data ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <p className="mr-auto text-sm font-medium">v{version.data.number}</p>
                  <Button size="sm" onClick={restore} disabled={busy}>
                    {busy ? <Spinner /> : <RotateCcw />} Restore v{version.data.number}
                  </Button>
                </div>
                <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {summary(version.data.spec, names).map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
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
