import { existsSync } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { ProxyStatus } from '../../../shared/types';
import { config } from '../config';
import { db, schema } from '../db';
import { emit } from '../lib/events';
import { makeImageProxy, makeVideoProxy, probe } from '../lib/ffmpeg';
import { getMedia, mediaPath, type MediaRow } from '../services/media';

/** Preview copy of a clip: an H.264 MP4 for video, a JPEG for photos. */
export const proxyPath = (m: Pick<MediaRow, 'id' | 'kind'>) => join(config.proxiesDir, `${m.id}.${m.kind === 'image' ? 'jpg' : 'mp4'}`);

function setStatus(m: MediaRow, proxyStatus: ProxyStatus) {
  db.update(schema.media).set({ proxyStatus }).where(eq(schema.media.id, m.id)).run();
  emit({ type: 'changed', entity: 'media', workspaceId: m.workspaceId, id: m.id });
}

export async function makeProxy({ mediaId }: { mediaId: string }) {
  const m = getMedia(mediaId);
  const out = proxyPath(m);
  if (existsSync(out)) return setStatus(m, 'done');
  setStatus(m, 'running');
  const tmp = `${out}.part${m.kind === 'image' ? '.jpg' : '.mp4'}`;
  try {
    if (m.kind === 'image') await makeImageProxy(mediaPath(m), tmp);
    else await makeVideoProxy(mediaPath(m), tmp, await probe(mediaPath(m)));
    await rename(tmp, out);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
  setStatus(m, 'done');
}

export function onProxyFailed({ mediaId }: { mediaId: string }) {
  const m = db.select().from(schema.media).where(eq(schema.media.id, mediaId)).get();
  if (m) setStatus(m, 'error');
}
