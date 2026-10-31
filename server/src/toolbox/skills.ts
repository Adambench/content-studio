// Installing skills from the Toolbox: a repo's skill folders read straight from GitHub (no npx: the desktop launcher's
// PATH doesn't have it) into Content Studio (the data folder, loaded in the chat as the studio-added plugin) or Claude
// Code's own folder (~/.claude/skills, every project). Sound and video files are never copied: they could hold music.
// Installing and removing are my clicks; Claude does neither.
import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { LEFT_OUT_FILE, licenceRisk, SKILL_HOME_INFO, type InstallPlace, type InstallPreview, type InstallRun, type SkillHome, type SkillPreview } from '../../../shared/toolbox';
import { addedSkills, prepareAddedPlugin, skillFolders } from '../claude/plugin';
import { config } from '../config';
import { emit } from '../lib/events';
import { HttpError } from '../lib/http';

// Stand-ins for tests, like CS_PLATFORM_API.
const GITHUB = process.env.CS_GITHUB_API ?? 'https://api.github.com';
const RAW = process.env.CS_GITHUB_RAW ?? 'https://raw.githubusercontent.com';

/** A skill needs its text, not a model's weights: bigger files are left out. */
const MAX_FILE = 25_000_000;
const MAX_SKILL = 150_000_000;
const SCRIPT = /\.(py|sh|bash|zsh|js|mjs|cjs|ts|rb|ps1)$/i;
const SKILL_NAME = /^[\w][\w.-]*$/;

export const SKILL_DIRS: Record<SkillHome, string> = {
  'built-in': join(config.pluginDir, 'skills'),
  app: join(config.addedPluginDir, 'skills'),
  'claude-code': config.claudeCodeSkillsDir,
};

const LOCK_FILES: Record<SkillHome, string> = {
  // `npx skills add` keeps it in the repo; the packaged app ships a copy.
  'built-in': join(config.resourcesDir, 'skills-lock.json'),
  app: join(config.addedPluginDir, 'skills-lock.json'),
  'claude-code': config.skillsCliLock,
};

type LockEntry = { source: string; skillPath?: string; [key: string]: unknown };
type LockFile = { version?: number; skills: Record<string, LockEntry> };

function readLock(home: SkillHome): LockFile {
  try {
    const lock = JSON.parse(readFileSync(LOCK_FILES[home], 'utf8')) as LockFile;
    return { ...lock, skills: lock.skills ?? {} };
  } catch {
    return { skills: {} };
  }
}

function writeJson(file: string, value: unknown) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, file);
}

/** Where each skill in a home came from (`owner/repo`), as its lock file says. */
export const skillLock = (home: SkillHome): Record<string, LockEntry> => readLock(home).skills;

function setLockEntry(home: InstallPlace, name: string, entry: LockEntry | null) {
  const lock = readLock(home);
  // The skills CLI's own file: only its format 3 is known, anything else is left alone.
  if (home === 'claude-code' && existsSync(LOCK_FILES[home]) && lock.version !== 3) return;
  if (entry) lock.skills[name] = { ...entry, installedAt: lock.skills[name]?.installedAt ?? entry.installedAt };
  else delete lock.skills[name];
  writeJson(LOCK_FILES[home], { ...lock, version: lock.version ?? (home === 'claude-code' ? 3 : 1) });
}

/** A field of a SKILL.md's front matter (top level, or under `metadata:`), wrapped and folded lines joined. */
export function frontField(head: string, key: string) {
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

export const frontMatter = (text: string) => (text.startsWith('---') ? text.slice(3, Math.max(3, text.indexOf('\n---', 3))) : '');

export const firstSentence = (s: string) => {
  const t = s.replace(/\s+/g, ' ').trim();
  const end = t.search(/[.!?](\s|$)/);
  const one = end > 0 ? t.slice(0, end + 1) : t;
  return one.length > 240 ? `${one.slice(0, 240)}…` : one;
};

const size = (b: number) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// ---------- GitHub ----------

async function github<T>(path: string): Promise<T> {
  const res = await fetch(`${GITHUB}${path}`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'content-studio' }, signal: AbortSignal.timeout(20_000) });
  if (res.status === 404) throw new HttpError(404, 'GitHub has no such repo (or it’s private).');
  if (res.status === 403 || res.status === 429) {
    const mins = Math.max(1, Math.ceil((Number(res.headers.get('x-ratelimit-reset')) * 1000 - Date.now()) / 60_000) || 60);
    throw new HttpError(429, `GitHub’s limit for this hour is used up: try again in ${plural(mins, 'minute')}.`);
  }
  if (!res.ok) throw new HttpError(502, `GitHub said ${res.status}.`);
  return (await res.json()) as T;
}

