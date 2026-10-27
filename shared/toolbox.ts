// The Toolbox: everything the app builds videos with (skills, the studio's tools, models, programs, libraries), what
// each is, its version and licence and how often it was used; and what the weekly scout found that could make the
// videos better. Installing a find is my click, never the app's or Claude's.

export const TOOL_KINDS = ['skill', 'tool', 'model', 'program', 'library'] as const;
export type ToolKind = (typeof TOOL_KINDS)[number];

export const TOOL_KIND_INFO: Record<ToolKind, { label: string; hint: string }> = {
  skill: { label: 'Skills', hint: 'Know-how Claude reads in the chat (`.claude/skills`, loaded as the studio-skills plugin)' },
  tool: { label: 'Studio tools', hint: 'What Claude can do in the app: the in-app MCP server `studio`, and the web' },
  model: { label: 'Models', hint: 'Claude on the Pro login, the self-hosted models on the home PCs, kie.ai' },
  program: { label: 'Programs', hint: 'Command-line programs and Python environments the app runs' },
  library: { label: 'Libraries', hint: 'The packages the app is built on' },
};

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
  /** Times used since the Toolbox started counting (null: not counted for this kind). */
  uses: number | null;
  lastUsedAt: number | null;
};

export const FIND_KINDS = ['skill', 'mcp', 'repo', 'model'] as const;
export type FindKind = (typeof FIND_KINDS)[number];
export const FIND_KIND_LABELS: Record<FindKind, string> = { skill: 'Skill', mcp: 'MCP server', repo: 'Repo', model: 'Model' };

export type FindStatus = 'new' | 'wanted' | 'dismissed';

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
  status: FindStatus;
  foundAt: number;
};

export type ScoutRun = { startedAt: number; finishedAt: number | null; status: 'running' | 'done' | 'failed'; looked: number; found: number; error: string | null };

export type Toolbox = { installed: InstalledTool[]; finds: ToolFind[]; scout: ScoutRun | null; nextScoutAt: number | null };

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
