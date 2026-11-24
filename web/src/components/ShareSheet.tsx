// Files shared to the app from the phone's gallery: pick the video they're for (or a new one), then Add, or Add &
// make (Claude starts once every file is in). They upload in the background, with the screen off too.

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import type { Video } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { api } from '@/lib/api';
import { sendShare, Studio, type Share } from '@/lib/native';
import { useBrands, useVideos } from '@/lib/queries';
import { cn } from '@/lib/utils';

export function ShareSheet() {
  const [share, setShare] = useState<Share | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [brandId, setBrandId] = useState<string | null>(null);
  const videos = useVideos();
  const brands = useBrands();
  const navigate = useNavigate();

  useEffect(() => {
    if (!Studio) return;
    void Studio.getShare().then((r) => r.share && setShare(r.share));
    const h = Studio.addListener('share', (s) => setShare(s));
    return () => void h.then((x) => x.remove());
  }, []);

  if (!share) return null;
  const recent = (videos.data ?? []).filter((v) => v.status === 'turn' || v.status === 'making').slice(0, 8);
  const brand = brandId ?? brands.data?.[0]?.id ?? null;
  const n = share.files.length;

  const send = async (make: boolean) => {
    try {
      let video: { id: string; brandId: string } | undefined = recent.find((v) => v.id === target);
      if (!video) {
        if (!brand) return;
        video = await api<Video>('/api/videos', { body: { brandId: brand, title: share.text?.slice(0, 60) || 'Shared from the phone', go: false } });
      }
      await sendShare(share, video, make);
      toast(make ? 'Uploading · Claude starts when they’re in' : 'Uploading');
      setShare(null);
      setTarget(null);
      navigate(`/v/${video.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Sheet open onOpenChange={(o) => !o && Studio?.discardShare({ id: share.id }).then(() => setShare(null))}>
      <SheetContent side="bottom" className="max-h-[85%] gap-3 rounded-t-2xl p-4">
        <SheetTitle>{n === 1 ? '1 file' : `${n} files`} for…</SheetTitle>
        <SheetDescription className="sr-only">Pick the video they’re for</SheetDescription>
        <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {recent.map((v) => (
            <button key={v.id} type="button" onClick={() => setTarget(v.id)} className={cn('flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm', target === v.id && 'border-you')}>
              <span className="size-2 rounded-full" style={{ background: brands.data?.find((b) => b.id === v.brandId)?.color }} />
              <span className="min-w-0 flex-1 truncate">{v.title}</span>
            </button>
          ))}
          <button type="button" onClick={() => setTarget(null)} className={cn('rounded-xl border px-3 py-2.5 text-left text-sm', target === null && 'border-you')}>
            A new video
            {target === null && (
              <span className="mt-2 flex flex-wrap gap-1.5">
                {(brands.data ?? []).map((b) => (
                  <span key={b.id} role="button" tabIndex={0} onClick={() => setBrandId(b.id)} className={cn('rounded-full border px-2 py-0.5 text-xs', brand === b.id ? 'border-foreground' : 'text-muted-foreground')}>
                    {b.name}
                  </span>
                ))}
              </span>
            )}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => void send(false)}>
            Add
          </Button>
          <Button onClick={() => void send(true)}>Add & make</Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
