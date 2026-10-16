import { and, asc, desc, eq, gte, inArray, isNotNull } from 'drizzle-orm';
import { BENCHMARK_AGE_MS, DAY_PARTS, dayPart, engagementRate, median, valueAt, type DayPart, type PostStats } from '../../../shared/analytics';
import { PUBLISH_PLATFORM_LABELS } from '../../../shared/publish';
import { normalizeDraft } from '../../../shared/types';
import { campaignsForWorkspace } from '../campaigns/campaigns';
import { campaignPostIds, campaignResults } from '../campaigns/submissions';
import { db, now, schema } from '../db';
import { accountLabel, publicAccount } from '../publish/accounts';
import { hasScope, platforms, type AccountRow, type PostRow } from '../publish/platforms';
import { localDay } from './stats';

const DAY = 86400_000;
/** How far back "typical" looks. */
const BASELINE_DAYS = 90;
// A post needs this many others on its account before "× typical" means anything.
const MIN_BASELINE = 3;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Reading = { at: number; views: number | null };

/** Posts of one account are compared with each other; posts of a disconnected account keep their own group. */
const accountKey = (p: Pick<PostRow, 'accountId' | 'platform' | 'accountLabel'>) => p.accountId ?? `${p.platform}:${p.accountLabel}`;

/** Views after 24 hours, read off the post's readings (it had none when it went out). Null until then. */
function views24h(p: PostRow, readings: Reading[]) {
  if (!p.publishedAt || now() - p.publishedAt < BENCHMARK_AGE_MS) return null;
  const points = [{ at: p.publishedAt, value: 0 }, ...readings.map((r) => ({ at: r.at, value: r.views }))];
  return valueAt(points, p.publishedAt + BENCHMARK_AGE_MS, 36 * 3600_000);
}

export type Performance = { views24h: number | null; typical: number | null; score: number | null; engagement: number | null };

/**
 * How the workspace's published posts of the last 180 days did against their account's typical post. `score` is a
 * post's views after 24 hours over the median of the account's other posts from the last 90 days (1 = typical).
 */
export function performance(workspaceId: string) {
  const posts = db
    .select()
    .from(schema.posts)
    .where(and(eq(schema.posts.workspaceId, workspaceId), eq(schema.posts.status, 'published'), isNotNull(schema.posts.publishedAt), gte(schema.posts.publishedAt, now() - 2 * BASELINE_DAYS * DAY)))
    .orderBy(desc(schema.posts.publishedAt))
    .all();
  const readings = new Map<string, Reading[]>();
  const rows = posts.length
    ? db
        .select({ postId: schema.postStats.postId, at: schema.postStats.at, views: schema.postStats.views })
        .from(schema.postStats)
        .where(inArray(schema.postStats.postId, posts.map((p) => p.id)))
        .orderBy(asc(schema.postStats.at))
        .all()
    : [];
  for (const r of rows) {
    if (!readings.has(r.postId)) readings.set(r.postId, []);
    readings.get(r.postId)!.push(r);
  }
  const at24 = new Map(posts.map((p) => [p.id, views24h(p, readings.get(p.id) ?? [])]));
  const result = new Map<string, Performance>();
  for (const p of posts) {
    const others = posts
      .filter((o) => o.id !== p.id && accountKey(o) === accountKey(p) && o.publishedAt! > now() - BASELINE_DAYS * DAY)
      .map((o) => at24.get(o.id))
      .filter((v): v is number => v !== null && v !== undefined);
    const typical = others.length >= MIN_BASELINE ? median(others) : null;
    const v = at24.get(p.id) ?? null;
    result.set(p.id, { views24h: v, typical, score: v !== null && typical ? v / typical : null, engagement: engagementRate(p.stats) });
  }
  return { posts, readings, result };
}

