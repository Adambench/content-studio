// Picking moments: one Claude request per source reads the scan's stretches of transcript with the campaign's brief
// and rules, the pages' niches, the playbook and the reasons I rejected clips before, and gives 3–8 moments with in
// and out points, a hook card, a title, captions and the standalone score. Only those scoring 7 or more are kept, and
// each is made into a clip (`clip.make`).
import { and, desc, eq, inArray, or } from 'drizzle-orm';
import type { CampaignPlatform } from '../../../shared/campaigns';
import { MIN_SCORE, MOMENT_KINDS, clock, type MomentCaptions, type MomentKind, type MomentSpeaker, type StandaloneScores } from '../../../shared/clipping';
import { askStructured } from '../claude/oneshot';
import { playbook } from '../claude/plugin';
import { lessonsText } from '../knowledge/lessons';
import { briefForPrompt } from '../research/brief';
import { waitForUsage } from '../claude/usage';
import { emitCampaign, getCampaignRow, getSource, updateSource, type MomentRow } from '../campaigns/campaigns';
import { readSourceTranscript } from '../campaigns/sources';
import { db, newId, schema } from '../db';
import { emit } from '../lib/events';
import { enqueue, JobError } from '../jobs/queue';
import { readScan, toLines, transcriptWords, type Line, type Word } from './scan';

type Picked = {
  start: number;
  end: number;
  firstLine: string;
  hookCard: string;
  title: string;
  kind: MomentKind;
  why: string;
  scores: StandaloneScores;
  pageId: string;
  captions: MomentCaptions;
  halalFlags: string[];
  checkByEye: string[];
  speaker: MomentSpeaker;
};

const point = { type: 'integer', enum: [0, 1, 2] };
const caption = (fields: string[]) => ({ type: 'object', additionalProperties: false, required: fields, properties: Object.fromEntries(fields.map((f) => [f, { type: 'string' }])) });

function schemaFor(pageIds: string[]) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['moments', 'notes'],
    properties: {
      moments: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['start', 'end', 'firstLine', 'hookCard', 'title', 'kind', 'why', 'scores', 'pageId', 'captions', 'halalFlags', 'checkByEye', 'speaker'],
          properties: {
            start: { type: 'number', description: 'In point, seconds in the source: the start of the first word of a sentence, with the context a stranger needs to follow (never mid-sentence, never mid-story)' },
            end: { type: 'number', description: 'Out point, seconds in the source: the end of the last word of the payoff, where the story or the point is finished (never on a sentence that goes on, a dangling "and…", or a new thought that starts and stops; a longer clip is fine)' },
            firstLine: { type: 'string', description: 'The spoken first line, word for word' },
            hookCard: { type: 'string', description: '6 words or fewer for the screen in the first ~2.5 s, or empty when the first line carries the hook. Mark at most 2 words *like this* for emphasis, only ones that alone still carry the message (they show bolder, never in another colour)' },
            title: { type: 'string' },
            kind: { type: 'string', enum: MOMENT_KINDS },
            why: { type: 'string', description: 'One line: the kind, the turn or payoff, who it’s for' },
            scores: {
              type: 'object',
              additionalProperties: false,
              required: ['opensCold', 'oneIdea', 'endsClean', 'noOutsideReference', 'length'],
              properties: { opensCold: point, oneIdea: point, endsClean: point, noOutsideReference: point, length: point },
            },
            pageId: { type: 'string', enum: pageIds, description: 'The page it fits best' },
            captions: {
              type: 'object',
              additionalProperties: false,
              required: ['tiktok', 'instagram', 'youtube'],
              properties: { tiktok: caption(['caption', 'hashtags']), instagram: caption(['caption', 'hashtags']), youtube: caption(['title', 'description', 'tags']) },
            },
            halalFlags: { type: 'array', items: { type: 'string' }, description: 'Gray areas to check, one short line each; empty when none' },
            checkByEye: { type: 'array', items: { type: 'string' }, description: 'Campaign rules the creator must check by eye for this clip' },
            speaker: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'about', 'known'],
              description: 'Who mainly talks in the clip, only as the title, description or campaign name them (never a guess: empty name when unsure)',
              properties: {
                name: { type: 'string', description: 'Their full name, or empty' },
                about: { type: 'string', description: 'Who they are in 4 words or fewer, e.g. "Founder, Higgsfield AI"' },
                known: { type: 'boolean', description: 'True only when most viewers would know them on sight (a household name); a guest people wouldn’t know gets named on screen' },
              },
            },
          },
        },
      },
      notes: { type: 'string', description: 'When there are few or no moments, why (one or two sentences); otherwise empty' },
    },
  };
}

