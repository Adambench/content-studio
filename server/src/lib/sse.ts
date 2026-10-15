import type { FastifyReply } from 'fastify';

/** Take over the response as a Server-Sent Events stream. */
export function openSse(reply: FastifyReply) {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    // Headers already set on the reply (CORS for the Android app) still apply after hijacking.
    ...(reply.getHeaders() as Record<string, string>),
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Stop proxies from buffering the stream.
    'X-Accel-Buffering': 'no',
  });
  res.write(': connected\n\n');
  const heartbeat = setInterval(() => !res.destroyed && res.write(': ping\n\n'), 20_000);
  let closed = false;
  res.on('close', () => {
    closed = true;
    clearInterval(heartbeat);
  });
  return {
    send(data: unknown) {
      if (!closed && !res.destroyed) res.write(`data: ${JSON.stringify(data)}\n\n`);
    },
    end() {
      clearInterval(heartbeat);
      if (!res.destroyed) res.end();
    },
    get closed() {
      return closed;
    },
    onClose(fn: () => void) {
      res.on('close', fn);
    },
  };
}
