import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
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
};

export async function probe(file: string): Promise<ProbeResult> {
  const { stdout } = await execFile(requireBinary('ffprobe'), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], {
    maxBuffer: 10 * 1024 * 1024,
  });
  const data = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: {
      codec_type: string;
      width?: number;
      height?: number;
      color_transfer?: string;
      disposition?: { attached_pic?: number };
      tags?: { rotate?: string };
      side_data_list?: { rotation?: number }[];
    }[];
  };
  const streams = data.streams ?? [];
  const video = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const duration = data.format?.duration ? Math.round(Number(data.format.duration) * 1000) : null;
  // Phones record portrait video as landscape + a rotation flag; report the displayed size.
  const rotation = Math.abs(Number(video?.tags?.rotate ?? video?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0));
  const swap = rotation === 90 || rotation === 270;
  return {
    durationMs: Number.isFinite(duration) ? duration : null,
    width: (swap ? video?.height : video?.width) ?? null,
    height: (swap ? video?.width : video?.height) ?? null,
    hasVideo: !!video,
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
    hdr: video?.color_transfer === 'arib-std-b67' || video?.color_transfer === 'smpte2084',
  };
}

/** A small JPEG preview for a video (frame near the start) or an image. */
export async function makeThumb(file: string, out: string, durationMs: number | null) {
  const at = durationMs ? Math.min(1, (durationMs / 1000) * 0.1) : 0;
  await execFile(requireBinary('ffmpeg'), ['-y', '-v', 'error', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', out]);
}

/** 16 kHz mono WAV — what Whisper wants. */
export async function extractAudio(file: string, out: string) {
  await execFile(requireBinary('ffmpeg'), ['-y', '-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', out], {
    maxBuffer: 10 * 1024 * 1024,
  });
}

/** Grab single frames at the given times (seconds) as JPEGs no wider than `width`. */
export async function extractFrames(file: string, times: number[], outPattern: (i: number) => string, width = 768) {
  const outputs: string[] = [];
  for (const [i, t] of times.entries()) {
    const out = outPattern(i);
    await execFile(requireBinary('ffmpeg'), ['-y', '-v', 'error', '-ss', t.toFixed(2), '-i', file, '-frames:v', '1', '-vf', `scale='min(${width},iw)':-2`, '-q:v', '5', out]);
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
  audio: boolean;
  lut?: { file: string; intensity: number } | null;
  cwd: string;
  signal?: AbortSignal;
}) {
  const { info, box } = input;
  const size = fillSize(info.width ?? box.width, info.height ?? box.height, box.width, box.height, input.zoom);
  const base = [info.hdr && TONEMAP, `scale=${size.width}:${size.height}:flags=lanczos`, 'fps=30'].filter(Boolean).join(',');
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
  await run(
    [
      '-ss', input.start.toFixed(3), '-t', input.duration.toFixed(3), '-i', input.file,
      '-map', '0:v:0', ...(input.audio ? ['-map', '0:a:0?'] : ['-an']),
      // A single-input graph (even with split/blend inside) is still a simple -vf graph.
      '-vf', vf,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '15', '-g', '30', '-keyint_min', '30', '-sc_threshold', '0',
      ...(input.audio ? ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-ac', '2'] : []),
      '-movflags', '+faststart', input.out,
    ],
    { cwd: input.cwd, signal: input.signal },
  );
}

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
