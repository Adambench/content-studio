// One GPU job at a time: renders (NVENC, Chrome capture) from every video take turns here, whoever asks.

let tail: Promise<unknown> = Promise.resolve();
let waiting = 0;

/** Run `fn` when the GPU is free. `onWait` hears how many are ahead while it waits. */
export function withGpu<T>(fn: () => Promise<T>, onWait?: (ahead: number) => void): Promise<T> {
  const ahead = waiting;
  waiting++;
  if (ahead > 0) onWait?.(ahead);
  const out = tail.then(fn, fn);
  tail = out.catch(() => undefined).finally(() => {
    waiting--;
  });
  return out;
}
