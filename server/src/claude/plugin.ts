import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { HookCallback, Options } from '@anthropic-ai/claude-agent-sdk';
import type { KnowledgeTopic } from '../../../shared/knowledge';
import { config } from '../config';
import { hasKnowledge, knowledgeText } from '../knowledge/knowledge';
import { countUse } from '../toolbox/uses';

/**
 * The skills in `.claude/skills` reach the app's Claude as a local plugin: a folder with `.claude-plugin/plugin.json`
 * and `skills/`. The packaged app ships it ready-made (`desktop/scripts/package.mjs`); in development it's built in
 * the data folder at start, so both load the same thing. `settingSources` stays `[]`, so none of my personal skills,
 * settings or hooks come along.
 */
export const PLUGIN_NAME = 'studio-skills';
/** The skills I install from the Toolbox (`toolbox/skills.ts`): a second plugin in the data folder, all in the chat. */
export const ADDED_PLUGIN = 'studio-added';

/**
 * The skills the chat may load. Knowledge only: skills that run commands (last30days, hyperframes-cli, broll, steal,
 * clips, studio-script) need tools the app's Claude doesn't have, and their know-how reaches it through the
 * playbook. The HyperFrames/GSAP skills come in with motion graphics (phase 7, step 9).
 */
export const CHAT_SKILLS = [
  'playbook',
  'content-principles',
  'viral-short-form',
  'viral-hooks',
  'viral-captions-and-ctas',
  'viral-short-form-ideas',
  'viral-tiktok-content',
  'viral-instagram-reels',
  'viral-youtube-shorts',
  'contagious',
  'made-to-stick',
  'copywriting',
  'social',
  'content-strategy',
  'marketing-psychology',
  'offers',
  // Motion design, for transitions, motion graphics and the scenes Claude writes (write_scene). Their command-line
  // and rendering steps don't apply in the app: the prompt says so.
  'hyperframes-animation',
  'hyperframes-creative',
  'motion-graphics',
  'gsap-core',
  'gsap-timeline',
  'gsap-utils',
  'gsap-plugins',
  'gsap-performance',
  'hyperframes-keyframes',
  'hyperframes-core',
  // Ideas to borrow, not tools to run: caption looks (a catalogue of 35 styles), overlay packaging for talking heads,
  // and the registry's named looks (glitch, film grain, charts, maps…) to rebuild with the studio's own pieces.
  'embedded-captions',
  'talking-head-recut',
  'hyperframes-registry',
];

/** The skills the fix before a render loads: the playbook, hooks, and the motion craft for scenes and transitions. */
export const FIX_SKILLS = ['playbook', 'content-principles', 'viral-hooks', 'hyperframes-animation', 'hyperframes-creative', 'motion-graphics', 'gsap-core', 'gsap-timeline'];

const manifest = join(config.pluginDir, '.claude-plugin/plugin.json');
const addedManifest = join(config.addedPluginDir, '.claude-plugin/plugin.json');

/** Folders of a skills folder that hold a SKILL.md. */
export function skillFolders(dir: string) {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && existsSync(join(dir, e.name, 'SKILL.md')))
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/** The skills I added from the Toolbox, minus any that share a name with a built-in one (that one wins). */
export function addedSkills() {
  const builtIn = new Set(skillFolders(join(config.pluginDir, 'skills')));
  return skillFolders(join(config.addedPluginDir, 'skills')).filter((n) => !builtIn.has(n));
}
const stampFile = join(config.pluginDir, '.source-stamp');

/** Every file's path, size and modification time: changes when any skill is added, removed or edited. */
function stamp(dir: string) {
  const hash = createHash('sha256');
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(d, entry.name);
      if (entry.isDirectory()) walk(path);
      else {
        const s = statSync(path);
        hash.update(`${relative(dir, path)}\0${s.size}\0${s.mtimeMs}\n`);
      }
    }
  };
  walk(dir);
  return hash.digest('hex');
}

/** Build the plugin folder from the repo's skills when they changed (development only). */
export function preparePlugin() {
  if (config.pluginDir !== config.devPluginDir) return;
  if (!existsSync(config.skillsSource)) {
    console.warn(`No skills at ${config.skillsSource}: Claude runs without them.`);
    return;
  }
  const current = stamp(config.skillsSource);
  if (existsSync(manifest) && existsSync(stampFile) && readFileSync(stampFile, 'utf8') === current) return;
  rmSync(config.pluginDir, { recursive: true, force: true });
  cpSync(config.skillsSource, join(config.pluginDir, 'skills'), { recursive: true, dereference: true });
  writePluginManifest(config.pluginDir);
  writeFileSync(stampFile, current);
  playbookCache.clear();
}

function writePluginManifest(dir: string, name = PLUGIN_NAME, description = "Content Studio's skills: the playbook and the content skills it builds on") {
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true });
  writeFileSync(join(dir, '.claude-plugin/plugin.json'), JSON.stringify({ name, description, version: '1.0.0' }, null, 2));
}

/** The added skills' plugin folder, made on the first install. */
export function prepareAddedPlugin() {
  mkdirSync(join(config.addedPluginDir, 'skills'), { recursive: true });
  if (!existsSync(addedManifest)) writePluginManifest(config.addedPluginDir, ADDED_PLUGIN, 'Skills added from the Toolbox');
}

