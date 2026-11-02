import { QueryClient, useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { AiRouteNow, AiRouting, AiTask, LocalAiConfig, LocalAiStatus } from '@shared/ai';
import type { WorkerInfo } from '@shared/compute';
import type { GenerationSettings } from '@shared/generate';
import type { HostedStatus } from '@shared/hosted';
import type { CampaignLeads, FinderRun } from '@shared/finder';
import type { PairedDevice } from '@shared/devices';
import type { CreatorInfo } from '@shared/publish';
import type { Campaign, CampaignDetail } from '@shared/campaigns';
import type { ResearchOverview } from '@shared/research';
import type { IdeaDetail, IdeaNode } from '@shared/ideas';
import type { KnowledgeRule } from '@shared/knowledge';
import type { OwnMeasures, ReferenceVideo } from '@shared/references';
import type { Toolbox } from '@shared/toolbox';
import type { JoinedSyncState, SubmissionsSyncState } from './types';
import type { ReviewClip } from '@shared/clipping';
import type { SitesStatus } from '@shared/sites';
import type {
  Account,
  AnalyticsOverview,
  AppSettings,
  BoardCard,
  ChatMessage,
  EditDetail,
  Media,
  MediaDetail,
  PieceDetail,
  Post,
  PostReadings,
  PublishingSetup,
  RenderRow,
  Review,
  SearchResults,
  SystemStatus,
  Thread,
  TodayData,
  Workspace,
} from './types';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: true, retry: (count, err) => count < 2 && (err as { status?: number }).status !== 404 },
  },
});

export const keys = {
  auth: ['auth'] as const,
  workspaces: ['workspaces'] as const,
  workspace: (id: string) => ['workspace', id] as const,
  board: (wid: string) => ['board', wid] as const,
  tags: (wid: string) => ['tags', wid] as const,
  piece: (id: string) => ['piece', id] as const,
  edit: (pieceId: string) => ['edit', pieceId] as const,
  renders: (pieceId: string) => ['renders', pieceId] as const,
  media: (wid: string, params: Record<string, string | undefined> = {}) => ['media', wid, params] as const,
  mediaItem: (id: string) => ['media-item', id] as const,
  threads: (wid: string) => ['threads', wid] as const,
  pieceThread: (pieceId: string) => ['piece-thread', pieceId] as const,
  search: (q: string) => ['search', q] as const,
  messages: (id: string) => ['messages', id] as const,
  settings: ['settings'] as const,
  status: ['status'] as const,
  publishingSetup: ['publishing-setup'] as const,
  accounts: (wid: string) => ['accounts', wid] as const,
  creatorInfo: (accountId: string) => ['creator-info', accountId] as const,
  posts: (wid: string, from = 0, to = 0) => ['posts', wid, from, to] as const,
  upcoming: (wid: string) => ['posts', wid, 'upcoming'] as const,
  piecePosts: (pieceId: string) => ['piece-posts', pieceId] as const,
  post: (id: string) => ['post', id] as const,
  analytics: (wid: string, days: number) => ['analytics', wid, days] as const,
  reviews: (wid: string) => ['reviews', wid] as const,
  postStats: (id: string) => ['post-stats', id] as const,
  devices: ['devices'] as const,
  fcm: ['fcm'] as const,
  today: ['today'] as const,
  sites: ['sites'] as const,
  campaigns: ['campaigns'] as const,
  campaign: (id: string) => ['campaign', id] as const,
  review: ['review'] as const,
  submissionsSync: ['submissions-sync'] as const,
  joinedSync: ['campaigns-joined'] as const,
  research: (wid: string) => ['research', wid] as const,
  ideas: (wid: string) => ['ideas', wid] as const,
  idea: (id: string) => ['idea', id] as const,
  finder: (wid: string) => ['finder', wid] as const,
  compute: ['compute'] as const,
  ai: ['ai'] as const,
  knowledge: ['knowledge'] as const,
  references: ['references'] as const,
  ownMeasures: (wid: string | null) => ['own-measures', wid ?? 'all'] as const,
  toolbox: ['toolbox'] as const,
};

export type AuthStatus = { setupRequired: boolean; authenticated: boolean; desktopManaged: boolean };
export const useAuth = () => useQuery({ queryKey: keys.auth, queryFn: () => api<AuthStatus>('/auth/status'), staleTime: Infinity });
export const useWorkspaces = () => useQuery({ queryKey: keys.workspaces, queryFn: () => api<Workspace[]>('/workspaces') });
export const useWorkspace = (id: string) => useQuery({ queryKey: keys.workspace(id), queryFn: () => api<Workspace>(`/workspaces/${id}`) });
export const useBoard = (wid: string) => useQuery({ queryKey: keys.board(wid), queryFn: () => api<BoardCard[]>(`/workspaces/${wid}/pieces`), enabled: !!wid });
export const useTags = (wid: string) => useQuery({ queryKey: keys.tags(wid), queryFn: () => api<string[]>(`/workspaces/${wid}/tags`) });
export const usePiece = (id: string) => useQuery({ queryKey: keys.piece(id), queryFn: () => api<PieceDetail>(`/pieces/${id}`), enabled: !!id });

