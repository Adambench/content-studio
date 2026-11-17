// Stills of one overlay (a scene Claude wrote, or any graphic) as it will render: the overlay alone over stills of the
// footage under it (one per clip it plays over), rendered by HyperFrames at a low frame rate, then a few frames pulled out. This is how Claude sees
// what it designed before the creator does.
import { execFile as execFileCb } from 'node:child_process';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { promisify } from 'node:util';
import { clipStarts, EDIT_FORMATS, emptyEdit, normalizeEdit, type EditOverlay, type EditSpec } from '../../../shared/edit';
import { config } from '../config';
import { newId } from '../db';
import { requireBinary } from '../lib/bin';
import { extractFrames } from '../lib/ffmpeg';
import { getMedia, mediaPath } from '../services/media';
import { ensureRenderer } from './browser';
import { BUNDLED_FONTS, composeEdit, type ComposeMedia } from './compose';
import { getWorkspace } from '../services/pieces';
import { getEdit } from './edits';
import { GSAP_FILES, gsapFilePath, runWorker } from './render';

const execFile = promisify(execFileCb);

const PREVIEW_FPS = 10;

/** One render at a time: previews are quick, but two headless Chromes at once on this laptop aren't. */
let busy: Promise<unknown> = Promise.resolve();

/**
 * JPEG stills of overlay `overlayId` of an edit at `times` (seconds into the overlay; default four spread across it).
 * Takes about as long as the overlay, mostly Chrome starting. `given`: a spec that isn't saved (a dry run) instead of
 * the edit's working copy.
 */
export function previewOverlay(editId: string | null, overlayId: string, times?: number[], given?: { spec: EditSpec; workspaceId: string }) {
  const next = busy.then(() => run(editId, overlayId, times, given));
  busy = next.catch(() => {});
  return next;
}

async function run(editId: string | null, overlayId: string, times?: number[], given?: { spec: EditSpec; workspaceId: string }) {
  const edit = given || !editId ? null : getEdit(editId);
  if (!given && !edit) throw new Error('No edit to preview.');
  const spec = normalizeEdit(given?.spec ?? edit!.working);
  const workspaceId = given?.workspaceId ?? edit!.workspaceId;
  const found = spec.overlays.find((x) => x.id === overlayId);
  if (!found) throw new Error('There’s no overlay with that id on this edit.');
  // One held for a whole video (a name tag, a tracker) is only drawn as far as the stills asked for reach.
  const reach = Math.max(8, ...(times ?? []).map((t) => t + 1.5));
  const o = found.end - found.start > 20 && times?.length && reach < found.end - found.start ? ({ ...found, end: found.start + reach } as EditOverlay) : found;
  const len = o.end - o.start;
  const dir = join(config.tmpDir, `preview-${newId()}`);
  await mkdir(join(dir, 'media'), { recursive: true });
  await mkdir(join(dir, 'fonts'), { recursive: true });
  try {
    // The picture under it: a still of each main-track clip the overlay plays over, held for as long as it does and
    // framed as in the edit (a scene that runs across a cut has the right footage either side of it).
    const starts = clipStarts(spec);
    const under = spec.clips
      .map((clip, i) => ({ clip, start: starts[i], from: Math.max(starts[i], o.start), to: Math.min(starts[i] + clip.out - clip.in, o.end) }))
      .filter((u) => u.to - u.from > 0.02);
    const media = new Map<string, ComposeMedia>();
    const mini: EditSpec = { ...emptyEdit(), format: spec.format, captions: { ...spec.captions, enabled: false }, overlays: [{ ...o, start: 0, end: len } as EditOverlay] };
    const bgFiles: string[] = [];
    for (const [k, u] of under.entries()) {
      const m = getMedia(u.clip.mediaId);
      const file = m.kind === 'image' ? `bg${k}${extname(m.fileName).toLowerCase()}` : `bg${k}.jpg`;
      if (m.kind === 'image') await copyFile(mediaPath(m), join(dir, 'media', file));
      else await extractFrames(mediaPath(m), [u.clip.in + (u.from - u.start) + 0.01], () => join(dir, 'media', file), 1920);
      media.set(`bg${k}`, { id: `bg${k}`, kind: 'image', assetType: null, width: m.width, height: m.height, durationMs: null });
      bgFiles.push(file);
      // The last one runs to the overlay's end, whatever rounding did to the others.
      mini.clips.push({ ...u.clip, mediaId: `bg${k}`, in: 0, out: k === under.length - 1 ? Math.max(u.to - u.from, len - (u.from - o.start)) : u.to - u.from, transition: null });
    }
    if (!under.length) {
      // Nothing under it (a video made of scenes): black, so the preview still lasts as long as the overlay.
      const { width, height } = EDIT_FORMATS[spec.format];
      bgFiles.push('bg.png');
      await execFile(requireBinary('ffmpeg'), ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=black:s=${width}x${height}`, '-frames:v', '1', join(dir, 'media', 'bg.png')]);
      media.set('bg', { id: 'bg', kind: 'image', assetType: null, width, height, durationMs: null });
      mini.clips = normalizeEdit({ clips: [{ mediaId: 'bg', in: 0, out: len }] }).clips;
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
    for (const f of GSAP_FILES) await copyFile(gsapFilePath(f), join(dir, f));
    const { html } = composeEdit({
      spec: { ...mini, captions: { ...mini.captions, fontMediaId: spec.captions.fontMediaId } },
      mascot: getWorkspace(workspaceId).mascot,
      media,
      transcripts: {},
      clipSource: (i) => (bgFiles[i] ? { src: `media/${bgFiles[i]}`, mediaStart: 0 } : null),
      brollSource: () => null,
      fileUrl: (id) => `media/${files.get(id) ?? id}`,
      fontUrl: (file) => `fonts/${file}`,
      scripts: GSAP_FILES,
      preview: false,
    });
    // Silence, so the render has no sound effects to mix (they'd only slow it down).
    await writeFile(join(dir, 'index.html'), html.replace(/<audio [^>]*><\/audio>/g, ''));
    const chrome = await ensureRenderer();
    const output = join(dir, 'preview.mp4');
    await runWorker({ projectDir: dir, output, fps: PREVIEW_FPS }, chrome, () => {}, () => {}, new AbortController().signal);
    // The last frame is a frame before the end (a still asked for later has nothing to show).
    const at = (times?.length ? times : [0.15, 0.4, 0.65, 0.9].map((f) => f * len)).slice(0, 6).map((t) => Math.min(Math.max(0, t), Math.max(0, len - 1.5 / PREVIEW_FPS)));
    const stills = await extractFrames(output, at, (i) => join(dir, `still-${i}.jpg`), 540);
    return { times: at, images: await Promise.all(stills.map((f) => readFile(f))) };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
