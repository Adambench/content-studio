import { AlertCircle, AudioLines, FileIcon, Film, Image as ImageIcon, Type } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { mediaThumbUrl } from '@/lib/api';
import { duration } from '@/lib/format';
import type { Media } from '@/lib/types';
import { cn } from '@/lib/utils';

export function MediaIcon({ media, className }: { media: Pick<Media, 'kind' | 'assetType'>; className?: string }) {
  if (media.assetType === 'font') return <Type className={className} />;
  if (media.kind === 'video') return <Film className={className} />;
  if (media.kind === 'image') return <ImageIcon className={className} />;
  if (media.kind === 'audio') return <AudioLines className={className} />;
  return <FileIcon className={className} />;
}

export function MediaCard({ media, onClick, selected }: { media: Media; onClick?: () => void; selected?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cn('group w-full min-w-0 text-left', selected && 'rounded-lg ring-2 ring-brand ring-offset-2 ring-offset-background')}>
      <div className="relative aspect-[4/5] overflow-hidden rounded-lg border bg-muted">
        {media.hasThumb ? (
          <img src={mediaThumbUrl(media.id)} alt="" loading="lazy" className="size-full object-cover transition-transform group-hover:scale-[1.02]" />
        ) : (
          <div className="grid size-full place-items-center text-muted-foreground">
            <MediaIcon media={media} className="size-7" />
          </div>
        )}
        {media.durationMs != null && media.kind !== 'image' && (
          <span className="absolute right-1.5 bottom-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-medium text-white tabular-nums">{duration(media.durationMs)}</span>
        )}
        {(media.transcriptStatus === 'queued' || media.transcriptStatus === 'running') && (
          <span className="absolute top-1.5 left-1.5 flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[11px] text-white">
            <Spinner className="size-3" /> Transcribing
          </span>
        )}
        {media.source === 'render' && <span className="absolute top-1.5 left-1.5 rounded bg-brand/90 px-1.5 py-0.5 text-[11px] font-medium text-white">Rendered</span>}
        {media.transcriptStatus === 'error' && (
          <span className="absolute top-1.5 left-1.5 flex items-center gap-1 rounded bg-destructive/80 px-1.5 py-0.5 text-[11px] text-white">
            <AlertCircle className="size-3" /> Transcript failed
          </span>
        )}
      </div>
      <p className="mt-1.5 truncate text-xs text-muted-foreground group-hover:text-foreground">{media.originalName}</p>
    </button>
  );
}
