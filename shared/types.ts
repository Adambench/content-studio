// Types both sides use. Plain data only: the server and the CLI run these files with Node's type stripping, so no
// enums, namespaces or other syntax that needs compiling.

export const STAGES = ['idea', 'script', 'needs_me', 'making', 'review', 'ready', 'posted', 'trash'] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  idea: 'Ideas',
  script: 'Script',
  needs_me: 'Needs me',
  making: 'Making',
  review: 'Review',
  ready: 'Ready',
  posted: 'Posted',
  trash: 'Trash',
};

/** The board's columns, left to right. Trash is reached from a card, not shown as a column. */
export const BOARD_STAGES: Stage[] = ['idea', 'script', 'needs_me', 'making', 'review', 'ready', 'posted'];

export type Level = 'off' | 'light' | 'full';
export type CaptionStyle = 'two-words' | 'line' | 'word' | 'off';

export type BrandColor = { name: string; hex: string };

/** A page's defaults. Every card can do otherwise: these are where Claude starts, not limits. */
export type PageSettings = {
  niche: string;
  voice: string;
  style: string;
  colors: BrandColor[];
  fonts: { display: string; body: string; arabic: string };
  logoInputId: string | null;
  captions: CaptionStyle;
  look: string;
  sfx: Level;
  ambience: Level;
  autoMake: boolean;
};

export const DEFAULT_PAGE_SETTINGS: PageSettings = {
  niche: '',
  voice: '',
  style: '',
  colors: [],
  fonts: { display: '', body: '', arabic: '' },
  logoInputId: null,
  captions: 'two-words',
  look: 'natural',
  sfx: 'off',
  ambience: 'off',
  autoMake: false,
};

export type Page = {
  id: string;
  name: string;
  color: string;
  position: number;
  settings: PageSettings;
  createdAt: number;
  updatedAt: number;
};

export type DocLabels = { script: string; notes: string };
export const DEFAULT_LABELS: DocLabels = { script: 'Script', notes: 'Notes' };

/** What the board shows about a card without opening it. */
export type CardSummary = {
  id: string;
  pageId: string;
  title: string;
  stage: Stage;
  position: number;
  recipe: string;
  inputs: number;
  versions: number;
  openComments: number;
  latestRender: { id: string; status: RenderStatus; duration: number | null; poster: string | null } | null;
  job: { id: string; kind: JobKind; status: JobStatus; step: string | null; progress: number } | null;
  stageAt: number;
  updatedAt: number;
};

export type Card = CardSummary & {
  script: string;
  notes: string;
  labels: DocLabels;
  caption: string;
  createdAt: number;
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
  cardId: string;
  kind: InputKind;
  role: InputRole;
  name: string;
  mime: string;
  size: number;
  meta: MediaMeta | null;
  position: number;
  createdAt: number;
};

export type Author = 'claude' | 'you';
export type VersionKind = 'video' | 'carousel';

export type Version = {
  id: string;
  cardId: string;
  n: number;
  author: Author;
  kind: VersionKind;
  recipe: string;
  note: string;
  slides: number;
  createdAt: number;
};

export type RenderStatus = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';

export type Render = {
  id: string;
  cardId: string;
  versionId: string;
  n: number;
  status: RenderStatus;
  duration: number | null;
  width: number | null;
  height: number | null;
  error: string | null;
  createdAt: number;
  finishedAt: number | null;
};

export type CommentStatus = 'open' | 'fixed' | 'closed';

export type Comment = {
  id: string;
  cardId: string;
  renderId: string | null;
  versionId: string | null;
  at: number | null;
  end: number | null;
  slide: number | null;
  text: string;
  status: CommentStatus;
  reply: string | null;
  ruleId: string | null;
  createdAt: number;
  resolvedAt: number | null;
};

export type RuleSource = 'halal' | 'base' | 'lesson' | 'market' | 'style';
export type RuleStatus = 'on' | 'off' | 'suggested';

export type Rule = {
  id: string;
  pageId: string | null;
  format: string | null;
  source: RuleSource;
  topic: string;
  title: string;
  body: string;
  check: string | null;
  status: RuleStatus;
  locked: boolean;
  taught: number;
  createdAt: number;
  updatedAt: number;
};

export const JOB_KINDS = ['make', 'fix', 'write', 'hooks', 'look', 'test-render'] as const;
export type JobKind = (typeof JOB_KINDS)[number];
export type JobStatus = 'queued' | 'waiting' | 'running' | 'done' | 'failed' | 'cancelled';

export type JobLine = { at: number; text: string };

export type Job = {
  id: string;
  kind: JobKind;
  cardId: string | null;
  status: JobStatus;
  step: string | null;
  progress: number;
  log: JobLine[];
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
};

export type Entity = 'page' | 'card' | 'input' | 'version' | 'render' | 'comment' | 'rule' | 'job' | 'system';
export type LiveEvent = { entity: Entity; id: string; cardId?: string };

export type SystemInfo = {
  version: string;
  host: string;
  gpu: string | null;
  tools: { name: string; ok: boolean; detail: string }[];
  claude: { loggedIn: boolean; detail: string };
};

export type Hook = { line: string; why: string };

/** Everything a card's page shows, in one request. */
export type CardDetail = {
  card: Card;
  inputs: Input[];
  versions: Version[];
  renders: Render[];
  comments: Comment[];
  jobs: Job[];
  hooks: Hook[] | null;
};

export type Draft = { id: string; author: string; script: string; notes: string; note: string; createdAt: number };
