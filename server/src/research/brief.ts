// The daily research brief: one Haiku call over the outliers the sweep found, with the playbook, turned into what
// over-performs in the niche, ideas and hooks shaped for the page. Shown on Today and the Research page, given to
// moment picking, and read by Claude in chat (get_research).
import { and, desc, eq, isNull } from 'drizzle-orm';
import { KIND_INFO } from '../../../shared/types';
import type { ResearchBriefBody } from '../../../shared/research';
import { askStructured } from '../claude/oneshot';
import { playbook } from '../claude/plugin';
import { waitForUsage } from '../claude/usage';
import { db, now, schema } from '../db';
import { emit } from '../lib/events';
import { badRequest, notFound } from '../lib/http';
import { createPiece, getWorkspace } from '../services/pieces';
import { hasIdeas, saveShared } from '../ideas/ideas';
import { emitResearch, finishBrief, getBrief, recentOutliers, type ItemRow } from './research';

const PLATFORM = { youtube: 'YouTube Shorts', tiktok: 'TikTok', instagram: 'Instagram Reels', file: 'Video' } as const;
const n = (v: number) => Math.round(v).toLocaleString('en-GB');
const ago = (ms: number | null) => (ms ? `${Math.max(0, Math.round((now() - ms) / 86400_000))} days ago` : 'date unknown');

/** The outliers as compact text with short ids ([O1]…) the brief can point at. */
export function outlierDigest(items: ItemRow[]) {
  const ids = new Map<string, ItemRow>();
  const lines = items.map((it, i) => {
    const key = `O${i + 1}`;
    ids.set(key, it);
    return [
      `- [${key}] ${PLATFORM[it.platform]} · ${it.channel} · ${it.views !== null ? `${n(it.views)} views` : 'views unknown'}, ${it.score?.toFixed(1)}× the account’s median (${it.channelMedian !== null ? n(it.channelMedian) : '?'}) · posted ${ago(it.postedAt)}${it.keyword ? ` · found searching “${it.keyword}”` : ''}`,
      it.title && `  ${it.platform === 'youtube' ? 'Title' : 'Caption'}: “${it.title.replace(/\s+/g, ' ').slice(0, 220)}”`,
      it.hook && `  First words spoken: “${it.hook}”`,
    ]
      .filter(Boolean)
      .join('\n');
  });
  return { text: lines.join('\n'), ids };
}

type BriefOut = Omit<ResearchBriefBody, 'patterns'> & { patterns: { pattern: string; why: string; examples: string[] }[] };

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'patterns', 'topics', 'ideas', 'hooks', 'forClips'],
  properties: {
    headline: { type: 'string', description: 'What stands out today, in one sentence under 120 characters' },
    patterns: {
      type: 'array',
      maxItems: 4,
      description: 'Formulas (hook types, formats, structures, angles) that over-perform, each backed by outliers',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['pattern', 'why', 'examples'],
        properties: {
          pattern: { type: 'string', description: 'The formula, in a short phrase' },
          why: { type: 'string', description: 'Why it works for viewers, in a sentence' },
          examples: { type: 'array', items: { type: 'string' }, description: 'Outlier ids like O3' },
        },
      },
    },
    topics: { type: 'array', maxItems: 5, items: { type: 'string' }, description: 'Topics pulling views now, short' },
    ideas: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'hook', 'why'],
        properties: {
          title: { type: 'string', description: 'Working title for this page, under 60 characters' },
          hook: { type: 'string', description: 'The opening line, in the page’s voice' },
          why: { type: 'string', description: 'Which pattern or outlier it builds on' },
        },
      },
    },
    hooks: { type: 'array', maxItems: 5, items: { type: 'string' }, description: 'Opening lines shaped for this page, each a different formula' },
    forClips: { type: 'string', description: 'For a clipping page only: the kind of moment to look for in long videos, in a sentence or two; empty otherwise' },
  },
};

