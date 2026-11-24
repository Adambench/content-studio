#!/usr/bin/env node
// cs: the app from the terminal (Claude Code uses it). Short, plain output: one line per thing.
//
// Server: $CS_SERVER, else ~/.config/content-studio/cli.json {"server": "..."}, else the ai-server on the tailnet.

import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { basename, extname, join } from 'node:path';
import { Readable } from 'node:stream';
import type { CardDetail, CardSummary, Job, Page, Rule } from '../shared/types.ts';
import { STAGE_LABEL } from '../shared/types.ts';

const HELP = `cs — Content Studio from the terminal

  cs status                          server, Claude login, tools, running jobs
  cs board [page]                    cards by stage (page: name or id)
  cs card <card>                     script, notes, files, versions, renders, open comments, jobs
  cs new <page> "<title>" [--recipe r] [--notes "…"]
  cs set <card> <field> <value|@file>   field: title recipe stage script notes caption
  cs add <card> <file…> [--role take|voice|proof|product|broll|logo|reference]
  cs write <card> ["what I want"]    Claude drafts the script      (--wait to wait)
  cs hooks <card>                    other first lines               (--wait)
  cs make <card> [--recipe r]        make the video                  (--wait)
  cs fix <card>                      fix my open comments            (--wait)
  cs test-render <card> [--seconds 10] [--input <id>] [--cpu]
  cs comments                        every open comment
  cs jobs [card] · cs job <id> · cs cancel <job>
  cs rules [page]                    the rulebook, strongest first
  cs pages · cs pair                 pages; a code to pair the phone

<card> is the start of its id or of its title.`;

function server(): string {
  if (process.env.CS_SERVER) return process.env.CS_SERVER.replace(/\/$/, '');
  const file = join(homedir(), '.config/content-studio/cli.json');
  if (existsSync(file)) {
    const s = (JSON.parse(readFileSync(file, 'utf8')) as { server?: string }).server;
    if (s) return s.replace(/\/$/, '');
  }
  return hostname() === 'ai-server' ? 'http://127.0.0.1:8787' : 'https://ai-server.tail1e2ac8.ts.net';
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
  const v = args[i + 1];
  args.splice(i, v && !v.startsWith('--') ? 2 : 1);
  return v && !v.startsWith('--') ? v : 'true';
};
const short = (id: string) => id.slice(0, 8);
const secs = (s: number | null | undefined) => (s == null ? '' : s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : `${s.toFixed(1)}s`);
const when = (t: number) => new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

async function pageId(q: string): Promise<string> {
  const pages = await api<Page[]>('/api/pages');
  const hit = pages.find((p) => p.id.startsWith(q) || p.name.toLowerCase() === q.toLowerCase()) ?? pages.find((p) => p.name.toLowerCase().includes(q.toLowerCase()));
  if (!hit) throw new Error(`No page "${q}" (${pages.map((p) => p.name).join(', ')})`);
  return hit.id;
}

async function cardId(q: string | undefined): Promise<string> {
  if (!q) throw new Error('Which card?');
  const cards = [...(await api<CardSummary[]>('/api/board')), ...(await api<CardSummary[]>('/api/board?trash=1'))];
  const hits = cards.filter((c) => c.id.startsWith(q)).concat(cards.filter((c) => c.title.toLowerCase().startsWith(q.toLowerCase())));
  const unique = [...new Map(hits.map((c) => [c.id, c])).values()];
  if (unique.length === 1) return unique[0]!.id;
  if (!unique.length) throw new Error(`No card "${q}"`);
  throw new Error(`"${q}" matches ${unique.length} cards: ${unique.map((c) => `${short(c.id)} ${c.title}`).join(' · ')}`);
}

function jobLine(j: Job) {
  return `${short(j.id)} ${j.kind} ${j.status}${j.step ? ` · ${j.step}` : ''}${j.status === 'running' ? ` ${Math.round(j.progress * 100)}%` : ''}${j.error ? ` · ${j.error}` : ''}`;
}

