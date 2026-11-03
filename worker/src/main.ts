// A compute worker for Content Studio: runs on a home PC, takes the heavy jobs (Whisper, Demucs, the person matte, the
// speaker scan, picture and video generation, the cloned voice, drawing renders) from the laptop's queue and sends the
// results back.
// It also tells the laptop where the text model it hosts (Ollama) is, when it has one (CS_LLM_URL). It pairs once with a code from Settings → Compute,
// then polls the laptop over Tailscale. It only ever runs the tools in shared/compute.ts, with file names the laptop
// chose; it never runs a command the laptop sends.
//
//   worker pair --server https://laptop.tailnet.ts.net --code XXXX-XXXX-XXXX [--name "Desktop 1070"]
//   worker run
import { execFile, spawn } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { homedir, hostname, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { TOOL_INFO, commandFor, type ComputeTool, type MachinePaths, type WorkerReport, type WorkerTask } from '../../shared/compute';

const run = promisify(execFile);

const dataDir = process.env.CS_WORKER_DIR ?? join(homedir(), '.local/share/content-studio-worker');
const configFile = join(dataDir, 'config.json');
const here = dirname(fileURLToPath(import.meta.url));
const toolsDir = join(dataDir, 'tools');

type Config = { server: string; token: string; name: string };

const machine = (): MachinePaths => ({
  scriptsDir: process.env.CS_WORKER_SCRIPTS ?? join(here, 'scripts'),
  toolsPython: join(toolsDir, 'bin/python'),
  whisperPython: join(toolsDir, 'bin/python'),
  matteModel: join(toolsDir, 'models/u2net_human_seg.onnx'),
  yunetModel: join(toolsDir, 'models/face_detection_yunet_2023mar.onnx'),
  ffmpeg: 'ffmpeg',
  sdBin: join(toolsDir, 'sd/bin/sd-cli'),
  genModels: join(toolsDir, 'models/gen'),
  voicePython: join(toolsDir, 'voice/bin/python'),
  kokoroModels: join(toolsDir, 'models/kokoro'),
  node: process.execPath,
  renderDir: join(toolsDir, 'render'),
});

const log = (message: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${message}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** File extensions the tools need on their outputs (FFmpeg picks the container from it). */
const EXT: Record<string, string> = { project: '.tar', json: '.json', vocals: '.wav', rest: '.wav', mask: '.mp4', audio: '.wav', video: '.mp4', image: '.png', job: '.json', reference: '.wav', wav: '.wav' };

async function loadConfig(): Promise<Config> {
  try {
    return JSON.parse(await readFile(configFile, 'utf8')) as Config;
  } catch {
    throw new Error(`Not paired yet: run "worker pair --server <address> --code <code>" (the code is in Settings → Compute on the laptop).`);
  }
}

async function pair(args: string[]) {
  const get = (flag: string) => args[args.indexOf(flag) + 1];
  const server = get('--server')?.replace(/\/+$/, '');
  const code = get('--code');
  const name = (args.includes('--name') ? get('--name') : hostname()) || 'Worker';
  if (!server || !code) throw new Error('Usage: worker pair --server https://laptop.tailnet.ts.net --code XXXX-XXXX-XXXX [--name "Desktop"]');
  const res = await fetch(`${/^https?:\/\//.test(server) ? server : `https://${server}`}/api/auth/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, name, worker: true }),
  });
  const body = (await res.json().catch(() => ({}))) as { token?: string; error?: string };
  if (!res.ok || !body.token) throw new Error(body.error ?? `The laptop answered ${res.status}.`);
  await mkdir(dataDir, { recursive: true });
  await writeFile(configFile, JSON.stringify({ server: /^https?:\/\//.test(server) ? server : `https://${server}`, token: body.token, name } satisfies Config), { mode: 0o600 });
  log(`Paired as “${name}”. Start it with: worker run`);
}

type Probe = { gpu: string; cuda: boolean; whisper: boolean; demucs: boolean; matte: boolean; speakers: boolean; matteMsPerFrame: number | null };

/** What this machine can run: the self-test script, run once at start. */
async function capabilities(): Promise<{ tools: ComputeTool[]; gpu: string; speed: WorkerReport['speed'] }> {
  const m = machine();
  if (!existsSync(m.toolsPython)) throw new Error(`The tools aren't installed (no ${m.toolsPython}): run scripts/setup-worker.sh.`);
  const { bin, args } = commandFor('probe', {}, {}, m);
  const { stdout } = await run(bin, args, { timeout: 120_000 });
  const p = JSON.parse(stdout.trim().split('\n').pop() ?? '{}') as Probe;
  const tools: ComputeTool[] = [];
  if (p.whisper) tools.push('transcribe');
  if (p.demucs) tools.push('separate');
  if (p.matte && existsSync(m.matteModel)) tools.push('matte');
  if (p.speakers && existsSync(m.yunetModel)) tools.push('speakers');
  // Set up by setup-worker.sh --with image,video,voice: each writes its marker once its models are in place.
  if (existsSync(m.sdBin) && existsSync(join(m.genModels, '.image-ready'))) tools.push('image');
  if (existsSync(m.sdBin) && existsSync(join(m.genModels, '.video-ready'))) tools.push('video');
  if (existsSync(m.voicePython) && existsSync(join(toolsDir, 'voice/.ready'))) tools.push('speak');
  if (existsSync(join(m.renderDir, 'render.mjs')) && existsSync(join(m.renderDir, '.ready'))) tools.push('render');
  return { tools, gpu: p.gpu || '', speed: { matteMsPerFrame: p.matteMsPerFrame, cuda: p.cuda } };
}

const headers = (c: Config) => ({ authorization: `Bearer ${c.token}` });

async function api<T>(c: Config, path: string, body: unknown, timeoutMs = 30_000): Promise<T> {
  const res = await fetch(`${c.server}${path}`, { method: 'POST', headers: { ...headers(c), 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  if (res.status === 401 || res.status === 403) throw new Error('The laptop no longer accepts this worker (it was removed?). Pair it again.');
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return (await res.json()) as T;
}

async function download(c: Config, task: WorkerTask, name: string, to: string) {
  const res = await fetch(`${c.server}/api/worker/tasks/${task.id}/inputs/${name}`, { headers: headers(c) });
  if (!res.ok || !res.body) throw new Error(`Couldn’t get ${name}: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(to));
}

async function upload(c: Config, task: WorkerTask, name: string, from: string) {
  const size = (await stat(from)).size;
  const res = await fetch(`${c.server}/api/worker/tasks/${task.id}/outputs/${name}`, {
    method: 'PUT',
    headers: { ...headers(c), 'content-type': 'application/octet-stream', 'content-length': String(size) },
    body: Readable.toWeb(createReadStream(from)) as never,
    duplex: 'half',
  } as RequestInit);
  if (!res.ok) throw new Error(`Couldn’t send ${name}: ${res.status}`);
}

/** Run the tool on the files; resolves with its stdout. Progress (and a heartbeat) goes to the laptop every few seconds. */
function runCommand(task: WorkerTask, files: Record<string, string>, c: Config) {
  const { bin, args } = commandFor(task.tool, files, task.params, machine());
  return new Promise<string>((resolve, reject) => {
    const child = spawn(bin, args, { env: { ...process.env, PYTHONUNBUFFERED: '1' } });
    let out = '';
    let err = '';
    let last = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), task.timeoutMs);
    // The laptop answers ok: false once it no longer wants the task (cancelled): stop the tool then.
    const beat = setInterval(
      () =>
        void api<{ ok: boolean }>(c, `/api/worker/tasks/${task.id}/progress`, { text: last || 'Working…' })
          .then((r) => {
            if (r.ok === false && child.exitCode === null) {
              log(`${tool(task.tool)}: cancelled by the laptop`);
              child.kill('SIGTERM');
            }
          })
          .catch(() => {}),
      task.tool === 'render' ? 3000 : 8000,
    );
    let progressLines = false;
    const onLine = (chunk: Buffer, keep: boolean) => {
      const text = chunk.toString();
      if (keep) out += text;
      else err = (err + text).slice(-4000);
      const lines = text.trim().split('\n');
      // A tool that reports "@progress …" lines (a render) is followed by those alone, not its other logging.
      const marked = lines.filter((l) => l.startsWith('@progress ')).pop();
      if (marked) progressLines = true;
      const line = marked ?? (progressLines ? undefined : lines.pop());
      if (line && !/^\s*\{/.test(line)) last = line.slice(0, 200);
    };
    child.stdout.on('data', (d: Buffer) => onLine(d, true));
    child.stderr.on('data', (d: Buffer) => onLine(d, false));
    child.on('error', reject);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      clearInterval(beat);
      if (code === 0) resolve(out);
      else reject(new Error(err.trim().split('\n').pop() || `${tool(task.tool)} stopped (${signal ?? `exit ${code}`})`));
    });
  });
}
const tool = (t: ComputeTool) => TOOL_INFO[t].label;

/** The laptop picks the tool and its settings; only plain values are accepted (never anything that reads as a flag). */
function checkParams(task: WorkerTask) {
  const { model, fps, prompt, negative, width, height, seed, frames } = task.params;
  const int = (v: unknown, min: number, max: number) => v === undefined || (Number.isInteger(v) && (v as number) >= min && (v as number) <= max);
  if (model !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,40}$/.test(model)) throw new Error('Refused: an odd model name.');
  if (fps !== undefined && !(typeof fps === 'number' && fps > 0 && fps <= 60)) throw new Error('Refused: an odd frame rate.');
  // Prompts reach the generator as one argument each (`--prompt=…`), never through a shell.
  for (const text of [prompt, negative]) if (text !== undefined && (typeof text !== 'string' || text.length > 2000 || /[\u0000-\u0008\u000b-\u001f]/.test(text))) throw new Error('Refused: an odd prompt.');
  if (!int(width, 64, 2048) || !int(height, 64, 2048) || !int(seed, 0, 2 ** 31) || !int(frames, 1, 161)) throw new Error('Refused: an odd size, seed or length.');
  if (task.tool === 'probe' || !(task.tool in TOOL_INFO)) throw new Error('Refused: not a tool a worker runs.');
}

async function runTask(c: Config, task: WorkerTask) {
  log(`${tool(task.tool)}: started`);
  const dir = await mkdtemp(join(tmpdir(), 'cs-worker-'));
  try {
    checkParams(task);
    const files: Record<string, string> = {};
    for (const i of task.inputs) {
      files[i.name] = join(dir, `${i.name}${EXT[i.name] ?? ''}`);
      await download(c, task, i.name, files[i.name]);
    }
    for (const name of task.outputs) files[name] = join(dir, `${name}${EXT[name] ?? ''}`);
    const stdout = await runCommand(task, files, c);
    for (const name of task.outputs) await upload(c, task, name, files[name]);
    await api(c, `/api/worker/tasks/${task.id}/done`, { ok: true, stdout: TOOL_INFO[task.tool].stdout ? stdout : undefined });
    log(`${tool(task.tool)}: done`);
  } catch (err) {
    log(`${tool(task.tool)}: failed: ${(err as Error).message}`);
    await api(c, `/api/worker/tasks/${task.id}/done`, { ok: false, message: (err as Error).message.slice(0, 1500) }).catch(() => {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'pair') return pair(args);
  if (command !== 'run') {
    console.log('Usage:\n  worker pair --server <address> --code <code> [--name <name>]\n  worker run');
    return;
  }
  const c = await loadConfig();
  const caps = await capabilities();
  // The text model this PC hosts, as the laptop reaches it (set by setup-worker.sh --with llm).
  const llmUrl = process.env.CS_LLM_URL?.replace(/\/+$/, '') || '';
  log(`${c.name}: ${caps.gpu || 'no GPU'}; tools: ${caps.tools.join(', ') || 'none (run scripts/setup-worker.sh)'}${caps.speed?.matteMsPerFrame ? `; matte ${caps.speed.matteMsPerFrame} ms/frame` : ''}${llmUrl ? `; text model at ${llmUrl}` : ''}`);
  let busy = false;
  for (;;) {
    try {
      const report: WorkerReport = { name: c.name, gpu: caps.gpu, tools: caps.tools, busy, speed: caps.speed ?? undefined, llm: llmUrl ? { url: llmUrl } : undefined };
      const { task } = await api<{ task: WorkerTask | null }>(c, '/api/worker/poll', report, 45_000);
      if (task) {
        busy = true;
        await runTask(c, task);
        busy = false;
      }
    } catch (err) {
      log(`${(err as Error).message}; trying again in 10 s`);
      if (/no longer accepts/.test((err as Error).message)) process.exit(1);
      await sleep(10_000);
    }
  }
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
