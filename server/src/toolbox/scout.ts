// The weekly scout: new GitHub repos (skills, MCP servers, motion and video tools) and trending Hugging Face models
// that could make the videos better. Collected without a model (GitHub's and Hugging Face's public APIs, no keys),
// then one Haiku call judges them all: what each would add and its risks. It never installs anything. I can stop a
// run, or have it judge what it found so far (Finish now), and a run waiting on Claude's usage can start at once.
import { desc, eq, inArray, max } from 'drizzle-orm';
import { FIND_KINDS, licenceRisk, SCOUT_EVERY_MS, type FindKind, type FindStatus, type ScoutRun, type Toolbox, type ToolFind } from '../../../shared/toolbox';
import { askStructured } from '../claude/oneshot';
import { playbook } from '../claude/plugin';
import { waitForUsage } from '../claude/usage';
import { db, newId, now, schema } from '../db';
import { emit } from '../lib/events';
import { HttpError } from '../lib/http';
import { getSetting, setSetting } from '../lib/settings';
import { cancelQueued, enqueue, hasPendingJob, JobError, runQueuedNow } from '../jobs/queue';
import { listInstalled, repoInfo, skillSources, type RepoInfo } from './inventory';
import { installedBySource, listInstalls } from './skills';

// Stand-ins for tests, like CS_PLATFORM_API.
const GITHUB = process.env.CS_GITHUB_API ?? 'https://api.github.com';
const HF = process.env.CS_HF_API ?? 'https://huggingface.co';

/** At most this many go to the judge in one run. */
const MAX_CANDIDATES = 40;
/** A find is shown when the judge gives it at least this (5 = maybe: worth a look). */
const SHOW_FROM = 5;

// Names, descriptions and topics only: matching READMEs brings in every big "awesome" list.
const REPO_QUERIES = [
  'topic:claude-skills',
  'topic:agent-skills video',
  'hyperframes in:name,description',
  'topic:mcp-server video',
  'motion graphics in:name,description',
  'gsap animation in:name,description',
  'sound effects in:name,description',
  'short-form video in:name,description',
  'faceless video in:name,description',
  'talking head video in:name,description',
];
const MODEL_TAGS = ['text-to-video', 'image-to-video', 'text-to-image', 'text-to-speech'];

type Candidate = { kind: FindKind; name: string; url: string; description: string; licence: string | null; stars: number; updatedAt: number | null; topics: string[]; repo: string | null };

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The run in progress: Stop aborts it, Finish now (`hurry`) skips the rest of the searching and its waits. */
let active: { abort: AbortController; hurry: boolean } | null = null;
const hurrying = () => !!active && (active.hurry || active.abort.signal.aborted);

const waiters = new Set<() => void>();
/** Waits `ms`, or less when the run is stopped or hurried. */
function pause(ms: number) {
  return new Promise<void>((resolve) => {
    if (hurrying()) return resolve();
    const done = () => {
      clearTimeout(t);
      waiters.delete(done);
      resolve();
    };
    const t = setTimeout(done, ms);
    waiters.add(done);
  });
}
const wake = () => [...waiters].forEach((w) => w());

function stopped() {
  if (active?.abort.signal.aborted) throw new Error('Stopped');
}

async function getJson<T>(url: string, retry = true): Promise<T> {
  stopped();
  const signals = [AbortSignal.timeout(20_000), ...(active ? [active.abort.signal] : [])];
  const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'content-studio-scout' }, signal: AbortSignal.any(signals) });
  // Rate limited (GitHub answers 403 without a key): wait as long as it says, up to a minute, and try once more.
  if ((res.status === 403 || res.status === 429) && retry && !hurrying()) {
    const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000 - Date.now();
    const after = Number(res.headers.get('retry-after')) * 1000;
    const wait = Math.min(65_000, Math.max(5000, after || reset || 60_000));
    step(`GitHub asks to wait ${Math.round(wait / 1000)} s before the next search`);
    await pause(wait);
    stopped();
    if (!hurrying()) return getJson<T>(url, false);
  }
  if (!res.ok) throw new Error(`${new URL(url).host} said ${res.status}`);
  return (await res.json()) as T;
}

type GhRepo = { full_name: string; html_url: string; description: string | null; license: { spdx_id: string } | null; stargazers_count: number; pushed_at: string; topics?: string[]; archived?: boolean; fork?: boolean };

