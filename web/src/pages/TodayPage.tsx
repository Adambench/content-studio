import { AlertCircle, AlertTriangle, BadgeDollarSign, ChevronRight, Clapperboard, Copy, Eye, Loader2, Play, Sparkles, Telescope, Users } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { campaignPicture, isMarket, money } from '@shared/campaigns';
import { GOAL_CHOICES, goalText, type DashAttention, type DashPost, type DashVideo, type PageColumn } from '@shared/dashboard';
import { KIND_INFO } from '@shared/types';
import { BudgetBar, CampaignPicture, deadlineText, HalalBadge, rateText } from '@/components/campaigns/common';
import { SubmitRow } from '@/components/campaigns/Submissions';
import { KIND_ICONS } from '@/components/KindPicker';
import { PageHeader } from '@/components/PageHeader';
import { PlatformIcon } from '@/components/publish/common';
import { PostSheet } from '@/components/publish/PostSheet';
import { UsageMeter } from '@/components/UsageMeter';
import { WorkspaceDot } from '@/components/WorkspaceDot';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { api, errorMessage, mediaThumbUrl } from '@/lib/api';
import { copyFixLine, VIDEO_LOOK, videoLabel, whenText } from '@/lib/dashboard';
import { compact, duration, timeAgo } from '@/lib/format';
import { keys, queryClient, useToday } from '@/lib/queries';
import type { TodayActiveCampaign, TodayData, TodayWork } from '@/lib/types';
import { cn } from '@/lib/utils';

type Ws = TodayData['workspaces'][number];
type OpenPost = { id: string; wid: string } | null;

function WsTag({ ws }: { ws: Pick<Ws, 'name' | 'color'> | undefined }) {
  if (!ws) return null;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <WorkspaceDot color={ws.color} className="size-2" />
      <span className="truncate">{ws.name}</span>
    </span>
  );
}

function Thumb({ mediaId, className }: { mediaId: string | null; className?: string }) {
  return mediaId ? (
    <img src={mediaThumbUrl(mediaId)} alt="" loading="lazy" className={cn('shrink-0 rounded object-cover', className)} />
  ) : (
    <div className={cn('grid shrink-0 place-items-center rounded bg-muted text-muted-foreground', className)}>
      <Clapperboard className="size-3.5" />
    </div>
  );
}

// ---------- the strip on top: the whole picture in four numbers ----------

