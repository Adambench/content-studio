import { QueryClient, useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { WorkerInfo } from '@shared/compute';
import type { PairedDevice } from '@shared/devices';
import type { KnowledgeRule } from '@shared/knowledge';
import type { PageStyle, ReferenceVideo } from '@shared/references';
import type { Toolbox } from '@shared/toolbox';
import type { VideoNote } from '@shared/notes';
import type { ReviewClip } from '@shared/clipping';
import type { BoardData, CampaignLink, Series } from '@shared/board';
import type { ApprovePlan } from '@shared/dashboard';
import type { SitesStatus } from '@shared/sites';
import type { Account, AppSettings, PieceDetail, Post, PublishingSetup, RenderRow, SystemStatus, VersionRow, Workspace } from './types';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: true, retry: (count, err) => count < 2 && (err as { status?: number }).status !== 404 },
  },
});

export const keys = {
  /** Every page's cards (Home and the pages' sections). */
  boardAll: ['board-all'] as const,
  campaignLinks: (wid: string) => ['campaign-links', wid] as const,
  /** A page's series, and one series. */
  series: (wid: string) => ['series', 'page', wid] as const,
  oneSeries: (id: string) => ['series', 'one', id] as const,
  auth: ['auth'] as const,
  workspaces: ['workspaces'] as const,
  workspace: (id: string) => ['workspace', id] as const,
  board: (wid: string) => ['board', wid] as const,
  tags: (wid: string) => ['tags', wid] as const,
  piece: (id: string) => ['piece', id] as const,
  edit: (pieceId: string) => ['edit', pieceId] as const,
  renders: (pieceId: string) => ['renders', pieceId] as const,
  notes: (pieceId: string) => ['notes', pieceId] as const,
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
  research: (wid: string) => ['research', wid] as const,
  ideas: (wid: string) => ['ideas', wid] as const,
  notebook: (wid: string) => ['notebook', wid] as const,
  idea: (id: string) => ['idea', id] as const,
  finder: (wid: string) => ['finder', wid] as const,
  compute: ['compute'] as const,
  ai: ['ai'] as const,
  knowledge: ['knowledge'] as const,
  references: ['references'] as const,
  style: (wid: string) => ['style', wid] as const,
  ownMeasures: (wid: string | null) => ['own-measures', wid ?? 'all'] as const,
  toolbox: ['toolbox'] as const,
};

export type AuthStatus = { setupRequired: boolean; authenticated: boolean; desktopManaged: boolean };
export const useBoardData = () => useQuery({ queryKey: keys.boardAll, queryFn: () => api<BoardData>('/board') });
export const useSeries = (wid: string) => useQuery({ queryKey: keys.series(wid), queryFn: () => api<Series[]>(`/workspaces/${wid}/series`), enabled: !!wid });
export const useOneSeries = (id: string) => useQuery({ queryKey: keys.oneSeries(id), queryFn: () => api<Series>(`/series/${id}`), enabled: !!id });
export const useCampaignLinks = (wid: string) => useQuery({ queryKey: keys.campaignLinks(wid), queryFn: () => api<CampaignLink[]>(`/workspaces/${wid}/campaign-links`), enabled: !!wid });
export const useAuth = () => useQuery({ queryKey: keys.auth, queryFn: () => api<AuthStatus>('/auth/status'), staleTime: Infinity });
export const useWorkspaces = () => useQuery({ queryKey: keys.workspaces, queryFn: () => api<Workspace[]>('/workspaces') });
export const useWorkspace = (id: string) => useQuery({ queryKey: keys.workspace(id), queryFn: () => api<Workspace>(`/workspaces/${id}`) });
export const usePiece = (id: string) => useQuery({ queryKey: keys.piece(id), queryFn: () => api<PieceDetail>(`/pieces/${id}`), enabled: !!id });

/** Comments pinned to moments of the finished video. While some are open it looks again every 20 s: Claude Code answers them straight in the database. */
export const useNotes = (pieceId: string) =>
  useQuery({
    queryKey: keys.notes(pieceId),
    queryFn: () => api<VideoNote[]>(`/pieces/${pieceId}/notes`),
    enabled: !!pieceId,
    refetchInterval: (q) => (q.state.data?.some((n) => n.status === 'open') ? 20_000 : false),
  });
