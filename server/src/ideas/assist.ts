// Claude on the Ideas canvas, only ever on my click: help on one card (expand it, angles in, a series' next episodes,
// a challenge), shown in its panel for me to add or ignore (my notes are never changed by it); and, when I lock an
// idea in, the video's hooks, angle and outline as a new version of its draft (`ideas.flesh`). One call each.
import { readFile } from 'node:fs/promises';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { ASSIST_INFO, type AssistKind, type IdeaAssist } from '../../../shared/ideas';
import { KIND_INFO, normalizeDraft } from '../../../shared/types';
import { askStructured, type PromptImage } from '../claude/oneshot';
import { resolveModel } from '../claude/options';
import { playbook } from '../claude/plugin';
import { lessonsText } from '../knowledge/lessons';
import { waitForUsage } from '../claude/usage';
import { db, now, schema } from '../db';
import { emit } from '../lib/events';
import { badRequest } from '../lib/http';
import { enqueue, hasPendingJob } from '../jobs/queue';
import { mediaPath } from '../services/media';
import { getPiece, getWorkspace, saveVersion } from '../services/pieces';
import { emitIdeas, episodeOf, getIdea, type IdeaRow } from './ideas';
import { inspirationText } from '../knowledge/references';

const kidsOf = (id: string) =>
  db
    .select()
    .from(schema.ideas)
    .where(and(eq(schema.ideas.parentId, id), isNull(schema.ideas.deletedAt)))
    .orderBy(asc(schema.ideas.position))
    .all();

function brand(workspaceId: string) {
  const ws = getWorkspace(workspaceId);
  return [
    `# The page: ${ws.name} (${KIND_INFO[ws.kind].label.toLowerCase()})`,
    ws.niche && `Niche: ${ws.niche}`,
    ws.description && `About it: ${ws.description}`,
    ws.brandGuide && `Brand guide:\n${ws.brandGuide}`,
    ws.voiceMemory && `What's known about the creator's voice:\n${ws.voiceMemory}`,
    inspirationText(ws.id),
  ]
    .filter(Boolean)
    .join('\n');
}