async function waitFor(job: Job): Promise<Job> {
  let last = '';
  for (;;) {
    const j = await api<Job>(`/api/jobs/${job.id}`);
    const line = jobLine(j);
    if (line !== last) console.log(line);
    last = line;
    if (['done', 'failed', 'cancelled'].includes(j.status)) {
      for (const l of j.log.slice(-5)) console.log(`  ${l.text}`);
      return j;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

const MIME: Record<string, string> = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown' };

async function main() {
  const [cmd, ...rest] = args;
  const wait = flag('wait') === 'true';
  switch (cmd) {
    case undefined:
    case 'help':
    case '--help':
      console.log(HELP);
      return;
    case 'status': {
      const s = await api<{ version: string; host: string; gpu: string | null; tools: { name: string; ok: boolean }[]; claude: { loggedIn: boolean; detail: string }; usage: { fiveHour?: { utilization: number } } | null }>('/api/system');
      console.log(`${server()} · v${s.version} on ${s.host}${s.gpu ? ` · ${s.gpu}` : ''}`);
      console.log(`Claude: ${s.claude.detail}${s.usage?.fiveHour ? ` · 5-hour usage ${Math.round(s.usage.fiveHour.utilization * 100)} %` : ''}`);
      console.log(`Tools: ${s.tools.map((t) => `${t.name} ${t.ok ? 'ok' : 'MISSING'}`).join(' · ')}`);
      for (const j of await api<Job[]>('/api/jobs?active=1')) console.log(jobLine(j));
      return;
    }
    case 'pages':
      for (const p of await api<Page[]>('/api/pages')) console.log(`${short(p.id)} ${p.name}${p.settings.niche ? ` · ${p.settings.niche}` : ''}`);
      return;
    case 'board': {
      const pages = await api<Page[]>('/api/pages');
      const q = rest[0] ? `?pageId=${await pageId(rest[0])}` : '';
      const cards = await api<CardSummary[]>(`/api/board${q}`);
      for (const stage of Object.keys(STAGE_LABEL) as (keyof typeof STAGE_LABEL)[]) {
        const group = cards.filter((c) => c.stage === stage);
        if (!group.length) continue;
        console.log(`${STAGE_LABEL[stage]}:`);
        for (const c of group) {
          const page = rest[0] ? '' : `${pages.find((p) => p.id === c.pageId)?.name ?? ''} · `;
          const bits = [c.recipe !== 'auto' && c.recipe, c.inputs && `${c.inputs} files`, c.versions && `v${c.versions}`, c.openComments && `${c.openComments} comments`, c.job && `${c.job.kind} ${c.job.status}`].filter(Boolean);
          console.log(`  ${short(c.id)} ${page}${c.title}${bits.length ? ` (${bits.join(', ')})` : ''}`);
        }
      }
      return;
    }
    case 'card': {
      const d = await api<CardDetail>(`/api/cards/${await cardId(rest[0])}`);
      const c = d.card;
      console.log(`${c.title} · ${STAGE_LABEL[c.stage]} · ${c.recipe} · ${short(c.id)}`);
      if (c.script.trim()) console.log(`\n## ${c.labels.script}\n${c.script.trim()}`);
      if (c.notes.trim()) console.log(`\n## ${c.labels.notes}\n${c.notes.trim()}`);
      if (d.inputs.length) console.log(`\n## Files\n${d.inputs.map((i) => `  ${short(i.id)} ${i.role ?? i.kind} ${i.name}${i.meta?.duration ? ` ${secs(i.meta.duration)}` : ''}${i.meta?.width ? ` ${i.meta.width}×${i.meta.height}` : ''}`).join('\n')}`);
      if (d.versions.length) console.log(`\n## Versions\n${d.versions.map((v) => `  v${v.n} ${v.author} ${v.recipe} · ${v.note} · ${when(v.createdAt)}`).join('\n')}`);
      if (d.renders.length) console.log(`\n## Renders\n${d.renders.slice(0, 5).map((r) => `  ${short(r.id)} v${r.n} ${r.status}${r.duration ? ` ${secs(r.duration)}` : ''}${r.error ? ` · ${r.error}` : ''}`).join('\n')}`);
      const open = d.comments.filter((m) => m.status === 'open');
      if (open.length) console.log(`\n## Open comments\n${open.map((m) => `  ${short(m.id)} ${m.at != null ? `@${secs(m.at)}${m.end != null ? `–${secs(m.end)}` : ''} ` : m.slide != null ? `slide ${m.slide + 1} ` : ''}${m.text}`).join('\n')}`);
      if (d.hooks?.length) console.log(`\n## Hooks\n${d.hooks.map((h) => `  - ${h.line} (${h.why})`).join('\n')}`);
      if (d.jobs.length) console.log(`\n## Jobs\n${d.jobs.slice(0, 4).map((j) => `  ${jobLine(j)}`).join('\n')}`);
      return;
    }
    case 'new': {
      const [page, title] = rest;
      if (!page || !title) throw new Error('cs new <page> "<title>"');
      const recipe = flag('recipe');
      const notes = flag('notes');
      const c = await api<CardSummary>('/api/cards', { body: { pageId: await pageId(page), title, ...(recipe ? { recipe } : {}), ...(notes ? { notes } : {}) } });
      console.log(`${short(c.id)} ${c.title}`);
      return;
    }
    case 'set': {
      const [q, field, value] = rest;
      if (!q || !field || value === undefined) throw new Error('cs set <card> <field> <value|@file>');
      const v = value.startsWith('@') ? readFileSync(value.slice(1), 'utf8') : value;
      await api(`/api/cards/${await cardId(q)}`, { method: 'PATCH', body: { [field]: v } });
      console.log('saved');
      return;
    }
    case 'add': {
      const [q, ...files] = rest;
      const role = flag('role');
      const id = await cardId(q);
      for (const f of files) {
        const name = basename(f);
        const mime = MIME[extname(f).toLowerCase()] ?? 'application/octet-stream';
        const size = statSync(f).size;
        const params = new URLSearchParams({ name, mime, ...(role ? { role } : {}) });
        const input = await api<{ id: string; kind: string; role: string }>(`/api/cards/${id}/inputs?${params}`, { method: 'PUT', raw: createReadStream(f), headers: { 'content-type': mime, 'content-length': String(size) } });
        console.log(`${short(input.id)} ${input.role ?? input.kind} ${name}`);
      }
      return;
    }
    case 'write':
    case 'hooks':
    case 'make':
    case 'fix': {
      const recipe = flag('recipe');
      const id = await cardId(rest[0]);
      const body = cmd === 'write' ? { instruction: rest.slice(1).join(' ') } : cmd === 'make' && recipe ? { recipe } : {};
      const job = await api<Job>(`/api/cards/${id}/${cmd}`, { body });
      if (wait || cmd === 'hooks') {
        const done = await waitFor(job);
        if (cmd === 'hooks' && done.status === 'done') {
          const d = await api<CardDetail>(`/api/cards/${id}`);
          for (const h of d.hooks ?? []) console.log(`- ${h.line} (${h.why})`);
        }
      } else console.log(jobLine(job));
      return;
    }
    case 'test-render': {
      const id = await cardId(rest[0]);
      const seconds = Number(flag('seconds') ?? 10);
      const inputId = flag('input');
      const cpu = flag('cpu') === 'true';
      await waitFor(await api<Job>(`/api/cards/${id}/test-render`, { body: { seconds, ...(inputId ? { inputId } : {}), gpu: !cpu } }));
      return;
    }
    case 'comments': {
      const cards = (await api<CardSummary[]>('/api/board')).filter((c) => c.openComments > 0);
      for (const c of cards) {
        const d = await api<CardDetail>(`/api/cards/${c.id}`);
        console.log(`${short(c.id)} ${c.title}:`);
        for (const m of d.comments.filter((x) => x.status === 'open')) console.log(`  ${short(m.id)} ${m.at != null ? `@${secs(m.at)} ` : m.slide != null ? `slide ${m.slide + 1} ` : ''}${m.text}`);
      }
      if (!cards.length) console.log('No open comments');
      return;
    }
    case 'jobs':
      for (const j of await api<Job[]>(`/api/jobs${rest[0] ? `?cardId=${await cardId(rest[0])}` : ''}`)) console.log(jobLine(j));
      return;
    case 'job': {
      const j = await api<Job>(`/api/jobs/${rest[0]}`);
      console.log(jobLine(j));
      for (const l of j.log) console.log(`  ${when(l.at)} ${l.text}`);
      return;
    }
    case 'cancel':
      console.log(jobLine(await api<Job>(`/api/jobs/${rest[0]}/cancel`, { body: {} })));
      return;
    case 'rules': {
      const q = rest[0] ? `?pageId=${await pageId(rest[0])}` : '';
      for (const r of await api<Rule[]>(`/api/rules${q}`)) if (r.status === 'on') console.log(`${short(r.id)} [${r.source}${r.topic ? `/${r.topic}` : ''}] ${r.title}${r.taught > 1 ? ` (×${r.taught})` : ''}`);
      return;
    }
    case 'pair': {
      const p = await api<{ code: string; expiresAt: number }>('/api/pair/code', { body: {} });
      console.log(`Code ${p.code} for ${server()} (until ${when(p.expiresAt)})`);
      return;
    }
    default:
      throw new Error(`Unknown command "${cmd}". cs help`);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
