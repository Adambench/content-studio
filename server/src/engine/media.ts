// FFmpeg and ffprobe basics every recipe uses: what a file is, a still from it, a quick content hash.

import { createHash } from 'node:crypto';
import { open, stat } from 'node:fs/promises';
import type { MediaMeta } from '../../../shared/types.ts';
import { requireBinary, run } from '../lib/proc.ts';

type ProbeStream = {
  codec_type: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  color_transfer?: string;
  tags?: Record<string, string>;
  side_data_list?: { rotation?: number }[];
};

const rate = (s?: string) => {
  if (!s) return null;
  const [a, b] = s.split('/').map(Number);
  return a && b ? a / b : a || null;
};

/** What a media file is: length, size (as shown, rotation applied), frame rate, sound, HDR. */
export async function probe(file: string): Promise<MediaMeta> {
  const { stdout } = await run(requireBinary('ffprobe'), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  const info = JSON.parse(stdout) as { format?: { duration?: string }; streams?: ProbeStream[] };
  const streams = info.streams ?? [];
  // An attached cover picture in an audio file is a "video" stream with one frame: not footage.
  const video = streams.find((s) => s.codec_type === 'video' && !['mjpeg', 'png'].includes(s.codec_name ?? ''));
  const image = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');
  const v = video ?? image;
  const rotation = Number(v?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? v?.tags?.rotate ?? 0) || 0;
  const sideways = Math.abs(rotation) % 180 === 90;
  const duration = Number(info.format?.duration);
  return {
    duration: Number.isFinite(duration) && duration > 0 ? duration : null,
    width: v ? ((sideways ? v.height : v.width) ?? null) : null,
    height: v ? ((sideways ? v.width : v.height) ?? null) : null,
    fps: video ? rate(video.avg_frame_rate) ?? rate(video.r_frame_rate) : null,
    rotation,
    hasAudio: !!audio,
    hasVideo: !!video,
    codec: v?.codec_name ?? audio?.codec_name ?? null,
    hdr: ['smpte2084', 'arib-std-b67'].includes(video?.color_transfer ?? ''),
  };
}

const TONEMAP = 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p';

/** One still as a JPEG (`at` seconds in), HDR mapped to normal range so it doesn't look washed out. */
export async function still(file: string, out: string, opts: { at?: number; width?: number; hdr?: boolean } = {}) {
  const scale = `scale=${opts.width ?? 480}:-2:flags=lanczos`;
  const args = (vf: string) => ['-y', '-v', 'error', ...(opts.at ? ['-ss', String(opts.at)] : []), '-i', file, '-frames:v', '1', '-vf', vf, '-q:v', '3', out];
  try {
    await run(requireBinary('ffmpeg'), args(opts.hdr ? `${TONEMAP},${scale}` : scale));
  } catch (err) {
    if (!opts.hdr) throw err;
    await run(requireBinary('ffmpeg'), args(scale));
  }
}

/**
 * A fingerprint of a file's content that's quick on gigabytes: its size and its first and last 4 MB. Enough to know
 * a step's input is the same file it saw before.
 */
export async function quickHash(file: string): Promise<string> {
  const { size } = await stat(file);
  const h = createHash('sha256').update(String(size));
  const fd = await open(file, 'r');
  try {
    const chunk = 4 * 1024 * 1024;
    const buf = Buffer.alloc(Math.min(chunk, size));
    await fd.read(buf, 0, buf.length, 0);
    h.update(buf);
    if (size > chunk) {
      const tail = Buffer.alloc(Math.min(chunk, size - chunk));
      await fd.read(tail, 0, tail.length, size - tail.length);
      h.update(tail);
    }
  } finally {
    await fd.close();
  }
  return h.digest('hex').slice(0, 32);
}
