// Files from this browser to a video, one at a time (the line to ai-server is the limit, not the count), with
// progress, and something to do once a batch is in (the go I gave when I dropped them). The Android shell uses its
// own background queue instead (native.ts).

import { useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { uploadFile } from './api';
import { keys, queryClient } from './queries';

export type Upload = { id: number; videoId: string; name: string; size: number; fraction: number; state: 'waiting' | 'uploading' | 'done' | 'failed'; error: string | null };

let list: Upload[] = [];
const listeners = new Set<() => void>();
const set = (next: Upload[]) => {
  list = next;
  for (const l of listeners) l();
};
const patch = (id: number, p: Partial<Upload>) => set(list.map((u) => (u.id === id ? { ...u, ...p } : u)));

let seq = 0;
const files = new Map<number, File>();
const after: { videoId: string; ids: number[]; fn: () => void }[] = [];
let running = false;

async function pump() {
  if (running) return;
  running = true;
  try {
    for (let next = list.find((u) => u.state === 'waiting'); next; next = list.find((u) => u.state === 'waiting')) {
      const u = next;
      patch(u.id, { state: 'uploading' });
      try {
        await uploadFile(u.videoId, files.get(u.id)!, null, (fraction) => patch(u.id, { fraction }));
        patch(u.id, { state: 'done', fraction: 1 });
      } catch (err) {
        patch(u.id, { state: 'failed', error: err instanceof Error ? err.message : String(err) });
        toast.error(`${u.name} didn’t upload`);
      }
      files.delete(u.id);
      void queryClient.invalidateQueries({ queryKey: keys.video(u.videoId) });
      for (const a of [...after]) {
        if (a.ids.every((id) => list.find((x) => x.id === id)?.state === 'done')) {
          after.splice(after.indexOf(a), 1);
          a.fn();
        }
      }
    }
  } finally {
    running = false;
  }
  // Finished ones fade out of the list after a while.
  setTimeout(() => set(list.filter((u) => u.state !== 'done')), 4000);
}

/** Queue files for a video; `then` runs once all of them are in (not if one fails). */
export function uploadFiles(videoId: string, picked: File[], then?: () => void) {
  const added = picked.map((f) => {
    const id = ++seq;
    files.set(id, f);
    return { id, videoId, name: f.name, size: f.size, fraction: 0, state: 'waiting' as const, error: null };
  });
  if (then) after.push({ videoId, ids: added.map((a) => a.id), fn: then });
  set([...list, ...added]);
  void pump();
}

export function useUploads(videoId?: string): Upload[] {
  const all = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => list,
  );
  return videoId ? all.filter((u) => u.videoId === videoId) : all;
}
