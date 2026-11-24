#!/usr/bin/env node
// cs: the app from the terminal (Claude Code uses it). Short, plain output: one line per thing.
//
// Server: $CS_SERVER, else ~/.config/content-studio/cli.json {"server": "..."}, else the ai-server on the tailnet.

import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { basename, extname, join } from 'node:path';
import { Readable } from 'node:stream';
import type { Job, Page, ThreadItem, Video, VideoDetail, VideoSummary } from '../shared/types.ts';

const HELP = `cs — Content Studio from the terminal

  cs status                           server, Claude, tools, what's running
  cs pages · cs page "<name>" ["what it is"] [--mode mine|mix|fresh] [--color #hex]
                                      a new page; with "what it is", Claude sets it up
  cs setup <page>                     the page's setup (a video: say, add, note, approve work on it)
  cs videos [page]                    by status, newest first
  cs video <video>                    folder, files, versions, notes, the last of the thread
  cs new <page> "<what I want>" [--kind talking-head|voiceover|carousel|ugc|explainer|graded] [--no-go]
  cs add <video> <file…> [--role take|voice|proof|product|broll|logo|reference] [--make]
  cs say <video> "<message>"          Claude starts on it           (--wait to follow it)
  cs go <video> · cs fix <video> · cs stop <video>
  cs note <video> <v> <m:ss.s|s3> "<note>"
  cs thread <video> [--all]           the conversation (--all: with tool calls)
  cs approve <video> <n> · cs posted <video>
  cs test-render <video> [--seconds 10] [--input <file id>] [--cpu]
  cs jobs [video] · cs cancel <job> · cs pair

<video> is the start of its id, folder name or title.`;

function server(): string {
  if (process.env.CS_SERVER) return process.env.CS_SERVER.replace(/\/$/, '');
  const file = join(homedir(), '.config/content-studio/cli.json');
  if (existsSync(file)) {
    const s = (JSON.parse(readFileSync(file, 'utf8')) as { server?: string }).server;
    if (s) return s.replace(/\/$/, '');
  }
  return hostname() === 'ai-server' ? 'http://127.0.0.1:8787' : 'https://ai-server.tail1e2ac8.ts.net:8443';
}

async function api<T>(path: string, init: { method?: string; body?: unknown; raw?: Readable; headers?: Record<string, string> } = {}): Promise<T> {
  const headers: Record<string, string> = { ...init.headers };
  let body: RequestInit['body'];
  if (init.raw) body = Readable.toWeb(init.raw) as unknown as RequestInit['body'];
  else if (init.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(init.body);
  }
  const res = await fetch(server() + path, { method: init.method ?? (body ? 'POST' : 'GET'), headers, body, ...(init.raw ? { duplex: 'half' } : {}) } as RequestInit);
  const text = await res.text();
  const data = text ? (JSON.parse(text) as T & { error?: string }) : (undefined as T);
  if (!res.ok) throw new Error((data as { error?: string } | undefined)?.error ?? `${res.status} ${res.statusText}`);
  return data;
}

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const next = args[i + 1];
  const value = next === undefined || next.startsWith('--') ? 'true' : next;
  args.splice(i, value === 'true' && next !== 'true' ? 1 : 2);
  return value;
};
const short = (id: string) => id.slice(0, 8);
const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

async function pageId(q: string): Promise<string> {
  const pages = await api<Page[]>('/api/pages');
  const b = pages.find((x) => x.id.startsWith(q) || x.slug.startsWith(q.toLowerCase()) || x.name.toLowerCase().startsWith(q.toLowerCase()));
  if (!b) throw new Error(`No page "${q}". Pages: ${pages.map((x) => x.name).join(', ') || 'none (cs page "<name>")'}`);
  return b.id;
}

async function videoId(q: string | undefined): Promise<string> {
  if (!q) throw new Error('Which video?');
  const all = await api<VideoSummary[]>('/api/videos');
  const l = q.toLowerCase();
  const hits = all.filter((v) => v.id.startsWith(q) || v.slug.startsWith(l) || v.title.toLowerCase().startsWith(l));
  if (hits.length !== 1) throw new Error(hits.length ? `"${q}" matches ${hits.length}: ${hits.map((v) => v.title).join(', ')}` : `No video "${q}"`);
  return hits[0]!.id;
}

const line = (v: VideoSummary) => `${short(v.id)} ${v.status.padEnd(6)} ${v.title}${v.reason ? ` — ${v.reason}` : ''}`;

