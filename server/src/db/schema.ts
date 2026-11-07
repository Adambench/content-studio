import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { PostStats, ReviewBody, ReviewStatus } from '../../../shared/analytics';
import type { FramesCheck, MomentCaptions, MomentKind, MomentSpeaker, MomentStatus, MusicCheck, StandaloneScores } from '../../../shared/clipping';
import type { CampaignOrigin, CampaignPlatform, CampaignStatus, HalalVerdict, Payout, RuleItem, SourceKind, SourceStatus, SubmissionStatus } from '../../../shared/campaigns';
import type { EditSpec, EditTemplate } from '../../../shared/edit';
import type { MascotId } from '../../../shared/mascots';
import type { NoteStatus } from '../../../shared/notes';
import type { PieceDirections } from '../../../shared/direction';
import type { KnowledgeSource, KnowledgeStatus, KnowledgeTopic } from '../../../shared/knowledge';
import type { QualityReport } from '../../../shared/quality';
import type { Ingredient, PageStyle, ReferenceMeasures, ReferencePlatform, ReferenceRead, ReferenceStatus } from '../../../shared/references';
import type { FindKind, FindStatus, ToolKind } from '../../../shared/toolbox';
import type { AccountSettings, AccountStatus, PostCopy, PostFormat, PostOptions, PostStatus, PublishPlatform, QueueSlot } from '../../../shared/publish';
import type { SessionKind } from '../../../shared/devices';
import type { AssetType, ChatPart, DraftContent, InboxSuggestion, MediaKind, MediaSource, ModuleId, ProxyStatus, RenderStatus, Stage, TranscriptStatus, WorkspaceKind } from '../../../shared/types';

const id = () => text('id').primaryKey();
const createdAt = () => integer('created_at').notNull().default(sql`(unixepoch() * 1000)`);
const updatedAt = () => integer('updated_at').notNull().default(sql`(unixepoch() * 1000)`);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).notNull(),
});

/**
 * A signed-in browser, the desktop app, or a paired phone. Browsers and the desktop app hold the id in a signed
 * cookie; a paired device holds a bearer token and the id is that token's SHA-256, so the database never has it.
 */
export const sessions = sqliteTable('sessions', {
  id: id(),
  kind: text('kind').$type<SessionKind>().notNull().default('browser'),
  /** A paired device's name ("Pixel 8"). */
  name: text('name'),
  createdAt: createdAt(),
  expiresAt: integer('expires_at').notNull(),
  lastSeenAt: integer('last_seen_at'),
  userAgent: text('user_agent'),
});

