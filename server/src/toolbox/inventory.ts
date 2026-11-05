import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { count, max } from 'drizzle-orm';
import type { ComputeTool } from '../../../shared/compute';
import type { InstalledTool, SkillHome, ToolKind } from '../../../shared/toolbox';
import { resolveModel } from '../claude/options';
import { addedSkills, CHAT_SKILLS, skillFolders } from '../claude/plugin';
import { buildTools } from '../claude/tools';
import { listWorkers } from '../compute/workers';
import { config } from '../config';
import { db, schema } from '../db';
import { findBinary } from '../lib/bin';
import { getSetting } from '../lib/settings';
import { clipToolsInstalled } from '../services/cliptools';
import { rendererInstalled } from '../studio/browser';
import { firstSentence, frontField, frontMatter, SKILL_DIRS, skillLock } from './skills';
import { claudeFamily, listUses } from './uses';

const run = promisify(execFile);

type Row = Omit<InstalledTool, 'uses' | 'lastUsedAt'> & { uses?: number | null; lastUsedAt?: number | null };
const row = (kind: ToolKind, name: string, r: Partial<Row>): Row => ({ kind, name, about: '', version: null, licence: null, source: null, where: null, status: 'ready', note: '', ...r });

/** A source repo's licence, stars and last push, as the scout last read them from GitHub. */
export type RepoInfo = { licence: string | null; stars: number; pushedAt: number | null; at: number };
export const repoInfo = (): Record<string, RepoInfo> => getSetting('toolboxRepos') ?? {};

/** Every repo an installed skill came from, wherever it's installed. */
export const skillSources = () => [...new Set((['built-in', 'app', 'claude-code'] as const).flatMap((h) => Object.values(skillLock(h)).map((s) => s.source)).filter(Boolean))];

function skills(): Row[] {
  const repos = repoInfo();
  const added = new Set(addedSkills());
  return (Object.keys(SKILL_DIRS) as SkillHome[]).flatMap((home) => {
    const dir = SKILL_DIRS[home];
    const lock = skillLock(home);
    return skillFolders(dir).flatMap((name) => {
      let text: string;
      try {
        text = readFileSync(join(dir, name, 'SKILL.md'), 'utf8');
      } catch {
        return [];
      }
      const head = frontMatter(text);
      const repo = typeof lock[name]?.source === 'string' ? lock[name].source : null;
      const ours = home === 'built-in' && name === 'playbook';
      const licence = ours ? 'Ours' : frontField(head, 'license') ?? (repo ? repos[repo]?.licence ?? null : null);
      const chat = home === 'built-in' ? CHAT_SKILLS.includes(name) : home === 'app' && added.has(name);
      return [
        row('skill', name, {
          about: firstSentence(frontField(head, 'description') ?? ''),
          version: frontField(head, 'version'),
          licence,
          source: repo ? `https://github.com/${repo}` : null,
          where: ours ? 'Content Studio' : repo,
          home,
          status: chat ? 'ready' : 'off',
          note: [
            home === 'claude-code' || chat ? '' : home === 'app' ? 'A built-in skill has this name: that one is used' : 'Not loaded in the chat: it runs commands the app’s Claude doesn’t have',
            ours ? 'Its rules are on the Knowledge page; every background prompt pastes them' : '',
            // Only once the scout has read the repo: before that the licence is just unknown.
            !ours && !licence && repo && repos[repo] ? 'No licence: personal use only' : '',
          ]
            .filter(Boolean)
            .join('. '),
        }),
      ];
    });
  });
}

function studioTools(): Row[] {
  // The tools don't depend on the page until they're called.
  const { tools } = buildTools('');
  return [
    ...tools.map((t) => row('tool', t.name, { about: firstSentence(t.description), where: 'studio (in-app MCP server)', licence: 'Ours' })),
    row('tool', 'WebSearch', { about: 'Searches the web (Claude only; the local model has no search).', where: 'Claude' }),
    row('tool', 'WebFetch', { about: 'Reads one web page as text.', where: 'Claude, and the local chat' }),
  ];
}

