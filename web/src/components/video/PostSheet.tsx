// After Approve: what posting needs, in one place. The caption to copy, the file (download, or into the phone's
// gallery), and "Mark as posted". Claude never posts: I do, in Instagram.

import { Copy, Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import type { VideoDetail } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { mediaUrl } from '@/lib/api';
import { isNative, saveToPhone } from '@/lib/native';
import { useVideoActions } from '@/lib/queries';

export function PostSheet({ detail, open, onOpenChange }: { detail: VideoDetail; open: boolean; onOpenChange: (open: boolean) => void }) {
  const v = detail.video;
  const act = useVideoActions(v.id);
  const version = detail.versions.find((x) => x.n === v.approvedN) ?? detail.versions.at(-1);
  const [caption, setCaption] = useState(v.caption);
  useEffect(() => setCaption(v.caption), [v.caption]);
  if (!version) return null;

  const copy = () =>
    navigator.clipboard.writeText(caption).then(
      () => toast('Caption copied'),
      () => toast.error('Copy didn’t work: select the caption and copy it'),
    );

  const files = version.kind === 'carousel' ? Array.from({ length: version.slides }, (_, k) => ({ id: `${version.id}~${k}`, url: `/media/slide/${version.id}/${k}?download=1`, name: `${v.title} v${version.n} ${k + 1}.png` })) : [{ id: version.id, url: `/media/version/${version.id}?download=1`, name: `${v.title} v${version.n}.mp4` }];

  const save = async () => {
    for (const f of files) await saveToPhone(f.id, f.name);
    toast(version.kind === 'carousel' ? 'Slides saved to the gallery' : 'Saved to the gallery');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{v.title}</DialogTitle>
          <DialogDescription>
            v{version.n} {v.status === 'posted' ? 'posted' : 'approved'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Textarea value={caption} onChange={(e) => setCaption(e.currentTarget.value)} onBlur={() => caption !== v.caption && act.update.mutate({ caption })} rows={6} placeholder="Ask Claude for a caption in the thread, or write it here." aria-label="Caption" />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={copy} disabled={!caption.trim()}>
              <Copy /> Copy caption
            </Button>
            {isNative ? (
              <Button variant="outline" size="sm" onClick={() => void save()}>
                <Download /> Save to phone
              </Button>
            ) : (
              files.map((f, k) => (
                <Button key={f.id} variant="outline" size="sm" asChild>
                  <a href={mediaUrl(f.url)} download={f.name}>
                    <Download /> {files.length > 1 ? `Slide ${k + 1}` : 'Download'}
                  </a>
                </Button>
              ))
            )}
          </div>
        </div>
        <div className="flex justify-end">
          {v.status === 'posted' ? (
            <Button variant="ghost" onClick={() => act.posted.mutate(false)}>
              Not posted after all
            </Button>
          ) : (
            <Button
              onClick={() =>
                act.posted.mutate(true, {
                  onSuccess: () => {
                    onOpenChange(false);
                    toast('Moved to Posted');
                  },
                })
              }
            >
              Mark as posted
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