/** A post with what the analytics page shows alongside it. */
function postView(p: PostRow, perf: Performance | undefined, titles: Map<string, string>, thumbs: Set<string>, accounts: Map<string, AccountRow>) {
  const a = p.accountId ? accounts.get(p.accountId) : undefined;
  return {
    id: p.id,
    pieceId: p.pieceId,
    pieceTitle: titles.get(p.pieceId) ?? 'Untitled',
    thumbMediaId: thumbs.has(p.mediaIds[0]) ? p.mediaIds[0] : null,
    platform: p.platform,
    format: p.format,
    accountId: p.accountId,
    accountLabel: p.accountLabel,
    account: a ? { name: a.name, handle: a.handle, avatarUrl: a.avatarUrl } : null,
    publishedAt: p.publishedAt!,
    url: p.url,
    stats: p.stats,
    statsAt: p.statsAt,
    statsNote: p.statsNote,
    views24h: perf?.views24h ?? null,
    typical: perf?.typical ?? null,
    score: perf?.score ?? null,
    engagement: perf?.engagement ?? null,
  };
}
export type PostView = ReturnType<typeof postView>;

function lookups(posts: PostRow[]) {
  const pieceIds = [...new Set(posts.map((p) => p.pieceId))];
  const titles = new Map(
    (pieceIds.length ? db.select({ id: schema.pieces.id, title: schema.pieces.title }).from(schema.pieces).where(inArray(schema.pieces.id, pieceIds)).all() : []).map((p) => [p.id, p.title]),
  );
  const mediaIds = [...new Set(posts.map((p) => p.mediaIds[0]).filter(Boolean))];
  const thumbs = new Set(
    mediaIds.length
      ? db
          .select({ id: schema.media.id })
          .from(schema.media)
          .where(and(inArray(schema.media.id, mediaIds), eq(schema.media.hasThumb, true)))
          .all()
          .map((m) => m.id)
      : [],
  );
  return { titles, thumbs };
}

const sum = (values: (number | null | undefined)[]) => values.reduce<number>((t, v) => t + (v ?? 0), 0);
/** A total of the values that are known; null when none are (not 0: the platform just didn't say). */
const sumKnown = (values: (number | null | undefined)[]) => (values.some((v) => v !== null && v !== undefined) ? sum(values) : null);

/** Median score per group, for groups with at least two posts. */
function scoreBy<K extends string | number>(items: { key: K; score: number }[]) {
  const groups = new Map<K, number[]>();
  for (const it of items) groups.set(it.key, [...(groups.get(it.key) ?? []), it.score]);
  return [...groups].filter(([, s]) => s.length >= 2).map(([key, s]) => ({ key, posts: s.length, score: median(s)! }));
}

/** When an account's posts do best: median score by time of day and by weekday, over the last 90 days. */
function timing(posts: PostRow[], result: Map<string, Performance>, accountId: string) {
  const scored = posts
    .filter((p) => p.accountId === accountId && p.publishedAt! > now() - BASELINE_DAYS * DAY)
    .map((p) => ({ at: new Date(p.publishedAt!), score: result.get(p.id)?.score ?? null }))
    .filter((p): p is { at: Date; score: number } => p.score !== null);
  return {
    posts: scored.length,
    byPart: scoreBy(scored.map((p) => ({ key: dayPart(p.at.getHours()) as DayPart, score: p.score })))
      .sort((a, b) => DAY_PARTS.findIndex((d) => d.id === a.key) - DAY_PARTS.findIndex((d) => d.id === b.key))
      .map(({ key, ...r }) => ({ part: key, ...r })),
    // Monday first.
    byDay: scoreBy(scored.map((p) => ({ key: p.at.getDay(), score: p.score })))
      .sort((a, b) => ((a.key + 6) % 7) - ((b.key + 6) % 7))
      .map(({ key, ...r }) => ({ day: key, ...r })),
  };
}

function followerSeries(a: AccountRow, from: number) {
  return db
    .select({ day: schema.accountStats.day, followers: schema.accountStats.followers, views: schema.accountStats.views, likes: schema.accountStats.likes })
    .from(schema.accountStats)
    .where(
      and(
        eq(schema.accountStats.workspaceId, a.workspaceId),
        eq(schema.accountStats.platform, a.platform),
        eq(schema.accountStats.externalId, a.externalId),
        gte(schema.accountStats.day, localDay(from - DAY)),
      ),
    )
    .orderBy(asc(schema.accountStats.day))
    .all();
}

