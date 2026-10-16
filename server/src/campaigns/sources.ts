// A campaign's source videos: added by link (a video, a channel or playlist, a Drive file or folder, a direct file) or
// uploaded, downloaded into sources/<campaign>/ (yt-dlp for YouTube, Twitch and Kick), then transcribed: YouTube's own
// captions when there are some (instant), Whisper otherwise.
import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { and, eq } from 'drizzle-orm';
import { canonicalLink, sourceKindOf, type SourceKind } from '../../../shared/campaigns';
import type { Transcript, TranscriptSegment, TranscriptWord } from '../../../shared/types';
import { config } from '../config';
import { db, newId, schema } from '../db';
import { findBinary } from '../lib/bin';
import { extractAudio, probe } from '../lib/ffmpeg';
import { badRequest } from '../lib/http';
import { getSetting } from '../lib/settings';
import { enqueue, JobError } from '../jobs/queue';
import { clipToolsInstalled, toolsEnv } from '../services/cliptools';
import { whisperInstalled, type UploadedFile } from '../services/media';
import { campaignDir, emitCampaign, getCampaignRow, getSource, pagesOf, updateSource, type SourceRow } from './campaigns';

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const VIDEO_PLATFORMS: SourceKind[] = ['youtube', 'twitch', 'kick'];
const MAX_LISTED = 30;

export const sourceFile = (s: Pick<SourceRow, 'campaignId' | 'fileName'>) => (s.fileName ? join(campaignDir(s.campaignId), s.fileName) : null);
export const sourceTranscriptPath = (s: Pick<SourceRow, 'campaignId' | 'id'>) => join(campaignDir(s.campaignId), `${s.id}.transcript.json`);
/** The scan's candidate windows (`source.scan`), which `source.pick` reads. */
export const sourceScanPath = (s: Pick<SourceRow, 'campaignId' | 'id'>) => join(campaignDir(s.campaignId), `${s.id}.scan.json`);

const exists = (id: string) => !!db.select({ id: schema.campaignSources.id }).from(schema.campaignSources).where(eq(schema.campaignSources.id, id)).get();

// ---------- yt-dlp ----------

/** yt-dlp needs a JavaScript runtime for YouTube: our own Node (the Electron binary runs as one with ELECTRON_RUN_AS_NODE). */
export function ytdlp() {
  const bin = findBinary('yt-dlp');
  if (!bin) throw new JobError('yt-dlp isn’t installed on this computer (pipx install yt-dlp, or your package manager).', { retry: false });
  const ffmpeg = findBinary('ffmpeg');
  return {
    bin,
    args: ['--js-runtimes', `node:${process.execPath}`, '--no-warnings', ...(ffmpeg ? ['--ffmpeg-location', dirname(ffmpeg)] : [])],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  };
}

/**
 * Stop a child and whatever it started: the standalone yt-dlp is a launcher that runs the real work in a second
 * process, which a plain kill would leave downloading. Children get their own process group so it can go at once.
 */
function killTree(child: ChildProcess) {
  try {
    if (child.pid) process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

export function run(bin: string, args: string[], opts: { env?: NodeJS.ProcessEnv; timeoutMs: number; onLine?: (line: string) => void; track?: string }) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(bin, args, { env: opts.env, detached: true });
    if (opts.track) running.set(opts.track, child);
    let out = '';
    let err = '';
    let partial = '';
    const timer = setTimeout(() => killTree(child), opts.timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      out += text;
      if (out.length > 50 * 1024 * 1024) out = out.slice(-1024 * 1024);
      if (opts.onLine) {
        const lines = (partial + text).split(/\r?\n|\r/);
        partial = lines.pop() ?? '';
        lines.forEach(opts.onLine);
      }
    });
    child.stderr.on('data', (chunk: Buffer) => (err = (err + chunk.toString()).slice(-4000)));
    child.on('error', reject);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (opts.track) running.delete(opts.track);
      if (code === 0) resolve(out);
      else reject(new Error(err.trim().split('\n').filter((l) => /ERROR|error/.test(l)).pop()?.replace(/^ERROR:\s*/, '') || `${basename(bin)} stopped (${signal ?? `exit ${code}`})`));
    });
  });
}

/** Downloads in flight, so deleting a source stops its download. */
const running = new Map<string, ChildProcess>();

