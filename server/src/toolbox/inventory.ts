import { execFile } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { count, max } from 'drizzle-orm';
import { RECOMMENDED_LOCAL_MODEL } from '../../../shared/ai';
import type { ComputeTool } from '../../../shared/compute';
import { normalizeHosted } from '../../../shared/hosted';
import type { InstalledTool, ToolKind } from '../../../shared/toolbox';
import { localStatus } from '../ai/local';
import { resolveModel } from '../claude/options';
import { CHAT_SKILLS } from '../claude/plugin';
import { buildTools } from '../claude/tools';
import { listWorkers } from '../compute/workers';
import { config } from '../config';
import { db, schema } from '../db';
import { findBinary } from '../lib/bin';
import { getSetting } from '../lib/settings';
import { clipToolsInstalled } from '../services/cliptools';
import { ttsInstalled } from '../services/tts';
import { rendererInstalled } from '../studio/browser';
import { claudeFamily, listUses } from './uses';

const run = promisify(execFile);
const firstSentence = (s: string) => {
  const t = s.replace(/\s+/g, ' ').trim();
  const end = t.search(/[.!?](\s|$)/);
  const one = end > 0 ? t.slice(0, end + 1) : t;
  return one.length > 240 ? `${one.slice(0, 240)}…` : one;
};

type Row = Omit<InstalledTool, 'uses' | 'lastUsedAt'> & { uses?: number | null; lastUsedAt?: number | null };
const row = (kind: ToolKind, name: string, r: Partial<Row>): Row => ({ kind, name, about: '', version: null, licence: null, source: null, where: null, status: 'ready', note: '', ...r });

/** A source repo's licence, stars and last push, as the scout last read them from GitHub. */
export type RepoInfo = { licence: string | null; stars: number; pushedAt: number | null; at: number };
export const repoInfo = (): Record<string, RepoInfo> => getSetting('toolboxRepos') ?? {};

/** `skills-lock.json` (what `npx skills add` installed and from where), shipped with the packaged app. */
function skillsLock(): Record<string, { source: string }> {
  try {
    return JSON.parse(readFileSync(join(config.resourcesDir, 'skills-lock.json'), 'utf8')).skills ?? {};
  } catch {
    return {};
  }
}
export const skillSources = () => [...new Set(Object.values(skillsLock()).map((s) => s.source))];

