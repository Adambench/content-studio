// UGC: a campaign video the creator films themselves (a product, an app, a service shown and talked about), as
// opposed to clips cut from a source. `ugc.script` writes one from the campaign's brief and rules for a page: a
// card on that page with the hook, a script to say on camera with shot cues, a shot list and the captions with what
// the campaign requires. Linked to the campaign (pieces.campaign_id), its posts get submissions like clips do.
import { and, desc, eq } from 'drizzle-orm';
import type { CampaignPlatform } from '../../../shared/campaigns';
import { askStructured } from '../claude/oneshot';
import { playbook } from '../claude/plugin';
import { waitForUsage } from '../claude/usage';
import { db, schema } from '../db';
import { emit } from '../lib/events';
import { notify } from '../lib/push';
import { JobError } from '../jobs/queue';
import { createPiece, getWorkspace } from '../services/pieces';
import { emitCampaign, getCampaignRow } from './campaigns';

type Written = {
  title: string;
  hook: string;
  script: string;
  shots: { shot: string; how: string }[];
  requirements: string[];
  captions: { tiktok: { caption: string; hashtags: string }; instagram: { caption: string; hashtags: string }; youtube: { title: string; description: string; tags: string } };
};

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'hook', 'script', 'shots', 'requirements', 'captions'],
  properties: {
    title: { type: 'string', description: 'A working title for the card, under 60 characters' },
    hook: { type: 'string', description: 'The first line said on camera (and its on-screen text if different, after " / ")' },
    script: {
      type: 'string',
      description: 'What to say, line by line, in the page’s voice, 20–45 seconds spoken. Put shot cues in square brackets on their own line, e.g. [close-up of the app]',
    },
    shots: {
      type: 'array',
      minItems: 3,
      maxItems: 10,
      items: { type: 'object', additionalProperties: false, required: ['shot', 'how'], properties: { shot: { type: 'string' }, how: { type: 'string', description: 'How to film it on a phone, in a line' } } },
    },
    requirements: { type: 'array', items: { type: 'string' }, description: 'Everything the campaign requires that this video must show, say or include, as a checklist' },
    captions: {
      type: 'object',
      additionalProperties: false,
      required: ['tiktok', 'instagram', 'youtube'],
      properties: {
        tiktok: { type: 'object', additionalProperties: false, required: ['caption', 'hashtags'], properties: { caption: { type: 'string' }, hashtags: { type: 'string' } } },
        instagram: { type: 'object', additionalProperties: false, required: ['caption', 'hashtags'], properties: { caption: { type: 'string' }, hashtags: { type: 'string' } } },
        youtube: { type: 'object', additionalProperties: false, required: ['title', 'description', 'tags'], properties: { title: { type: 'string' }, description: { type: 'string' }, tags: { type: 'string' } } },
      },
    },
  },
};

const INSTRUCTIONS = `You write UGC videos: short vertical videos a creator films themselves, on their phone, about a brand's product, for a campaign that pays per view.
- Follow the campaign's rules exactly: required mentions, tags, links and phrases go in the captions (and the script when it says so); forbidden things never appear. List every requirement in "requirements".
- Hook in the first second, then show the product early, one clear benefit, proof (a demo, a result), and a natural close. It must feel like a real person's honest take, not an ad read: no hype words, no claims the brief doesn't support.
- Write in the page's voice when there are voice notes. The creator is Muslim and the app is halal: never music or instruments, nothing haram, modest presentation, no misleading claims.
- Shots are things one person can film with a phone at home or outside.
- Captions: TikTok and Instagram short, with the required tags first; YouTube title under 70 characters.`;

/** The `ugc.script` job. */
export async function writeUgcScript({ campaignId, workspaceId, angle }: { campaignId: string; workspaceId: string; angle?: string }) {
  waitForUsage();
  const c = getCampaignRow(campaignId);
  if (c.halalVerdict === 'reject') throw new JobError('This campaign was rejected by the halal screen.', { retry: false });
  const ws = getWorkspace(workspaceId);
  const platforms: CampaignPlatform[] = c.platforms.length ? c.platforms : ['tiktok', 'instagram', 'youtube'];
  const before = db
    .select({ title: schema.pieces.title })
    .from(schema.pieces)
    .where(eq(schema.pieces.campaignId, campaignId))
    .orderBy(desc(schema.pieces.createdAt))
    .limit(10)
    .all();
  const prompt = [
    `# The campaign: ${c.title}`,
    [c.brand && `Brand: ${c.brand}`, c.type && `Type: ${c.type}`, c.category && `Category: ${c.category}`].filter(Boolean).join(' · '),
    c.description && `## Brief\n${c.description}`,
    c.checklist.length ? `## Rules\n${c.checklist.map((r) => `- [${r.kind}] ${r.text}`).join('\n')}` : '## Rules\nNone listed.',
    c.rulesText && `## The rules as the page words them\n${c.rulesText}`,
    c.requirements && `## Creator requirements\n${c.requirements}`,
    `## Pays on\n${platforms.join(', ')}`,
    `# The page it goes on: ${ws.name}`,
    ws.niche && `Niche: ${ws.niche}`,
    ws.description && `About: ${ws.description}`,
    ws.voiceMemory && `Voice notes:\n${ws.voiceMemory.slice(0, 1500)}`,
    before.length && `# Videos already written for this campaign (find a different angle)\n${before.map((p) => `- ${p.title}`).join('\n')}`,
    angle && `# The angle the creator wants\n${angle}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  const out = await askStructured<Written>({ system: [playbook('hooks', 'retention', 'packaging', 'halal'), INSTRUCTIONS].filter(Boolean).join('\n\n'), prompt, schema: SCHEMA, model: 'sonnet' });

  const notes = [
    `UGC for “${c.title}”${c.link ? ` (${c.link})` : ''}.`,
    '',
    'Shots:',
    ...out.shots.map((s, i) => `${i + 1}. ${s.shot} — ${s.how}`),
    '',
    'The campaign requires:',
    ...out.requirements.map((r) => `☐ ${r}`),
  ].join('\n');
  const { pieceId } = createPiece(workspaceId, {
    title: out.title.slice(0, 200) || `UGC: ${c.title}`,
    tags: ['ugc'],
    content: { hook: out.hook, script: out.script, notes, platforms: { ...out.captions, x: { text: '' } } },
    author: 'claude',
    message: 'Written from the campaign brief',
  });
  db.update(schema.pieces).set({ campaignId }).where(eq(schema.pieces.id, pieceId)).run();
  emit({ type: 'changed', entity: 'pieces', workspaceId, id: pieceId });
  emitCampaign(campaignId);
  emit({ type: 'job', jobType: 'ugc.script', status: 'done', workspaceId, message: `UGC script ready: ${out.title}` });
  await notify('UGC script ready', `“${out.title}” for ${c.title}: film it from the shot list.`, `/w/${workspaceId}/p/${pieceId}`);
}

export function onUgcScriptFailed(payload: unknown, message: string) {
  const { workspaceId } = (payload ?? {}) as { workspaceId?: string };
  emit({ type: 'job', jobType: 'ugc.script', status: 'error', workspaceId, message });
}

/** A campaign's filmed pieces (UGC), newest first. */
export function ugcPieces(campaignId: string) {
  return db
    .select({ id: schema.pieces.id, title: schema.pieces.title, stage: schema.pieces.stage, workspaceId: schema.pieces.workspaceId, createdAt: schema.pieces.createdAt })
    .from(schema.pieces)
    .where(and(eq(schema.pieces.campaignId, campaignId)))
    .orderBy(desc(schema.pieces.createdAt))
    .all();
}