const repoCandidate = (r: GhRepo): Candidate => {
  const text = `${r.full_name} ${r.description ?? ''} ${(r.topics ?? []).join(' ')}`;
  return {
    kind: /\bmcp\b|model.context.protocol/i.test(text) ? 'mcp' : 'repo',
    name: r.full_name,
    url: r.html_url,
    description: (r.description ?? '').slice(0, 400),
    licence: r.license?.spdx_id ?? null,
    stars: r.stargazers_count,
    updatedAt: Date.parse(r.pushed_at) || null,
    topics: (r.topics ?? []).slice(0, 8),
    repo: r.full_name,
  };
};

/** Repos changed since `since`, most starred first. GitHub's search allows 10 a minute without a key. */
async function searchRepos(since: number, log: string[], found: (n: number) => void) {
  const out: Candidate[] = [];
  for (const [i, q] of REPO_QUERIES.entries()) {
    if (i) await pause(8000);
    if (hurrying()) break;
    step(`Searching GitHub: “${q.replace(/ in:\S+$/, '')}” (${i + 1} of ${REPO_QUERIES.length})`);
    try {
      // Made in the last year and a half: older repos are either installed already or long known.
      const url = `${GITHUB}/search/repositories?q=${encodeURIComponent(`${q} pushed:>${day(since)} created:>${day(now() - 540 * 24 * 3600_000)} stars:>=15`)}&sort=stars&order=desc&per_page=10`;
      const res = await getJson<{ items?: GhRepo[] }>(url);
      for (const r of res.items ?? []) if (!r.archived && !r.fork) out.push(repoCandidate(r));
      found(out.length);
    } catch (err) {
      stopped();
      log.push(`GitHub “${q.replace(/ in:\S+$/, '')}”: ${(err as Error).message}`);
    }
  }
  return out;
}

type HfModel = { id: string; likes: number; tags?: string[]; pipeline_tag?: string; createdAt?: string; lastModified?: string };

async function searchModels(log: string[]) {
  const out: Candidate[] = [];
  for (const [i, tag] of MODEL_TAGS.entries()) {
    if (hurrying()) break;
    step(`Searching Hugging Face: ${tag} (${i + 1} of ${MODEL_TAGS.length})`);
    try {
      const res = await getJson<HfModel[]>(`${HF}/api/models?pipeline_tag=${tag}&sort=trendingScore&limit=8`);
      for (const m of res) {
        const tags = m.tags ?? [];
        // Adapters and merges of a base model aren't new tools.
        if (tags.some((t) => /^base_model:(adapter|merge|quantized|finetune):/.test(t))) continue;
        out.push({
          kind: 'model',
          name: m.id,
          url: `${HF}/${m.id}`,
          description: `${m.pipeline_tag ?? tag} model. Tags: ${tags.filter((t) => !/^(license|region|arxiv|base_model|dataset):/.test(t)).slice(0, 10).join(', ')}`,
          licence: tags.find((t) => t.startsWith('license:'))?.slice(8) ?? null,
          stars: m.likes,
          updatedAt: Date.parse(m.lastModified ?? m.createdAt ?? '') || null,
          topics: tags.filter((t) => !t.includes(':')).slice(0, 8),
          repo: null,
        });
      }
    } catch (err) {
      stopped();
      log.push(`Hugging Face ${tag}: ${(err as Error).message}`);
    }
  }
  return out;
}

/** A repo's skills (folders with a SKILL.md), from its file tree. */
async function repoSkills(fullName: string) {
  try {
    const tree = await getJson<{ tree?: { path: string; type: string }[] }>(`${GITHUB}/repos/${fullName}/git/trees/HEAD?recursive=1`);
    const names = (tree.tree ?? []).filter((f) => f.type === 'blob' && /(^|\/)SKILL\.md$/.test(f.path)).map((f) => f.path.split('/').slice(-2, -1)[0] || fullName.split('/')[1]);
    return [...new Set(names)];
  } catch {
    return [];
  }
}

/** The installed skills' source repos: licence, stars and last push, for the Toolbox's skills list. */
async function refreshSkillSources() {
  const info: Record<string, RepoInfo> = { ...repoInfo() };
  for (const repo of skillSources()) {
    // Read again after a week; Finish now skips it.
    if (hurrying()) break;
    if (info[repo] && now() - info[repo].at < SCOUT_EVERY_MS - 24 * 3600_000) continue;
    try {
      const r = await getJson<GhRepo>(`${GITHUB}/repos/${repo}`);
      info[repo] = { licence: r.license?.spdx_id ?? null, stars: r.stargazers_count, pushedAt: Date.parse(r.pushed_at) || null, at: now() };
    } catch {
      stopped();
      /* keep what we had */
    }
  }
  setSetting('toolboxRepos', info);
}

