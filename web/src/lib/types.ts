import type { Campaign } from '@shared/campaigns';
import type { DayPart, PostStats, ReviewBody, ReviewStatus, WeeklyReviewSetting } from '@shared/analytics';
import type { EditSpec, EditTemplate } from '@shared/edit';
import type { AccountSettings, AccountStatus, PostCopy, PostFormat, PostOptions, PostProblem, PostStatus, PublishPlatform, QueueSlot } from '@shared/publish';
import type { AssetType, ChatPart, ClaudeUsage, DraftContent, MediaKind, MediaSource, ModuleId, ProxyStatus, RenderStatus, Stage, Transcript, TranscriptStatus, WorkspaceColor, WorkspaceKind } from '@shared/types';

export type Workspace = {
  id: string;
  name: string;
  color: WorkspaceColor;
  kind: WorkspaceKind;
  modules: ModuleId[];
  niche: string;
  description: string;
  brandGuide: string;
  voiceMemory: string;
  editTemplate: EditTemplate | null;
  stages: Stage[];
  position: number;
  createdAt: number;
  updatedAt: number;
  pieceCount?: number;
  pendingEdits?: number;
};

export type BoardCard = {
  id: string;
  title: string;
  stage: string;
  position: number;
  tags: string[];
  updatedAt: number;
  hook: string;
  alternatives: number;
  mediaCount: number;
  thumbMediaId: string | null;
  lastAuthor: 'you' | 'claude' | null;
  nextPostAt: number | null;
  postedCount: number;
  postAttention: boolean;
  /** Latest views across its posts, once any are in. */
  views: number | null;
};

export type VersionMeta = { id: string; number: number; author: 'you' | 'claude'; message: string; createdAt: number };

export type Branch = {
  id: string;
  pieceId: string;
  name: string;
  working: DraftContent;
  workingUpdatedAt: number;
  headVersionId: string | null;
  createdAt: number;
  versions: VersionMeta[];
};

export type Media = {
  id: string;
  workspaceId: string;
  pieceId: string | null;
  kind: MediaKind;
  assetType: AssetType | null;
  source: MediaSource;
  originalName: string;
  fileName: string;
  mime: string;
  size: number;
  durationMs: number | null;
  width: number | null;
  height: number | null;
  hasThumb: boolean;
  transcriptStatus: TranscriptStatus;
  transcriptText: string | null;
  transcriptLang: string | null;
  notes: string;
  proxyStatus: ProxyStatus;
  createdAt: number;
};

export type MediaDetail = Media & { transcript: Transcript | null };

export type PieceDetail = {
  id: string;
  workspaceId: string;
  title: string;
  stage: string;
  position: number;
  tags: string[];
  activeBranchId: string | null;
  createdAt: number;
  updatedAt: number;
  branches: Branch[];
  media: Media[];
};

export type Version = VersionMeta & { branchId: string; pieceId: string; parentId: string | null; content: DraftContent };

export type Thread = { id: string; title: string; model: string | null; updatedAt: number; running: boolean };
export type ChatMessage = { id: string; threadId: string; role: 'user' | 'assistant'; parts: ChatPart[]; contextPieceId: string | null; model: string | null; createdAt: number };

export type AppSettings = {
  defaultModel: string;
  whisperModel: string;
  lastWorkspaceId: string | null;
  claudeUsage: ClaudeUsage | null;
  vapidPublicKey: string;
  weeklyReview: WeeklyReviewSetting;
};

export type SystemStatus = {
  ffmpeg: boolean;
  python: boolean;
  whisper: boolean;
  whisperInstall: { state: 'idle' | 'installing' | 'done' | 'error'; message: string };
  renderer: boolean;
  rendererInstall: { state: 'idle' | 'installing' | 'done' | 'error'; message: string };
  desktop: boolean;
  dataDir: string;
  claudeLogin: boolean;
  pushDevices: number;
  /** Firebase is set up, so the Android app can get notifications. */
  fcm: boolean;
};

export type EditVersionMeta = { id: string; number: number; author: 'you' | 'claude'; message: string; createdAt: number };
export type EditVersion = EditVersionMeta & { editId: string; spec: EditSpec };

export type RenderRow = {
  id: string;
  editId: string;
  pieceId: string;
  versionId: string | null;
  versionNumber: number | null;
  status: RenderStatus;
  progress: number;
  stage: string;
  error: string | null;
  mediaId: string | null;
  durationMs: number | null;
  elapsedMs: number | null;
  createdAt: number;
  finishedAt: number | null;
};

/** A piece's video edit with everything the editor needs: the files it uses and their transcripts. */
export type EditDetail = {
  id: string;
  workspaceId: string;
  pieceId: string;
  name: string;
  working: EditSpec;
  workingUpdatedAt: number;
  headVersionId: string | null;
  createdAt: number;
  versions: EditVersionMeta[];
  media: Media[];
  transcripts: Record<string, Transcript | null>;
};

export type Account = {
  id: string;
  workspaceId: string;
  platform: PublishPlatform;
  externalId: string;
  name: string;
  handle: string;
  avatarUrl: string | null;
  expiresAt: number | null;
  refreshExpiresAt: number | null;
  scopes: string;
  tokenUpdatedAt: number;
  status: AccountStatus;
  statusMessage: string | null;
  /** Why some of its numbers can't be read. */
  statsNote: string | null;
  settings: AccountSettings;
  slots: QueueSlot[];
  createdAt: number;
  updatedAt: number;
};