async function models(): Promise<Row[]> {
  const chatModel = claudeFamily(resolveModel(null));
  const claude = (family: string, label: string, about: string) =>
    row('model', `claude-${family}`, {
      label,
      about,
      licence: 'Pro plan',
      source: 'https://www.anthropic.com/claude',
      where: 'The Pro login (Agent SDK, no API key)',
      note: family === chatModel ? 'The chat’s default' : '',
    });
  const workers = listWorkers();
  const on = (tool: ComputeTool) => workers.filter((w) => w.tools.includes(tool));
  const workerModel = (name: string, label: string, about: string, licence: string, source: string, tool: ComputeTool) => {
    const ws = on(tool);
    return row('model', name, {
      label,
      about,
      licence,
      source,
      where: ws.map((w) => `${w.name}${w.online ? '' : ' (offline)'}`).join(', ') || null,
      status: ws.length ? 'ready' : 'missing',
      note: ws.length ? '' : 'Set up on a home PC with scripts/setup-worker.sh',
    });
  };

  return [
    claude('opus', 'Claude Opus', 'The most capable Claude: editing (picking clips, the check before a render and its fix, directions, hooks).'),
    claude('haiku', 'Claude Haiku', 'Fast and light: background jobs.'),
    row('model', `whisper-${getSetting('whisperModel') ?? 'small'}`, {
      label: `Whisper ${getSetting('whisperModel') ?? 'small'}`,
      about: 'Speech to text with word times (faster-whisper): captions, cuts, transcripts.',
      licence: 'MIT',
      source: 'https://github.com/SYSTRAN/faster-whisper',
      where: [existsSync(config.whisperPython) ? 'This computer' : '', ...on('transcribe').map((w) => w.name)].filter(Boolean).join(', ') || null,
      status: existsSync(config.whisperPython) || on('transcribe').length ? 'ready' : 'missing',
    }),
  ];
}

let programCache: { at: number; rows: Row[] } | null = null;

async function version(name: string, args: string[], re: RegExp) {
  const bin = findBinary(name);
  if (!bin) return { bin, version: null };
  try {
    const { stdout, stderr } = await run(bin, args, { timeout: 5000 });
    return { bin, version: re.exec(`${stdout}\n${stderr}`)?.[1] ?? null };
  } catch {
    return { bin, version: null };
  }
}

/** A package's version in one of the app's Python environments, from its `*.dist-info` folder. */
function pyVersion(venv: string, dist: string) {
  try {
    const lib = join(venv, 'lib');
    for (const py of readdirSync(lib)) {
      const site = join(lib, py, 'site-packages');
      const hit = existsSync(site) && readdirSync(site).find((f) => f.toLowerCase().startsWith(`${dist.toLowerCase()}-`) && f.endsWith('.dist-info'));
      if (hit) return hit.slice(dist.length + 1, -'.dist-info'.length);
    }
  } catch {
    /* not installed */
  }
  return null;
}