const JUDGED = {
  type: 'object',
  additionalProperties: false,
  required: ['finds'],
  properties: {
    finds: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['url', 'score', 'adds', 'risks'],
        properties: {
          url: { type: 'string' },
          score: { type: 'integer', minimum: 0, maximum: 10, description: 'How much it could do for these videos: 8+ = would clearly lift them, 5 = maybe, 0 = no use or not allowed' },
          adds: { type: 'string', description: 'One concrete sentence: what it would add to these videos, and where in the app' },
          risks: { type: 'array', items: { type: 'string' }, description: 'Short notes: music, people in generated pictures, paid service or API key, licence, GPU too big, already covered by something installed' },
        },
      },
    },
  },
};

const INSTRUCTIONS = `You scout tools for Content Studio, a desktop app that makes short vertical videos (TikTok, Reels, Shorts) with Claude: a personal brand (Muslim entrepreneurship, lifestyle) and an Islamic page. The focus now: the personal brand is the creator on camera (talking-head footage filmed on a phone: cutting pauses, stumbles and retakes, punch-ins, captions, motion graphics over the footage), and faceless motion explainers for the rest: designed animation, kinetic type, graphics and 3D (HyperFrames: HTML + GSAP rendered by headless Chrome), recorded non-melodic sound effects on the frame of each motion, voiceover, strong hooks and payoffs.
You get candidates (GitHub repos and Hugging Face models) found this week, and what's installed. Judge each candidate: would it make these videos better, and how?
Hard rules: no music ever (a music generator, a music library or music advice is worth 0); generated pictures and clips must never show people or animals (a tool whose point is AI avatars, generated faces or AI personas is worth 2 at most and says so; tools that edit real footage of the creator are fine); no Anthropic API key (Claude runs on the Pro login); the home PCs are a GTX 1070 (8 GB) and a GTX 1050 Ti (4 GB). Prefer licences that allow commercial use.
Coming next in the app, so finds that feed these are worth more: a library of recorded sound effects (non-melodic, with a clear licence) placed on the frame of each motion; a motion scene library ported from prompt and scene collections (GSAP, Three.js, Canvas, WebGL) into seek-safe HyperFrames scenes; a 2D outline mascot rig (vector poses, gestures, walk); measuring reference videos (hook, beats, cuts per second, sound timing).
Be strict: most candidates are a 3 to 5. A 7+ adds something the app doesn't have (a better motion technique, scenes, SFX with a clear licence, a stronger hook method, a faster or better model that fits the hardware). Say which installed thing it would replace or add to. The licence is checked separately: don't list it as a risk. Return every candidate once, by its url.`;

type Judged = { finds: { url: string; score: number; adds: string; risks: string[] }[] };

function setRun(run: ScoutRun) {
  setSetting('toolScout', run);
  emit({ type: 'changed', entity: 'toolbox' });
}

let current: ScoutRun | null = null;
/** What the run is doing now, for the Toolbox. */
function step(text: string, more: Partial<ScoutRun> = {}) {
  if (!current) return;
  Object.assign(current, { step: text, ...more });
  setRun(current);
}

