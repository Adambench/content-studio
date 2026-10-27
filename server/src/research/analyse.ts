// Analysing one video: a link (YouTube, TikTok, Instagram, fetched with yt-dlp) or a video in the library. The
// numbers are measured (length, cuts per second from FFmpeg's scene detection, words per second from the captions or
// Whisper); Claude looks at the transcript, four frames and those numbers and explains the hook, structure and edit,
// and what the page can borrow. It never copies the words.
import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { ResearchAnalysis } from '../../../shared/research';
import { KIND_INFO, type Transcript } from '../../../shared/types';
import { askStructured, type PromptImage } from '../claude/oneshot';
import { resolveModel } from '../claude/options';
import { playbook } from '../claude/plugin';
import { waitForUsage } from '../claude/usage';
import { run, youtubeCaptions, ytdlp } from '../campaigns/sources';
import { config } from '../config';
import { db, newId, now, schema } from '../db';
import { emit } from '../lib/events';
import { extractAudio, extractFrames, probe } from '../lib/ffmpeg';
import { badRequest } from '../lib/http';
import { getSetting } from '../lib/settings';
import { enqueue, JobError } from '../jobs/queue';
import { getMedia, mediaPath, readTranscript, whisperInstalled } from '../services/media';
import { getWorkspace } from '../services/pieces';
import { emitResearch, getItem, updateItem } from './research';
import { runTool } from '../compute/run';
import { hardCuts } from '../knowledge/measure';
import { downloadTiktok, tiktokPost } from './tiktok';