/** A field of a SKILL.md's front matter (top level, or under `metadata:`), wrapped and folded lines joined. */
function frontField(head: string, key: string) {
  const m = new RegExp(`^([ \\t]*)${key}:[ \\t]*(.*)$`, 'm').exec(head);
  if (!m) return null;
  let v = m[2].trim();
  // A top-level value goes on over the indented lines under it (`>`, `|`, or a long string wrapped).
  if (!m[1]) {
    const lines: string[] = [];
    for (const l of head.slice(m.index + m[0].length).split('\n').slice(1)) {
      if (!/^\s+\S/.test(l) || /^\s+[\w-]+:(\s|$)/.test(l)) break;
      lines.push(l.trim());
    }
    v = [/^[>|]-?$/.test(v) ? '' : v, ...lines].filter(Boolean).join(' ');
  }
  return v.replace(/^["']|["']$/g, '').trim() || null;
}

function skills(): Row[] {
  const dir = join(config.pluginDir, 'skills');
  const lock = skillsLock();
  const repos = repoInfo();
  let names: string[];
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, 'SKILL.md')))
      .map((e) => e.name);
  } catch {
    return [];
  }
  return names.map((name) => {
    const text = readFileSync(join(dir, name, 'SKILL.md'), 'utf8');
    const head = text.startsWith('---') ? text.slice(3, Math.max(3, text.indexOf('\n---', 3))) : '';
    const repo = lock[name]?.source ?? null;
    const ours = name === 'playbook';
    const licence = ours ? 'Ours' : frontField(head, 'license') ?? (repo ? repos[repo]?.licence ?? null : null);
    const chat = CHAT_SKILLS.includes(name);
    return row('skill', name, {
      about: firstSentence(frontField(head, 'description') ?? ''),
      version: frontField(head, 'version'),
      licence,
      source: repo ? `https://github.com/${repo}` : null,
      where: ours ? 'Content Studio' : repo,
      status: chat ? 'ready' : 'off',
      note: [
        chat ? '' : 'Not loaded in the chat: it runs commands the app’s Claude doesn’t have',
        ours ? 'Its rules are on the Knowledge page; every background prompt pastes them' : '',
        // Only once the scout has read the repo: before that the licence is just unknown.
        !ours && !licence && repo && repos[repo] ? 'No licence: personal use only' : '',
      ]
        .filter(Boolean)
        .join('. '),
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

const LOCAL_LICENCES: [RegExp, string][] = [
  [/qwen/i, 'Apache-2.0'],
  [/mistral|mixtral/i, 'Apache-2.0'],
  [/llama/i, 'Llama licence'],
  [/gemma/i, 'Gemma terms'],
];

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

  const local = await localStatus().catch(() => null);
  const localRows: Row[] = local?.models.length
    ? local.models.map((m) =>
        row('model', m.name, {
          about: `Self-hosted (Ollama), ${m.sizeGb} GB${m.vision ? ', sees pictures' : ''}${m.tools ? ', calls tools' : ''}.`,
          licence: LOCAL_LICENCES.find(([re]) => re.test(m.name))?.[1] ?? null,
          source: 'https://ollama.com/library',
          where: local.worker ?? local.url,
          status: local.reachable ? (m.name === local.model ? 'ready' : 'off') : 'missing',
          note: m.name === local.model ? 'The local model every task uses' : 'On the model server, not used',
        }),
      )
    : [
        row('model', local?.model ?? RECOMMENDED_LOCAL_MODEL, {
          about: 'Self-hosted text and vision model (Ollama on a home PC): the stand-in when Claude is at a usage limit.',
          licence: 'Apache-2.0',
          source: 'https://ollama.com/library/qwen3-vl',
          where: local?.worker ?? local?.url ?? null,
          status: 'missing',
          note: local?.error ?? 'Not reachable',
        }),
      ];

  const hosted = normalizeHosted(getSetting('hosted'));
  const hasKey = !!getSetting('hostedKey');
  const spend = new Map(
    db
      .select({ model: schema.aiSpend.model, n: count(), last: max(schema.aiSpend.createdAt) })
      .from(schema.aiSpend)
      .groupBy(schema.aiSpend.model)
      .all()
      .map((r) => [r.model, r]),
  );
  const kie = (kind: 'image' | 'video', what: string) => {
    const id = hosted.models[kind].id;
    return row('model', `kie:${id}`, {
      label: id,
      about: `${what}, made by kie.ai (paid, capped at $${hosted.dailyCapUsd} a day).`,
      licence: 'Paid service',
      source: 'https://kie.ai',
      where: 'kie.ai',
      status: hasKey ? 'ready' : 'missing',
      note: hasKey ? `${hosted.models[kind].credits} credits${kind === 'video' ? ' a second' : ''}` : 'No key in Settings → Models',
      uses: spend.get(id)?.n ?? 0,
      lastUsedAt: spend.get(id)?.last ?? null,
    });
  };

  return [
    claude('opus', 'Claude Opus', 'The most capable Claude: pick it for a chat that needs it.'),
    claude('sonnet', 'Claude Sonnet', 'Chat, and the quality check before a render.'),
    claude('haiku', 'Claude Haiku', 'Fast and light: background jobs.'),
    ...localRows,
    row('model', `whisper-${getSetting('whisperModel') ?? 'small'}`, {
      label: `Whisper ${getSetting('whisperModel') ?? 'small'}`,
      about: 'Speech to text with word times (faster-whisper): captions, cuts, transcripts.',
      licence: 'MIT',
      source: 'https://github.com/SYSTRAN/faster-whisper',
      where: [existsSync(config.whisperPython) ? 'This computer' : '', ...on('transcribe').map((w) => w.name)].filter(Boolean).join(', ') || null,
      status: existsSync(config.whisperPython) || on('transcribe').length ? 'ready' : 'missing',
    }),
    row('model', 'kokoro', {
      label: 'Kokoro',
      about: 'Text to speech on this computer: format videos’ narration and characters’ lines.',
      licence: 'Apache-2.0',
      source: 'https://huggingface.co/hexgrad/Kokoro-82M',
      where: 'This computer',
      status: ttsInstalled() ? 'ready' : 'missing',
      note: ttsInstalled() ? '' : 'Settings → Clip tools → Install',
    }),
    workerModel('flux-schnell', 'FLUX.1-schnell', 'Pictures on a home PC (empty scenes only, every result checked).', 'Apache-2.0', 'https://huggingface.co/black-forest-labs/FLUX.1-schnell', 'image'),
    workerModel('wan-2.1', 'Wan 2.1', 'Short video clips on a home PC, at night.', 'Apache-2.0', 'https://github.com/Wan-Video/Wan2.1', 'video'),
    workerModel('chatterbox', 'Chatterbox', 'My cloned voice, from my recording (Settings → My voice).', 'MIT', 'https://github.com/resemble-ai/chatterbox', 'speak'),
    kie('image', 'Pictures'),
    kie('video', 'Video clips'),
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
    const u = uses.get(`${r.kind}:${r.name}`);
    return { ...r, uses: r.uses ?? (counted.includes(r.kind) ? (u?.count ?? 0) : null), lastUsedAt: r.lastUsedAt ?? u?.lastAt ?? null };
  });
}
