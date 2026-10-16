import { tool } from '@anthropic-ai/claude-agent-sdk';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import {
  CAPTION_PRESET_DEFAULTS,
  CAPTION_PRESETS,
  GRAPHIC_INFO,
  GRAPHICS,
  SHORT_MAX_SECONDS,
  TIGHTEN_PRESETS,
  TRANSITION_INFO,
  TRANSITION_MAX,
  TRANSITION_MIN,
  TRANSITIONS,
  clipStarts,
  editDuration,
  newEditId,
  normalizeEdit,
  timelineWords,
  type EditSpec,
} from '../../../shared/edit';
import { BUILTIN_SFX, builtinSfxId, SFX_GROUPS } from '../../../shared/sfx';
import { ASSET_TYPES } from '../../../shared/types';
import { db, schema } from '../db';
import { createEdit, findEditForPiece, listEditVersions, listRenders, saveEditVersion, specMedia, specTranscripts } from '../studio/edits';
import { queueRender } from '../studio/render';
import { previewOverlay } from '../studio/preview';
import { normalizeScene, SCENE_FONTS, SCENE_MAX_ELEMENTS, SCENE_MAX_SECONDS, SCENE_MAX_TWEENS } from '../../../shared/scene';
import { clipToolsInstalled } from '../services/cliptools';
import { enqueue, hasPendingJob } from '../jobs/queue';
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
  transition: z
    .object({
      type: z.enum(TRANSITIONS).describe(TRANSITIONS.map((t) => `${t}: ${TRANSITION_INFO[t].hint}`).join('; ')),
      duration: z.number().min(TRANSITION_MIN).max(TRANSITION_MAX).optional().describe('Seconds; short (0.2–0.4) for energy, longer (0.5–0.8) for calm'),
      sound: z.boolean().optional().describe('Play a matching built-in sound effect (a whoosh, a shutter, a glitch)'),
    })
    .nullable()
    .optional()
    .describe('How this clip comes in after the one before (not on the first clip). Leave it out for a straight cut — most cuts should stay cuts; save transitions for a change of scene, topic or a reveal'),
});