/** A scheduled (or sent) post, with what the calendar shows alongside it. */
export type Post = {
  id: string;
  workspaceId: string;
  pieceId: string;
  accountId: string | null;
  platform: PublishPlatform;
  accountLabel: string;
  groupId: string;
  format: PostFormat;
  mediaIds: string[];
  copy: PostCopy;
  options: PostOptions;
  scheduledAt: number;
  status: PostStatus;
  stage: string;
  error: string | null;
  attempts: number;
  externalId: string | null;
  url: string | null;
  publishedAt: number | null;
  stats: PostStats | null;
  statsAt: number | null;
  statsNote: string | null;
  createdAt: number;
  updatedAt: number;
  pieceTitle: string;
  thumbMediaId: string | null;
  account: { id: string; name: string; handle: string; avatarUrl: string | null; status: AccountStatus; tiktokMode: 'inbox' | 'direct' } | null;
};

export type PlanTarget = { accountId: string; platform: PublishPlatform; scheduledAt: number | null; copy: PostCopy; options: PostOptions; problems: PostProblem[] };

export type PublishingSetup = {
  publicUrl: string | null;
  catchUpHours: number;
  timeZone: string;
  tiktokVerification: string | null;
  platforms: Record<PublishPlatform, { configured: boolean; clientId: string; hasSecret: boolean; redirectUri: string | null }>;
};

/** How a post did: its latest numbers and how it compares with its account's typical post (views after 24 hours). */
export type PostPerformanceRow = {
  id: string;
  pieceId: string;
  pieceTitle: string;
  thumbMediaId: string | null;
  platform: PublishPlatform;
  format: PostFormat;
  accountId: string | null;
  accountLabel: string;
  account: { name: string; handle: string; avatarUrl: string | null } | null;
  publishedAt: number;
  url: string | null;
  stats: PostStats | null;
  statsAt: number | null;
  statsNote: string | null;
  views24h: number | null;
  typical: number | null;
  /** views24h over typical: 1 = a typical post. */
  score: number | null;
  engagement: number | null;
};

export type AccountTiming = {
  posts: number;
  byPart: { part: DayPart; posts: number; score: number }[];
  byDay: { day: number; posts: number; score: number }[];
};

export type AnalyticsAccount = {
  id: string;
  platform: PublishPlatform;
  name: string;
  handle: string;
  avatarUrl: string | null;
  status: AccountStatus;
  statsNote: string | null;
  followers: number | null;
  followersChange: number | null;
  series: { day: string; followers: number | null }[];
  posts: number;
  views: number | null;
  typical: number | null;
  timing: AccountTiming;
  queue: QueueSlot[];
};

export type AnalyticsOverview = {
  days: number;
  from: number;
  to: number;
  syncedAt: number | null;
  totals: {
    posts: number;
    views: number | null;
    withViews: number;
    typical: number | null;
    prevTypical: number | null;
    engagement: number | null;
    prevEngagement: number | null;
    followers: number | null;
    followersChange: number | null;
  };
  accounts: AnalyticsAccount[];
  posts: PostPerformanceRow[];
};

export type PostReadings = {
  readings: ({ at: number } & PostStats)[];
  views24h: number | null;
  typical: number | null;
  score: number | null;
  engagement: number | null;
};

export type Review = {
  id: string;
  workspaceId: string;
  status: ReviewStatus;
  trigger: 'weekly' | 'manual';
  periodStart: number;
  periodEnd: number;
  model: string | null;
  body: ReviewBody | null;
  voiceChanged: boolean;
  voiceBefore: string | null;
  voiceAfter: string | null;
  error: string | null;
  createdAt: number;
  finishedAt: number | null;
};

/** Something running in the background, for Today. */
export type TodayWork = {
  id: string;
  type: 'render' | 'transcribe' | 'job' | 'source';
  workspaceId: string | null;
  pieceId: string | null;
  /** A campaign's source video being fetched or transcribed. */
  campaignId?: string;
  title: string;
  detail: string;
  status: 'queued' | 'running';
  progress: number | null;
};

export type TodayCampaign = Pick<Campaign, 'id' | 'title' | 'brand' | 'origin' | 'ratePer1k' | 'budgetLeft' | 'budgetTotal' | 'deadline' | 'halalVerdict' | 'pageIds'>;

/** The Today view: what needs me across every workspace. */
export type TodayData = {
  from: number;
  to: number;
  workspaces: {
    id: string;
    name: string;
    color: WorkspaceColor;
    kind: WorkspaceKind;
    modules: ModuleId[];
    niche: string;
    stages: (Stage & { count: number })[];
    nextPostAt: number | null;
    lastPostedAt: number | null;
  }[];
  review: { id: string; workspaceId: string; title: string; updatedAt: number; thumbMediaId: string | null; renderMediaId: string | null; durationMs: number | null }[];
  posts: Post[];
  attention: Post[];
  work: TodayWork[];
  campaigns: { toConfirm: TodayCampaign[]; active: TodayCampaign[] };
  usage: ClaudeUsage | null;
  reviews: { id: string; workspaceId: string; finishedAt: number | null }[];
};
