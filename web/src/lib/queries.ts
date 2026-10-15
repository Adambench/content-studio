import { QueryClient, useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { PairedDevice } from '@shared/devices';
import type { CreatorInfo } from '@shared/publish';
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

export function useMedia(wid: string, params: { scope?: 'footage' | 'assets'; kind?: string; q?: string; pieceId?: string } = {}) {
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v)) as Record<string, string>;
  return useQuery({
    queryKey: keys.media(wid, clean),
    queryFn: () => api<Media[]>(`/workspaces/${wid}/media?${new URLSearchParams(clean)}`),
    placeholderData: (prev) => prev,
  });
}

export const useMediaItem = (id: string | null) =>
  useQuery({ queryKey: keys.mediaItem(id ?? ''), queryFn: () => api<MediaDetail>(`/media/${id}`), enabled: !!id });
export const useThreads = (wid: string) => useQuery({ queryKey: keys.threads(wid), queryFn: () => api<Thread[]>(`/workspaces/${wid}/threads`) });
export const useMessages = (id: string | null) =>
  useQuery({ queryKey: keys.messages(id ?? ''), queryFn: () => api<{ thread: Thread; messages: ChatMessage[] }>(`/threads/${id}/messages`), enabled: !!id });
export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: () => api<AppSettings>('/settings') });
export const useSystemStatus = () => useQuery({ queryKey: keys.status, queryFn: () => api<SystemStatus>('/system/status') });
export const useDevices = () => useQuery({ queryKey: keys.devices, queryFn: () => api<PairedDevice[]>('/devices') });
export type FcmStatus = { projectId: string | null; clientEmail: string | null; serviceAccount: boolean; app: boolean };
export const useFcm = () => useQuery({ queryKey: keys.fcm, queryFn: () => api<FcmStatus>('/push/fcm') });

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

export const useAnalytics = (wid: string, days: number) =>
  useQuery({ queryKey: keys.analytics(wid, days), queryFn: () => api<AnalyticsOverview>(`/workspaces/${wid}/analytics?days=${days}`), placeholderData: (prev) => prev });
export const useReviews = (wid: string) => useQuery({ queryKey: keys.reviews(wid), queryFn: () => api<Review[]>(`/workspaces/${wid}/reviews`) });
/** A published post's readings over time. */
export const usePostStats = (postId: string | null) =>
  useQuery({ queryKey: keys.postStats(postId ?? ''), queryFn: () => api<PostReadings>(`/posts/${postId}/stats`), enabled: !!postId });
