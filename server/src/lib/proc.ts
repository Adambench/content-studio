import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { homedir } from 'node:os';
import { config } from '../config.ts';

export type RunOptions = {
  cwd?: string;
  env?: Record<string, string | undefined>;
  signal?: AbortSignal;
  /** Each line the program writes (stdout and stderr), as it comes. */
  onLine?: (line: string, stream: 'stdout' | 'stderr') => void;
  input?: string;
  /** Keep at most this much of each stream in memory (the tail). */
  keep?: number;
};

export type RunResult = { code: number; stdout: string; stderr: string };

export class ProcError extends Error {
  code: number;
  stderr: string;
  constructor(cmd: string, code: number, stderr: string) {
    const tail = stderr.trim().split('\n').slice(-8).join('\n');
    super(`${cmd} failed (${code})${tail ? `: ${tail}` : ''}`);
    this.code = code;
    this.stderr = stderr;
  }
}

/** Run a program to the end; rejects with the tail of stderr when it fails. Arguments are never put in a shell. */
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(opts.signal.reason);
    const keep = opts.keep ?? 4_000_000;
    const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env, PATH: searchPath() }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const lines = { stdout: '', stderr: '' };
    const take = (stream: 'stdout' | 'stderr', chunk: Buffer) => {
      const text = chunk.toString('utf8');
      if (stream === 'stdout') stdout = (stdout + text).slice(-keep);
      else stderr = (stderr + text).slice(-keep);
      if (!opts.onLine) return;
      lines[stream] += text;
      const parts = lines[stream].split(/\r?\n|\r/);
      lines[stream] = parts.pop() ?? '';
      for (const p of parts) if (p) opts.onLine(p, stream);
    };
    child.stdout.on('data', (c: Buffer) => take('stdout', c));
    child.stderr.on('data', (c: Buffer) => take('stderr', c));
    const abort = () => child.kill('SIGTERM');
    opts.signal?.addEventListener('abort', abort, { once: true });
    child.on('error', (err) => {
      opts.signal?.removeEventListener('abort', abort);
      reject(err);
    });
    child.on('close', (code) => {
      opts.signal?.removeEventListener('abort', abort);
      if (opts.signal?.aborted) return reject(opts.signal.reason);
      if (code === 0) resolve({ code: 0, stdout, stderr });
      else reject(new ProcError(cmd.split('/').pop() ?? cmd, code ?? -1, stderr));
    });
    if (opts.input !== undefined) child.stdin.end(opts.input);
    else child.stdin.end();
  });
}

/**
 * Where programs are looked for: the engine's own tools first (FFmpeg, uv, Chrome's shell it installed), then
 * ~/.local/bin, then the normal PATH. A systemd service starts with a minimal PATH, so this matters.
 */
export function searchPath(): string {
  const extra = [join(config.toolsDir, 'bin'), join(homedir(), '.local/bin'), '/usr/local/bin', '/usr/bin', '/bin'];
  return [...extra, ...(process.env.PATH ?? '').split(delimiter)].filter((p, i, a) => p && a.indexOf(p) === i).join(delimiter);
}

const found = new Map<string, string | null>();

/** The full path of a program, or null when it isn't installed. `CS_<NAME>` overrides it. */
export function findBinary(name: string): string | null {
  const override = process.env[`CS_${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`];
  if (override) return override;
  if (found.has(name)) return found.get(name)!;
  let hit: string | null = null;
  for (const dir of searchPath().split(delimiter)) {
    const p = join(dir, name);
    if (existsSync(p)) {
      hit = p;
      break;
    }
  }
  found.set(name, hit);
  return hit;
}

export function requireBinary(name: string): string {
  const p = findBinary(name);
  if (!p) throw new Error(`${name} isn't installed (scripts/setup-server.sh installs it)`);
  return p;
}
