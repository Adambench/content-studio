import { ArrowLeft, CircleAlert, ExternalLink, Loader2, MoreHorizontal, Pause, Play, RefreshCw, Square, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { CAMPAIGN_PLATFORM_LABELS, isMarket, money, type CampaignDetail } from '@shared/campaigns';
import { BudgetBar, deadlineText, HalalBadge, PageChips, PagePicker, StatusBadge } from '@/components/campaigns/common';
import { RulesCard } from '@/components/campaigns/RulesCard';
import { MomentsCard } from '@/components/campaigns/MomentsCard';
import { SourcesCard } from '@/components/campaigns/SourcesCard';
import { UgcCard } from '@/components/campaigns/UgcCard';
import { ResultsCard, SubmissionsCard } from '@/components/campaigns/Submissions';
import { PageHeader } from '@/components/PageHeader';
import { PlatformIcon } from '@/components/publish/common';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { api, errorMessage } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { openExternal } from '@/lib/native';
import { keys, queryClient, useCampaign, useWorkspaces } from '@/lib/queries';
import type { Workspace } from '@/lib/types';

function Note({ children, tone = 'amber' }: { children: React.ReactNode; tone?: 'amber' | 'muted' }) {
  return (
    <div className={tone === 'amber' ? 'flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2.5 text-sm' : 'flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm'}>
      {tone === 'amber' ? <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-400" /> : <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-brand" />}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

async function patch(id: string, body: Record<string, unknown>) {
  const next = await api<CampaignDetail>(`/campaigns/${id}`, { method: 'PATCH', body });
  queryClient.setQueryData(keys.campaign(id), next);
  queryClient.invalidateQueries({ queryKey: keys.campaigns });
  return next;
}

/** The halal screen and the pages to post on: my OK turns a read campaign on. */
function ConfirmCard({ c, workspaces }: { c: CampaignDetail; workspaces: Workspace[] }) {
  const suggested = workspaces.filter((w) => w.modules.includes('campaigns') && w.kind === 'clipping').map((w) => w.id);
  const [pages, setPages] = useState<string[]>(c.pageIds.length ? c.pageIds : suggested.length === 1 ? suggested : []);
  const [busy, setBusy] = useState(false);
  const rejected = c.halalVerdict === 'reject';

  async function confirm() {
    setBusy(true);
    try {
      queryClient.setQueryData(keys.campaign(c.id), await api<CampaignDetail>(`/campaigns/${c.id}/confirm`, { body: { pageIds: pages } }));
      queryClient.invalidateQueries({ queryKey: keys.campaigns });
      toast.success('Campaign confirmed');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className={rejected ? 'border-destructive/40' : 'border-brand/40'}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          {rejected ? 'Not for these pages' : 'Check it, then confirm'} <HalalBadge verdict={c.halalVerdict} />
        </CardTitle>
        <CardDescription>
          {rejected
            ? 'The halal screen rejected this campaign, so it can’t be used. Delete it, or read it again if the page changed.'
            : 'Read the rules and the screen below. Confirming turns it on for the pages you pick; clips are still made only when you ask and go out only with your OK.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {c.halalReasons.length > 0 && (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {c.halalReasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
        {!rejected && (
          <>
            <div className="space-y-2">
              <Label>Post on</Label>
              <PagePicker value={pages} onChange={setPages} workspaces={workspaces} />
            </div>
            <Button onClick={confirm} disabled={busy || !pages.length || !c.readAt || c.reading}>
              {busy && <Spinner />} Confirm campaign
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function OverviewCard({ c, workspaces }: { c: CampaignDetail; workspaces: Workspace[] }) {
  const [editingPages, setEditingPages] = useState(false);
  const [pages, setPages] = useState(c.pageIds);
  const [deadline, setDeadline] = useState(c.deadline ? new Date(c.deadline).toLocaleDateString('sv') : '');
  useEffect(() => setPages(c.pageIds), [c.pageIds]);
  useEffect(() => setDeadline(c.deadline ? new Date(c.deadline).toLocaleDateString('sv') : ''), [c.deadline]);
  const live = c.status === 'active' || c.status === 'paused' || c.status === 'ended';

  async function save(body: Record<string, unknown>) {
    try {
      await patch(c.id, body);
      return true;
    } catch (err) {
      toast.error(errorMessage(err));
      return false;
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Overview</CardTitle>
        {c.readAt && <CardDescription>Read {timeAgo(c.readAt)}.</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-5">
        {c.payouts.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3 font-normal">Platform</th>
                  <th className="py-1 pr-3 font-normal">Per 1K views</th>
                  <th className="py-1 pr-3 font-normal">Min payout</th>
                  <th className="py-1 font-normal">Max payout</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {c.payouts.map((p) => (
                  <tr key={p.platform} className="border-t">
                    <td className="py-1.5 pr-3">
                      <span className="inline-flex items-center gap-1.5">
                        {p.platform !== 'x' && <PlatformIcon platform={p.platform} className="size-3.5" />}
                        {CAMPAIGN_PLATFORM_LABELS[p.platform]}
                      </span>
                    </td>
                    <td className="py-1.5 pr-3">{p.flatFee !== null && p.ratePer1k === null ? `${money(p.flatFee)} flat` : money(p.ratePer1k)}</td>
                    <td className="py-1.5 pr-3">{money(p.minPayout)}</td>
                    <td className="py-1.5">{money(p.maxPayout)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {isMarket(c.origin) && (
            <div className="space-y-1.5">
              <Label>Budget</Label>
              <BudgetBar left={c.budgetLeft} total={c.budgetTotal} />
              {c.budgetCheckedAt && <p className="text-xs text-muted-foreground">Checked {timeAgo(c.budgetCheckedAt)}</p>}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="campaign-deadline">Deadline</Label>
            <Input
              id="campaign-deadline"
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              onBlur={() => {
                const next = deadline ? new Date(`${deadline}T23:59:59`).getTime() : null;
                if (next !== c.deadline) void save({ deadline: next });
              }}
              className="h-9 w-44"
            />
            {deadlineText(c.deadline) && <p className="text-xs text-muted-foreground">{deadlineText(c.deadline)}</p>}
          </div>
        </div>
        {c.accepting === false && <Note>The page says it isn’t accepting clips right now.</Note>}
        {live && (
          <div className="space-y-2">
            <Label>Posts on</Label>
            {editingPages ? (
              <div className="space-y-3">
                <PagePicker value={pages} onChange={setPages} workspaces={workspaces} />
                <div className="flex gap-2">
                  <Button size="sm" disabled={!pages.length} onClick={async () => (await save({ pageIds: pages })) && setEditingPages(false)}>
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => (setPages(c.pageIds), setEditingPages(false))}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <PageChips pageIds={c.pageIds} workspaces={workspaces} className="text-sm" />
                <Button size="sm" variant="ghost" onClick={() => setEditingPages(true)}>
                  Change
                </Button>
              </div>
            )}
          </div>
        )}
        {c.status !== 'to_confirm' && c.halalVerdict && (
          <div className="space-y-1.5">
            <HalalBadge verdict={c.halalVerdict} />
            {c.halalReasons.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                {c.halalReasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function BriefCard({ c }: { c: CampaignDetail }) {
  const [editing, setEditing] = useState(false);
  const [brief, setBrief] = useState(c.description);
  const [busy, setBusy] = useState(false);
  if (!c.description && !c.requirements && c.origin !== 'business') return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Brief</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {editing ? (
          <div className="space-y-2">
            <Textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={8} aria-label="Brief" />
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={busy || !brief.trim()}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await patch(c.id, { brief });
                    setEditing(false);
                    toast('Reading the new brief…');
                  } catch (err) {
                    toast.error(errorMessage(err));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy && <Spinner />} Save and read again
              </Button>
              <Button size="sm" variant="ghost" onClick={() => (setBrief(c.description), setEditing(false))}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm whitespace-pre-wrap">{c.description || 'No brief.'}</p>
            {c.origin === 'business' && (
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                Edit the brief
              </Button>
            )}
          </>
        )}
        {c.requirements && (
          <div className="space-y-1">
            <p className="text-xs font-medium">Creator requirements</p>
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">{c.requirements}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function CampaignPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const campaign = useCampaign(id);
  const { data: workspaces = [] } = useWorkspaces();
  const [deleting, setDeleting] = useState(false);
  const c = campaign.data;

  async function run(fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  if (campaign.error)
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Campaign" />
        <div className="p-6 text-sm text-muted-foreground">
          This campaign doesn’t exist any more.{' '}
          <Link to="/campaigns" className="text-foreground underline">
            All campaigns
          </Link>
        </div>
      </div>
    );
  if (!c)
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Campaign" />
        <div className="mx-auto w-full max-w-3xl space-y-4 p-4 md:p-6">
          <Skeleton className="h-40 rounded-xl" />
          <Skeleton className="h-60 rounded-xl" />
        </div>
      </div>
    );

  const business = workspaces.find((w) => w.id === c.businessWorkspaceId);
  const meta = [c.brand, c.type, c.category, c.origin === 'business' ? `${business?.name ?? 'Your business'}’s own` : null].filter(Boolean).join(' · ');
  const reading = c.reading || c.status === 'reading';

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={
          <span className="flex min-w-0 items-center gap-2">
            <Button variant="ghost" size="icon-sm" asChild aria-label="All campaigns" className="-ml-1.5 shrink-0">
              <Link to="/campaigns">
                <ArrowLeft />
              </Link>
            </Button>
            <span className="truncate">{c.title || 'Reading the campaign…'}</span>
          </span>
        }
        description={meta || undefined}
        actions={
          <>
            <StatusBadge status={c.status} reading={c.reading} rejected={c.halalVerdict === 'reject'} />
            {c.link && (
              <Button size="sm" variant="outline" onClick={() => openExternal(c.link!)} className="max-sm:hidden">
                <ExternalLink /> Open page
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="ghost" aria-label="More">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {c.link && (
                  <DropdownMenuItem onSelect={() => openExternal(c.link!)} className="sm:hidden">
                    <ExternalLink /> Open page
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem disabled={reading} onSelect={() => run(() => api<CampaignDetail>(`/campaigns/${c.id}/read`, { body: {} }).then((d) => queryClient.setQueryData(keys.campaign(c.id), d)))}>
                  <RefreshCw /> Read again
                </DropdownMenuItem>
                {c.status === 'active' && (
                  <DropdownMenuItem onSelect={() => run(() => patch(c.id, { status: 'paused' }))}>
                    <Pause /> Pause
                  </DropdownMenuItem>
                )}
                {(c.status === 'paused' || c.status === 'ended') && (
                  <DropdownMenuItem onSelect={() => run(() => patch(c.id, { status: 'active' }))}>
                    <Play /> Make active again
                  </DropdownMenuItem>
                )}
                {(c.status === 'active' || c.status === 'paused') && (
                  <DropdownMenuItem onSelect={() => run(() => patch(c.id, { status: 'ended' }))}>
                    <Square /> End
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
                  <Trash2 /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
          {reading && <Note tone="muted">{c.origin === 'business' ? 'Reading the brief and screening it…' : 'Reading the campaign’s page and screening it… (pages are read slowly, about half a minute)'}</Note>}
          {c.readNote && !reading && <Note>{c.readNote}</Note>}
          {c.status === 'to_confirm' && !reading && c.readAt && <ConfirmCard c={c} workspaces={workspaces} />}
          {(c.readAt || c.status !== 'reading') && (
            <>
              <OverviewCard c={c} workspaces={workspaces} />
              <ResultsCard campaign={c} />
              <SubmissionsCard campaign={c} />
              <BriefCard c={c} />
              <RulesCard campaign={c} />
              <UgcCard campaign={c} workspaces={workspaces} />
              <MomentsCard campaign={c} workspaces={workspaces} />
              <SourcesCard campaign={c} />
            </>
          )}
        </div>
      </div>
      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{c.title || 'this campaign'}”?</AlertDialogTitle>
            <AlertDialogDescription>Its rules, its page assignments and its downloaded source videos go. Clips already made stay on their boards.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                run(async () => {
                  await api(`/campaigns/${c.id}`, { method: 'DELETE' });
                  queryClient.invalidateQueries({ queryKey: keys.campaigns });
                  navigate('/campaigns');
                })
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