/** The piece's video edit; null until one is started. */
export const useEdit = (pieceId: string) => useQuery({ queryKey: keys.edit(pieceId), queryFn: () => api<EditDetail | null>(`/pieces/${pieceId}/edit`) });
export const useRenders = (pieceId: string) => useQuery({ queryKey: keys.renders(pieceId), queryFn: () => api<RenderRow[]>(`/pieces/${pieceId}/renders`) });

export function useMedia(wid: string, params: { scope?: 'footage' | 'assets' | 'inbox'; kind?: string; q?: string; pieceId?: string } = {}) {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v)) as Record<string, string>;
  return useQuery({
    queryKey: keys.media(wid, clean),
    queryFn: () => api<Media[]>(`/workspaces/${wid}/media?${new URLSearchParams(clean)}`),
    placeholderData: (prev) => prev,
  });
}

export const useMediaItem = (id: string | null) =>
  useQuery({ queryKey: keys.mediaItem(id ?? ''), queryFn: () => api<MediaDetail>(`/media/${id}`), enabled: !!id });
/** A video's own chat (started on first use). */
export const usePieceThread = (pieceId: string) => useQuery({ queryKey: keys.pieceThread(pieceId), queryFn: () => api<Thread>(`/pieces/${pieceId}/thread`), enabled: !!pieceId });
export const useSearch = (q: string) =>
  useQuery({ queryKey: keys.search(q), queryFn: () => api<SearchResults>(`/search?q=${encodeURIComponent(q)}`), enabled: q.length >= 2, placeholderData: (prev) => prev });
export const useThreads = (wid: string) => useQuery({ queryKey: keys.threads(wid), queryFn: () => api<Thread[]>(`/workspaces/${wid}/threads`) });
export const useMessages = (id: string | null) =>
  useQuery({ queryKey: keys.messages(id ?? ''), queryFn: () => api<{ thread: Thread; messages: ChatMessage[] }>(`/threads/${id}/messages`), enabled: !!id });
export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: () => api<AppSettings>('/settings') });
export const useSystemStatus = () => useQuery({ queryKey: keys.status, queryFn: () => api<SystemStatus>('/system/status') });
export const useDevices = () => useQuery({ queryKey: keys.devices, queryFn: () => api<PairedDevice[]>('/devices') });
export type FcmStatus = { projectId: string | null; clientEmail: string | null; serviceAccount: boolean; app: boolean };
export const useFcm = () => useQuery({ queryKey: keys.fcm, queryFn: () => api<FcmStatus>('/push/fcm') });

export const useCampaigns = () => useQuery({ queryKey: keys.campaigns, queryFn: () => api<Campaign[]>('/campaigns') });
export const useCampaign = (id: string) => useQuery({ queryKey: keys.campaign(id), queryFn: () => api<CampaignDetail>(`/campaigns/${id}`), enabled: !!id });

/** When the campaigns I've joined were last checked on the marketplaces, and whether they can be (the desktop app). */
export const useJoinedSync = () =>
  useQuery({ queryKey: keys.joinedSync, queryFn: () => api<JoinedSyncState>('/campaigns/joined'), refetchInterval: (q) => (q.state.data?.running ? 4000 : false) });

/** When the marketplaces were last read for my submissions, and whether they can be (the desktop app). */
export const useSubmissionsSync = () =>
  useQuery({ queryKey: keys.submissionsSync, queryFn: () => api<SubmissionsSyncState>('/submissions/sync'), refetchInterval: (q) => (q.state.data?.running ? 5000 : false) });

/** A page's research: what it watches, its latest brief, outliers and analyses. Polls while something runs. */
export const useKnowledge = () => useQuery({ queryKey: keys.knowledge, queryFn: () => api<KnowledgeRule[]>('/knowledge') });
/** Videos measured to learn from (Knowledge → References). */
export const useReferences = () => useQuery({ queryKey: keys.references, queryFn: () => api<ReferenceVideo[]>('/references') });
/** The same measures from my own latest edits (one page's, or all). */
export const useOwnMeasures = (wid: string | null) =>
  useQuery({ queryKey: keys.ownMeasures(wid), queryFn: () => api<OwnMeasures>(`/references/own${wid ? `?workspaceId=${wid}` : ''}`), staleTime: 60_000 });
/** What's installed and used, the scout's finds and installs. Polls while the scout or an install runs. */
export const useToolbox = () =>
  useQuery({
    queryKey: keys.toolbox,
    queryFn: () => api<Toolbox>('/toolbox'),
    refetchInterval: (q) => (q.state.data?.installs.some((r) => r.status === 'running') ? 1000 : q.state.data?.scout?.status === 'running' ? 5000 : false),
  });