/** Which platform a pasted link is on, and the post's id there; null for anything else. */
export function postOf(url: string): { platform: 'youtube' | 'tiktok' | 'instagram'; id: string; url: string } | null {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//.test(url.trim()) ? url.trim() : `https://${url.trim()}`);
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\./, '');
  if (host === 'youtu.be' || host === 'youtube.com') {
    const id = host === 'youtu.be' ? u.pathname.slice(1).split('/')[0] : u.pathname === '/watch' ? u.searchParams.get('v') : /^\/(?:shorts|live|embed)\/([\w-]{11})/.exec(u.pathname)?.[1];
    return id && /^[\w-]{11}$/.test(id) ? { platform: 'youtube', id, url: `https://www.youtube.com/shorts/${id}` } : null;
  }
  if (host.endsWith('tiktok.com')) {
    const id = /\/(?:video|photo)\/(\d{8,})/.exec(u.pathname)?.[1];
    // Short share links (vm.tiktok.com/…) are followed by yt-dlp; their own path is the key until then.
    if (id) return { platform: 'tiktok', id, url: `https://www.tiktok.com${u.pathname.replace(/\/+$/, '')}` };
    if (/^(vm|vt)\./.test(u.hostname)) return { platform: 'tiktok', id: u.pathname.replace(/\//g, ''), url: u.toString() };
    return null;
  }
  if (host.endsWith('instagram.com')) {
    const code = /\/(?:reel|reels|p|tv)\/([\w-]{6,})/.exec(u.pathname)?.[1];
    return code ? { platform: 'instagram', id: code, url: `https://www.instagram.com/reel/${code}/` } : null;
  }
  return null;
}

/** Queue an analysis of a link or a library video (my click). One that's already been analysed is just returned. */
export function queueAnalysis(workspaceId: string, input: { url?: string; mediaId?: string }) {
  getWorkspace(workspaceId);
  let key: { platform: 'youtube' | 'tiktok' | 'instagram' | 'file'; id: string; url: string; title: string };
  if (input.mediaId) {
    const m = getMedia(input.mediaId);
    if (m.workspaceId !== workspaceId) throw badRequest('That video isn’t in this page’s library.');
    if (m.kind !== 'video') throw badRequest('Only videos can be analysed.');
    key = { platform: 'file', id: m.id, url: `media:${m.id}`, title: m.originalName };
  } else {
    const post = postOf(input.url ?? '');
    if (!post) throw badRequest('Paste a link to a YouTube Short or video, a TikTok or an Instagram reel.');
    key = { platform: post.platform, id: post.id, url: post.url, title: '' };
  }
  const existing = db
    .select()
    .from(schema.researchItems)
    .where(eq(schema.researchItems.workspaceId, workspaceId))
    .all()
    .find((r) => r.platform === key.platform && r.externalId === key.id);
  if (existing) {
    // An outlier from the sweep (or a failed analysis) gets analysed now.
    if (existing.analysisStatus === 'none' || existing.analysisStatus === 'error') {
      updateItem(existing.id, { analysisStatus: 'queued', analysisError: null });
      enqueue('research.analyse', { itemId: existing.id, workspaceId }, { maxAttempts: 2 });
    }
    return getItem(existing.id);
  }
  const id = newId();
  db.insert(schema.researchItems)
    .values({
      id,
      workspaceId,
      platform: key.platform,
      externalId: key.id,
      url: key.url,
      title: key.title,
      source: input.mediaId ? 'library' : 'link',
      mediaId: input.mediaId ?? null,
      analysisStatus: 'queued',
      firstSeenAt: now(),
      lastSeenAt: now(),
    })
    .run();
  enqueue('research.analyse', { itemId: id, workspaceId }, { maxAttempts: 2 });
  emitResearch(workspaceId);
  return getItem(id);
}

type YtInfo = { title?: string; description?: string; view_count?: number; like_count?: number; comment_count?: number; channel?: string; uploader?: string; uploader_id?: string; channel_url?: string; uploader_url?: string; timestamp?: number; duration?: number };

/** A TikTok from its embed page, when yt-dlp is blocked. */
async function downloadFromEmbed(url: string, dir: string): Promise<{ file: string; info: YtInfo }> {
  const p = await tiktokPost(url);
  const file = await downloadTiktok(p.videoUrl, join(dir, 'video.mp4'));
  return { file, info: { title: p.caption, channel: p.handle ? `@${p.handle}` : p.name, uploader_url: p.handle ? `https://www.tiktok.com/@${p.handle}` : undefined, view_count: p.views ?? undefined, timestamp: p.postedAt ? p.postedAt / 1000 : undefined } };
}

/** A post's video (720p at most) and what yt-dlp says about it, into `dir`. Also used for references. */
export async function downloadPost(url: string, dir: string) {
  const y = ytdlp();
  const out = await run(
    y.bin,
    [...y.args, '-j', '--no-simulate', '--no-playlist', '-f', 'bv*[height<=720]+ba/b[height<=720]/bv*+ba/b', '--merge-output-format', 'mp4', '-o', join(dir, 'video.%(ext)s'), url],
    { env: y.env, timeoutMs: 10 * 60_000 },
  ).catch(async (err: Error) => {
    if (postOf(url)?.platform === 'tiktok') return null;
    throw new JobError(`Couldn’t fetch the video: ${err.message}`, { retry: false });
  });
  if (out === null) return downloadFromEmbed(url, dir).catch((err: Error) => {
    throw new JobError(`Couldn’t fetch the TikTok: ${err.message}`, { retry: false });
  });
  const info = JSON.parse(out.trim().split('\n').filter((l) => l.startsWith('{')).pop() ?? '{}') as YtInfo;
  const file = (await readdir(dir)).find((f) => f.startsWith('video.') && !f.endsWith('.part'));
  if (!file) throw new JobError('yt-dlp finished without a video.', { retry: false });
  return { file: join(dir, file), info };
}

/** What's said in a video, by Whisper (null when it isn't installed). */
export async function whisper(file: string, dir: string): Promise<Transcript | null> {
  if (!whisperInstalled()) return null;
  const wav = join(dir, 'audio.wav');
  const out = join(dir, 'transcript.json');
  await extractAudio(file, wav);
  await runTool('transcribe', { audio: wav, json: out }, { model: getSetting('whisperModel') ?? 'small' }, { timeoutMs: 20 * 60_000 });
  return JSON.parse(await readFile(out, 'utf8')) as Transcript;
}


const ANALYSIS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['hook', 'structure', 'edit', 'whyItWorks', 'takeaways', 'cautions'],
  properties: {
    hook: {
      type: 'object',
      additionalProperties: false,
      required: ['spoken', 'onScreen', 'visual', 'why'],
      properties: {
        spoken: { type: 'string', description: 'What is said in the first 2–3 seconds, briefly (quote at most a few words)' },
        onScreen: { type: 'string', description: 'The text on screen at the start, if any' },
        visual: { type: 'string', description: 'What the first frame shows and does' },
        why: { type: 'string', description: 'Why the opening stops the scroll, by the playbook' },
      },
    },
    structure: {
      type: 'array',
      maxItems: 8,
      items: { type: 'object', additionalProperties: false, required: ['at', 'what'], properties: { at: { type: 'string', description: 'mm:ss' }, what: { type: 'string' } } },
      description: 'The beats: setup, re-hooks, payoff, ending',
    },
    edit: {
      type: 'object',
      additionalProperties: false,
      required: ['pace', 'captions', 'visuals', 'sound'],
      properties: {
        pace: { type: 'string', description: 'How fast it cuts and talks, from the measured numbers' },
        captions: { type: 'string', description: 'Caption style and how much text is on screen' },
        visuals: { type: 'string', description: 'Framing, zooms, b-roll, graphics' },
        sound: { type: 'string', description: 'Voice and sound effects; if there is music, only say that it has music (the page never uses any)' },
      },
    },
    whyItWorks: { type: 'string', description: 'The main reasons it did well, in 2–3 sentences' },
    takeaways: { type: 'array', maxItems: 5, items: { type: 'string' }, description: 'What this page can borrow (formats and moves, never the words), each one line' },
    cautions: { type: 'array', items: { type: 'string' }, description: 'Music, haram content, claims that need checking; empty if none' },
  },
};

