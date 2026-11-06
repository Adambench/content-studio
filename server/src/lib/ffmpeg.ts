import { execFile as execFileCb } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { wholeGeometry } from '../../../shared/edit';
import { requireBinary } from './bin';

const execFile = promisify(execFileCb);

export type ProbeResult = {
  durationMs: number | null;
  width: number | null;
  height: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
  /** HLG or PQ footage (recent phones record it), which needs tone-mapping to look right everywhere else. */
  hdr: boolean;
  /** The picture's frames a second, and whether every frame lasts as long (a phone's recording often doesn't). */
  fps: number | null;
  cfr: boolean;
  /** When the first frame shows, from the file's start (seconds; a cut whose sound starts first has it a little late). */
  videoStart: number;
};

export async function probe(file: string): Promise<ProbeResult> {
  const { stdout } = await execFile(requireBinary('ffprobe'), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], {
    maxBuffer: 10 * 1024 * 1024,
  });
  const data = JSON.parse(stdout) as {
    format?: { duration?: string; start_time?: string };
    streams?: {
      codec_type: string;
      width?: number;
      height?: number;
      r_frame_rate?: string;
      avg_frame_rate?: string;
      start_time?: string;
      color_transfer?: string;
      disposition?: { attached_pic?: number };
      tags?: { rotate?: string };
      side_data_list?: { rotation?: number }[];
    }[];
  };
  const streams = data.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  // A browser's recording (MediaRecorder's WebM) has no length in its header: read it to the end to find it.
  const duration = data.format?.duration && data.format.duration !== 'N/A' ? Math.round(Number(data.format.duration) * 1000) : streams.some((s) => s.codec_type === 'audio') ? await decodedLength(file) : null;
  // Phones record portrait video as landscape + a rotation flag; report the displayed size.
  const rotation = Math.abs(Number(video?.tags?.rotate ?? video?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0));
  const swap = rotation === 90 || rotation === 270;
  const rate = (r?: string) => {
    const [a, b] = (r ?? '').split('/').map(Number);
    return a > 0 && b > 0 ? a / b : null;
  };
  const fps = rate(video?.r_frame_rate) ?? rate(video?.avg_frame_rate);
  const avg = rate(video?.avg_frame_rate);
  const startOf = (s?: string) => (s && s !== 'N/A' && Number.isFinite(Number(s)) ? Number(s) : 0);
  return {
    durationMs: Number.isFinite(duration) ? duration : null,
    width: (swap ? video?.height : video?.width) ?? null,
    height: (swap ? video?.width : video?.height) ?? null,
    hasVideo: !!video,
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
    hdr: video?.color_transfer === 'arib-std-b67' || video?.color_transfer === 'smpte2084',
    fps: fps && fps <= 240 ? fps : null,
    cfr: !!fps && !!avg && Math.abs(fps - avg) < fps * 0.01,
    videoStart: Math.max(0, startOf(video?.start_time) - startOf(data.format?.start_time)),
  };
}

async function decodedLength(file: string) {
  const { stderr } = await execFile(requireBinary('ffmpeg'), ['-hide_banner', '-nostats', '-i', file, '-map', '0:a:0', '-f', 'null', '-progress', 'pipe:2', '-'], { maxBuffer: 20 * 1024 * 1024 }).catch(() => ({ stderr: '' }));
  const times = [...stderr.matchAll(/out_time_us=(\d+)/g)];
  const us = times.length ? Number(times[times.length - 1][1]) : NaN;
  return Number.isFinite(us) && us > 0 ? Math.round(us / 1000) : null;
}

/** A small JPEG preview for a video (frame near the start) or an image. */
export async function makeThumb(file: string, out: string, durationMs: number | null) {
  // A still picture probes as one frame of 40 ms: seeking at all (even -ss 0 on some JPEGs) skips it, and FFmpeg
  // still exits fine.
  const at = durationMs && durationMs > 1000 ? Math.min(1, (durationMs / 1000) * 0.1) : 0;
  await execFile(requireBinary('ffmpeg'), ['-y', '-v', 'error', ...(at ? ['-ss', String(at)] : []), '-i', file, '-frames:v', '1', '-update', '1', '-vf', 'scale=480:-2', '-q:v', '4', out]);
  if (!(await stat(out).then((s) => s.size > 0, () => false))) throw new Error('FFmpeg made no picture');
}

/** 16 kHz mono WAV — what Whisper wants. */
export async function extractAudio(file: string, out: string) {
  await execFile(requireBinary('ffmpeg'), ['-y', '-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', out], {
    maxBuffer: 10 * 1024 * 1024,
  });
}

