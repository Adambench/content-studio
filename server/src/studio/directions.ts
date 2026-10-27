// Creative directions (personal-brand and business pages): before a video's edit is built, Claude pitches 2–3 ways it
// could look and feel (hook, structure, look, moves from the arsenal, pacing). One Sonnet call, in the background
// (`direction.pitch`). The creator picks one or mixes them; the pick goes to the video's chat to write the script and
// build the edit. Clipping pages don't use this: their clips get a look from studio/clip-looks.ts.

import { and, desc, eq, isNotNull, ne } from 'drizzle-orm';
import { readyArsenal } from '../../../shared/arsenal';
import { directionText, normalizeDirection, normalizeDirections, type Direction, type PieceDirections } from '../../../shared/direction';
import { KIND_INFO } from '../../../shared/types';
import { askStructured } from '../claude/oneshot';
import { playbook } from '../claude/plugin';
import { waitForUsage } from '../claude/usage';
import { db, schema } from '../db';
import { emit } from '../lib/events';
import { enqueue, hasPendingJob, JobError } from '../jobs/queue';
import { getPiece, getPieceDetail, getWorkspace } from '../services/pieces';
import { recentArsenalUse } from './arsenal';

export function setDirections(pieceId: string, value: PieceDirections | null) {
  const piece = getPiece(pieceId);
  db.update(schema.pieces).set({ directions: value }).where(eq(schema.pieces.id, pieceId)).run();
  emit({ type: 'changed', entity: 'pieces', workspaceId: piece.workspaceId, id: pieceId });
}

/** Ask for directions (again): `request` is what to change or mix ("more playful", "the first one but faster"). */
export function requestPitch(pieceId: string, request = '') {
  const piece = getPiece(pieceId);
  const ws = getWorkspace(piece.workspaceId);
  if (ws.kind === 'clipping') throw new Error('Clips get their look made for them.');
  const prev = normalizeDirections(piece.directions);
  if (prev?.status === 'pitching' && hasPendingJob('direction.pitch', 'pieceId', pieceId)) return;
  setDirections(pieceId, { status: 'pitching', options: prev?.options ?? [], chosen: prev?.chosen ?? null, request: request.slice(0, 600), error: '', at: Date.now() });
  enqueue('direction.pitch', { pieceId }, { maxAttempts: 2 });
}

/** The creator's pick (one of the options by id, or a mix they wrote that Claude turned into one). */
export function chooseDirection(pieceId: string, optionId: string) {
  const prev = normalizeDirections(getPiece(pieceId).directions);
  const chosen = prev?.options.find((o) => o.id === optionId);
  if (!prev || !chosen) throw new Error('That direction is gone.');
  setDirections(pieceId, { ...prev, chosen });
  return chosen;
}

const DIRECTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['directions'],
  properties: {
    directions: {
      type: 'array',
      minItems: 2,
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'hook', 'promise', 'payoff', 'structure', 'look', 'moves', 'pacing'],
        properties: {
          name: { type: 'string', description: '2–4 words, a feeling or a style, not "Option 1"' },
          hook: { type: 'string', description: 'What is said and shown in the first 1–2 seconds' },
          promise: { type: 'string', description: 'What the hook promises the viewer, in one concrete line' },
          payoff: { type: 'string', description: 'What they get for staying, near the end, and how it is shown' },
          structure: { type: 'string', description: 'The beats in order, a few short lines' },
          look: { type: 'string', description: 'Framing, captions, colour, graphics: how it looks and feels' },
          moves: { type: 'array', items: { type: 'string' }, description: 'Arsenal ids this direction leans on (e.g. transition:whip, graphic:stat). Only ready ones.' },
          pacing: { type: 'string', description: 'Cuts, punch-ins, speed, in one line' },
        },
      },
    },
  },
};

const INSTRUCTIONS = `You are pitching creative directions for ONE short vertical video (TikTok, Reels, Shorts) before it is edited.
Pitch 2 or 3 directions that are genuinely different from each other (not three variations of one idea): a different hook, a different structure, a different look. Each follows the content model: the hook makes one concrete promise, the structure builds toward it, and the payoff keeps it late in the video. Each must be doable with the moves in the arsenal and the footage the creator has (or will film). Prefer moves the page's recent videos did NOT use, so its videos differ from each other, unless one clearly fits the idea better.
Rules: no music, no instruments, no trending sounds (sound effects only). Do not invent facts, numbers or personal stories about the creator. Write in plain words the creator can judge in ten seconds. If the creator asked for a change or a mix, every direction must respect it.`;

