import { BadgeDollarSign, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { isMarket, MARKET_INFO, type Campaign, type CampaignPlatform } from '@shared/campaigns';
import { AddCampaignDialog } from '@/components/campaigns/AddCampaignDialog';
import { JoinedCheck } from '@/components/campaigns/JoinedCheck';
import { BudgetBar, deadlineText, HalalBadge, PageChips, rateText, StatusBadge } from '@/components/campaigns/common';
import { PageHeader } from '@/components/PageHeader';
import { PlatformIcon } from '@/components/publish/common';
import { Button } from '@/components/ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { useCampaigns, useWorkspaces } from '@/lib/queries';
import type { Workspace } from '@/lib/types';

export function PlatformIcons({ platforms }: { platforms: CampaignPlatform[] }) {
  return (
    <span className="flex items-center gap-1">
      {platforms
        .filter((p): p is Exclude<CampaignPlatform, 'x'> => p !== 'x')
        .map((p) => (
          <PlatformIcon key={p} platform={p} className="size-3.5" />
        ))}
    </span>
  );
}

function CampaignCard({ c, workspaces }: { c: Campaign; workspaces: Workspace[] }) {
  const business = c.origin === 'business' ? workspaces.find((w) => w.id === c.businessWorkspaceId) : undefined;
  const meta = [isMarket(c.origin) ? MARKET_INFO[c.origin].label : `${business?.name ?? 'Your business'}’s own`, c.brand, c.type].filter(Boolean).join(' · ');
  const deadline = deadlineText(c.deadline);
  return (
    <Link to={`/campaigns/${c.id}`} className="block space-y-2.5 rounded-lg border bg-card p-3 hover:border-foreground/20">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{c.title || (c.link ? 'Reading the campaign…' : 'Untitled campaign')}</p>
          {meta && <p className="truncate text-xs text-muted-foreground">{meta}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {c.halalVerdict && c.halalVerdict !== 'ok' && <HalalBadge verdict={c.halalVerdict} />}
          <StatusBadge status={c.status} reading={c.reading} rejected={c.halalVerdict === 'reject'} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {rateText(c.ratePer1k) && <span className="text-foreground">{rateText(c.ratePer1k)}</span>}
        {c.platforms.length > 0 && <PlatformIcons platforms={c.platforms} />}
        {deadline && <span>{deadline}</span>}
      </div>
      {isMarket(c.origin) && <BudgetBar left={c.budgetLeft} total={c.budgetTotal} />}
      <PageChips pageIds={c.pageIds} workspaces={workspaces} />
    </Link>
  );
}

function Group({ title, items, workspaces }: { title: string; items: Campaign[]; workspaces: Workspace[] }) {
  if (!items.length) return null;
  return (
    <section className="space-y-2.5" aria-label={title}>
      <h2 className="flex items-center gap-2 text-sm font-medium">
        {title} <span className="text-muted-foreground tabular-nums">{items.length}</span>
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((c) => (
          <CampaignCard key={c.id} c={c} workspaces={workspaces} />
        ))}
      </div>
    </section>
  );
}

/** Every campaign, outside workspaces: those waiting for my OK, the running ones, then the rest. */
export function CampaignsPage() {
  const campaigns = useCampaigns();
  const { data: workspaces = [] } = useWorkspaces();
  const [adding, setAdding] = useState(false);
  const [showRejected, setShowRejected] = useState(false);
  const all = campaigns.data ?? [];
  const rejected = all.filter((c) => c.halalVerdict === 'reject' && c.status === 'to_confirm');
  const toConfirm = all.filter((c) => (c.status === 'to_confirm' || c.status === 'reading') && !rejected.includes(c));
  const active = all.filter((c) => c.status === 'active');
  const rest = all.filter((c) => c.status === 'paused' || c.status === 'ended');

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Campaigns"
        description="Content Rewards and Vyro campaigns, and your businesses’ own"
        actions={
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus /> Add campaign
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
          <JoinedCheck />
          {!campaigns.data ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-32 rounded-lg" />
              <Skeleton className="h-32 rounded-lg" />
            </div>
          ) : all.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <BadgeDollarSign />
                </EmptyMedia>
                <EmptyTitle>No campaigns yet</EmptyTitle>
                <EmptyDescription>
                  Join campaigns on Content Rewards or Vyro and they come in by themselves (or paste a link), or set up one for your own business. Content Studio reads the rules,
                  checks them against the halal rules and waits for your OK.
                </EmptyDescription>
              </EmptyHeader>
              <Button onClick={() => setAdding(true)}>
                <Plus /> Add campaign
              </Button>
            </Empty>
          ) : (
            <>
              <Group title="To confirm" items={toConfirm} workspaces={workspaces} />
              <Group title="Active" items={active} workspaces={workspaces} />
              <Group title="Paused and ended" items={rest} workspaces={workspaces} />
              {rejected.length > 0 && (
                <div className="space-y-3">
                  <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setShowRejected((v) => !v)}>
                    {showRejected ? 'Hide' : 'Show'} {rejected.length} rejected by the halal screen
                  </Button>
                  {showRejected && <Group title="Rejected" items={rejected} workspaces={workspaces} />}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <AddCampaignDialog open={adding} onOpenChange={setAdding} />
    </div>
  );
}
