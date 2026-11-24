// What starts Claude on a video: my message, Fix (my notes, all at once), an answer to its question, "go", or the
// last shared file landing ("Add & make"). Each is one run in the video's session; a second waits for the first.

import { z } from 'zod';
import type { Job } from '../../../shared/types.ts';
import { all, get, run } from '../db/db.ts';
import { enqueue, listJobs } from '../jobs/queue.ts';
import { cancelJob } from '../jobs/runner.ts';
import { HttpError } from '../lib/util.ts';
import { onInputAdded } from './inputs.ts';
import { markSent, openNotes, reopenSent } from './notes.ts';
import { addThread, getThreadItem, updateThreadData } from './thread.ts';
import { getVideo } from './videos.ts';

const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

/** Files added since Claude last ran on this video, so the prompt can name them. */
function newFiles(videoId: string): string[] {
  const last = get<{ created_at: number }>("SELECT created_at FROM jobs WHERE video_id = ? AND kind = 'agent' ORDER BY created_at DESC LIMIT 1", videoId);
  return all<{ name: string }>('SELECT name FROM inputs WHERE video_id = ? AND created_at > ? ORDER BY position', videoId, last?.created_at ?? 0).map((r) => r.name);
}

/** A run with `prompt`, plus what changed since the last one (new files, the kind I asked for). */
export function go(videoId: string, prompt: string): Job {
  const video = getVideo(videoId);
  const files = newFiles(videoId);
  const parts = [prompt.trim()];
  if (files.length) parts.push(`New in files/: ${files.join(', ')}.`);
  if (video.kind !== 'auto' && !get("SELECT 1 FROM jobs WHERE video_id = ? AND kind = 'agent'", videoId)) parts.push(`It's meant to be: ${video.kind}.`);
  return enqueue('agent', { videoId, input: { prompt: parts.filter(Boolean).join('\n\n') } });
}

const messageInput = z.object({ text: z.string().trim().min(1).max(20_000) });

/** My message: in the thread at once, then Claude. */
export function sendMessage(videoId: string, input: unknown): Job {
  const { text } = messageInput.parse(input);
  getVideo(videoId);
  addThread(videoId, 'you', text);
  return go(videoId, text);
}

/** "Go" with nothing to say: the files are in, make it. */
export function goNow(videoId: string): Job {
  addThread(videoId, 'you', 'Go');
  return go(videoId, 'Go: make it from what is in files/ (and the script, if there is one).');
}

/** Fix: every open note, at once, in one message. */
export function fixNotes(videoId: string): Job {
  const notes = openNotes(videoId);
  if (!notes.length) throw new HttpError(409, 'No open notes');
  markSent(notes.map((n) => n.id));
  const lines = notes.map((n) => `- [${n.id}] v${n.versionN} ${n.slide ? `slide ${n.slide}` : n.at != null ? `at ${fmt(n.at)}` : ''}: ${n.text}`);
  addThread(videoId, 'you', `Fix ${notes.length === 1 ? 'my note' : `my ${notes.length} notes`}`, { notes: notes.map((n) => n.id) });
  return go(
    videoId,
    `My notes (fix them all in one new version, check it, save it, then call notes_fixed with their ids; record a lesson for each general rule they teach, and change the skill or code behind it when it's general):\n${lines.join('\n')}`,
  );
}

const answerInput = z.object({ itemId: z.string(), option: z.number().int().min(0) });

/** My pick for Claude's question. */
export function answer(videoId: string, input: unknown): Job {
  const a = answerInput.parse(input);
  const q = getThreadItem(a.itemId);
  if (q.videoId !== videoId || q.kind !== 'question') throw new HttpError(400, 'Not a question here');
  if (q.data.picked != null) throw new HttpError(409, 'Already answered');
  const options = (q.data.options as string[]) ?? [];
  const pick = options[a.option];
  if (pick === undefined) throw new HttpError(400, 'No such option');
  updateThreadData(q.id, { picked: a.option });
  addThread(videoId, 'you', pick);
  return go(videoId, `To your question "${q.text}": ${pick}`);
}

/** Stop Claude on this video: the running run ends (and says so itself), queued ones go. Sent notes reopen. */
export function stop(videoId: string) {
  for (const j of listJobs({ videoId, active: true })) {
    if (j.kind !== 'agent') continue;
    const running = j.status === 'running';
    cancelJob(j.id);
    if (!running) {
      reopenSent(videoId);
      addThread(videoId, 'sys', 'Stopped');
    }
  }
}

/** "Add & make" from the phone: start once `count` more files are in. */
export function makeWhenUploaded(videoId: string, count: number) {
  getVideo(videoId);
  const have = get<{ c: number }>('SELECT COUNT(*) AS c FROM inputs WHERE video_id = ?', videoId)?.c ?? 0;
  run('UPDATE videos SET make_at_inputs = ? WHERE id = ?', have + Math.max(1, count), videoId);
  checkMakeAt(videoId);
}

function checkMakeAt(videoId: string) {
  const v = get<{ make_at_inputs: number | null }>('SELECT make_at_inputs FROM videos WHERE id = ?', videoId);
  if (!v?.make_at_inputs) return;
  const have = get<{ c: number }>('SELECT COUNT(*) AS c FROM inputs WHERE video_id = ?', videoId)?.c ?? 0;
  if (have < v.make_at_inputs) return;
  run('UPDATE videos SET make_at_inputs = NULL WHERE id = ?', videoId);
  addThread(videoId, 'sys', 'Everything I shared is in');
  go(videoId, 'Everything I shared from my phone is in files/. Make it.');
}

onInputAdded(checkMakeAt);
