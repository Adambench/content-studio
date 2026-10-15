import { ArrowDown, ArrowUp, ChartColumn, CircleAlert, RefreshCw, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { FollowerChart, ScoreChart, TimingBars } from '@/components/analytics/charts';
import { ReviewCard } from '@/components/analytics/ReviewCard';
import { PageHeader } from '@/components/PageHeader';
import { AccountAvatar, accountName, PlatformIcon, platformLabel } from '@/components/publish/common';
import { PostSheet } from '@/components/publish/PostSheet';
import { useWorkspaceContext } from '@/components/WorkspaceLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { api, errorMessage, mediaThumbUrl } from '@/lib/api';
import { compact, percent, timeAgo, times } from '@/lib/format';
import { useAnalytics } from '@/lib/queries';
import type { AnalyticsAccount, AnalyticsOverview, PostPerformanceRow } from '@/lib/types';
import { createStore, useStore } from '@/lib/ui-state';
import { cn } from '@/lib/utils';

const PERIODS = [7, 28, 90] as const;
const period = createStore<number>(28, 'cs.analyticsDays');

export function AnalyticsPage() {
  const { workspace } = useWorkspaceContext();
  const wid = workspace.id;
  const days = useStore(period);
  const data = useAnalytics(wid, days);
  const [params, setParams] = useSearchParams();
  const [refreshing, setRefreshing] = useState(false);
  const d = data.data;
  const show = (id: string | null) => setParams(id ? { post: id } : {}, { replace: !id });

  async function refresh() {
    setRefreshing(true);
    try {
      await api(`/workspaces/${wid}/analytics/refresh`, { body: {} });
      toast('Reading the latest numbers…', { description: 'This page updates when they’re in.' });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setTimeout(() => setRefreshing(false), 3000);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Analytics"
        description={d?.syncedAt ? `Numbers from ${timeAgo(d.syncedAt)}` : `How ${workspace.name}’s posts are doing`}
        actions={
          <>
            <ToggleGroup type="single" variant="outline" size="sm" value={String(days)} onValueChange={(v) => v && period.set(Number(v))} aria-label="Period">
              {PERIODS.map((p) => (
                <ToggleGroupItem key={p} value={String(p)} aria-label={`Last ${p} days`}>
                  {p}
                  <span className="sm:hidden">d</span>
                  <span className="hidden sm:inline">days</span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <Button size="sm" variant="outline" onClick={refresh} disabled={refreshing || !d?.accounts.length}>
              <RefreshCw className={cn(refreshing && 'animate-spin')} /> <span className="hidden sm:inline">Refresh</span>
            </Button>
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className={cn('mx-auto max-w-5xl space-y-6 p-4 transition-opacity md:p-6', data.isPlaceholderData && 'opacity-60')}>
          {!d ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {Array.from({ length: 4 }, (_, i) => (
                <Skeleton key={i} className="h-24" />
              ))}
            </div>
          ) : !d.accounts.length ? (
            <div className="rounded-lg border border-dashed px-4 py-10 text-center">
              <ChartColumn className="mx-auto mb-3 size-6 text-muted-foreground" />
              <p className="text-sm">Connect your TikTok, Instagram and YouTube accounts, and once posts go out their numbers show up here.</p>
              <Button size="sm" className="mt-4" asChild>
                <Link to={`/w/${wid}/accounts`}>
                  <Users /> Connect accounts
                </Link>
              </Button>
            </div>
          ) : (
            <Overview data={d} wid={wid} onOpen={show} />
          )}
        </div>
      </div>
      <PostSheet postId={params.get('post')} wid={wid} onClose={() => show(null)} />
    </div>
  );
}

function Overview({ data: d, wid, onOpen }: { data: AnalyticsOverview; wid: string; onOpen: (id: string) => void }) {
  const t = d.totals;
  const vs = `vs the ${d.days} days before`;
  const unscored = d.posts.filter((p) => p.score === null).length;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Views" value={compact(t.views)} note={`on ${t.posts} post${t.posts === 1 ? '' : 's'} from the last ${d.days} days`} />
        <Stat
          label="Typical post"
          value={compact(t.typical)}
          note="views after 24 hours (median)"
          delta={
            t.typical !== null && t.prevTypical
              ? { value: Math.round(((t.typical - t.prevTypical) / t.prevTypical) * 100) / 100, text: `${percent(Math.abs((t.typical - t.prevTypical) / t.prevTypical), 0)} ${vs}` }
              : undefined
          }
        />
        <Stat
          label="Engagement"
          value={percent(t.engagement)}
          note="likes, comments, shares and saves per view"
          delta={
            t.engagement !== null && t.prevEngagement !== null
              ? // Points of engagement rate, as shown: a change that rounds to 0.0 is no change.
                { value: Math.round((t.engagement - t.prevEngagement) * 1000) / 1000, text: `${Math.abs((t.engagement - t.prevEngagement) * 100).toFixed(1)} pts ${vs}` }
              : undefined
          }
        />
        <Stat
          label="Followers"
          value={compact(t.followers)}
          note="across these accounts"
          delta={t.followersChange !== null ? { value: t.followersChange, text: `${Math.abs(t.followersChange).toLocaleString()} in ${d.days} days` } : undefined}
        />
      </div>

      <ReviewCard wid={wid} />

      <Card>
        <CardHeader>
          <CardTitle>How each post did</CardTitle>
          <CardDescription>Views after 24 hours against the account’s typical post, so new and old posts compare fairly. Click a bar to open the post.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {d.posts.length - unscored > 0 ? (
            <ScoreChart posts={d.posts} onOpen={onOpen} />
          ) : (
            <p className="text-sm text-muted-foreground">
              {d.posts.length ? 'Each account needs a few posts with a day of numbers before posts can be compared.' : `Nothing went out in the last ${d.days} days.`}
            </p>
          )}
          {unscored > 0 && d.posts.length - unscored > 0 && (
            <p className="text-xs text-muted-foreground">
              {unscored} post{unscored === 1 ? ' isn’t' : 's aren’t'} shown: less than a day old, or without views to compare yet.
            </p>
          )}
        </CardContent>
      </Card>

      <section className="space-y-3" aria-label="Accounts">
        <h2 className="text-sm font-medium">Accounts</h2>
        {d.accounts.map((a) => (
          <AccountPanel key={a.id} account={a} days={d.days} wid={wid} />
        ))}
      </section>

      <PostsTable posts={d.posts} days={d.days} onOpen={onOpen} />
    </>
  );
}

/** A headline number: label, value, what it means, and how it moved. */
function Stat({ label, value, note, delta }: { label: string; value: string; note: string; delta?: { value: number; text: string } }) {
  const up = (delta?.value ?? 0) > 0;
  const flat = !delta || delta.value === 0;
  return (
    <div className="space-y-1 rounded-xl border bg-card p-3 md:p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tracking-tight">{value}</p>
      {delta && (
        <p className={cn('flex items-center gap-0.5 text-xs', flat ? 'text-muted-foreground' : up ? 'text-emerald-400' : 'text-red-400')}>
          {!flat && (up ? <ArrowUp className="size-3" aria-label="up" /> : <ArrowDown className="size-3" aria-label="down" />)}
          {delta.text}
        </p>
      )}
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

function AccountPanel({ account: a, days, wid }: { account: AnalyticsAccount; days: number; wid: string }) {
  const name = accountName(a);
  return (
    <Card>
      <CardContent className="grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
        <div className="min-w-0 space-y-3">
          <div className="flex items-center gap-3">
            <AccountAvatar account={a} platform={a.platform} className="size-9" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{name}</p>
              <p className="text-xs text-muted-foreground">{platformLabel(a.platform)}</p>
            </div>
            <div className="text-right">
              <p className="text-lg font-semibold">{compact(a.followers)}</p>
              <p className="text-xs text-muted-foreground">
                followers
                {a.followersChange !== null && (
                  <span className={cn('ml-1', a.followersChange > 0 ? 'text-emerald-400' : a.followersChange < 0 ? 'text-red-400' : '')}>
                    {a.followersChange > 0 ? '+' : a.followersChange < 0 ? '−' : ''}
                    {Math.abs(a.followersChange).toLocaleString()}
                  </span>
                )}
              </p>
            </div>
          </div>
          <FollowerChart series={a.series} label={`${name} followers`} />
          <dl className="grid grid-cols-3 gap-2 text-xs">
            <div>
              <dt className="text-muted-foreground">Posts</dt>
              <dd className="text-sm tabular-nums">{a.posts}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Views ({days} d)</dt>
              <dd className="text-sm tabular-nums">{compact(a.views)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Typical post</dt>
              <dd className="text-sm tabular-nums">{a.typical !== null ? `${compact(a.typical)} in 24 h` : '–'}</dd>
            </div>
          </dl>
          {(a.statsNote || a.status === 'reconnect') && (
            <p className="flex items-start gap-1.5 rounded-md bg-amber-400/10 px-2.5 py-2 text-xs">
              <CircleAlert className="mt-px size-3.5 shrink-0 text-amber-400" />
              <span>
                {a.status === 'reconnect' ? 'This account needs reconnecting.' : a.statsNote}{' '}
                <Link to={`/w/${wid}/accounts`} className="underline underline-offset-2">
                  Accounts
                </Link>
              </span>
            </p>
          )}
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium">When posts do best</p>
          <p className="text-xs text-muted-foreground">Median against a typical post, last 90 days ({a.timing.posts} posts). Right of the line is better.</p>
          <TimingBars timing={a.timing} />
        </div>
      </CardContent>
    </Card>
  );
}

type SortKey = 'publishedAt' | 'views' | 'score' | 'engagement' | 'likes' | 'comments' | 'shares' | 'saves' | 'watch';
// `from`: the table width a column needs before it shows (the post sheet has every number on narrow screens).
const COLUMNS: { key: SortKey; label: string; get: (p: PostPerformanceRow) => number | null; show: (p: PostPerformanceRow) => string; from?: 'xl' | '4xl' }[] = [
  { key: 'views', label: 'Views', get: (p) => p.stats?.views ?? null, show: (p) => compact(p.stats?.views) },
  { key: 'score', label: 'vs typical', get: (p) => p.score, show: (p) => times(p.score) },
  { key: 'engagement', label: 'Engagement', get: (p) => p.engagement, show: (p) => percent(p.engagement), from: 'xl' },
  { key: 'likes', label: 'Likes', get: (p) => p.stats?.likes ?? null, show: (p) => compact(p.stats?.likes), from: '4xl' },
  { key: 'comments', label: 'Comments', get: (p) => p.stats?.comments ?? null, show: (p) => compact(p.stats?.comments), from: '4xl' },
  { key: 'shares', label: 'Shares', get: (p) => p.stats?.shares ?? null, show: (p) => compact(p.stats?.shares), from: '4xl' },
  { key: 'saves', label: 'Saves', get: (p) => p.stats?.saves ?? null, show: (p) => compact(p.stats?.saves), from: '4xl' },
  {
    key: 'watch',
    label: 'Avg watch',
    get: (p) => p.stats?.avgWatchSeconds ?? null,
    show: (p) => (p.stats?.avgWatchSeconds != null ? `${p.stats.avgWatchSeconds.toFixed(1)} s` : '–'),
    from: '4xl',
  },
];

// Written out in full so Tailwind sees the class names.
const SHOW_FROM = { xl: 'hidden @xl:table-cell', '4xl': 'hidden @4xl:table-cell' } as const;

/** Every post of the period with its numbers; sortable. The table view of the chart above. */
function PostsTable({ posts, days, onOpen }: { posts: PostPerformanceRow[]; days: number; onOpen: (id: string) => void }) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'publishedAt', desc: true });
  const sorted = useMemo(() => {
    const get = sort.key === 'publishedAt' ? (p: PostPerformanceRow) => p.publishedAt : COLUMNS.find((c) => c.key === sort.key)!.get;
    return [...posts].sort((a, b) => {
      const [x, y] = [get(a), get(b)];
      if (x === null) return 1;
      if (y === null) return -1;
      return sort.desc ? y - x : x - y;
    });
  }, [posts, sort]);
  const by = (key: SortKey) => setSort((s) => ({ key, desc: s.key === key ? !s.desc : true }));
  const arrow = (key: SortKey) => sort.key === key && (sort.desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />);

  return (
    <section className="@container space-y-3" aria-label="Posts">
      <h2 className="text-sm font-medium">
        Posts <span className="text-muted-foreground tabular-nums">{posts.length}</span>
      </h2>
      {!posts.length ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">Nothing went out in the last {days} days.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th className="px-3 py-2 text-left font-normal">
                  <button type="button" className="flex items-center gap-1 hover:text-foreground" onClick={() => by('publishedAt')}>
                    Post {arrow('publishedAt')}
                  </button>
                </th>
                {COLUMNS.map((c) => (
                  <th key={c.key} className={cn('px-3 py-2 text-right font-normal whitespace-nowrap', c.from && SHOW_FROM[c.from])} aria-sort={sort.key === c.key ? (sort.desc ? 'descending' : 'ascending') : undefined}>
                    <button type="button" className="ml-auto flex items-center gap-1 hover:text-foreground" onClick={() => by(c.key)}>
                      {arrow(c.key)} {c.label}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {sorted.map((p) => (
                <tr key={p.id} className="cursor-pointer hover:bg-accent/40" onClick={() => onOpen(p.id)}>
                  <td className="max-w-0 min-w-44 px-3 py-2">
                    <button
                      type="button"
                      className="flex w-full min-w-0 items-center gap-2.5 text-left"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(p.id);
                      }}
                    >
                      {p.thumbMediaId ? <img src={mediaThumbUrl(p.thumbMediaId)} alt="" loading="lazy" className="h-10 w-7 shrink-0 rounded-sm object-cover" /> : <span className="h-10 w-7 shrink-0 rounded-sm bg-muted" />}
                      <span className="min-w-0">
                        <span className="block truncate">{p.pieceTitle}</span>
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <PlatformIcon platform={p.platform} className="size-3" />
                          {new Date(p.publishedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                          {p.statsNote && !p.stats && <CircleAlert className="size-3 text-amber-400" aria-label={p.statsNote} />}
                        </span>
                      </span>
                    </button>
                  </td>
                  {COLUMNS.map((c) => (
                    <td key={c.key} className={cn('px-3 py-2 text-right whitespace-nowrap tabular-nums', c.from && SHOW_FROM[c.from], c.get(p) === null && 'text-muted-foreground')}>
                      {c.show(p)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