const real = (path: string) => {
  try {
    return realpathSync(path);
  } catch {
    // Doesn't exist: Read fails on its own.
    return resolve(path);
  }
};

const inPlugin = (path: string) => {
  const target = real(path);
  return [config.pluginDir, config.addedPluginDir].some((dir) => {
    const root = real(dir);
    return target === root || target.startsWith(root + sep);
  });
};

/** Read is only for the skills' own files (their references); anything else on this computer is refused. */
const readOnlyInPlugin: HookCallback = async (input) => {
  if (input.hook_event_name !== 'PreToolUse' || input.tool_name !== 'Read') return {};
  const path = (input.tool_input as { file_path?: unknown } | null)?.file_path;
  if (typeof path === 'string' && inPlugin(path)) return {};
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: 'Read only opens the skills’ own files. Use the studio tools for the creator’s data.',
    },
  };
};

/** What the chat needs to load the skills, or nothing when there are none. */
export function skillOptions(names: readonly string[] = CHAT_SKILLS): Pick<Options, 'plugins' | 'skills' | 'additionalDirectories' | 'hooks'> & { tools: string[] } {
  const builtIn = existsSync(manifest);
  const added = existsSync(addedManifest) ? addedSkills() : [];
  if (!builtIn && !added.length) return { tools: [] };
  return {
    plugins: [
      ...(builtIn ? [{ type: 'local' as const, path: config.pluginDir, skipMcpDiscovery: true }] : []),
      ...(added.length ? [{ type: 'local' as const, path: config.addedPluginDir, skipMcpDiscovery: true }] : []),
    ],
    skills: [...(builtIn ? names.map((name) => `${PLUGIN_NAME}:${name}`) : []), ...added.map((name) => `${ADDED_PLUGIN}:${name}`)],
    // `tools` limits the built-in tools, so the Skill tool has to be listed as well as `skills`.
    tools: ['Skill', 'Read'],
    additionalDirectories: [...(builtIn ? [config.pluginDir] : []), ...(added.length ? [config.addedPluginDir] : [])],
    hooks: { PreToolUse: [{ matcher: 'Read', hooks: [readOnlyInPlugin] }] },
  };
}

/** A chat skill's folder: built in (on the allow-list) or added from the Toolbox. */
function chatSkillDir(name: string) {
  if (CHAT_SKILLS.includes(name)) return join(config.pluginDir, 'skills', name);
  if (addedSkills().includes(name)) return join(config.addedPluginDir, 'skills', name);
  return null;
}

/** The chat's skills with their one-line descriptions, for a model that opens them with a tool (the local chat). */
export function chatSkillList(): { name: string; description: string }[] {
  return [...CHAT_SKILLS, ...addedSkills()].flatMap((name) => {
    try {
      const head = readFileSync(join(chatSkillDir(name) ?? '', 'SKILL.md'), 'utf8').slice(0, 4000);
      const description = /^description:\s*(.+)$/m.exec(head)?.[1]?.replace(/^["']|["']$/g, '') ?? '';
      return [{ name, description: description.length > 220 ? `${description.slice(0, 220)}…` : description }];
    } catch {
      return [];
    }
  });
}

/** A chat skill's SKILL.md, or one of its own files (`references/hooks.md`); nothing outside the skill's folder. */
export function readSkillFile(name: string, file = 'SKILL.md'): string {
  const root = chatSkillDir(name);
  if (!root) throw new Error(`No skill called ${name}. Skills: ${[...CHAT_SKILLS, ...addedSkills()].join(', ')}.`);
  const path = resolve(root, file);
  if (!inPlugin(path) || !(path === root || path.startsWith(root + sep))) throw new Error('Only the skill’s own files can be read.');
  if (!existsSync(path)) {
    const files: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        if (e.isDirectory()) walk(join(d, e.name));
        else if (/\.(md|txt)$/.test(e.name)) files.push(relative(root, join(d, e.name)));
      }
    };
    if (existsSync(root)) walk(root);
    throw new Error(`${name} has no ${file}. Its files: ${files.slice(0, 60).join(', ')}`);
  }
  if (statSync(path).isDirectory()) throw new Error(`${file} is a folder.`);
  return readFileSync(path, 'utf8');
}

export type PlaybookFile = KnowledgeTopic;
const playbookCache = new Map<PlaybookFile, string>();

/**
 * The playbook pasted into background prompts, which don't load skills, under a heading: the live rules from the
 * Knowledge page (the playbook's references as I edited them); the shipped files only until those are seeded. Empty
 * when there's nothing. Put it first in the system prompt (it's the same text until a rule changes, so it caches).
 */
export function playbook(...files: PlaybookFile[]) {
  // A background prompt built on the playbook is a use of it.
  countUse('skill', 'playbook');
  const text = hasKnowledge() ? knowledgeText(files) : files.map(playbookFile).filter(Boolean).join('\n\n---\n\n');
  return text && `# The playbook (Content Studio's rules for every piece; the halal rules come before everything)\n\n${text}`;
}

function playbookFile(name: PlaybookFile) {
  let text = playbookCache.get(name);
  if (text === undefined) {
    try {
      text = readFileSync(join(config.pluginDir, 'skills/playbook/references', `${name}.md`), 'utf8')
        .replace(/\n## Sources\n[\s\S]*$/, '')
        .trim();
    } catch {
      text = '';
    }
    playbookCache.set(name, text);
  }
  return text;
}
