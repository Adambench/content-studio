import { tool } from '@anthropic-ai/claude-agent-sdk';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import {
  CAPTION_PRESET_DEFAULTS,
  CAPTION_PRESETS,
  SHORT_MAX_SECONDS,
  TIGHTEN_PRESETS,
  clipStarts,
  editDuration,
  normalizeEdit,
  timelineWords,
  type EditSpec,
} from '../../../shared/edit';
import { db, schema } from '../db';
import { createEdit, findEditForPiece, listEditVersions, listRenders, saveEditVersion, specMedia, specTranscripts } from '../studio/edits';
import { queueRender } from '../studio/render';
import { tightenEdit } from '../studio/tighten';
import { ok, safe, ToolError } from './tool-helpers';

const clipShape = z.object({
  id: z.string().optional().describe('Keep the id when changing an existing clip'),
  mediaId: z.string().describe('A video or photo from the library'),
  in: z.number().min(0).describe('Start in the source, seconds (photos: 0)'),
  out: z.number().describe('End in the source, seconds (photos: how long it shows)'),
  focusX: z.number().min(0).max(1).optional().describe('Reframe: horizontal position of the subject, 0 = left, 1 = right'),
  focusY: z.number().min(0).max(1).optional(),
  zoom: z.number().min(1).max(3).optional().describe('1 = fill the frame; 1.1–1.2 is a punch-in'),
  volume: z.number().min(0).max(2).optional().describe('Clip sound, 0 = muted'),
});

const overlayShape = z.object({
  id: z.string().optional(),
  type: z.enum(['text', 'image', 'broll']),
  start: z.number().min(0).describe('Seconds on the finished video'),
  end: z.number(),
  text: z.string().optional().describe('text: what it says'),
  style: z.enum(['title', 'label', 'note']).optional().describe('text: title = big hook text, label = pill in the accent colour, note = small'),
  position: z.enum(['top', 'center', 'bottom']).optional().describe('text'),
  animation: z.enum(['pop', 'fade', 'slide', 'none']).optional(),
  mediaId: z.string().optional().describe('image / broll: library file'),
  x: z.number().min(0).max(1).optional().describe('image: centre, 0–1'),
  y: z.number().min(0).max(1).optional(),
  width: z.number().min(0.05).max(1).optional().describe('image: width as a fraction of the frame'),
  in: z.number().min(0).optional().describe('broll: where in the source to start'),
  layout: z.enum(['full', 'top', 'pip']).optional().describe('broll: whole frame, top half, or picture-in-picture'),
  focusX: z.number().min(0).max(1).optional(),
  focusY: z.number().min(0).max(1).optional(),
});

/** Labels for the tool chips in the chat UI. */
export function studioToolLabel(name: string, input: Record<string, any>): string | null {
  switch (name) {
    case 'get_edit':
      return 'Opened the video edit';
    case 'update_edit':
      return input.message ? `Edited video: ${input.message}` : 'Edited the video';
    case 'tighten_edit':
      return 'Cut the pauses';
    case 'render_edit':
      return 'Started a render';
    case 'list_assets':
      return 'Browsed brand assets';
    default:
      return null;
  }
}