/** Followers now and their change since `from` (the last count on or before that day, else the first after). */
function followerChange(series: { day: string; followers: number | null }[], from: number) {
  const known = series.filter((s) => s.followers !== null);
  const last = known.at(-1)?.followers ?? null;
  const start = [...known].reverse().find((s) => s.day <= localDay(from)) ?? known[0];
  return { followers: last, change: last !== null && start && start !== known.at(-1) ? last - start.followers! : null };
}

/**
 * Everything the analytics page shows for the last `days` days; with `campaignId`, only that campaign's clips (each
 * still compared with its account's typical post) and the campaign's own numbers.
 */
export function overview(workspaceId: string, days: number, campaignId?: string) {
  const to = now();
  const from = to - days * DAY;
  const prevFrom = from - days * DAY;
  const { posts, result } = performance(workspaceId);
  const campaigns = campaignsForWorkspace(workspaceId).filter((c) => c.status !== 'reading' && c.status !== 'to_confirm');
  const campaign = campaignId ? campaigns.find((c) => c.id === campaignId) : undefined;
  const only = campaign ? campaignPostIds(campaign.id, workspaceId) : null;
  const inPeriod = posts.filter((p) => p.publishedAt! >= from && (!only || only.has(p.id)));
  const inPrev = posts.filter((p) => p.publishedAt! >= prevFrom && p.publishedAt! < from && (!only || only.has(p.id)));
  const accountRows = db.select().from(schema.accounts).where(eq(schema.accounts.workspaceId, workspaceId)).orderBy(asc(schema.accounts.createdAt)).all();
  const byId = new Map(accountRows.map((a) => [a.id, a]));
  const { titles, thumbs } = lookups(inPeriod);

  const medianOf = (list: PostRow[], pick: (perf: Performance) => number | null) => median(list.map((p) => pick(result.get(p.id)!)).filter((v): v is number => v !== null));

  const accounts = accountRows.map((a) => {
    const series = followerSeries(a, from);
    const own = inPeriod.filter((p) => p.accountId === a.id);
    const { followers, change } = followerChange(series, from);
    const { id, platform, name, handle, avatarUrl, status, statsNote } = publicAccount(a);
    return {
      id,
      platform,
      name,
      handle,
      avatarUrl,
      status,
      statsNote,
      followers,
      followersChange: change,
      series: series.map((s) => ({ day: s.day, followers: s.followers })),
      posts: own.length,
      views: sumKnown(own.map((p) => p.stats?.views)),
      typical: medianOf(
        posts.filter((p) => p.accountId === a.id && p.publishedAt! > to - BASELINE_DAYS * DAY),
        (perf) => perf.views24h,
      ),
      timing: timing(posts, result, a.id),
      queue: a.slots,
    };
  });

  return {
    days,
    from,
    to,
    syncedAt: Math.max(0, ...posts.map((p) => p.statsAt ?? 0)) || null,
    totals: {
      posts: inPeriod.length,
      views: sumKnown(inPeriod.map((p) => p.stats?.views)),
      withViews: inPeriod.filter((p) => p.stats?.views !== null && p.stats?.views !== undefined).length,
      typical: medianOf(inPeriod, (perf) => perf.views24h),
      prevTypical: medianOf(inPrev, (perf) => perf.views24h),
      engagement: medianOf(inPeriod, (perf) => perf.engagement),
      prevEngagement: medianOf(inPrev, (perf) => perf.engagement),
      followers: sumKnown(accounts.map((a) => a.followers)),
      followersChange: sumKnown(accounts.map((a) => a.followersChange)),
    },
    accounts,
    posts: inPeriod.map((p) => postView(p, result.get(p.id), titles, thumbs, byId)),
    campaigns: campaigns.map((c) => ({ id: c.id, title: c.title, origin: c.origin })),
    campaign: campaign ? { id: campaign.id, title: campaign.title, origin: campaign.origin, ratePer1k: campaign.ratePer1k, budgetLeft: campaign.budgetLeft, budgetTotal: campaign.budgetTotal, results: campaignResults(campaign.id) } : null,
  };
}

