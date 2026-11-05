// Run one of the heavy tools (shared/compute.ts) on a free worker, or here. Callers pass the files by name and get
// the same result either way: the outputs written where they asked, and the tool's stdout.
import { join } from 'node:path';
import { COMPUTE_TOOLS, TOOL_INFO, commandFor, type ComputeTool, type MachinePaths, type ToolParams } from '../../../shared/compute';
import { JobError } from '../jobs/queue';
import { run } from '../campaigns/sources';
import { config } from '../config';
import { requireBinary } from '../lib/bin';
import { matteModel, toolsEnv, yunetModel } from '../services/cliptools';
import { runRemote } from './workers';

export { COMPUTE_TOOLS };

/** Where the tools are on this computer. */
export const localMachine = (): MachinePaths => ({
  scriptsDir: config.scriptsDir,
  toolsPython: config.toolsPython,
  whisperPython: config.whisperPython,
  matteModel: matteModel(),
  yunetModel: yunetModel(),
  ffmpeg: requireBinary('ffmpeg'),
  // Never used here: a render on this computer runs in the server's own render worker (studio/render.ts).
  node: process.execPath,
  renderDir: join(config.toolsDir, 'render'),
});

/** `local`: run it on this computer even when a worker has the tool (a worker's copy of a script is out of date). */
export type RunToolOptions = { timeoutMs: number; track?: string; onProgress?: (text: string) => void; local?: boolean };

/**
 * `files` maps the tool's input and output names to paths here. A worker with the tool takes it when one is online; a
 * lost worker or a failed remote run falls back to this computer, so a job never depends on a worker being up.
 */
export async function runTool(tool: ComputeTool, files: Record<string, string>, params: ToolParams, opts: RunToolOptions): Promise<string> {
  return (await runToolOn(tool, files, params, opts)).stdout;
}

/** `runTool`, and where it ran: a worker's name or 'laptop'. */
export async function runToolOn(tool: ComputeTool, files: Record<string, string>, params: ToolParams, opts: RunToolOptions): Promise<{ stdout: string; on: string }> {
  const remote = opts.local ? ({ ok: false, reason: 'no-worker', message: '' } as const) : await runRemote(tool, files, params, opts);
  if (remote.ok) return { stdout: remote.stdout, on: remote.on };
  if (remote.reason !== 'no-worker') console.warn(`[compute] ${tool} on a worker: ${remote.message}; running it here`);
  const { bin, args } = commandFor(tool, files, params, localMachine());
  const isWhisper = tool === 'transcribe';
  return { stdout: await run(bin, args, { env: isWhisper ? undefined : toolsEnv(), timeoutMs: opts.timeoutMs, track: opts.track, onLine: opts.onProgress }), on: 'laptop' };
}
