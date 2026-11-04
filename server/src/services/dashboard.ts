// The dashboard's page columns (shared/dashboard.ts): every video not out yet sorted into my turn, Claude's turn or
// approved, what each page posts and when, its numbers, and what needs me there.
import { and, asc, eq, inArray, ne } from 'drizzle-orm';
import { DEFAULT_GOALS, type DashAttention, type DashPost, type DashVideo, type PageColumn } from '../../../shared/dashboard';
import { PUBLISH_PLATFORM_LABELS } from '../../../shared/publish';
import type { WorkspaceColor } from '../../../shared/types';
import { overview } from '../analytics/report';
import { db, now, schema } from '../db';
import { getSetting, setSetting } from '../lib/settings';
import { accountLabel, listAccounts } from '../publish/accounts';
import { upcomingPosts } from '../publish/posts';
import { reviewStates } from '../studio/notes';

const DAY = 86400_000;
type Workspace = typeof schema.workspaces.$inferSelect;

/** Monday 00:00 of the week `ms` is in. */
function weekStart(ms: number) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/** Posts a week each page aims for: mine, else its kind's default. */
export function pageGoal(w: Pick<Workspace, 'id' | 'kind'>) {
  return getSetting('postingGoals')?.[w.id] ?? DEFAULT_GOALS[w.kind];
}

export function setPageGoal(workspaceId: string, perWeek: number) {
  setSetting('postingGoals', { ...getSetting('postingGoals'), [workspaceId]: perWeek });
}