/** One post's readings over time and how it compares, for its sheet. */
export function postPerformance(post: PostRow) {
  const readings = db.select().from(schema.postStats).where(eq(schema.postStats.postId, post.id)).orderBy(asc(schema.postStats.at)).all();
  const perf = post.status === 'published' ? performance(post.workspaceId).result.get(post.id) : undefined;
  return {
    readings: readings.map(({ id: _id, postId: _p, workspaceId: _w, ...r }) => r),
    views24h: perf?.views24h ?? null,
    typical: perf?.typical ?? null,
    score: perf?.score ?? null,
    engagement: perf?.engagement ?? null,
  };
}

/** Total latest views of each piece's published posts, for board cards. */
export function pieceViews(pieceIds: string[]) {
  const rows = pieceIds.length
    ? db
        .select({ pieceId: schema.posts.pieceId, stats: schema.posts.stats })
        .from(schema.posts)
        .where(and(inArray(schema.posts.pieceId, pieceIds), eq(schema.posts.status, 'published')))
        .all()
    : [];
  const out = new Map<string, number>();
  for (const r of rows) if (r.stats?.views !== null && r.stats?.views !== undefined) out.set(r.pieceId, (out.get(r.pieceId) ?? 0) + r.stats.views);
  return out;
}

// ---------- the text Claude reads (weekly review and the get_analytics tool) ----------

const n = (v: number) => Math.round(v).toLocaleString('en-GB');
const when = (ms: number) => new Date(ms).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const clip = (s: string, max: number) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

function statsLine(s: PostStats | null, perf: Performance | undefined) {
  if (!s) return 'no numbers yet';
  const parts: string[] = [];
  if (s.views !== null) parts.push(`views ${n(s.views)}${perf?.views24h !== null && perf?.views24h !== undefined ? ` (${n(perf.views24h)} after 24 h${perf.score !== null ? `, ${perf.score.toFixed(1)}× typical` : ''})` : ''}`);
  for (const [k, label] of [['likes', 'likes'], ['comments', 'comments'], ['shares', 'shares'], ['saves', 'saves'], ['reach', 'reach'], ['followsGained', 'new followers']] as const) {
    if (s[k] !== null) parts.push(`${label} ${n(s[k]!)}`);
  }
  if (perf?.engagement !== null && perf?.engagement !== undefined) parts.push(`engagement ${(perf.engagement * 100).toFixed(1)}%`);
  if (s.avgWatchSeconds !== null) parts.push(`avg watch ${s.avgWatchSeconds.toFixed(1)} s${s.avgViewPercent !== null ? ` (${Math.round(s.avgViewPercent)}% of it)` : ''}`);
  return parts.join(' · ') || 'no numbers yet';
}

/**
 * The workspace's results as compact text, with short ids ([A1] accounts, [P1] posts) Claude can refer back to.
 * `days`: the period looked at in detail; the 90 days before give the best and worst posts for comparison.
 */
