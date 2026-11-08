import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { and, desc, eq, inArray, isNull, like, or } from 'drizzle-orm';
import { z } from 'zod';
import { enqueue } from '../jobs/queue';
import { inReview, normalizeDraft, type DraftContent } from '../../../shared/types';
import { config } from '../config';
import { db, newId, now, schema } from '../db';
import { emit } from '../lib/events';
import { extractFrames } from '../lib/ffmpeg';
import { formatTime, getMedia, mediaPath, readTranscript } from '../services/media';
import { createBranch, createPiece, getBranch, getPiece, getPieceDetail, getWorkspace, mergeDraft, saveVersion } from '../services/pieces';
import { clock, MOMENT_KIND_LABELS } from '../../../shared/clipping';
import { campaignsForWorkspace, listMoments, listSources } from '../campaigns/campaigns';
import { getMoment, queueMake } from '../clipping/moments';
import { findMoments } from '../routes/clipping';
import { accountLabel, listAccounts } from '../publish/accounts';
import { piecePosts, upcomingPosts } from '../publish/posts';
import { studioTools, studioToolLabel } from './studio-tools';
import { reviewStates } from '../studio/notes';
import { REVIEW_LABELS } from '../../../shared/review';
import { ok, safe, ToolError } from './tool-helpers';
import { KNOWLEDGE_TOPIC_INFO, KNOWLEDGE_TOPICS } from '../../../shared/knowledge';
import { createRule, knowledgeText } from '../knowledge/knowledge';
import { referencesText } from '../knowledge/references';

export const SERVER_NAME = 'studio';


const platformsShape = z
  .object({
    tiktok: z.object({ caption: z.string().optional(), hashtags: z.string().optional() }).optional(),
    instagram: z.object({ caption: z.string().optional(), hashtags: z.string().optional() }).optional(),
    youtube: z.object({ title: z.string().optional(), description: z.string().optional(), tags: z.string().optional() }).optional(),
    x: z.object({ text: z.string().optional() }).optional(),
  })
  .optional()
  .describe('Per-platform fields to set. Only the fields you include are changed.');

const draftShape = {
  hook: z.string().optional().describe('Opening line / first 1-2 seconds'),
  script: z.string().optional().describe('The script or outline (markdown allowed)'),
  notes: z.string().optional().describe('Production notes: shots, b-roll, on-screen text ideas'),
  platforms: platformsShape,
};

type DraftPatch = { hook?: string; script?: string; notes?: string; platforms?: Partial<Record<string, Record<string, string | undefined>>> };

function cleanPatch(patch: DraftPatch): Partial<DraftContent> {
  const strip = (o?: Record<string, string | undefined>) => (o ? Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) : undefined);
  const platforms = patch.platforms ? Object.fromEntries(Object.entries(patch.platforms).map(([k, v]) => [k, strip(v)])) : undefined;
  return Object.fromEntries(
    Object.entries({ hook: patch.hook, script: patch.script, notes: patch.notes, platforms }).filter(([, v]) => v !== undefined),
  ) as Partial<DraftContent>;
}

