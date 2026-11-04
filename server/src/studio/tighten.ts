import { editDuration, fillerRangesFromTranscript, normalizeEdit, smoothJumps, speechRangesFromTranscript, tightenClips, type TightenOptions } from '../../../shared/edit';
import { detectSpeech } from '../lib/ffmpeg';
import { badRequest } from '../lib/http';
import { mediaPath } from '../services/media';
import type { TranscriptWord } from '../../../shared/types';
import { refineWords, snapCuts, voiceEnvelope, type Envelope } from './clean-cuts';
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
  const fillers: Record<string, [number, number][]> = {};
  const voices = new Map<string, { env: Envelope; words: TranscriptWord[] }>();
  for (const id of new Set(spec.clips.map((c) => c.mediaId))) {
    const m = rows.find((r) => r.id === id);
    const t = transcripts[id];
    if (!m || m.kind !== 'video') speech[id] = null;
    else if (t && t.segments.some((s) => s.words?.length)) {
      // Word times fitted to the voice, so the cuts land in real pauses (Whisper's times are close, not exact).
      const env = await voiceEnvelope(mediaPath(m)).catch(() => null);
      const fitted = env ? refineWords(t, env) : t;
      if (env) voices.set(id, { env, words: fitted.segments.flatMap((s) => s.words ?? []) });
      speech[id] = speechRangesFromTranscript(fitted, opts.removeFillers);
      fillers[id] = fillerRangesFromTranscript(fitted);
    } else speech[id] = await detectSpeech(mediaPath(m), 0, (m.durationMs ?? 0) / 1000 || 3600).catch(() => null);
  }
  let clips = tightenClips(spec.clips, speech, opts, fillers);
  for (const [id, v] of voices) clips = snapCuts(clips, id, v.env, v.words);
  clips = smoothJumps(clips);
  if (!clips.length) throw badRequest('Couldn’t find any speech to keep, so nothing was cut.');
  const removed = Math.max(0, editDuration(spec) - editDuration({ clips }));
  const { version } = saveEditVersion(editId, { author: by, message: `Tightened: cut ${removed.toFixed(1)} s`, spec: { ...spec, clips } });
  return { removedSeconds: Math.round(removed * 10) / 10, clips: clips.length, version: version.number };
}