const INSTRUCTIONS = `You write a short daily research brief for one page of a creator who posts short vertical video (TikTok, Reels, Shorts). Below are today's outliers: posts from accounts the page watches (or found searching its keywords) that got several times the views their account usually gets. Views are measured, not guessed; the multiple of the account's median is what matters, not raw views.

- Find what the outliers share: hook formulas, formats, structures, angles, topics. A pattern needs at least two outliers behind it; say so when the evidence is thin. Never invent posts, numbers or trends.
- Never copy anyone's words: ideas and hooks are new, for this page's niche and voice, borrowing the formula only.
- Skip anything haram or musical (songs, trending sounds, music edits, dance trends, gambling, alcohol, dating, immodest content): don't learn from it and don't suggest it.
- Point at outliers only through examples (their ids, like O3); never write those ids anywhere else, since the creator never sees them. Name the account instead when it helps.
- Ideas fit what the page can make (a clipping page posts clips cut from long videos; a personal brand films itself; a business shows its products and know-how).
- Plain, specific language; no hype.`;

/** A string field Haiku sometimes returns wrapped as JSON (`{"forClips": "…"}`): the text inside. */
function unwrap(text: string) {
  const t = text.trim();
  if (!t.startsWith('{')) return t;
  try {
    const inner = Object.values(JSON.parse(t) as Record<string, unknown>).find((v) => typeof v === 'string');
    return typeof inner === 'string' ? inner.trim() : t;
  } catch {
    return t;
  }
}

