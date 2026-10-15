import { editDuration, normalizeEdit, speechRangesFromTranscript, tightenClips, type TightenOptions } from '../../../shared/edit';
import { detectSpeech } from '../lib/ffmpeg';
import { badRequest } from '../lib/http';
import { mediaPath } from '../services/media';
import type { Author } from '../services/pieces';
import { getEdit, saveEditVersion, specMedia, specTranscripts } from './edits';

/**
 * Cut the pauses (and optionally filler words) out of every clip, from the transcript's word timings — or, for
 * footage that isn't transcribed, from FFmpeg's silence detection. Mechanical, so no Claude involved.
 */
export async function tightenEdit(editId: string, opts: TightenOptions, by: Author) {
  const edit = getEdit(editId);
  const spec = normalizeEdit(edit.working);
  if (!spec.clips.length) throw badRequest('There are no clips to tighten.');
  const rows = specMedia(spec);
  const transcripts = await specTranscripts(spec, rows);
  const speech: Record<string, [number, number][] | null> = {};
  for (const id of new Set(spec.clips.map((c) => c.mediaId))) {
    const m = rows.find((r) => r.id === id);
    const t = transcripts[id];
    if (!m || m.kind !== 'video') speech[id] = null;
    else if (t && t.segments.some((s) => s.words?.length)) speech[id] = speechRangesFromTranscript(t, opts.removeFillers);
    else speech[id] = await detectSpeech(mediaPath(m), 0, (m.durationMs ?? 0) / 1000 || 3600).catch(() => null);
  }
  const clips = tightenClips(spec.clips, speech, opts);
  if (!clips.length) throw badRequest('Couldn’t find any speech to keep, so nothing was cut.');
  const removed = Math.max(0, editDuration(spec) - editDuration({ clips }));
  const { version } = saveEditVersion(editId, { author: by, message: `Tightened: cut ${removed.toFixed(1)} s`, spec: { ...spec, clips } });
  return { removedSeconds: Math.round(removed * 10) / 10, clips: clips.length, version: version.number };
}
