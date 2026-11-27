// The API end to end on a throwaway data folder and studio: pages, videos and their folders, the thread, uploads
// (both kinds), versions, notes and Fix, answers, Approve's guard, the brain files, Claude's guard rails, and who
// may get in. No server is started (Fastify's inject) and no job runs (Claude isn't called).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'cs-test-'));
process.env.CONTENT_STUDIO_DATA_DIR = dir;
process.env.CS_STUDIO_DIR = join(dir, 'studio');

const { migrate } = await import('./db/db.ts');
const { ensureStudioFiles } = await import('./services/brain.ts');
const { buildApp } = await import('./http/app.ts');
const { saveVersion } = await import('./services/versions.ts');
const { addThread } = await import('./services/thread.ts');
const { refusal } = await import('./engine/guard.ts');
const { get } = await import('./db/db.ts');

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;

before(async () => {
  migrate();
  ensureStudioFiles();
  app = await buildApp();
});
after(async () => {
  await app.close();
  rmSync(dir, { recursive: true, force: true });
});

const local = { remoteAddress: '127.0.0.1' };
async function call<T = unknown>(method: string, url: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: T }> {
  const res = await app.inject({ method: method as 'GET', url, payload: body as string, headers: { ...(body !== undefined && typeof body === 'object' && !Buffer.isBuffer(body) ? { 'content-type': 'application/json' } : {}), ...headers }, ...local });
  return { status: res.statusCode, json: (res.body ? JSON.parse(res.body) : null) as T };
}

type V = { id: string; folder: string; status: string; reason: string; title: string };
type Detail = { video: V; inputs: { name: string; role: string }[]; versions: { n: number }[]; notes: { id: string; status: string }[]; thread: { id: string; kind: string; text: string }[]; job: { kind: string } | null };

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

