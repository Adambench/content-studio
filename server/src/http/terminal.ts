// Claude Code itself in the browser, in a video's folder (`claude --resume`: the same session the app's thread uses,
// without the app's tools around it). Behind the app's own sign-in, over a WebSocket.
// Messages from the page are keystrokes, except "\u0000" + JSON ({"cols","rows"}) for a resize.

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import websocket from '@fastify/websocket';
import pty from '@lydell/node-pty';
import type { FastifyInstance } from 'fastify';
import { claudeEnv, studioSettings } from '../engine/claude.ts';
import { hyperframesEnv } from '../engine/render.ts';
import { findBinary } from '../lib/proc.ts';
import { getVideo } from '../services/videos.ts';

/** Claude Code's own binary: the one the Agent SDK ships (same version as the app's sessions), else one on PATH. */
function claudeBinary(): string | null {
  try {
    const pkg = createRequire(import.meta.url).resolve('@anthropic-ai/claude-agent-sdk-linux-x64/package.json');
    const bin = join(dirname(pkg), 'claude');
    if (existsSync(bin)) return bin;
  } catch {
    // Not installed for this platform.
  }
  return findBinary('claude');
}

const size = (v: unknown, fallback: number, max: number) => Math.max(10, Math.min(max, Number(v) || fallback));

export async function registerTerminal(app: FastifyInstance) {
  await app.register(websocket);
  app.get<{ Querystring: { videoId?: string; cols?: string; rows?: string } }>('/api/terminal', { websocket: true }, (socket, req) => {
    const q = req.query;
    let cwd: string;
    let file: string;
    let args: string[];
    try {
      const v = getVideo(q.videoId ?? '');
      const bin = claudeBinary();
      if (!bin) throw new Error('Claude Code isn’t installed on this machine');
      cwd = v.folder;
      file = bin;
      // The runs' settings (skills by name, early compacting), so the same session costs the same here.
      args = ['--settings', JSON.stringify(studioSettings()), ...(v.sessionId ? ['--resume', v.sessionId] : [])];
    } catch (err) {
      socket.send(`\r\n${err instanceof Error ? err.message : String(err)}\r\n`);
      socket.close();
      return;
    }
    const term = pty.spawn(file, args, {
      name: 'xterm-256color',
      cols: size(q.cols, 100, 400),
      rows: size(q.rows, 30, 200),
      cwd,
      env: { ...claudeEnv(), ...hyperframesEnv(), TERM: 'xterm-256color', COLORTERM: 'truecolor' },
    });
    term.onData((d) => socket.send(d));
    term.onExit(() => socket.close());
    socket.on('message', (raw: Buffer) => {
      const msg = raw.toString();
      if (msg.startsWith('\u0000')) {
        try {
          const r = JSON.parse(msg.slice(1)) as { cols?: number; rows?: number };
          term.resize(size(r.cols, 100, 400), size(r.rows, 30, 200));
        } catch {
          // A broken resize is ignored.
        }
        return;
      }
      term.write(msg);
    });
    socket.on('close', () => term.kill());
  });
}
