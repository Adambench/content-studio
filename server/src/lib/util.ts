import { randomBytes, randomUUID } from 'node:crypto';
import type { Entity, LiveEvent } from '../../../shared/types.ts';

export const newId = () => randomUUID();
export const newToken = () => randomBytes(32).toString('base64url');
export const now = () => Date.now();

/** An error with an HTTP status, for messages the user should see as they are. */
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found`);

// Live events: anything that changed, so every open screen refetches it. The SSE route coalesces bursts.
type Listener = (e: LiveEvent) => void;
const listeners = new Set<Listener>();

export function emit(entity: Entity, id: string, videoId?: string) {
  const event: LiveEvent = videoId ? { entity, id, videoId } : { entity, id };
  for (const l of listeners) {
    try {
      l(event);
    } catch {
      // A broken listener never stops the others.
    }
  }
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** A position between two neighbours (fractional ordering): no renumbering when something moves. */
export function between(before: number | null, after: number | null): number {
  if (before === null && after === null) return 1000;
  if (before === null) return after! - 1000;
  if (after === null) return before + 1000;
  return (before + after) / 2;
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

export const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));