/** The card in words: where it sits, what I wrote, what's under it, its series and the posts that inspired it. */
function describe(row: IdeaRow) {
  const path: string[] = [];
  for (let p = row.parentId ? db.select().from(schema.ideas).where(eq(schema.ideas.id, row.parentId)).get() : undefined; p; p = p.parentId ? db.select().from(schema.ideas).where(eq(schema.ideas.id, p.parentId)).get() : undefined) {
    if (p.kind !== 'saved') path.unshift(p.title || '(untitled)');
  }
  const kids = kidsOf(row.id);
  const sub = kids.filter((k) => k.kind === 'idea' || k.kind === 'series').map((k) => `- ${k.title || '(untitled)'}${k.body ? `: ${k.body.replace(/\s+/g, ' ').slice(0, 200)}` : ''}`);
  const refs = kids.filter((k) => k.kind === 'link' && k.researchItemId);
  const items = refs.length ? db.select().from(schema.researchItems).where(inArray(schema.researchItems.id, refs.map((r) => r.researchItemId!))).all() : [];
  const inspired = items.map((i) =>
    [
      `- ${i.platform} post by ${i.channel || 'someone'}${i.views ? ` (${i.views.toLocaleString('en-GB')} views${i.score ? `, ${i.score.toFixed(1)}× their usual` : ''})` : ''}: “${i.title.slice(0, 200)}”`,
      i.transcript && `  What's said: ${i.transcript.slice(0, 1200)}`,
      i.analysis && `  Why it worked: ${i.analysis.whyItWorks}`,
    ]
      .filter(Boolean)
      .join('\n'),
  );
  const ep = episodeOf(row);
  const series = row.kind === 'series' ? row : ep?.series;
  const episodes = series ? kidsOf(series.id).filter((k) => k.kind === 'idea') : [];
  return [
    `# The card${row.kind === 'series' ? ' (a series)' : ep ? ` (episode ${ep.episode} of the series “${ep.series.title}”)` : ''}`,
    path.length && `Sits under: ${path.join(' › ')}`,
    `Title: ${row.title || '(untitled)'}`,
    row.body && `My notes:\n${row.body}`,
    row.script && `My script draft:\n${row.script}`,
    row.labels.length && `Labels: ${row.labels.join(', ')}`,
    series && series.id !== row.id && series.body && `The series' premise: ${series.body}`,
    series?.format && `The series' format and hook style: ${series.format}`,
    episodes.length && `The series' episodes so far:\n${episodes.map((e, i) => `${i + 1}. ${e.title || '(untitled)'}`).join('\n')}`,
    sub.length && row.kind !== 'series' && `Its sub-ideas:\n${sub.join('\n')}`,
    inspired.length && `Posts that inspired it (learn from them, never copy their words):\n${inspired.join('\n')}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Up to three of the card's pictures (screenshots I saved under it). */
async function pictures(row: IdeaRow): Promise<PromptImage[]> {
  const ids = kidsOf(row.id).flatMap((k) => (k.kind === 'image' && k.mediaId ? [k.mediaId] : []));
  if (!ids.length) return [];
  const media = db.select().from(schema.media).where(inArray(schema.media.id, ids.slice(0, 3))).all();
  const out: PromptImage[] = [];
  for (const m of media) {
    if (m.mime !== 'image/jpeg' && m.mime !== 'image/png') continue;
    if (m.size > 4 * 1024 ** 2) continue;
    out.push({ data: (await readFile(mediaPath(m))).toString('base64'), mediaType: m.mime });
  }
  return out;
}

// ---------- help on a card ----------

const ASSIST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'items'],
  properties: {
    summary: { type: 'string', description: 'One line on the whole thing' },
    items: {
      type: 'array',
      minItems: 1,
      maxItems: 6,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'detail'],
        properties: { title: { type: 'string', description: 'A few words, usable as a card title' }, detail: { type: 'string', description: 'One to three sentences' } },
      },
    },
  },
};

const ASK: Record<AssistKind, string> = {
  expand:
    'Develop this idea for one short vertical video: give 3–5 items, each a part of it worth writing down (the angle, the story beats in order, the payoff, what makes it land, a detail from my notes worth leading with). Build on what I wrote; don’t replace it.',
  angles: 'Give 5 clearly different ways into this idea (different angles, not rewordings). Each item: the angle in a few words as the title, and its opening line plus why it would stop the scroll as the detail.',
  episodes:
    'Suggest 5 next episodes for this series that fit its premise and format and don’t repeat the episodes it has. Each item: the episode title, and its premise and opening line as the detail.',
  challenge: 'Challenge this idea honestly: give 3–5 reasons it might not work (vague payoff, nothing new, weak hook, hard to film, too long for a short), each with the fix as the detail. Say in the summary whether it’s worth making.',
};

export function setAssist(id: string, assist: IdeaAssist | null) {
  const row = getIdea(id);
  db.update(schema.ideas).set({ assist }).where(eq(schema.ideas.id, id)).run();
  emitIdeas(row.workspaceId, id);
}

/** My click on one of the card's Claude buttons. */
export function requestAssist(id: string, kind: AssistKind) {
  const row = getIdea(id);
  if (row.kind === 'saved' || row.kind === 'image') throw badRequest('Claude helps with ideas and series.');
  if (kind === 'episodes' && row.kind !== 'series') throw badRequest('Episodes are for a series: make it one first.');
  if (row.assist?.status === 'running' && hasPendingJob('ideas.assist', 'ideaId', id)) return;
  setAssist(id, { kind, status: 'running', summary: '', items: [], error: '', at: now() });
  enqueue('ideas.assist', { ideaId: id, kind }, { maxAttempts: 2 });
}

export async function runAssist({ ideaId, kind }: { ideaId: string; kind: AssistKind }) {
  const row = getIdea(ideaId);
  await waitForUsage('ideas');
  const out = await askStructured<{ summary: string; items: { title: string; detail: string }[] }>({
    task: 'ideas',
    system: [
      playbook('hooks', 'retention', 'halal'),
      `You help a creator brainstorm short vertical videos (TikTok, Reels, Shorts) for their own page. ${ASSIST_INFO[kind].hint}.`,
      'Be specific to their niche and what they wrote; no generic advice. Write in their language and voice. Never invent facts, numbers or stories about them. Nothing that breaks the halal rules (no music, nothing haram promoted).',
    ].join('\n\n'),
    prompt: [brand(row.workspaceId), describe(row), `# What I want\n${ASK[kind]}`].join('\n\n'),
    schema: ASSIST_SCHEMA,
    images: await pictures(row),
    model: resolveModel(),
  });
  setAssist(ideaId, { kind, status: 'done', summary: out.summary.trim(), items: out.items.map((i) => ({ title: i.title.trim().slice(0, 200), detail: i.detail.trim() })), error: '', at: now() });
}