/** Grab single frames at the given times (seconds) as JPEGs no wider than `width`. */
/** Frames at `times`, `width` wide at most; `crops` (fractions of the width, per frame) keep only that part of each. */
export async function extractFrames(file: string, times: number[], outPattern: (i: number) => string, width = 768, crops?: ({ x0: number; x1: number } | null)[]) {
  const outputs: string[] = [];
  for (const [i, t] of times.entries()) {
    const out = outPattern(i);
    const c = crops?.[i];
    const crop = c && c.x1 - c.x0 < 0.99 ? `crop=iw*${(c.x1 - c.x0).toFixed(4)}:ih:iw*${c.x0.toFixed(4)}:0,` : '';
    await execFile(requireBinary('ffmpeg'), ['-y', '-v', 'error', '-ss', t.toFixed(2), '-i', file, '-frames:v', '1', '-vf', `${crop}scale='min(${width},iw)':-2`, '-q:v', '5', out]);
    outputs.push(out);
  }
  return outputs;
}

// ---------- video studio ----------

const TONEMAP = 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv';
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

/** Size that fills a `boxW`×`boxH` frame (times `zoom`) without ever upscaling the source. */
export function fillSize(srcW: number, srcH: number, boxW: number, boxH: number, zoom = 1) {
  const scale = Math.min(1, Math.max(boxW / srcW, boxH / srcH) * zoom);
  return { width: even(srcW * scale), height: even(srcH * scale) };
}

const run = (args: string[], opts: { cwd?: string; signal?: AbortSignal; timeoutMs?: number } = {}) =>
  execFile(requireBinary('ffmpeg'), ['-hide_banner', '-nostdin', '-y', '-v', 'error', ...args], {
    cwd: opts.cwd,
    signal: opts.signal,
    maxBuffer: 20 * 1024 * 1024,
    timeout: opts.timeoutMs ?? 60 * 60 * 1000,
  });

/**
 * The video studio's preview copy of a clip: H.264 that every browser (and the phone) plays, constant 30 fps,
 * a keyframe every half second for snappy scrubbing, tone-mapped to SDR, at preview size.
 */
export async function makeVideoProxy(file: string, out: string, info: ProbeResult, box = { width: 540, height: 960 }) {
  const size = fillSize(info.width ?? box.width, info.height ?? box.height, box.width, box.height);
  const vf = [info.hdr && TONEMAP, `scale=${size.width}:${size.height}:flags=bicubic`, 'fps=30', 'format=yuv420p'].filter(Boolean).join(',');
  await run([
    '-i', file,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', vf,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-g', '15', '-keyint_min', '15', '-sc_threshold', '0',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
    '-movflags', '+faststart', out,
  ]);
}

/** Photos (including HEIC, which browsers can't show) become a JPEG no larger than 2160 px. */
export async function makeImageProxy(file: string, out: string) {
  await run(['-i', file, '-frames:v', '1', '-vf', 'scale=w=2160:h=2160:force_original_aspect_ratio=decrease:flags=lanczos', '-q:v', '3', out]);
}

/**
 * Cut one clip out of its source for rendering, at full quality: trimmed, tone-mapped, sized to fill the output
 * frame (never upscaled) and optionally graded with a LUT. `lut` is a file name relative to `cwd`.
 */
