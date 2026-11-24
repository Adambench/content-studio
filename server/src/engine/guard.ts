// Guard rails for Claude's full shell on ai-server (my yes, 2026-11-24): it may do anything inside the studio, and
// nothing to the machine itself. A hook before every tool call; a refusal tells Claude why, so it does it otherwise.
// It stops accidents, not a determined attacker: Claude is on my side.

import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import type { HookCallback } from '@anthropic-ai/claude-agent-sdk';
import { config } from '../config.ts';

const HOME = homedir();

const BASH_RULES: [RegExp, string][] = [
  [/(^|[\s;&|(])(sudo|doas|pkexec|su)(\s|$)/, 'no sudo or su'],
  [/\b(docker|podman|docker-compose|kubectl|nerdctl)\b/, 'Docker is off limits'],
  [/\bollama\b|open[-_ ]?webui/i, 'Ollama and Open WebUI are off limits'],
  [/\bsystemctl\b(?!\s+(--user\s+)?(status|is-active|list-units|show)\b)|(^|[\s;&|])(service|shutdown|reboot|poweroff|halt)\s/, 'services and power are off limits'],
  [/\b(tailscale|nmcli|nmtui|iwconfig|ifconfig|iptables|ip6tables|nft|ufw|resolvectl|hostnamectl|wg-quick|netplan)\b|\bip\s+(link|addr|address|route|rule|neigh)\s+(set|add|del|delete|change|replace|flush)\b/, 'the network settings are off limits'],
  [/\bcrontab\b/, 'no scheduled jobs on the machine (ask me for them)'],
  [/(>>?|\btee\b(\s+-a)?)\s*\/etc\/|\b(cp|mv|ln|install|rsync)\b[^;&|]*\s\/etc\//, 'nothing written to /etc'],
  [/graph\.facebook\.com|graph\.instagram\.com|i\.instagram\.com|api\.instagram\.com|upload\.twitter|open\.tiktokapis/, 'never post'],
  [/keys\.env|\.credentials\.json|\/\.ssh\b|~\/\.ssh|studio\.sqlite/, 'keys, logins and the app’s database are off limits'],
  [/(>>?|\btee\b|\bsed\s+-i\b|\b(mv|cp|rm)\b)[^;&|]*\bstudio\/CLAUDE\.md\b/, 'studio/CLAUDE.md is written by the app: put lessons in lessons.md or the brand’s CLAUDE.md'],
];

/** Where deleting is fine: this video's folder, temporary files, the engine's own tools and caches. */
function deletable(p: string, cwd: string): boolean {
  const raw = p.replace(/^['"]|['"]$/g, '');
  if (/[`$]/.test(raw.replace(/^\$\{?HOME\}?/, ''))) return false;
  const expanded = raw.replace(/^~(?=\/|$)/, HOME).replace(/^\$\{?HOME\}?/, HOME);
  const abs = isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
  if (abs === cwd || abs.startsWith(cwd + '/')) return true;
  // The rest of the studio (other videos, the brands, the CLAUDE.md files) is never deleted from here.
  if (abs === config.studioDir || abs.startsWith(config.studioDir + '/')) return false;
  return ['/tmp', config.toolsDir, join(HOME, '.cache')].some((root) => abs.startsWith(root + '/'));
}

function deletesOutside(cmd: string, cwd: string): string | null {
  for (const m of cmd.matchAll(/(?:^|[\s;&|(])(rm|rmdir|shred|unlink|truncate)\s+([^;&|)]*)/g)) {
    for (const arg of m[2]!.split(/\s+/)) if (arg && !arg.startsWith('-') && !deletable(arg, cwd)) return arg;
  }
  const find = cmd.match(/(?:^|[\s;&|(])find\s+(\S+)[^;&|]*\s-delete\b/);
  if (find && !deletable(find[1]!, cwd)) return find[1]!;
  return null;
}

/** Writing with the file tools: the studio, /tmp, the engine's tools, and the skills (in the app's checkout). */
function writable(p: string, cwd: string): string | null {
  const abs = resolve(cwd, p);
  if (abs === join(config.studioDir, 'CLAUDE.md')) return 'studio/CLAUDE.md is written by the app: put lessons in lessons.md or the brand’s CLAUDE.md';
  if (/keys\.env$|\.credentials\.json$|\/\.ssh\//.test(abs)) return 'keys and logins are off limits';
  const roots = [config.studioDir, '/tmp', config.toolsDir, join(HOME, '.cache'), config.skillsDir, join(HOME, '.claude/skills')];
  return roots.some((root) => abs === root || abs.startsWith(root + '/')) ? null : 'only files in the studio, /tmp or the skills can be written';
}

/** Why this tool call is refused, or null when it may go ahead. */
export function refusal(tool: string, input: Record<string, unknown>, cwd: string): string | null {
  if (tool === 'Bash') {
    const cmd = String(input.command ?? '');
    for (const [re, why] of BASH_RULES) if (re.test(cmd)) return why;
    const outside = deletesOutside(cmd, cwd);
    if (outside) return `no deleting outside this video's folder (${outside})`;
    return null;
  }
  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') return writable(String(input.file_path ?? input.notebook_path ?? ''), cwd);
  if (tool === 'Read') {
    const p = resolve(cwd, String(input.file_path ?? ''));
    if (/keys\.env$|\.credentials\.json$|\/\.ssh\/|studio\.sqlite/.test(p)) return 'keys, logins and the app’s database are off limits';
  }
  return null;
}

export function guardFor(cwd: string): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== 'PreToolUse') return {};
    const why = refusal(input.tool_name, (input.tool_input ?? {}) as Record<string, unknown>, cwd);
    if (!why) return {};
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: `Refused by the studio's guard rails: ${why}.` } };
  };
}
