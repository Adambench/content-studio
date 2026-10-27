// Which model does each AI job: Claude (the Pro login) or the self-hosted model on the home server (Ollama on a
// worker, or any address set in Settings). Each task is set to Claude, local, or auto; auto stays on Claude until its
// usage passes a limit (or Claude refuses for usage), then uses the local model. *Local only* overrides everything.

export const AI_TASKS = ['chat', 'directions', 'quality', 'clips', 'ugc', 'review', 'research', 'inbox', 'ideas', 'pages', 'pictures'] as const;
export type AiTask = (typeof AI_TASKS)[number];

export const AI_TASK_INFO: Record<AiTask, { label: string; hint: string }> = {
  chat: { label: 'Chat and video chats', hint: 'Writing, editing videos, everything you ask in a chat' },
  directions: { label: 'Creative directions', hint: 'The 2–3 directions pitched for a new video' },
  quality: { label: 'Quality check', hint: 'Judging an edit’s hook and payoff before it renders' },
  clips: { label: 'Clip picking', hint: 'Choosing moments in long videos and checking the cut frames' },
  ugc: { label: 'UGC scripts', hint: 'Scripts for UGC videos from a campaign brief' },
  review: { label: 'Weekly review', hint: 'Reading the week’s results and suggesting what to change' },
  research: { label: 'Research', hint: 'Why outliers worked, and the daily brief' },
  inbox: { label: 'Inbox filing', hint: 'Which idea a shared file belongs to' },
  ideas: { label: 'Ideas and voice', hint: 'Help on Ideas cards, fleshing out a locked-in idea, voice memos into cards, learning from your rewrites' },
  pages: { label: 'Reading pages', hint: 'Campaign rules, submissions and listings read from sites' },
  pictures: { label: 'Checking generated pictures', hint: 'That a generated image or clip shows no people or animals' },
};

export type AiMode = 'auto' | 'claude' | 'local';
export const AI_MODE_LABELS: Record<AiMode, string> = { auto: 'Auto', claude: 'Claude', local: 'Local' };

export type AiRouting = {
  /** Everything on the local model, whatever each task says. */
  localOnly: boolean;
  tasks: Record<AiTask, AiMode>;
  /** Auto moves to the local model once Claude's weekly usage reaches this share (0–1)… */
  weeklyAt: number;
  /** …or its 5-hour usage reaches this one. */
  fiveHourAt: number;
};

export const DEFAULT_AI_ROUTING: AiRouting = {
  localOnly: false,
  tasks: Object.fromEntries(AI_TASKS.map((t) => [t, 'auto'])) as Record<AiTask, AiMode>,
  weeklyAt: 0.9,
  fiveHourAt: 0.9,
};

export function normalizeRouting(r: Partial<AiRouting> | undefined): AiRouting {
  const tasks = { ...DEFAULT_AI_ROUTING.tasks };
  for (const t of AI_TASKS) {
    const m = r?.tasks?.[t];
    if (m === 'auto' || m === 'claude' || m === 'local') tasks[t] = m;
  }
  const share = (v: unknown, d: number) => (typeof v === 'number' && v > 0 && v <= 1 ? v : d);
  return { localOnly: !!r?.localOnly, tasks, weeklyAt: share(r?.weeklyAt, 0.9), fiveHourAt: share(r?.fiveHourAt, 0.9) };
}

/** The local model server: an address set by hand, or the one a worker hosts (found on its own). */
export type LocalAiConfig = {
  /** e.g. http://desktop-1070:11434; empty = the worker's. */
  url: string;
  /** The model for everything (text, pictures, tools); empty = the server's first one that has tools. */
  model: string;
  /** The context window every call uses (fixed: a change reloads the model). */
  contextTokens: number;
};

export const DEFAULT_LOCAL_AI: LocalAiConfig = { url: '', model: '', contextTokens: 32768 };

/** The model the setup script pulls (Qwen3-VL 30B-A3B: text, images and tools in one, ~20 GB, partly in RAM). */
export const RECOMMENDED_LOCAL_MODEL = 'qwen3-vl:30b-a3b-instruct';

export type LocalModel = { name: string; sizeGb: number; vision: boolean; tools: boolean };

export type LocalAiStatus = {
  url: string | null;
  /** Where the address came from. */
  source: 'settings' | 'worker' | null;
  /** The worker's name when it came from one. */
  worker: string | null;
  reachable: boolean;
  models: LocalModel[];
  /** The model calls use now (the setting, or the first suitable one). */
  model: string | null;
  error: string | null;
};

/** Where each task goes right now, and why, for Settings. */
export type AiRouteNow = { provider: 'claude' | 'local'; reason: string };