const INSTRUCTIONS = [
  'You pick moments from a long video (a podcast, a stream, an interview) to cut into short vertical clips for a clipping page, by the playbook above: `clipping.md` is the method, `hooks.md` shapes the hook card and the title, and the halal rules come before everything.',
  'You get stretches of the transcript, one line each as "[start–end] words" with times in seconds in the source. Choose in and out points from those times: start on the first word of the line that works cold, end on the last word of the payoff. Times inside a line are fine when the cut belongs there (estimate from the words’ position).',
  'Give 3 to 8 moments, only ones that score 7 or more of 10 on the standalone score, never overlapping each other or the moments already taken. Fewer good ones beat more weak ones; none is a valid answer when nothing stands alone.',
  'The campaign’s rules come first after the halal rules: its length limits replace the 20–60 s default, and every caption carries its required mentions, hashtags and text for each platform. Write captions only for the platforms the campaign pays on (leave the others empty), in the page’s voice, never claiming more than the clip shows.',
  'Skip outright anything haram (halal.md) and any moment where music or singing is the point. Flag gray areas in `halalFlags` with the reason, including swearing (bleeped or not) and religious claims to check.',
  'Past rejection reasons are rules too: don’t pick that kind of moment again. So are the lessons from the creator’s comments above: check every moment against each before you give it.',
].join('\n\n');

const overlapRatio = (a: { start: number; end: number }, b: { start: number; end: number }) =>
  Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start)) / Math.max(0.1, Math.min(a.end - a.start, b.end - b.start));

/** Snap Claude's times to the transcript's words: the in point to a word's start, the out point to a word's end. */
export function snapToWords(words: Word[], start: number, end: number) {
  const near = (t: number, key: 'start' | 'end') => {
    let best: Word | null = null;
    for (const w of words) {
      if (Math.abs(w[key] - t) > 2.5) continue;
      if (!best || Math.abs(w[key] - t) < Math.abs(best[key] - t)) best = w;
    }
    return best?.[key] ?? t;
  };
  return { start: near(start, 'start'), end: near(end, 'end') };
}

function transcriptBlock(lines: Line[], stretches: { start: number; end: number }[]) {
  return stretches
    .map((st, k) => {
      const inside = lines.filter((l) => l.end > st.start && l.start < st.end);
      return `### Stretch ${k + 1} (${clock(st.start)}–${clock(st.end)})\n${inside.map((l) => `[${l.start.toFixed(1)}–${l.end.toFixed(1)}] ${l.text}`).join('\n')}`;
    })
    .join('\n\n');
}

