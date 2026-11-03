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

/** A clipping page's board: clips are made for it, reviewed, then go out like any other piece. */
export const CLIPPING_STAGES: Stage[] = [
  { id: 'making', name: 'Making' },
  { id: 'review', name: 'Review' },
  { id: 'ready', name: 'Ready' },
  { id: 'scheduled', name: 'Scheduled' },
  { id: 'posted', name: 'Posted' },
];

/** An Islamic page's board: originals (idea → script → record → edit) and lecture clips (made → reviewed) meet in Ready. */
export const ISLAMIC_STAGES: Stage[] = [
  { id: 'idea', name: 'Idea' },
  { id: 'script', name: 'Script' },
  { id: 'film', name: 'Record' },
  { id: 'edit', name: 'Edit' },
  { id: 'making', name: 'Clips making' },
  { id: 'review', name: 'Review' },
  { id: 'ready', name: 'Ready' },
  { id: 'scheduled', name: 'Scheduled' },
  { id: 'posted', name: 'Posted' },
];

/** Where clips wait for my yes or no (Today lists them). */
export const REVIEW_STAGE = 'review';

export const WORKSPACE_COLORS = ['violet', 'blue', 'cyan', 'emerald', 'amber', 'orange', 'rose', 'pink'] as const;
export type WorkspaceColor = (typeof WORKSPACE_COLORS)[number];

/** What a workspace is for. A kind presets modules, stages and Claude's instructions; it doesn't fence anything off. */
export const WORKSPACE_KINDS = ['personal', 'business', 'clipping', 'islamic'] as const;
export type WorkspaceKind = (typeof WORKSPACE_KINDS)[number];

export const MODULES = ['ideas', 'filming', 'grading', 'campaigns', 'clipping', 'research'] as const;
export type ModuleId = (typeof MODULES)[number];

export const KIND_INFO: Record<WorkspaceKind, { label: string; hint: string; niche: string }> = {
  personal: { label: 'Personal brand', hint: 'Your own voice and face: ideas, scripts, filming, a graded look', niche: 'e.g. Muslim entrepreneurship and everyday deen for young professionals' },
  business: { label: 'Business', hint: 'A business’s page: its offers and brand, its own footage', niche: 'e.g. Handmade leather goods for people who buy once and keep it for life' },
  clipping: { label: 'Clipping page', hint: 'A niche page fed by campaigns: streams and podcasts cut into clips', niche: 'e.g. Business and money advice from podcasts, for 18–30s starting out' },
  islamic: { label: 'Islamic page', hint: 'Reminders, ayat and hadith with their sources on screen, lecture clips, your own voice', niche: 'e.g. Daily reminders for Muslims: patience, the akhirah, ayat and hadith explained' },
};

export const MODULE_INFO: Record<ModuleId, { label: string; hint: string }> = {
  ideas: { label: 'Ideas & scripts', hint: 'Capture ideas by voice or text; Claude turns them into cards and scripts' },
  filming: { label: 'Filming', hint: 'You film yourself: Claude plans shots and delivery' },
  grading: { label: 'Grading', hint: 'Colour grades (LUTs) in the video editor and brand assets' },
  campaigns: { label: 'Campaigns', hint: 'Content Rewards and Vyro campaigns, and your businesses’ own' },
  clipping: { label: 'Clipping', hint: 'Long videos in, clips out: sources and the moments found in them' },
  research: { label: 'Research brief', hint: 'A daily look at what’s working in the niche' },
};

export const KIND_PRESETS: Record<WorkspaceKind, { modules: ModuleId[]; stages: Stage[] }> = {
  personal: { modules: ['ideas', 'filming', 'grading', 'research'], stages: DEFAULT_STAGES },
  business: { modules: ['ideas', 'filming', 'grading', 'campaigns', 'research'], stages: DEFAULT_STAGES },
  clipping: { modules: ['campaigns', 'clipping', 'research'], stages: CLIPPING_STAGES },
  islamic: { modules: ['ideas', 'clipping', 'research'], stages: ISLAMIC_STAGES },
};

/** Known modules only, in the usual order. */
export function normalizeModules(input: unknown): ModuleId[] {
  const list = Array.isArray(input) ? input : [];
  return MODULES.filter((m) => list.includes(m));
}

export type MediaKind = 'video' | 'image' | 'audio' | 'other';
/** No music: a vocal-only nasheed is the only track an edit can have, and only the creator adds one. */
export const ASSET_TYPES = ['logo', 'font', 'lut', 'nasheed', 'sfx', 'template', 'other'] as const;
export type AssetType = (typeof ASSET_TYPES)[number];
export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  logo: 'Logos & images',
  font: 'Fonts',
  lut: 'LUTs',
  nasheed: 'Nasheeds',
  sfx: 'Sound effects',
  template: 'Templates',
  other: 'Other',
};

/** Claude's guess at the video a loose (Inbox) file belongs to: a piece, or a new idea named `title`. */
export type InboxSuggestion = { pieceId: string | null; title: string; why: string; at: number };

export type TranscriptStatus = 'none' | 'queued' | 'running' | 'done' | 'error' | 'unavailable';
/**
 * `clip`: cut from a campaign's source video by clipping. `tts`: speech made on this computer for a format video.
 * `generated`: a built-in moving background. `idea`: a picture on an Ideas card (a screenshot, a saved post's thumbnail).
 */
export type MediaSource = 'upload' | 'capture' | 'share' | 'render' | 'clip' | 'tts' | 'generated' | 'idea';
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
/** What a chat can run on: a Claude model, or the creator's own model on the home server (Settings → Models). */
export const CHAT_MODELS = [...CLAUDE_MODELS, { id: 'local', label: 'Local', hint: 'Your own model on the home server' }] as const;

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
      entity: 'workspaces' | 'pieces' | 'media' | 'threads' | 'settings' | 'edits' | 'renders' | 'accounts' | 'posts' | 'stats' | 'reviews' | 'devices' | 'sites' | 'campaigns' | 'submissions' | 'research' | 'finder' | 'compute' | 'ideas' | 'knowledge' | 'references' | 'toolbox' | 'notes';
      workspaceId?: string;
      id?: string;
      pieceId?: string;
    }
  | { type: 'edit'; editId: string; pieceId: string; by: 'claude' | 'you' }
  | { type: 'branch'; branchId: string; pieceId: string; by: 'claude' | 'you' }
  /** `running` carries progress for jobs that report it (a format video's voice), with the edit it's for. */
  | { type: 'job'; jobType: string; status: 'running' | 'done' | 'error'; workspaceId?: string; message?: string; editId?: string }
  | { type: 'notify'; title: string; body: string; url: string };