async function programs(): Promise<Row[]> {
  if (programCache && Date.now() - programCache.at < 10 * 60_000) return programCache.rows;
  const cli = async (name: string, args: string[], re: RegExp, r: Partial<Row>) => {
    const v = await version(name, args, re);
    return row('program', name, { ...r, version: v.version, where: v.bin, status: v.bin ? 'ready' : 'missing' });
  };
  const chrome = (() => {
    try {
      return readdirSync(join(config.rendererDir, 'chrome-headless-shell'))[0]?.replace(/^linux-/, '') ?? null;
    } catch {
      return null;
    }
  })();
  const py = (name: string, label: string, venv: string, dist: string, about: string, licence: string, source: string, ready: boolean, missing: string) => {
    const v = pyVersion(venv, dist);
    return row('program', name, { label, about, licence, source, version: v, where: v ? venv : null, status: ready && v ? 'ready' : 'missing', note: ready && v ? '' : missing });
  };
  const clipTools = clipToolsInstalled();
  const rows = await Promise.all([
    cli('ffmpeg', ['-version'], /ffmpeg version (\S+)/, { about: 'Cuts, audio, frames, grading, loudness: most of the mechanical work.', licence: 'LGPL-2.1 / GPL', source: 'https://ffmpeg.org' }),
    cli('ffprobe', ['-version'], /ffprobe version (\S+)/, { about: 'Reads a file’s length, size and streams.', licence: 'LGPL-2.1 / GPL', source: 'https://ffmpeg.org' }),
    cli('yt-dlp', ['--version'], /(\S+)/, { about: 'Downloads videos from links (sources, references, saved posts).', licence: 'Unlicense', source: 'https://github.com/yt-dlp/yt-dlp' }),
    cli('python3', ['--version'], /Python (\S+)/, { about: 'Runs Whisper, the clip tools and the speech scripts.', licence: 'PSF-2.0', source: 'https://www.python.org' }),
    cli('tailscale', ['version'], /^(\S+)/, { about: 'Reaches the phone and the home PCs (Funnel for the platforms).', licence: 'BSD-3-Clause', source: 'https://tailscale.com' }),
  ]);
  rows.push(
    row('program', 'chrome-headless-shell', {
      label: 'Chrome (renderer)',
      about: 'The headless Chrome HyperFrames renders videos with.',
      licence: 'BSD-3-Clause',
      source: 'https://developer.chrome.com/blog/chrome-headless-shell',
      version: chrome,
      where: rendererInstalled() ? config.rendererDir : null,
      status: rendererInstalled() ? 'ready' : 'missing',
      note: rendererInstalled() ? '' : 'Downloaded on the first render',
    }),
    py('faster-whisper', 'faster-whisper', config.whisperVenv, 'faster_whisper', 'Whisper’s Python environment.', 'MIT', 'https://github.com/SYSTRAN/faster-whisper', true, 'Installed with the first transcript'),
    py('demucs', 'Demucs', config.toolsDir, 'demucs', 'Takes the voice out of a clip with music (clip tools).', 'MIT', 'https://github.com/facebookresearch/demucs', clipTools, 'Settings → Clip tools → Install'),
    py('opencv', 'OpenCV', config.toolsDir, 'opencv_python_headless', 'Finds faces (YuNet) to frame speakers (clip tools).', 'Apache-2.0', 'https://opencv.org', clipTools, 'Settings → Clip tools → Install'),
    py('torch', 'PyTorch', config.toolsDir, 'torch', 'Runs Demucs and the person matte (clip tools).', 'BSD-3-Clause', 'https://pytorch.org', clipTools, 'Settings → Clip tools → Install'),
    py('kokoro-onnx', 'kokoro-onnx', config.toolsDir, 'kokoro_onnx', 'Runs the Kokoro voice (clip tools).', 'MIT', 'https://github.com/thewh1teagle/kokoro-onnx', clipTools, 'Settings → Clip tools → Install'),
  );
  programCache = { at: Date.now(), rows };
  return rows;
}

type Library = { name: string; version: string; licence: string | null; about: string; source: string | null };
let libraryCache: Library[] | null = null;

/** The app's packages: written to `libraries.json` when it's packaged, read from node_modules in development. */
function libraries(): Row[] {
  if (!libraryCache) {
    const shipped = join(config.resourcesDir, 'libraries.json');
    if (existsSync(shipped)) libraryCache = JSON.parse(readFileSync(shipped, 'utf8')) as Library[];
    else {
      const names = new Set<string>();
      for (const ws of ['.', 'server', 'web', 'desktop', 'shared', 'mobile']) {
        try {
          const pkg = JSON.parse(readFileSync(join(config.resourcesDir, ws, 'package.json'), 'utf8'));
          for (const n of Object.keys(pkg.dependencies ?? {})) names.add(n);
        } catch {
          /* no such workspace */
        }
      }
      libraryCache = [...names].flatMap((name) => {
        try {
          const pkg = JSON.parse(readFileSync(join(config.resourcesDir, 'node_modules', name, 'package.json'), 'utf8'));
          const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
          const source = pkg.homepage ?? (repo ? String(repo).replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://') : null);
          return [{ name, version: pkg.version, licence: pkg.license ?? null, about: pkg.description ?? '', source }];
        } catch {
          return [];
        }
      });
    }
  }
  return libraryCache.sort((a, b) => a.name.localeCompare(b.name)).map((l) => row('library', l.name, { about: firstSentence(l.about), version: l.version, licence: l.licence, source: l.source }));
}

/** Everything installed, with how often each was used. */
export async function listInstalled(): Promise<InstalledTool[]> {
  const uses = listUses();
  const counted: ToolKind[] = ['skill', 'tool', 'model'];
  const rows = [...skills(), ...studioTools(), ...(await models()), ...(await programs()), ...libraries()];
  return rows.map((r) => {
    // Claude Code's skills are used outside the app: nothing here counts them.
    if (r.home === 'claude-code') return { ...r, uses: null, lastUsedAt: null };
    const u = uses.get(`${r.kind}:${r.name}`);
    return { ...r, uses: r.uses ?? (counted.includes(r.kind) ? (u?.count ?? 0) : null), lastUsedAt: r.lastUsedAt ?? u?.lastAt ?? null };
  });
}
