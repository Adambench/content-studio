// Stills of one overlay (a scene Claude wrote, or any graphic) as it will render: the overlay alone over a still of the
// footage under it, rendered by HyperFrames at a low frame rate, then a few frames pulled out. This is how Claude sees
// what it designed before the creator does.
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { clipAt, emptyEdit, normalizeEdit, type EditOverlay, type EditSpec } from '../../../shared/edit';
import { config } from '../config';
import { newId } from '../db';
import { extractFrames } from '../lib/ffmpeg';
import { getMedia, mediaPath } from '../services/media';
import { ensureRenderer } from './browser';
import { BUNDLED_FONTS, composeEdit, type ComposeMedia } from './compose';
import { getEdit } from './edits';
import { gsapPath, runWorker } from './render';

const PREVIEW_FPS = 10;

/** One render at a time: previews are quick, but two headless Chromes at once on this laptop aren't. */
let busy: Promise<unknown> = Promise.resolve();

/**
 * JPEG stills of overlay `overlayId` of an edit at `times` (seconds into the overlay; default four spread across it).
 * Takes about as long as the overlay, mostly Chrome starting.
 */
export function previewOverlay(editId: string, overlayId: string, times?: number[]) {
  const next = busy.then(() => run(editId, overlayId, times));
  busy = next.catch(() => {});
  return next;
}

async function run(editId: string, overlayId: string, times?: number[]) {
  const spec = normalizeEdit(getEdit(editId).working);
  const o = spec.overlays.find((x) => x.id === overlayId);
  if (!o) throw new Error('There’s no overlay with that id on this edit.');
  const len = o.end - o.start;
  const dir = join(config.tmpDir, `preview-${newId()}`);
  await mkdir(join(dir, 'media'), { recursive: true });
  await mkdir(join(dir, 'fonts'), { recursive: true });
  try {
    // The picture under it: the main track's frame where the overlay starts, framed as in the edit.
    const hit = clipAt(spec, o.start + 0.01);
    const media = new Map<string, ComposeMedia>();
    const mini: EditSpec = { ...emptyEdit(), format: spec.format, captions: { ...spec.captions, enabled: false }, overlays: [{ ...o, start: 0, end: len } as EditOverlay] };
    let bgFile: string | null = null;
    if (hit) {
      const m = getMedia(hit.clip.mediaId);
      bgFile = m.kind === 'image' ? `bg${extname(m.fileName).toLowerCase()}` : 'bg.jpg';
      if (m.kind === 'image') await copyFile(mediaPath(m), join(dir, 'media', bgFile));
      else await extractFrames(mediaPath(m), [hit.clip.in + (o.start - hit.start)], () => join(dir, 'media', 'bg.jpg'), 1920);
      media.set('bg', { id: 'bg', kind: 'image', assetType: null, width: m.width, height: m.height, durationMs: null });
      mini.clips = [{ ...hit.clip, mediaId: 'bg', in: 0, out: len, transition: null }];
    }
    // Pictures a scene uses, and the brand font.
    const files = new Map<string, string>();
    const ids = new Set<string>();
    if (o.type === 'scene') o.elements.forEach((e) => e.mediaId && ids.add(e.mediaId));
    if (spec.captions.fontMediaId) ids.add(spec.captions.fontMediaId);
    for (const id of ids) {
      const m = getMedia(id);
      const name = `${m.id}${extname(m.fileName).toLowerCase()}`;
      await copyFile(mediaPath(m), join(dir, 'media', name));
      files.set(id, name);
    }
    for (const f of BUNDLED_FONTS.flatMap((f) => f.files)) await copyFile(join(config.assetsDir, 'fonts', f), join(dir, 'fonts', f));
    await copyFile(gsapPath(), join(dir, 'gsap.min.js'));
    const { html } = composeEdit({
      spec: { ...mini, captions: { ...mini.captions, fontMediaId: spec.captions.fontMediaId } },
      media,
      transcripts: {},
      clipSource: () => (bgFile ? { src: `media/${bgFile}`, mediaStart: 0 } : null),
      brollSource: () => null,
      fileUrl: (id) => `media/${files.get(id) ?? id}`,
      fontUrl: (file) => `fonts/${file}`,
      scripts: ['gsap.min.js'],
      preview: false,
    });
    // Silence, so the render has no sound effects to mix (they'd only slow it down).
    await writeFile(join(dir, 'index.html'), html.replace(/<audio [^>]*><\/audio>/g, ''));
    const chrome = await ensureRenderer();
    const output = join(dir, 'preview.mp4');
    await runWorker({ projectDir: dir, output, fps: PREVIEW_FPS }, chrome, () => {}, () => {}, new AbortController().signal);
    const at = (times?.length ? times : [0.15, 0.4, 0.65, 0.9].map((f) => f * len)).slice(0, 6).map((t) => Math.min(Math.max(0, t), Math.max(0, len - 0.05)));
    const stills = await extractFrames(output, at, (i) => join(dir, `still-${i}.jpg`), 540);
    return { times: at, images: await Promise.all(stills.map((f) => readFile(f))) };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