/** Human-readable labels for the tool chips in the chat UI. */
export function toolLabel(fullName: string, input: Record<string, any>): string {
  const name = fullName.replace(`mcp__${SERVER_NAME}__`, '');
  switch (name) {
    case 'get_board':
      return 'Read the board';
    case 'search':
      return `Searched “${input.query ?? ''}”`;
    case 'list_media':
      return 'Looked through the footage';
    case 'get_piece':
      return 'Opened a piece';
    case 'create_piece':
      return `Created “${input.title ?? 'a piece'}”`;
    case 'update_piece':
      return input.stage ? 'Moved a piece' : 'Updated a piece';
    case 'write_draft':
      return input.message ? `Wrote: ${input.message}` : 'Wrote a draft';
    case 'create_alternative':
      return `New alternative “${input.name ?? ''}”`;
    case 'get_version':
      return 'Opened an older version';
    case 'get_transcript':
      return 'Read a transcript';
    case 'view_frames':
      return `Looked at ${input.atSeconds?.length ?? input.count ?? 4} frames`;
    case 'link_media':
      return input.pieceId ? 'Attached footage' : 'Detached footage';
    case 'update_voice_memory':
      return 'Updated voice memory';
    case 'get_schedule':
      return 'Read the posting schedule';
    case 'get_analytics':
      return input.pieceId ? 'Read how this piece did' : 'Read the analytics';
    case 'get_campaigns':
      return 'Read the campaigns';
    case 'get_campaign':
      return 'Read a campaign’s rules';
    case 'find_moments':
      return 'Started finding moments';
    case 'make_clip':
      return 'Started making a clip';
    case 'write_ugc_video':
      return 'Started a UGC video';
    case 'get_research':
      return 'Read the research brief';
    case 'get_ideas':
      return 'Read the Ideas canvas';
    case 'get_notebook':
      return input.noteId ? 'Read one of your notes' : 'Read your notes';
    case 'get_knowledge':
      return `Read the Knowledge rules${input.topics?.length ? `: ${input.topics.join(', ')}` : ''}`;
    case 'get_references':
      return 'Read the videos that inspire this page';
    case 'suggest_rule':
      return `Suggested a rule: ${input.title ?? ''}`;
    case 'add_ideas':
      return `Added ${input.items?.length ?? ''} card${input.items?.length === 1 ? '' : 's'} to Ideas`;
    case 'WebSearch':
      return `Searched the web: ${input.query ?? ''}`;
    case 'WebFetch':
      try {
        return `Read ${new URL(input.url).hostname}`;
      } catch {
        return 'Read a web page';
      }
    case 'Skill':
      return `Opened the ${String(input.skill ?? 'a').replace(/^[\w-]+:/, '')} skill`;
    case 'Read': {
      // Only the skills' files are readable: name the file by its skill, e.g. "playbook › hooks".
      const m = /skills\/([^/]+)\/(?:.*\/)?([^/]+?)(?:\.md)?$/.exec(String(input.file_path ?? ''));
      return m ? `Read ${m[1]} › ${m[2]}` : 'Read a skill file';
    }
    default:
      return studioToolLabel(name, input) ?? name;
  }
}

/** The app's tools, scoped to one workspace so Claude can't touch other brands. */
/** The tools the fix before a render uses (claude/agent.ts): reading and changing one video's edit, nothing else. */
export const FIX_TOOLS = [
  'get_piece',
  'list_media',
  'get_transcript',
  'view_frames',
  'get_knowledge',
  'get_campaigns',
  'get_campaign',
  'get_edit',
  'update_edit',
  'tighten_edit',
  'follow_speaker',
  'write_scene',
  'add_library_scene',
  'get_quran',
  'view_overlay',
  'view_render',
  'get_clip_source',
  'recut_clip',
  'list_assets',
] as const;