export function digest(workspaceId: string, days: number, opts: { pieceId?: string } = {}) {
  const to = now();
  const from = to - days * DAY;
  const { posts, result } = performance(workspaceId);
  const accountRows = db.select().from(schema.accounts).where(eq(schema.accounts.workspaceId, workspaceId)).orderBy(asc(schema.accounts.createdAt)).all();
  const accountIds = new Map(accountRows.map((a, i) => [a.id, `A${i + 1}`]));
  const postIds = new Map<string, PostRow>();
  const ref = (p: PostRow) => {
    const key = `P${postIds.size + 1}`;
    postIds.set(key, p);
    return key;
  };

  // Hooks and lengths, to judge why a post did well.
  const pieceIds = [...new Set(posts.map((p) => p.pieceId))];
  const pieces = pieceIds.length ? db.select({ id: schema.pieces.id, title: schema.pieces.title, branch: schema.pieces.activeBranchId }).from(schema.pieces).where(inArray(schema.pieces.id, pieceIds)).all() : [];
  const branchIds = pieces.map((p) => p.branch).filter((b): b is string => !!b);
  const hooks = new Map(
    (branchIds.length ? db.select({ id: schema.branches.id, pieceId: schema.branches.pieceId, working: schema.branches.working }).from(schema.branches).where(inArray(schema.branches.id, branchIds)).all() : []).map((b) => [
      b.pieceId,
      normalizeDraft(b.working).hook,
    ]),
  );
  const titles = new Map(pieces.map((p) => [p.id, p.title]));
  const mediaIds = [...new Set(posts.map((p) => p.mediaIds[0]))];
  const lengths = new Map(
    (mediaIds.length ? db.select({ id: schema.media.id, durationMs: schema.media.durationMs }).from(schema.media).where(inArray(schema.media.id, mediaIds)).all() : []).map((m) => [m.id, m.durationMs]),
  );

  const describe = (p: PostRow, detail: boolean) => {
    const a = p.accountId ? accountIds.get(p.accountId) : undefined;
    const length = lengths.get(p.mediaIds[0]);
    const what = p.format === 'video' ? `video${length ? ` ${Math.round(length / 1000)} s` : ''}` : p.mediaIds.length > 1 ? `carousel of ${p.mediaIds.length}` : 'photo';
    const campaign = campaignOf.get(p.id);
    const lines = [
      `- [${ref(p)}] “${titles.get(p.pieceId) ?? 'Untitled'}” → ${a ? `[${a}] ` : ''}${PUBLISH_PLATFORM_LABELS[p.platform]} ${p.accountLabel.replace(/^\S+ /, '')}, ${when(p.publishedAt!)}, ${what}${campaign ? `, a clip for “${campaign}”` : ''}`,
    ];
    if (detail) {
      const hook = hooks.get(p.pieceId);
      if (hook) lines.push(`  Hook: “${clip(hook, 160)}”`);
      const text = p.platform === 'youtube' ? p.copy.title : p.copy.caption;
      if (text) lines.push(`  ${p.platform === 'youtube' ? 'Title' : 'Caption'}: “${clip(text, 160)}”`);
    }
    lines.push(`  ${statsLine(p.stats, result.get(p.id))}${p.statsNote ? ` (${p.statsNote})` : ''}`);
    return lines.join('\n');
  };

  const out: string[] = [
    `Time zone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}. Numbers as of ${when(to)}.`,
    '“× typical” compares a post’s views after 24 hours with the median of its account’s other posts from the last 90 days (1.0× = typical); it’s the fair way to compare posts of different ages. Raw views favour older posts.',
  ];

  out.push('## Accounts');
  for (const a of accountRows) {
    const series = followerSeries(a, from);
    const { followers, change } = followerChange(series, from);
    const t = timing(posts, result, a.id);
    const typical = median(posts.filter((p) => p.accountId === a.id && p.publishedAt! > to - BASELINE_DAYS * DAY).map((p) => result.get(p.id)?.views24h ?? null).filter((v): v is number => v !== null));
    const missing = !!a.scopes && platforms[a.platform].statsScopes.some((s) => !hasScope(a, s));
    out.push(
      [
        `- [${accountIds.get(a.id)}] ${accountLabel(a)}: ${followers !== null ? `${n(followers)} followers${change !== null ? ` (${change >= 0 ? '+' : ''}${n(change)} in the last ${days} days)` : ''}` : 'followers unknown'}.`,
        `  Queue: ${a.slots.length ? a.slots.map((s) => `${s.time} on ${s.days.map((d) => WEEKDAYS[d]).join('/')}`).join('; ') : 'none'}.`,
        `  Typical post: ${typical !== null ? `${n(typical)} views after 24 h` : 'not enough posts yet'} (${t.posts} posts with numbers in 90 days).`,
        t.byPart.length ? `  By time of day (median × typical): ${t.byPart.map((b) => `${DAY_PARTS.find((d) => d.id === b.part)!.label} ${b.score.toFixed(1)}× (${b.posts} posts)`).join(', ')}.` : '',
        t.byDay.length ? `  By weekday: ${t.byDay.map((b) => `${WEEKDAYS[b.day]} ${b.score.toFixed(1)}× (${b.posts})`).join(', ')}.` : '',
        a.status !== 'connected' ? '  Needs reconnecting.' : missing ? '  Connected before stats were asked for: some numbers are missing until it’s reconnected.' : a.statsNote ? `  Note: ${a.statsNote}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }
  if (!accountRows.length) out.push('No accounts connected.');

  // Campaign clips: what the campaigns pay and what the clips earned, with each post marked with its campaign.
  const campaigns = campaignsForWorkspace(workspaceId).filter((c) => c.status === 'active' || c.status === 'paused' || c.status === 'ended');
  const campaignOf = new Map<string, string>();
  if (campaigns.length) {
    out.push('## Campaigns this page posts clips for');
    for (const c of campaigns) {
      const r = campaignResults(c.id);
      const ids = campaignPostIds(c.id, workspaceId);
      for (const id of ids) campaignOf.set(id, c.title);
      const subs = r.submissions;
      out.push(
        [
          `- “${c.title}” (${c.origin === 'business' ? 'my own business' : 'Content Rewards'}, ${c.status}${c.ratePer1k !== null ? `, $${c.ratePer1k} per 1,000 views` : ''}${c.budgetLeft !== null ? `, $${n(c.budgetLeft)} budget left${r.budgetLow ? ' — running low' : ''}` : ''}).`,
          `  Clips: ${r.clips.made} made, ${r.clips.approved} approved by me, ${r.clips.rejected} rejected by me, ${r.posted} posted (${r.posts} post${r.posts === 1 ? '' : 's'}${r.views !== null ? `, ${n(r.views)} views` : ''}).`,
          c.origin === 'content_rewards'
            ? `  Submissions: ${subs.to_submit} to submit, ${subs.submitted} waiting on the campaign, ${subs.approved + subs.paid} approved, ${subs.rejected} rejected${r.approvalRate !== null ? ` (${Math.round(r.approvalRate * 100)}% approved)` : ''}. Earned $${r.earned.toFixed(2)}${r.estimated ? ` + about $${r.estimated.toFixed(2)} estimated from views` : ''}${r.perClip !== null ? `, $${r.perClip.toFixed(2)} per clip posted` : ''}.`
            : '',
        ]
          .filter(Boolean)
          .join('\n'),
      );
    }
  }

  const focus = opts.pieceId ? posts.filter((p) => p.pieceId === opts.pieceId) : posts.filter((p) => p.publishedAt! >= from);
  out.push(opts.pieceId ? '## This piece’s posts' : `## Posts in the last ${days} days (newest first)`);
  out.push(focus.length ? focus.map((p) => describe(p, true)).join('\n') : 'None.');

  if (!opts.pieceId) {
    const earlier = posts.filter((p) => p.publishedAt! < from && p.publishedAt! >= to - BASELINE_DAYS * DAY && result.get(p.id)?.score !== null && result.get(p.id)?.score !== undefined);
    earlier.sort((a, b) => result.get(b.id)!.score! - result.get(a.id)!.score!);
    if (earlier.length) {
      out.push(`## For comparison: best and worst of the ${BASELINE_DAYS} days before`);
      const best = earlier.slice(0, 5);
      const worst = earlier.slice(5).slice(-3);
      out.push([...best, ...worst].map((p) => describe(p, true)).join('\n'));
    }
  }

  return { text: out.join('\n\n'), accountIds: new Map([...accountIds].map(([id, key]) => [key, id])), postIds, focus: focus.length };
}
