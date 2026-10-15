import { CircleAlert, Link2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { PostStats as Stats } from '@shared/analytics';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { api, errorMessage } from '@/lib/api';
import { compact, percent, timeAgo, times } from '@/lib/format';
import { keys, queryClient, usePostStats } from '@/lib/queries';
import type { Post } from '@/lib/types';
import { TrendChart } from './charts';

const FIELDS: { key: keyof Stats; label: string; show: (v: number) => string }[] = [
  { key: 'views', label: 'Views', show: compact },
  { key: 'likes', label: 'Likes', show: compact },
  { key: 'comments', label: 'Comments', show: compact },
  { key: 'shares', label: 'Shares', show: compact },
  { key: 'saves', label: 'Saves', show: compact },
  { key: 'reach', label: 'Reached', show: compact },
  { key: 'avgWatchSeconds', label: 'Avg watch', show: (v) => `${v.toFixed(1)} s` },
  { key: 'avgViewPercent', label: 'Watched', show: (v) => `${Math.round(v)}%` },
  { key: 'followsGained', label: 'New followers', show: compact },
];

// TikTok video ids are long numbers; anything else (a publish id) means the video isn't known yet.
const knowsVideo = (p: Post) => p.platform !== 'tiktok' || /^\d{6,}$/.test(p.externalId ?? '');

/** A posted post's numbers: the latest, how it compares with the account's typical post, and views over time. */
export function PostStats({ post }: { post: Post }) {
  const stats = usePostStats(post.id);
  const s = post.stats;
  const r = stats.data;
  const shown = s ? FIELDS.filter((f) => s[f.key] !== null) : [];
  const views = (r?.readings ?? []).filter((x) => x.views !== null).map((x) => ({ at: x.at, value: x.views! }));
  if (post.publishedAt && views.length) views.unshift({ at: post.publishedAt, value: 0 });

  return (
    <section className="space-y-3" aria-label="Stats">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium">Stats</h3>
        {post.statsAt && <span className="text-xs text-muted-foreground">Updated {timeAgo(post.statsAt)}</span>}
      </div>
      {shown.length > 0 ? (
        <>
          <dl className="grid grid-cols-3 gap-x-3 gap-y-2">
            {shown.map((f) => (
              <div key={f.key}>
                <dt className="text-xs text-muted-foreground">{f.label}</dt>
                <dd className="text-sm font-medium">{f.show(s![f.key]!)}</dd>
              </div>
            ))}
            {r?.engagement !== null && r?.engagement !== undefined && (
              <div>
                <dt className="text-xs text-muted-foreground">Engagement</dt>
                <dd className="text-sm font-medium">{percent(r.engagement)}</dd>
              </div>
            )}
          </dl>
          {r?.score !== null && r?.score !== undefined && (
            <p className="text-sm">
              <span className="font-medium">{times(r.score)}</span> <span className="text-muted-foreground">a typical post on this account — {compact(r.views24h)} views after 24 hours, against {compact(r.typical)}.</span>
            </p>
          )}
          <TrendChart points={views} unit="views" label="Views over time" empty="" withTime />
        </>
      ) : (
        !post.statsNote && <p className="text-sm text-muted-foreground">{post.statsAt ? 'No numbers from the platform yet.' : 'Numbers come in a few hours after it goes out, and are read again while it’s new.'}</p>
      )}
      {post.statsNote && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <CircleAlert className="mt-px size-3.5 shrink-0 text-amber-400" />
          {post.statsNote}
        </p>
      )}
      {post.platform === 'tiktok' && (!knowsVideo(post) || post.statsNote) && <LinkVideo post={post} />}
    </section>
  );
}

/** Tell Content Studio which TikTok video a post became (an inbox draft posted from the app). */
function LinkVideo({ post }: { post: Post }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  async function link(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/posts/${post.id}/link`, { body: { url } });
      setUrl('');
      queryClient.invalidateQueries({ queryKey: keys.post(post.id) });
      toast.success('Linked — reading its numbers');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={link} className="space-y-1.5">
      <label htmlFor={`link-${post.id}`} className="text-xs text-muted-foreground">
        Posted it from the TikTok app? Paste the video’s link to see its stats.
      </label>
      <div className="flex gap-2">
        <Input id={`link-${post.id}`} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.tiktok.com/@you/video/…" className="h-8" inputMode="url" />
        <Button size="sm" variant="outline" disabled={!url.trim() || busy}>
          {busy ? <Spinner /> : <Link2 />} Link
        </Button>
      </div>
    </form>
  );
}
