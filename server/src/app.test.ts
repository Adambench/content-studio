// The API end to end on a throwaway data folder: pages, cards, uploads (both kinds), comments, Approve's guard,
// rules and who may get in. No server is started (Fastify's inject), no job runs.

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'cs-test-'));
process.env.CONTENT_STUDIO_DATA_DIR = dir;

const { migrate } = await import('./db/db.ts');
const { seedRules } = await import('./services/rules.ts');
const { buildApp } = await import('./http/app.ts');

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;

before(async () => {
  migrate();
  seedRules();
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

test('a card goes from idea to a guarded approve', async () => {
  const page = await call<{ id: string }>('POST', '/api/pages', { name: 'Personal brand', color: '#f59e0b' });
  assert.equal(page.status, 200);
  const card = await call<{ id: string; stage: string; title: string }>('POST', '/api/cards', { pageId: page.json.id, title: 'Day 10', recipe: 'talking-head' });
  assert.equal(card.json.stage, 'idea');

  const patched = await call<{ script: string }>('PATCH', `/api/cards/${card.json.id}`, { script: 'Day 10.\nA lead wrote back.' });
  assert.equal(patched.json.script, 'Day 10.\nA lead wrote back.');

  // One request with the whole file.
  const put = await call<{ kind: string; role: string; size: number }>('PUT', `/api/cards/${card.json.id}/inputs?name=take1.mp4&mime=video/mp4`, Buffer.alloc(1000, 1), { 'content-type': 'video/mp4' });
  assert.equal(put.status, 200);
  assert.deepEqual([put.json.kind, put.json.role, put.json.size], ['video', 'take', 1000]);

  // The phone's resumable upload, with the old field name and a chunk out of step.
  const up = await call<{ id: string }>('POST', '/api/uploads', { pieceId: card.json.id, name: 'shot.png', mime: 'image/png', size: 10 });
  const first = await call<{ offset: number }>('PATCH', `/api/uploads/${up.json.id}`, Buffer.alloc(6, 2), { 'upload-offset': '0', 'content-type': 'application/offset+octet-stream' });
  assert.equal(first.json.offset, 6);
  const stale = await call<{ offset: number }>('PATCH', `/api/uploads/${up.json.id}`, Buffer.alloc(6, 2), { 'upload-offset': '0', 'content-type': 'application/offset+octet-stream' });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.offset, 6);
  const done = await call<{ offset: number; mediaId: string }>('PATCH', `/api/uploads/${up.json.id}`, Buffer.alloc(4, 2), { 'upload-offset': '6', 'content-type': 'application/offset+octet-stream' });
  assert.ok(done.json.mediaId);

  const detail = await call<{ inputs: { role: string }[]; card: { inputs: number } }>('GET', `/api/cards/${card.json.id}`);
  assert.deepEqual(
    detail.json.inputs.map((i) => i.role),
    ['take', 'proof'],
  );

  // Nothing rendered yet: Approve refuses.
  assert.equal((await call('POST', `/api/cards/${card.json.id}/approve`, {})).status, 409);

  const comment = await call<{ status: string; at: number }>('POST', `/api/cards/${card.json.id}/comments`, { at: 1.5, text: 'Cut is late' });
  assert.equal(comment.json.status, 'open');
  const board = await call<{ openComments: number }[]>('GET', `/api/board?pageId=${page.json.id}`);
  assert.equal(board.json[0]?.openComments, 1);

  // A board drag: to Script, first in the column.
  const moved = await call<{ stage: string }>('PATCH', `/api/cards/${card.json.id}`, { stage: 'script', between: [null, null] });
  assert.equal(moved.json.stage, 'script');
});

test('deleting a card or its page takes its files with it', async () => {
  const page = await call<{ id: string }>('POST', '/api/pages', { name: 'Scratch', color: '#a1a1aa' });
  const ids: string[] = [];
  for (const title of ['One', 'Two']) {
    const card = await call<{ id: string }>('POST', '/api/cards', { pageId: page.json.id, title });
    await call('PUT', `/api/cards/${card.json.id}/inputs?name=take.mp4&mime=video/mp4`, Buffer.alloc(100, 1), { 'content-type': 'video/mp4' });
    assert.ok(existsSync(join(dir, 'media', card.json.id)));
    ids.push(card.json.id);
  }
  assert.equal((await call('DELETE', `/api/cards/${ids[0]}?hard=1`)).status, 200);
  assert.equal(existsSync(join(dir, 'media', ids[0]!)), false);
  assert.ok(existsSync(join(dir, 'media', ids[1]!)));
  await call('DELETE', `/api/pages/${page.json.id}`);
  assert.equal(existsSync(join(dir, 'media', ids[1]!)), false);
});

test('halal rules are seeded and locked', async () => {
  const rules = await call<{ id: string; source: string; locked: boolean }[]>('GET', '/api/rules');
  const halal = rules.json.filter((r) => r.source === 'halal');
  assert.ok(halal.length >= 5);
  assert.ok(halal.every((r) => r.locked));
  assert.equal((await call('PATCH', `/api/rules/${halal[0]!.id}`, { status: 'off' })).status, 409);
  assert.equal((await call('DELETE', `/api/rules/${halal[0]!.id}`)).status, 409);
});

test('only the tailnet, paired devices and this machine get in', async () => {
  assert.equal((await call('GET', '/api/pages', undefined, { 'x-forwarded-for': '100.64.0.9' })).status, 401);
  assert.equal((await call('GET', '/api/pages', undefined, { 'x-forwarded-for': '100.64.0.9', 'tailscale-user-login': 'me@example.com' })).status, 200);
  assert.equal((await call('GET', '/api/pages', undefined, { 'tailscale-funnel-request': '?1', 'tailscale-user-login': 'me@example.com' })).status, 401);
  assert.equal((await call('GET', '/api/health', undefined, { 'x-forwarded-for': '100.64.0.9' })).status, 200);

  const code = await call<{ code: string }>('POST', '/api/pair/code', {});
  const paired = await call<{ token: string }>('POST', '/api/pair', { code: code.json.code, name: 'Pixel' }, { 'x-forwarded-for': '100.64.0.9' });
  assert.ok(paired.json.token);
  assert.equal((await call('GET', '/api/pages', undefined, { 'x-forwarded-for': '100.64.0.9', authorization: `Bearer ${paired.json.token}` })).status, 200);
  // A code works once.
  assert.equal((await call('POST', '/api/pair', { code: code.json.code }, { 'x-forwarded-for': '100.64.0.9' })).status, 401);
});
