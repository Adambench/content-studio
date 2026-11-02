import { AlertCircle, BadgeDollarSign, CalendarCheck, Clapperboard, Loader2, Sparkles, Telescope } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { isMarket, money } from '@shared/campaigns';
import { KIND_INFO } from '@shared/types';
import { BudgetBar, deadlineText, HalalBadge, rateText } from '@/components/campaigns/common';
import { SubmitRow } from '@/components/campaigns/Submissions';
import { KIND_ICONS } from '@/components/KindPicker';
import { PageHeader } from '@/components/PageHeader';
import { PlatformIcon, StatusIcon, formatTime, formatWhen, statusText } from '@/components/publish/common';
import { PostSheet } from '@/components/publish/PostSheet';
import { UsageMeter } from '@/components/UsageMeter';
import { WorkspaceDot } from '@/components/WorkspaceDot';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { mediaThumbUrl } from '@/lib/api';
import { duration, timeAgo } from '@/lib/format';
import { useToday } from '@/lib/queries';
import type { Post, TodayActiveCampaign, TodayData, TodayWork } from '@/lib/types';
import { cn } from '@/lib/utils';

type Ws = TodayData['workspaces'][number];

const isToday = (ms: number) => new Date(ms).toDateString() === new Date().toDateString();

function Section({ title, count, children, className }: { title: string; count?: number; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('space-y-2.5', className)} aria-label={title}>
      <h2 className="flex items-center gap-2 text-sm font-medium">
        {title}
        {!!count && <span className="text-muted-foreground tabular-nums">{count}</span>}
      </h2>
      {children}
    </section>
  );
}

function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed px-3 py-2.5 text-sm text-muted-foreground">{children}</p>;
}

function WsTag({ ws }: { ws: Ws | undefined }) {
  if (!ws) return null;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <WorkspaceDot color={ws.color} className="size-2" />
      <span className="truncate">{ws.name}</span>
    </span>
  );
}

function PostRow({ post, ws, onOpen, showDay }: { post: Post; ws: Ws | undefined; onOpen: () => void; showDay?: boolean }) {
  const attention = post.status === 'failed' || post.status === 'missed';
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn('flex w-full items-center gap-3 rounded-lg border bg-card p-2.5 text-left hover:border-foreground/20', attention && 'border-destructive/40 bg-destructive/5')}
    >
      {post.thumbMediaId ? <img src={mediaThumbUrl(post.thumbMediaId)} alt="" loading="lazy" className="h-12 w-9 shrink-0 rounded object-cover" /> : <div className="h-12 w-9 shrink-0 rounded bg-muted" />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{post.pieceTitle}</p>
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <PlatformIcon platform={post.platform} className="size-3" />
          <span className="truncate">{post.account ? (post.account.handle ? `@${post.account.handle}` : post.account.name) : post.accountLabel}</span>
          <span aria-hidden>·</span>
          <WsTag ws={ws} />
        </p>
        {attention && post.error && <p className="mt-0.5 line-clamp-2 text-xs text-destructive">{post.error}</p>}
      </div>
      <div className="shrink-0 text-right">
        <p className="text-xs tabular-nums">{showDay && !isToday(post.scheduledAt) ? formatWhen(post.scheduledAt, { weekday: false }) : formatTime(post.scheduledAt)}</p>
        <p className="flex items-center justify-end gap-1 text-xs text-muted-foreground">
          <StatusIcon post={post} className="size-3" />
          {statusText(post)}
        </p>
      </div>
    </button>
  );
}