/** Video studio tools, scoped like the rest to one workspace. */
export function studioTools(workspaceId: string, ownPiece: (pieceId: string) => unknown) {
  const editFor = (pieceId: string) => {
    ownPiece(pieceId);
    return findEditForPiece(pieceId);
  };

  async function describe(pieceId: string) {
    const edit = editFor(pieceId);
    if (!edit) {
      const footage = db
        .select()
        .from(schema.media)
        .where(and(eq(schema.media.pieceId, pieceId), eq(schema.media.workspaceId, workspaceId)))
        .all()
        .filter((m) => !m.assetType && m.source !== 'render' && (m.kind === 'video' || m.kind === 'image'));
      return { exists: false, note: 'No edit yet. update_edit (or tighten_edit) starts one from the piece’s footage.', footage: footage.map((m) => ({ id: m.id, name: m.originalName, kind: m.kind, seconds: m.durationMs ? m.durationMs / 1000 : undefined })) };
    }
    const spec = normalizeEdit(edit.working);
    const rows = specMedia(spec);
    const byId = new Map(rows.map((m) => [m.id, m]));
    const transcripts = await specTranscripts(spec, rows);
    const words = timelineWords(spec, transcripts);
    const starts = clipStarts(spec);
    const duration = editDuration(spec);
    const warnings: string[] = [];
    const untranscribed = [...new Set(spec.clips.map((c) => c.mediaId))].filter((id) => byId.get(id)?.kind === 'video' && !transcripts[id]);
    if (untranscribed.length) warnings.push(`${untranscribed.length} clip source(s) have no transcript, so they get no captions.`);
    if (duration > SHORT_MAX_SECONDS) warnings.push(`Longer than ${SHORT_MAX_SECONDS} s — too long for Reels and Shorts.`);
    const last = listRenders(edit.id, 1)[0];
    return {
      exists: true,
      format: spec.format,
      durationSeconds: duration,
      clips: spec.clips.map((c, i) => ({
        ...c,
        file: byId.get(c.mediaId)?.originalName ?? 'missing file',
        kind: byId.get(c.mediaId)?.kind,
        sourceSize: byId.get(c.mediaId)?.width ? `${byId.get(c.mediaId)?.width}x${byId.get(c.mediaId)?.height}` : undefined,
        startsAt: Math.round(starts[i] * 100) / 100,
        said: words.filter((w) => w.clipId === c.id).map((w) => w.text).join(' ') || undefined,
      })),
      captions: spec.captions,
      overlays: spec.overlays,
      audio: spec.audio,
      grade: spec.grade,
      watermark: spec.watermark,
      recentVersions: listEditVersions(edit.id).slice(0, 5).map((v) => `v${v.number} (${v.author}): ${v.message}`),
      lastRender: last ? { status: last.status, version: last.versionNumber, error: last.error ?? undefined } : undefined,
      warnings: warnings.length ? warnings : undefined,
    };
  }

  return [
    tool(
      'get_edit',
      'Get a piece’s video edit: clips (with what is said in each), captions, overlays, sound, grade and watermark.',
      { pieceId: z.string() },
      safe(async ({ pieceId }) => ok(await describe(pieceId))),
    ),

    tool(
      'update_edit',
      'Change a piece’s video edit and save it as a new version authored by you (starting the edit if there is none). ' +
        '`clips` and `overlays` replace the whole list when given — include the ones to keep. `captions`, `audio`, `grade` and `watermark` change only the fields you pass.',
      {
        pieceId: z.string(),
        message: z.string().describe('Short version note, e.g. "Best takes, hook first"'),
        format: z.enum(['9:16', '4:5', '1:1']).optional(),
        clips: z.array(clipShape).optional(),
        overlays: z.array(overlayShape).optional(),
        captions: z
          .object({
            enabled: z.boolean().optional(),
            preset: z.enum(CAPTION_PRESETS).optional(),
            position: z.number().min(0.05).max(0.95).optional().describe('Vertical centre, 0 = top, 1 = bottom'),
            size: z.number().min(0.6).max(1.6).optional(),
            color: z.string().optional().describe('#rrggbb'),
            highlight: z.string().optional().describe('#rrggbb accent for the spoken word'),
            uppercase: z.boolean().optional(),
            maxWords: z.number().int().min(1).max(8).optional(),
            fontMediaId: z.string().nullable().optional(),
          })
          .optional(),
        audio: z
          .object({
            musicMediaId: z.string().nullable().optional(),
            musicStart: z.number().min(0).optional(),
            musicVolume: z.number().min(0).max(1).optional(),
            duck: z.boolean().optional(),
            voiceVolume: z.number().min(0).max(2).optional(),
            enhanceVoice: z.boolean().optional(),
            normalize: z.boolean().optional(),
            sfx: z.array(z.object({ id: z.string().optional(), mediaId: z.string(), at: z.number().min(0), volume: z.number().min(0).max(2).optional() })).optional(),
          })
          .optional(),
        grade: z.object({ lutMediaId: z.string().nullable().optional(), intensity: z.number().min(0).max(1).optional() }).optional(),
        watermark: z
          .object({ mediaId: z.string().nullable().optional(), corner: z.enum(['tl', 'tr', 'bl', 'br']).optional(), opacity: z.number().min(0.1).max(1).optional(), size: z.number().min(0.05).max(0.5).optional() })
          .optional(),
      },
      safe(async ({ pieceId, message, format, clips, overlays, captions, audio, grade, watermark }) => {
        const edit = editFor(pieceId) ?? createEdit(pieceId, 'claude');
        const spec = normalizeEdit(edit.working);
        const next: EditSpec = {
          ...spec,
          format: format ?? spec.format,
          clips: (clips as EditSpec['clips'] | undefined) ?? spec.clips,
          overlays: (overlays as unknown as EditSpec['overlays'] | undefined) ?? spec.overlays,
          captions: { ...spec.captions, ...(captions?.preset && captions.preset !== spec.captions.preset ? CAPTION_PRESET_DEFAULTS[captions.preset] : {}), ...captions },
          audio: { ...spec.audio, ...(audio as Partial<EditSpec['audio']>) },
          grade: { ...spec.grade, ...grade },
          watermark: { ...spec.watermark, ...watermark },
        };
        const { version, unchanged } = saveEditVersion(edit.id, { author: 'claude', message, spec: next });
        if (unchanged) return ok('No changes — the edit already looked like that.');
        const saved = normalizeEdit(version.spec);
        return ok(`Saved v${version.number}. The video is now ${editDuration(saved).toFixed(1)} s with ${saved.clips.length} clip(s).`);
      }),
    ),

    tool(
      'tighten_edit',
      'Cut the pauses (and optionally filler words like um/uh) out of every clip, using word timings from the transcripts. Saves a new version. Starts the edit from the piece’s footage if there is none.',
      {
        pieceId: z.string(),
        pauses: z.enum(['natural', 'tight']).describe('natural keeps breathing room (cuts pauses over 0.7 s); tight cuts anything over 0.35 s'),
        removeFillers: z.boolean().optional(),
        punchIn: z.boolean().optional().describe('Alternate a slight zoom on consecutive cuts of the same shot'),
      },
      safe(async ({ pieceId, pauses, removeFillers, punchIn }) => {
        const edit = editFor(pieceId) ?? createEdit(pieceId, 'claude');
        const opts = { ...TIGHTEN_PRESETS[pauses], ...(removeFillers !== undefined && { removeFillers }), ...(punchIn !== undefined && { punchIn }) };
        const r = await tightenEdit(edit.id, opts, 'claude');
        return ok(`Cut ${r.removedSeconds} s; ${r.clips} clip(s) now. Saved v${r.version}.`);
      }),
    ),

    tool(
      'render_edit',
      'Render a piece’s video edit to an MP4 on this computer (takes a few minutes). The finished video appears in the piece’s footage. Never posts anything.',
      { pieceId: z.string() },
      safe(async ({ pieceId }) => {
        const edit = editFor(pieceId);
        if (!edit) throw new ToolError('This piece has no video edit yet.');
        const r = queueRender(edit.id, 'claude');
        return ok(`Render of v${r.versionNumber} queued. The creator can watch its progress in the video editor.`);
      }),
    ),

    tool(
      'list_assets',
      'List the workspace’s brand assets — music, sound effects, LUTs (colour grades), logos and fonts — with their ids.',
      { type: z.enum(['logo', 'font', 'lut', 'music', 'sfx', 'template', 'other']).optional() },
      safe(async ({ type }) => {
        const rows = db
          .select()
          .from(schema.media)
          .where(and(eq(schema.media.workspaceId, workspaceId), type ? eq(schema.media.assetType, type) : isNotNull(schema.media.assetType)))
          .orderBy(desc(schema.media.createdAt))
          .limit(100)
          .all();
        return ok(rows.map((m) => ({ id: m.id, name: m.originalName, type: m.assetType, seconds: m.durationMs ? Math.round(m.durationMs / 100) / 10 : undefined, notes: m.notes || undefined })));
      }),
    ),
  ];
}