type YtInfo = {
  _type?: string;
  id?: string;
  title?: string;
  duration?: number;
  webpage_url?: string;
  url?: string;
  ie_key?: string;
  language?: string;
  is_live?: boolean;
  live_status?: string;
  entries?: YtInfo[];
  subtitles?: Record<string, { ext: string; url: string }[]>;
  automatic_captions?: Record<string, { ext: string; url: string }[]>;
};

async function ytInfo(url: string, extra: string[] = []): Promise<YtInfo> {
  const y = ytdlp();
  // --no-playlist: a watch link copied from a playlist is that one video (channels and playlists still list).
  return JSON.parse(await run(y.bin, [...y.args, '-J', '--no-playlist', ...extra, url], { env: y.env, timeoutMs: 120_000 })) as YtInfo;
}

/** A channel's front page lists its tabs; its videos (or a Twitch channel's past broadcasts) are what we want. */
function listingUrl(url: string) {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\.|^m\./, '');
  if (host === 'youtube.com' && /^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)\/?$/.test(u.pathname)) return `https://www.youtube.com${u.pathname.replace(/\/$/, '')}/videos`;
  if (host.endsWith('twitch.tv') && /^\/[^/]+\/?$/.test(u.pathname)) return `https://www.twitch.tv${u.pathname.replace(/\/$/, '')}/videos?filter=archives`;
  return url;
}

// ---------- Google Drive ----------

const driveFileId = (url: string) => /\/file\/d\/([\w-]{10,})/.exec(url)?.[1] ?? new URL(url).searchParams.get('id');
const driveFolderId = (url: string) => /\/folders\/([\w-]{10,})/.exec(url)?.[1] ?? null;

/** A public folder's files, from Drive's simple embedded listing (no sign-in, no API key). */
async function listDriveFolder(folderId: string) {
  const res = await fetch(`https://drive.google.com/embeddedfolderview?id=${folderId}`, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw badRequest('That Drive folder isn’t shared publicly (anyone with the link can view).');
  const html = await res.text();
  const files: { id: string; title: string }[] = [];
  for (const m of html.matchAll(/<div class="flip-entry" id="entry-([\w-]+)"[\s\S]*?href="([^"]+)"[\s\S]*?<div class="flip-entry-title">([^<]*)<\/div>/g)) {
    if (m[2].includes('/folders/')) continue;
    files.push({ id: m[1], title: m[3].trim() });
  }
  return files;
}

// ---------- adding ----------

/** Add a source unless the campaign has that video already (then that one is returned). */
export function insertSource(campaignId: string, values: { kind: SourceKind; link: string | null; title?: string; durationMs?: number | null; status?: SourceRow['status'] }) {
  if (values.link) values = { ...values, link: canonicalLink(values.link) };
  if (values.link) {
    const dup = db
      .select()
      .from(schema.campaignSources)
      .where(and(eq(schema.campaignSources.campaignId, campaignId), eq(schema.campaignSources.link, values.link)))
      .get();
    if (dup) return dup;
  }
  const id = newId();
  db.insert(schema.campaignSources)
    .values({ id, campaignId, kind: values.kind, link: values.link, title: values.title?.slice(0, 300) ?? '', durationMs: values.durationMs ?? null, status: values.status ?? 'found' })
    .run();
  return getSource(id);
}

function queueDownload(s: SourceRow, values: Partial<SourceRow> = {}) {
  updateSource(s.id, { ...values, status: 'queued', progress: null, detail: '' });
  enqueue('source.download', { sourceId: s.id }, { maxAttempts: 3 });
}

/**
 * Get a source going: a single video is queued for download; a channel, playlist or Drive folder is listed instead
 * (its videos added as "not downloaded", to pick from) and the listing row itself goes away.
 */
