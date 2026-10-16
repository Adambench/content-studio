// The Inbox: footage that isn't in a video yet (shared from the phone, the camera, uploads made outside a video).
// Claude (Haiku, one call per batch) guesses the video each file belongs to, or names a new idea for it; one click
// files it.
import { readFile } from 'node:fs/promises';
import { and, desc, eq, inArray, isNull, notInArray } from 'drizzle-orm';
import { normalizeDraft, type InboxSuggestion, type MediaSource } from '../../../shared/types';
import { askStructured, type PromptImage } from '../claude/oneshot';
import { waitForUsage } from '../claude/usage';
import { db, now, schema } from '../db';
import { emit } from '../lib/events';
import { enqueue, hasPendingJob } from '../jobs/queue';
import { thumbPath, type MediaRow } from './media';
import { getWorkspace } from './pieces';

/** Files that are made inside a video or turned into an idea by themselves never wait in the Inbox. */
const NOT_LOOSE: MediaSource[] = ['render', 'clip', 'tts', 'generated', 'capture'];

export const inboxWhere = (workspaceId: string) =>
  and(eq(schema.media.workspaceId, workspaceId), isNull(schema.media.pieceId), isNull(schema.media.assetType), notInArray(schema.media.source, NOT_LOOSE));

export const isLoose = (m: Pick<MediaRow, 'pieceId' | 'assetType' | 'source'>) => !m.pieceId && !m.assetType && !NOT_LOOSE.includes(m.source);

/** Sort the Inbox soon: waits a little so files arriving together go in one Claude call. */
export function queueInboxSort(workspaceId: string, delayMs = 20_000) {
  if (!hasPendingJob('inbox.suggest', 'workspaceId', workspaceId)) enqueue('inbox.suggest', { workspaceId }, { delayMs, maxAttempts: 3 });
}

type Answer = { files: { id: string; pieceId: string; newTitle: string; why: string }[] };

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['files'],
  properties: {
    files: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'pieceId', 'newTitle', 'why'],
        properties: {
          id: { type: 'string', description: 'The file id' },
          pieceId: { type: 'string', description: 'The id of the video it belongs to, or "" when none fits' },
          newTitle: { type: 'string', description: 'When none fits: a short working title for a new video idea from this file (max 60 characters); otherwise ""' },
          why: { type: 'string', description: 'One short sentence: what in the file points there' },
        },
      },
    },
  },
};

const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n)}…` : text);

export async function suggestInbox({ workspaceId }: { workspaceId: string }) {
  const ws = getWorkspace(workspaceId);
  const loose = db
    .select()
    .from(schema.media)
    .where(and(inboxWhere(workspaceId), isNull(schema.media.suggestion), notInArray(schema.media.transcriptStatus, ['queued', 'running'])))
    .orderBy(desc(schema.media.createdAt))
    .limit(15)
    .all();
  if (!loose.length) return;
  waitForUsage();

  const pieces = db
    .select({ id: schema.pieces.id, title: schema.pieces.title, stage: schema.pieces.stage, tags: schema.pieces.tags, activeBranchId: schema.pieces.activeBranchId })
    .from(schema.pieces)
    .where(and(eq(schema.pieces.workspaceId, workspaceId), notInArray(schema.pieces.stage, ['posted', 'scheduled'])))
    .orderBy(desc(schema.pieces.updatedAt))
    .limit(60)
    .all();
  const branches = pieces.length
    ? db.select({ id: schema.branches.id, working: schema.branches.working }).from(schema.branches).where(inArray(schema.branches.id, pieces.map((p) => p.activeBranchId).filter((x): x is string => !!x))).all()
    : [];
  const draftOf = new Map(branches.map((b) => [b.id, normalizeDraft(b.working)]));
  const stageName = new Map(ws.stages.map((s) => [s.id, s.name]));

  const videos = pieces
    .map((p) => {
      const d = p.activeBranchId ? draftOf.get(p.activeBranchId) : undefined;
      return [`[${p.id}] ${p.title} (${stageName.get(p.stage) ?? p.stage})`, d?.hook && `  hook: ${clip(d.hook, 140)}`, d?.script && `  script: ${clip(d.script.replace(/\s+/g, ' '), 300)}`, p.tags.length && `  tags: ${p.tags.join(', ')}`]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');

  // Files without words are judged on a still (the thumbnail), a few at most.
  const images: PromptImage[] = [];
  const files: string[] = [];
  for (const m of loose) {
    const lines = [`[${m.id}] ${m.originalName} — ${m.kind}${m.durationMs ? `, ${Math.round(m.durationMs / 1000)} s` : ''}, added ${new Date(m.createdAt).toDateString()}`];
    if (m.notes.trim()) lines.push(`  notes: ${clip(m.notes, 200)}`);
    if (m.transcriptText?.trim()) lines.push(`  said: ${clip(m.transcriptText.replace(/\s+/g, ' '), 600)}`);
    else if (m.hasThumb && images.length < 6) {
      const data = await readFile(thumbPath(m.id)).catch(() => null);
      if (data) {
        images.push({ data: data.toString('base64'), mediaType: 'image/jpeg' });
        lines.push(`  (picture ${images.length} above is a still from it)`);
      }
    }
    files.push(lines.join('\n'));
  }

  const answer = await askStructured<Answer>({
    system: [
      `You file a creator's loose footage into the right video in their "${ws.name}" workspace (${ws.kind === 'clipping' ? 'a clipping page' : ws.kind === 'business' ? 'a business page' : 'their personal brand'}).`,
      'Each video is a package: an idea or script being made into one short vertical video. Match a file to the video whose topic, script or wording it fits; when none fits, leave pieceId empty and name the new idea it could start (in their language, max 60 characters).',
      'Only match when the evidence is clear (what is said, what is shown, the file name). Never invent ids.',
      ws.niche && `The page's niche: ${ws.niche}`,
    ]
      .filter(Boolean)
      .join('\n'),
    prompt: `Videos in progress:\n${videos || '(none yet)'}\n\nLoose files:\n${files.join('\n')}`,
    schema: SCHEMA,
    model: 'haiku',
    images,
  });

  const known = new Set(pieces.map((p) => p.id));
  const at = now();
  for (const f of answer.files) {
    const m = loose.find((x) => x.id === f.id);
    if (!m) continue;
    const pieceId = f.pieceId && known.has(f.pieceId) ? f.pieceId : null;
    const title = pieceId ? (pieces.find((p) => p.id === pieceId)?.title ?? '') : f.newTitle.trim().slice(0, 80) || m.originalName.replace(/\.[^.]+$/, '');
    const suggestion: InboxSuggestion = { pieceId, title, why: f.why.trim().slice(0, 300), at };
    db.update(schema.media).set({ suggestion }).where(eq(schema.media.id, m.id)).run();
  }
  emit({ type: 'changed', entity: 'media', workspaceId });
}
