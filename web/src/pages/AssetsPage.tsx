import { Palette } from 'lucide-react';
import { useState } from 'react';
import { ASSET_TYPE_LABELS, ASSET_TYPES, type AssetType } from '@shared/types';
import { MediaCard } from '@/components/MediaCard';
import { MediaDialog } from '@/components/MediaDialog';
import { PageHeader } from '@/components/PageHeader';
import { UploadButton, UploadZone } from '@/components/UploadZone';
import { useWorkspaceContext } from '@/components/WorkspaceLayout';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { useNativePick, useUpload } from '@/hooks/useUpload';
import { useMedia } from '@/lib/queries';
import type { Media } from '@/lib/types';

const ACCEPT: Record<AssetType, string> = {
  logo: 'image/*,.svg',
  font: '.ttf,.otf,.woff,.woff2',
  lut: '.cube,.3dl',
  music: 'audio/*',
  sfx: 'audio/*',
  template: '.html,.json,.zip,video/*,image/*',
  other: '',
};

const HINT: Record<AssetType, string> = {
  logo: 'Logos, watermarks, overlays',
  font: '.ttf / .otf / .woff2 for captions and titles',
  lut: '.cube colour grades',
  music: 'Licensed background tracks',
  sfx: 'Whooshes, pops, risers',
  template: 'Intro/outro or caption styles (used by the video studio later)',
  other: 'Anything else',
};

export function AssetsPage() {
  const { workspace } = useWorkspaceContext();
  const media = useMedia(workspace.id, { scope: 'assets' });
  const [openId, setOpenId] = useState<string | null>(null);
  const items = media.data ?? [];
  const byType = (t: AssetType) => items.filter((m) => m.assetType === t);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Brand assets" description="Logos, fonts, LUTs, music and sound effects for this brand — the video studio will use them" />
      <div className="min-h-0 flex-1 space-y-8 overflow-y-auto p-4 md:p-6">
        {media.isPending ? (
          <Skeleton className="h-40 rounded-xl" />
        ) : (
          <>
            {!items.length && (
              <Empty className="border border-dashed">
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <Palette />
                  </EmptyMedia>
                  <EmptyTitle>No brand assets yet</EmptyTitle>
                  <EmptyDescription>When you have them, import them into the sections below. Only use music and sound effects you have the rights to — platforms mute copyrighted audio.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
            {ASSET_TYPES.map((t) => (
              <AssetSection key={t} wid={workspace.id} type={t} items={byType(t)} onOpen={setOpenId} />
            ))}
          </>
        )}
      </div>
      <MediaDialog wid={workspace.id} mediaId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function AssetSection({ wid, type, items, onOpen }: { wid: string; type: AssetType; items: Media[]; onOpen: (id: string) => void }) {
  const upload = useUpload(wid, { assetType: type });
  const pick = useNativePick(wid, { assetType: type });
  return (
    <UploadZone onFiles={upload} accept={ACCEPT[type] || undefined}>
      <section className="space-y-3" aria-labelledby={`assets-${type}`}>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 id={`assets-${type}`} className="text-sm font-medium">
              {ASSET_TYPE_LABELS[type]} <span className="text-muted-foreground tabular-nums">{items.length || ''}</span>
            </h2>
            <p className="text-xs text-muted-foreground">{HINT[type]}</p>
          </div>
          <UploadButton onFiles={upload} onPick={pick} accept={ACCEPT[type] || undefined} label="Import" variant="outline" />
        </div>
        {items.length > 0 && (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8">
            {items.map((m) => (
              <MediaCard key={m.id} media={m} onClick={() => onOpen(m.id)} />
            ))}
          </div>
        )}
      </section>
    </UploadZone>
  );
}
