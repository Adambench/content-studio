// Claude Code on ai-server in the page (xterm.js over the app's WebSocket), in a video's folder.

import '@xterm/xterm/css/xterm.css';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { useEffect, useRef } from 'react';
import { wsUrl } from '@/lib/api';
import { cn } from '@/lib/utils';

export function TerminalView({ path, className }: { path: string; className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const term = new Terminal({
      fontFamily: '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 13,
      cursorBlink: true,
      allowProposedApi: false,
      theme: { background: '#0a0a0c', foreground: '#e4e4e7', cursor: '#e4e4e7', selectionBackground: '#3f3f46' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    fit.fit();
    const ws = new WebSocket(wsUrl(`${path}${path.includes('?') ? '&' : '?'}cols=${term.cols}&rows=${term.rows}`));
    ws.onmessage = (e) => term.write(typeof e.data === 'string' ? e.data : '');
    ws.onclose = () => term.write('\r\n\x1b[90m[closed]\x1b[0m\r\n');
    const input = term.onData((d) => ws.readyState === WebSocket.OPEN && ws.send(d));
    const resize = () => {
      fit.fit();
      if (ws.readyState === WebSocket.OPEN) ws.send(`\u0000${JSON.stringify({ cols: term.cols, rows: term.rows })}`);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    term.focus();
    return () => {
      ro.disconnect();
      input.dispose();
      ws.close();
      term.dispose();
    };
  }, [path]);
  return <div ref={box} className={cn('overflow-hidden rounded-xl border bg-[#0a0a0c] p-2', className)} data-terminal />;
}
