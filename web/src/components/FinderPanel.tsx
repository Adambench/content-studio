import { Check, CircleAlert, ExternalLink, Plus, Search, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { CampaignLead } from '@shared/finder';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { api, errorMessage } from '@/lib/api';
import { keys, queryClient, useFinder } from '@/lib/queries';
import { cn } from '@/lib/utils';

const money = (n: number | null) => (n === null ? '—' : n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${Math.round(n)}`);

/** Find clips: one button that finds campaigns, the creators' videos, moments that already went viral, and makes the clips. */
export function FinderPanel({ wid }: { wid: string }) {
  const finder = useFinder(wid);
  const [starting, setStarting] = useState(false);
  const d = finder.data;
  const running = d?.run.status === 'running';

  async function start() {
    setStarting(true);
    try {
      await api(`/workspaces/${wid}/finder`, { method: 'POST', body: {} });
      queryClient.invalidateQueries({ queryKey: keys.finder(wid) });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setStarting(false);
    }
  }

  async function setAuto(on: boolean) {
    await api(`/workspaces/${wid}/finder/auto`, { method: 'PUT', body: { on } }).catch((err) => toast.error(errorMessage(err)));
    queryClient.invalidateQueries({ queryKey: keys.finder(wid) });
  }

  async function add(lead: CampaignLead) {
    try {
      await api('/campaigns', { method: 'POST', body: { origin: 'content_rewards', link: lead.link } });
      await api('/finder/leads/dismiss', { method: 'POST', body: { link: lead.link } });
      queryClient.invalidateQueries({ queryKey: keys.finder(wid) });
      queryClient.invalidateQueries({ queryKey: keys.campaigns });
      toast.success('Added: it’s being read', { description: 'Assign it to this page under Campaigns once it has been read.' });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function dismiss(lead: CampaignLead) {
    await api('/finder/leads/dismiss', { method: 'POST', body: { link: lead.link } }).catch(() => {});
    queryClient.invalidateQueries({ queryKey: keys.finder(wid) });
  }

  return (
    <section className="space-y-3 rounded-xl border bg-card p-4" aria-label="Find clips">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">Find clips</h2>
          <p className="text-sm text-muted-foreground">New campaigns, the creators’ best videos, moments other clippers already got big on, then the clips, ready in Review.</p>
        </div>
        <Button onClick={start} disabled={starting || running || !d}>
          {running || starting ? <Spinner /> : <Search />} {running ? 'Looking…' : 'Find clips'}
        </Button>
      </div>

      {d && d.run.steps.length > 0 && (
        <ol className="space-y-1 text-sm">
          {d.run.steps.map((s) => (
            <li key={s.id} className="flex items-start gap-2">
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
                {s.status === 'running' ? <Spinner /> : s.status === 'done' ? <Check className="size-4 text-emerald-400" /> : s.status === 'error' ? <CircleAlert className="size-4 text-destructive" /> : <span className={cn('size-1.5 rounded-full', s.status === 'skipped' ? 'bg-muted-foreground/30' : 'bg-muted-foreground/60')} />}
              </span>
              <span className={cn(s.status === 'waiting' && 'text-muted-foreground')}>
                {s.label}
                {s.detail && <span className="text-muted-foreground"> · {s.detail}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}

      {d && d.leads.items.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Campaigns worth a look</h3>
          <ul className="divide-y rounded-lg border">
            {d.leads.items.slice(0, 6).map((l) => (
              <li key={l.link} className="flex items-center gap-2 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{l.title || l.brand}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[l.brand, l.category, l.ratePer1k !== null && `${money(l.ratePer1k)} per 1k views`, l.budgetLeft !== null && `${money(l.budgetLeft)} left`].filter(Boolean).join(' · ')}
                  </p>
                  {l.halal === 'flag' && <Badge variant="outline" className="mt-1 text-amber-400">Check: {l.halalNote || 'halal screen flagged it'}</Badge>}
                </div>
                <Button size="icon-sm" variant="ghost" asChild aria-label="Open on Content Rewards (joining is your click)">
                  <a href={l.link} target="_blank" rel="noreferrer">
                    <ExternalLink />
                  </a>
                </Button>
                <Button size="sm" variant="outline" onClick={() => add(l)}>
                  <Plus /> Add
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label="Not interested" onClick={() => dismiss(l)}>
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {d?.leads.note && !d.leads.items.length && <p className="text-xs text-muted-foreground">{d.leads.note}</p>}

      {d && (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={d.auto} onCheckedChange={setAuto} /> Also look every morning
        </label>
      )}
    </section>
  );
}