export const useRenders = (pieceId: string) => useQuery({ queryKey: keys.renders(pieceId), queryFn: () => api<RenderRow[]>(`/pieces/${pieceId}/renders`) });
/** Every saved version of a piece's edit (under the renders key, so a render's events refresh it too). */
export const useVersions = (pieceId: string) => useQuery({ queryKey: [...keys.renders(pieceId), 'versions'], queryFn: () => api<VersionRow[]>(`/pieces/${pieceId}/versions`) });


export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: () => api<AppSettings>('/settings') });
export const useSystemStatus = () => useQuery({ queryKey: keys.status, queryFn: () => api<SystemStatus>('/system/status') });
export const useDevices = () => useQuery({ queryKey: keys.devices, queryFn: () => api<PairedDevice[]>('/devices') });
export type FcmStatus = { projectId: string | null; clientEmail: string | null; serviceAccount: boolean; app: boolean };
export const useFcm = () => useQuery({ queryKey: keys.fcm, queryFn: () => api<FcmStatus>('/push/fcm') });




/** A page's research: what it watches, its latest brief, outliers and analyses. Polls while something runs. */
export const useKnowledge = () => useQuery({ queryKey: keys.knowledge, queryFn: () => api<KnowledgeRule[]>('/knowledge') });
/** Videos measured to learn from (Knowledge → References). */
export const useReferences = () => useQuery({ queryKey: keys.references, queryFn: () => api<ReferenceVideo[]>('/references') });
/** A page's style, written from its references and my marks. */
export const useStyle = (wid: string | null) => useQuery({ queryKey: keys.style(wid ?? ''), queryFn: () => api<PageStyle>(`/styles/${wid}`), enabled: !!wid });
/** What's installed and used, the scout's finds and installs. Polls while the scout or an install runs. */
export const useToolbox = () =>
  useQuery({
    queryKey: keys.toolbox,
    queryFn: () => api<Toolbox>('/toolbox'),
    refetchInterval: (q) => (q.state.data?.installs.some((r) => r.status === 'running') ? 1000 : q.state.data?.scout?.status === 'running' ? 5000 : false),
  });

/** Settings → Compute: the paired workers (home PCs) and what each is doing. */
export const useWorkers = () => useQuery({ queryKey: keys.compute, queryFn: () => api<WorkerInfo[]>('/compute/workers'), refetchInterval: 15_000 });


/** A video's summary (latest render or how it's going, its moment, campaign, rules, where it goes); any stage. */
export const usePackage = (pieceId: string) => useQuery({ queryKey: [...keys.review, pieceId], queryFn: () => api<ReviewClip>(`/review/${pieceId}`), enabled: !!pieceId });

/** Where approving a video would post it and when (a minute's worth of "right away"). */
export const useApprovePlan = (pieceId: string, enabled = true) =>
  useQuery({ queryKey: [...keys.review, pieceId, 'plan'], queryFn: () => api<ApprovePlan>(`/review/${pieceId}/plan`), enabled: !!pieceId && enabled, refetchInterval: 60_000 });

/** Settings → Connected sites: the desktop app's signed-in windows. */
export const useSites = () => useQuery({ queryKey: keys.sites, queryFn: () => api<SitesStatus>('/sites') });

export const usePublishingSetup = () => useQuery({ queryKey: keys.publishingSetup, queryFn: () => api<PublishingSetup>('/publishing/setup') });
export const useAccounts = (wid: string) => useQuery({ queryKey: keys.accounts(wid), queryFn: () => api<Account[]>(`/workspaces/${wid}/accounts`), enabled: !!wid });
export const usePosts = (wid: string, from: number, to: number) =>
  useQuery({ queryKey: keys.posts(wid, from, to), queryFn: () => api<Post[]>(`/workspaces/${wid}/posts?from=${from}&to=${to}`), placeholderData: (prev) => prev });

export const usePiecePosts = (pieceId: string) => useQuery({ queryKey: keys.piecePosts(pieceId), queryFn: () => api<Post[]>(`/pieces/${pieceId}/posts`) });