const INSTRUCTIONS = `You explain why a short vertical video works, for a creator who wants to learn from it for their own page. You get its details, the numbers measured from it (trust them; never invent numbers), its transcript with times, and four frames (start, about a quarter, half, near the end).

- Explain, don't copy: never write a script from it or reuse its lines. Takeaways are formats and moves the page can borrow, shaped for its niche.
- The page never uses music or musical instruments: if the video does, say so in cautions and in the sound notes, and never suggest copying it. Flag anything haram it shows or promotes.
- Plain, specific language.`;

/** The `research.analyse` job. */
export async function analyseItem({ itemId }: { itemId: string }) {
  const item = getItem(itemId);
  if (item.analysisStatus === 'done') return;
  try {
    await waitForUsage('research');
  } catch (err) {
    updateItem(itemId, { analysisStatus: 'queued', analysisError: (err as Error).message });
    throw err;
  }
  updateItem(itemId, { analysisStatus: 'running', analysisError: null });
  const ws = getWorkspace(item.workspaceId);
  const dir = join(config.tmpDir, `research-${itemId}`);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  try {
    let file: string;
    let transcript: Transcript | null = null;
    let info: YtInfo = {};
    if (item.mediaId) {
      const m = getMedia(item.mediaId);
      file = mediaPath(m);
      transcript = await readTranscript(m.id);
    } else {
      ({ file, info } = await downloadPost(item.url, dir));
      updateItem(itemId, {
        title: (info.title && !/^Video by /.test(info.title) ? info.title : info.description || item.title).slice(0, 500),
        views: info.view_count ?? item.views,
        channel: info.channel || info.uploader || item.channel,
        channelUrl: info.channel_url || info.uploader_url || item.channelUrl,
        postedAt: info.timestamp ? info.timestamp * 1000 : item.postedAt,
      });
      if (item.platform === 'youtube') transcript = await youtubeCaptions(item.url).catch(() => null);
    }
    const p = await probe(file);
    if (!p.hasVideo) throw new JobError('It has no picture to analyse.', { retry: false });
    if (!transcript && p.hasAudio) transcript = await whisper(file, dir).catch(() => null);
    const seconds = p.durationMs ? p.durationMs / 1000 : null;
    const cuts = await hardCuts(file)
      .then((c) => c.length)
      .catch(() => null);
    const words = transcript ? transcript.segments.flatMap((s) => s.words ?? []) : [];
    const wordCount = words.length || (transcript?.text.split(/\s+/).filter(Boolean).length ?? 0);
    const firstWords = (words.length ? words.filter((w) => w.start < 3.5).map((w) => w.word).join('') : (transcript?.segments[0]?.text ?? '')).replace(/\s+/g, ' ').trim().slice(0, 200);
    const metrics: ResearchAnalysis['metrics'] = {
      seconds: seconds !== null ? Math.round(seconds * 10) / 10 : null,
      cuts,
      cutsPerSecond: cuts !== null && seconds ? Math.round((cuts / seconds) * 100) / 100 : null,
      wordsPerSecond: wordCount && seconds ? Math.round((wordCount / seconds) * 10) / 10 : null,
      firstWords,
    };

    const length = seconds ?? 10;
    const times = [0.4, length * 0.25, length * 0.5, Math.max(0.5, length * 0.88)];
    const frames = await extractFrames(file, times, (i) => join(dir, `f${i}.jpg`), 640);
    const images: PromptImage[] = await Promise.all(frames.map(async (f) => ({ data: (await readFile(f)).toString('base64'), mediaType: 'image/jpeg' as const })));

    const lines = transcript
      ? transcript.segments
          .map((s) => `[${Math.floor(s.start / 60)}:${String(Math.floor(s.start % 60)).padStart(2, '0')}] ${s.text.trim()}`)
          .join('\n')
          .slice(0, 8000)
      : '(no speech found)';
    const fresh = getItem(itemId);
    const out = await askStructured<Omit<ResearchAnalysis, 'metrics'>>({
      task: 'research',
      system: [playbook('hooks', 'retention', 'packaging', 'sound-design', 'halal'), INSTRUCTIONS].filter(Boolean).join('\n\n'),
      prompt: [
        `# The page learning from it: ${ws.name} (${KIND_INFO[ws.kind].label.toLowerCase()})${ws.niche ? ` — ${ws.niche}` : ''}`,
        `# The video`,
        [
          fresh.platform !== 'file' && `Platform: ${fresh.platform}`,
          fresh.channel && `Account: ${fresh.channel}`,
          fresh.title && `Title or caption: “${fresh.title.slice(0, 400)}”`,
          fresh.views !== null && `Views: ${fresh.views.toLocaleString('en-GB')}${fresh.score ? ` (${fresh.score.toFixed(1)}× the account’s median)` : ''}`,
          info.like_count !== undefined && `Likes: ${info.like_count}`,
          info.comment_count !== undefined && `Comments: ${info.comment_count}`,
        ]
          .filter(Boolean)
          .join('\n'),
        `# Measured\nLength ${metrics.seconds ?? '?'} s · ${metrics.cuts ?? '?'} hard cuts (${metrics.cutsPerSecond ?? '?'} per second) · ${metrics.wordsPerSecond ?? '?'} words per second`,
        `# Transcript\n${lines}`,
      ].join('\n\n'),
      schema: ANALYSIS_SCHEMA,
      images,
      model: resolveModel(),
    });
    updateItem(itemId, { analysis: { ...out, metrics }, analysisStatus: 'done', analysisError: null });
    emit({ type: 'job', jobType: 'research.analyse', status: 'done', workspaceId: ws.id, message: 'The video’s analysis is ready' });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export function onAnalyseFailed({ itemId }: { itemId: string }, message: string) {
  try {
    const row = updateItem(itemId, { analysisStatus: 'error', analysisError: message.slice(0, 300) });
    emit({ type: 'job', jobType: 'research.analyse', status: 'error', workspaceId: row.workspaceId, message });
  } catch {
    /* deleted */
  }
}
