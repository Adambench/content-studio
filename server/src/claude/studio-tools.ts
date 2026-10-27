import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tool } from '@anthropic-ai/claude-agent-sdk';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import {
  CAPTION_PRESET_DEFAULTS,
  CAPTION_PRESETS,
  GRAPHIC_INFO,
  GRAPHICS,
  SHORT_MAX_SECONDS,
  STORY_TEXT_MAX,
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
import { motionSounds } from '../../../shared/sound-design';
import { ASSET_TYPES } from '../../../shared/types';
import { config } from '../config';
import { db, newId, schema } from '../db';
import { extractFrames } from '../lib/ffmpeg';
import { formatTime, mediaPath } from '../services/media';
import { createEdit, findEditForPiece, listEditVersions, listRenders, saveEditVersion, specMedia, specTranscripts } from '../studio/edits';
import { queueRender } from '../studio/render';
import { checkEdit } from '../studio/quality';
import { QUALITY_BAR, qualityText } from '../../../shared/quality';
import { previewOverlay } from '../studio/preview';
import { normalizeScene, SCENE_FONTS, SCENE_MAX_ELEMENTS, SCENE_MAX_SECONDS, SCENE_MAX_TWEENS } from '../../../shared/scene';
import { CHARACTERS, normalizeRecipe, RECIPE_INFO, recipeNeedsBuild, VOICES } from '../../../shared/recipe';
import { ttsInstalled } from '../services/tts';
import { clipToolsInstalled } from '../services/cliptools';
import { enqueue, hasPendingJob } from '../jobs/queue';
import { tightenEdit } from '../studio/tighten';
import { arsenalText } from '../studio/arsenal';
import { BACKGROUND_STYLES, MATTE_EFFECTS, MATTE_EFFECT_INFO } from '../../../shared/effects';
import { matteReady, queueEffect } from '../studio/effects';
import { ARSENAL_KINDS, type ArsenalKind } from '../../../shared/arsenal';
import { BROLL_LAYOUT_INFO, BROLL_LAYOUTS, CLIP_MOTION_INFO, CLIP_MOTIONS, FILTER_LOOK_INFO, FILTER_LOOKS, OVERLAY_ANIMATION_INFO, OVERLAY_ANIMATIONS, TEXTURE_INFO } from '../../../shared/looks';
import { BUNDLED_FONTS } from '../../../shared/fonts';
import { GEN_ASPECTS, GEN_PURPOSE_INFO, GEN_PURPOSES, NO_LIVING_BEINGS } from '../../../shared/generate';
import { workerFor } from '../compute/workers';
import { generationSettings, queueGeneration } from '../studio/generate';
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
  motion: z
    .enum(CLIP_MOTIONS)
    .optional()
    .describe(`Camera move over the clip: ${CLIP_MOTIONS.map((m) => `${m} (${CLIP_MOTION_INFO[m].hint})`).join('; ')}`),
  filter: z
    .enum(FILTER_LOOKS)
    .nullable()
    .optional()
    .describe('This clip’s own colour look (null = the video’s grade.filter): for a flashback, a dream, a twist'),
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
  animation: z
    .enum(OVERLAY_ANIMATIONS)
    .optional()
    .describe(`text / image: how it comes in — ${OVERLAY_ANIMATIONS.map((a) => `${a} (${OVERLAY_ANIMATION_INFO[a].hint})`).join('; ')}`),
  mediaId: z.string().optional().describe('image / broll: library file'),
  x: z.number().min(0).max(1).optional().describe('image: centre, 0–1; graphic callout: the point it shows'),
  y: z.number().min(0).max(1).optional(),
  width: z.number().min(0.05).max(1).optional().describe('image: width as a fraction of the frame'),
  in: z.number().min(0).optional().describe('broll: where in the source to start'),
  layout: z
    .enum(BROLL_LAYOUTS)
    .optional()
    .describe(`broll: ${BROLL_LAYOUTS.map((l) => `${l} = ${BROLL_LAYOUT_INFO[l].label} (${BROLL_LAYOUT_INFO[l].hint})`).join('; ')}`),
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
    case 'check_edit':
      return 'Checked the video’s quality';
    case 'view_render':
      return 'Watched the rendered video';
    case 'follow_speaker':
      return 'Started reframing on the speaker';
    case 'write_scene':
      return input.name ? `Designed a scene: ${input.name}` : 'Designed a scene';
    case 'view_overlay':
      return 'Looked at a motion graphic';
    case 'write_format_video':
      return input.kind ? `Wrote a ${RECIPE_INFO[input.kind as keyof typeof RECIPE_INFO]?.label.toLowerCase() ?? 'format'} video` : 'Wrote a format video';
    case 'list_assets':
      return 'Browsed brand assets';
    case 'apply_effect':
      return 'Started an effect on the person';
    case 'get_arsenal':
      return 'Looked through the toolbox of video moves';
    case 'generate_media':
      return input.kind === 'video' ? 'Queued a generated clip for tonight' : 'Started a generated picture';
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
      soundsOnMoves: spec.audio.autoSfx ? motionSounds(spec).length : undefined,
      grade: spec.grade,
      watermark: spec.watermark,
      story: spec.story,
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
            fontMediaId: z.string().nullable().optional().describe('A brand font from list_assets (wins over font)'),
            font: z
              .enum(BUNDLED_FONTS.map((f) => f.family) as [string, ...string[]])
              .nullable()
              .optional()
              .describe(`One of the app’s fonts instead of the preset’s (null = the preset’s): ${BUNDLED_FONTS.map((f) => `${f.family} (${f.hint})`).join('; ')}`),
          })
          .optional(),
        audio: z
          .object({
            voiceVolume: z.number().min(0).max(2).optional(),
            enhanceVoice: z.boolean().optional(),
            normalize: z.boolean().optional(),
            autoSfx: z.boolean().optional().describe('A sound effect on the frame of every move (scene tweens, overlay entrances, snap zooms) that has none. On by default; off for a serious or religious video'),
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
        grade: z
          .object({
            lutMediaId: z.string().nullable().optional(),
            intensity: z.number().min(0).max(1).optional(),
            filter: z
              .enum(FILTER_LOOKS)
              .optional()
              .describe(`Colour look over the whole video's footage (not the text): ${FILTER_LOOKS.map((f) => `${f} (${FILTER_LOOK_INFO[f].hint})`).join('; ')}`),
            textures: z
              .object({
                grain: z.number().min(0).max(1).optional().describe(TEXTURE_INFO.grain.hint),
                vignette: z.number().min(0).max(1).optional().describe(TEXTURE_INFO.vignette.hint),
                scanlines: z.number().min(0).max(1).optional().describe(TEXTURE_INFO.scanlines.hint),
                leak: z.number().min(0).max(1).optional().describe(TEXTURE_INFO.leak.hint),
                letterbox: z.boolean().optional().describe(TEXTURE_INFO.letterbox.hint),
                border: z.number().min(0).max(0.06).optional().describe(TEXTURE_INFO.border.hint + ' (0.01–0.03 is tasteful)'),
              })
              .optional()
              .describe('Film textures over the whole video, under the text; 0 = off. Subtle wins (0.2–0.5)'),
          })
          .optional(),
        watermark: z
          .object({ mediaId: z.string().nullable().optional(), corner: z.enum(['tl', 'tr', 'bl', 'br']).optional(), opacity: z.number().min(0.1).max(1).optional(), size: z.number().min(0.05).max(0.5).optional() })
          .optional(),
        story: z
          .object({
            promise: z.string().max(STORY_TEXT_MAX).optional().describe('What the hook promises the viewer, in one concrete line'),
            payoff: z.string().max(STORY_TEXT_MAX).optional().describe('What they get for staying: the answer, the reveal, the result'),
            payoffAt: z.number().min(0).nullable().optional().describe('The second on the finished video where the payoff lands (second half, near the end)'),
          })
          .optional()
          .describe('The content model: hook (a promise) → content that builds toward it → payoff. Set it whenever you build or change an edit; the quality check reads it'),
      },
      safe(async ({ pieceId, message, format, clips, overlays, captions, audio, grade, watermark, story }) => {
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
          grade: { ...spec.grade, ...grade, textures: { ...spec.grade.textures, ...grade?.textures } },
          watermark: { ...spec.watermark, ...watermark },
          story: { ...spec.story, ...story },
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
        'CSS covers layout (flex, grid), gradients (background-image: linear/radial/conic-gradient), gradient text (background-clip: text with -webkit-text-fill-color: transparent), masks from gradients, blend modes, backdrop-filter, 3D (perspective, transform-style, backface-visibility), outlines, shadows and strokes. ' +
        'Tweens animate transforms in 2D and 3D (x, y, z, xPercent, yPercent, scale, scaleX/Y, rotation, rotationX/Y, skewX/Y, transformPerspective, transformOrigin), opacity/autoAlpha, colours, size and place (width, height, left, top), fontSize, letterSpacing, ' +
        'boxShadow, textShadow, background position/size/gradient, borderRadius, filter, clipPath, strokeDashoffset (a path with draw: true goes from 1 to 0), strokeDasharray, strokeWidth — and GSAP plugins: ' +
        'text (types a string out, TextPlugin), innerText (counts a number up, whole numbers), drawSVG ("0% 100%" on a path), motionPath (moves an element along SVG path data or "#pathId"), morphSVG (turns a path into "#otherPathId" or new path data); ' +
        'physics throws an element (velocity px/s, angle in degrees, gravity) for confetti, sparks and falling things. ' +
        'Use from for an explicit start state (fromTo), finite repeats only (repeatDelay between them), stagger as seconds or { each, from: "center" | "end" | "edges" | index }, and eases like power3.out, back.out(1.7), elastic.out(1, 0.4), bounce.out, expo.inOut, steps(6), slow(0.7, 0.7), wiggle-6 (wobbles out and settles back) or shake-8 (an even shake) — a wiggle or shake swings from the start value towards `to` and returns to the start, so `to` is how far it swings (e.g. rotation: 8). Times are seconds from the scene’s start. ' +
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
              stagger: z
                .union([z.number(), z.object({ each: z.number(), from: z.union([z.enum(['start', 'center', 'end', 'edges']), z.number()]).optional() })])
                .optional(),
              repeat: z.number().int().min(0).max(20).optional(),
              repeatDelay: z.number().min(0).max(5).optional(),
              yoyo: z.boolean().optional(),
              physics: z.object({ velocity: z.number(), angle: z.number(), gravity: z.number().optional(), friction: z.number().optional() }).optional().describe('Throw it: px/s, degrees (-90 = up), px/s² (default 1200)'),
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
      'write_format_video',
      'Make a piece’s video from words instead of footage, or rewrite one: story (a story read over background footage, its title on a post card), ' +
        'chat (a text conversation that plays out message by message, each read aloud) or dialogue (two drawn characters talking, mouths moving with their voices). ' +
        'The voices are made on this computer (local work, like a render) and the video is laid out around them; the creator previews, renders and posts it. ' +
        'Write for the ear: short sentences, a hook in the first line, a payoff at the end, 20–60 s spoken (about 2.7 words a second). Never music. ' +
        `Voices: ${VOICES.map((v) => `${v.id} (${v.who})`).join(', ')}. Characters: ${CHARACTERS.map((c) => `${c.id} (${c.hint})`).join(', ')}.`,
      {
        pieceId: z.string(),
        kind: z.enum(['story', 'chat', 'dialogue']),
        story: z.object({ title: z.string().describe('The hook, read first and shown on the post card'), text: z.string(), author: z.string().optional().describe('Shown on the card as who posted it'), voice: z.string().optional() }).optional(),
        chat: z
          .object({
            contact: z.string().describe('The other person, as their name shows at the top'),
            messages: z.array(z.object({ from: z.enum(['them', 'me']), text: z.string() })).min(2).max(60),
            voices: z.object({ them: z.string(), me: z.string() }).optional(),
          })
          .optional(),
        dialogue: z
          .object({
            cast: z.array(z.object({ name: z.string(), look: z.enum(CHARACTERS.map((c) => c.id) as [string, ...string[]]), voice: z.string() })).length(2),
            lines: z.array(z.object({ who: z.union([z.literal(0), z.literal(1)]), text: z.string() })).min(2).max(80),
          })
          .optional(),
        speed: z.number().min(0.8).max(1.3).optional().describe('Reading speed, 1.05 by default'),
        backgrounds: z.array(z.string()).max(10).optional().describe('Library videos to play muted underneath (gameplay the creator recorded); leave out to keep what’s there'),
      },
      safe(async ({ pieceId, kind, story, chat, dialogue, speed, backgrounds }) => {
        const words = kind === 'story' ? story : kind === 'chat' ? chat : dialogue;
        if (!words) throw new ToolError(`Pass the ${kind} object with the words.`);
        const edit = editFor(pieceId) ?? createEdit(pieceId, 'claude');
        const spec = normalizeEdit(edit.working);
        const before = spec.recipe?.kind === kind ? spec.recipe : null;
        const recipe = normalizeRecipe({
          ...(before ?? {}),
          kind,
          ...words,
          ...(speed !== undefined && { speed }),
          backgrounds: backgrounds ?? spec.recipe?.backgrounds ?? [],
          builtFrom: before?.builtFrom ?? null,
        });
        if (!recipe) throw new ToolError('That recipe couldn’t be read.');
        const { version } = saveEditVersion(edit.id, { author: 'claude', message: `Wrote the ${RECIPE_INFO[kind].label.toLowerCase()} video`, spec: { ...spec, recipe } });
        const saved = normalizeEdit(version.spec).recipe!;
        if (!recipeNeedsBuild(saved)) return ok(`Saved v${version.number}; the voice is already up to date.`);
        if (!ttsInstalled()) return ok(`Saved v${version.number}. The voices need the clip tools (Settings → Clip tools) before the video can be made — tell the creator.`);
        if (!hasPendingJob('format.build', 'editId', edit.id)) enqueue('format.build', { editId: edit.id, by: 'claude' }, { maxAttempts: 1 });
        return ok(`Saved v${version.number}. Making the voice now (about half the spoken length); the edit is laid out when it's done — check it with get_edit, then the creator can preview and render.`);
      }),
    ),

    tool(
      'check_edit',
      'The quality check of a piece’s video edit as it is now (saved as a version first): a score out of 100 for the hook, promise → payoff, pacing, motion, sound on motion, captions and the first frame, with what was measured and the fixes. ' +
        `Below ${QUALITY_BAR} it gets fixed before it renders. Takes up to half a minute.`,
      { pieceId: z.string() },
      safe(async ({ pieceId }) => {
        const edit = editFor(pieceId);
        if (!edit) throw new ToolError('This piece has no video edit yet.');
        return ok(qualityText(await checkEdit(edit.id, 'claude')));
      }),
    ),

    tool(
      'render_edit',
      'Render a piece’s video edit to an MP4 on this computer (takes a few minutes). The finished video appears in the piece’s footage. Never posts anything. ' +
        `It runs the quality check first: below ${QUALITY_BAR}/100 nothing renders and you get the fixes; make them with update_edit and call render_edit again. anyway: true renders it as it is.`,
      { pieceId: z.string(), anyway: z.boolean().optional().describe('Render even below the bar (after one round of fixes, or when the creator says so)') },
      safe(async ({ pieceId, anyway }) => {
        const edit = editFor(pieceId);
        if (!edit) throw new ToolError('This piece has no video edit yet.');
        if (!anyway) {
          const report = await checkEdit(edit.id, 'claude');
          if (report.score < report.bar) return ok(`Not rendered yet.\n\n${qualityText(report)}\n\nFix it with update_edit, then call render_edit again (anyway: true renders it as it is).`);
          const r = queueRender(edit.id, 'claude');
          return ok(`Quality ${report.score}/100. Render of v${r.versionNumber} queued. The creator can watch its progress in the video editor.`);
        }
        const r = queueRender(edit.id, 'claude');
        return ok(`Render of v${r.versionNumber} queued. The creator can watch its progress in the video editor.`);
      }),
    ),

    tool(
      'apply_effect',
      'An effect that needs to know where the person is: the person is cut out locally and the rest changes. ' +
        `Effects: ${MATTE_EFFECTS.map((e) => `${e} (${MATTE_EFFECT_INFO[e].hint})`).join('; ')}. ` +
        'It takes a few minutes (a person matte of the whole video, made once and kept) and runs in the background: the edit gets a new version by itself when it is done (a clip in Review re-renders too), so do not wait for it and do not start it twice. ' +
        'Only for footage with a person in it; look with view_frames first. Applies to the clip’s source video wherever the edit uses it.',
      {
        pieceId: z.string(),
        mediaId: z.string().describe('The video (one of the edit’s clips’ mediaId) to apply it to'),
        effect: z.enum(MATTE_EFFECTS),
        style: z.enum(BACKGROUND_STYLES).optional().describe('background: blur, dim, color or image'),
        color: z.string().optional().describe('A colour like #ffcc00 (background color, glow)'),
        imageMediaId: z.string().optional().describe('background image: a picture from list_assets or the piece’s footage'),
      },
      safe(async ({ pieceId, mediaId, effect, style, color, imageMediaId }) => {
        const edit = editFor(pieceId);
        if (!edit) throw new ToolError('This piece has no video edit yet.');
        const m = db.select().from(schema.media).where(and(eq(schema.media.id, mediaId), eq(schema.media.workspaceId, workspaceId))).get();
        if (!m || m.kind !== 'video') throw new ToolError('That isn’t a video in this workspace.');
        if (!normalizeEdit(edit.working).clips.some((c) => c.mediaId === mediaId)) throw new ToolError('The edit doesn’t use that video.');
        if (!matteReady()) throw new ToolError('The person model isn’t installed: the creator needs to install the clip tools again (Settings → Clip tools).');
        if (hasPendingJob('media.effect', 'mediaId', mediaId)) throw new ToolError('An effect on this video is already being made.');
        if (effect === 'background' && (style ?? 'blur') === 'image' && !imageMediaId) throw new ToolError('A picture background needs imageMediaId.');
        queueEffect({ pieceId, editId: edit.id, mediaId, effect, options: { style, color, imageMediaId } });
        return ok(`Started: ${MATTE_EFFECT_INFO[effect].label.toLowerCase()}. It runs in the background; the edit gets a new version when it is done.`);
      }),
    ),

    tool(
      'get_arsenal',
      'The arsenal: every move a video can use here (transitions, caption looks, motion graphics, custom scenes, formats, camera moves, cuts, sound effects) with when each fits and how to do it, ' +
        'and how often this page’s recent edits used each. Consider it whenever you plan or edit a video, pick what fits the idea, avoid what the last videos already leaned on so videos on this page differ, ' +
        'and say in a line which moves you chose and why. Items with ready=false are not built yet.',
      { kind: z.enum(Object.keys(ARSENAL_KINDS) as [ArsenalKind, ...ArsenalKind[]]).optional().describe('Only this group'), pieceId: z.string().optional().describe('The video you are working on, so its own edit does not count as "recent"') },
      safe(async ({ kind, pieceId }) => {
        if (pieceId) ownPiece(pieceId);
        return ok(arsenalText(workspaceId, { kind, excludePieceId: pieceId }));
      }),
    ),

    tool(
      'view_render',
      'See frames of a piece’s latest finished render, the video the creator is watching. Times are seconds into that video, which are also seconds on the edit’s timeline. ' +
        'Use it for the creator’s notes pinned to a moment ("0:07 — cut this pause"): look at the frame before changing anything. Note which edit version the render shows (the reply says).',
      { pieceId: z.string(), atSeconds: z.array(z.number().min(0)).min(1).max(6).describe('Seconds into the video; for a note, a little before it, at it and a little after') },
      safe(async ({ pieceId, atSeconds }) => {
        ownPiece(pieceId);
        const m = db
          .select()
          .from(schema.media)
          .where(and(eq(schema.media.pieceId, pieceId), eq(schema.media.workspaceId, workspaceId), eq(schema.media.source, 'render'), eq(schema.media.kind, 'video')))
          .orderBy(desc(schema.media.createdAt))
          .get();
        if (!m) throw new ToolError('This piece has no finished render yet.');
        const version = db.select({ n: schema.renders.versionNumber }).from(schema.renders).where(eq(schema.renders.mediaId, m.id)).get()?.n;
        const duration = (m.durationMs ?? 0) / 1000;
        const times = atSeconds.map((t) => Math.min(t, Math.max(0, duration - 0.1)));
        const prefix = join(config.framesDir, newId());
        const files = await extractFrames(mediaPath(m), times, (i) => `${prefix}-${i}.jpg`);
        try {
          const images = await Promise.all(files.map((f) => readFile(f)));
          const head = findEditForPiece(pieceId) && listEditVersions(findEditForPiece(pieceId)!.id)[0]?.number;
          return {
            content: [
              { type: 'text' as const, text: `Frames at ${times.map(formatTime).join(', ')} of the render of edit v${version ?? '?'} (${formatTime(duration)} long${head && version && head > version ? `; the edit is at v${head} now` : ''}).` },
              ...images.map((img) => ({ type: 'image' as const, data: img.toString('base64'), mimeType: 'image/jpeg' })),
            ],
          };
        } finally {
          await Promise.all(files.map((f) => rm(f, { force: true })));
        }
      }),
    ),

    tool(
      'generate_media',
      'Make a picture or a ~5 s video clip on the creator’s home PC (FLUX.1-schnell for pictures, a few minutes each; Wan 2.1 for clips, made overnight). ' +
        `For b-roll that shows what is said when there is no footage of it, a calm background, or a cover. Halal rule, always: describe places, objects, food, nature, buildings, light, weather, textures or screens only — ${NO_LIVING_BEINGS} ` +
        'Every result is checked and made again if a person or animal appears. Describe one concrete shot in plain words (subject, setting, light, angle), not a story. ' +
        'With pieceId and place it goes into that video’s edit as b-roll by itself when it is ready (a new version); otherwise it lands in the piece’s files. Runs in the background: don’t wait for it or start it twice.',
      {
        prompt: z.string().min(3).max(600).describe('One concrete shot, e.g. "a laptop on a wooden desk by a window at dawn, steam rising from a cup of tea"'),
        kind: z.enum(['image', 'video']).describe('image: ready in minutes; video: made tonight'),
        purpose: z.enum(GEN_PURPOSES).optional().describe(GEN_PURPOSES.map((p) => `${p}: ${GEN_PURPOSE_INFO[p].hint}`).join('; ')),
        aspect: z.enum(GEN_ASPECTS).optional().describe('Default 9:16'),
        pieceId: z.string().optional().describe('The video it is for'),
        place: z
          .object({ start: z.number().min(0), end: z.number().min(0.3), layout: z.enum(BROLL_LAYOUTS).optional() })
          .optional()
          .describe('Put it into the edit as b-roll from start to end (seconds on the timeline); needs pieceId'),
      },
      safe(async ({ prompt, kind, purpose, aspect, pieceId, place }) => {
        if (pieceId) ownPiece(pieceId);
        if (place && !pieceId) throw new ToolError('place needs pieceId.');
        if (place && place.end <= place.start) throw new ToolError('place.end must be after place.start.');
        if (place && !editFor(pieceId!)) throw new ToolError('This piece has no edit yet: start one first, or leave place out.');
        queueGeneration({
          workspaceId,
          by: 'claude',
          kind,
          prompt,
          purpose: purpose ?? 'broll',
          aspect: aspect ?? '9:16',
          pieceId: pieceId ?? null,
          place: place ? { start: place.start, end: place.end, layout: place.layout ?? 'full' } : null,
        });
        const s = generationSettings();
        const when = kind === 'video' ? `It will be made tonight (between ${s.videoFrom}:00 and ${s.videoTo}:00).` : 'It takes a few minutes.';
        const pc = workerFor(kind) ? '' : ' No home PC with this is online right now: it waits until one is.';
        return ok(`Queued. ${when}${pc} ${place ? 'It goes into the edit by itself when it is ready.' : 'It lands in the piece’s files.'}`);
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
