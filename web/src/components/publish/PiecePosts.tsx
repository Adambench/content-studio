import { CalendarClock, Eye } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { compact } from '@/lib/format';
import { usePiecePosts } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { accountName, formatWhen, needsAttention, PlatformIcon, StatusIcon, statusText } from './common';
import { PostSheet } from './PostSheet';

/** The piece's posts — scheduled, going out, done — on its page. */
export function PiecePosts({ wid, pieceId, onSchedule }: { wid: string; pieceId: string; onSchedule: () => void }) {
  const posts = usePiecePosts(pieceId);
  const [open, setOpen] = useState<string | null>(null);
  const list = posts.data ?? [];
  if (!list.length) return null;

  return (
    <section id="posts" className="mx-auto max-w-3xl scroll-mt-4 space-y-3 px-4 pb-6 md:px-6" aria-label="Posts">
      <div className="flex items-center gap-2 border-t pt-6">
        <h2 className="mr-auto text-sm font-medium">
          Posts <span className="text-muted-foreground tabular-nums">{list.length}</span>
        </h2>
        <Button size="sm" variant="ghost" onClick={onSchedule}>
          <CalendarClock /> Schedule more
        </Button>
      </div>
      <ul className="divide-y rounded-lg border">
        {list.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => setOpen(p.id)} className={cn('flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-accent/40', needsAttention(p) && 'bg-destructive/5')}>
              <PlatformIcon platform={p.platform} />
              <span className="min-w-0 flex-1 truncate text-sm">{accountName(p.account, p.accountLabel)}</span>
              <span className="hidden text-xs text-muted-foreground tabular-nums sm:inline">{formatWhen(p.status === 'published' && p.publishedAt ? p.publishedAt : p.scheduledAt)}</span>
              {p.stats?.views != null && (
                <span className="flex items-center gap-1 text-xs tabular-nums" title={`${p.stats.views.toLocaleString()} views`}>
                  <Eye className="size-3.5 text-muted-foreground" />
                  {compact(p.stats.views)}
                </span>
              )}
              <span className="flex w-28 items-center justify-end gap-1.5 text-xs">
                <StatusIcon post={p} />
                {statusText(p)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <PostSheet postId={open} wid={wid} onClose={() => setOpen(null)} />
    </section>
  );
}