export async function cutSegment(input: {
  file: string;
  out: string;
  info: ProbeResult;
  start: number;
  duration: number;
  box: { width: number; height: number };
  zoom: number;
  /** Show all of the picture, laid out in a frame-sized file over a blurred, darkened copy of itself. */
  whole?: { focusX: number; focusY: number } | null;
  audio: boolean;
  /**
   * Fades on the sound at the clip's own in and out (seconds from the file's start, and the clip's length), so a cut
   * never clicks or leaves half a syllable: a few milliseconds each side, longer where the video ends.
   */
  fades?: { at: number; length: number; fadeIn: number; fadeOut: number } | null;
  /**
   * The picture plays only from `from` to `to` (seconds of the file, inside the cut): before, it holds the frame at
   * `from`; after, the frame before `to`. A few frames of another shot beside a cut flash past; the frame next to them,
   * held, doesn't show. The sound plays all the way.
   */
  play?: { from: number; to: number } | null;
  lut?: { file: string; intensity: number } | null;
  cwd: string;
  signal?: AbortSignal;
}) {
  const { info, box } = input;
  // Every cut lands between two of the file's own frames: the first frame is the cut's first (not the next one, shown
  // twice), and nothing of the frame before or after slips in.
  const fps = info.fps ?? 30;
  const frame = 1 / fps;
  const snap = (t: number) => info.videoStart + Math.round((t - info.videoStart) * fps) / fps;
  const a = Math.max(0, snap(input.start));
  const b = Math.max(a + frame, snap(input.start + input.duration));
  const p0 = Math.min(b - frame, Math.max(a, snap(input.play?.from ?? a)));
  const p1 = Math.max(p0 + frame, Math.min(b, snap(input.play?.to ?? b)));
  const exact = [info.cfr && `trim=end_frame=${Math.round((p1 - p0) * fps)}`, 'setpts=PTS-STARTPTS'].filter(Boolean).join(',');
  // The held frames go on after the change to 30 fps (before it, that filter drops the last frame of the clip).
  const hold = p0 - a > frame / 2 || b - p1 > frame / 2 ? `tpad=start_duration=${(p0 - a).toFixed(4)}:stop_duration=${(b - p1).toFixed(4)}:start_mode=clone:stop_mode=clone` : null;
  let base: string;
  if (input.whole) {
    const sw = info.width ?? box.width;
    const sh = info.height ?? box.height;
    const g = wholeGeometry(sw, sh, box.width, box.height, input.whole.focusX, input.whole.focusY, input.zoom);
    const small = { width: even(box.width / 8), height: even(box.height / 8) };
    base = [
      [exact, info.hdr && TONEMAP, 'fps=30', hold, 'split[wa][wb]'].filter(Boolean).join(','),
      // The blur is made small and scaled up: soft, and fast.
      `[wa]scale=${small.width}:${small.height}:force_original_aspect_ratio=increase,crop=${small.width}:${small.height},boxblur=4:2,scale=${box.width}:${box.height}:flags=bilinear,colorchannelmixer=rr=0.45:gg=0.45:bb=0.45[wbg]`,
      `[wb]scale=${even(g.width)}:${even(g.height)}:flags=lanczos[wfg]`,
      `[wbg][wfg]overlay=x=${Math.round(g.left)}:y=${Math.round(g.top)}`,
    ].join(';');
  } else {
    const size = fillSize(info.width ?? box.width, info.height ?? box.height, box.width, box.height, input.zoom);
    base = [exact, info.hdr && TONEMAP, `scale=${size.width}:${size.height}:flags=lanczos`, 'fps=30', hold].filter(Boolean).join(',');
  }
  let vf = `${base},format=yuv420p`;
  if (input.lut && input.lut.intensity > 0) {
    const lut = `lut3d=file=${input.lut.file}:interp=tetrahedral`;
    const k = Math.min(1, input.lut.intensity);
    vf =
      k >= 0.999
        ? `${base},format=gbrp,${lut},format=yuv420p`
        : // Partial strength: mix original and graded (normal blend = top × opacity + bottom × (1 − opacity), native and fast).
          `${base},format=gbrp,split[a][b];[b]${lut}[g];[a][g]blend=all_mode=normal:all_opacity=${(1 - k).toFixed(3)},format=yuv420p`;
  }
  const t = (x: number) => x.toFixed(4);
  await run(
    [
      // The picture from a quarter frame before its first frame (so that frame is the first in, whatever the rounding),
      // the sound from exactly the cut's start.
      '-ss', t(Math.max(0, p0 - frame / 4)), '-t', t(p1 - p0), '-i', input.file,
      ...(input.audio ? ['-ss', t(a), '-t', t(b - a), '-i', input.file] : []),
      '-map', '0:v:0', ...(input.audio ? ['-map', '1:a:0?'] : ['-an']),
      // A single-input graph (even with split/blend inside) is still a simple -vf graph.
      '-vf', vf,
      ...(input.audio && input.fades ? ['-af', clipFades(input.fades)] : []),
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '15', '-g', '30', '-keyint_min', '30', '-sc_threshold', '0',
      ...(input.audio ? ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2'] : []),
      '-movflags', '+faststart', input.out,
    ],
    { cwd: input.cwd, signal: input.signal },
  );
}

const clipFades = (f: { at: number; length: number; fadeIn: number; fadeOut: number }) =>
  [
    f.fadeIn > 0 && `afade=t=in:st=${Math.max(0, f.at).toFixed(3)}:d=${f.fadeIn.toFixed(3)}`,
    f.fadeOut > 0 && `afade=t=out:st=${Math.max(0, f.at + f.length - f.fadeOut).toFixed(3)}:d=${f.fadeOut.toFixed(3)}`,
  ]
    .filter(Boolean)
    .join(',') || 'anull';

/** A photo graded with a LUT (`lut` relative to `cwd`). */
export async function gradeImage(file: string, out: string, lut: { file: string; intensity: number }, cwd: string) {
  const k = Math.min(1, lut.intensity);
  const graph = `lut3d=file=${lut.file}:interp=tetrahedral`;
  const vf = k >= 0.999 ? `format=gbrp,${graph}` : `format=gbrp,split[a][b];[b]${graph}[g];[a][g]blend=all_mode=normal:all_opacity=${(1 - k).toFixed(3)}`;
  await run(['-i', file, '-frames:v', '1', '-vf', vf, '-q:v', '2', out], { cwd });
}

/** Speech ranges (source seconds) inside [start, end), found by ffmpeg's silence detection — for clips without a transcript. */
export async function detectSpeech(file: string, start: number, end: number): Promise<[number, number][]> {
  const { stderr } = await execFile(
    requireBinary('ffmpeg'),
    ['-hide_banner', '-nostdin', '-ss', start.toFixed(3), '-t', (end - start).toFixed(3), '-i', file, '-vn', '-af', 'silencedetect=noise=-32dB:d=0.3', '-f', 'null', '-'],
    { maxBuffer: 20 * 1024 * 1024 },
  );
  const silences: [number, number][] = [];
  let open: number | null = null;
  for (const line of stderr.split('\n')) {
    const s = /silence_start: (-?[\d.]+)/.exec(line);
    const e = /silence_end: ([\d.]+)/.exec(line);
    if (s) open = Math.max(0, Number(s[1]));
    if (e) {
      silences.push([open ?? 0, Number(e[1])]);
      open = null;
    }
  }
  if (open !== null) silences.push([open, end - start]);
  const speech: [number, number][] = [];
  let t = 0;
  for (const [s, e] of silences) {
    if (s > t) speech.push([start + t, start + s]);
    t = Math.max(t, e);
  }
  if (t < end - start) speech.push([start + t, end]);
  return speech;
}

/** Integrated loudness of a file's sound (LUFS), or null for silence. */
export async function loudness(file: string, signal?: AbortSignal) {
  const { stderr } = await execFile(requireBinary('ffmpeg'), ['-hide_banner', '-nostdin', '-i', file, '-vn', '-af', 'ebur128', '-f', 'null', '-'], { maxBuffer: 50 * 1024 * 1024, signal });
  const m = /I:\s+(-?[\d.]+) LUFS/.exec(stderr.slice(stderr.lastIndexOf('Summary:')));
  const v = m ? Number(m[1]) : NaN;
  return Number.isFinite(v) && v > -70 ? v : null;
}

type Loudness = { input_i: string; input_tp: string; input_lra: string; input_thresh: string; target_offset: string };

/**
 * Normalise a finished video's sound to `target` LUFS (two-pass loudnorm, video copied untouched).
 * Returns false when there's nothing to normalise (silent video).
 */
export async function normalizeLoudness(file: string, out: string, target: number, signal?: AbortSignal) {
  const filter = `loudnorm=I=${target}:TP=-1.5:LRA=11`;
  const { stderr } = await execFile(requireBinary('ffmpeg'), ['-hide_banner', '-nostdin', '-i', file, '-vn', '-af', `${filter}:print_format=json`, '-f', 'null', '-'], {
    maxBuffer: 20 * 1024 * 1024,
    signal,
  });
  const json = stderr.slice(stderr.lastIndexOf('{'), stderr.lastIndexOf('}') + 1);
  let m: Loudness;
  try {
    m = JSON.parse(json) as Loudness;
  } catch {
    return false;
  }
  if (!Number.isFinite(Number(m.input_i)) || Number(m.input_i) < -70) return false;
  const measured = `measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
  await run(['-i', file, '-map', '0', '-c:v', 'copy', '-af', `${filter}:${measured},aresample=48000`, '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out], { signal });
  return true;
}

/** Fill a `width`×`height` frame (scale up, crop the overflow). A clip loses its sound: nothing generated may carry any. */
export async function fitToSize(file: string, out: string, width: number, height: number, isVideo: boolean) {
  const vf = `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height},setsar=1`;
  const args = isVideo ? ['-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart'] : ['-frames:v', '1'];
  await execFile(requireBinary('ffmpeg'), ['-y', '-v', 'error', '-i', file, '-vf', vf, ...args, out], { maxBuffer: 10 * 1024 * 1024 });
}
