import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { PostStats, ReviewBody, ReviewStatus } from '../../../shared/analytics';
import type { EditSpec, EditTemplate } from '../../../shared/edit';
import type { AccountSettings, AccountStatus, PostCopy, PostFormat, PostOptions, PostStatus, PublishPlatform, QueueSlot } from '../../../shared/publish';
import type { SessionKind } from '../../../shared/devices';
import type { AssetType, ChatPart, DraftContent, MediaKind, MediaSource, ProxyStatus, RenderStatus, Stage, TranscriptStatus } from '../../../shared/types';

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
  description: text('description').notNull().default(''),
  brandGuide: text('brand_guide').notNull().default(''),
  // Claude-maintained notes about my voice, learned from my edits.
  voiceMemory: text('voice_memory').notNull().default(''),
  // The brand's video look (captions, grade, watermark, music), applied to new edits.
  editTemplate: text('edit_template', { mode: 'json' }).$type<EditTemplate>(),
  stages: text('stages', { mode: 'json' }).$type<Stage[]>().notNull(),
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
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('pieces_workspace_idx').on(t.workspaceId)],
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
    // Set for brand assets (logos, fonts, LUTs, music, SFX); null for footage.
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
    createdAt: createdAt(),
    finishedAt: integer('finished_at'),
  },
  (t) => [index('renders_edit_idx').on(t.editId)],
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
    sdkSessionId: text('sdk_session_id'),
    model: text('model'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('threads_workspace_idx').on(t.workspaceId)],
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
  source: text('source').$type<'upload' | 'capture' | 'share'>().notNull().default('upload'),
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
