import { Palette } from 'lucide-react';
import { useState } from 'react';
import { BUILTIN_SFX, SFX_GROUPS, builtinSfxId, type SfxGroup } from '@shared/sfx';
import { ASSET_TYPE_LABELS, ASSET_TYPES, type AssetType } from '@shared/types';
import { MediaCard } from '@/components/MediaCard';
import { MediaDialog } from '@/components/MediaDialog';
import { PageHeader } from '@/components/PageHeader';
import { ListenButton } from '@/components/studio/controls';
import { UploadButton, UploadZone } from '@/components/UploadZone';
import { VocalOnlyDialog } from '@/components/VocalOnlyDialog';
import { useWorkspaceContext } from '@/components/WorkspaceLayout';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { useNativePick, useUpload } from '@/hooks/useUpload';
import { useMedia } from '@/lib/queries';
import { sfxUrl } from '@/lib/sfx';
import type { Media } from '@/lib/types';

const ACCEPT: Record<AssetType, string> = {
  logo: 'image/*,.svg',
  font: '.ttf,.otf,.woff,.woff2',
  lut: '.cube,.3dl',
  nasheed: 'audio/*',
  sfx: 'audio/*',
  template: '.html,.json,.zip,video/*,image/*',
  other: '',
};

const HINT: Record<AssetType, string> = {
  logo: 'Logos, watermarks, overlays',
  font: '.ttf / .otf / .woff2 for captions and titles',
  lut: '.cube colour grades',
  nasheed: 'Vocal only, no instruments. Only you can put one on an edit',
  sfx: 'Your own whooshes, pops and hits, on top of the built-in ones below',
  template: 'Intro/outro or caption styles (used by the video studio later)',
  other: 'Anything else',
};

export function AssetsPage() {
  const { workspace } = useWorkspaceContext();
  const media = useMedia(workspace.id, { scope: 'assets' });
  const [openId, setOpenId] = useState<string | null>(null);
  const items = media.data ?? [];
  const byType = (t: AssetType) => items.filter((m) => m.assetType === t);
  // LUTs are for workspaces that grade (or already have some).
  const types = ASSET_TYPES.filter((t) => t !== 'lut' || workspace.modules.includes('grading') || byType('lut').length);

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Brand assets" description="Logos, fonts, LUTs, nasheeds and sound effects for this brand — the video studio uses them" />
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
                  <EmptyDescription>When you have them, import them into the sections below. No music: sound effects and vocal-only nasheeds only.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
            {types.map((t) => (
              <AssetSection key={t} wid={workspace.id} type={t} items={byType(t)} onOpen={setOpenId}>
                {t === 'sfx' && <BuiltinSounds />}
              </AssetSection>
            ))}
          </>
        )}
      </div>
      <MediaDialog wid={workspace.id} mediaId={openId} onClose={() => setOpenId(null)} />
    </div>
  );
}

function AssetSection({ wid, type, items, onOpen, children }: { wid: string; type: AssetType; items: Media[]; onOpen: (id: string) => void; children?: React.ReactNode }) {
  const upload = useUpload(wid, { assetType: type });
  const pick = useNativePick(wid, { assetType: type });
  // Nasheeds are confirmed vocal-only before they come in.
  const [pending, setPending] = useState<(() => void) | null>(null);
  const guard = (run: () => void) => (type === 'nasheed' ? setPending(() => run) : run());
  const onFiles = (files: File[]) => guard(() => void upload(files));
  const onPick = pick && ((accept: string | undefined, camera: boolean) => guard(() => void pick(accept, camera)));
  return (
    <UploadZone onFiles={onFiles} accept={ACCEPT[type] || undefined}>
      <section className="space-y-3" aria-labelledby={`assets-${type}`}>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 id={`assets-${type}`} className="text-sm font-medium">
              {ASSET_TYPE_LABELS[type]} <span className="text-muted-foreground tabular-nums">{items.length || ''}</span>
            </h2>
            <p className="text-xs text-muted-foreground">{HINT[type]}</p>
          </div>
          <UploadButton onFiles={onFiles} onPick={onPick} accept={ACCEPT[type] || undefined} label="Import" variant="outline" />
        </div>
        {items.length > 0 && (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8">
            {items.map((m) => (
              <MediaCard key={m.id} media={m} onClick={() => onOpen(m.id)} />
            ))}
          </div>
        )}
        {children}
      </section>
      {type === 'nasheed' && (
        <VocalOnlyDialog
          open={!!pending}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            pending?.();
            setPending(null);
          }}
        />
      )}
    </UploadZone>
  );
}

/** The app's own sound effects, shared by every workspace: listen to them here, use them in any edit. */
function BuiltinSounds() {
  return (
    <div className="space-y-3 rounded-xl border bg-card/50 p-3">
      <div>
        <h3 className="text-xs font-medium">Built in</h3>
        <p className="text-xs text-muted-foreground">Non-musical, free to use, in every workspace. Pick them in the video editor’s Sound tab.</p>
      </div>
      <div className="grid gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
        {(Object.keys(SFX_GROUPS) as SfxGroup[]).map((g) => (
          <div key={g} className="space-y-1">
            <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{SFX_GROUPS[g]}</p>
            <ul>
              {BUILTIN_SFX.filter((s) => s.group === g).map((s) => (
                <li key={s.name} className="flex items-start gap-1.5 py-0.5">
                  <ListenButton src={sfxUrl(builtinSfxId(s.name))} label={`Listen to ${s.label}`} className="-ml-1.5" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm leading-snug">{s.label}</span>
                    <span className="block text-xs leading-snug text-muted-foreground">{s.use}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}