type RepoFile = { path: string; size: number };
type SkillDef = { name: string; dir: string; sha: string; files: RepoFile[]; leftOut: RepoFile[] };
type Repo = { at: number; repo: string; licence: string | null; skills: Map<string, SkillDef>; truncated: boolean };

const repos = new Map<string, Repo>();

/** The repo's skills (folders with a SKILL.md) and their files, read once every 10 minutes at most. */
async function readRepo(repo: string): Promise<Repo> {
  const hit = repos.get(repo.toLowerCase());
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit;
  const [info, tree] = await Promise.all([
    github<{ license: { spdx_id: string } | null }>(`/repos/${repo}`),
    github<{ tree?: { path: string; type: string; mode: string; sha: string; size?: number }[]; truncated?: boolean }>(`/repos/${repo}/git/trees/HEAD?recursive=1`),
  ]);
  const entries = tree.tree ?? [];
  const folderSha = new Map(entries.filter((e) => e.type === 'tree').map((e) => [e.path, e.sha]));
  // Links and submodules can't be fetched as files.
  const blobs = entries.filter((e) => e.type === 'blob' && e.mode !== '120000' && !/(^|\/)(\.git|node_modules)\//.test(e.path));
  const dirs = blobs.filter((e) => /(^|\/)SKILL\.md$/.test(e.path)).map((e) => dirname(e.path).replace(/^\.$/, ''));
  const skills = new Map<string, SkillDef>();
  // A name found twice (a repo that mirrors its skills under .claude/ or .agents/): the plainest path wins.
  for (const dir of [...dirs].sort((a, b) => Number(/(^|\/)\./.test(a)) - Number(/(^|\/)\./.test(b)) || a.length - b.length)) {
    const name = dir.split('/').pop() || repo.split('/')[1];
    if (skills.has(name) || !SKILL_NAME.test(name)) continue;
    const inside = blobs.filter((e) => !dir || e.path.startsWith(`${dir}/`));
    // Another skill inside this one's folder isn't part of it.
    const nested = dirs.filter((d) => d !== dir && (!dir || d.startsWith(`${dir}/`)));
    const own = inside.filter((e) => !nested.some((d) => e.path.startsWith(`${d}/`))).map((e) => ({ path: e.path, size: e.size ?? 0 }));
    const leftOut = own.filter((f) => LEFT_OUT_FILE.test(f.path) || f.size > MAX_FILE);
    skills.set(name, { name, dir, sha: (dir ? folderSha.get(dir) : null) ?? '', files: own.filter((f) => !leftOut.includes(f)), leftOut });
  }
  const read: Repo = { at: Date.now(), repo, licence: info.license?.spdx_id ?? null, skills, truncated: !!tree.truncated };
  repos.set(repo.toLowerCase(), read);
  return read;
}

const rawUrl = (repo: string, path: string) => `${RAW}/${repo}/HEAD/${path.split('/').map(encodeURIComponent).join('/')}`;

async function raw(repo: string, path: string) {
  const res = await fetch(rawUrl(repo, path), { headers: { 'user-agent': 'content-studio' }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Couldn’t download ${path} (GitHub said ${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}

/** Runs `fn` on every item, `n` at a time. */
async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  }));
}

/** Every installed skill, by the repo it came from (lower case). */
export function installedBySource() {
  const out = new Map<string, { skill: string; home: SkillHome }[]>();
  for (const home of Object.keys(SKILL_DIRS) as SkillHome[]) {
    const present = new Set(home === 'app' ? addedSkills() : skillFolders(SKILL_DIRS[home]));
    for (const [skill, entry] of Object.entries(skillLock(home))) {
      if (!present.has(skill) || typeof entry?.source !== 'string') continue;
      const key = entry.source.toLowerCase();
      out.set(key, [...(out.get(key) ?? []), { skill, home }]);
    }
  }
  return out;
}

const homesOf = (name: string): SkillHome[] =>
  (Object.keys(SKILL_DIRS) as SkillHome[]).filter((h) => (h === 'app' ? addedSkills() : skillFolders(SKILL_DIRS[h])).includes(name));

/** What installing a repo would bring: its skills, their size, what's left out and where they're already installed. */
export async function previewInstall(repo: string): Promise<InstallPreview> {
  const r = await readRepo(repo);
  if (!r.skills.size) throw new HttpError(404, `${repo} has no skills (no folder with a SKILL.md).`);
  const skills: SkillPreview[] = [];
  await pool([...r.skills.values()].slice(0, 40), 6, async (s) => {
    let head = '';
    try {
      head = frontMatter((await raw(repo, s.dir ? `${s.dir}/SKILL.md` : 'SKILL.md')).toString('utf8').slice(0, 8000));
    } catch {
      /* shown without its description */
    }
    skills.push({
      name: s.name,
      about: firstSentence(frontField(head, 'description') ?? ''),
      files: s.files.length,
      bytes: s.files.reduce((n, f) => n + f.size, 0),
      leftOut: s.leftOut.length,
      runsCommands: s.files.some((f) => SCRIPT.test(f.path)) || /\bBash\b/.test(frontField(head, 'allowed-tools') ?? ''),
      homes: homesOf(s.name),
    });
  });
  skills.sort((a, b) => a.name.localeCompare(b.name));
  return { repo, url: `https://github.com/${repo}`, licence: r.licence, licenceRisk: licenceRisk(r.licence), skills };
}

// ---------- installing ----------

const installs = new Map<string, InstallRun>();
let lastEmit = 0;

function changed(run: InstallRun, force = false) {
  if (!force && Date.now() - lastEmit < 400) return;
  lastEmit = Date.now();
  emit({ type: 'changed', entity: 'toolbox', id: run.id });
}

/** Installs running or finished in the last 10 minutes. */
export const listInstalls = () => [...installs.values()].sort((a, b) => b.startedAt - a.startedAt);

export function startInstall(repo: string, skills: string[], places: InstallPlace[]) {
  if (!skills.length || !skills.every((s) => SKILL_NAME.test(s))) throw new HttpError(400, 'Pick the skills to install.');
  if (!places.length) throw new HttpError(400, 'Pick where to install them.');
  if (listInstalls().some((r) => r.status === 'running' && r.repo.toLowerCase() === repo.toLowerCase())) throw new HttpError(409, `${repo} is installing already.`);
  const run: InstallRun = { id: randomUUID(), repo, skills, places, status: 'running', step: `Reading ${repo} on GitHub`, done: 0, total: 0, notes: [], error: null, startedAt: Date.now(), finishedAt: null };
  installs.set(run.id, run);
  changed(run, true);
  void install(run)
    .then(() => Object.assign(run, { status: 'done', finishedAt: Date.now() }))
    .catch((err: Error) => Object.assign(run, { status: 'failed', error: err.message, finishedAt: Date.now() }))
    .finally(() => {
      changed(run, true);
      setTimeout(() => installs.delete(run.id), 10 * 60_000).unref();
    });
  return run;
}

async function install(run: InstallRun) {
  const r = await readRepo(run.repo);
  const builtIn = new Set(skillFolders(SKILL_DIRS['built-in']));
  const wanted = run.skills.filter((n) => {
    if (r.skills.has(n)) return true;
    run.notes.push(`${n} isn’t in the repo any more: skipped.`);
    return false;
  });
  // A built-in skill keeps its name in the app: an added one would only hide behind it.
  const target = (place: InstallPlace) => wanted.filter((n) => place !== 'app' || !builtIn.has(n));
  for (const n of wanted.filter((n) => builtIn.has(n) && run.places.includes('app'))) run.notes.push(`${n} is built into the app already: it stays as it is there.`);
  const needed = wanted.filter((n) => run.places.some((p) => target(p).includes(n))).map((n) => r.skills.get(n)!);
  if (!needed.length) {
    run.step = 'Nothing new to install';
    return;
  }
  for (const s of needed) {
    const bytes = s.files.reduce((n, f) => n + f.size, 0);
    if (bytes > MAX_SKILL) throw new Error(`${s.name} is ${size(bytes)}: too big for a skill.`);
  }
  const leftOut = needed.flatMap((s) => s.leftOut);
  const media = leftOut.filter((f) => LEFT_OUT_FILE.test(f.path)).length;
  if (media) run.notes.push(`Left out ${plural(media, 'sound or video file')}: they could hold music.`);
  if (leftOut.length > media) run.notes.push(`Left out ${plural(leftOut.length - media, 'file')} over ${size(MAX_FILE)}.`);
  if (r.truncated) run.notes.push('GitHub listed only part of this big repo: a file may be missing.');

  const files = needed.flatMap((s) => s.files.map((f) => ({ skill: s, file: f })));
  run.total = files.length;
  run.step = `Downloading ${plural(files.length, 'file')} (${size(files.reduce((n, f) => n + f.file.size, 0))})`;
  changed(run, true);
  const stage = join(config.tmpDir, `skill-${run.id}`);
  try {
    await pool(files, 6, async ({ skill, file }) => {
      const rel = skill.dir ? file.path.slice(skill.dir.length + 1) : file.path;
      const root = join(stage, skill.name);
      const dest = resolve(root, rel);
      if (!dest.startsWith(root + sep)) throw new Error(`${file.path} points outside its folder.`);
      const body = await raw(run.repo, file.path);
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, body);
      run.done++;
      changed(run);
    });

    const now = new Date().toISOString();
    for (const place of run.places) {
      const names = target(place);
      if (!names.length) continue;
      run.step = `Putting ${plural(names.length, 'skill')} in ${SKILL_HOME_INFO[place].label}`;
      changed(run, true);
      if (place === 'app') prepareAddedPlugin();
      mkdirSync(SKILL_DIRS[place], { recursive: true });
      for (const name of names) {
        const s = r.skills.get(name)!;
        const dest = join(SKILL_DIRS[place], name);
        const update = existsSync(dest);
        rmSync(dest, { recursive: true, force: true });
        cpSync(join(stage, name), dest, { recursive: true });
        setLockEntry(place, name, {
          source: run.repo,
          sourceType: 'github',
          sourceUrl: `https://github.com/${run.repo}.git`,
          skillPath: s.dir ? `${s.dir}/SKILL.md` : 'SKILL.md',
          skillFolderHash: s.sha,
          installedAt: now,
          updatedAt: now,
        });
        if (update) run.notes.push(`${name} was in ${SKILL_HOME_INFO[place].label} already: updated.`);
      }
    }
    const placed = run.places.filter((p) => target(p).length);
    run.step = `Installed in ${placed.map((p) => SKILL_HOME_INFO[p].label).join(' and ')}`;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

function skillDir(home: SkillHome, name: string) {
  if (!SKILL_NAME.test(name)) throw new HttpError(400, 'Not a skill name.');
  const dir = join(SKILL_DIRS[home], name);
  if (!existsSync(join(dir, 'SKILL.md'))) throw new HttpError(404, `No skill called ${name} in ${SKILL_HOME_INFO[home].label}.`);
  return dir;
}

export function removeSkill(home: SkillHome, name: string) {
  if (home === 'built-in') throw new HttpError(400, 'Built-in skills ship with the app: remove them in the repo.');
  // rm doesn't follow links: a linked skill loses only its link.
  rmSync(skillDir(home, name), { recursive: true, force: true });
  setLockEntry(home, name, null);
  emit({ type: 'changed', entity: 'toolbox' });
}

/** A Claude Code skill copied into Content Studio, so the app's chat has it too. */
export function addToApp(name: string) {
  const from = skillDir('claude-code', name);
  if (skillFolders(SKILL_DIRS['built-in']).includes(name)) throw new HttpError(409, `${name} is built into the app already.`);
  prepareAddedPlugin();
  const dest = join(SKILL_DIRS.app, name);
  rmSync(dest, { recursive: true, force: true });
  let left = 0;
  cpSync(from, dest, {
    recursive: true,
    dereference: true,
    filter: (src) => {
      const out = LEFT_OUT_FILE.test(src);
      if (out) left++;
      return !out;
    },
  });
  const entry = skillLock('claude-code')[name];
  const now = new Date().toISOString();
  if (entry?.source) setLockEntry('app', name, { ...entry, installedAt: now, updatedAt: now });
  emit({ type: 'changed', entity: 'toolbox' });
  return { leftOut: left };
}
