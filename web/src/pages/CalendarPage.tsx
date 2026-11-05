import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { cardPath } from '@/lib/nav';
import { usePosts } from '@/lib/queries';
import { cn } from '@/lib/utils';

const DAY = 864e5;

function weekStart(offset: number) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
  return d.getTime();
}

const hm = (ms: number) => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

/** A page's week: what goes out when, what went out, what failed. */
export function PageCalendar({ wid }: { wid: string }) {
  const [offset, setOffset] = useState(0);
  const from = weekStart(offset);
  const posts = usePosts(wid, from, from + 7 * DAY);
  const today = new Date().setHours(0, 0, 0, 0);
  const label = new Date(from).toLocaleDateString(undefined, { month: 'long', day: 'numeric' });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 px-5 pt-3">
        <Button variant="ghost" size="icon" aria-label="Week before" onClick={() => setOffset((o) => o - 1)}>
          <ChevronLeft />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Week after" onClick={() => setOffset((o) => o + 1)}>
          <ChevronRight />
        </Button>
        <span className="ml-1 text-[15px] text-muted-foreground">{offset === 0 ? 'This week' : `Week of ${label}`}</span>
        {offset !== 0 && (
          <Button variant="ghost" size="sm" className="ml-2" onClick={() => setOffset(0)}>
            Today
          </Button>
        )}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 gap-3 px-5 pt-3 pb-5">
        {Array.from({ length: 7 }, (_, i) => {
          const start = from + i * DAY;
          const day = new Date(start);
          const list = (posts.data ?? []).filter((p) => p.scheduledAt >= start && p.scheduledAt < start + DAY).sort((a, b) => a.scheduledAt - b.scheduledAt);
          return (
            <section key={start} className={cn('min-h-0 overflow-y-auto rounded-xl border bg-card p-3', start === today && 'border-foreground/20 bg-muted/40')}>
              <h2 className={cn('mb-2.5 text-sm font-semibold text-muted-foreground', start === today && 'text-foreground')}>
                {day.toLocaleDateString(undefined, { weekday: 'short' })} {day.getDate()}
              </h2>
              {list.map((p) => {
                const failed = p.status === 'failed' || p.status === 'missed';
                return (
                  <Link key={p.id} to={cardPath(p.pieceId)} title={p.pieceTitle} className={cn('flex items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted/60', p.status === 'published' && 'opacity-50')}>
                    <span className={cn('shrink-0 text-[13px] text-muted-foreground tabular-nums', failed && 'font-semibold text-destructive')}>{failed ? 'Failed' : hm(p.scheduledAt)}</span>
                    <span className="truncate">{p.pieceTitle}</span>
                  </Link>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}