export const useIdeas = (wid: string) => useQuery({ queryKey: keys.ideas(wid), queryFn: () => api<IdeaNode[]>(`/workspaces/${wid}/ideas`), enabled: !!wid });
export const useIdea = (id: string | null) => useQuery({ queryKey: keys.idea(id ?? ''), queryFn: () => api<IdeaDetail>(`/ideas/${id}`), enabled: !!id });
export const useResearch = (wid: string) =>
  useQuery({
    queryKey: keys.research(wid),
    queryFn: () => api<ResearchOverview>(`/workspaces/${wid}/research`),
    enabled: !!wid,
    refetchInterval: (q) => (q.state.data?.running || q.state.data?.analyses.some((a) => a.analysisStatus === 'queued' || a.analysisStatus === 'running') ? 8000 : false),
  });

/** Settings → Compute: the paired workers (home PCs) and what each is doing. */
export type AiSettings = {
  routing: AiRouting;
  local: LocalAiConfig;
  status: LocalAiStatus;
  now: Record<AiTask, AiRouteNow>;
  claudeLimitedUntil: number | null;
  generation: GenerationSettings;
  generators: { name: string; image: boolean; video: boolean }[];
  hosted: HostedStatus;
};
export const useAiSettings = () => useQuery({ queryKey: keys.ai, queryFn: () => api<AiSettings>('/ai'), refetchInterval: 30_000 });
export const useWorkers = () => useQuery({ queryKey: keys.compute, queryFn: () => api<WorkerInfo[]>('/compute/workers'), refetchInterval: 15_000 });

/** A clipping page's finder: its last run, whether it runs each morning, and campaigns found to add. Polls while it runs. */
export const useFinder = (wid: string) =>
  useQuery({
    queryKey: keys.finder(wid),
    queryFn: () => api<{ run: FinderRun; auto: boolean; leads: CampaignLeads }>(`/workspaces/${wid}/finder`),
    enabled: !!wid,
    refetchInterval: (q) => (q.state.data?.run.status === 'running' ? 4000 : false),
  });

/** A video's summary (latest render or how it's going, its moment, campaign, rules, where it goes); any stage. */
export const usePackage = (pieceId: string) => useQuery({ queryKey: [...keys.review, pieceId], queryFn: () => api<ReviewClip>(`/review/${pieceId}`), enabled: !!pieceId });

/** Clips waiting in Review across every page, oldest first. */
export const useReview = () => useQuery({ queryKey: keys.review, queryFn: () => api<ReviewClip[]>('/review') });

/** Settings → Connected sites: the desktop app's signed-in windows. */
export const useSites = () => useQuery({ queryKey: keys.sites, queryFn: () => api<SitesStatus>('/sites') });

export const usePublishingSetup = () => useQuery({ queryKey: keys.publishingSetup, queryFn: () => api<PublishingSetup>('/publishing/setup') });
export const useAccounts = (wid: string) => useQuery({ queryKey: keys.accounts(wid), queryFn: () => api<Account[]>(`/workspaces/${wid}/accounts`), enabled: !!wid });
/** TikTok's current options for an account (asked fresh each time a post is set up, as TikTok requires). */
export const useCreatorInfo = (accountId: string | null) =>
  useQuery({ queryKey: keys.creatorInfo(accountId ?? ''), queryFn: () => api<CreatorInfo>(`/accounts/${accountId}/creator-info`), enabled: !!accountId, staleTime: 0, retry: false });
export const usePosts = (wid: string, from: number, to: number) =>
  useQuery({ queryKey: keys.posts(wid, from, to), queryFn: () => api<Post[]>(`/workspaces/${wid}/posts?from=${from}&to=${to}`), placeholderData: (prev) => prev });
/** Last week's posts onwards, plus anything failed or missed. */
/** Today: the device's own day, refreshed while anything is running (jobs don't announce when they start). */
export function useToday() {
  return useQuery({
    queryKey: keys.today,
    queryFn: () => {
      const from = new Date();
      from.setHours(0, 0, 0, 0);
      const to = new Date(from);
      to.setDate(to.getDate() + 1);
      return api<TodayData>(`/today?from=${from.getTime()}&to=${to.getTime()}`);
    },
    refetchInterval: (q) => (q.state.data?.work.length ? 15_000 : 120_000),
  });
}

export const useUpcomingPosts = (wid: string) => useQuery({ queryKey: keys.upcoming(wid), queryFn: () => api<Post[]>(`/workspaces/${wid}/posts/upcoming`), enabled: !!wid });
export const usePiecePosts = (pieceId: string) => useQuery({ queryKey: keys.piecePosts(pieceId), queryFn: () => api<Post[]>(`/pieces/${pieceId}/posts`) });

export const useAnalytics = (wid: string, days: number, campaignId = '') =>
  useQuery({
    queryKey: [...keys.analytics(wid, days), campaignId],
    queryFn: () => api<AnalyticsOverview>(`/workspaces/${wid}/analytics?days=${days}${campaignId ? `&campaignId=${campaignId}` : ''}`),
    placeholderData: (prev) => prev,
  });
export const useReviews = (wid: string) => useQuery({ queryKey: keys.reviews(wid), queryFn: () => api<Review[]>(`/workspaces/${wid}/reviews`) });
/** A published post's readings over time. */
export const usePostStats = (postId: string | null) =>
  useQuery({ queryKey: keys.postStats(postId ?? ''), queryFn: () => api<PostReadings>(`/posts/${postId}/stats`), enabled: !!postId });