/** The `research.brief` job. */
export async function writeBrief({ workspaceId, briefId }: { workspaceId: string; briefId: string }) {
  const brief = getBrief(briefId);
  const ws = getWorkspace(workspaceId);
  const items = recentOutliers(ws.id, 14, 25);
  if (!items.length) {
    finishBrief(briefId, {
      status: 'done',
      body: { headline: 'Nothing stood out today: no post did 3× its account’s usual.', patterns: [], topics: [], ideas: [], hooks: [], forClips: '' },
    });
    return;
  }
  await waitForUsage('research');
  const digest = outlierDigest(items);
  const previous = db
    .select({ id: schema.researchBriefs.id, body: schema.researchBriefs.body })
    .from(schema.researchBriefs)
    .where(eq(schema.researchBriefs.workspaceId, ws.id))
    .orderBy(desc(schema.researchBriefs.createdAt))
    .limit(5)
    .all()
    .find((b) => b.id !== brief.id && b.body?.patterns.length)?.body;
  const out = await askStructured<BriefOut>({
    task: 'research',
    system: [playbook('hooks', 'packaging', 'halal'), INSTRUCTIONS].filter(Boolean).join('\n\n'),
    prompt: [
      `# The page: ${ws.name} (${KIND_INFO[ws.kind].label.toLowerCase()})`,
      ws.niche && `Niche: ${ws.niche}`,
      ws.description && `About: ${ws.description}`,
      ws.voiceMemory && `Its voice:\n${ws.voiceMemory.slice(0, 1500)}`,
      `# Outliers (last 14 days, best first)\n${digest.text}`,
      previous?.headline && `# Yesterday's headline (don't repeat it unless it still holds)\n${previous.headline}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
    schema: SCHEMA,
    model: 'haiku',
  });
  const known = (ref: string) => digest.ids.get(ref.replace(/[[\]\s]/g, ''))?.id;
  // Ids that slipped into the prose become the account's name ("(O14, O20)" → "(The Diary Of A CEO)").
  const deref = (text: string) =>
    text
      .replace(/\[?\bO(\d{1,2})\b\]?/g, (m, n: string) => digest.ids.get(`O${n}`)?.channel ?? m)
      .replace(/\(([^()]*)\)/g, (m, inner: string) => `(${[...new Set(inner.split(/,\s*/))].join(', ')})`)
      .trim();
  const body: ResearchBriefBody = {
    headline: deref(out.headline),
    patterns: (out.patterns ?? []).map((p) => ({ pattern: deref(p.pattern), why: deref(p.why), examples: [...new Set((p.examples ?? []).map(known).filter((id): id is string => !!id))] })).filter((p) => p.pattern),
    topics: (out.topics ?? []).map((t) => t.trim()).filter(Boolean),
    ideas: (out.ideas ?? []).filter((i) => i.title?.trim()).map((i) => ({ title: i.title.trim(), hook: i.hook.trim(), why: deref(i.why) })),
    hooks: (out.hooks ?? []).map((h) => h.trim()).filter(Boolean),
    forClips: ws.kind === 'clipping' ? deref(unwrap(out.forClips ?? '')) : '',
  };
  finishBrief(briefId, { status: 'done', body, error: null });
  emit({ type: 'job', jobType: 'research.brief', status: 'done', workspaceId: ws.id, message: body.headline });
}

export function onBriefFailed({ briefId }: { briefId: string }, message: string) {
  try {
    finishBrief(briefId, { status: 'error', error: message.slice(0, 300) });
  } catch {
    /* gone */
  }
}

/** Put one of the brief's ideas on the board (my click). */
export function addBriefIdea(briefId: string, index: number) {
  const brief = getBrief(briefId);
  const idea = brief.body?.ideas[index];
  if (!idea) throw notFound('That idea isn’t in this brief.');
  if (idea.pieceId && db.select({ id: schema.pieces.id }).from(schema.pieces).where(eq(schema.pieces.id, idea.pieceId)).get()) return idea;
  const ws = getWorkspace(brief.workspaceId);
  // Pages with Ideas get it in their Saved pile, to think about before it's a video.
  if (hasIdeas(ws.id)) {
    if (idea.ideaId && db.select({ id: schema.ideas.id }).from(schema.ideas).where(and(eq(schema.ideas.id, idea.ideaId), isNull(schema.ideas.deletedAt))).get()) return idea;
    const card = saveShared(ws.id, { title: idea.title.slice(0, 120), note: [idea.hook && `Hook: ${idea.hook}`, `From the research brief (${brief.day}): ${idea.why}`].filter(Boolean).join('\n\n'), by: 'claude' });
    idea.ideaId = card.id;
    db.update(schema.researchBriefs).set({ body: brief.body }).where(eq(schema.researchBriefs.id, briefId)).run();
    emitResearch(ws.id);
    return idea;
  }
  if (!ws.stages.length) throw badRequest('This page has no board columns.');
  const { pieceId } = createPiece(ws.id, {
    title: idea.title.slice(0, 120),
    content: { hook: idea.hook, notes: `From the research brief (${brief.day}): ${idea.why}` },
    author: 'claude',
    message: 'Idea from the research brief',
  });
  idea.pieceId = pieceId;
  db.update(schema.researchBriefs).set({ body: brief.body }).where(eq(schema.researchBriefs.id, briefId)).run();
  emitResearch(ws.id);
  return idea;
}

/** The latest finished brief as text, for prompts (moment picking, chat). Null when there's none from the last few days. */
export function briefForPrompt(workspaceId: string, maxAgeDays = 3) {
  const b = db
    .select()
    .from(schema.researchBriefs)
    .where(eq(schema.researchBriefs.workspaceId, workspaceId))
    .orderBy(desc(schema.researchBriefs.createdAt))
    .all()
    .find((r) => r.status === 'done' && r.body && r.body.patterns.length);
  if (!b?.body || now() - b.createdAt > maxAgeDays * 86400_000) return null;
  return [
    `Headline: ${b.body.headline}`,
    ...b.body.patterns.map((p) => `- ${p.pattern}: ${p.why}`),
    b.body.topics.length ? `Topics pulling views: ${b.body.topics.join('; ')}` : '',
    b.body.forClips ? `Moments to look for: ${b.body.forClips}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}