/** The `toolbox.scout` job. `now`: I asked for it at once, so it doesn't wait for Claude's usage to come down. */
export async function scoutJob(payload: { now?: boolean } = {}) {
  const prev = getSetting('toolScout');
  const startedAt = prev && (prev.status === 'waiting' || prev.status === 'running') ? prev.startedAt : now();
  // Wait for Claude before the slow part, so a wait doesn't fetch everything twice.
  if (!payload.now) {
    try {
      await waitForUsage('scout');
    } catch (err) {
      if (err instanceof JobError && err.opts.wait) setRun({ startedAt, finishedAt: null, status: 'waiting', looked: 0, found: 0, error: null, step: err.message, waitUntil: now() + (err.opts.delayMs ?? 60_000) });
      throw err;
    }
  }
  // Repos changed since the last find (a day's overlap), or in the last 90 days the first time.
  const newest = db.select({ at: max(schema.toolFinds.createdAt) }).from(schema.toolFinds).get()?.at;
  const since = newest ? newest - 24 * 3600_000 : now() - 90 * 24 * 3600_000;
  const run: ScoutRun = { startedAt, finishedAt: null, status: 'running', looked: 0, found: 0, error: null, step: 'Checking the installed skills’ repos', waitUntil: null, judging: false };
  current = run;
  active = { abort: new AbortController(), hurry: false };
  setRun(run);
  const log: string[] = [];
  try {
    await refreshSkillSources();
    const installed = await listInstalled();
    const ownRepos = new Set(skillSources().map((r) => r.toLowerCase()));
    const seen = new Set(db.select({ url: schema.toolFinds.url }).from(schema.toolFinds).all().map((r) => r.url));
    const repos = await searchRepos(since, log, (n) => step(run.step ?? '', { looked: n }));
    const all = [...repos, ...(await searchModels(log))];
    stopped();
    const byUrl = new Map<string, Candidate>();
    for (const c of all) if (!seen.has(c.url) && !ownRepos.has(c.repo?.toLowerCase() ?? '') && !byUrl.has(c.url)) byUrl.set(c.url, c);
    const candidates = [...byUrl.values()].sort((a, b) => b.stars - a.stars).slice(0, MAX_CANDIDATES);
    run.looked = candidates.length;
    if (!candidates.length && log.length) throw new Error(log.join('; '));
    if (active.hurry) log.push(`Finished early: judged what it had found`);

    let judged: Judged = { finds: [] };
    if (candidates.length) {
      const list = candidates
        .map((c) => `- ${c.url} [${c.kind}] ${c.name} (${c.kind === 'model' ? '♥' : '★'} ${c.stars}, licence ${c.licence ?? 'none'}, updated ${c.updatedAt ? day(c.updatedAt) : '?'}): ${c.description || '(no description)'}${c.topics.length ? ` Topics: ${c.topics.join(', ')}` : ''}`)
        .join('\n');
      const have = installed
        .filter((t) => t.kind === 'skill' || t.kind === 'model' || t.kind === 'program')
        .map((t) => `${t.label ?? t.name}${t.status === 'missing' ? ' (not set up)' : ''}`)
        .join(', ');
      step(`Claude is judging ${candidates.length} finds`, { judging: true });
      judged = await askStructured<Judged>({
        task: 'scout',
        system: [playbook('halal'), INSTRUCTIONS].filter(Boolean).join('\n\n'),
        prompt: `Installed: ${have}.\n\nCandidates:\n${list}`,
        schema: JUDGED,
        model: 'haiku',
        signal: active.abort.signal,
      });
      stopped();
      step('Reading the best finds’ skills');
    }

    const verdicts = new Map(judged.finds.map((f) => [f.url, f]));
    for (const c of candidates) {
      stopped();
      const v = verdicts.get(c.url);
      // Not judged: left for the next run.
      if (!v) continue;
      const score = Math.max(0, Math.min(10, Math.round(v.score)));
      const show = score >= SHOW_FROM;
      let kind = c.kind;
      let install = '';
      if (show && c.repo) {
        const skills = await repoSkills(c.repo);
        if (skills.length) {
          kind = 'skill';
          install = `npx skills add ${c.repo} -a claude-code --copy -s ${skills.slice(0, 8).join(' ')}`;
        }
      }
      const licence = licenceRisk(c.licence);
      // The licence note is ours; the judge's own say on it would only repeat it.
      const risks = [licence, ...(v.risks ?? []).map((r) => r.trim()).filter((r) => r && !(licence && /licen[cs]e|noassertion/i.test(r)))].filter((r): r is string => !!r).slice(0, 6);
      db.insert(schema.toolFinds)
        .values({ id: newId(), kind: FIND_KINDS.includes(kind) ? kind : 'repo', name: c.name, url: c.url, description: c.description, adds: v.adds?.trim() ?? '', risks, licence: c.licence, stars: c.stars, upstreamAt: c.updatedAt, score, install, status: show ? 'new' : 'seen' })
        .onConflictDoNothing()
        .run();
      if (show) run.found++;
    }
    setRun({ ...run, status: 'done', finishedAt: now(), step: null, error: log.length ? log.join('; ').slice(0, 500) : null });
  } catch (err) {
    // Stopped: the job is over, not failed.
    if (active?.abort.signal.aborted) return setRun({ ...run, status: 'stopped', finishedAt: now(), step: null, error: null });
    setRun({ ...run, status: 'failed', finishedAt: now(), step: null, error: (err as Error).message.slice(0, 500) });
    throw err;
  } finally {
    active = null;
    current = null;
  }
}