test('a video from the inbox: its folder, files, versions, notes, Fix and Approve', async () => {
  const page = await call<{ id: string; slug: string }>('POST', '/api/pages', { name: 'Personal page', color: '#e6b450' });
  assert.equal(page.json.slug, 'personal-page');
  assert.ok(existsSync(join(dir, 'studio/personal-page/CLAUDE.md')));

  // Without a go, nothing runs.
  const made = await call<V>('POST', '/api/videos', { pageId: page.json.id, text: 'Day 12. The first reply came in.', go: false });
  assert.equal(made.json.title, 'Day 12');
  assert.equal(made.json.folder, join(dir, 'studio/personal-page/day-12'));
  assert.ok(existsSync(join(made.json.folder, 'project.md')));
  const id = made.json.id;

  // The laptop's drop (one request), then the phone's resumable upload with an old field name and a chunk out of step.
  const put = await call<{ name: string; role: string }>('PUT', `/api/videos/${id}/inputs?name=take1.mp4&mime=video/mp4`, Buffer.alloc(1000, 1), { 'content-type': 'video/mp4' });
  assert.deepEqual([put.json.name, put.json.role], ['take1.mp4', 'take']);
  await call('PUT', `/api/videos/${id}/inputs?name=take1.mp4&mime=video/mp4`, Buffer.alloc(10, 1), { 'content-type': 'video/mp4' });
  const up = await call<{ id: string }>('POST', '/api/uploads', { pieceId: id, name: 'reply.png', mime: 'image/png', size: 10 });
  assert.equal((await call<Detail>('GET', `/api/videos/${id}`)).json.video.status, 'making');
  await call('PATCH', `/api/uploads/${up.json.id}`, Buffer.alloc(6, 2), { 'upload-offset': '0', 'content-type': 'application/offset+octet-stream' });
  const stale = await call<{ offset: number }>('PATCH', `/api/uploads/${up.json.id}`, Buffer.alloc(6, 2), { 'upload-offset': '0', 'content-type': 'application/offset+octet-stream' });
  assert.deepEqual([stale.status, stale.json.offset], [409, 6]);
  await call('PATCH', `/api/uploads/${up.json.id}`, Buffer.alloc(4, 2), { 'upload-offset': '6', 'content-type': 'application/offset+octet-stream' });
  let detail = (await call<Detail>('GET', `/api/videos/${id}`)).json;
  assert.deepEqual(detail.inputs.map((i) => [i.name, i.role]), [['take1.mp4', 'take'], ['take1-2.mp4', 'take'], ['reply.png', 'proof']]);
  assert.ok(existsSync(join(made.json.folder, 'files/take1-2.mp4')));
  assert.equal(detail.video.reason, '3 files · say go');

  // A note needs a version; Approve needs one too.
  assert.equal((await call('POST', `/api/videos/${id}/notes`, { versionN: 1, at: 1, text: 'Late cut' })).status, 400);
  assert.equal((await call('POST', `/api/videos/${id}/approve`, { n: 1 })).status, 400);

  // A message is in the thread at once and queues Claude (the runner isn't started here).
  const sent = await call<{ kind: string; status: string }>('POST', `/api/videos/${id}/messages`, { text: 'Go, take 3 opens' });
  assert.deepEqual([sent.json.kind, sent.json.status], ['agent', 'queued']);
  detail = (await call<Detail>('GET', `/api/videos/${id}`)).json;
  assert.equal(detail.thread.at(-1)?.text, 'Go, take 3 opens');
  assert.equal(detail.video.status, 'making');
  await call(`POST`, `/api/videos/${id}/stop`, {});
  assert.equal((await call<Detail>('GET', `/api/videos/${id}`)).json.video.status, 'turn');

  if (!hasFfmpeg) return;
  const clip = join(dir, 'clip.mp4');
  spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=black:s=108x192:d=1', '-pix_fmt', 'yuv420p', clip]);
  const v1 = await saveVersion(id, { file: clip, note: 'First cut' });
  assert.equal(v1.n, 1);
  assert.ok(existsSync(join(made.json.folder, 'renders/v1.mp4')) && existsSync(join(made.json.folder, 'renders/v1.jpg')));
  assert.equal((await call<V[]>('GET', '/api/videos')).json[0]?.reason, 'v1 ready');

  // Notes collect; Fix sends them all at once; Approve waits until they're done.
  const note = await call<{ id: string; status: string }>('POST', `/api/videos/${id}/notes`, { versionN: 1, at: 0.5, text: 'The cut is late' });
  assert.equal(note.json.status, 'open');
  assert.equal((await call('POST', `/api/videos/${id}/approve`, { n: 1 })).status, 409);
  const fix = await call<{ kind: string }>('POST', `/api/videos/${id}/fix`, {});
  assert.equal(fix.json.kind, 'agent');
  assert.equal((await call<Detail>('GET', `/api/videos/${id}`)).json.notes[0]?.status, 'sent');
  assert.equal((await call('POST', `/api/videos/${id}/fix`, {})).status, 409);
  await call('POST', `/api/videos/${id}/stop`, {});
  // A run that stops leaves its notes open again.
  assert.equal((await call<Detail>('GET', `/api/videos/${id}`)).json.notes[0]?.status, 'open');
  await call('DELETE', `/api/notes/${note.json.id}`);

  // Claude's question, answered once.
  const q = addThread(id, 'question', 'Which cover?', { options: ['A', 'B'], picked: null });
  assert.match((await call<V[]>('GET', '/api/videos')).json[0]!.reason, /^Claude asks: Which cover\?/);
  assert.equal((await call('POST', `/api/videos/${id}/answer`, { itemId: q.id, option: 1 })).status, 200);
  assert.equal((await call('POST', `/api/videos/${id}/answer`, { itemId: q.id, option: 0 })).status, 409);
  await call('POST', `/api/videos/${id}/stop`, {});

  const approved = await call<V>('POST', `/api/videos/${id}/approve`, { n: 1 });
  assert.equal(approved.json.status, 'ready');
  assert.equal((await call<V>('POST', `/api/videos/${id}/posted`, {})).json.status, 'posted');

  // Deleting a video takes its folder with it.
  await call('DELETE', `/api/videos/${id}`);
  assert.equal(existsSync(made.json.folder), false);
});

