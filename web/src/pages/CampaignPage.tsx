import { ArrowLeft, CircleAlert, ClipboardPaste, ExternalLink, Loader2, MoreHorizontal, Pause, Play, RefreshCw, Square, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { CAMPAIGN_PLATFORM_LABELS, isMarket, MARKET_INFO, money, type CampaignDetail } from '@shared/campaigns';
import { BudgetBar, CampaignPicture, deadlineText, HalalBadge, PageChips, PagePicker, rateText, StatusBadge } from '@/components/campaigns/common';
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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

/** What the halal screen left for me to judge, one short line each (the app's own handling isn't listed). */
function HalalCheck({ c }: { c: CampaignDetail }) {
  if (!c.halalVerdict) return null;
  const head = c.halalVerdict === 'ok' ? 'Nothing for you to check.' : c.halalVerdict === 'reject' ? 'Rejected because:' : 'Your call on these:';
  return (
    <div className="space-y-2 rounded-lg border px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <HalalBadge verdict={c.halalVerdict} />
        <span className="text-muted-foreground">{head}</span>
      </div>
      {c.halalVerdict !== 'ok' && c.halalReasons.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {c.halalReasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Which campaign this is, as I know it from the marketplace (its picture, name, brand, pay), what the halal screen
 * leaves to me, then my OK turns it on for its page (one added before pages were picked asks which).
 */
function ConfirmCard({ c, workspaces }: { c: CampaignDetail; workspaces: Workspace[] }) {
  const hasPages = c.pageIds.length > 0;
  const [pages, setPages] = useState<string[]>(c.pageIds);
  const [busy, setBusy] = useState(false);
  const rejected = c.halalVerdict === 'reject';
  const market = isMarket(c.origin) ? MARKET_INFO[c.origin] : null;
  const maxPay = Math.max(0, ...c.payouts.map((p) => p.maxPayout ?? 0));
  const pay = [rateText(c.ratePer1k), maxPay ? `up to ${money(maxPay)} a clip` : null].filter(Boolean).join(' · ');
  const meta = [c.brand, market?.label, c.platforms.map((p) => CAMPAIGN_PLATFORM_LABELS[p]).join(', ')].filter(Boolean).join(' · ');

  async function confirm() {
    setBusy(true);
    try {
      queryClient.setQueryData(keys.campaign(c.id), await api<CampaignDetail>(`/campaigns/${c.id}/confirm`, { body: hasPages ? {} : { pageIds: pages } }));
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
        <CardTitle>{rejected ? 'Not for these pages' : 'Take this campaign?'}</CardTitle>
        <CardDescription>
          {rejected
            ? 'The halal screen rejected it, so it can’t be used. Delete it, or read it again if the page changed.'
            : `Confirming turns it on for ${hasPages ? workspaces.find((w) => w.id === c.pageIds[0])?.name ?? 'its page' : 'the page you pick'}. Clips are still made only when you ask, and go out only with your OK.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row">
          <CampaignPicture link={c.link} className="sm:w-56 sm:shrink-0 sm:self-start" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="space-y-0.5">
              <p className="font-medium">{c.title || 'Untitled campaign'}</p>
              {meta && <p className="text-sm text-muted-foreground">{meta}</p>}
              {pay && <p className="text-sm">{pay}</p>}
            </div>
            {market && <BudgetBar left={c.budgetLeft} total={c.budgetTotal} />}
            {c.link && market && (
              <Button size="sm" variant="outline" onClick={() => openExternal(c.link!)}>
                <ExternalLink /> Open on {market.label}
              </Button>
            )}
          </div>
        </div>
        {c.description && <p className="line-clamp-2 text-sm text-muted-foreground">{c.description}</p>}
        <HalalCheck c={c} />
        {!rejected && (
          <>
            {!hasPages && (
              <div className="space-y-2">
                <Label>Post on</Label>
                <PagePicker value={pages} onChange={setPages} workspaces={workspaces} />
              </div>
            )}
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
        {c.status !== 'to_confirm' && <CampaignPicture link={c.link} className="max-w-xs" />}
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
        {c.status !== 'to_confirm' && <HalalCheck c={c} />}
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

/** When the page can't be read as it should (Vyro's app, a changed layout): read the text I copied from it instead. */
function PasteDialog({ c, open, onOpenChange }: { c: CampaignDetail; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  async function read(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      queryClient.setQueryData(keys.campaign(c.id), await api<CampaignDetail>(`/campaigns/${c.id}/read`, { body: { text: text.trim() } }));
      onOpenChange(false);
      setText('');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={read} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Read from the page’s text</DialogTitle>
            <DialogDescription>Open the campaign, select everything on it (Ctrl+A), copy and paste it here. It’s read and screened like the page itself.</DialogDescription>
          </DialogHeader>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} aria-label="The campaign page’s text" placeholder="The campaign’s name, pay, rules, source links…" />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || text.trim().length < 40}>
              {busy && <Spinner />} Read it
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CampaignPage() {
  const { id = '', wid } = useParams();
  const back = wid ? `/w/${wid}/campaigns` : '/campaigns';
  const [pasting, setPasting] = useState(false);
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
          <Link to={back} className="text-foreground underline">
            Back to campaigns
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
            <Button variant="ghost" size="icon-sm" asChild aria-label="Back to campaigns" className="-ml-1.5 shrink-0">
              <Link to={back}>
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
                {isMarket(c.origin) && (
                  <DropdownMenuItem disabled={reading} onSelect={() => setPasting(true)}>
                    <ClipboardPaste /> Read from pasted text
                  </DropdownMenuItem>
                )}
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
      <PasteDialog c={c} open={pasting} onOpenChange={setPasting} />
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
                  navigate(back);
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
