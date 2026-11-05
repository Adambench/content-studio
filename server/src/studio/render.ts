import { execFile, fork } from 'node:child_process';
import { promisify } from 'node:util';
import { createWriteStream, existsSync } from 'node:fs';
import { copyFile, link, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { and, eq, inArray } from 'drizzle-orm';
import { EDIT_FORMATS, LOUDNESS_TARGET, clipLength, editDuration, normalizeEdit, transitionHandles, type EditSpec } from '../../../shared/edit';
import { allSounds } from '../../../shared/sound-design';
import { builtinSfx } from '../../../shared/sfx';
import { REVIEW_STAGE } from '../../../shared/types';
import { config } from '../config';
import { db, newId, now, schema } from '../db';
import { findBinary } from '../lib/bin';
import { emit } from '../lib/events';
import { cutSegment, gradeImage, normalizeLoudness, probe } from '../lib/ffmpeg';
import { checkCuts, exactPlan, handlePlay } from './exact-cuts';
import { badRequest, HttpError, notFound } from '../lib/http';
import { notify } from '../lib/push';
import { enqueue } from '../jobs/queue';
import { mediaPath, type MediaRow } from '../services/media';
import { getPiece, getWorkspace, type Author } from '../services/pieces';
import { ensureRenderer } from './browser';
import { BUNDLED_FONTS, composeEdit, type ComposeMedia, type ComposeSource } from './compose';
import { getEdit, saveEditVersion, specMedia, specTranscripts } from './edits';
import { followComments } from './notes';
import { makeProxy, proxyPath } from './proxy';
import type { WorkerMessage, WorkerRequest } from './worker';
import { RENDER_PROGRESS } from '../../../shared/compute';
import { runRemote, workerFor } from '../compute/workers';

const require = createRequire(import.meta.url);
const execFileP = promisify(execFile);
/** GSAP and the plugins compositions may use (scenes: eases, typing, motion paths, morphing, drawing, physics). */
export const GSAP_FILES = [
  'gsap.min.js',
  'CustomEase.min.js',
  'CustomWiggle.min.js',
  'CustomBounce.min.js',
  'EasePack.min.js',
  'TextPlugin.min.js',
  'MotionPathPlugin.min.js',
  'MorphSVGPlugin.min.js',
  'DrawSVGPlugin.min.js',
  'Physics2DPlugin.min.js',
];
export const gsapFilePath = (file: string) => require.resolve(`gsap/dist/${file}`);
export const runtimePath = () => require.resolve('@hyperframes/core/runtime');
/** One of the app's own sound effects (shared/sfx.ts). */
export const builtinSfxPath = (name: string) => join(config.assetsDir, 'sfx', `${name}.ogg`);

// The worker sits next to this file in development (TypeScript through tsx) and next to the bundle when built.
const here = fileURLToPath(import.meta.url);
const workerFile = here.endsWith('.ts') ? join(dirname(here), 'worker.ts') : join(dirname(here), 'render-worker.mjs');

export type RenderRow = typeof schema.renders.$inferSelect;

/** Renders in progress, so they can be cancelled. */
const running = new Map<string, AbortController>();

export function getRender(id: string) {
  const r = db.select().from(schema.renders).where(eq(schema.renders.id, id)).get();
  if (!r) throw notFound('Render not found');
  return r;
}

/** What else stops when a waiting render is cancelled (the quality check's fix, studio/quality.ts). */
export const onCancel = new Map<string, () => void>();

export function setRender(r: Pick<RenderRow, 'id' | 'workspaceId' | 'pieceId'>, values: Partial<RenderRow>) {
  db.update(schema.renders).set(values).where(eq(schema.renders.id, r.id)).run();
  emit({ type: 'changed', entity: 'renders', workspaceId: r.workspaceId, id: r.id, pieceId: r.pieceId });
}

/**
 * Snapshot the edit as a version (if it changed) and queue a render of exactly that version. `check`: the quality
 * check runs first (`edit.check`, studio/quality.ts), with Claude's fix when it's below the bar, then the render.
 */
export function queueRender(editId: string, by: Author, opts: { check?: boolean } = {}) {
  const edit = getEdit(editId);
  const spec = normalizeEdit(edit.working);
  if (!spec.clips.length) throw badRequest('Add some footage to the edit first.');
  const busy = db
    .select({ id: schema.renders.id })
    .from(schema.renders)
    .where(and(eq(schema.renders.editId, editId), inArray(schema.renders.status, ['queued', 'running'])))
    .get();
  if (busy) throw new HttpError(409, 'This edit is already rendering.');
  const { version } = saveEditVersion(editId, { author: by, message: 'Rendered' });
  const id = newId();
  db.insert(schema.renders)
    .values({
      id,
      workspaceId: edit.workspaceId,
      editId,
      pieceId: edit.pieceId,
      versionId: version.id,
      versionNumber: version.number,
      durationMs: Math.round(editDuration(spec) * 1000),
      stage: opts.check ? 'Checking quality' : 'Waiting',
    })
    .run();
  // One attempt: a failed render shows its reason; trying again is a click.
  if (opts.check) enqueue('edit.check', { renderId: id }, { maxAttempts: 1 });
  else enqueue('video.render', { renderId: id }, { maxAttempts: 1 });
  emit({ type: 'changed', entity: 'renders', workspaceId: edit.workspaceId, id, pieceId: edit.pieceId });
  return getRender(id);
}

/** Edits whose newest version renders as soon as the render running now stops (it was of an older version). */
const rerenderAfter = new Map<string, Author>();

/**
 * Render the edit as it is now, for Review: a render of an older version that's still waiting is dropped, and one
 * that's running is stopped and followed by this one, so Review never ends up on a version that's out of date.
 */
export function rerenderLatest(editId: string, by: Author) {
  const busy = db
    .select()
    .from(schema.renders)
    .where(and(eq(schema.renders.editId, editId), inArray(schema.renders.status, ['queued', 'running'])))
    .get();
  if (busy?.status === 'queued') setRender(busy, { status: 'cancelled', stage: 'Cancelled', finishedAt: now() });
  else if (busy && running.has(busy.id)) {
    rerenderAfter.set(editId, by);
    running.get(busy.id)!.abort();
    return;
  }
  try {
    queueRender(editId, by);
  } catch {
    /* nothing to render */
  }
}

export function cancelRender(id: string) {
  const r = getRender(id);
  if (r.status === 'queued') setRender(r, { status: 'cancelled', stage: 'Cancelled', finishedAt: now() });
  onCancel.get(id)?.();
  running.get(id)?.abort();
}

async function linkOrCopy(src: string, dest: string) {
  await link(src, dest).catch(() => copyFile(src, dest));
}

const composeMedia = (rows: MediaRow[]) =>
  new Map<string, ComposeMedia>(rows.map((m) => [m.id, { id: m.id, kind: m.kind, assetType: m.assetType, width: m.width, height: m.height, durationMs: m.durationMs }]));

/** The 'video.render' job: cut and grade the footage, render the composition with HyperFrames, balance loudness, save. */
export async function renderJob({ renderId }: { renderId: string }) {
  const r = db.select().from(schema.renders).where(eq(schema.renders.id, renderId)).get();
  if (!r || r.status === 'cancelled' || r.status === 'done') return;
  const abort = new AbortController();
  running.set(r.id, abort);
  const dir = join(config.rendersDir, r.id);
  const started = Date.now();
  let lastEmit = 0;
  const progress = (value: number, stage: string) => {
    const t = Date.now();
    if (t - lastEmit < 700 && value < 1) {
      db.update(schema.renders).set({ progress: value, stage }).where(eq(schema.renders.id, r.id)).run();
      return;
    }
    lastEmit = t;
    setRender(r, { progress: Math.min(1, value), stage });
  };
  let logTail = '';

  try {
    setRender(r, { status: 'running', progress: 0, stage: 'Getting ready', error: null });
    const version = r.versionId ? db.select().from(schema.editVersions).where(eq(schema.editVersions.id, r.versionId)).get() : undefined;
    const spec: EditSpec = normalizeEdit(version?.spec ?? getEdit(r.editId).working);
    const piece = getPiece(r.pieceId);
    const chrome = workerFor('render') ? null : await ensureRenderer((f) => progress(0.05 * f, 'Downloading the video renderer (first time only)'));

    await rm(dir, { recursive: true, force: true });
    await mkdir(join(dir, 'media'), { recursive: true });
    await mkdir(join(dir, 'fonts'), { recursive: true });
    const rows = specMedia(spec);
    const byId = new Map(rows.map((m) => [m.id, m]));
    const transcripts = await specTranscripts(spec, rows);
    const box = EDIT_FORMATS[spec.format];

    let lut: { file: string; intensity: number } | null = null;
    const lutRow = spec.grade.lutMediaId ? byId.get(spec.grade.lutMediaId) : undefined;
    if (lutRow && spec.grade.intensity > 0) {
      await copyFile(mediaPath(lutRow), join(dir, 'grade.cube'));
      lut = { file: 'grade.cube', intensity: spec.grade.intensity };
    }

    // Cuts exact to the frame: each video's camera changes (scanned once and kept) split the framing where a shot
    // changes, and a sliver of another shot beside a cut holds the frame next to it (studio/exact-cuts.ts).
    progress(0.02, 'Finding the camera changes');
    let plan = await exactPlan(spec);
    if (plan.changes.length) console.log(`[render] ${r.id} exact cuts: ${plan.changes.join('; ')}`);

    // Full-quality, graded segments for every shot (the preview uses lighter copies of whole files).
    const brolls = spec.overlays.map((o, i) => ({ o, i })).filter((x) => x.o.type === 'broll');
    let total = plan.clips.length + brolls.length;
    let done = 0;
    const picture = async (
      m: MediaRow,
      name: string,
      cut: { start: number; duration: number; zoom: number; whole?: { focusX: number; focusY: number } | null; audio: boolean; before?: number; after?: number; fadeIn?: number; fadeOut?: number; playFrom?: number; playTo?: number },
    ): Promise<ComposeSource> => {
      if (abort.signal.aborted) throw new Error('cancelled');
      progress(0.05 + 0.25 * (done / total), `Preparing footage ${done + 1} of ${total}`);
      done++;
      if (m.kind === 'image') {
        if (!existsSync(proxyPath(m))) await makeProxy({ mediaId: m.id });
        const out = join(dir, 'media', `${name}.jpg`);
        if (lut) await gradeImage(proxyPath(m), out, lut, dir);
        else await linkOrCopy(proxyPath(m), out);
        return { src: `media/${name}.jpg`, mediaStart: 0 };
      }
      const info = await probe(mediaPath(m));
      // Transitions need a little of the source either side of the clip (as much as the file has).
      const from = Math.max(0, cut.start - (cut.before ?? 0));
      const fileEnd = info.durationMs ? info.durationMs / 1000 : Infinity;
      const to = Math.min(fileEnd, cut.start + cut.duration + (cut.after ?? 0));
      const fades = cut.fadeIn || cut.fadeOut ? { at: cut.start - from, length: cut.duration, fadeIn: cut.fadeIn ?? 0, fadeOut: cut.fadeOut ?? 0 } : null;
      // The picture holds still where it would show another shot: a sliver beside the cut, or a transition's handle
      // that reaches past a camera change.
      const shots = plan.cuts.get(m.id);
      const span = { in: cut.start, out: cut.start + cut.duration, playFrom: cut.playFrom, playTo: cut.playTo };
      const play = shots ? handlePlay(span, from, to, shots.cuts, shots.fps) : cut.playFrom !== undefined || cut.playTo !== undefined ? { from: cut.playFrom ?? from, to: cut.playTo ?? to } : null;
      await cutSegment({ file: mediaPath(m), out: join(dir, 'media', `${name}.mp4`), info, start: from, duration: to - from, zoom: cut.zoom, whole: cut.whole, audio: cut.audio && info.hasAudio, fades, play, box, lut, cwd: dir, signal: abort.signal });
      return { src: `media/${name}.mp4`, mediaStart: Math.round((cut.start - from) * 1000) / 1000, duration: to - from, silent: !info.hasAudio, framed: !!cut.whole };
    };
    const brollSources: ComposeSource[] = [];
    for (const { o, i } of brolls) {
      if (o.type !== 'broll') continue;
      const m = byId.get(o.mediaId);
      brollSources[i] = m ? await picture(m, `o${i}`, { start: o.in, duration: o.end - o.start, zoom: 1, audio: false }) : null;
    }

    // Everything else is used as-is: fonts, logos, the nasheed, sound effects.
    const fileIds = new Set([
      ...spec.overlays.flatMap((o) => (o.type === 'image' ? [o.mediaId] : o.type === 'scene' ? o.elements.flatMap((e) => (e.mediaId ? [e.mediaId] : [])) : [])),
      ...allSounds(spec).map((s) => s.mediaId)]);
    for (const id of [spec.audio.nasheed?.mediaId, spec.audio.voiceover?.mediaId, spec.watermark.mediaId, spec.captions.fontMediaId]) if (id) fileIds.add(id);
    const fileNames = new Map<string, string>();
    for (const id of fileIds) {
      const builtin = builtinSfx(id);
      if (builtin) {
        const name = `sfx-${builtin.name}.ogg`;
        await copyFile(builtinSfxPath(builtin.name), join(dir, 'media', name));
        fileNames.set(id, name);
        continue;
      }
      const m = byId.get(id);
      if (!m) continue;
      const name = `${m.id}${extname(m.fileName).toLowerCase()}`;
      await linkOrCopy(mediaPath(m), join(dir, 'media', name));
      fileNames.set(m.id, name);
    }
    for (const f of BUNDLED_FONTS.flatMap((f) => f.files)) await copyFile(join(config.assetsDir, 'fonts', f), join(dir, 'fonts', f));
    for (const f of GSAP_FILES) await copyFile(gsapFilePath(f), join(dir, f));

    const output = join(dir, 'render.mp4');
    /** Cut the main track's footage as the plan has it, write the composition and draw it into `output`. */
    const draw = async () => {
      const drawn: EditSpec = { ...spec, clips: plan.clips };
      const clipSources: ComposeSource[] = [];
      const handles = transitionHandles(drawn);
      for (const [i, clip] of plan.clips.entries()) {
        const m = byId.get(clip.mediaId);
        const whole = clip.fit === 'whole' && m?.kind === 'video' ? { focusX: clip.focusX, focusY: clip.focusY } : null;
        // The sound fades a hair at every real cut (a shot running straight on into the next, the same file, doesn't),
        // and a little longer where the video ends.
        const prev = plan.clips[i - 1];
        const next = plan.clips[i + 1];
        const joinedIn = !!prev && prev.mediaId === clip.mediaId && Math.abs(prev.out - clip.in) < 0.02;
        const joinedOut = !!next && next.mediaId === clip.mediaId && Math.abs(clip.out - next.in) < 0.02;
        const fadeIn = joinedIn ? 0 : 0.012;
        const fadeOut = !next ? 0.12 : joinedOut ? 0 : 0.012;
        clipSources[i] = m ? await picture(m, `c${i}`, { start: clip.in, duration: clipLength(clip), zoom: clip.zoom, whole, audio: clip.volume > 0, fadeIn, fadeOut, playFrom: clip.playFrom, playTo: clip.playTo, ...handles[i] }) : null;
      }

      const { html } = composeEdit({
        spec: drawn,
        mascot: getWorkspace(r.workspaceId).mascot,
        media: composeMedia(rows),
        transcripts,
        clipSource: (i) => clipSources[i] ?? null,
        brollSource: (i) => brollSources[i] ?? null,
        fileUrl: (id) => `media/${fileNames.get(id) ?? id}`,
        fontUrl: (file) => `fonts/${file}`,
        scripts: GSAP_FILES,
        preview: false,
      });
      await writeFile(join(dir, 'index.html'), html);

      // A home PC draws the frames when one has the renderer, which keeps this laptop free; otherwise, or when its run
      // fails, this computer does.
      const remote = await renderRemote(dir, output, editDuration(spec), progress, abort.signal);
      if (abort.signal.aborted) throw new Error('cancelled');
      if (!remote) {
        const browser = chrome ?? (await ensureRenderer((f) => progress(0.3 * f, 'Downloading the video renderer (first time only)')));
        drawingHere.add(r.id);
        try {
          await runWorker(
            { projectDir: dir, output },
            browser,
            (value, stage) => progress(0.3 + 0.62 * value, stageLabel(stage)),
            (tail) => (logTail = tail),
            abort.signal,
          );
        } finally {
          drawingHere.delete(r.id);
        }
      }
    };
    await draw();

    // The finished video checked frame by frame: a picture change the plan didn't make, inside a clip's footage, is a
    // camera change the scan missed. Its video is scanned again with it, and the video drawn again (once).
    const check = await checkCuts(output, spec, plan, abort.signal).catch((err: Error) => (console.warn(`[render] ${r.id} cut check: ${err.message}`), null));
    if (check?.missed.length) {
      const addCuts = new Map<string, number[]>();
      for (const x of check.missed) addCuts.set(x.mediaId, [...(addCuts.get(x.mediaId) ?? []), x.source]);
      console.warn(`[render] ${r.id}: picture changes the plan didn't make at ${check.missed.map((x) => `${x.at.toFixed(2)} s`).join(', ')}: scanning again`);
      progress(0.92, 'Checking the cuts');
      const again = await exactPlan(spec, { addCuts });
      if (JSON.stringify(again.clips) !== JSON.stringify(plan.clips)) {
        plan = again;
        done = 0;
        total = plan.clips.length;
        await draw();
      }
    }
    if (check?.flashes.length) console.warn(`[render] ${r.id}: picture changes a few frames apart at ${check.flashes.map((t) => `${t.toFixed(2)} s`).join(', ')}`);

    let final = output;
    // A video with every clip muted and no nasheed or sound effects has no sound to level.
    if (spec.audio.normalize && (await probe(output)).hasAudio) {
      progress(0.94, 'Balancing loudness');
      const leveled = join(dir, 'final.mp4');
      if (await normalizeLoudness(output, leveled, LOUDNESS_TARGET, abort.signal)) final = leveled;
    }

    // The finished video joins the library, attached to the piece.
    progress(0.98, 'Saving');
    const mediaId = newId();
    const fileName = `${mediaId}.mp4`;
    await mkdir(join(config.mediaDir, r.workspaceId), { recursive: true });
    await rename(final, join(config.mediaDir, r.workspaceId, fileName));
    const { size } = await stat(join(config.mediaDir, r.workspaceId, fileName));
    const title = piece.title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'Video';
    db.insert(schema.media)
      .values({
        id: mediaId,
        workspaceId: r.workspaceId,
        pieceId: r.pieceId,
        kind: 'video',
        source: 'render',
        originalName: `${title} · v${r.versionNumber ?? 1}.mp4`,
        fileName,
        mime: 'video/mp4',
        size,
        durationMs: Math.round(editDuration(spec) * 1000),
        width: box.width,
        height: box.height,
      })
      .run();
    enqueue('media.probe', { mediaId });
    setRender(r, { status: 'done', progress: 1, stage: 'Done', mediaId, elapsedMs: Date.now() - started, finishedAt: now() });
    emit({ type: 'changed', entity: 'media', workspaceId: r.workspaceId, id: mediaId });
    emit({ type: 'changed', entity: 'pieces', workspaceId: r.workspaceId, id: r.pieceId });
    // A clip being made, or a video Claude is editing, is ready for my yes or no once rendered.
    const stages = getWorkspace(r.workspaceId).stages.map((s) => s.id);
    const fresh = getPiece(r.pieceId);
    if (['making', 'edit', 'film'].includes(fresh.stage) && stages.includes(REVIEW_STAGE)) {
      db.update(schema.pieces).set({ stage: REVIEW_STAGE, updatedAt: now() }).where(eq(schema.pieces.id, r.pieceId)).run();
      emit({ type: 'changed', entity: 'pieces', workspaceId: r.workspaceId, id: r.pieceId });
      await notify('Ready to watch', `“${piece.title}”`, `/c/${r.pieceId}`);
    } else await notify('Video ready', `“${piece.title}” finished rendering.`, `/c/${r.pieceId}`);
  } catch (err) {
    const cancelled = abort.signal.aborted;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[render] ${r.id} ${cancelled ? 'cancelled' : `failed: ${message}`}`);
    if (!cancelled && logTail) {
      await mkdir(join(config.logsDir, 'renders'), { recursive: true });
      await writeFile(join(config.logsDir, 'renders', `${r.id}.log`), logTail).catch(() => {});
    }
    setRender(r, { status: cancelled ? 'cancelled' : 'error', stage: cancelled ? 'Cancelled' : 'Failed', error: cancelled ? null : friendlyError(message), finishedAt: now(), elapsedMs: Date.now() - started });
    if (!cancelled) emit({ type: 'job', jobType: 'video.render', status: 'error', workspaceId: r.workspaceId, message: friendlyError(message) });
  } finally {
    running.delete(r.id);
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    const by = rerenderAfter.get(r.editId);
    if (by) {
      rerenderAfter.delete(r.editId);
      rerenderLatest(r.editId, by);
    }
    // Claude's fix rendered (or its render stopped): a card With Claude with nothing left open is mine to watch again.
    try {
      followComments(r.pieceId);
    } catch (err) {
      console.error('[render] could not move the card back to Review', err);
    }
  }
}

/** Renders drawing their frames on this computer now (a clip waits for those before Demucs fills the CPU too). */
const drawingHere = new Set<string>();
export const renderingHere = () => drawingHere.size > 0;

/**
 * Draw the frames on a home PC: the project folder goes over as one tar, the finished video comes back to `output`.
 * False when no worker has the renderer, or its run failed (the caller renders here instead).
 */
async function renderRemote(dir: string, output: string, seconds: number, progress: (value: number, stage: string) => void, signal: AbortSignal) {
  if (!workerFor('render')) return false;
  const tar = join(dir, 'project.tar');
  progress(0.3, 'Packing it for the home PC');
  await execFileP('tar', ['-cf', tar, '-C', dir, '--exclude=./project.tar', '--exclude=./render.log', '.'], { signal });
  let on = 'a home PC';
  progress(0.3, 'Waiting for a home PC');
  const res = await runRemote(
    'render',
    { project: tar, video: output },
    { fps: 30 },
    {
      // Generous: a home PC draws ~1 s of video in a few seconds; this only catches one that hangs.
      timeoutMs: Math.max(20 * 60_000, seconds * 60_000),
      signal,
      onStart: (name) => {
        on = name;
        progress(0.3, `Sending it to ${name}`);
      },
      onProgress: (text) => {
        const m = RENDER_PROGRESS.exec(text);
        if (m) progress(0.3 + 0.62 * Number(m[1]), `${stageLabel(m[2])} on ${on}`);
      },
    },
  );
  await rm(tar, { force: true });
  if (res.ok) return true;
  if (!signal.aborted && res.reason !== 'no-worker') console.warn(`[render] on ${on}: ${res.message}; rendering here`);
  return false;
}

const STAGES: Record<string, string> = {
  queued: 'Starting',
  preprocessing: 'Reading the composition',
  rendering: 'Drawing frames',
  encoding: 'Encoding',
  assembling: 'Adding sound',
  complete: 'Finishing',
};
const stageLabel = (stage: string) => STAGES[stage] ?? (stage ? stage[0].toUpperCase() + stage.slice(1) : 'Rendering');

function friendlyError(message: string) {
  if (/ENOSPC|no space/i.test(message)) return 'The disk is full — free some space and render again.';
  return message.slice(0, 600);
}

/** Fork the render worker and relay its progress; resolves when the video file is written. */
export function runWorker(request: WorkerRequest, chrome: string, onProgress: (value: number, stage: string) => void, onLog: (tail: string) => void, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const ffmpeg = findBinary('ffmpeg');
    const ffprobe = findBinary('ffprobe');
    const child = fork(workerFile, [JSON.stringify(request)], {
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: {
        ...process.env,
        PRODUCER_HEADLESS_SHELL_PATH: chrome,
        ...(ffmpeg ? { HYPERFRAMES_FFMPEG_PATH: ffmpeg } : {}),
        ...(ffprobe ? { HYPERFRAMES_FFPROBE_PATH: ffprobe } : {}),
        // Keep HyperFrames' frame cache with our data, bounded, instead of in /tmp.
        HYPERFRAMES_EXTRACT_CACHE_DIR: join(config.cacheDir, 'frames'),
        HYPERFRAMES_EXTRACT_CACHE_MAX_MB: '2048',
        // Each capture worker is a Chrome; three is plenty on a 4-core, 16 GB laptop.
        PRODUCER_MAX_WORKERS: '3',
      },
    });
    const log = createWriteStream(join(request.projectDir, 'render.log'));
    let tail = '';
    const onData = (chunk: Buffer) => {
      log.write(chunk);
      tail = (tail + chunk.toString()).slice(-20_000);
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    let failure: string | null = null;
    child.on('message', (m: WorkerMessage) => {
      if (m.type === 'progress') onProgress(m.progress, m.stage);
      else if (m.type === 'error') failure = m.message;
    });
    const kill = () => {
      child.kill('SIGTERM');
      setTimeout(() => child.exitCode === null && child.kill('SIGKILL'), 15_000).unref();
    };
    signal.addEventListener('abort', kill, { once: true });
    child.on('error', reject);
    child.on('exit', (code) => {
      signal.removeEventListener('abort', kill);
      log.end();
      onLog(tail);
      if (code === 0) resolve();
      else reject(new Error(signal.aborted ? 'cancelled' : (failure ?? `The renderer stopped unexpectedly (exit ${code}).`)));
    });
  });
}
