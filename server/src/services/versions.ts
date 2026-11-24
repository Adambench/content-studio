// What Claude saves for me to watch: renders/v<n>.mp4 (+ v<n>.jpg, its poster) or a carousel's renders/v<n>/<k>.png,
// in the video's folder. Saving one is Claude's `save_version` tool; every version stays (I watch each).

import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { extname, isAbsolute, join, resolve } from 'node:path';
import type { Version, VersionKind } from '../../../shared/types.ts';
import { config } from '../config.ts';
import { all, get, run } from '../db/db.ts';
import { probe, still } from '../engine/media.ts';
import { emit, HttpError, newId, notFound, now } from '../lib/util.ts';
import { addThread } from './thread.ts';
import { getVideo, videoDir } from './videos.ts';

type VersionRow = { id: string; video_id: string; n: number; kind: VersionKind; note: string; duration: number | null; width: number | null; height: number | null; slides: number; created_at: number };

const toVersion = (r: VersionRow): Version => ({ id: r.id, videoId: r.video_id, n: r.n, kind: r.kind, note: r.note, duration: r.duration, width: r.width, height: r.height, slides: r.slides, createdAt: r.created_at });

export const listVersions = (videoId: string) => all<VersionRow>('SELECT * FROM versions WHERE video_id = ? ORDER BY n', videoId).map(toVersion);

export function getVersion(id: string): Version {
  const r = get<VersionRow>('SELECT * FROM versions WHERE id = ?', id);
  if (!r) throw notFound('Version');
  return toVersion(r);
}

/** Its files on disk (null when missing). */
export function versionFiles(v: Version): { file: string | null; poster: string | null; slides: string[] } {
  const dir = join(videoDir(getVideo(v.videoId)), 'renders');
  if (v.kind === 'carousel') {
    const sdir = join(dir, `v${v.n}`);
    const slides = existsSync(sdir) ? readdirSync(sdir).filter((f) => /\.(png|jpe?g)$/i.test(f)).sort().map((f) => join(sdir, f)) : [];
    return { file: null, poster: slides[0] ?? null, slides };
  }
  const file = join(dir, `v${v.n}.mp4`);
  const poster = join(dir, `v${v.n}.jpg`);
  return { file: existsSync(file) ? file : null, poster: existsSync(poster) ? poster : null, slides: [] };
}

/** A path Claude gave: relative to the video's folder, or absolute inside ~/studio or /tmp. */
function resolveIn(dir: string, p: string): string {
  const abs = isAbsolute(p) ? resolve(p) : resolve(dir, p);
  if (!(abs.startsWith(config.studioDir + '/') || abs.startsWith('/tmp/'))) throw new HttpError(400, `${p} is outside the studio`);
  if (!existsSync(abs)) throw new HttpError(400, `${p} doesn't exist`);
  return abs;
}

export async function saveVersion(videoId: string, opts: { file?: string; slides?: string[]; note?: string }, jobId: string | null = null): Promise<Version> {
  const video = getVideo(videoId);
  const dir = videoDir(video);
  const out = join(dir, 'renders');
  mkdirSync(out, { recursive: true });
  const n = (get<{ n: number | null }>('SELECT MAX(n) AS n FROM versions WHERE video_id = ?', videoId)?.n ?? 0) + 1;
  const kind: VersionKind = opts.slides?.length ? 'carousel' : 'video';
  let meta = { duration: null as number | null, width: null as number | null, height: null as number | null };
  let slides = 0;
  if (kind === 'carousel') {
    const sdir = join(out, `v${n}`);
    mkdirSync(sdir, { recursive: true });
    opts.slides!.forEach((s, i) => copyFileSync(resolveIn(dir, s), join(sdir, `${String(i + 1).padStart(2, '0')}${extname(s).toLowerCase() || '.png'}`)));
    slides = opts.slides!.length;
    const m = await probe(join(sdir, readdirSync(sdir).sort()[0]!));
    meta = { duration: null, width: m.width, height: m.height };
  } else {
    if (!opts.file) throw new HttpError(400, 'Give the rendered file, or the slides');
    const src = resolveIn(dir, opts.file);
    const file = join(out, `v${n}.mp4`);
    if (src !== file) copyFileSync(src, file);
    const m = await probe(file);
    meta = { duration: m.duration, width: m.width, height: m.height };
    await still(file, join(out, `v${n}.jpg`), { at: Math.min(1, (m.duration ?? 2) / 2), width: 540 });
  }
  const id = newId();
  run('INSERT INTO versions (id, video_id, n, kind, note, duration, width, height, slides, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', id, videoId, n, kind, (opts.note ?? '').slice(0, 500), meta.duration, meta.width, meta.height, slides, now());
  addThread(videoId, 'version', `v${n}`, { n, kind, note: opts.note ?? '', duration: meta.duration, slides }, jobId);
  emit('version', id, videoId);
  return getVersion(id);
}