export function onAssistFailed({ ideaId, kind }: { ideaId: string; kind: AssistKind }, message: string) {
  try {
    setAssist(ideaId, { kind, status: 'error', summary: '', items: [], error: message.slice(0, 300), at: now() });
  } catch {
    /* deleted */
  }
}

// ---------- fleshing out a locked-in idea ----------

const FLESH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'hooks', 'angle', 'outline'],
  properties: {
    title: { type: 'string', description: 'A short working title, max 60 characters' },
    hooks: { type: 'array', minItems: 3, maxItems: 3, items: { type: 'string' }, description: 'Three opening lines to choose from, best first, in the creator’s voice' },
    angle: { type: 'string', description: 'The angle in one or two sentences: who it is for and what they get' },
    outline: { type: 'string', description: 'The video as short beats in order (markdown "- " lines): hook, setup, re-hook, payoff, ending' },
  },
};

/** The `ideas.flesh` job: Claude's version of the new video's draft, on top of mine. */
export async function fleshOut({ ideaId, pieceId }: { ideaId: string; pieceId: string }) {
  const row = getIdea(ideaId);
  const piece = getPiece(pieceId);
  if (!piece.activeBranchId) return;
  await waitForUsage('ideas');
  const out = await askStructured<{ title: string; hooks: string[]; angle: string; outline: string }>({
    task: 'ideas',
    system: [
      playbook('content-model', 'hooks', 'retention', 'halal'),
      lessonsText(piece.workspaceId),
      'You turn a creator’s brainstormed idea into the start of one short vertical video (TikTok, Reels, Shorts) for their own page: hooks to choose from, the angle and the beats. Keep their meaning and what they wrote; never invent facts, numbers or stories about them. Write in their language and voice. Posts that inspired it are for learning from, never for copying words.',
    ]
      .filter(Boolean)
      .join('\n\n'),
    prompt: [brand(piece.workspaceId), describe(row)].join('\n\n'),
    schema: FLESH_SCHEMA,
    images: await pictures(row),
    model: resolveModel(),
  });
  const branch = db.select().from(schema.branches).where(eq(schema.branches.id, piece.activeBranchId)).get();
  const draft = normalizeDraft(branch?.working);
  const notes = [
    `Angle: ${out.angle.trim()}`,
    out.hooks.length > 1 && `Other hooks:\n${out.hooks.slice(1).map((h) => `- ${h.trim()}`).join('\n')}`,
    `Outline:\n${out.outline.trim()}`,
    draft.notes.trim() && `---\nFrom my idea:\n${draft.notes.trim()}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  saveVersion(piece.activeBranchId, { author: 'claude', message: 'Fleshed out from your idea', content: { ...draft, hook: draft.hook || out.hooks[0]?.trim() || '', notes } });
  // Only a card I left untitled takes Claude's title.
  if (!row.title.trim() && out.title.trim()) {
    db.update(schema.pieces).set({ title: out.title.trim().slice(0, 200), updatedAt: now() }).where(eq(schema.pieces.id, pieceId)).run();
    emit({ type: 'changed', entity: 'pieces', workspaceId: piece.workspaceId, id: pieceId });
  }
  emit({ type: 'job', jobType: 'ideas.flesh', status: 'done', workspaceId: piece.workspaceId, message: `“${piece.title}” is fleshed out` });
}

export function onFleshFailed({ pieceId }: { pieceId: string }, message: string) {
  try {
    const piece = getPiece(pieceId);
    emit({ type: 'job', jobType: 'ideas.flesh', status: 'error', workspaceId: piece.workspaceId, message });
  } catch {
    /* deleted */
  }
}