export async function startSource(sourceId: string) {
  const s = getSource(sourceId);
  if (s.status !== 'found' && s.status !== 'error') return [s];
  // Downloaded already: what failed after (the transcript, or finding moments) is tried again.
  if (s.status === 'error' && s.fileName) {
    if (await readSourceTranscript(s)) queueScan(s.id);
    else {
      updateSource(s.id, { status: 'transcribing', detail: 'Waiting its turn' });
      enqueue('source.transcribe', { sourceId: s.id }, { maxAttempts: 2 });
    }
    return [getSource(s.id)];
  }
  if (!s.link) throw badRequest('This source has no link.');
  if (s.kind === 'drive') {
    const folder = driveFolderId(s.link);
    if (folder) {
      const files = await listDriveFolder(folder);
      if (!files.length) throw badRequest('That Drive folder has no files anyone with the link can see.');
      const added = files.slice(0, MAX_LISTED * 2).map((f) => insertSource(s.campaignId, { kind: 'drive', link: `https://drive.google.com/file/d/${f.id}/view`, title: f.title }));
      db.delete(schema.campaignSources).where(eq(schema.campaignSources.id, s.id)).run();
      emitCampaign(s.campaignId);
      return added;
    }
    if (!driveFileId(s.link)) throw badRequest('That isn’t a Drive file or folder link.');
    queueDownload(s);
    return [getSource(s.id)];
  }
  if (VIDEO_PLATFORMS.includes(s.kind)) {
    const info = await ytInfo(listingUrl(s.link), ['--flat-playlist', '--playlist-end', String(MAX_LISTED)]).catch((err: Error) => {
      throw badRequest(`yt-dlp couldn’t open it: ${err.message}`);
    });
    if (info._type === 'playlist') {
      const videos = (info.entries ?? []).filter((e) => e?.id && e._type !== 'playlist' && !/Tab$/.test(e.ie_key ?? '') && (e.webpage_url || e.url));
      if (!videos.length) throw badRequest('No videos found there.');
      const added = videos.map((e) =>
        insertSource(s.campaignId, { kind: sourceKindOf(e.webpage_url ?? e.url!), link: e.webpage_url ?? e.url!, title: e.title ?? '', durationMs: e.duration ? Math.round(e.duration * 1000) : null }),
      );
      db.delete(schema.campaignSources).where(eq(schema.campaignSources.id, s.id)).run();
      emitCampaign(s.campaignId);
      return added;
    }
    // A channel link on Kick (or a /live page) opens the stream that's on now, which would never finish downloading.
    if (info.is_live || info.live_status === 'is_live' || info.live_status === 'is_upcoming')
      throw badRequest('That’s a live stream. Add the link of a past broadcast (its VOD) once it has ended.');
    queueDownload(s, { title: info.title ?? s.title, durationMs: info.duration ? Math.round(info.duration * 1000) : s.durationMs });
    return [getSource(s.id)];
  }
  queueDownload(s);
  return [getSource(s.id)];
}

/** Add a link I pasted: a video starts downloading, a channel or folder lists its videos to pick from. */
export async function addSourceLink(campaignId: string, pasted: string) {
  getCampaignRow(campaignId);
  const link = canonicalLink(pasted);
  const existing = db
    .select()
    .from(schema.campaignSources)
    .where(and(eq(schema.campaignSources.campaignId, campaignId), eq(schema.campaignSources.link, link)))
    .get();
  if (existing) return startSource(existing.id);
  const s = insertSource(campaignId, { kind: sourceKindOf(link), link });
  try {
    return await startSource(s.id);
  } catch (err) {
    // A link that can't be opened isn't kept.
    db.delete(schema.campaignSources).where(eq(schema.campaignSources.id, s.id)).run();
    emitCampaign(campaignId);
    throw err;
  }
}

/** A file I uploaded: kept with the campaign's sources, then transcribed. */
export async function saveSourceUpload(campaignId: string, file: UploadedFile) {
  getCampaignRow(campaignId);
  const s = insertSource(campaignId, { kind: 'file', link: null, title: file.filename, status: 'downloading' });
  const ext = extname(file.filename).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.mp4';
  const dir = campaignDir(campaignId);
  await mkdir(dir, { recursive: true });
  const fileName = `${s.id}${ext}`;
  try {
    await pipeline(file.stream, createWriteStream(join(dir, fileName)));
  } catch (err) {
    await deleteSource(s.id);
    throw err;
  }
  await finishDownload(getSource(s.id), join(dir, fileName));
  return getSource(s.id);
}

/** Stop a source's download or transcript if one is running. */
export function stopSource(id: string) {
  const child = running.get(id);
  if (child) killTree(child);
}

/** At shutdown: their own process groups would otherwise outlive the app (the jobs start again next time). */
export function stopAllSources() {
  for (const child of running.values()) killTree(child);
}

export async function deleteSource(id: string) {
  const s = getSource(id);
  stopSource(id);
  db.delete(schema.campaignSources).where(eq(schema.campaignSources.id, id)).run();
  const dir = campaignDir(s.campaignId);
  const files = await readdir(dir).catch(() => [] as string[]);
  await Promise.all(files.filter((f) => f.startsWith(id)).map((f) => rm(join(dir, f), { recursive: true, force: true })));
  emitCampaign(s.campaignId);
}

