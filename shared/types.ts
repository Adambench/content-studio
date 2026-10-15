// Types and constants shared by the server and the web app.

export const PLATFORMS = ['tiktok', 'instagram', 'youtube', 'x'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const PLATFORM_LABELS: Record<Platform, string> = {
  tiktok: 'TikTok',
  instagram: 'Instagram',
  youtube: 'YouTube Shorts',
  x: 'X',
};

/** The editable content of one alternative (branch) of a piece. Versions snapshot this. */
export type DraftContent = {
  hook: string;
  script: string;
  notes: string;
  platforms: {
    tiktok: { caption: string; hashtags: string };
    instagram: { caption: string; hashtags: string };
    youtube: { title: string; description: string; tags: string };
    x: { text: string };
  };
};

export function emptyDraft(): DraftContent {
  return {
    hook: '',
    script: '',
    notes: '',
    platforms: {
      tiktok: { caption: '', hashtags: '' },
      instagram: { caption: '', hashtags: '' },
      youtube: { title: '', description: '', tags: '' },
      x: { text: '' },
    },
  };
}

/** Fill any missing fields so older or partial drafts always have the full shape. */
export function normalizeDraft(input: unknown): DraftContent {
  const base = emptyDraft();
  const d = (input ?? {}) as Partial<DraftContent>;
  const p = (d.platforms ?? {}) as Partial<DraftContent['platforms']>;
  return {
    hook: d.hook ?? base.hook,
    script: d.script ?? base.script,
    notes: d.notes ?? base.notes,
    platforms: {
      tiktok: { ...base.platforms.tiktok, ...p.tiktok },
      instagram: { ...base.platforms.instagram, ...p.instagram },
      youtube: { ...base.platforms.youtube, ...p.youtube },
      x: { ...base.platforms.x, ...p.x },
    },
  };
}

/** Flat list of every text field in a draft, used for diffs and edit learning. */
export const DRAFT_FIELDS: { key: string; label: string; get: (d: DraftContent) => string }[] = [
  { key: 'hook', label: 'Hook', get: (d) => d.hook },
  { key: 'script', label: 'Script', get: (d) => d.script },
  { key: 'notes', label: 'Notes', get: (d) => d.notes },
  { key: 'tiktok.caption', label: 'TikTok caption', get: (d) => d.platforms.tiktok.caption },
  { key: 'tiktok.hashtags', label: 'TikTok hashtags', get: (d) => d.platforms.tiktok.hashtags },
  { key: 'instagram.caption', label: 'Instagram caption', get: (d) => d.platforms.instagram.caption },
  { key: 'instagram.hashtags', label: 'Instagram hashtags', get: (d) => d.platforms.instagram.hashtags },
  { key: 'youtube.title', label: 'YouTube title', get: (d) => d.platforms.youtube.title },
  { key: 'youtube.description', label: 'YouTube description', get: (d) => d.platforms.youtube.description },
  { key: 'youtube.tags', label: 'YouTube tags', get: (d) => d.platforms.youtube.tags },
  { key: 'x.text', label: 'X post', get: (d) => d.platforms.x.text },
];

/** Platform text limits shown as counters in the editor. */
export const LIMITS = {
  tiktokCaption: 2200,
  instagramCaption: 2200,
  youtubeTitle: 100,
  youtubeDescription: 5000,
  xText: 280,
} as const;

export type Stage = { id: string; name: string };

export const DEFAULT_STAGES: Stage[] = [
  { id: 'idea', name: 'Idea' },
  { id: 'script', name: 'Script' },
  { id: 'film', name: 'Film' },
  { id: 'edit', name: 'Edit' },
  { id: 'ready', name: 'Ready' },
  { id: 'scheduled', name: 'Scheduled' },
  { id: 'posted', name: 'Posted' },
];

export const WORKSPACE_COLORS = ['violet', 'blue', 'cyan', 'emerald', 'amber', 'orange', 'rose', 'pink'] as const;
export type WorkspaceColor = (typeof WORKSPACE_COLORS)[number];

export type MediaKind = 'video' | 'image' | 'audio' | 'other';
export const ASSET_TYPES = ['logo', 'font', 'lut', 'music', 'sfx', 'template', 'other'] as const;
export type AssetType = (typeof ASSET_TYPES)[number];
export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  logo: 'Logos & images',
  font: 'Fonts',
  lut: 'LUTs',
  music: 'Music',
  sfx: 'Sound effects',
  template: 'Templates',
  other: 'Other',
};

export type TranscriptStatus = 'none' | 'queued' | 'running' | 'done' | 'error' | 'unavailable';
export type MediaSource = 'upload' | 'capture' | 'share' | 'render';
/** The browser-friendly copy of a clip that the video studio previews and renders from. */
export type ProxyStatus = 'none' | 'queued' | 'running' | 'done' | 'error';
export type RenderStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

export type TranscriptWord = { start: number; end: number; word: string };
export type TranscriptSegment = { start: number; end: number; text: string; words?: TranscriptWord[] };
export type Transcript = { language: string; duration: number; text: string; segments: TranscriptSegment[] };

export const CLAUDE_MODELS = [
  { id: 'sonnet', label: 'Sonnet', hint: 'Balanced — everyday default' },
  { id: 'opus', label: 'Opus', hint: 'Most capable — uses Pro limits faster' },
  { id: 'haiku', label: 'Haiku', hint: 'Fastest and lightest' },
] as const;
export type ClaudeModelId = (typeof CLAUDE_MODELS)[number]['id'];

/** One rendered piece of an assistant message. */
export type ChatPart =
  | { type: 'text'; text: string }
  | { type: 'tool'; id: string; name: string; label: string; status: 'running' | 'done' | 'error'; detail?: string };

export type ChatStreamEvent =
  | { type: 'start'; messageId: string; model?: string }
  | { type: 'text'; text: string }
  | { type: 'tool_start'; id: string; name: string; label: string }
  | { type: 'tool_end'; id: string; ok: boolean; detail?: string }
  | { type: 'usage'; usage: ClaudeUsage }
  | { type: 'done'; messageId: string }
  | { type: 'error'; message: string };

export type ClaudeUsage = {
  status: 'allowed' | 'allowed_warning' | 'rejected';
  fiveHour?: { utilization: number; resetsAt: number };
  sevenDay?: { utilization: number; resetsAt: number };
  updatedAt: number;
};

/** Server → client live-update notifications (SSE). */
export type LiveEvent =
  | {
      type: 'changed';
      entity: 'workspaces' | 'pieces' | 'media' | 'threads' | 'settings' | 'edits' | 'renders' | 'accounts' | 'posts' | 'stats' | 'reviews' | 'devices';
      workspaceId?: string;
      id?: string;
      pieceId?: string;
    }
  | { type: 'edit'; editId: string; pieceId: string; by: 'claude' | 'you' }
  | { type: 'branch'; branchId: string; pieceId: string; by: 'claude' | 'you' }
  | { type: 'job'; jobType: string; status: 'done' | 'error'; workspaceId?: string; message?: string }
  | { type: 'notify'; title: string; body: string; url: string };
