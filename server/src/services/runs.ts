// What starts Claude on a video: my message, Fix (my notes, all at once), an answer to its question, "go", or the
// last shared file landing ("Add & make"). Each is one run in the video's session; a second waits for the first.

import { z } from 'zod';
import { PAGE_MODES, type Job, type PageMode } from '../../../shared/types.ts';
import { all, get, run } from '../db/db.ts';
import { enqueue, listJobs } from '../jobs/queue.ts';
import { cancelJob } from '../jobs/runner.ts';
import { HttpError } from '../lib/util.ts';
import { onInputAdded } from './inputs.ts';
import { markSent, openNotes, reopenSent } from './notes.ts';
import { getPage } from './pages.ts';
import { addThread, getThreadItem, updateThreadData } from './thread.ts';
import { ensureSetup, getVideo } from './videos.ts';

const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

/** Files added since Claude last ran on this video, so the prompt can name them. */
function newFiles(videoId: string): string[] {
  const last = get<{ created_at: number }>("SELECT created_at FROM jobs WHERE video_id = ? AND kind = 'agent' ORDER BY created_at DESC LIMIT 1", videoId);
  return all<{ name: string }>('SELECT name FROM inputs WHERE video_id = ? AND created_at > ? ORDER BY position', videoId, last?.created_at ?? 0).map((r) => r.name);
}

/** A run with `prompt`, plus what changed since the last one (new files, the kind I asked for, a page's brief). */
export function go(videoId: string, prompt: string, opts: { background?: boolean } = {}): Job {
  const video = getVideo(videoId);
  const files = newFiles(videoId);
  const first = !get("SELECT 1 FROM jobs WHERE video_id = ? AND kind = 'agent'", videoId);
  const parts = [prompt.trim()];
  // A page's first run always says what's known: the name (or none yet) and how far to build.
  if (first && video.kind === 'page' && !prompt.startsWith(KICKOFF)) parts.unshift(kickoff(video.pageId, 'mix'));
  if (files.length) parts.push(`New in files/: ${files.join(', ')}.`);
  if (first && video.kind !== 'auto' && video.kind !== 'page') parts.push(`It's meant to be: ${video.kind}.`);
  return enqueue('agent', { videoId, input: { prompt: parts.filter(Boolean).join('\n\n'), ...(opts.background && { background: true }) } });
}

const messageInput = z.object({ text: z.string().trim().min(1).max(20_000) });

/** My message: in the thread at once, then Claude. */
export function sendMessage(videoId: string, input: unknown): Job {
  const { text } = messageInput.parse(input);
  getVideo(videoId);
  addThread(videoId, 'you', text);
  return go(videoId, text);
}

/** "Go" with nothing to say: the files are in, make it (or, in a page's setup, set the page up from them). */
export function goNow(videoId: string): Job {
  addThread(videoId, 'you', 'Go');
  return go(videoId, getVideo(videoId).kind === 'page' ? 'Go: set it up from what is in files/.' : 'Go: make it from what is in files/ (and the script, if there is one).');
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

/** "Add & make" (from the phone, or a new page with samples): start once `count` more files are in, with `prompt`. */
export function makeWhenUploaded(videoId: string, count: number, prompt?: string) {
  getVideo(videoId);
  const have = get<{ c: number }>('SELECT COUNT(*) AS c FROM inputs WHERE video_id = ?', videoId)?.c ?? 0;
  run('UPDATE videos SET make_at_inputs = ?, make_prompt = ? WHERE id = ?', have + Math.max(1, count), prompt ?? null, videoId);
  checkMakeAt(videoId);
}

function checkMakeAt(videoId: string) {
  const v = get<{ make_at_inputs: number | null; make_prompt: string | null }>('SELECT make_at_inputs, make_prompt FROM videos WHERE id = ?', videoId);
  if (!v?.make_at_inputs) return;
  const have = get<{ c: number }>('SELECT COUNT(*) AS c FROM inputs WHERE video_id = ?', videoId)?.c ?? 0;
  if (have < v.make_at_inputs) return;
  run('UPDATE videos SET make_at_inputs = NULL, make_prompt = NULL WHERE id = ?', videoId);
  addThread(videoId, 'sys', 'Everything I sent is in');
  go(videoId, v.make_prompt ?? 'Everything I shared from my phone is in files/. Make it.');
}

const MODES: Record<PageMode, string> = {
  mine: 'from what I gave: keep my name, look and voice as they are and build only what videos still need, in the same style. Don’t redesign anything',
  mix: 'a mix: keep what I gave and build the rest around it',
  fresh: 'scratch: build all of it; what I gave is inspiration, not something to keep',
};

const KICKOFF = 'Set this page up.';

function kickoff(pageId: string, mode: PageMode): string {
  const page = getPage(pageId);
  const named = page.name !== 'New page';
  return [KICKOFF, `Name: ${named ? `"${page.name}"` : 'none yet (suggest 3, then ask me)'}.`, `Start from ${MODES[mode]}.`].join('\n');
}

const setupInput = z.object({
  about: z.string().trim().max(20_000).default(''),
  mode: z.enum(PAGE_MODES).default('mix'),
  files: z.number().int().min(0).max(500).default(0),
  /** Not pressed for (pages set up in bulk): it waits for spare usage, one at a time. Files already in, not to come. */
  later: z.boolean().default(false),
});

/** A new page's first go: what I said (in the thread at once), how far to build, and my samples once they're in. */
export function startSetup(pageId: string, input: unknown) {
  const s = setupInput.parse(input ?? {});
  const setup = ensureSetup(pageId);
  addThread(setup.id, 'you', s.about || 'Set this page up from what I sent.', { mode: s.mode });
  const prompt = [kickoff(pageId, s.mode), s.about ? `What I said about it:\n${s.about}` : 'I said nothing about it: work from what I gave.'].join('\n');
  if (s.files) makeWhenUploaded(setup.id, s.files, prompt);
  else go(setup.id, prompt, { background: s.later });
  return getVideo(setup.id);
}

onInputAdded(checkMakeAt);