const toFind = (r: typeof schema.toolFinds.$inferSelect, installed: ReturnType<typeof installedBySource>): ToolFind => ({
  id: r.id,
  kind: r.kind,
  name: r.name,
  url: r.url,
  description: r.description,
  adds: r.adds,
  risks: r.risks,
  licence: r.licence,
  stars: r.stars,
  updatedAt: r.upstreamAt,
  score: r.score,
  install: r.install,
  skills: /\s-s\s+(.+)$/.exec(r.install)?.[1].split(/\s+/).filter(Boolean) ?? [],
  installed: r.kind === 'skill' ? (installed.get(r.name.toLowerCase()) ?? []) : [],
  status: r.status === 'seen' ? 'dismissed' : r.status,
  foundAt: r.createdAt,
});

const scouting = () => hasPendingJob('toolbox.scout');

export function scoutRun(): ScoutRun | null {
  const run = getSetting('toolScout') ?? null;
  // The app closed while it ran.
  if ((run?.status === 'running' || run?.status === 'waiting') && !scouting()) return { ...run, status: 'failed', step: null, error: 'Stopped before it finished' };
  return run;
}

export function nextScoutAt() {
  const run = scoutRun();
  return run ? run.startedAt + SCOUT_EVERY_MS : null;
}

export async function toolbox(): Promise<Toolbox> {
  const finds = db
    .select()
    .from(schema.toolFinds)
    .where(inArray(schema.toolFinds.status, ['new', 'wanted', 'dismissed']))
    .orderBy(desc(schema.toolFinds.createdAt), desc(schema.toolFinds.score))
    .all();
  const installed = installedBySource();
  return { installed: await listInstalled(), finds: finds.map((r) => toFind(r, installed)), scout: scoutRun(), nextScoutAt: nextScoutAt(), installs: listInstalls() };
}

export function startScout() {
  if (scouting()) throw new HttpError(409, 'The scout is already running.');
  enqueue('toolbox.scout', {}, { maxAttempts: 1 });
  setRun({ startedAt: now(), finishedAt: null, status: 'running', looked: 0, found: 0, error: null, step: 'Starting', waitUntil: null });
}

/** Stop: a waiting run is dropped, a running one aborted. */
export function stopScout() {
  const run = scoutRun();
  if (active) {
    active.abort.abort();
    wake();
  } else if (cancelQueued('toolbox.scout') && run) setRun({ ...run, status: 'stopped', finishedAt: now(), step: null, error: null });
  else throw new HttpError(409, 'The scout isn’t running.');
}

/** Finish now: a waiting run starts at once (Claude's usage or not); a running one stops searching and judges. */
export function finishScout() {
  if (active) {
    active.hurry = true;
    wake();
    if (current && !current.judging) step('Finishing: Claude judges what it found so far');
  } else if (runQueuedNow('toolbox.scout', { now: true })) {
    const run = scoutRun();
    if (run) setRun({ ...run, status: 'running', step: 'Starting', waitUntil: null });
  } else throw new HttpError(409, 'The scout isn’t running.');
}

export function setFindStatus(id: string, status: FindStatus) {
  const r = db.select({ id: schema.toolFinds.id }).from(schema.toolFinds).where(eq(schema.toolFinds.id, id)).get();
  if (!r) throw new HttpError(404, 'Find not found');
  db.update(schema.toolFinds).set({ status, updatedAt: now() }).where(eq(schema.toolFinds.id, id)).run();
  emit({ type: 'changed', entity: 'toolbox', id });
}

let timer: NodeJS.Timeout | undefined;

/** Once a week, after 7:00. */
function tick() {
  if (new Date().getHours() < 7 || scouting()) return;
  const run = getSetting('toolScout');
  if (run && now() - run.startedAt < SCOUT_EVERY_MS) return;
  try {
    startScout();
  } catch (err) {
    console.warn(`[toolbox] ${(err as Error).message}`);
  }
}

export function startScoutSchedule() {
  setTimeout(tick, 5 * 60_000);
  timer = setInterval(tick, 60 * 60_000);
}

export function stopScoutSchedule() {
  clearInterval(timer);
}