function Tile({ label, children, className, to }: { label: string; children: React.ReactNode; className?: string; to?: string }) {
  const body = (
    <>
      <p className="text-xs text-muted-foreground">{label}</p>
      {children}
    </>
  );
  const cls = cn('flex min-w-0 flex-col gap-1 rounded-xl border bg-card p-3', to && 'hover:border-foreground/20', className);
  return to ? (
    <Link to={to} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function Summary({ pages, work }: { pages: PageColumn[]; work: TodayWork[] }) {
  const yours = pages.flatMap((p) => p.yourTurn.map((v) => ({ ...v, wid: p.id })));
  const toWatch = yours.filter((v) => v.state !== 'ready');
  const claude = pages.flatMap((p) => p.withClaude);
  const comments = claude.reduce((n, v) => n + v.open, 0);
  const rendering = claude.filter((v) => v.rendering).length;
  const making = pages.reduce((n, p) => n + p.making, 0);
  const postedToday = pages.reduce((n, p) => n + p.today.posted, 0);
  const goingToday = pages.reduce((n, p) => n + p.today.scheduled, 0);
  const next = pages
    .flatMap((p) => p.goingOut)
    .filter((p) => p.status === 'scheduled')
    .sort((a, b) => a.at - b.at)[0];
  const views = pages.map((p) => p.stats.views).filter((v): v is number => v !== null);
  const followers = pages.map((p) => p.stats.followers).filter((v): v is number => v !== null);
  const first = toWatch[0] ?? yours[0];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Tile label="Your turn" to={first ? `/w/${first.wid}/p/${first.id}` : undefined} className={cn(yours.length > 0 && 'border-sky-400/30 bg-sky-400/5')}>
        <p className="text-2xl font-semibold tabular-nums">{yours.length}</p>
        <p className="flex items-center gap-1 text-xs text-muted-foreground">
          {yours.length ? (
            <>
              <Play className="size-3" /> {toWatch.length ? `Watch the first of ${toWatch.length}` : 'Schedule the approved ones'}
            </>
          ) : (
            'Nothing to watch'
          )}
        </p>
      </Tile>
      <Tile label="With Claude" className={cn(claude.length > 0 && 'border-amber-400/30 bg-amber-400/5')}>
        <p className="text-2xl font-semibold tabular-nums">
          {claude.length}
          {comments > 0 && <span className="ml-1.5 text-sm font-normal text-muted-foreground">{comments} comment{comments === 1 ? '' : 's'}</span>}
        </p>
        {comments > 0 ? (
          <button type="button" onClick={copyFixLine} className="flex items-center gap-1 text-left text-xs text-amber-300 hover:underline">
            <Copy className="size-3 shrink-0" /> Say “fix my comments” in Claude Code
          </button>
        ) : (
          <p className="text-xs text-muted-foreground">{rendering ? `${rendering} rendering` : making ? `Making ${making} clip${making === 1 ? '' : 's'}` : 'Nothing to fix'}</p>
        )}
      </Tile>
      <Tile label="Going out today">
        <p className="text-2xl font-semibold tabular-nums">
          {postedToday}
          <span className="text-sm font-normal text-muted-foreground"> posted · {goingToday} to go</span>
        </p>
        <p className="truncate text-xs text-muted-foreground">{next ? `Next ${whenText(next.at)}: ${next.title}` : 'Nothing scheduled'}</p>
      </Tile>
      <Tile label="Last 7 days">
        <p className="text-2xl font-semibold tabular-nums">
          {views.length ? compact(views.reduce((a, b) => a + b, 0)) : '–'}
          <span className="text-sm font-normal text-muted-foreground"> views</span>
        </p>
        <p className="text-xs text-muted-foreground">
          {followers.length ? `${compact(followers.reduce((a, b) => a + b, 0))} followers` : 'No numbers yet: they come in after the first posts'}
          {work.length > 0 && ` · ${work.length} job${work.length === 1 ? '' : 's'} running`}
        </p>
      </Tile>
    </div>
  );
}

// ---------- one column per page ----------

function VideoRow({ v, wid }: { v: DashVideo; wid: string }) {
  const look = VIDEO_LOOK[v.state];
  const Icon = v.rendering ? Loader2 : look.icon;
  const pct = v.rendering?.status === 'running' ? Math.round(v.rendering.progress * 100) : null;
  return (
    <Link to={`/w/${wid}/p/${v.id}`} className="flex items-center gap-2.5 rounded-lg p-1.5 hover:bg-muted/50">
      <div className="relative">
        <Thumb mediaId={v.thumbMediaId} className="h-14 w-8" />
        {!!v.durationMs && <span className="absolute right-0 bottom-0 rounded-tl bg-black/70 px-0.5 text-[9px] text-white tabular-nums">{duration(v.durationMs)}</span>}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="line-clamp-2 text-xs leading-snug font-medium">{v.title}</p>
        <span className={cn('inline-flex max-w-full items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px]', look.chip)}>
          <Icon className={cn('size-3 shrink-0', v.rendering && 'animate-spin')} />
          <span className="truncate">{videoLabel(v)}</span>
        </span>
        {pct !== null && (
          <div className="h-0.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-brand" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
    </Link>
  );
}

function PostLine({ p, onOpen }: { p: DashPost; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left hover:bg-muted/50">
      <Thumb mediaId={p.thumbMediaId} className="h-10 w-6" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{p.title}</p>
        <p className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
          <PlatformIcon platform={p.platform} className="size-3" />
          <span className="truncate">{p.account}</span>
        </p>
      </div>
      <span className="shrink-0 text-right text-[11px] tabular-nums">
        {p.status === 'published' ? (
          <span className="flex items-center gap-1 text-muted-foreground">
            <Eye className="size-3" /> {compact(p.views)}
          </span>
        ) : p.status === 'publishing' ? (
          <span className="text-brand">Posting</span>
        ) : (
          whenText(p.at)
        )}
      </span>
    </button>
  );
}

function Block({ title, count, tone, children, action }: { title: string; count?: number; tone?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 px-1.5">
        <h3 className={cn('text-xs font-medium', tone)}>{title}</h3>
        {count !== undefined && <span className="text-xs text-muted-foreground tabular-nums">{count}</span>}
        <span className="ml-auto">{action}</span>
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-1.5 text-[11px] text-muted-foreground">{children}</p>;
}

/** Long lists fold after a few. */
function Folded<T>({ items, render, keyOf, show = 5 }: { items: T[]; render: (t: T) => React.ReactNode; keyOf: (t: T) => string; show?: number }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, show);
  return (
    <div>
      {shown.map((t) => (
        <div key={keyOf(t)}>{render(t)}</div>
      ))}
      {items.length > show && (
        <button type="button" onClick={() => setAll((a) => !a)} className="px-1.5 text-[11px] text-muted-foreground hover:text-foreground">
          {all ? 'Show fewer' : `Show all ${items.length}`}
        </button>
      )}
    </div>
  );
}

function GoalPicker({ page }: { page: PageColumn }) {
  async function set(perWeek: number) {
    try {
      await api(`/workspaces/${page.id}/goal`, { method: 'PUT', body: { perWeek } });
      queryClient.invalidateQueries({ queryKey: keys.today });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }
  return (
    <Select value={String(page.goal)} onValueChange={(v) => set(Number(v))}>
      <SelectTrigger size="sm" className="h-6 gap-1 border-0 bg-transparent px-1.5 text-[11px] text-muted-foreground shadow-none" aria-label={`${page.name}: posts a week`}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {GOAL_CHOICES.map((n) => (
          <SelectItem key={n} value={String(n)}>
            Goal: {goalText(n)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Progress({ page }: { page: PageColumn }) {
  const total = Math.max(page.goal, page.week.posted + page.week.scheduled, 1);
  const perDay = page.goal >= 7 ? Math.round(page.goal / 7) : null;
  const today = page.today.posted + page.today.scheduled;
  return (
    <div className="space-y-1 px-1.5">
      <div className="flex items-center gap-2 text-[11px]">
        <span>
          This week <span className="font-medium tabular-nums">{page.week.posted + page.week.scheduled}</span>
          <span className="text-muted-foreground tabular-nums">/{page.goal}</span>
        </span>
        {perDay !== null && (
          <span className={cn(today < perDay ? 'text-amber-300' : 'text-emerald-400')}>
            Today <span className="tabular-nums">{today}</span>/{perDay}
          </span>
        )}
        <span className="ml-auto">
          <GoalPicker page={page} />
        </span>
      </div>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={`${page.week.posted} posted and ${page.week.scheduled} scheduled of ${page.goal} this week`}>
        <div className="h-full bg-emerald-500" style={{ width: `${(page.week.posted / total) * 100}%` }} />
        <div className="h-full bg-emerald-500/40" style={{ width: `${(page.week.scheduled / total) * 100}%` }} />
      </div>
    </div>
  );
}

function Stat({ icon: Icon, value, label }: { icon: typeof Eye; value: string; label: string }) {
  return (
    <div className="min-w-0 flex-1 rounded-md bg-muted/40 px-2 py-1.5">
      <p className="flex items-center gap-1 text-sm font-medium tabular-nums">
        <Icon className="size-3 text-muted-foreground" /> {value}
      </p>
      <p className="truncate text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

function AttentionLine({ a, onPost }: { a: DashAttention; onPost: (id: string) => void }) {
  const cls = cn('flex w-full items-start gap-1.5 rounded-md px-2 py-1.5 text-left text-[11px]', a.tone === 'red' ? 'bg-destructive/10 text-red-300' : 'bg-amber-400/10 text-amber-200');
  const Icon = a.tone === 'red' ? AlertCircle : AlertTriangle;
  const body = (
    <>
      <Icon className="mt-px size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">{a.text}</span>
      {(a.to || a.postId) && <ChevronRight className="mt-px size-3.5 shrink-0 opacity-60" />}
    </>
  );
  if (a.postId)
    return (
      <button type="button" className={cls} onClick={() => onPost(a.postId!)}>
        {body}
      </button>
    );
  if (a.to)
    return (
      <Link to={a.to} className={cls}>
        {body}
      </Link>
    );
  return <div className={cls}>{body}</div>;
}

function Column({ page, onPost }: { page: PageColumn; onPost: (p: OpenPost) => void }) {
  const Icon = KIND_ICONS[page.kind];
  const comments = page.withClaude.reduce((n, v) => n + v.open, 0);
  const s = page.stats;
  return (
    <section id={`col-${page.id}`} className="flex w-[86vw] max-w-sm shrink-0 scroll-ml-4 snap-start flex-col gap-3 rounded-xl border bg-card p-2.5 sm:w-80 md:scroll-ml-6 xl:w-auto xl:max-w-none" aria-label={page.name}>
      <header className="space-y-1 px-1.5 pt-1">
        <div className="flex items-center gap-2">
          <WorkspaceDot color={page.color} />
          <Link to={`/w/${page.id}/board`} className="min-w-0 flex-1 truncate text-sm font-semibold hover:underline">
            {page.name}
          </Link>
          <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground" title={KIND_INFO[page.kind].label}>
            <Icon className="size-3" />
          </span>
        </div>
        <Link to={`/w/${page.id}/accounts`} className="block space-y-0.5 text-[11px] text-muted-foreground hover:text-foreground">
          {page.accounts.length ? (
            page.accounts.map((a) => (
              <span key={a.id} className="flex min-w-0 items-center gap-1">
                <PlatformIcon platform={a.platform} className="size-3" />
                <span className={cn('truncate', a.status === 'reconnect' && 'text-destructive')}>{a.label}</span>
                <span className="shrink-0">· {a.times.join(', ') || 'no posting times'}</span>
              </span>
            ))
          ) : (
            <span>No account connected</span>
          )}
        </Link>
      </header>

      <Progress page={page} />

      <div className="flex gap-1.5 px-1.5">
        <Stat icon={Eye} value={compact(s.views)} label="views, 7 days" />
        <Stat icon={Users} value={s.followers === null ? '–' : `${compact(s.followers)}${s.followersChange ? ` ${s.followersChange > 0 ? '+' : ''}${compact(s.followersChange)}` : ''}`} label="followers" />
        <Stat icon={Play} value={String(s.posts)} label="posts, 7 days" />
      </div>

      {page.attention.length > 0 && (
        <div className="space-y-1 px-1.5">
          {page.attention.map((a) => (
            <AttentionLine key={a.id} a={a} onPost={(id) => onPost({ id, wid: page.id })} />
          ))}
        </div>
      )}

      <Block title="Your turn" count={page.yourTurn.length} tone={page.yourTurn.length ? 'text-sky-300' : undefined}>
        {page.yourTurn.length ? <Folded items={page.yourTurn} keyOf={(v) => v.id} render={(v) => <VideoRow v={v} wid={page.id} />} /> : <Empty>Nothing to watch.</Empty>}
      </Block>

      <Block
        title="With Claude"
        count={page.withClaude.length}
        tone={page.withClaude.length ? 'text-amber-300' : undefined}
        action={
          comments > 0 && (
            <button type="button" onClick={copyFixLine} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground" title="Copy what to say in Claude Code">
              <Copy className="size-3" /> {comments}
            </button>
          )
        }
      >
        {page.withClaude.length ? <Folded items={page.withClaude} show={3} keyOf={(v) => v.id} render={(v) => <VideoRow v={v} wid={page.id} />} /> : <Empty>Nothing to fix.</Empty>}
        {page.making > 0 && (
          <p className="flex items-center gap-1.5 px-1.5 pt-1 text-[11px] text-muted-foreground">
            <Loader2 className="size-3 animate-spin text-brand" /> Making {page.making} new clip{page.making === 1 ? '' : 's'}
          </p>
        )}
      </Block>

      <Block title="Going out" count={page.goingOut.length}>
        {page.goingOut.length ? (
          <Folded items={page.goingOut} show={4} keyOf={(p) => p.id} render={(p) => <PostLine p={p} onOpen={() => onPost({ id: p.id, wid: page.id })} />} />
        ) : (
          <Empty>Nothing scheduled.</Empty>
        )}
      </Block>

      {page.posted.length > 0 && (
        <Block title="Posted lately">
          {page.posted.map((p) => (
            <PostLine key={p.id} p={p} onOpen={() => onPost({ id: p.id, wid: page.id })} />
          ))}
        </Block>
      )}

      {page.earlier.length > 0 && (
        <Link to={`/w/${page.id}/board`} className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-muted/50 hover:text-foreground">
          <span>Earlier:</span>
          {page.earlier.map((e) => (
            <span key={e.id}>
              {e.name} <span className="tabular-nums">{e.count}</span>
            </span>
          ))}
          <ChevronRight className="ml-auto size-3" />
        </Link>
      )}
    </section>
  );
}

// ---------- below the columns ----------

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
    </Link>
  );
}

/**
 * The dashboard: what needs me across every page in four numbers, then one column per page (posting goal, numbers,
 * what needs me there, videos to watch, videos with Claude, what goes out and what went out), then what's running,
 * campaigns, research and Claude usage.
 */
export function TodayPage() {
  const today = useToday();
  const [openPost, setOpenPost] = useState<OpenPost>(null);
  const data = today.data;
  const dateLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  if (!data)
    return (
      <div className="flex h-full flex-col">
        <PageHeader title="Dashboard" description={dateLabel} />
        <div className="space-y-4 p-4 md:p-6">
          <Skeleton className="h-24 rounded-xl" />
          <div className="flex gap-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-96 w-80 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );

  const pages = data.pages ?? [];
  const wsById = new Map(data.workspaces.map((w) => [w.id, w]));
  const toConfirm = data.campaigns?.toConfirm ?? [];
  const activeCampaigns = data.campaigns?.active ?? [];
  const submissions = data.submissions ?? [];
  const campaignsById = new Map([...activeCampaigns, ...toConfirm].map((c) => [c.id, c]));
  const elsewhere = toConfirm.length + submissions.length + data.reviews.length;

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Dashboard" description={dateLabel} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="space-y-6 p-4 md:p-6">
          {pages.length ? <Summary pages={pages} work={data.work} /> : <p className="text-sm text-muted-foreground">Restart the app to see the dashboard.</p>}

          {elsewhere > 0 && (
            <Section title="Also needs you" count={elsewhere}>
              <div className="space-y-2">
                {submissions.length > 0 && (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <BadgeDollarSign className="size-3.5 text-orange-400" />
                    {submissions.length === 1 ? 'A clip is' : `${submissions.length} clips are`} posted: submit {submissions.length === 1 ? 'its link' : 'their links'} on the campaign’s page
                    {data.desktop ? '' : ' (the campaign opens in your browser)'}, then tap Done.
                  </p>
                )}
                {submissions.map((s) => (
                  <SubmitRow key={s.id} s={s} campaign={campaignsById.get(s.campaignId)} />
                ))}
                {toConfirm.map((c) => (
                  <Link key={c.id} to={`/campaigns/${c.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border bg-card p-2.5 hover:border-foreground/20">
                    {campaignPicture(c.link) ? <CampaignPicture link={c.link} className="w-20 shrink-0 rounded-md" /> : <BadgeDollarSign className="size-4 shrink-0 text-orange-400" />}
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
                      Claude’s weekly review of <span className="font-medium">{wsById.get(r.workspaceId)?.name ?? 'a page'}</span> is ready
                    </span>
                    {r.finishedAt && <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(r.finishedAt)}</span>}
                  </Link>
                ))}
              </div>
            </Section>
          )}

          {pages.length > 1 && (
            <div className="-mx-4 -my-2 flex gap-1.5 overflow-x-auto px-4 py-0.5 md:-mx-6 md:px-6 xl:hidden" aria-label="Jump to a page">
              {pages.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => document.getElementById(`col-${p.id}`)?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' })}
                  className="flex shrink-0 items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs hover:border-foreground/20"
                >
                  <WorkspaceDot color={p.color} className="size-2" />
                  {p.name}
                  {p.yourTurn.length > 0 && <span className="rounded-full bg-sky-500/20 px-1.5 text-[10px] text-sky-300 tabular-nums">{p.yourTurn.length}</span>}
                </button>
              ))}
            </div>
          )}

          {pages.length > 0 && (
            <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 md:-mx-6 md:px-6 xl:mx-0 xl:grid xl:snap-none xl:grid-cols-[repeat(auto-fit,minmax(15rem,1fr))] xl:overflow-visible xl:px-0">
              {pages.map((p) => (
                <Column key={p.id} page={p} onPost={setOpenPost} />
              ))}
            </div>
          )}

          <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
            <Section title="Running" count={data.work.length}>
              {data.work.length ? (
                <div className="space-y-2">
                  {data.work.map((w) => (
                    <WorkRow key={`${w.type}-${w.id}`} item={w} ws={w.workspaceId ? wsById.get(w.workspaceId) : undefined} />
                  ))}
                </div>
              ) : (
                <p className="rounded-lg border border-dashed px-3 py-2.5 text-sm text-muted-foreground">Nothing is running.</p>
              )}
            </Section>
            {activeCampaigns.length > 0 && (
              <Section title="Campaigns" count={activeCampaigns.length}>
                <div className="space-y-2">
                  {activeCampaigns.map((c) => (
                    <CampaignTile key={c.id} c={c} />
                  ))}
                </div>
              </Section>
            )}
            {((data.briefs ?? []).length > 0 || data.usage) && (
              <div className="space-y-6">
                {(data.briefs ?? []).length > 0 && (
                  <Section title="Research">
                    <div className="space-y-2">
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
                  <Section title="Claude" className="md:hidden">
                    <UsageMeter usage={data.usage} className="rounded-lg border bg-card px-3 py-2.5" />
                  </Section>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      <PostSheet postId={openPost?.id ?? null} wid={openPost?.wid ?? ''} onClose={() => setOpenPost(null)} />
    </div>
  );
}
