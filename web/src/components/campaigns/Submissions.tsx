import { CircleAlert, Copy, ExternalLink, MoreHorizontal, Pencil, RefreshCw, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { money, SUBMISSION_STATUS_LABELS, SUBMISSION_STATUSES, type CampaignDetail, type CampaignResults, type Submission, type SubmissionStatus } from '@shared/campaigns';
import { PlatformIcon } from '@/components/publish/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { api, errorMessage, mediaThumbUrl } from '@/lib/api';
import { isDesktop } from '@/lib/desktop';
import { compact, percent, timeAgo } from '@/lib/format';
import { openExternal } from '@/lib/native';
import { keys, queryClient, useSubmissionsSync } from '@/lib/queries';
import { cn } from '@/lib/utils';

/**
 * A Content Rewards page (a campaign, to submit a clip there): in the desktop app it opens in the signed-in window,
 * elsewhere (the phone, a browser) in the browser, where I'm signed in myself.
 */
export async function openOnContentRewards(url: string) {
  if (isDesktop) {
    try {
      const { opened } = await api<{ opened: boolean }>('/sites/open', { body: { url } });
      if (opened) return;
    } catch (err) {
      toast.error(errorMessage(err));
      return;
    }
  }
  openExternal(url);
}

export async function copyLink(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    toast.success('Link copied: paste it in the campaign’s Submit clip box');
  } catch {
    toast.error('Couldn’t copy. Long-press the link to copy it.');
  }
}

/** Save a change and refresh everything that shows submissions. */
export async function patchSubmission(id: string, body: Partial<Pick<Submission, 'status' | 'views' | 'earnings' | 'note'>>) {
  const next = await api<Submission>(`/submissions/${id}`, { method: 'PATCH', body });
  queryClient.invalidateQueries({ queryKey: keys.today });
  queryClient.invalidateQueries({ queryKey: ['campaign'] });
  return next;
}

const STATUS_TONE: Record<SubmissionStatus, string> = {
  to_submit: 'bg-brand text-white',
  submitted: '',
  approved: 'text-emerald-400',
  rejected: 'text-destructive',
  paid: 'text-emerald-400',
  skipped: 'text-muted-foreground',
};

export function SubmissionBadge({ status, className }: { status: SubmissionStatus; className?: string }) {
  return (
    <Badge variant={status === 'to_submit' ? 'default' : 'secondary'} className={cn(STATUS_TONE[status], className)}>
      {SUBMISSION_STATUS_LABELS[status]}
    </Badge>
  );
}

/** What it earned, or an estimate from its views (with why). */
export function EarningsText({ s, className }: { s: Submission; className?: string }) {
  if (s.earnings !== null)
    return (
      <span className={className}>
        {money(s.earnings)}
        {s.earningsFrom === 'you' && <span className="text-muted-foreground"> (typed in)</span>}
      </span>
    );
  if (s.estimate !== null)
    return (
      <span className={cn('text-muted-foreground', className)} title={s.estimateNote ?? 'Views × the rate, until the campaign says'}>
        ~{money(s.estimate)} est.{s.estimateNote ? ` · ${s.estimateNote}` : ''}
      </span>
    );
  return s.estimateNote ? <span className={cn('text-muted-foreground', className)}>{s.estimateNote}</span> : null;
}

