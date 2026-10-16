import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { HookCallback, Options } from '@anthropic-ai/claude-agent-sdk';
import { config } from '../config';

/**
 * The skills in `.claude/skills` reach the app's Claude as a local plugin: a folder with `.claude-plugin/plugin.json`
 * and `skills/`. The packaged app ships it ready-made (`desktop/scripts/package.mjs`); in development it's built in
 * the data folder at start, so both load the same thing. `settingSources` stays `[]`, so none of my personal skills,
 * settings or hooks come along.
 */
export const PLUGIN_NAME = 'studio-skills';

/**
 * The skills the chat may load. Knowledge only: skills that run commands (last30days, hyperframes-cli, broll, steal,
 * clips, studio-script) need tools the app's Claude doesn't have, and their know-how reaches it through the
 * playbook. The HyperFrames/GSAP skills come in with motion graphics (phase 7, step 9).
 */
const CHAT_SKILLS = [
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
];

const manifest = join(config.pluginDir, '.claude-plugin/plugin.json');
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

function writePluginManifest(dir: string) {
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true });
  writeFileSync(
    join(dir, '.claude-plugin/plugin.json'),
    JSON.stringify({ name: PLUGIN_NAME, description: "Content Studio's skills: the playbook and the content skills it builds on", version: '1.0.0' }, null, 2),
  );
}

const inPlugin = (path: string) => {
  const root = realpathSync(config.pluginDir);
  let target = resolve(path);
  try {
    target = realpathSync(target);
  } catch {
    /* doesn't exist: Read fails on its own */
  }
  return target === root || target.startsWith(root + sep);
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
export function skillOptions(): Pick<Options, 'plugins' | 'skills' | 'additionalDirectories' | 'hooks'> & { tools: string[] } {
  if (!existsSync(manifest)) return { tools: [] };
  return {
    plugins: [{ type: 'local', path: config.pluginDir, skipMcpDiscovery: true }],
    skills: CHAT_SKILLS.map((name) => `${PLUGIN_NAME}:${name}`),
    // `tools` limits the built-in tools, so the Skill tool has to be listed as well as `skills`.
    tools: ['Skill', 'Read'],
    additionalDirectories: [config.pluginDir],
    hooks: { PreToolUse: [{ matcher: 'Read', hooks: [readOnlyInPlugin] }] },
  };
}

export type PlaybookFile = 'hooks' | 'retention' | 'clipping' | 'packaging' | 'sound-design' | 'halal' | 'platforms';
const playbookCache = new Map<PlaybookFile, string>();

/**
 * Playbook references pasted into background prompts, which don't load skills, under a heading; empty when the
 * skills are missing. Put it first in the system prompt (it's the same text every time, so it caches). Their source
 * lists are left out.
 */
export function playbook(...files: PlaybookFile[]) {
  const text = files
    .map((name) => {
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
    })
    .filter(Boolean)
    .join('\n\n---\n\n');
  return text && `# The playbook (Content Studio's rules for every piece; the halal rules come before everything)\n\n${text}`;
}