/** The `direction.pitch` job. */
export async function pitchDirections({ pieceId }: { pieceId: string }) {
  let piece;
  try {
    piece = getPiece(pieceId);
  } catch {
    return;
  }
  const state = normalizeDirections(piece.directions);
  if (!state || state.status !== 'pitching') return;
  await waitForUsage('directions');
  const ws = getWorkspace(piece.workspaceId);
  const detail = getPieceDetail(pieceId);
  const branch = detail.branches.find((b) => b.id === detail.activeBranchId) ?? detail.branches[0];
  const draft = branch?.working;
  const footage = db
    .select({ name: schema.media.originalName, kind: schema.media.kind, ms: schema.media.durationMs, text: schema.media.transcriptText })
    .from(schema.media)
    .where(and(eq(schema.media.pieceId, pieceId), isNotNull(schema.media.fileName)))
    .all()
    .filter((m) => m.kind === 'video' || m.kind === 'image')
    .slice(0, 6);
  // What the page's recent videos went with, so these differ.
  const recentPicks = db
    .select({ title: schema.pieces.title, directions: schema.pieces.directions })
    .from(schema.pieces)
    .where(and(eq(schema.pieces.workspaceId, ws.id), ne(schema.pieces.id, pieceId), isNotNull(schema.pieces.directions)))
    .orderBy(desc(schema.pieces.updatedAt))
    .limit(5)
    .all()
    .map((p) => normalizeDirections(p.directions)?.chosen)
    .filter((d): d is Direction => !!d);
  const { edits, counts } = recentArsenalUse(ws.id, 8, pieceId);

  const prompt = [
    `Page: ${ws.name} (${KIND_INFO[ws.kind].label.toLowerCase()})${ws.niche ? `, niche: ${ws.niche}` : ''}`,
    ws.brandGuide.trim() && `Brand guide:\n${ws.brandGuide.trim().slice(0, 3000)}`,
    ws.voiceMemory.trim() && `Voice memory:\n${ws.voiceMemory.trim().slice(0, 1500)}`,
    `The video: “${piece.title}”`,
    draft && (draft.hook || draft.script || draft.notes) && `Its idea so far:\nHook: ${draft.hook || '(none)'}\nScript: ${draft.script || '(none)'}\nNotes: ${draft.notes || '(none)'}`,
    footage.length
      ? `Footage in the package:\n${footage.map((m) => `- ${m.name} (${m.kind}${m.ms ? `, ${Math.round(m.ms / 1000)} s` : ''})${m.text ? `: “${m.text.slice(0, 400)}”` : ''}`).join('\n')}`
      : 'No footage yet: the directions can include what to film.',
    recentPicks.length && `Directions picked for this page's recent videos (go a different way):\n${recentPicks.map((d) => `- ${d.name}: ${d.hook}`).join('\n')}`,
    `Arsenal (ready moves; "used" = in how many of the page's last ${edits} edits):\n${readyArsenal()
      .map((a) => `- ${a.id}: ${a.label}. ${a.use}${counts.get(a.id) ? ` (used ${counts.get(a.id)})` : ''}`)
      .join('\n')}`,
    state.request && `The creator asked: ${state.request}`,
    state.options.length && state.request && `Directions pitched before (change them as asked):\n${state.options.map((d) => directionText(d)).join('\n---\n')}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  try {
    const out = await askStructured<{ directions: unknown[] }>({
      task: 'directions',
      system: [playbook('content-model', 'hooks', 'retention', 'packaging', 'sound-design', 'halal'), INSTRUCTIONS].filter(Boolean).join('\n\n'),
      prompt,
      schema: DIRECTION_SCHEMA,
      model: 'sonnet',
    });
    const ready = new Set(readyArsenal().map((a) => a.id));
    const options = (out.directions ?? [])
      .map((d, i) => normalizeDirection(d, `d${i + 1}`))
      .filter((d): d is Direction => !!d)
      .map((d, i) => ({ ...d, id: `d${i + 1}`, moves: d.moves.filter((m) => ready.has(m)) }));
    if (options.length < 2) throw new JobError('Claude pitched fewer than two directions.');
    setDirections(pieceId, { status: 'ready', options, chosen: null, request: state.request, error: '', at: Date.now() });
  } catch (err) {
    if (err instanceof JobError) throw err;
    throw new JobError((err as Error).message);
  }
}

export function onPitchFailed({ pieceId }: { pieceId: string }, message: string) {
  try {
    const state = normalizeDirections(getPiece(pieceId).directions);
    setDirections(pieceId, { status: 'failed', options: state?.options ?? [], chosen: state?.chosen ?? null, request: state?.request ?? '', error: message.slice(0, 300), at: Date.now() });
  } catch {
    /* the piece is gone */
  }
}
