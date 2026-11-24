// The API end to end on a throwaway data folder and studio: brands, videos and their folders, the thread, uploads
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
  const brand = await call<{ id: string; slug: string }>('POST', '/api/brands', { name: 'Personal brand', color: '#e6b450' });
  assert.equal(brand.json.slug, 'personal-brand');
  assert.ok(existsSync(join(dir, 'studio/personal-brand/CLAUDE.md')));

  // Without a go, nothing runs.
  const made = await call<V>('POST', '/api/videos', { brandId: brand.json.id, text: 'Day 12. The first reply came in.', go: false });
  assert.equal(made.json.title, 'Day 12');
  assert.equal(made.json.folder, join(dir, 'studio/personal-brand/day-12'));
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
  const brand = await call<{ id: string }>('POST', '/api/brands', { name: 'Gentle Return' });
  const v = await call<V>('POST', '/api/videos', { brandId: brand.json.id, title: 'Before you sleep' });
  await call('POST', `/api/videos/${v.json.id}/make-when-uploaded`, { count: 2 });
  await call('PUT', `/api/videos/${v.json.id}/inputs?name=voice.m4a&mime=audio/mp4`, Buffer.alloc(10, 1), { 'content-type': 'audio/mp4' });
  assert.equal((await call<Detail>('GET', `/api/videos/${v.json.id}`)).json.job, null);
  await call('PUT', `/api/videos/${v.json.id}/inputs?name=sky.jpg&mime=image/jpeg`, Buffer.alloc(10, 1), { 'content-type': 'image/jpeg' });
  assert.equal((await call<Detail>('GET', `/api/videos/${v.json.id}`)).json.job?.kind, 'agent');
});

test('the brain is files: halal locked in the studio CLAUDE.md, lessons ticked or not', async () => {
  const md = readFileSync(join(dir, 'studio/CLAUDE.md'), 'utf8');
  assert.match(md, /No music or instruments/);
  assert.match(md, /@lessons\.md/);
  await call('POST', '/api/brain/lessons', { scope: 'all', text: 'Cut at the end of the breath, never on it' });
  let brain = (await call<{ lessons: { text: string; on: boolean; line: number }[] }>('GET', '/api/brain')).json;
  assert.equal(brain.lessons[0]?.on, true);
  brain = (await call<typeof brain>('PATCH', '/api/brain/lessons', { scope: 'all', line: brain.lessons[0]!.line, on: false })).json;
  assert.equal(brain.lessons[0]?.on, false);
  assert.match(readFileSync(join(dir, 'studio/lessons.md'), 'utf8'), /- \[ \] Cut at the end of the breath/);
});

test("Claude's guard rails: anything in the studio, nothing to the machine", () => {
  const cwd = join(dir, 'studio/personal-brand/day-12');
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
});