test('"Add & make": Claude starts once every shared file is in', async () => {
  const page = await call<{ id: string }>('POST', '/api/pages', { name: 'Gentle Return' });
  const v = await call<V>('POST', '/api/videos', { pageId: page.json.id, title: 'Before you sleep' });
  await call('POST', `/api/videos/${v.json.id}/make-when-uploaded`, { count: 2 });
  await call('PUT', `/api/videos/${v.json.id}/inputs?name=voice.m4a&mime=audio/mp4`, Buffer.alloc(10, 1), { 'content-type': 'audio/mp4' });
  assert.equal((await call<Detail>('GET', `/api/videos/${v.json.id}`)).json.job, null);
  await call('PUT', `/api/videos/${v.json.id}/inputs?name=sky.jpg&mime=image/jpeg`, Buffer.alloc(10, 1), { 'content-type': 'image/jpeg' });
  assert.equal((await call<Detail>('GET', `/api/videos/${v.json.id}`)).json.job?.kind, 'agent');
});

test('a new page: its setup studio, how far Claude builds, samples first, its kit, Done once approved', async () => {
  type Pg = { id: string; slug: string; name: string; setupId: string | null };
  const prompt = (videoId: string) => JSON.parse(get<{ input: string }>("SELECT input FROM jobs WHERE video_id = ? AND kind = 'agent' ORDER BY created_at DESC LIMIT 1", videoId)?.input ?? '{}').prompt as string | undefined;

  // No name yet: the folder is named after what I said; Claude suggests names and builds from scratch.
  const fresh = (await call<Pg>('POST', '/api/pages', { about: 'Islamic life hacks for busy Muslims. Calm, warm, practical.', mode: 'fresh' })).json;
  assert.equal(fresh.name, 'New page');
  assert.equal(fresh.slug, 'islamic-life-hacks-for');
  const setup = (await call<Detail>('GET', `/api/videos/${fresh.setupId}`)).json;
  assert.equal(setup.video.folder, join(dir, 'studio/islamic-life-hacks-for/setup'));
  assert.ok(existsSync(join(dir, 'studio/islamic-life-hacks-for/kit')));
  assert.match(readFileSync(join(dir, 'studio/islamic-life-hacks-for/CLAUDE.md'), 'utf8'), /## Lessons/);
  assert.equal(setup.job?.kind, 'agent');
  assert.equal(setup.thread[0]?.kind, 'you');
  assert.match(prompt(fresh.setupId!) ?? '', /none yet \(suggest 3[\s\S]*scratch[\s\S]*Islamic life hacks/);

  // The page keeps setup/ and kit/ for itself.
  const named = await call<V>('POST', '/api/videos', { pageId: fresh.id, title: 'Setup', go: false });
  assert.equal(named.json.folder, join(dir, 'studio/islamic-life-hacks-for/setup-2'));

  // The setup may clear out the page's kit, nothing else outside its folder.
  const kit = [join(dir, 'studio/islamic-life-hacks-for/kit')];
  assert.equal(refusal('Bash', { command: 'rm ../kit/old-logo.svg && rm -rf work/board' }, setup.video.folder, kit), null);
  assert.ok(refusal('Bash', { command: 'rm -rf ../setup-2' }, setup.video.folder, kit));

  // With samples on the way, Claude waits for them, then gets my words and how far to build.
  const mine = (await call<Pg>('POST', '/api/pages', { name: 'Qalam & Siwaak', about: 'Luxury miswak pen.', mode: 'mine', files: 1 })).json;
  assert.equal(mine.slug, 'qalam-siwaak');
  assert.equal((await call<Detail>('GET', `/api/videos/${mine.setupId}`)).json.job, null);
  await call('PUT', `/api/videos/${mine.setupId}/inputs?name=logo.png&mime=image/png`, Buffer.alloc(10, 1), { 'content-type': 'image/png' });
  const after = (await call<Detail>('GET', `/api/videos/${mine.setupId}`)).json;
  assert.equal(after.job?.kind, 'agent');
  assert.equal(after.inputs[0]?.role, 'reference');
  assert.match(prompt(mine.setupId!) ?? '', /"Qalam & Siwaak"[\s\S]*from what I gave[\s\S]*logo\.png/);

  // A setup is never posted; approved, it's Done (out of the inbox's lists).
  assert.equal((await call('POST', `/api/videos/${mine.setupId}/posted`, {})).status, 409);
  if (hasFfmpeg) {
    const png = join(dir, 'board.png');
    spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=white:s=108x135', '-frames:v', '1', png]);
    await saveVersion(mine.setupId!, { slides: [png], note: 'Board' });
    assert.equal((await call<V>('POST', `/api/videos/${mine.setupId}/approve`, { n: 1 })).json.status, 'done');
  }

  // A page goes only without videos (its setup goes with it).
  assert.equal((await call('DELETE', `/api/pages/${fresh.id}`)).status, 409);
  assert.equal((await call('DELETE', `/api/pages/${mine.id}`)).status, 200);
});

test('pages set up in bulk (later) wait for spare usage and go one at a time, oldest first', async () => {
  const { runAgent } = await import('./engine/agent.ts');
  const { JobWait } = await import('./jobs/queue.ts');
  const { setSetting } = await import('./db/db.ts');
  const jobs: { id: string; input: string; video_id: string }[] = [];
  for (const name of ['Later one', 'Later two']) {
    const page = (await call<{ id: string }>('POST', '/api/pages', { name })).json;
    const setup = (await call<V>('POST', `/api/pages/${page.id}/setup`, { about: `${name}: calm, practical tips.`, mode: 'mine', later: true })).json;
    jobs.push(get<{ id: string; input: string; video_id: string }>("SELECT id, input, video_id FROM jobs WHERE video_id = ? AND kind = 'agent'", setup.id)!);
  }
  assert.ok(jobs.every((j) => JSON.parse(j.input).background === true));
  // Only the waiting is tried here (a run that goes would start Claude).
  const wait = (id: string) => runAgent({ job: { id }, input: { background: true } } as never).then(() => 'ran', (e: unknown) => (e instanceof JobWait ? e.message : String(e)));
  assert.match(await wait(jobs[1]!.id), /run before it/);
  setSetting('claudeUsage', { sevenDay: { utilization: 0.97, resetsAt: Date.now() + 3_600_000 }, updatedAt: Date.now() });
  assert.match(await wait(jobs[0]!.id), /weekly usage to come down \(97 %\)/);
  setSetting('claudeUsage', null);
  // Go (what I press never waits) starts a held one now, with what it was going to say.
  const now = (await call<{ id: string }>('POST', `/api/videos/${jobs[1]!.video_id}/go`)).json;
  assert.equal(get<{ status: string }>('SELECT status FROM jobs WHERE id = ?', jobs[1]!.id)!.status, 'cancelled');
  const input = JSON.parse(get<{ input: string }>('SELECT input FROM jobs WHERE id = ?', now.id)!.input);
  assert.equal(input.background, undefined);
  assert.match(input.prompt, /^Set this page up\.[\s\S]*from what I gave[\s\S]*Later two: calm, practical tips\.[\s\S]*Go: set it up/);
});

test('the brain is files: halal locked in the studio CLAUDE.md, ticked lessons copied into it', async () => {
  const md = () => readFileSync(join(dir, 'studio/CLAUDE.md'), 'utf8');
  assert.match(md(), /No music or instruments/);
  assert.doesNotMatch(md(), /@lessons\.md/);
  await call('POST', '/api/brain/lessons', { scope: 'all', text: 'Cut at the end of the breath, never on it' });
  let brain = (await call<{ lessons: { text: string; on: boolean; line: number }[] }>('GET', '/api/brain')).json;
  assert.equal(brain.lessons[0]?.on, true);
  assert.match(md(), /^- Cut at the end of the breath, never on it$/m);
  brain = (await call<typeof brain>('PATCH', '/api/brain/lessons', { scope: 'all', line: brain.lessons[0]!.line, on: false })).json;
  assert.equal(brain.lessons[0]?.on, false);
  assert.match(readFileSync(join(dir, 'studio/lessons.md'), 'utf8'), /- \[ \] Cut at the end of the breath/);
  assert.doesNotMatch(md(), /Cut at the end of the breath/);
});

test("Claude's guard rails: anything in the studio, nothing to the machine", () => {
  const cwd = join(dir, 'studio/personal-page/day-12');
  assert.equal(refusal('Bash', { command: 'ffmpeg -i files/take1.mp4 work/a.wav && rm -rf work/tmp' }, cwd), null);
  assert.equal(refusal('Bash', { command: 'rm work/*.wav /tmp/x' }, cwd), null);
  assert.ok(refusal('Bash', { command: 'sudo apt install x' }, cwd));
  assert.ok(refusal('Bash', { command: 'docker ps' }, cwd));
  assert.ok(refusal('Bash', { command: 'curl localhost:3000 # open-webui' }, cwd));
  assert.ok(refusal('Bash', { command: 'nmcli radio wifi off' }, cwd));
  assert.ok(refusal('Bash', { command: 'systemctl --user restart content-studio' }, cwd));
  assert.equal(refusal('Bash', { command: 'systemctl --user status content-studio' }, cwd), null);
  assert.ok(refusal('Bash', { command: 'rm -rf ~/Documents' }, cwd));
  assert.ok(refusal('Bash', { command: 'cd .. && rm -rf ../other-video' }, cwd));
  assert.ok(refusal('Bash', { command: 'rm -rf $DIR' }, cwd));
  assert.ok(refusal('Bash', { command: 'cat ~/.config/content-studio/keys.env' }, cwd));
  assert.ok(refusal('Write', { file_path: join(dir, 'studio/CLAUDE.md') }, cwd));
  assert.equal(refusal('Write', { file_path: 'work/plan.md' }, cwd), null);
  assert.equal(refusal('Edit', { file_path: join(dir, 'studio/lessons.md') }, cwd), null);
  assert.ok(refusal('Write', { file_path: '/home/someone/.bashrc' }, cwd));
});

test('only the tailnet, paired devices and this machine get in', async () => {
  assert.equal((await call('GET', '/api/videos', undefined, { 'x-forwarded-for': '100.64.0.9' })).status, 401);
  assert.equal((await call('GET', '/api/videos', undefined, { 'x-forwarded-for': '100.64.0.9', 'tailscale-user-login': 'me@example.com' })).status, 200);
  assert.equal((await call('GET', '/api/videos', undefined, { 'tailscale-funnel-request': '?1', 'tailscale-user-login': 'me@example.com' })).status, 401);
  assert.equal((await call('GET', '/api/health', undefined, { 'x-forwarded-for': '100.64.0.9' })).status, 200);

  const code = await call<{ code: string }>('POST', '/api/pair/code', {});
  const paired = await call<{ token: string }>('POST', '/api/pair', { code: code.json.code, name: 'Pixel' }, { 'x-forwarded-for': '100.64.0.9' });
  assert.ok(paired.json.token);
  assert.equal((await call('GET', '/api/videos', undefined, { 'x-forwarded-for': '100.64.0.9', authorization: `Bearer ${paired.json.token}` })).status, 200);
  // A code works once.
  assert.equal((await call('POST', '/api/pair', { code: code.json.code }, { 'x-forwarded-for': '100.64.0.9' })).status, 401);
  // From the internet (Funnel) only a paired device gets in, even straight from loopback, which is where Funnel's proxy connects from.
  const funnel = { 'tailscale-funnel-request': '?1' };
  assert.equal((await call('GET', '/api/signed-in', undefined, funnel)).status, 401);
  assert.equal((await call('GET', '/api/signed-in', undefined, { ...funnel, authorization: 'Bearer nope' })).status, 401);
  assert.equal((await call('GET', '/api/signed-in', undefined, { ...funnel, authorization: `Bearer ${paired.json.token}` })).status, 200);
  assert.equal((await call('GET', `/api/signed-in?t=${paired.json.token}`, undefined, funnel)).status, 200);
  assert.equal((await call('POST', '/api/pair/code', {}, funnel)).status, 401);
  // Wrong codes run out: ten in 10 minutes (one above), then even a right one waits.
  for (let i = 0; i < 9; i++) assert.equal((await call('POST', '/api/pair', { code: 'WRONG123' }, funnel)).status, 401);
  const fresh = await call<{ code: string }>('POST', '/api/pair/code', {});
  assert.equal((await call('POST', '/api/pair', { code: fresh.json.code }, funnel)).status, 429);
});