const overlayShape = z.object({
  id: z.string().optional(),
  type: z.enum(['text', 'image', 'broll', 'graphic', 'scene']).describe('scene: only to keep or retime a scene you wrote with write_scene (id, start, end); its design stays as it is'),
  start: z.number().min(0).describe('Seconds on the finished video'),
  end: z.number(),
  template: z
    .enum(GRAPHICS)
    .optional()
    .describe(`graphic: ${GRAPHICS.map((g) => `${g} = ${GRAPHIC_INFO[g].label} (${GRAPHIC_INFO[g].hint}; ${Object.entries(GRAPHIC_INFO[g].fields).map(([k, v]) => (k === 'point' ? 'x/y = what it points at' : `${k} = ${v}`)).join(', ') || 'no words'})`).join('; ')}`),
  sub: z.string().optional().describe('graphic: the second line (see template)'),
  items: z.array(z.string()).max(6).optional().describe('graphic list: the points'),
  sound: z.boolean().optional().describe('graphic: its own built-in sound effects (default on)'),
  text: z.string().optional().describe('text and graphic: what it says; wrap the accent word in asterisks (*word*) to show it in the accent colour'),
  style: z.enum(['title', 'label', 'note']).optional().describe('text: title = big hook text, label = pill in the accent colour, note = small'),
  position: z.enum(['top', 'center', 'bottom']).optional().describe('text, and graphics that sit somewhere (progress: top or bottom edge)'),
  animation: z.enum(['pop', 'fade', 'slide', 'none']).optional(),
  mediaId: z.string().optional().describe('image / broll: library file'),
  x: z.number().min(0).max(1).optional().describe('image: centre, 0–1; graphic callout: the point it shows'),
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
    case 'follow_speaker':
      return 'Started reframing on the speaker';
    case 'write_scene':
      return input.name ? `Designed a scene: ${input.name}` : 'Designed a scene';
    case 'view_overlay':
      return 'Looked at a motion graphic';
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
        '`clips` and `overlays` replace the whole list when given — include the ones to keep. `captions`, `audio`, `grade` and `watermark` change only the fields you pass. ' +
        'There is no music; the nasheed track is the creator’s to set and stays as it is.',
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
            voiceVolume: z.number().min(0).max(2).optional(),
            enhanceVoice: z.boolean().optional(),
            normalize: z.boolean().optional(),
            sfx: z
              .array(
                z.object({
                  id: z.string().optional(),
                  mediaId: z.string().describe('A sound-effect asset id, or a built-in sound as builtin:<name> (list_assets)'),
                  at: z.number().min(0),
                  volume: z.number().min(0).max(2).optional(),
                }),
              )
              .optional(),
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
        // Scenes come back as id + times: their design is only changed by write_scene.
        const kept = overlays?.map((o) => {
          if (o.type !== 'scene') return o;
          const scene = spec.overlays.find((x) => x.id === o.id && x.type === 'scene');
          if (!scene) throw new ToolError(`There’s no scene with id ${o.id ?? '(none)'}: write new scenes with write_scene.`);
          return { ...scene, start: o.start, end: o.end };
        });
        const next: EditSpec = {
          ...spec,
          format: format ?? spec.format,
          clips: (clips as EditSpec['clips'] | undefined) ?? spec.clips,
          overlays: (kept as unknown as EditSpec['overlays'] | undefined) ?? spec.overlays,
          captions: { ...spec.captions, ...(captions?.preset && captions.preset !== spec.captions.preset ? CAPTION_PRESET_DEFAULTS[captions.preset] : {}), ...captions },
          // The nasheed stays the creator's (saveEditVersion keeps it too).
          audio: { ...spec.audio, ...(audio as Partial<EditSpec['audio']>), nasheed: spec.audio.nasheed },
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
      'follow_speaker',
      'Reframe a piece’s edit so the frame follows whoever is talking: the footage is split into shots, close-ups stay on their face, and wide shots of two or more ' +
        'people move to (and zoom in on) the one speaking, holding at least a second and a half. Runs on this computer for a minute or so, then saves a new version. ' +
        'Needs the clip tools. Use it when footage is wider than the output (a landscape podcast in 9:16) or when the creator asks to follow the speaker.',
      { pieceId: z.string() },
      safe(async ({ pieceId }) => {
        const edit = editFor(pieceId);
        if (!edit) throw new ToolError('This piece has no video edit yet.');
        if (!clipToolsInstalled()) throw new ToolError('The clip tools aren’t installed (Settings → Clip tools).');
        if (!hasPendingJob('edit.reframe', 'editId', edit.id)) enqueue('edit.reframe', { editId: edit.id, author: 'claude' }, { maxAttempts: 1 });
        return ok('Started: a new version is saved when it’s done (about a minute). Check it with get_edit afterwards.');
      }),
    ),

    tool(
      'write_scene',
      'Design a custom motion graphic (a scene) on a piece’s video, or rewrite one (pass its sceneId): when no motion-graphics template fits. ' +
        'A scene is data, not code: elements (box, text, image, path) styled with plain CSS, and GSAP tweens as JSON. ' +
        `The frame is 1080 px wide (1920 tall in 9:16); top-level elements are absolutely positioned on it. Fonts: ${SCENE_FONTS.join(', ')} (Brand = the creator’s brand font, if set). ` +
        'Styles may not load anything (no url(), no var()); colours as #hex or rgba(). Text marks accent words with *stars* (the brand’s accent colour). ' +
        'Tweens animate transforms (x, y, xPercent, yPercent, scale, rotation, skewX), opacity/autoAlpha, colours, borderRadius, filter, clipPath and strokeDashoffset (a path with draw: true goes from 1 to 0); ' +
        'use from for an explicit start state (fromTo), finite repeats only, and eases like power3.out or back.out(1.7). Times are seconds from the scene’s start. ' +
        'Anything not allowed is dropped and listed in the reply. Look at it with view_overlay afterwards and fix what doesn’t read well.',
      {
        pieceId: z.string(),
        sceneId: z.string().optional().describe('Rewrite this scene instead of adding one'),
        name: z.string().describe('What it is, e.g. "Before/after split"'),
        start: z.number().min(0).describe('Seconds on the finished video'),
        end: z.number().describe(`At most ${SCENE_MAX_SECONDS} s after start`),
        background: z.string().optional().describe('none (the video shows, default), dim (the video darkened), or a solid #rrggbb'),
        elements: z
          .array(
            z.object({
              id: z.string().describe('lowercase-with-dashes, unique'),
              kind: z.enum(['box', 'text', 'image', 'path']),
              text: z.string().optional().describe('text: the words (*accent*, \\n for a new line)'),
              split: z.enum(['words', 'chars']).optional().describe('text: so tweens can target "<id>.words" / "<id>.chars" with a stagger'),
              mediaId: z.string().optional().describe('image: a library image (list_assets, or the piece’s footage)'),
              d: z.string().optional().describe('path: SVG path data in frame pixels'),
              draw: z.boolean().optional().describe('path: start undrawn (animate strokeDashoffset 1 → 0)'),
              parent: z.string().optional().describe('The id of a box this sits inside (listed before it)'),
              style: z.record(z.string(), z.union([z.string(), z.number()])).optional().describe('CSS, e.g. { left: 90, top: 400, width: 900, "font-size": 96, color: "#ffffff" }; numbers are px'),
            }),
          )
          .min(1)
          .max(SCENE_MAX_ELEMENTS),
        tweens: z
          .array(
            z.object({
              targets: z.string().describe('Element ids, comma-separated; "<id>.words" / "<id>.chars" for split text'),
              at: z.number().min(0),
              duration: z.number().min(0),
              from: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
              to: z.record(z.string(), z.union([z.string(), z.number()])),
              ease: z.string().optional(),
              stagger: z.number().optional(),
              repeat: z.number().int().min(0).max(20).optional(),
              yoyo: z.boolean().optional(),
            }),
          )
          .max(SCENE_MAX_TWEENS),
      },
      safe(async ({ pieceId, sceneId, name, start, end, background, elements, tweens }) => {
        const edit = editFor(pieceId) ?? createEdit(pieceId, 'claude');
        const spec = normalizeEdit(edit.working);
        if (sceneId && !spec.overlays.some((o) => o.id === sceneId && o.type === 'scene')) throw new ToolError(`There’s no scene with id ${sceneId} on this edit.`);
        if (end <= start) throw new ToolError('end must be after start.');
        const problems: string[] = [];
        const scene = normalizeScene({ name, background, elements, tweens }, Math.min(end - start, SCENE_MAX_SECONDS), problems);
        if (!scene.elements.length) throw new ToolError(`Nothing could be kept: ${problems.join('; ')}`);
        const id = sceneId ?? newEditId();
        const overlay = { id, type: 'scene' as const, start, end: Math.min(end, start + SCENE_MAX_SECONDS), ...scene };
        const next: EditSpec = { ...spec, overlays: [...spec.overlays.filter((o) => o.id !== id), overlay].sort((a, b) => a.start - b.start) };
        const { version } = saveEditVersion(edit.id, { author: 'claude', message: `${sceneId ? 'Reworked' : 'Added'} the scene “${scene.name}”`, spec: next });
        return ok(
          `Saved v${version.number}: scene ${id}, ${scene.elements.length} element(s), ${scene.tweens.length} tween(s).` +
            (problems.length ? ` Dropped: ${problems.slice(0, 20).join('; ')}.` : '') +
            ' Check it with view_overlay.',
        );
      }),
    ),

    tool(
      'view_overlay',
      'See stills of one overlay (a scene you wrote, or a motion graphic) as it will render, over the footage under it — to check layout, legibility and timing. Takes about half a minute.',
      { pieceId: z.string(), overlayId: z.string(), atSeconds: z.array(z.number().min(0)).max(6).optional().describe('Seconds into the overlay; default four spread across it') },
      safe(async ({ pieceId, overlayId, atSeconds }) => {
        const edit = editFor(pieceId);
        if (!edit) throw new ToolError('This piece has no video edit yet.');
        const { times, images } = await previewOverlay(edit.id, overlayId, atSeconds);
        return {
          content: [
            { type: 'text', text: `Stills at ${times.map((t) => `${t.toFixed(2)} s`).join(', ')} into the overlay (no captions or other overlays shown).` },
            ...images.map((img) => ({ type: 'image' as const, data: img.toString('base64'), mimeType: 'image/jpeg' })),
          ],
        };
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
      'List the workspace’s brand assets — sound effects, LUTs (colour grades), logos, fonts, nasheeds — with their ids, and the app’s own sound effects (builtin:<name>, usable in any edit).',
      { type: z.enum(ASSET_TYPES).optional() },
      safe(async ({ type }) => {
        const rows = db
          .select()
          .from(schema.media)
          .where(and(eq(schema.media.workspaceId, workspaceId), type ? eq(schema.media.assetType, type) : isNotNull(schema.media.assetType)))
          .orderBy(desc(schema.media.createdAt))
          .limit(100)
          .all();
        const assets = rows.map((m) => ({ id: m.id, name: m.originalName, type: m.assetType, seconds: m.durationMs ? Math.round(m.durationMs / 100) / 10 : undefined, notes: m.notes || undefined }));
        const builtin = !type || type === 'sfx' ? BUILTIN_SFX.map((s) => ({ id: builtinSfxId(s.name), name: s.label, group: SFX_GROUPS[s.group], use: s.use, seconds: s.seconds })) : undefined;
        return ok({ assets, builtinSoundEffects: builtin, note: type === 'nasheed' || (!type && rows.some((m) => m.assetType === 'nasheed')) ? 'Nasheeds are vocal only; only the creator can put one on an edit.' : undefined });
      }),
    ),
  ];
}