/** The `source.pick` job. */
export async function pickMoments({ sourceId }: { sourceId: string }) {
  const s = getSource(sourceId);
  try {
    await waitForUsage('clips');
  } catch (err) {
    updateSource(sourceId, { status: 'scanning', detail: (err as Error).message });
    throw err;
  }
  const c = getCampaignRow(s.campaignId);
  const pages = db
    .select({ id: schema.workspaces.id, name: schema.workspaces.name, kind: schema.workspaces.kind, niche: schema.workspaces.niche, voiceMemory: schema.workspaces.voiceMemory })
    .from(schema.campaignPages)
    .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.campaignPages.workspaceId))
    .where(eq(schema.campaignPages.campaignId, c.id))
    .all();
  if (!pages.length) {
    updateSource(sourceId, { status: 'ready', detail: 'Pick the pages this campaign posts on, then find moments.' });
    return;
  }
  const [t, scan] = await Promise.all([readSourceTranscript(s), readScan(s)]);
  if (!t || !scan) throw new JobError('Scan it first.', { retry: false });
  updateSource(sourceId, { status: 'scanning', detail: 'Claude is picking moments' });

  // A new pick replaces the moments still waiting; made, rejected and in-progress ones stay (and aren't picked again).
  db.delete(schema.moments)
    .where(and(eq(schema.moments.sourceId, sourceId), inArray(schema.moments.status, ['candidate', 'failed', 'dropped'])))
    .run();
  const kept = db.select().from(schema.moments).where(eq(schema.moments.sourceId, sourceId)).all();
  const rejected = db
    .select({ title: schema.moments.title, reason: schema.moments.rejectReason, firstLine: schema.moments.firstLine })
    .from(schema.moments)
    .where(
      and(
        eq(schema.moments.status, 'rejected'),
        or(
          eq(schema.moments.campaignId, c.id),
          inArray(
            schema.moments.workspaceId,
            pages.map((p) => p.id),
          ),
        ),
      ),
    )
    .orderBy(desc(schema.moments.updatedAt))
    .limit(30)
    .all()
    // A skip without a reason teaches nothing (the moment itself stays taken, so it isn't picked again).
    .filter((r) => r.reason && r.reason !== 'Skipped')
    .slice(0, 20);

  // Each page's latest research brief: what kind of moments are pulling views in its niche.
  const research = pages.flatMap((p) => {
    const b = briefForPrompt(p.id);
    return b ? [`${pages.length > 1 ? `For ${p.name}:\n` : ''}${b}`] : [];
  });
  const platforms: CampaignPlatform[] = c.platforms.length ? c.platforms : ['tiktok', 'instagram', 'youtube'];
  const lines = toLines(t);
  const prompt = [
    `# The campaign: ${c.title}`,
    [c.brand && `Brand: ${c.brand}`, c.type && `Type: ${c.type}`, c.category && `Category: ${c.category}`].filter(Boolean).join(' · '),
    c.description && `## Brief\n${c.description}`,
    c.checklist.length
      ? `## Rules\n${c.checklist.map((r) => `- [${r.kind}] ${r.text}${r.check ? ` (checked by the app: ${r.check.type} ${r.check.value})` : ''}`).join('\n')}`
      : '## Rules\nNone listed beyond the playbook.',
    c.rulesText && `## The rules as the page words them\n${c.rulesText}`,
    `## Pays on\n${platforms.join(', ')}`,
    `# The page${pages.length > 1 ? 's (pick the one each moment fits best)' : ''}`,
    pages.map((p) => `- ${p.id}: ${p.name}${p.niche ? ` — ${p.niche}` : ''}${p.voiceMemory ? `\n  Voice notes: ${p.voiceMemory.slice(0, 800).replace(/\n/g, ' ')}` : ''}`).join('\n'),
    kept.length && `# Already taken from this source (don’t overlap)\n${kept.map((m) => `- ${m.start.toFixed(1)}–${m.end.toFixed(1)} “${m.title}” (${m.status})`).join('\n')}`,
    rejected.length && `# Clips I rejected before, and why\n${rejected.map((r) => `- “${r.title || r.firstLine.slice(0, 80)}” — ${r.reason ?? 'no reason given'}`).join('\n')}`,
    s.viral.length > 0 &&
      `# Stretches other clippers already got big on (their clips of this video, matched to the source by their words)\nLook at these first: if a stretch makes a clip that stands alone and fits the rules, pick it (trim to the best in and out points, make the hook your own), and say in \`why\` that it already worked. Never copy their edit, title or caption.\n${s.viral.map((h) => `- ${h.start.toFixed(1)}–${h.end.toFixed(1)} (${h.views.toLocaleString('en-US')} views): “${h.title.slice(0, 100)}”`).join('\n')}`,
    research.length && `# What's working in the page's niche now (its research brief)\n${research.join('\n\n')}`,
    `# The source: ${s.title || 'untitled'}${s.creator ? ` (by ${s.creator})` : ''}\nLength ${clock(scan.duration)}${s.link ? ` · ${s.link}` : ''}${scan.whole ? ' · the whole transcript follows' : ` · ${scan.stretches.length} stretches the scan found liveliest follow (loudness, pace${scan.chat ? ', chat' : ''}, the brief’s words); the rest isn’t shown`}`,
    transcriptBlock(lines, scan.stretches),
  ]
    .filter(Boolean)
    .join('\n\n');

  const out = await askStructured<{ moments: Picked[]; notes: string }>({
    task: 'clips',
    system: [playbook('clipping', 'hooks', 'retention', 'editing', 'halal'), lessonsText(pages.length === 1 ? pages[0].id : null), INSTRUCTIONS].filter(Boolean).join('\n\n'),
    prompt,
    schema: schemaFor(pages.map((p) => p.id)),
    model: 'sonnet',
  });

  const words = transcriptWords(t);
  const maxRule = c.checklist.find((r) => r.check?.type === 'maxSeconds')?.check?.value;
  const taken: { start: number; end: number }[] = kept.map((m) => ({ start: m.start, end: m.end }));
  const added: MomentRow[] = [];
  for (const m of out.moments ?? []) {
    if (!Number.isFinite(m.start) || !Number.isFinite(m.end) || m.end <= m.start) continue;
    const at = snapToWords(words, Math.max(0, m.start), Math.min(scan.duration, m.end));
    const length = at.end - at.start;
    // Tightening shortens a clip by a few seconds; anything far outside the limits isn't worth making.
    if (length < 10 || length > 120 || (maxRule && length > Number(maxRule) + 15)) continue;
    if (taken.some((x) => overlapRatio(x, at) > 0.5)) continue;
    const scores = Object.fromEntries(Object.entries(m.scores ?? {}).map(([k, v]) => [k, Math.max(0, Math.min(2, Math.round(Number(v) || 0)))])) as StandaloneScores;
    const score = Object.values(scores).reduce((a, b) => a + b, 0);
    if (score < MIN_SCORE) continue;
    // Only the platforms the campaign pays on keep a caption.
    const paid = (p: CampaignPlatform) => platforms.includes(p);
    const captions: MomentCaptions = {
      tiktok: paid('tiktok') ? { caption: m.captions?.tiktok?.caption ?? '', hashtags: m.captions?.tiktok?.hashtags ?? '' } : { caption: '', hashtags: '' },
      instagram: paid('instagram') ? { caption: m.captions?.instagram?.caption ?? '', hashtags: m.captions?.instagram?.hashtags ?? '' } : { caption: '', hashtags: '' },
      youtube: paid('youtube') ? { title: m.captions?.youtube?.title ?? '', description: m.captions?.youtube?.description ?? '', tags: m.captions?.youtube?.tags ?? '' } : { title: '', description: '', tags: '' },
    };
    const row: MomentRow = {
      id: newId(),
      sourceId,
      campaignId: c.id,
      workspaceId: pages.some((p) => p.id === m.pageId) ? m.pageId : pages[0].id,
      start: Math.round(at.start * 100) / 100,
      end: Math.round(at.end * 100) / 100,
      firstLine: (m.firstLine ?? '').trim().slice(0, 500),
      hookCard: (m.hookCard ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 6).join(' ').slice(0, 60),
      title: (m.title ?? '').trim().slice(0, 150),
      kind: MOMENT_KINDS.includes(m.kind) ? m.kind : 'other',
      why: (m.why ?? '').trim().slice(0, 500),
      score,
      scores,
      captions,
      halalFlags: (m.halalFlags ?? []).map((f) => f.trim()).filter(Boolean).slice(0, 6),
      checkByEye: (m.checkByEye ?? []).map((f) => f.trim()).filter(Boolean).slice(0, 8),
      speaker: m.speaker?.name?.trim() ? { name: m.speaker.name.trim().slice(0, 60), about: (m.speaker.about ?? '').trim().slice(0, 60), known: !!m.speaker.known } : null,
      music: null,
      frames: null,
      status: 'making',
      detail: 'Waiting its turn',
      rejectReason: null,
      pieceId: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    taken.push(at);
    added.push(row);
  }
  if (added.length) db.insert(schema.moments).values(added).run();
  // The best first: they're made one at a time.
  for (const m of [...added].sort((a, b) => b.score - a.score)) enqueue('clip.make', { momentId: m.id }, { maxAttempts: 2 });
  updateSource(sourceId, {
    status: 'ready',
    detail: added.length ? '' : `No moment stood alone well enough to clip.${out.notes ? ` ${out.notes.trim()}` : ''}`.slice(0, 300),
  });
  emitCampaign(c.id);
  emit({ type: 'job', jobType: 'source.pick', status: 'done', message: added.length ? `Found ${added.length} moment${added.length === 1 ? '' : 's'} in “${s.title || 'a source'}”` : `No clips in “${s.title || 'a source'}”` });
}