export const workspaces = sqliteTable('workspaces', {
  id: id(),
  name: text('name').notNull(),
  color: text('color').notNull().default('violet'),
  // What the page is for; presets its modules, stages and Claude's instructions (KIND_PRESETS).
  kind: text('kind').$type<WorkspaceKind>().notNull().default('personal'),
  // The modules switched on (MODULES).
  modules: text('modules', { mode: 'json' }).$type<ModuleId[]>().notNull().default(sql`'[]'`),
  // The page's niche in a sentence: research keywords, and how moments are judged for fit.
  niche: text('niche').notNull().default(''),
  // What the Research brief watches: keywords, YouTube channels, TikTok and Instagram handles (normalizeResearch).
  research: text('research', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
  description: text('description').notNull().default(''),
  brandGuide: text('brand_guide').notNull().default(''),
  // Claude-maintained notes about my voice, learned from my edits.
  voiceMemory: text('voice_memory').notNull().default(''),
  // The page's mascot (shared/mascots.ts): scenes draw it when they don't name one.
  mascot: text('mascot').$type<MascotId>(),
  // The brand's video look (shape, captions, grade, watermark, voice settings), applied to new edits.
  editTemplate: text('edit_template', { mode: 'json' }).$type<EditTemplate>(),
  stages: text('stages', { mode: 'json' }).$type<Stage[]>().notNull(),
  /** Out of the top bar and Home (Settings → Pages); its data stays. */
  hidden: integer('hidden', { mode: 'boolean' }).notNull().default(false),
  position: integer('position').notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const pieces = sqliteTable(
  'pieces',
  {
    id: id(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    stage: text('stage').notNull(),
    position: real('position').notNull().default(0),
    tags: text('tags', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    activeBranchId: text('active_branch_id'),
    /** A campaign the piece is filmed for (a UGC video); clips made from moments are linked through `moments`. */
    campaignId: text('campaign_id').references((): AnySQLiteColumn => campaigns.id, { onDelete: 'set null' }),
    /** Creative directions Claude pitched for the video (personal and business pages) and the one picked. */
    directions: text('directions', { mode: 'json' }).$type<PieceDirections | null>(),
    /** The render I said looks good (shared/review.ts): a newer render asks for another look. */
    reviewedMediaId: text('reviewed_media_id'),
    /** The series it's an episode of, and its number in it (1, 2, … in the series' order). */
    seriesId: text('series_id').references((): AnySQLiteColumn => series.id, { onDelete: 'set null' }),
    episode: integer('episode'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('pieces_workspace_idx').on(t.workspaceId), index('pieces_campaign_idx').on(t.campaignId), index('pieces_series_idx').on(t.seriesId)],
);

/** A series on a page: what every episode follows, and its episodes (the cards with its `seriesId`, by `episode`). */
export const series = sqliteTable(
  'series',
  {
    id: id(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** The premise and format every episode follows (Claude reads it when writing or helping with one). */
    about: text('about').notNull().default(''),
    position: real('position').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('series_workspace_idx').on(t.workspaceId)],
);

/** An alternative take on a piece. `working` is the live draft; versions snapshot it. */
export const branches = sqliteTable(
  'branches',
  {
    id: id(),
    pieceId: text('piece_id').notNull().references(() => pieces.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    working: text('working', { mode: 'json' }).$type<DraftContent>().notNull(),
    workingUpdatedAt: integer('working_updated_at').notNull().default(sql`(unixepoch() * 1000)`),
    headVersionId: text('head_version_id'),
    createdAt: createdAt(),
  },
  (t) => [index('branches_piece_idx').on(t.pieceId)],
);

export const versions = sqliteTable(
  'versions',
  {
    id: id(),
    branchId: text('branch_id').notNull().references(() => branches.id, { onDelete: 'cascade' }),
    pieceId: text('piece_id').notNull().references(() => pieces.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    parentId: text('parent_id'),
    author: text('author').$type<'you' | 'claude'>().notNull(),
    message: text('message').notNull().default(''),
    content: text('content', { mode: 'json' }).$type<DraftContent>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('versions_branch_idx').on(t.branchId)],
);

export const media = sqliteTable(
  'media',
  {
    id: id(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    pieceId: text('piece_id').references(() => pieces.id, { onDelete: 'set null' }),
    kind: text('kind').$type<MediaKind>().notNull(),
    // Set for brand assets (logos, fonts, LUTs, nasheeds, SFX); null for footage.
    assetType: text('asset_type').$type<AssetType>(),
    source: text('source').$type<MediaSource>().notNull().default('upload'),
    originalName: text('original_name').notNull(),
    fileName: text('file_name').notNull(),
    mime: text('mime').notNull(),
    size: integer('size').notNull(),
    durationMs: integer('duration_ms'),
    width: integer('width'),
    height: integer('height'),
    hasThumb: integer('has_thumb', { mode: 'boolean' }).notNull().default(false),
    transcriptStatus: text('transcript_status').$type<TranscriptStatus>().notNull().default('none'),
    transcriptText: text('transcript_text'),
    transcriptLang: text('transcript_lang'),
    notes: text('notes').notNull().default(''),
    proxyStatus: text('proxy_status').$type<ProxyStatus>().notNull().default('none'),
    // A loose file's (Inbox) best guess at the video it belongs to, from Claude.
    suggestion: text('suggestion', { mode: 'json' }).$type<InboxSuggestion>(),
    createdAt: createdAt(),
  },
  (t) => [index('media_workspace_idx').on(t.workspaceId), index('media_piece_idx').on(t.pieceId)],
);

/** A piece's video edit. `working` is the live edit; versions snapshot it (like a draft's alternatives). */
export const edits = sqliteTable(
  'edits',
  {
    id: id(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    pieceId: text('piece_id').notNull().references(() => pieces.id, { onDelete: 'cascade' }),
    name: text('name').notNull().default('Main edit'),
    working: text('working', { mode: 'json' }).$type<EditSpec>().notNull(),
    workingUpdatedAt: integer('working_updated_at').notNull().default(sql`(unixepoch() * 1000)`),
    headVersionId: text('head_version_id'),
    createdAt: createdAt(),
  },
  (t) => [index('edits_piece_idx').on(t.pieceId)],
);

export const editVersions = sqliteTable(
  'edit_versions',
  {
    id: id(),
    editId: text('edit_id').notNull().references(() => edits.id, { onDelete: 'cascade' }),
    number: integer('number').notNull(),
    author: text('author').$type<'you' | 'claude'>().notNull(),
    message: text('message').notNull().default(''),
    spec: text('spec', { mode: 'json' }).$type<EditSpec>().notNull(),
    /** The quality check of this version (shared/quality.ts), once one ran. */
    quality: text('quality', { mode: 'json' }).$type<QualityReport>(),
    createdAt: createdAt(),
  },
  (t) => [index('edit_versions_edit_idx').on(t.editId)],
);

/** One render of an edit to an MP4; the finished file becomes a media row attached to the piece. */
export const renders = sqliteTable(
  'renders',
  {
    id: id(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    editId: text('edit_id').notNull().references(() => edits.id, { onDelete: 'cascade' }),
    pieceId: text('piece_id').notNull(),
    versionId: text('version_id'),
    versionNumber: integer('version_number'),
    status: text('status').$type<RenderStatus>().notNull().default('queued'),
    progress: real('progress').notNull().default(0),
    stage: text('stage').notNull().default('Waiting'),
    error: text('error'),
    mediaId: text('media_id').references(() => media.id, { onDelete: 'set null' }),
    durationMs: integer('duration_ms'),
    elapsedMs: integer('elapsed_ms'),
    /** A render of a version saved earlier, to watch it again: dated with its version, never "the edit rendering". */
    older: integer('older', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
    finishedAt: integer('finished_at'),
  },
  (t) => [index('renders_edit_idx').on(t.editId)],
);

/** A comment pinned to a moment (or a stretch) of a piece's finished video, for Claude to fix (shared/notes.ts). */
export const videoNotes = sqliteTable(
  'video_notes',
  {
    id: id(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    pieceId: text('piece_id').notNull().references(() => pieces.id, { onDelete: 'cascade' }),
    mediaId: text('media_id').references(() => media.id, { onDelete: 'set null' }),
    version: integer('version'),
    at: real('at').notNull(),
    end: real('end'),
    text: text('text').notNull(),
    status: text('status').$type<NoteStatus>().notNull().default('open'),
    reply: text('reply').notNull().default(''),
    /** The lesson it taught (a Knowledge rule from my comments). */
    lessonId: text('lesson_id').references((): AnySQLiteColumn => knowledge.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    resolvedAt: integer('resolved_at'),
  },
  (t) => [index('video_notes_piece_idx').on(t.pieceId), index('video_notes_lesson_idx').on(t.lessonId)],
);

export const jobs = sqliteTable(
  'jobs',
  {
    id: id(),
    type: text('type').notNull(),
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    status: text('status').$type<'queued' | 'running' | 'done' | 'error'>().notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    runAt: integer('run_at').notNull(),
    error: text('error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('jobs_status_idx').on(t.status, t.runAt)],
);

export const chatThreads = sqliteTable(
  'chat_threads',
  {
    id: id(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    title: text('title').notNull().default('New chat'),
    // A video's own chat, beside its package; null for the workspace's general chats.
    pieceId: text('piece_id').references(() => pieces.id, { onDelete: 'cascade' }),
    sdkSessionId: text('sdk_session_id'),
    model: text('model'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('threads_workspace_idx').on(t.workspaceId), index('threads_piece_idx').on(t.pieceId)],
);

export const chatMessages = sqliteTable(
  'chat_messages',
  {
    id: id(),
    threadId: text('thread_id').notNull().references(() => chatThreads.id, { onDelete: 'cascade' }),
    role: text('role').$type<'user' | 'assistant'>().notNull(),
    parts: text('parts', { mode: 'json' }).$type<ChatPart[]>().notNull(),
    // The piece that was open when the message was sent, if any.
    contextPieceId: text('context_piece_id'),
    model: text('model'),
    createdAt: createdAt(),
  },
  (t) => [index('messages_thread_idx').on(t.threadId)],
);

/** Where notifications go: a browser's Web Push subscription, or the Android app's FCM registration token. */
export const pushSubscriptions = sqliteTable('push_subscriptions', {
  id: id(),
  kind: text('kind').$type<'webpush' | 'fcm'>().notNull().default('webpush'),
  /** The Web Push endpoint, or the FCM registration token. */
  endpoint: text('endpoint').notNull().unique(),
  // Web Push encryption keys (empty for FCM).
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  /** The session that subscribed: signing it out or unpairing the device stops its notifications. */
  sessionId: text('session_id').references(() => sessions.id, { onDelete: 'cascade' }),
  createdAt: createdAt(),
});

/**
 * A resumable upload from the Android app: chunks are appended to a file in the data folder's tmp/uploads until it
 * has `size` bytes, then it becomes a media row (`mediaId`), so a retried last chunk can't add the file twice.
 */
export const uploads = sqliteTable('uploads', {
  id: id(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  pieceId: text('piece_id').references(() => pieces.id, { onDelete: 'set null' }),
  assetType: text('asset_type').$type<AssetType>(),
  source: text('source').$type<'upload' | 'capture' | 'share' | 'idea'>().notNull().default('upload'),
  /** A picture shared to the Saved pile: the card it becomes once it's all here. */
  ideaId: text('idea_id'),
  name: text('name').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  mediaId: text('media_id'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** A change I made to text Claude wrote — the raw material for voice learning. */
export const editEvents = sqliteTable(
  'edit_events',
  {
    id: id(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    pieceId: text('piece_id').notNull(),
    field: text('field').notNull(),
    before: text('before').notNull(),
    after: text('after').notNull(),
    learnedAt: integer('learned_at'),
    createdAt: createdAt(),
  },
  (t) => [index('edit_events_workspace_idx').on(t.workspaceId)],
);

/** A TikTok, Instagram or YouTube account connected to a workspace. Tokens never leave the server. */
export const accounts = sqliteTable(
  'accounts',
  {
    id: id(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    platform: text('platform').$type<PublishPlatform>().notNull(),
    // The platform's id for the account: TikTok open_id, Instagram user id, YouTube channel id.
    externalId: text('external_id').notNull(),
    name: text('name').notNull().default(''),
    handle: text('handle').notNull().default(''),
    avatarUrl: text('avatar_url'),
    accessToken: text('access_token').notNull(),
    refreshToken: text('refresh_token'),
    expiresAt: integer('expires_at'),
    refreshExpiresAt: integer('refresh_expires_at'),
    scopes: text('scopes').notNull().default(''),
    tokenUpdatedAt: integer('token_updated_at').notNull().default(sql`(unixepoch() * 1000)`),
    status: text('status').$type<AccountStatus>().notNull().default('connected'),
    statusMessage: text('status_message'),
    settings: text('settings', { mode: 'json' }).$type<AccountSettings>().notNull().default(sql`'{}'`),
    // The account's posting queue: weekly time slots that "Add to queue" fills.
    slots: text('slots', { mode: 'json' }).$type<QueueSlot[]>().notNull().default(sql`'[]'`),
    // Why some of its numbers can't be read (a permission it wasn't given, an API that isn't turned on).
    statsNote: text('stats_note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('accounts_external_idx').on(t.workspaceId, t.platform, t.externalId)],
);

/** One piece going out to one account at one time. Posts scheduled together (a cross-post) share a group. */
export const posts = sqliteTable(
  'posts',
  {
    id: id(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    pieceId: text('piece_id').notNull().references(() => pieces.id, { onDelete: 'cascade' }),
    // Kept (as null) when the account is disconnected, so the post's history stays.
    accountId: text('account_id').references(() => accounts.id, { onDelete: 'set null' }),
    platform: text('platform').$type<PublishPlatform>().notNull(),
    // The account's handle when scheduled, for history after a disconnect.
    accountLabel: text('account_label').notNull().default(''),
    groupId: text('group_id').notNull(),
    format: text('format').$type<PostFormat>().notNull(),
    mediaIds: text('media_ids', { mode: 'json' }).$type<string[]>().notNull(),
    copy: text('copy', { mode: 'json' }).$type<PostCopy>().notNull(),
    options: text('options', { mode: 'json' }).$type<PostOptions>().notNull().default(sql`'{}'`),
    scheduledAt: integer('scheduled_at').notNull(),
    status: text('status').$type<PostStatus>().notNull().default('scheduled'),
    // Progress while publishing ("Uploading 40%"), or what to do next once done.
    stage: text('stage').notNull().default(''),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    // Where a publish attempt got to on the platform (upload session, container, publish id), so a retry resumes
    // instead of posting twice.
    remote: text('remote', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default(sql`'{}'`),
    externalId: text('external_id'),
    url: text('url'),
    publishedAt: integer('published_at'),
    // The latest numbers from the platform (history in post_stats), when they were last read, and why there are
    // none when there aren't (still in the TikTok inbox, private, deleted).
    stats: text('stats', { mode: 'json' }).$type<PostStats>(),
    statsAt: integer('stats_at'),
    statsNote: text('stats_note'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('posts_status_idx').on(t.status, t.scheduledAt), index('posts_workspace_idx').on(t.workspaceId, t.scheduledAt), index('posts_piece_idx').on(t.pieceId)],
);

/** A reading of a published post's numbers. A post is read often while it's new, then less (statsInterval). */
export const postStats = sqliteTable(
  'post_stats',
  {
    id: id(),
    postId: text('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    at: integer('at').notNull(),
    views: integer('views'),
    likes: integer('likes'),
    comments: integer('comments'),
    shares: integer('shares'),
    saves: integer('saves'),
    reach: integer('reach'),
    avgWatchSeconds: real('avg_watch_seconds'),
    avgViewPercent: real('avg_view_percent'),
    followsGained: integer('follows_gained'),
  },
  (t) => [index('post_stats_post_idx').on(t.postId, t.at)],
);

/**
 * An account's numbers, once a day. Keyed by the platform's account id rather than our account row, so the
 * history survives disconnecting and connecting the account again.
 */
export const accountStats = sqliteTable(
  'account_stats',
  {
    id: id(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    platform: text('platform').$type<PublishPlatform>().notNull(),
    externalId: text('external_id').notNull(),
    // Local date, yyyy-mm-dd.
    day: text('day').notNull(),
    at: integer('at').notNull(),
    followers: integer('followers'),
    views: integer('views'),
    likes: integer('likes'),
    posts: integer('posts'),
  },
  (t) => [uniqueIndex('account_stats_day_idx').on(t.workspaceId, t.platform, t.externalId, t.day)],
);

/** Claude's weekly look at how the workspace's posts did: what worked, ideas, queue-time suggestions, voice memory changes. */
export const reviews = sqliteTable(
  'reviews',
  {
    id: id(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    status: text('status').$type<ReviewStatus>().notNull().default('running'),
    // `weekly` ran by itself; `manual` from "Review now".
    trigger: text('trigger').$type<'weekly' | 'manual'>().notNull(),
    periodStart: integer('period_start').notNull(),
    periodEnd: integer('period_end').notNull(),
    model: text('model'),
    body: text('body', { mode: 'json' }).$type<ReviewBody>(),
    // The voice memory before and after the review changed it (null when it didn't), for undo.
    voiceBefore: text('voice_before'),
    voiceAfter: text('voice_after'),
    // What Claude was shown.
    digest: text('digest').notNull().default(''),
    error: text('error'),
    createdAt: createdAt(),
    finishedAt: integer('finished_at'),
  },
  (t) => [index('reviews_workspace_idx').on(t.workspaceId, t.createdAt)],
);

/**
 * A clipping campaign: a Content Rewards campaign (its page read and screened) or one of my businesses' own. It lives
 * outside workspaces and is assigned to the pages it posts on (campaign_pages).
 */
export const campaigns = sqliteTable('campaigns', {
  id: id(),
  origin: text('origin').$type<CampaignOrigin>().notNull(),
  // A business's own campaign: the workspace whose brand guide, assets and footage it uses.
  businessWorkspaceId: text('business_workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
  link: text('link'),
  title: text('title').notNull().default(''),
  brand: text('brand').notNull().default(''),
  type: text('type').notNull().default(''),
  category: text('category').notNull().default(''),
  description: text('description').notNull().default(''),
  status: text('status').$type<CampaignStatus>().notNull().default('reading'),
  accepting: integer('accepting', { mode: 'boolean' }),
  // The best rate per 1,000 views across its platforms; `payouts` has each one's.
  ratePer1k: real('rate_per_1k'),
  payouts: text('payouts', { mode: 'json' }).$type<Payout[]>().notNull().default(sql`'[]'`),
  platforms: text('platforms', { mode: 'json' }).$type<CampaignPlatform[]>().notNull().default(sql`'[]'`),
  budgetTotal: real('budget_total'),
  budgetLeft: real('budget_left'),
  deadline: integer('deadline'),
  // The rules as the page words them, one per line; the checklist is made from them.
  rulesText: text('rules_text').notNull().default(''),
  rulesLocked: integer('rules_locked', { mode: 'boolean' }).notNull().default(false),
  checklist: text('checklist', { mode: 'json' }).$type<RuleItem[]>().notNull().default(sql`'[]'`),
  requirements: text('requirements').notNull().default(''),
  halalVerdict: text('halal_verdict').$type<HalalVerdict>(),
  halalReasons: text('halal_reasons', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
  // What the last read saw: the page's text, or the brief I typed for a business campaign.
  pageText: text('page_text').notNull().default(''),
  readAt: integer('read_at'),
  readNote: text('read_note'),
  // The budget is read again from the public page every day (no Claude); I'm told once when it runs low.
  budgetCheckedAt: integer('budget_checked_at'),
  budgetWarnedAt: integer('budget_warned_at'),
  // When it was ended: its downloaded source videos are deleted some days later (transcripts and clips stay).
  endedAt: integer('ended_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Which pages (workspaces) a campaign posts on. */
export const campaignPages = sqliteTable(
  'campaign_pages',
  {
    campaignId: text('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.campaignId, t.workspaceId] }), index('campaign_pages_workspace_idx').on(t.workspaceId)],
);

/**
 * A long video a campaign's clips are cut from: a YouTube/Twitch/Kick video, a Drive file or an upload. Its file and
 * transcript live in the data folder's sources/<campaign>/, not in a page's library.
 */
export const campaignSources = sqliteTable(
  'campaign_sources',
  {
    id: id(),
    campaignId: text('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<SourceKind>().notNull(),
    link: text('link'),
    title: text('title').notNull().default(''),
    durationMs: integer('duration_ms'),
    // Inside sources/<campaign>/ once downloaded.
    fileName: text('file_name'),
    size: integer('size'),
    status: text('status').$type<SourceStatus>().notNull().default('found'),
    progress: real('progress'),
    detail: text('detail').notNull().default(''),
    transcriptFrom: text('transcript_from').$type<'captions' | 'whisper'>(),
    // From the channel listing (the finder ranks videos by these) and the creator's name for searching their clips.
    views: integer('views'),
    uploadedAt: integer('uploaded_at'),
    creator: text('creator'),
    // Moments other clippers' clips of this video got big on (shared/finder.ts), found by the finder; the pick reads them.
    viral: text('viral', { mode: 'json' }).$type<unknown[]>().notNull().default(sql`'[]'`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('campaign_sources_campaign_idx').on(t.campaignId)],
);

/**
 * A moment Claude picked in a source video for a page: in/out points, the hook card, title and captions, the
 * standalone score and the checks. Made into a clip (a piece on the page's board) or rejected with a reason, which the
 * next pick reads.
 */
export const moments = sqliteTable(
  'moments',
  {
    id: id(),
    sourceId: text('source_id').notNull().references(() => campaignSources.id, { onDelete: 'cascade' }),
    campaignId: text('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
    // The page it's made for.
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    // In and out points in the source (seconds).
    start: real('start').notNull(),
    end: real('end').notNull(),
    firstLine: text('first_line').notNull().default(''),
    hookCard: text('hook_card').notNull().default(''),
    title: text('title').notNull().default(''),
    kind: text('kind').$type<MomentKind>().notNull().default('other'),
    why: text('why').notNull().default(''),
    score: integer('score').notNull().default(0),
    scores: text('scores', { mode: 'json' }).$type<StandaloneScores>(),
    captions: text('captions', { mode: 'json' }).$type<MomentCaptions>(),
    halalFlags: text('halal_flags', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    checkByEye: text('check_by_eye', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    speaker: text('speaker', { mode: 'json' }).$type<MomentSpeaker>(),
    music: text('music', { mode: 'json' }).$type<MusicCheck>(),
    frames: text('frames', { mode: 'json' }).$type<FramesCheck>(),
    status: text('status').$type<MomentStatus>().notNull().default('candidate'),
    // What it's doing while being made, or why it was dropped or failed.
    detail: text('detail').notNull().default(''),
    rejectReason: text('reject_reason'),
    // The clip, once made (kept as null if the card is deleted, so the moment and its reason stay).
    pieceId: text('piece_id').references(() => pieces.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('moments_source_idx').on(t.sourceId), index('moments_campaign_idx').on(t.campaignId), index('moments_piece_idx').on(t.pieceId)],
);

/**
 * A posted clip's submission to its Content Rewards campaign: made when the post is out with a link, submitted by me
 * on Content Rewards, then tracked there (status, counted views, earnings) by a daily read of my submissions page.
 */
export const submissions = sqliteTable(
  'submissions',
  {
    id: id(),
    postId: text('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
    campaignId: text('campaign_id').notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    pieceId: text('piece_id').notNull(),
    platform: text('platform').$type<PublishPlatform>().notNull(),
    url: text('url').notNull(),
    status: text('status').$type<SubmissionStatus>().notNull().default('to_submit'),
    submittedAt: integer('submitted_at'),
    // As the campaign counts them, and what it says the clip earned (or what I typed in).
    views: integer('views'),
    earnings: real('earnings'),
    earningsFrom: text('earnings_from').$type<'site' | 'you'>(),
    note: text('note').notNull().default(''),
    checkedAt: integer('checked_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('submissions_post_idx').on(t.postId), index('submissions_campaign_idx').on(t.campaignId), index('submissions_status_idx').on(t.status)],
);

/**
 * A video the research looked at: an outlier from an account a page watches or a keyword search (views against the
 * account's median), or one I asked to have analysed (a link, or a video in the library).
 */
export const researchItems = sqliteTable(
  'research_items',
  {
    id: id(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    platform: text('platform').$type<string>().notNull(),
    externalId: text('external_id').notNull(),
    url: text('url').notNull(),
    channel: text('channel').notNull().default(''),
    channelUrl: text('channel_url'),
    title: text('title').notNull().default(''),
    views: integer('views'),
    channelMedian: integer('channel_median'),
    score: real('score'),
    postedAt: integer('posted_at'),
    hook: text('hook').notNull().default(''),
    source: text('source').$type<string>().notNull(),
    keyword: text('keyword'),
    mediaId: text('media_id').references(() => media.id, { onDelete: 'set null' }),
    analysis: text('analysis', { mode: 'json' }).$type<unknown>(),
    analysisStatus: text('analysis_status').$type<string>().notNull().default('none'),
    analysisError: text('analysis_error'),
    /** What's said in it (YouTube's captions or Whisper), for a saved post. */
    transcript: text('transcript').notNull().default(''),
    firstSeenAt: integer('first_seen_at').notNull(),
    lastSeenAt: integer('last_seen_at').notNull(),
  },
  (t) => [uniqueIndex('research_items_key_idx').on(t.workspaceId, t.platform, t.externalId), index('research_items_score_idx').on(t.workspaceId, t.score)],
);

/** A page's daily research brief: what over-performs in its niche, ideas and hooks shaped for it. */
export const researchBriefs = sqliteTable(
  'research_briefs',
  {
    id: id(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    // Local date, yyyy-mm-dd.
    day: text('day').notNull(),
    status: text('status').$type<'running' | 'done' | 'error'>().notNull().default('running'),
    body: text('body', { mode: 'json' }).$type<unknown>(),
    sweep: text('sweep').notNull().default(''),
    error: text('error'),
    createdAt: createdAt(),
    finishedAt: integer('finished_at'),
  },
  (t) => [index('research_briefs_workspace_idx').on(t.workspaceId, t.createdAt)],
);

/**
 * Kept for its data only (Phase 14 moved my ideas onto video cards and deleted the canvas). A card on a page's Ideas canvas: an idea, a series, a saved post or a picture, in a tree. Deleting
 * marks it (`deletedAt`) so it can be undone; marked ones go for good after a month.
 */
export const ideas = sqliteTable(
  'ideas',
  {
    id: id(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    parentId: text('parent_id').references((): AnySQLiteColumn => ideas.id, { onDelete: 'cascade' }),
    position: real('position').notNull().default(0),
    kind: text('kind').$type<string>().notNull().default('idea'),
    title: text('title').notNull().default(''),
    body: text('body').notNull().default(''),
    script: text('script').notNull().default(''),
    format: text('format').notNull().default(''),
    labels: text('labels', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    collapsed: integer('collapsed', { mode: 'boolean' }).notNull().default(false),
    url: text('url'),
    researchItemId: text('research_item_id').references(() => researchItems.id, { onDelete: 'set null' }),
    mediaId: text('media_id').references(() => media.id, { onDelete: 'set null' }),
    /** The video it was locked in as. */
    pieceId: text('piece_id').references(() => pieces.id, { onDelete: 'set null' }),
    by: text('by').$type<'you' | 'claude'>().notNull().default('you'),
    assist: text('assist', { mode: 'json' }).$type<unknown>(),
    seenAt: integer('seen_at'),
    deletedAt: integer('deleted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('ideas_workspace_idx').on(t.workspaceId), index('ideas_parent_idx').on(t.parentId), index('ideas_piece_idx').on(t.pieceId)],
);

/** A note on a page's Notes: free writing, first line its title (shared/notebook.ts). Deleting marks it so it can be undone. */
export const notebook = sqliteTable(
  'notebook',
  {
    id: id(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    body: text('body').notNull().default(''),
    deletedAt: integer('deleted_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('notebook_workspace_idx').on(t.workspaceId)],
);

/** What hosted generation (kie.ai) has cost: one row per request, so the daily cap can be enforced and shown. */
export const aiSpend = sqliteTable(
  'ai_spend',
  {
    id: id(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    kind: text('kind').notNull(),
    taskId: text('task_id'),
    credits: real('credits').notNull().default(0),
    dollars: real('dollars').notNull().default(0),
    pieceId: text('piece_id'),
    createdAt: createdAt(),
  },
  (t) => [index('ai_spend_created_idx').on(t.createdAt)],
);

/**
 * A video that moved me, pasted on the Knowledge page as inspiration (shared/references.ts): measured (`measures`), read
 * by the model (`read`, `ingredients`), each ingredient marked by me. `workspaceId` null = for every page. (Rules once
 * drafted from it keep `knowledge.referenceId`.)
 */
export const referenceVideos = sqliteTable(
  'reference_videos',
  {
    id: id(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    platform: text('platform').$type<ReferencePlatform>().notNull(),
    externalId: text('external_id').notNull(),
    url: text('url').notNull(),
    title: text('title').notNull().default(''),
    channel: text('channel').notNull().default(''),
    views: integer('views'),
    postedAt: integer('posted_at'),
    status: text('status').$type<ReferenceStatus>().notNull().default('queued'),
    step: text('step').notNull().default(''),
    error: text('error'),
    measures: text('measures', { mode: 'json' }).$type<ReferenceMeasures>(),
    read: text('read', { mode: 'json' }).$type<ReferenceRead>(),
    /** What's said, a line per sentence ({ at, text }). */
    lines: text('lines', { mode: 'json' }).$type<{ at: number; text: string }[]>().notNull().default(sql`'[]'`),
    hasFrames: integer('has_frames', { mode: 'boolean' }).notNull().default(false),
    /** What it's made of, each with my mark. */
    ingredients: text('ingredients', { mode: 'json' }).$type<Ingredient[]>().notNull().default(sql`'[]'`),
    /** What moved me. */
    note: text('note').notNull().default(''),
    createdAt: createdAt(),
    measuredAt: integer('measured_at'),
  },
  (t) => [uniqueIndex('reference_videos_key_idx').on(t.platform, t.externalId), index('reference_videos_created_idx').on(t.createdAt)],
);

/** A page's style, written from what I marked on its references (shared/references.ts `PageStyle`), editable by me. */
export const pageStyles = sqliteTable('page_styles', {
  workspaceId: text('workspace_id')
    .primaryKey()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  body: text('body').notNull().default(''),
  status: text('status').$type<PageStyle['status']>().notNull().default('idle'),
  error: text('error'),
  builtAt: integer('built_at'),
  /** What it was written from (references, marks, notes), to tell when it's out of date. */
  builtFrom: text('built_from').notNull().default(''),
  /** The words as written, to tell whether I've changed them. */
  builtBody: text('built_body').notNull().default(''),
  references: integer('reference_count').notNull().default(0),
  updatedAt: updatedAt(),
});

/**
 * A rule on the Knowledge page (shared/knowledge.ts). Seeded ones keep the playbook text they came from (`seedKey` =
 * `file#heading`, `seedTitle`/`seedBody`), so an update of the playbook refreshes them only while I haven't edited them.
 */
export const knowledge = sqliteTable(
  'knowledge',
  {
    id: id(),
    workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    topic: text('topic').$type<KnowledgeTopic>().notNull(),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    source: text('source').$type<KnowledgeSource>().notNull().default('you'),
    status: text('status').$type<KnowledgeStatus>().notNull().default('active'),
    note: text('note').notNull().default(''),
    /** The reference it was drafted from. */
    referenceId: text('reference_id').references(() => referenceVideos.id, { onDelete: 'set null' }),
    seedKey: text('seed_key'),
    seedTitle: text('seed_title'),
    seedBody: text('seed_body'),
    position: real('position').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('knowledge_topic_idx').on(t.topic), uniqueIndex('knowledge_seed_idx').on(t.seedKey)],
);

/** How often each skill, studio tool and model was used (the Toolbox page), counted from when the Toolbox came in. */
export const toolUses = sqliteTable(
  'tool_uses',
  {
    kind: text('kind').$type<ToolKind>().notNull(),
    name: text('name').notNull(),
    count: integer('count').notNull().default(0),
    lastAt: integer('last_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.kind, t.name] })],
);

/** What the weekly scout found (repos, skills, MCP servers, models), kept so a find shows up once. */
export const toolFinds = sqliteTable(
  'tool_finds',
  {
    id: id(),
    kind: text('kind').$type<FindKind>().notNull(),
    name: text('name').notNull(),
    url: text('url').notNull(),
    description: text('description').notNull().default(''),
    adds: text('adds').notNull().default(''),
    risks: text('risks', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    licence: text('licence'),
    stars: integer('stars').notNull().default(0),
    upstreamAt: integer('upstream_at'),
    score: integer('score').notNull().default(0),
    install: text('install').notNull().default(''),
    // `seen` = looked at and not worth showing: kept so the scout doesn't judge it again.
    status: text('status').$type<FindStatus | 'seen'>().notNull().default('new'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('tool_finds_url_idx').on(t.url)],
);
