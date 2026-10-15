import { Camera, FolderOpen, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { MediaCard } from '@/components/MediaCard';
import { MediaDialog } from '@/components/MediaDialog';
import { PageHeader } from '@/components/PageHeader';
import { UploadButton, UploadZone } from '@/components/UploadZone';
import { useWorkspaceContext } from '@/components/WorkspaceLayout';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useNativePick, useUpload } from '@/hooks/useUpload';
import { useMedia } from '@/lib/queries';

const ACCEPT = 'video/*,image/*,audio/*';

export function LibraryPage() {
  const { workspace } = useWorkspaceContext();
  const [params, setParams] = useSearchParams();
  const [kind, setKind] = useState('');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const upload = useUpload(workspace.id);
  const pick = useNativePick(workspace.id);
  const media = useMedia(workspace.id, { scope: 'footage', kind: kind || undefined, q: debounced || undefined });

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const shared = Number(params.get('shared') ?? 0);
    if (shared) {
      toast.success(`Added ${shared} file${shared === 1 ? '' : 's'} from your phone`);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  const items = media.data ?? [];
  const searching = !!debounced || !!kind;

  return (
    <UploadZone onFiles={upload} accept={ACCEPT} className="flex h-full flex-col">
      <PageHeader
        title="Library"
        description="Footage, photos and voice memos — transcribed on this computer"
        actions={
          <>
            <span className="md:hidden">
              <UploadButton onFiles={upload} onPick={pick} accept="video/*,image/*" capture label="Camera" variant="outline" />
            </span>
            <UploadButton onFiles={upload} onPick={pick} accept={ACCEPT} />
          </>
        }
      >
        <div className="flex w-full flex-wrap items-center gap-2">
          <div className="relative min-w-0 basis-full sm:flex-1 sm:basis-auto md:max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search names, notes and what’s said" className="h-8 pl-8" aria-label="Search library" />
          </div>
          <ToggleGroup type="single" value={kind} onValueChange={setKind} variant="outline" size="sm" aria-label="Type">
            <ToggleGroupItem value="video">Video</ToggleGroupItem>
            <ToggleGroupItem value="image">Photos</ToggleGroupItem>
            <ToggleGroupItem value="audio">Audio</ToggleGroupItem>
          </ToggleGroup>
        </div>
      </PageHeader>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
        {media.isPending ? (
          <Grid>
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="aspect-[4/5] rounded-lg" />
            ))}
          </Grid>
        ) : items.length ? (
          <Grid>
            {items.map((m) => (
              <MediaCard key={m.id} media={m} onClick={() => setOpenId(m.id)} />
            ))}
          </Grid>
        ) : (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyMedia variant="icon">{searching ? <Search /> : <FolderOpen />}</EmptyMedia>
              <EmptyTitle>{searching ? 'Nothing matches' : 'No footage yet'}</EmptyTitle>
              <EmptyDescription>
                {searching ? (
                  'Try another word — search also looks inside transcripts.'
                ) : (
                  <>
                    Drop files here, tap Upload, or share videos from your phone’s gallery to Content Studio. <Camera className="inline size-3.5" />
                  </>
                )}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
      <MediaDialog wid={workspace.id} mediaId={openId} onClose={() => setOpenId(null)} />
    </UploadZone>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">{children}</div>;
}
