import { Camera, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { isMarket, type CampaignDetail } from '@shared/campaigns';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { api, errorMessage } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { onLiveEvent } from '@/lib/live';
import type { Workspace } from '@/lib/types';

/**
 * Videos the creator films for the campaign themselves (UGC): Claude writes one from the brief — hook, what to say
 * with shot cues, a shot list, the captions with what the campaign requires — as a card on one of its pages.
 */
export function UgcCard({ campaign: c, workspaces }: { campaign: CampaignDetail; workspaces: Workspace[] }) {
  const pages = workspaces.filter((w) => c.pageIds.includes(w.id));
  const [page, setPage] = useState(pages[0]?.id ?? '');
  const [angle, setAngle] = useState('');
  const [writing, setWriting] = useState(false);
  const isUgc = /ugc|user.generated|review|testimonial/i.test(c.type);

  useEffect(() => {
    if (!page && pages[0]) setPage(pages[0].id);
  }, [page, pages]);
  useEffect(
    () =>
      onLiveEvent((e) => {
        if (e.type === 'job' && e.jobType === 'ugc.script' && e.status !== 'running') setWriting(false);
      }),
    [],
  );

  if (c.status !== 'active' && !c.ugc.length) return null;
  if (!isUgc && !c.ugc.length && isMarket(c.origin) && c.sources.length) return null;

  async function write() {
    setWriting(true);
    try {
      await api(`/campaigns/${c.id}/ugc`, { body: { workspaceId: page, angle: angle.trim() || undefined } });
      toast('Claude is writing it…', { description: 'A card appears on the page with the script and a shot list.' });
      setAngle('');
    } catch (err) {
      setWriting(false);
      toast.error(errorMessage(err));
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Camera className="size-4" /> Filmed videos
        </CardTitle>
        <CardDescription>
          For campaigns that want you on camera with the product (UGC). Claude writes the hook, what to say, a shot list and the captions from the brief; you film it and edit it like any
          piece, and its posts get submissions like clips do.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {c.status === 'active' && pages.length > 0 && (
          <div className="flex flex-wrap items-end gap-2">
            {pages.length > 1 && (
              <Select value={page} onValueChange={setPage}>
                <SelectTrigger size="sm" className="w-44" aria-label="Page">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {pages.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Input value={angle} onChange={(e) => setAngle(e.target.value)} placeholder="An angle, if you have one (optional)" className="h-8 min-w-48 flex-1" maxLength={500} />
            <Button size="sm" onClick={write} disabled={writing || !page}>
              {writing ? <Spinner /> : <Sparkles />} Write a video
            </Button>
          </div>
        )}
        {c.ugc.length > 0 ? (
          <ul className="divide-y rounded-lg border">
            {c.ugc.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <Link to={`/w/${p.workspaceId}/p/${p.id}`} className="min-w-0 flex-1 truncate hover:underline">
                  {p.title}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {workspaces.find((w) => w.id === p.workspaceId)?.name} · {p.stage} · {timeAgo(p.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">None yet.</p>
        )}
      </CardContent>
    </Card>
  );
}