export function pageColumns(workspaces: Workspace[], from: number, to: number): PageColumn[] {
  if (!workspaces.length) return [];
  const pieces = db
    .select()
    .from(schema.pieces)
    .where(and(inArray(schema.pieces.workspaceId, workspaces.map((w) => w.id)), ne(schema.pieces.stage, 'posted')))
    .orderBy(asc(schema.pieces.updatedAt))
    .all();
  const ids = pieces.map((p) => p.id);
  const states = reviewStates(pieces);

  // The newest finished video of each (what I watch), its version, and any render on its way.
  const latest = new Map<string, { id: string; hasThumb: boolean; durationMs: number | null }>();
  const anyThumb = new Map<string, string>();
  for (const m of ids.length
    ? db
        .select({ id: schema.media.id, pieceId: schema.media.pieceId, source: schema.media.source, kind: schema.media.kind, hasThumb: schema.media.hasThumb, durationMs: schema.media.durationMs, assetType: schema.media.assetType })
        .from(schema.media)
        .where(inArray(schema.media.pieceId, ids))
        .orderBy(asc(schema.media.createdAt))
        .all()
    : []) {
    if (!m.pieceId || m.assetType) continue;
    if (m.source === 'render' && m.kind === 'video') latest.set(m.pieceId, m);
    if (m.hasThumb && !anyThumb.has(m.pieceId)) anyThumb.set(m.pieceId, m.id);
  }
  const renderRows = ids.length
    ? db
        .select({ pieceId: schema.renders.pieceId, mediaId: schema.renders.mediaId, status: schema.renders.status, progress: schema.renders.progress, stage: schema.renders.stage, versionNumber: schema.renders.versionNumber })
        .from(schema.renders)
        .where(inArray(schema.renders.pieceId, ids))
        .orderBy(asc(schema.renders.createdAt))
        .all()
    : [];
  const versions = new Map(renderRows.filter((r) => r.mediaId).map((r) => [r.mediaId!, r.versionNumber]));
  const rendering = new Map(renderRows.filter((r) => r.status === 'queued' || r.status === 'running').map((r) => [r.pieceId, { status: r.status as 'queued' | 'running', progress: r.progress, stage: r.stage }]));

  // Which campaign each clip is for: through its moment, else its own link.
  const moments = ids.length ? db.select({ pieceId: schema.moments.pieceId, campaignId: schema.moments.campaignId }).from(schema.moments).where(inArray(schema.moments.pieceId, ids)).all() : [];
  const campaignOf = new Map<string, string>();
  for (const p of pieces) if (p.campaignId) campaignOf.set(p.id, p.campaignId);
  for (const m of moments) if (m.pieceId && m.campaignId) campaignOf.set(m.pieceId, m.campaignId);
  const campaignIds = [...new Set(campaignOf.values())];
  const campaignTitles = new Map(
    campaignIds.length ? db.select({ id: schema.campaigns.id, title: schema.campaigns.title }).from(schema.campaigns).where(inArray(schema.campaigns.id, campaignIds)).all().map((c) => [c.id, c.title]) : [],
  );
  const making = db
    .select({ workspaceId: schema.moments.workspaceId })
    .from(schema.moments)
    .where(eq(schema.moments.status, 'making'))
    .all();

  const week0 = weekStart(now());
  return workspaces.map((w): PageColumn => {
    const accounts = listAccounts(w.id);
    const own = pieces.filter((p) => p.workspaceId === w.id);
    const yourTurn: DashVideo[] = [];
    const withClaude: DashVideo[] = [];
    const earlier = new Map<string, number>();
    for (const p of own) {
      const r = states.get(p.id);
      const render = latest.get(p.id);
      const busy = rendering.get(p.id) ?? null;
      const video = (state: DashVideo['state']): DashVideo => ({
        id: p.id,
        title: p.title,
        thumbMediaId: render?.hasThumb ? render.id : (anyThumb.get(p.id) ?? null),
        durationMs: render?.durationMs ?? null,
        state,
        open: r?.open ?? 0,
        version: render ? (versions.get(render.id) ?? null) : null,
        rendering: busy,
        campaign: campaignTitles.get(campaignOf.get(p.id) ?? '') || null,
        updatedAt: p.updatedAt,
      });
      const state = r?.state ?? null;
      if (state === 'improve') withClaude.push(video('improve'));
      // Claude's new version is on its way: watching the old one would waste my time.
      else if (busy && state !== 'good') withClaude.push(video(state ?? 'watch'));
      else if (state === 'watch' || state === 'recheck') yourTurn.push(video(state));
      // Watched and fine, but nowhere to go yet.
      else if (state === 'good' && p.stage !== 'scheduled') yourTurn.push(video('ready'));
      else if (!render && p.stage !== 'scheduled' && p.stage !== 'making') earlier.set(p.stage, (earlier.get(p.stage) ?? 0) + 1);
    }
    // Check again first (I asked for those changes), then the oldest.
    const order = { ready: 0, recheck: 1, watch: 2, improve: 3 } as const;
    yourTurn.sort((a, b) => order[a.state] - order[b.state] || a.updatedAt - b.updatedAt);
    withClaude.sort((a, b) => b.open - a.open || a.updatedAt - b.updatedAt);

    const posts = upcomingPosts(w.id, 300);
    const toDash = (p: (typeof posts)[number]): DashPost => ({
      id: p.id,
      pieceId: p.pieceId,
      title: p.pieceTitle,
      thumbMediaId: p.thumbMediaId,
      platform: p.platform,
      account: p.account?.handle ? `@${p.account.handle}` : p.accountLabel,
      at: p.status === 'published' ? (p.publishedAt ?? p.scheduledAt) : p.scheduledAt,
      status: p.status,
      views: p.stats?.views ?? null,
      error: p.error,
    });
    const upcoming = posts.filter((p) => p.status === 'scheduled' || p.status === 'publishing');
    const published = posts.filter((p) => p.status === 'published').sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
    const outAt = (p: (typeof posts)[number]) => p.publishedAt ?? p.scheduledAt;
    const inRange = (t: number, a: number, b: number) => t >= a && t < b;

    const attention: DashAttention[] = [];
    for (const p of posts.filter((x) => x.status === 'failed' || x.status === 'missed'))
      attention.push({ id: `post-${p.id}`, tone: 'red', text: `${p.status === 'missed' ? 'Missed its time' : 'Didn’t go out'}: ${p.pieceTitle} on ${PUBLISH_PLATFORM_LABELS[p.platform]}`, to: null, postId: p.id });
    for (const a of accounts.filter((x) => x.status === 'reconnect')) attention.push({ id: `acct-${a.id}`, tone: 'red', text: `Reconnect ${accountLabel(a)}: nothing posts there until then`, to: `/w/${w.id}/accounts` });
    if (!accounts.length) attention.push({ id: 'no-accounts', tone: 'amber', text: 'No account connected: approved videos wait in Ready', to: `/w/${w.id}/accounts` });
    const coveredUntil = upcoming.length ? Math.max(...upcoming.map((p) => p.scheduledAt)) : null;
    if (accounts.length && (!coveredUntil || coveredUntil < now() + DAY)) {
      const left = yourTurn.length ? `${yourTurn.length} for you to watch` : withClaude.length ? `${withClaude.length} with Claude` : 'nothing waiting';
      attention.push({ id: 'dry', tone: 'amber', text: `${coveredUntil ? 'The queue runs out within a day' : 'Nothing scheduled'}: ${left}`, to: null });
    }

    let stats: PageColumn['stats'] = { views: null, posts: 0, followers: null, followersChange: null, typical: null };
    try {
      const o = overview(w.id, 7);
      stats = { views: o.totals.views, posts: o.totals.posts, followers: o.totals.followers, followersChange: o.totals.followersChange, typical: o.totals.typical };
    } catch {
      // Numbers are a nice-to-have here; the analytics page says what went wrong.
    }

    return {
      id: w.id,
      name: w.name,
      color: w.color as WorkspaceColor,
      kind: w.kind,
      accounts: accounts.map((a) => ({ id: a.id, platform: a.platform, label: accountLabel(a), status: a.status, times: [...new Set(a.slots.map((s) => s.time))].sort() })),
      goal: pageGoal(w),
      week: { posted: published.filter((p) => outAt(p) >= week0).length, scheduled: upcoming.filter((p) => inRange(p.scheduledAt, week0, week0 + 7 * DAY)).length },
      today: { posted: published.filter((p) => inRange(outAt(p), from, to)).length, scheduled: upcoming.filter((p) => inRange(p.scheduledAt, from, to)).length },
      coveredUntil,
      stats,
      yourTurn,
      withClaude,
      making: making.filter((m) => m.workspaceId === w.id).length,
      earlier: w.stages.filter((s) => earlier.has(s.id)).map((s) => ({ id: s.id, name: s.name, count: earlier.get(s.id)! })),
      goingOut: upcoming.slice(0, 8).map(toDash),
      posted: published.slice(0, 4).map(toDash),
      attention,
    };
  });
}