// ---------- downloading ----------

/** The `source.download` job. */
export async function downloadSource({ sourceId }: { sourceId: string }) {
  if (!exists(sourceId)) return;
  const s = updateSource(sourceId, { status: 'downloading', progress: 0, detail: 'Starting' });
  const dir = campaignDir(s.campaignId);
  await mkdir(dir, { recursive: true });
  // Leftovers of an earlier attempt.
  for (const f of await readdir(dir)) if (f.startsWith(s.id)) await rm(join(dir, f), { recursive: true, force: true });

  let file: string;
  if (VIDEO_PLATFORMS.includes(s.kind)) file = await ytdlpDownload(s, dir);
  else if (s.kind === 'drive') {
    const id = driveFileId(s.link!);
    if (!id) throw new JobError('That isn’t a Drive file link.', { retry: false });
    file = await httpDownload(s, `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`, dir).catch((err: Error) => {
      // Drive sometimes answers with a page instead of the file (big files, quotas): gdown knows its ways round.
      if (!clipToolsInstalled()) throw err;
      return gdownFile(s, id, dir);
    });
  } else file = await httpDownload(s, s.link!, dir);
  if (!exists(sourceId)) return void (await rm(file, { force: true }));
  await finishDownload(getSource(sourceId), file);
}

/** Probe the file and queue its transcript. */
async function finishDownload(s: SourceRow, file: string) {
  const info = await probe(file).catch(() => null);
  if (!info?.hasVideo && !info?.hasAudio) {
    await rm(file, { force: true });
    throw new JobError('That isn’t a video or audio file.', { retry: false });
  }
  const { size } = await stat(file);
  updateSource(s.id, {
    fileName: basename(file),
    size,
    durationMs: info.durationMs ?? s.durationMs,
    status: info.hasAudio ? 'transcribing' : 'ready',
    progress: null,
    detail: info.hasAudio ? 'Waiting its turn' : 'No sound to transcribe',
  });
  if (info.hasAudio) enqueue('source.transcribe', { sourceId: s.id }, { maxAttempts: 2 });
}

const gb = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`);

function progressReporter(id: string) {
  let last = 0;
  return (progress: number, detail: string, force = false) => {
    const t = Date.now();
    if (!force && t - last < 2000) return;
    last = t;
    if (exists(id)) updateSource(id, { progress: Math.max(0, Math.min(1, progress)), detail });
  };
}

async function ytdlpDownload(s: SourceRow, dir: string) {
  const y = ytdlp();
  const report = progressReporter(s.id);
  let part = 0;
  let lastFraction = 0;
  let file = '';
  await run(
    y.bin,
    [
      ...y.args,
      '-f',
      'bv*+ba/b',
      '-S',
      'res:1080,vcodec:h264',
      '--merge-output-format',
      'mp4',
      '--no-playlist',
      '--newline',
      // --print (below) makes yt-dlp quiet, which also hides the progress lines; this brings them back.
      '--progress',
      '-o',
      join(dir, `${s.id}.%(ext)s`),
      '--progress-template',
      'download:CSPROGRESS %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s',
      '--print',
      'after_move:CSFILE %(filepath)s',
      s.link!,
    ],
    {
      env: y.env,
      timeoutMs: 6 * 60 * 60 * 1000,
      track: s.id,
      onLine: (line) => {
        if (line.startsWith('CSFILE ')) file = line.slice(7).trim();
        const m = /^CSPROGRESS (\S+) (\S+) (\S+)/.exec(line);
        if (!m) return;
        const done = Number(m[1]);
        const total = Number(m[2]) || Number(m[3]);
        if (!total || !Number.isFinite(done)) return;
        const fraction = done / total;
        // Video and sound come down one after the other; the second starts again from 0.
        if (fraction < lastFraction - 0.5) part++;
        lastFraction = fraction;
        report(part ? 0.9 + fraction * 0.1 : fraction * 0.9, `${part ? 'Sound' : 'Video'}: ${gb(done)} of ${gb(total)}`);
      },
    },
  ).catch((err: Error) => {
    throw new JobError(`Download failed: ${err.message}`);
  });
  if (!file) file = join(dir, (await readdir(dir)).find((f) => f.startsWith(s.id) && !f.endsWith('.part')) ?? '');
  if (!file || !(await stat(file).catch(() => null))) throw new JobError('yt-dlp finished without a file.');
  return file;
}

/** A Drive file through gdown (in the clip tools), saved under its own name, then renamed to the source's id. */
async function gdownFile(s: SourceRow, id: string, dir: string) {
  const into = join(dir, `${s.id}.gdown`);
  await mkdir(into, { recursive: true });
  updateSource(s.id, { detail: 'Downloading from Drive (gdown)' });
  await run(config.toolsPython, ['-m', 'gdown', '--fuzzy', `https://drive.google.com/uc?id=${id}`, '-O', `${into}/`], { env: toolsEnv(), timeoutMs: 6 * 60 * 60 * 1000, track: s.id }).catch((err: Error) => {
    throw new JobError(`Drive wouldn’t give the file: ${err.message}`, { retry: false });
  });
  const name = (await readdir(into))[0];
  if (!name) throw new JobError('gdown finished without a file.', { retry: false });
  const file = join(dir, `${s.id}${extname(name).toLowerCase() || '.mp4'}`);
  await rename(join(into, name), file);
  await rm(into, { recursive: true, force: true });
  if (!s.title) updateSource(s.id, { title: name });
  return file;
}