function ReviewTile({ item, ws }: { item: TodayData['review'][number]; ws: Ws | undefined }) {
  return (
    <Link to={`/w/${item.workspaceId}/p/${item.id}`} className="group flex min-w-0 flex-col gap-1.5">
      <div className="relative aspect-[9/16] overflow-hidden rounded-lg border bg-muted group-hover:border-foreground/30">
        {item.thumbMediaId ? (
          <img src={mediaThumbUrl(item.thumbMediaId)} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <div className="grid size-full place-items-center text-muted-foreground">
            <Clapperboard className="size-5" />
          </div>
        )}
        {!!item.durationMs && <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 text-[10px] text-white tabular-nums">{duration(item.durationMs)}</span>}
      </div>
      <p className="line-clamp-2 text-xs font-medium">{item.title}</p>
      <p className="truncate text-[11px] text-muted-foreground">
        <WsTag ws={ws} />
      </p>
    </Link>
  );
}

function WorkRow({ item, ws }: { item: TodayWork; ws: Ws | undefined }) {
  const pct = item.progress === null ? null : Math.round(Math.min(1, Math.max(0, item.progress)) * 100);
  const body = (
    <div className="space-y-1.5 rounded-lg border bg-card p-2.5">
      <div className="flex items-start gap-2">
        {item.status === 'running' ? <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-brand" /> : <span className="mt-1.5 size-2 shrink-0 rounded-full bg-muted-foreground/40" />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">{item.title}</p>
          <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="truncate">{item.detail}</span>
            {ws && (
              <>
                <span aria-hidden>·</span>
                <WsTag ws={ws} />
              </>
            )}
          </p>
        </div>
        {pct !== null && <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{pct}%</span>}
      </div>
      {pct !== null && (
        <div className="h-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={item.title}>
          <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
  const to =
    item.type === 'render' && item.workspaceId && item.pieceId
      ? `/w/${item.workspaceId}/p/${item.pieceId}`
      : item.type === 'transcribe' && item.workspaceId
        ? item.pieceId
          ? `/w/${item.workspaceId}/p/${item.pieceId}`
          : `/w/${item.workspaceId}/inbox`
        : (item.type === 'source' || item.type === 'clip') && item.campaignId
          ? `/campaigns/${item.campaignId}`
          : null;
  return to ? (
    <Link to={to} className="block hover:opacity-90">
      {body}
    </Link>
  ) : (
    body
  );
}

function CampaignTile({ c }: { c: TodayActiveCampaign }) {
  const deadline = deadlineText(c.deadline);
  const earnings = c.earned + c.estimated;
  return (
    <Link to={`/campaigns/${c.id}`} className="block space-y-2 rounded-lg border bg-card p-3 hover:border-foreground/20">
      <div className="flex items-start gap-2">
        <BadgeDollarSign className="mt-0.5 size-4 shrink-0 text-orange-400" />
        <span className="min-w-0 flex-1 text-sm font-medium">{c.title}</span>
      </div>
      <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
        {rateText(c.ratePer1k) && <span className="text-foreground">{rateText(c.ratePer1k)}</span>}
        {deadline && <span>{deadline}</span>}
      </p>
      {isMarket(c.origin) && <BudgetBar left={c.budgetLeft} total={c.budgetTotal} />}
      {c.posted > 0 && (
        <p className="text-xs text-muted-foreground">
          {c.posted} clip{c.posted === 1 ? '' : 's'} posted
          {isMarket(c.origin) && earnings > 0 && (
            <>
              {' · '}
              <span className="text-foreground">{money(earnings)}</span>
              {c.estimated ? ' (partly estimated)' : ' earned'}
            </>
          )}
        </p>
      )}
      {c.accepting === false ? (
        <p className="text-xs text-amber-400">Its page says it isn’t accepting clips: pause it.</p>
      ) : (
        c.budgetLow && <p className="text-xs text-amber-400">Budget running low: clips posted after it runs out may not be paid.</p>
      )}
    </Link>
  );
}

function PageCard({ ws }: { ws: Ws }) {
  const Icon = KIND_ICONS[ws.kind];
  const busy = ws.stages.filter((s) => s.count > 0);
  return (
    <Link to={`/w/${ws.id}/board`} className="block space-y-2 rounded-lg border bg-card p-3 hover:border-foreground/20">
      <div className="flex items-center gap-2">
        <WorkspaceDot color={ws.color} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{ws.name}</span>
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
          <Icon className="size-3" /> {KIND_INFO[ws.kind].label}
        </span>
      </div>
      {busy.length ? (
        <div className="flex flex-wrap gap-1">
          {busy.map((s) => (
            <Badge key={s.id} variant="secondary" className="h-5 gap-1 px-1.5 text-[11px] font-normal">
              {s.name} <span className="tabular-nums">{s.count}</span>
            </Badge>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">The board is empty.</p>
      )}
      <p className="text-xs text-muted-foreground">
        {ws.nextPostAt ? `Next post ${formatWhen(ws.nextPostAt)}` : ws.lastPostedAt ? `Last posted ${timeAgo(ws.lastPostedAt)}, nothing scheduled` : 'Nothing scheduled'}
      </p>
    </Link>
  );
}

export function TodayPage() {
  const today = useToday();
  const [openPost, setOpenPost] = useState<Post | null>(null);
  const data = today.data;
  const wsById = new Map((data?.workspaces ?? []).map((w) => [w.id, w]));
  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  if (!data)
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Today" description={dateLabel} />
        <div className="mx-auto w-full max-w-5xl space-y-4 p-4 md:p-6">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
      </div>
    );

  // Failed and missed posts are under "Waiting for you" instead.
  const todays = data.posts.filter((p) => p.status !== 'failed' && p.status !== 'missed');
  const toPost = todays.filter((p) => p.status === 'scheduled' || p.status === 'publishing').length;
  const toConfirm = data.campaigns?.toConfirm ?? [];
  const activeCampaigns = data.campaigns?.active ?? [];
  const submissions = data.submissions ?? [];
  const campaignsById = new Map([...activeCampaigns, ...toConfirm].map((c) => [c.id, c]));
  const needsYou = data.review.length + data.attention.length + data.reviews.length + toConfirm.length + submissions.length;

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Today" description={dateLabel} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid max-w-5xl gap-6 p-4 md:p-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="min-w-0 space-y-6">
            <Section title="Waiting for you" count={needsYou}>
              {!needsYou && <Quiet>Nothing needs you right now.</Quiet>}
              {data.attention.length > 0 && (
                <div className="space-y-2">
                  <p className="flex items-center gap-1.5 text-xs text-destructive">
                    <AlertCircle className="size-3.5" />
                    {data.attention.length === 1 ? 'A post didn’t go out' : `${data.attention.length} posts didn’t go out`}: open {data.attention.length === 1 ? 'it' : 'one'} to retry or move it.
                  </p>
                  {data.attention.map((p) => (
                    <PostRow key={p.id} post={p} ws={wsById.get(p.workspaceId)} onOpen={() => setOpenPost(p)} showDay />
                  ))}
                </div>
              )}
              {data.review.length > 0 && (
                <div className="space-y-2">
                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    {data.review.length === 1 ? 'A clip is' : `${data.review.length} clips are`} ready for your yes or no.
                    <Link to={`/w/${data.review[0].workspaceId}/p/${data.review[0].id}`} className="text-foreground underline-offset-2 hover:underline">
                      Review {data.review.length === 1 ? 'it' : 'them'}
                    </Link>
                  </p>
                  <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
                    {data.review.map((item) => (
                      <ReviewTile key={item.id} item={item} ws={wsById.get(item.workspaceId)} />
                    ))}
                  </div>
                </div>
              )}
              {submissions.length > 0 && (
                <div className="space-y-2">
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <BadgeDollarSign className="size-3.5 text-orange-400" />
                    {submissions.length === 1 ? 'A clip is' : `${submissions.length} clips are`} posted: submit {submissions.length === 1 ? 'its link' : 'their links'} on the campaign’s page
                    {data.desktop ? '' : ' (the campaign opens in your browser)'}, then tap Done.
                  </p>
                  {submissions.map((s) => (
                    <SubmitRow key={s.id} s={s} campaign={campaignsById.get(s.campaignId)} />
                  ))}
                </div>
              )}
              {toConfirm.map((c) => (
                <Link key={c.id} to={`/campaigns/${c.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border bg-card p-2.5 hover:border-foreground/20">
                  <BadgeDollarSign className="size-4 shrink-0 text-orange-400" />
                  <span className="min-w-0 flex-1 text-sm">
                    Confirm the campaign <span className="font-medium">{c.title || 'you added'}</span>
                  </span>
                  <HalalBadge verdict={c.halalVerdict} />
                </Link>
              ))}
              {data.reviews.map((r) => (
                <Link key={r.id} to={`/w/${r.workspaceId}/analytics`} className="flex items-center gap-3 rounded-lg border bg-card p-2.5 hover:border-foreground/20">
                  <Sparkles className="size-4 shrink-0 text-brand" />
                  <span className="min-w-0 flex-1 text-sm">
                    Claude’s weekly review of <span className="font-medium">{wsById.get(r.workspaceId)?.name ?? 'a workspace'}</span> is ready
                  </span>
                  {r.finishedAt && <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(r.finishedAt)}</span>}
                </Link>
              ))}
            </Section>

            <Section title="Posting today" count={todays.length}>
              {todays.length ? (
                <div className="space-y-2">
                  {toPost === 0 && (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <CalendarCheck className="size-3.5" /> Everything for today has gone out.
                    </p>
                  )}
                  {todays.map((p) => (
                    <PostRow key={p.id} post={p} ws={wsById.get(p.workspaceId)} onOpen={() => setOpenPost(p)} />
                  ))}
                </div>
              ) : (
                <Quiet>Nothing is scheduled today.</Quiet>
              )}
            </Section>

            <Section title="Running" count={data.work.length}>
              {data.work.length ? (
                <div className="space-y-2">
                  {data.work.map((w) => (
                    <WorkRow key={`${w.type}-${w.id}`} item={w} ws={w.workspaceId ? wsById.get(w.workspaceId) : undefined} />
                  ))}
                </div>
              ) : (
                <Quiet>Nothing is running.</Quiet>
              )}
            </Section>
          </div>

          <div className="min-w-0 space-y-6">
            <Section title="Pages" count={data.workspaces.length}>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                {data.workspaces.map((w) => (
                  <PageCard key={w.id} ws={w} />
                ))}
              </div>
            </Section>
            {activeCampaigns.length > 0 && (
              <Section title="Campaigns" count={activeCampaigns.length}>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                  {activeCampaigns.map((c) => (
                    <CampaignTile key={c.id} c={c} />
                  ))}
                </div>
              </Section>
            )}
            {(data.briefs ?? []).length > 0 && (
              <Section title="Research">
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                  {data.briefs.map((b) => (
                    <Link key={b.id} to={`/w/${b.workspaceId}/research`} className="block space-y-1.5 rounded-lg border bg-card p-3 hover:border-foreground/20">
                      <p className="flex items-start gap-2 text-sm font-medium">
                        <Telescope className="mt-0.5 size-4 shrink-0 text-brand" /> {b.headline}
                      </p>
                      {b.patterns.length > 0 && <p className="line-clamp-2 text-xs text-muted-foreground">{b.patterns.join(' · ')}</p>}
                      <p className="flex items-center gap-2 text-xs text-muted-foreground">
                        <WsTag ws={wsById.get(b.workspaceId)} />
                        {b.ideas > 0 && <span>· {b.ideas} idea{b.ideas === 1 ? '' : 's'}</span>}
                      </p>
                    </Link>
                  ))}
                </div>
              </Section>
            )}
            {data.usage && (
              <Section title="Claude">
                <UsageMeter usage={data.usage} className="rounded-lg border bg-card px-3 py-2.5" />
              </Section>
            )}
          </div>
        </div>
      </div>
      <PostSheet postId={openPost?.id ?? null} wid={openPost?.workspaceId ?? ''} onClose={() => setOpenPost(null)} />
    </div>
  );
}