/** A posted clip waiting to be submitted: copy its link, open the campaign, then say it's done. */
export function SubmitRow({ s, campaign, workspace }: { s: Submission; campaign: { title: string; link: string | null } | undefined; workspace?: React.ReactNode }) {
  const [busy, setBusy] = useState(false);
  async function set(status: SubmissionStatus) {
    setBusy(true);
    try {
      await patchSubmission(s.id, { status });
      toast.success(status === 'submitted' ? 'Marked as submitted' : 'It won’t be asked for again');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border bg-card p-2.5">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {s.thumbMediaId ? <img src={mediaThumbUrl(s.thumbMediaId)} alt="" loading="lazy" className="h-12 w-9 shrink-0 rounded object-cover" /> : <div className="h-12 w-9 shrink-0 rounded bg-muted" />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{s.pieceTitle}</p>
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <PlatformIcon platform={s.platform} className="size-3" />
            <span className="truncate">{s.accountLabel.replace(/^\S+ /, '')}</span>
            {campaign && (
              <>
                <span aria-hidden>·</span>
                <span className="truncate">{campaign.title}</span>
              </>
            )}
            {workspace}
          </p>
          <a href={s.url} target="_blank" rel="noreferrer" className="block truncate text-xs text-muted-foreground hover:text-foreground hover:underline">
            {s.url.replace(/^https?:\/\/(www\.)?/, '')}
          </a>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button size="sm" variant="outline" onClick={() => copyLink(s.url)}>
          <Copy /> Copy link
        </Button>
        {campaign?.link && (
          <Button size="sm" variant="outline" onClick={() => openOnContentRewards(campaign.link!)}>
            <ExternalLink /> Open campaign
          </Button>
        )}
        <Button size="sm" disabled={busy} onClick={() => set('submitted')}>
          {busy ? <Spinner /> : <Send />} Done
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label="More">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => set('skipped')}>Don’t submit this one</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/** Set a submission's status and the campaign's numbers by hand, when they can't be read from Content Rewards. */
function EditDialog({ s, onClose }: { s: Submission | null; onClose: () => void }) {
  const [status, setStatus] = useState<SubmissionStatus>('submitted');
  const [views, setViews] = useState('');
  const [earnings, setEarnings] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!s) return;
    setStatus(s.status);
    setViews(s.views === null ? '' : String(s.views));
    setEarnings(s.earnings === null ? '' : String(s.earnings));
    setNote(s.note);
  }, [s]);

  async function save() {
    if (!s) return;
    const v = views.trim() ? Number(views.replace(/[,\s]/g, '')) : null;
    const e = earnings.trim() ? Number(earnings.replace(/[$,\s]/g, '')) : null;
    if ((v !== null && !(v >= 0)) || (e !== null && !(e >= 0))) return toast.error('Views and earnings are numbers.');
    setBusy(true);
    try {
      await patchSubmission(s.id, { status, views: v === null ? null : Math.round(v), earnings: e, note });
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!s} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{s?.pieceTitle}</DialogTitle>
          <DialogDescription>What Content Rewards says about this clip. Its next read there replaces the status, views and earnings.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as SubmissionStatus)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUBMISSION_STATUSES.map((st) => (
                  <SelectItem key={st} value={st}>
                    {SUBMISSION_STATUS_LABELS[st]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sub-views">Views counted</Label>
              <Input id="sub-views" inputMode="numeric" placeholder={s?.postViews !== null && s?.postViews !== undefined ? `${s.postViews} on the post` : '—'} value={views} onChange={(e) => setViews(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sub-earnings">Earned ($)</Label>
              <Input id="sub-earnings" inputMode="decimal" placeholder={s?.estimate !== null && s?.estimate !== undefined ? `~${s.estimate} est.` : '—'} value={earnings} onChange={(e) => setEarnings(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sub-note">Note</Label>
            <Textarea id="sub-note" rows={2} placeholder="The campaign’s reason, say" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy && <Spinner />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Check now" and when Content Rewards was last read. */
function SyncLine() {
  const sync = useSubmissionsSync();
  const [busy, setBusy] = useState(false);
  const d = sync.data;
  if (!d) return null;
  async function check() {
    setBusy(true);
    try {
      queryClient.setQueryData(keys.submissionsSync, await api('/submissions/sync', { body: {} }));
      toast('Reading your submissions on Content Rewards…', { description: 'About a minute: pages are read slowly.' });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
      <span className="min-w-0 flex-1">
        {d.running
          ? 'Reading Content Rewards…'
          : d.last
            ? `${d.last.ok ? 'Checked' : 'Last check failed'} ${timeAgo(d.last.at)}${d.last.ok ? ` · ${d.last.matched} matched` : ''}${d.last.note ? ` · ${d.last.note}` : ''}`
            : d.available
              ? 'Checked on Content Rewards once a day while clips wait on the campaign.'
              : 'Statuses and earnings are read from Content Rewards by the desktop app; set them by hand meanwhile.'}
      </span>
      {d.available && (
        <Button size="sm" variant="outline" onClick={check} disabled={busy || d.running}>
          <RefreshCw className={cn((busy || d.running) && 'animate-spin')} /> Check now
        </Button>
      )}
    </div>
  );
}

function SubmissionRow({ s, onEdit, link }: { s: Submission; onEdit: () => void; link: string | null }) {
  const views = s.views ?? s.postViews;
  return (
    <li className="flex items-start gap-3 p-3">
      {s.thumbMediaId ? <img src={mediaThumbUrl(s.thumbMediaId)} alt="" loading="lazy" className="h-12 w-9 shrink-0 rounded object-cover" /> : <div className="h-12 w-9 shrink-0 rounded bg-muted" />}
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="truncate text-sm font-medium">{s.pieceTitle}</p>
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <PlatformIcon platform={s.platform} className="size-3" /> {s.accountLabel.replace(/^\S+ /, '')}
          </span>
          {views !== null && (
            <span>
              {compact(views)} views{s.views === null ? ' on the post' : ' counted'}
            </span>
          )}
          <EarningsText s={s} />
        </p>
        {s.note && <p className={cn('text-xs', s.status === 'rejected' ? 'text-destructive' : 'text-muted-foreground')}>{s.note}</p>}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <SubmissionBadge status={s.status} />
        <div className="flex items-center gap-0.5">
          {s.status === 'to_submit' && link && (
            <Button size="sm" variant="outline" onClick={() => (void copyLink(s.url), void openOnContentRewards(link))}>
              <Send /> Submit
            </Button>
          )}
          <Button size="icon-sm" variant="ghost" aria-label="Open the post" title="Open the post" onClick={() => openExternal(s.url)}>
            <ExternalLink />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="Edit" title="Set status, views, earnings" onClick={onEdit}>
            <Pencil />
          </Button>
        </div>
      </div>
    </li>
  );
}

/** The campaign's posted clips and their submissions: what to submit, what the campaign said, what they earned. */
export function SubmissionsCard({ campaign }: { campaign: CampaignDetail }) {
  const [editing, setEditing] = useState<Submission | null>(null);
  if (campaign.origin !== 'content_rewards' || (!campaign.submissions.length && !campaign.results.posted)) return null;
  const toSubmit = campaign.submissions.filter((s) => s.status === 'to_submit').length;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Submissions {toSubmit > 0 && <Badge className="bg-brand text-white">{toSubmit} to submit</Badge>}
        </CardTitle>
        <CardDescription>
          Each posted clip’s link goes in the campaign’s <span className="text-foreground">Submit clip</span> box on Content Rewards; you submit it, then tap Done.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <SyncLine />
        {campaign.submissions.length ? (
          <ul className="divide-y rounded-lg border">
            {campaign.submissions.map((s) => (
              <SubmissionRow key={s.id} s={s} link={campaign.link} onEdit={() => setEditing(s)} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">Posted clips show here once their posts have links.</p>
        )}
      </CardContent>
      <EditDialog s={editing} onClose={() => setEditing(null)} />
    </Card>
  );
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="space-y-0.5 rounded-lg border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tracking-tight tabular-nums">{value}</p>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

/** A campaign's numbers: clips, views, how often the campaign approves them, earnings. */
export function ResultsTiles({ r, origin }: { r: CampaignResults; origin: CampaignDetail['origin'] }) {
  const s = r.submissions;
  const decided = s.approved + s.paid + s.rejected;
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Tile label="Clips posted" value={String(r.posted)} note={`${r.clips.made} made · ${r.clips.approved} approved by you${r.clips.rejected ? ` · ${r.clips.rejected} rejected` : ''}`} />
      <Tile label="Views" value={compact(r.views)} note={r.posts ? `on ${r.posts} post${r.posts === 1 ? '' : 's'}` : 'nothing posted yet'} />
      {origin === 'content_rewards' ? (
        <>
          <Tile label="Approved by the campaign" value={percent(r.approvalRate, 0)} note={decided ? `${s.approved + s.paid} of ${decided} decided${s.submitted ? ` · ${s.submitted} waiting` : ''}` : s.submitted ? `${s.submitted} waiting` : 'none decided yet'} />
          <Tile
            label="Earnings"
            value={money(r.earned + r.estimated)}
            note={[r.estimated ? `${money(r.estimated)} estimated` : null, r.paid ? `${money(r.paid)} paid` : null, r.perClip !== null ? `${money(r.perClip)} per clip` : null].filter(Boolean).join(' · ') || 'none yet'}
          />
        </>
      ) : (
        <Tile label="In review" value={String(r.clips.inReview)} note="waiting for your yes or no" />
      )}
    </div>
  );
}

export function ResultsCard({ campaign }: { campaign: CampaignDetail }) {
  const r = campaign.results;
  if (!r.clips.made && !r.posted && !campaign.submissions.length) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Results</CardTitle>
        <CardDescription>Views from the platforms; earnings from Content Rewards, or estimated from views × the rate until it says.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ResultsTiles r={r} origin={campaign.origin} />
        {r.budgetLow && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2.5 text-sm">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-400" />
            Its budget is running low ({money(campaign.budgetLeft)} left): clips posted after it runs out may not be paid.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