function itemLine(i: ThreadItem): string {
  const who = { you: 'you', claude: 'claude', step: '  ·', tool: '   ', question: 'asks', version: 'saved', lesson: 'lesson', sys: '--', error: 'ERROR' }[i.kind];
  const opts = i.kind === 'question' ? ` [${((i.data.options as string[]) ?? []).join(' | ')}]` : '';
  return `${who} ${i.text.replace(/\s+/g, ' ').slice(0, i.kind === 'claude' || i.kind === 'you' ? 2000 : 300)}${opts}`;
}

/** Follow a run until it ends, printing the thread as it grows. */
async function follow(id: string, job: Job, all: boolean) {
  const seen = new Set((await api<VideoDetail>(`/api/videos/${id}`)).thread.map((i) => i.id));
  for (;;) {
    const d = await api<VideoDetail>(`/api/videos/${id}`);
    for (const i of d.thread) if (!seen.has(i.id)) {
      seen.add(i.id);
      if (all || i.kind !== 'tool') console.log(itemLine(i));
    }
    const j = await api<Job>(`/api/jobs/${job.id}`);
    if (!['queued', 'waiting', 'running'].includes(j.status)) return console.log(`-- ${j.status}${j.error ? `: ${j.error}` : ''}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function main() {
  const wait = flag('wait') === 'true';
  const all = flag('all') === 'true';
  const opt = { kind: flag('kind'), role: flag('role'), color: flag('color'), seconds: flag('seconds'), input: flag('input'), cpu: flag('cpu') === 'true', mode: flag('mode'), noGo: flag('no-go') === 'true', make: flag('make') === 'true' };
  const [cmd, ...rest] = args;
  switch (cmd) {
    case undefined:
    case 'help':
    case '--help':
      return console.log(HELP);
    case 'status': {
      const s = await api<{ version: string; host: string; gpu: string | null; studioDir: string; tools: { name: string; ok: boolean }[]; claude: { loggedIn: boolean; detail: string }; usage: { fiveHour?: { utilization: number } } | null }>('/api/system');
      console.log(`${s.host} · v${s.version} · ${s.gpu ?? 'no GPU'} · studio ${s.studioDir}`);
      console.log(`Claude: ${s.claude.detail}${s.usage?.fiveHour ? ` · 5-hour ${Math.round(s.usage.fiveHour.utilization * 100)} %` : ''}`);
      console.log(s.tools.map((t) => `${t.name} ${t.ok ? 'ok' : 'MISSING'}`).join(' · '));
      for (const j of await api<Job[]>('/api/jobs?active=1')) console.log(`${short(j.id)} ${j.kind} ${j.status} ${j.step ?? ''} ${Math.round(j.progress * 100)} %`);
      return;
    }
    case 'pages':
      for (const b of await api<Page[]>('/api/pages')) console.log(`${short(b.id)} ${b.name} · ~/studio/${b.slug}`);
      return;
    case 'page': {
      const [name, about] = rest;
      const b = await api<Page>('/api/pages', { body: { name, about, mode: opt.mode ?? 'mix', go: !!about, ...(opt.color ? { color: opt.color } : {}) } });
      return console.log(`${short(b.id)} ${b.name} · ~/studio/${b.slug} · setup ${short(b.setupId ?? '')}${about ? ' (Claude is setting it up)' : ''}`);
    }
    case 'setup': {
      const v = await api<Video>(`/api/pages/${await pageId(rest[0] ?? '')}/setup`, { body: {} });
      return console.log(`${short(v.id)} · ${v.folder} · ${v.reason}`);
    }
    case 'videos': {
      const q = rest[0] ? `?pageId=${await pageId(rest[0])}` : '';
      const vs = await api<VideoSummary[]>(`/api/videos${q}`);
      for (const s of ['turn', 'making', 'ready', 'posted'] as const) for (const v of vs.filter((x) => x.status === s)) console.log(line(v));
      return;
    }
    case 'video': {
      const d = await api<VideoDetail>(`/api/videos/${await videoId(rest[0])}`);
      console.log(`${d.video.title} · ${d.video.status} · ${d.video.reason}\n${d.video.folder}`);
      for (const i of d.inputs) console.log(`  file ${short(i.id)} ${i.name} (${i.role ?? '-'}${i.meta?.duration ? `, ${i.meta.duration.toFixed(1)} s` : ''})`);
      for (const v of d.versions) console.log(`  v${v.n} ${v.kind}${v.duration ? ` ${v.duration.toFixed(1)} s` : ''}${v.slides ? ` ${v.slides} slides` : ''}${v.note ? ` · ${v.note}` : ''}`);
      for (const n of d.notes.filter((x) => x.status !== 'fixed')) console.log(`  note v${n.versionN} ${n.slide ? `slide ${n.slide}` : fmt(n.at ?? 0)} ${n.status}: ${n.text}`);
      for (const i of d.thread.filter((x) => x.kind !== 'tool').slice(-8)) console.log(`  ${itemLine(i)}`);
      return;
    }
    case 'new': {
      const [b, ...words] = rest;
      const text = words.join(' ');
      const v = await api<VideoSummary>('/api/videos', { body: { pageId: await pageId(b ?? ''), text, kind: opt.kind ?? 'auto', go: !opt.noGo } });
      return console.log(line(v));
    }
    case 'add': {
      const [q, ...files] = rest;
      const id = await videoId(q);
      for (const f of files) {
        const size = statSync(f).size;
        const ext = extname(f).toLowerCase();
        const mime = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }[ext] ?? 'application/octet-stream';
        const params = new URLSearchParams({ name: basename(f), mime, ...(opt.role ? { role: opt.role } : {}) });
        const input = await api<{ id: string; name: string; role: string }>(`/api/videos/${id}/inputs?${params}`, { method: 'PUT', raw: createReadStream(f), headers: { 'content-type': mime, 'content-length': String(size) } });
        console.log(`${short(input.id)} ${input.name} (${input.role})`);
      }
      if (opt.make) console.log(`started ${short((await api<Job>(`/api/videos/${id}/go`, { body: {} })).id)}`);
      return;
    }
    case 'say':
    case 'go':
    case 'fix': {
      const id = await videoId(rest[0]);
      const job = cmd === 'say' ? await api<Job>(`/api/videos/${id}/messages`, { body: { text: rest.slice(1).join(' ') } }) : await api<Job>(`/api/videos/${id}/${cmd}`, { body: {} });
      if (wait) return follow(id, job, all);
      return console.log(`${short(job.id)} ${job.status}`);
    }
    case 'stop':
      await api(`/api/videos/${await videoId(rest[0])}/stop`, { body: {} });
      return console.log('stopped');
    case 'note': {
      const [q, vn, where, ...words] = rest;
      const slide = where?.startsWith('s') ? Number(where.slice(1)) : null;
      const at = slide ? null : where?.includes(':') ? Number(where.split(':')[0]) * 60 + Number(where.split(':')[1]) : Number(where);
      const n = await api<{ id: string }>(`/api/videos/${await videoId(q)}/notes`, { body: { versionN: Number(String(vn).replace(/^v/, '')), at, slide, text: words.join(' ') } });
      return console.log(`note ${short(n.id)} (cs fix sends the open notes)`);
    }
    case 'thread': {
      const d = await api<VideoDetail>(`/api/videos/${await videoId(rest[0])}`);
      for (const i of d.thread) if (all || i.kind !== 'tool') console.log(itemLine(i));
      return;
    }
    case 'approve':
      return console.log(line(await api<VideoSummary>(`/api/videos/${await videoId(rest[0])}/approve`, { body: { n: Number(String(rest[1]).replace(/^v/, '')) } })));
    case 'posted':
      return console.log(line(await api<VideoSummary>(`/api/videos/${await videoId(rest[0])}/posted`, { body: { posted: true } })));
    case 'test-render': {
      const id = await videoId(rest[0]);
      let inputId: string | undefined;
      if (opt.input) {
        const hits = (await api<VideoDetail>(`/api/videos/${id}`)).inputs.filter((i) => i.id.startsWith(opt.input!) || i.name.startsWith(opt.input!));
        if (hits.length !== 1) throw new Error(`--input ${opt.input} matches ${hits.length} files`);
        inputId = hits[0]!.id;
      }
      const job = await api<Job>(`/api/videos/${id}/test-render`, { body: { seconds: Number(opt.seconds ?? 10), inputId, gpu: !opt.cpu } });
      return follow(id, job, true);
    }
    case 'jobs': {
      const q = rest[0] ? `?videoId=${await videoId(rest[0])}` : '?active=1';
      for (const j of await api<Job[]>(`/api/jobs${q}`)) console.log(`${short(j.id)} ${j.kind} ${j.status} ${j.step ?? ''}${j.error ? ` — ${j.error}` : ''}`);
      return;
    }
    case 'cancel':
      await api(`/api/jobs/${rest[0]}/cancel`, { body: {} });
      return console.log('cancelled');
    case 'pair': {
      const c = await api<{ code: string }>('/api/pair/code', { body: {} });
      return console.log(`Code: ${c.code} (Settings → Phone in the app, valid 10 minutes)`);
    }
    default:
      console.log(HELP);
      process.exitCode = 1;
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
