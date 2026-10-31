// The Toolbox: everything the app builds videos with (skills, the studio's tools, models, programs, libraries), what
// each is, its version and licence and how often it was used; and what the weekly scout found that could make the
// videos better. Installing a find is my click (the Install button), never the app's or Claude's.

export const TOOL_KINDS = ['skill', 'tool', 'model', 'program', 'library'] as const;
export type ToolKind = (typeof TOOL_KINDS)[number];

export const TOOL_KIND_INFO: Record<ToolKind, { label: string; hint: string }> = {
  skill: { label: 'Skills', hint: 'Know-how Claude reads: built into the app, added from the Toolbox, or Claude Code’s own' },
  tool: { label: 'Studio tools', hint: 'What Claude can do in the app: the in-app MCP server `studio`, and the web' },
  model: { label: 'Models', hint: 'Claude on the Pro login, the self-hosted models on the home PCs, kie.ai' },
  program: { label: 'Programs', hint: 'Command-line programs and Python environments the app runs' },
  library: { label: 'Libraries', hint: 'The packages the app is built on' },
};

/**
 * Where a skill lives. `built-in` ships with the app (the repo's `.claude/skills`, the studio-skills plugin); `app` was
 * added from the Toolbox into the data folder (the studio-added plugin) and is in the chat at once; `claude-code` is
 * `~/.claude/skills`, for Claude Code in a terminal in every folder: the app never loads those.
 */
export type SkillHome = 'built-in' | 'app' | 'claude-code';

export const SKILL_HOME_INFO: Record<SkillHome, { label: string; hint: string }> = {
  'built-in': { label: 'Built in', hint: 'Ships with the app' },
  app: { label: 'Content Studio', hint: 'Claude in this app reads it when it writes scripts, scenes and edits. Ready at once, kept across updates.' },
  'claude-code': { label: 'Claude Code', hint: 'Claude Code in a terminal, in every folder. It can run the skill’s own commands. The app doesn’t see it.' },
};

/** Where the Install button can put a skill. */
export const INSTALL_PLACES = ['app', 'claude-code'] as const;
export type InstallPlace = (typeof INSTALL_PLACES)[number];

/** Whether it can be used now. `off` = installed, not used by the app (e.g. a skill the chat doesn't load). */
export type ToolStatus = 'ready' | 'missing' | 'off';

export type InstalledTool = {
  kind: ToolKind;
  /** Unique within its kind; the key its uses are counted under. */
  name: string;
  /** The name to show, when it isn't `name`. */
  label?: string;
  about: string;
  version: string | null;
  /** SPDX id (MIT, Apache-2.0…), a short note, or null when unknown. */
  licence: string | null;
  /** A link to where it comes from. */
  source: string | null;
  /** Where it runs or was found: a path, a worker, a service. */
  where: string | null;
  status: ToolStatus;
  note: string;
  /** Skills only: where it lives. */
  home?: SkillHome;
  /** Times used since the Toolbox started counting (null: not counted for this kind). */
  uses: number | null;
  lastUsedAt: number | null;
};

export const FIND_KINDS = ['skill', 'mcp', 'repo', 'model'] as const;
export type FindKind = (typeof FIND_KINDS)[number];
export const FIND_KIND_LABELS: Record<FindKind, string> = { skill: 'Skill', mcp: 'MCP server', repo: 'Repo', model: 'Model' };

export type FindStatus = 'new' | 'wanted' | 'dismissed';
/** The Finds page's filters: a find with a skill installed anywhere is under Installed, whatever its status. */
export type FindFilter = FindStatus | 'installed';

export type ToolFind = {
  id: string;
  kind: FindKind;
  name: string;
  url: string;
  /** What the repo or model says it is. */
  description: string;
  /** What it would add to the videos, in a sentence. */
  adds: string;
  /** Licence trouble, music advice, paid services, people in generated pictures… */
  risks: string[];
  licence: string | null;
  /** GitHub stars or Hugging Face likes. */
  stars: number;
  /** Last change upstream (ms). */
  updatedAt: number | null;
  /** 0–10: how much it could do for these videos. */
  score: number;
  /** The command that installs it, when there is one (skills). */
  install: string;
  /** Skills only: the repo's skills the scout saw. */
  skills: string[];
  /** Its skills that are installed, and where (matched by the repo they came from). */
  installed: { skill: string; home: SkillHome }[];
  status: FindStatus;
  foundAt: number;
};

/** `waiting`: queued until Claude's 5-hour usage comes down (`waitUntil`); `stopped`: I stopped it. */
export type ScoutRun = {
  startedAt: number;
  finishedAt: number | null;
  status: 'waiting' | 'running' | 'done' | 'failed' | 'stopped';
  looked: number;
  found: number;
  error: string | null;
  /** What it's doing now, while it runs or waits. */
  step?: string | null;
  waitUntil?: number | null;
  /** Searching is over: Claude is judging (Finish now has nothing left to skip). */
  judging?: boolean;
};

/** One skill of a repo, before installing: what it is, its size, and where it's already installed. */
export type SkillPreview = {
  name: string;
  about: string;
  files: number;
  bytes: number;
  /** Sound and video files that won't be copied (they could hold music). */
  leftOut: number;
  /** It ships scripts (or asks for a shell): only Claude Code can run them. */
  runsCommands: boolean;
  homes: SkillHome[];
};

export type InstallPreview = { repo: string; url: string; licence: string | null; licenceRisk: string | null; skills: SkillPreview[] };

/** An install in progress or just finished (kept in memory: they take seconds). */
export type InstallRun = {
  id: string;
  repo: string;
  skills: string[];
  places: InstallPlace[];
  status: 'running' | 'done' | 'failed';
  step: string;
  /** Files downloaded, of `total`. */
  done: number;
  total: number;
  /** What it left out or skipped, and why. */
  notes: string[];
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
};

export type Toolbox = { installed: InstalledTool[]; finds: ToolFind[]; scout: ScoutRun | null; nextScoutAt: number | null; installs: InstallRun[] };

/** A skill's files that are never copied: sound and video could hold music (halal), and a skill only needs its text. */
export const LEFT_OUT_FILE = /\.(mp3|wav|ogg|oga|opus|m4a|aac|flac|aif|aiff|wma|mid|midi|mp4|m4v|mov|webm|mkv|avi)$/i;

/** owner/repo from a GitHub link or the short form, or null. */
export function parseRepo(text: string): string | null {
  const m = /^(?:https?:\/\/)?(?:www\.)?(?:github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#].*)?$/i.exec(text.trim());
  return m && ![m[1], m[2]].some((s) => /^\.+$/.test(s)) ? `${m[1]}/${m[2]}` : null;
}

/** The scout runs once a week. */
export const SCOUT_EVERY_MS = 7 * 24 * 3600_000;

/** Licences that aren't safe for a page that may earn money: the scout flags them. */
export function licenceRisk(licence: string | null): string | null {
  if (!licence || licence === 'NOASSERTION' || licence === 'other') return 'No clear licence: personal use only until it has one';
  const l = licence.toLowerCase();
  if (/(^|-)nc($|-)|non-?commercial|flux-1-dev|research|openrail\+\+?-m-nc/.test(l)) return `${licence}: not for commercial use`;
  if (/^agpl|^gpl/.test(l)) return `${licence}: copyleft (fine to use, not to ship inside the app)`;
  return null;
}