/** Claude's tools for one workspace; `only` keeps just those (by name). */
export function buildTools(workspaceId: string, only?: readonly string[]) {
  const ownPiece = (pieceId: string) => {
    const piece = getPiece(pieceId);
    if (piece.workspaceId !== workspaceId) throw new ToolError('That piece belongs to another workspace.');
    return piece;
  };
  const ownMedia = (mediaId: string) => {
    const m = getMedia(mediaId);
    if (m.workspaceId !== workspaceId) throw new ToolError('That file belongs to another workspace.');
    return m;
  };
  const mediaSummary = (m: typeof schema.media.$inferSelect) => ({
    id: m.id,
    name: m.originalName,
    kind: m.kind,
    seconds: m.durationMs ? Math.round(m.durationMs / 1000) : undefined,
    size: m.width && m.height ? `${m.width}x${m.height}` : undefined,
    transcript: m.transcriptStatus,
    pieceId: m.pieceId ?? undefined,
    notes: m.notes || undefined,
  });

  const all = [
    tool('get_board', 'List the pipeline stages and every piece on the board (id, title, stage, tags, hook preview, and whether the creator has watched its newest render: To watch, To improve, Check again, Looks good).', {}, safe(async () => {
      const ws = getWorkspace(workspaceId);
      const pieces = db.select().from(schema.pieces).where(eq(schema.pieces.workspaceId, workspaceId)).orderBy(schema.pieces.position).all();
      const activeIds = pieces.map((p) => p.activeBranchId).filter((id): id is string => !!id);
      const branches = activeIds.length
        ? db.select({ id: schema.branches.id, working: schema.branches.working }).from(schema.branches).where(inArray(schema.branches.id, activeIds)).all()
        : [];
      const hookOf = new Map(branches.map((b) => [b.id, normalizeDraft(b.working).hook]));
      const review = reviewStates(pieces);
      return ok({
        stages: ws.stages.map((s) => ({
          id: s.id,
          name: s.name,
          pieces: pieces
            .filter((p) => p.stage === s.id)
            .map((p) => {
              const r = review.get(p.id);
              return {
                id: p.id,
                title: p.title,
                tags: p.tags,
                hook: (hookOf.get(p.activeBranchId ?? '') ?? '').slice(0, 120) || undefined,
                updated: new Date(p.updatedAt).toISOString().slice(0, 10),
                // Where the creator is with watching its newest render (open comments: get_notes).
                watched: r?.state ? `${REVIEW_LABELS[r.state]}${r.open ? ` (${r.open} open comment${r.open === 1 ? '' : 's'})` : ''}` : undefined,
              };
            }),
        })),
      });
    })),

    tool(
      'search',
      'Search pieces (titles and draft text) and the media library (file names, notes and spoken transcripts).',
      { query: z.string().min(1) },
      safe(async ({ query }) => {
        const q = `%${query}%`;
        const pieceRows = db
          .selectDistinct({ id: schema.pieces.id, title: schema.pieces.title, stage: schema.pieces.stage })
          .from(schema.pieces)
          .leftJoin(schema.branches, eq(schema.branches.pieceId, schema.pieces.id))
          .where(and(eq(schema.pieces.workspaceId, workspaceId), or(like(schema.pieces.title, q), like(schema.branches.working, q))))
          .limit(20)
          .all();
        const mediaRows = db
          .select()
          .from(schema.media)
          .where(and(eq(schema.media.workspaceId, workspaceId), or(like(schema.media.originalName, q), like(schema.media.notes, q), like(schema.media.transcriptText, q))))
          .limit(20)
          .all();
        const snippet = (text: string | null) => {
          if (!text) return undefined;
          const i = text.toLowerCase().indexOf(query.toLowerCase());
          return i < 0 ? undefined : `…${text.slice(Math.max(0, i - 80), i + query.length + 80)}…`;
        };
        return ok({ pieces: pieceRows, media: mediaRows.map((m) => ({ ...mediaSummary(m), match: snippet(m.transcriptText) })) });
      }),
    ),

    tool(
      'list_media',
      'List footage, newest first: each file with the piece (video) it belongs to, or none when it waits in the Inbox.',
      { unattachedOnly: z.boolean().optional().describe('Only the Inbox: files not in any piece yet'), limit: z.number().int().min(1).max(100).optional() },
      safe(async ({ unattachedOnly, limit }) => {
        const rows = db
          .select()
          .from(schema.media)
          .where(and(eq(schema.media.workspaceId, workspaceId), isNull(schema.media.assetType), unattachedOnly ? isNull(schema.media.pieceId) : undefined))
          .orderBy(desc(schema.media.createdAt))
          .limit(limit ?? 30)
          .all();
        return ok(rows.map(mediaSummary));
      }),
    ),

    tool(
      'get_piece',
      'Get a piece: its alternatives (each with the full current draft and recent version history) and attached footage.',
      { pieceId: z.string() },
      safe(async ({ pieceId }) => {
        ownPiece(pieceId);
        const d = getPieceDetail(pieceId);
        return ok({
          id: d.id,
          title: d.title,
          stage: d.stage,
          tags: d.tags,
          alternatives: d.branches.map((b) => ({
            id: b.id,
            name: b.name,
            active: b.id === d.activeBranchId,
            draft: b.working,
            versions: b.versions.slice(0, 8).map((v) => ({ id: v.id, number: v.number, author: v.author, message: v.message, at: new Date(v.createdAt).toISOString() })),
          })),
          footage: d.media.map(mediaSummary),
        });
      }),
    ),

    tool(
      'create_piece',
      'Create a new piece (card) on the board, optionally with a first draft.',
      { title: z.string().min(1), stage: z.string().optional().describe('Stage id; defaults to the first stage'), tags: z.array(z.string()).optional(), ...draftShape },
      safe(async ({ title, stage, tags, ...draft }) => {
        const content = cleanPatch(draft);
        const hasContent = Object.keys(content).length > 0;
        const { pieceId, branchId } = createPiece(workspaceId, { title, stage, tags, content: hasContent ? content : undefined, author: 'claude', message: 'Created by Claude' });
        return ok({ pieceId, alternativeId: branchId });
      }),
    ),

    tool(
      'update_piece',
      'Rename a piece, move it to another stage, or replace its tags.',
      { pieceId: z.string(), title: z.string().optional(), stage: z.string().optional().describe('Stage id'), tags: z.array(z.string()).optional() },
      safe(async ({ pieceId, title, stage, tags }) => {
        const piece = ownPiece(pieceId);
        const ws = getWorkspace(workspaceId);
        if (stage && !ws.stages.some((s) => s.id === stage)) throw new ToolError(`Unknown stage. Valid ids: ${ws.stages.map((s) => s.id).join(', ')}`);
        // Leaving Review is the creator's yes or no (With Claude goes back to Review by itself); Scheduled and Posted
        // follow real posts.
        if (stage && stage !== piece.stage && inReview(piece.stage))
          throw new ToolError('Only the creator takes a card out of Review (approve or reject it there). One in With Claude goes back to Review by itself once its comments are resolved and its new version has rendered.');
        if (stage && stage !== piece.stage && (stage === 'ready' || stage === 'scheduled' || stage === 'posted')) throw new ToolError('Only the creator approves a card; it moves to Scheduled and Posted by itself when posts are scheduled and go out.');
        db.update(schema.pieces)
          .set({ title: title ?? piece.title, stage: stage ?? piece.stage, tags: tags ?? piece.tags, updatedAt: now() })
          .where(eq(schema.pieces.id, pieceId))
          .run();
        emit({ type: 'changed', entity: 'pieces', workspaceId, id: pieceId });
        return ok('Updated.');
      }),
    ),

    tool(
      'write_draft',
      'Write into a piece’s draft and save it as a new version authored by you. Only the fields you pass change. ' +
        'Defaults to the active alternative. The user can compare and restore versions.',
      { pieceId: z.string(), alternativeId: z.string().optional(), message: z.string().describe('Short version note, e.g. "Punchier hook"'), ...draftShape },
      safe(async ({ pieceId, alternativeId, message, ...draft }) => {
        const piece = ownPiece(pieceId);
        const branchId = alternativeId ?? piece.activeBranchId;
        if (!branchId) throw new ToolError('This piece has no alternative to write into.');
        const branch = getBranch(branchId);
        if (branch.pieceId !== pieceId) throw new ToolError('That alternative belongs to another piece.');
        const content = mergeDraft(normalizeDraft(branch.working), cleanPatch(draft));
        const { version, unchanged } = saveVersion(branchId, { author: 'claude', message, content });
        return ok(unchanged ? 'No changes — the draft already had that content.' : `Saved v${version.number} on “${branch.name}”.`);
      }),
    ),

    tool(
      'create_alternative',
      'Start a new alternative (a parallel take, e.g. a different hook or angle) of a piece, copied from an existing alternative or version, with your changes applied.',
      {
        pieceId: z.string(),
        name: z.string().describe('Short name, e.g. "Story hook"'),
        fromAlternativeId: z.string().optional(),
        fromVersionId: z.string().optional(),
        message: z.string().optional(),
        ...draftShape,
      },
      safe(async ({ pieceId, name, fromAlternativeId, fromVersionId, message, ...draft }) => {
        ownPiece(pieceId);
        const { branchId, version } = createBranch(pieceId, { name, fromBranchId: fromAlternativeId, fromVersionId, content: cleanPatch(draft), author: 'claude', message });
        return ok({ alternativeId: branchId, version: version.number });
      }),
    ),

    tool('get_version', 'Read the full content of an older version.', { versionId: z.string() }, safe(async ({ versionId }) => {
      const v = db.select().from(schema.versions).where(eq(schema.versions.id, versionId)).get();
      if (!v) throw new ToolError('Version not found.');
      ownPiece(v.pieceId);
      return ok({ number: v.number, author: v.author, message: v.message, draft: normalizeDraft(v.content) });
    })),

    tool(
      'get_transcript',
      'Read the spoken transcript of a video or voice memo, with timestamps.',
      { mediaId: z.string() },
      safe(async ({ mediaId }) => {
        const m = ownMedia(mediaId);
        if (m.transcriptStatus !== 'done') throw new ToolError(`No transcript (status: ${m.transcriptStatus}).`);
        const t = await readTranscript(mediaId);
        if (!t) throw new ToolError('Transcript file is missing.');
        const lines = t.segments.map((s) => `[${formatTime(s.start)}] ${s.text}`).join('\n');
        return ok(`${m.originalName} — language: ${t.language}, ${formatTime(t.duration)} long\n\n${lines.slice(0, 40_000)}`);
      }),
    ),

    tool(
      'view_frames',
      'Look at still frames from a video. Either evenly spaced (count) or at specific seconds.',
      { mediaId: z.string(), count: z.number().int().min(1).max(8).optional(), atSeconds: z.array(z.number().min(0)).max(8).optional() },
      safe(async ({ mediaId, count, atSeconds }) => {
        const m = ownMedia(mediaId);
        if (m.kind !== 'video' && m.kind !== 'image') throw new ToolError('Only videos and images have frames.');
        if (m.kind === 'image') {
          const data = await readFile(mediaPath(m));
          if (data.length > 4_500_000) throw new ToolError('Image too large to view.');
          return { content: [{ type: 'image', data: data.toString('base64'), mimeType: m.mime }] };
        }
        const duration = (m.durationMs ?? 0) / 1000;
        const n = count ?? 4;
        const times = atSeconds?.length ? atSeconds.map((t) => Math.min(t, Math.max(0, duration - 0.1))) : Array.from({ length: n }, (_, i) => (duration * (i + 0.5)) / n);
        const prefix = join(config.framesDir, `${newId()}`);
        const files = await extractFrames(mediaPath(m), times, (i) => `${prefix}-${i}.jpg`);
        try {
          const images = await Promise.all(files.map((f) => readFile(f)));
          return {
            content: [
              { type: 'text', text: `Frames at ${times.map((t) => formatTime(t)).join(', ')} (video is ${formatTime(duration)}, ${m.width}x${m.height})` },
              ...images.map((img) => ({ type: 'image' as const, data: img.toString('base64'), mimeType: 'image/jpeg' })),
            ],
          };
        } finally {
          await Promise.all(files.map((f) => rm(f, { force: true })));
        }
      }),
    ),

    tool(
      'link_media',
      'Attach a library file to a piece, or detach it (pieceId null).',
      { mediaId: z.string(), pieceId: z.string().nullable() },
      safe(async ({ mediaId, pieceId }) => {
        const m = ownMedia(mediaId);
        if (pieceId) ownPiece(pieceId);
        db.update(schema.media).set({ pieceId }).where(eq(schema.media.id, mediaId)).run();
        emit({ type: 'changed', entity: 'media', workspaceId, id: mediaId });
        for (const id of [m.pieceId, pieceId]) if (id) emit({ type: 'changed', entity: 'pieces', workspaceId, id });
        return ok('Done.');
      }),
    ),

    tool(
      'update_voice_memory',
      'Replace the workspace’s voice memory — your notes on how this creator wants things written. Use when they state a lasting preference. Send the full updated notes, not a diff.',
      { memory: z.string().describe('Full updated notes as short markdown bullets') },
      safe(async ({ memory }) => {
        db.update(schema.workspaces).set({ voiceMemory: memory.trim(), updatedAt: now() }).where(eq(schema.workspaces.id, workspaceId)).run();
        emit({ type: 'changed', entity: 'workspaces', workspaceId });
        return ok('Voice memory updated.');
      }),
    ),

    tool(
      'get_schedule',
      'Read the posting schedule: connected accounts with their queue times, and posts (scheduled, going out, posted, failed or missed) from the last week onwards. ' +
        'Read-only: you cannot schedule, publish or change posts — the creator does that with a click.',
      { pieceId: z.string().optional().describe('Only this piece’s posts') },
      safe(async ({ pieceId }) => {
        if (pieceId) ownPiece(pieceId);
        const when = (ms: number) => new Date(ms).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
        const posts = (pieceId ? piecePosts(pieceId) : upcomingPosts(workspaceId)).map((p) => ({
          piece: p.pieceTitle,
          pieceId: p.pieceId,
          account: p.accountLabel,
          when: when(p.scheduledAt),
          status: p.status,
          note: p.error ?? (p.stage || undefined),
          url: p.url ?? undefined,
        }));
        const accounts = listAccounts(workspaceId).map((a) => ({
          account: accountLabel(a),
          status: a.status,
          queue: a.slots.map((s) => `${s.time} on ${s.days.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join('/')}`),
        }));
        return ok({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, now: when(now()), accounts, posts });
      }),
    ),

    tool(
      'get_campaigns',
      'List the campaigns this page works on (marketplace campaigns from Content Rewards or Vyro assigned to it, or this business’s own): status, payout per 1,000 views, budget left, deadline, ' +
        'platforms and the halal screen. Read-only: adding, confirming and assigning campaigns is the creator’s click.',
      {},
      safe(async () => {
        const day = (ms: number | null) => (ms ? new Date(ms).toDateString() : undefined);
        return ok(
          campaignsForWorkspace(workspaceId).map((c) => ({
            id: c.id,
            title: c.title,
            brand: c.brand || undefined,
            origin: c.origin,
            status: c.status,
            ratePer1k: c.ratePer1k ?? undefined,
            budgetLeft: c.budgetLeft ?? undefined,
            budgetTotal: c.budgetTotal ?? undefined,
            deadline: day(c.deadline),
            platforms: c.platforms,
            halal: c.halalVerdict ?? undefined,
            rules: c.checklist.length,
          })),
        );
      }),
    ),

    tool(
      'get_campaign',
      'Read one campaign in full: the brief, every rule (kind and what the app can check), creator requirements, payouts per platform, budget, the halal screen with ' +
        'its reasons and its source videos (title, length, whether they are downloaded and transcribed). Check its rules before suggesting anything for it. Read-only.',
      { campaignId: z.string().describe('From get_campaigns') },
      safe(async ({ campaignId }) => {
        const c = campaignsForWorkspace(workspaceId).find((x) => x.id === campaignId);
        if (!c) throw new ToolError('That campaign isn’t one this page works on.');
        const moments = listMoments(c.id);
        const sources = listSources(c.id).map((s) => ({
          id: s.id,
          title: s.title || s.link || 'Upload',
          kind: s.kind,
          minutes: s.durationMs ? Math.round(s.durationMs / 60000) : undefined,
          status: s.status,
          detail: s.detail || undefined,
          transcript: s.transcriptFrom ?? undefined,
          moments: moments
            .filter((m) => m.sourceId === s.id)
            .map((m) => ({
              id: m.id,
              at: `${clock(m.start)}–${clock(m.end)}`,
              title: m.title,
              kind: MOMENT_KIND_LABELS[m.kind],
              score: m.score,
              status: m.status,
              forThisPage: m.workspaceId === workspaceId,
              clipStage: m.pieceStage ?? undefined,
              pieceId: m.workspaceId === workspaceId ? (m.pieceId ?? undefined) : undefined,
              why: m.status === 'rejected' ? `Rejected: ${m.rejectReason}` : m.status === 'dropped' || m.status === 'failed' ? m.detail : undefined,
            })),
        }));
        return ok({
          title: c.title,
          brand: c.brand,
          type: c.type,
          category: c.category,
          status: c.status,
          link: c.link ?? undefined,
          brief: c.description,
          rules: c.checklist.map((r) => ({ rule: r.text, kind: r.kind, check: r.check ?? undefined, addedBy: r.by === 'you' ? 'creator' : undefined })),
          rulesAsWritten: c.rulesText || undefined,
          rulesLocked: c.rulesLocked || undefined,
          requirements: c.requirements || undefined,
          payouts: c.payouts,
          budget: { left: c.budgetLeft, total: c.budgetTotal },
          deadline: c.deadline ? new Date(c.deadline).toDateString() : undefined,
          halal: { verdict: c.halalVerdict, reasons: c.halalReasons },
          sources,
        });
      }),
    ),

    tool(
      'find_moments',
      'Start finding moments in one of a campaign’s source videos (downloaded and transcribed): the app scans it, then one background Claude request picks 3–8 moments ' +
        'by the playbook and the campaign’s rules, and each is made into a clip that lands in Review. Local work, allowed; it replaces the moments still waiting. ' +
        'Approving, scheduling and submitting stay the creator’s click.',
      { sourceId: z.string().describe('From get_campaign') },
      safe(async ({ sourceId }) => {
        const c = campaignsForWorkspace(workspaceId).find((x) => listSources(x.id).some((s) => s.id === sourceId));
        if (!c) throw new ToolError('That source isn’t in a campaign this page works on.');
        await findMoments(sourceId).catch((err: Error) => {
          throw new ToolError(err.message);
        });
        return ok('Started: the scan runs first, then the pick. The moments and clips show on the campaign’s page and in Review.');
      }),
    ),

    tool(
      'make_clip',
      'Make (or make again) the clip of one moment: cut, music removed, checked, edited in the page’s look and rendered into Review. For a moment that was skipped, failed ' +
        'or dropped, or whose card was deleted. Local work, allowed.',
      { momentId: z.string().describe('From get_campaign') },
      safe(async ({ momentId }) => {
        const m = getMoment(momentId);
        if (!campaignsForWorkspace(workspaceId).some((c) => c.id === m.campaignId) || m.workspaceId !== workspaceId) throw new ToolError('That moment is for another page.');
        if (m.status === 'making') throw new ToolError('It’s being made already.');
        if (m.status === 'made' && m.pieceId) throw new ToolError('Its clip is already on the board.');
        if (campaignsForWorkspace(workspaceId).find((c) => c.id === m.campaignId)?.status !== 'active') throw new ToolError('The campaign isn’t active.');
        queueMake(m.id);
        return ok('Queued: the clip lands in Review once it’s rendered.');
      }),
    ),

    tool(
      'get_knowledge',
      'The live rules from the Knowledge page: the playbook as the creator keeps it (edited, turned off, added to). Where they differ from the playbook skill’s files, these win. ' +
        `Topics: ${KNOWLEDGE_TOPICS.map((t) => `${t} (${KNOWLEDGE_TOPIC_INFO[t].hint})`).join('; ')}.`,
      { topics: z.array(z.enum(KNOWLEDGE_TOPICS)).min(1).max(KNOWLEDGE_TOPICS.length) },
      safe(async ({ topics }) => ok(knowledgeText(topics, workspaceId) || 'No rules on those topics yet.')),
    ),

    tool(
      'get_references',
      'The videos that moved the creator, on the Knowledge page (for every page or this one), newest first: what moved them, why each works, how it’s built, its ingredients (idea, story, visuals, quality, voice, text, pace, sound, feel) with the creator’s marks (wanted, not for them), and its measured numbers. ' +
        'Use it when they ask for a video like one of them, or to match their style. Take what they marked wanted, leave what they marked not for them; learn the moves and the feel, never the words; never anything with instruments.',
      {},
      safe(async () => {
        const list = referencesText(workspaceId);
        return ok(list.length ? list.join('\n\n') : 'No references yet. The creator pastes videos that moved them on the Knowledge page → Inspiration.');
      }),
    ),

    tool(
      'suggest_rule',
      'Suggest a new rule for the Knowledge page, something worth applying to every video (learned from results, a reference or the creator’s feedback). ' +
        'It waits as Suggested until the creator approves it; it changes nothing before that. Only when it’s new and specific, never a restatement of an existing rule.',
      {
        topic: z.enum(KNOWLEDGE_TOPICS),
        title: z.string().min(3).max(120).describe('The rule in a few words'),
        body: z.string().min(10).max(2000).describe('The rule, how to apply it, and an example'),
        why: z.string().min(5).max(600).describe('Where it comes from: the result, reference or feedback behind it'),
      },
      safe(async ({ topic, title, body, why }) => {
        createRule({ topic, title, body, note: why, source: 'claude', status: 'proposed' });
        return ok('Suggested. It shows on the Knowledge page under Suggested until the creator approves or dismisses it.');
      }),
    ),

    ...studioTools(workspaceId, ownPiece),
  ];
  const tools = only ? all.filter((t) => only.includes(t.name)) : all;

  const server = createSdkMcpServer({ name: SERVER_NAME, version: '0.1.0', tools, alwaysLoad: true });
  // `tools` is for the local chat, which calls the same handlers through its own loop.
  return { server, tools, toolNames: tools.map((t) => `mcp__${SERVER_NAME}__${t.name}`) };
}