const EXT_FOR: Record<string, string> = { 'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm', 'video/x-matroska': '.mkv', 'audio/mpeg': '.mp3', 'audio/mp4': '.m4a', 'audio/wav': '.wav' };

async function httpDownload(s: SourceRow, url: string, dir: string) {
  const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(6 * 60 * 60 * 1000) });
  const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
  if (!res.ok || !res.body) throw new JobError(`The file answered ${res.status}.`, { retry: res.status >= 500 });
  if (type === 'text/html')
    throw new JobError(s.kind === 'drive' ? 'Drive answered with a page, not the file: it isn’t shared with anyone who has the link, or it’s too big to scan and needs a sign-in.' : 'That link is a web page, not a video file.', { retry: false });
  const name = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers.get('content-disposition') ?? '')?.[1];
  const ext = (name ? extname(decodeURIComponent(name)) : '') || EXT_FOR[type] || extname(new URL(url).pathname) || '.mp4';
  const file = join(dir, `${s.id}${ext.toLowerCase()}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const report = progressReporter(s.id);
  let done = 0;
  const body = Readable.fromWeb(res.body as never);
  body.on('data', (chunk: Buffer) => {
    done += chunk.length;
    report(total ? done / total : 0, total ? `${gb(done)} of ${gb(total)}` : gb(done));
  });
  await pipeline(body, createWriteStream(file));
  if (name && !s.title) updateSource(s.id, { title: decodeURIComponent(name) });
  return file;
}

// ---------- transcripts ----------

/** The `source.transcribe` job: YouTube's captions when it has some, Whisper on the whole sound otherwise. */
export async function transcribeSource({ sourceId }: { sourceId: string }) {
  if (!exists(sourceId)) return;
  const s = updateSource(sourceId, { status: 'transcribing', detail: 'Reading captions' });
  const out = sourceTranscriptPath(s);
  let from: 'captions' | 'whisper' | null = null;
  if (s.kind === 'youtube' && s.link) {
    const t = await youtubeCaptions(s.link).catch((err: Error) => {
      console.warn(`[sources] no captions for ${s.link}: ${err.message}`);
      return null;
    });
    if (t) {
      await writeFile(out, JSON.stringify(t));
      from = 'captions';
    }
  }
  if (!from) {
    if (!whisperInstalled()) throw new JobError('Speech-to-text isn’t installed yet (Settings → Transcription).', { retry: false });
    const file = sourceFile(s);
    if (!file) throw new JobError('The video isn’t downloaded.', { retry: false });
    updateSource(sourceId, { detail: s.durationMs ? `Whisper is listening to ${Math.round(s.durationMs / 60000) || '<1'} min` : 'Whisper is listening' });
    const wav = join(config.tmpDir, `${sourceId}.wav`);
    try {
      await extractAudio(file, wav);
      await run(config.whisperPython, [join(config.scriptsDir, 'transcribe.py'), wav, '--out', out, '--model', getSetting('whisperModel') ?? 'small'], { timeoutMs: 10 * 60 * 60 * 1000, track: sourceId });
    } finally {
      await rm(wav, { force: true });
    }
    from = 'whisper';
  }
  if (!exists(sourceId)) return;
  updateSource(sourceId, { transcriptFrom: from });
  // An active campaign's source goes on to be scanned for moments; otherwise it waits, ready, for "Find moments".
  const c = getCampaignRow(s.campaignId);
  if (c.status === 'active' && pagesOf([c.id]).get(c.id)?.length) queueScan(sourceId);
  else updateSource(sourceId, { status: 'ready', detail: '' });
}

/** Find moments in a transcribed source: the scan (no Claude), then one Claude request (`source.pick`). */
export function queueScan(sourceId: string) {
  updateSource(sourceId, { status: 'scanning', progress: null, detail: 'Waiting its turn' });
  enqueue('source.scan', { sourceId }, { maxAttempts: 2 });
}

export function onSourceFailed({ sourceId }: { sourceId: string }, message: string) {
  if (exists(sourceId)) updateSource(sourceId, { status: 'error', progress: null, detail: message.slice(0, 300) });
}

type Json3 = { events?: { tStartMs?: number; dDurationMs?: number; segs?: { utf8?: string; tOffsetMs?: number }[] }[] };

/** YouTube's captions in the video's own language (made by hand if there are some, else automatic), as a transcript. */
export async function youtubeCaptions(link: string): Promise<Transcript | null> {
  const info = await ytInfo(link, ['--skip-download']);
  const lang = info.language ?? 'en';
  const pick = (tracks: YtInfo['subtitles'], keys: string[]) => {
    for (const k of keys) {
      const f = tracks?.[k]?.find((t) => t.ext === 'json3');
      if (f) return f.url;
    }
    return null;
  };
  const base = lang.split('-')[0];
  const url = pick(info.subtitles, [lang, base, ...Object.keys(info.subtitles ?? {}).filter((k) => k.startsWith(`${base}-`))]) ?? pick(info.automatic_captions, [`${base}-orig`, lang, base]);
  if (!url) return null;
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`captions answered ${res.status}`);
  return json3ToTranscript((await res.json()) as Json3, base, info.duration ?? 0);
}

export function json3ToTranscript(data: Json3, language: string, duration: number): Transcript | null {
  const segments: TranscriptSegment[] = [];
  for (const ev of data.events ?? []) {
    const segs = (ev.segs ?? []).filter((s) => s.utf8 && s.utf8.trim());
    if (!segs.length || ev.tStartMs === undefined) continue;
    const start = ev.tStartMs / 1000;
    const end = (ev.tStartMs + (ev.dDurationMs ?? 0)) / 1000;
    let words: TranscriptWord[];
    if (segs.some((s) => s.tOffsetMs !== undefined) || segs.length > 1) {
      // Automatic captions time each word.
      words = segs.map((s, i) => {
        const ws = start + (s.tOffsetMs ?? 0) / 1000;
        const next = segs[i + 1];
        const we = next ? start + (next.tOffsetMs ?? 0) / 1000 : end;
        return { start: round(ws), end: round(Math.max(ws + 0.05, we)), word: ` ${s.utf8!.trim()}` };
      });
    } else {
      // A hand-made line: spread its words over the line's time by length.
      const parts = segs[0].utf8!.replace(/\s+/g, ' ').trim().split(' ');
      const chars = parts.reduce((n, w) => n + w.length + 1, 0);
      let at = start;
      words = parts.map((w) => {
        const len = ((end - start) * (w.length + 1)) / chars;
        const word = { start: round(at), end: round(at + len), word: ` ${w}` };
        at += len;
        return word;
      });
    }
    const text = words.map((w) => w.word).join('').trim();
    if (text) segments.push({ start: round(start), end: round(Math.max(end, words.at(-1)!.end)), text, words });
  }
  if (!segments.length) return null;
  // Automatic captions roll: a line's window runs on under the next one. Clip it there so words don't overlap.
  for (let i = 0; i < segments.length - 1; i++) {
    const next = segments[i + 1].start;
    const seg = segments[i];
    if (seg.end <= next) continue;
    seg.end = Math.max(seg.start, next);
    for (const w of seg.words ?? []) {
      w.end = Math.min(w.end, Math.max(w.start, next));
    }
  }
  return { language, duration: duration || segments.at(-1)!.end, text: segments.map((s) => s.text).join(' '), segments };
}

const round = (n: number) => Math.round(n * 100) / 100;

/** A source's transcript, if it has one. */
export async function readSourceTranscript(s: Pick<SourceRow, 'campaignId' | 'id'>): Promise<Transcript | null> {
  try {
    return JSON.parse(await readFile(sourceTranscriptPath(s), 'utf8')) as Transcript;
  } catch {
    return null;
  }
}
