import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { MARKET_INFO, MARKETS } from '@shared/campaigns';
import { Button } from '@/components/ui/button';
import { api, errorMessage } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { keys, queryClient, useJoinedSync } from '@/lib/queries';
import { cn } from '@/lib/utils';

/**
 * The campaigns I've joined on Content Rewards and Vyro come in by themselves: the desktop app reads both lists every
 * 6 hours. This says what the last check found and checks again now.
 */
export function JoinedCheck() {
  const { data: d } = useJoinedSync();
  const [busy, setBusy] = useState(false);
  if (!d) return null;

  async function check() {
    setBusy(true);
    try {
      queryClient.setQueryData(keys.joinedSync, await api('/campaigns/joined', { body: {} }));
      toast('Checking your joined campaigns…', { description: 'A page on each site, read slowly: about a minute.' });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const lines = MARKETS.flatMap((m) => {
    const r = d.last?.markets[m];
    if (!r) return [];
    const what = !r.ok ? r.note : r.found ? `${r.found} joined${r.added ? `, ${r.added} new` : ''}` : r.note;
    return [{ m, text: `${MARKET_INFO[m].label}: ${what}`, ok: r.ok && !!r.found }];
  });

  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-2 rounded-lg border bg-card px-3 py-2.5 text-xs text-muted-foreground">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="text-foreground">
          {d.running
            ? 'Checking the campaigns you’ve joined…'
            : d.last
              ? `Joined campaigns checked ${timeAgo(d.last.at)}`
              : 'Campaigns you join on Content Rewards and Vyro are added here by themselves.'}
        </p>
        {!d.running &&
          lines.map((l) => (
            <p key={l.m} className={cn(!l.ok && 'text-amber-400/90')}>
              {l.text}
            </p>
          ))}
        {!d.available && <p>The desktop app checks every 6 hours, signed in under Settings → Connected sites.</p>}
      </div>
      {d.available && (
        <Button size="sm" variant="outline" onClick={check} disabled={busy || d.running}>
          <RefreshCw className={cn((busy || d.running) && 'animate-spin')} /> Check joined
        </Button>
      )}
    </div>
  );
}
