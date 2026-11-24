// Types both sides use. Plain data only: the server and the CLI run these files with Node's type stripping, so no
// enums, namespaces or other syntax that needs compiling.

/** A page: one Instagram account. Its folder holds its brain (CLAUDE.md), its look (kit/), its setup and its videos. */
export type Page = {
  id: string;
  slug: string;
  name: string;
  color: string;
  position: number;
  /** The page's own studio, where Claude sets it up with me (a video row of kind 'page'); null until it's made. */
  setupId: string | null;
  createdAt: number;
  updatedAt: number;
};

/** How a page is set up: from what I give, a mix (keep mine, build the rest), or from scratch. */
export const PAGE_MODES = ['mine', 'mix', 'fresh'] as const;
export type PageMode = (typeof PAGE_MODES)[number];

/** What a video is meant to be. A hint for Claude, never a limit: "auto" lets it choose. */
export const KINDS = ['auto', 'talking-head', 'voiceover', 'carousel', 'ugc', 'explainer', 'graded'] as const;
/** 'page' is a page's setup, never picked for a video. */
export type Kind = (typeof KINDS)[number] | 'page';
export const KIND_LABEL: Record<Kind, string> = {
  auto: 'Auto',
  'talking-head': 'Talking head',
  voiceover: 'Voiceover',
  carousel: 'Carousel',
  ugc: 'UGC',
  explainer: 'Explainer',
  graded: 'Graded shots',
  page: 'Page setup',
};

/**
 * Never set by hand: Making while Claude works or files upload, Ready once approved, Posted once I say so. A page's
 * setup is Done once approved (it's never posted).
 */
export type VideoStatus = 'turn' | 'making' | 'ready' | 'posted' | 'done';

export type VersionKind = 'video' | 'carousel';

export type VideoSummary = {
  id: string;
  pageId: string;
  slug: string;
  title: string;
  kind: Kind;
  status: VideoStatus;
  /** One line under the title: what's waiting for me, or what Claude is doing. */
  reason: string;
  /** Something new since I last opened it (a version, a question, an answer). */
  unseen: boolean;
  latest: { id: string; n: number; kind: VersionKind; duration: number | null; slides: number } | null;
  openNotes: number;
  job: { id: string; status: JobStatus; step: string | null; progress: number } | null;
  uploading: number;
  approvedN: number | null;
  postedAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type Video = VideoSummary & {
  caption: string;
  makeAtInputs: number | null;
  sessionId: string | null;
  /** Its folder on ai-server, for the terminal. */
  folder: string;
};

export type InputKind = 'video' | 'audio' | 'image' | 'doc' | 'other';
export type InputRole = 'take' | 'voice' | 'proof' | 'product' | 'broll' | 'logo' | 'reference' | null;

export type MediaMeta = {
  duration: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  rotation: number | null;
  hasAudio: boolean;
  hasVideo: boolean;
  codec: string | null;
  hdr: boolean;
};

export type Input = {
  id: string;
  videoId: string;
  kind: InputKind;
  role: InputRole;
  name: string;
  mime: string;
  size: number;
  meta: MediaMeta | null;
  position: number;
  createdAt: number;
};

export type Version = {
  id: string;
  videoId: string;
  n: number;
  kind: VersionKind;
  note: string;
  duration: number | null;
  width: number | null;
  height: number | null;
  slides: number;
  createdAt: number;
};

export type NoteStatus = 'open' | 'sent' | 'fixed';

export type Note = {
  id: string;
  videoId: string;
  versionN: number;
  at: number | null;
  slide: number | null;
  text: string;
  status: NoteStatus;
  fixedIn: number | null;
  reply: string | null;
  createdAt: number;
  resolvedAt: number | null;
};

/**
 * you: my message · claude: its words · step: what it says it's doing (progress) · tool: a command or file it used
 * (shown on request) · question: options to pick · version: a version saved · lesson: a rule learned from a note ·
 * sys: a fact (approved, posted) · error: a run that stopped.
 */
export type ThreadKind = 'you' | 'claude' | 'step' | 'tool' | 'question' | 'version' | 'lesson' | 'sys' | 'error';

export type ThreadItem = {
  id: string;
  videoId: string;
  jobId: string | null;
  kind: ThreadKind;
  text: string;
  data: Record<string, unknown>;
  createdAt: number;
};

export const JOB_KINDS = ['agent', 'look', 'test-render'] as const;
export type JobKind = (typeof JOB_KINDS)[number];
export type JobStatus = 'queued' | 'waiting' | 'running' | 'done' | 'failed' | 'cancelled';

export type JobLine = { at: number; text: string };

export type Job = {
  id: string;
  kind: JobKind;
  videoId: string | null;
  status: JobStatus;
  step: string | null;
  progress: number;
  log: JobLine[];
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
};

/** Everything a video's page shows, in one request. */
export type VideoDetail = {
  video: Video;
  inputs: Input[];
  versions: Version[];
  notes: Note[];
  thread: ThreadItem[];
  job: Job | null;
};

export type Entity = 'page' | 'video' | 'thread' | 'input' | 'version' | 'note' | 'job' | 'brain' | 'system';
export type LiveEvent = { entity: Entity; id: string; videoId?: string };

export type Lesson = { text: string; on: boolean; line: number };

/** What Claude follows: plain files on ai-server, shown and edited in Brain. */
export type Brain = {
  halal: string[];
  lessons: Lesson[];
  pages: { pageId: string; name: string; color: string; file: string; text: string; lessons: Lesson[] }[];
  market: string;
  skills: { name: string; description: string }[];
};

export type SystemInfo = {
  version: string;
  host: string;
  gpu: string | null;
  tools: { name: string; ok: boolean; detail: string }[];
  claude: { loggedIn: boolean; detail: string };
  studioDir: string;
  diskFree: number | null;
};
