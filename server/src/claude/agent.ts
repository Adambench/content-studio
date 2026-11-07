import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { desc, eq } from 'drizzle-orm';
import type { ChatPart, ChatStreamEvent } from '../../../shared/types';
import { db, newId, now, schema } from '../db';
import { emit } from '../lib/events';
import { HttpError, notFound } from '../lib/http';
import { inReview } from '../../../shared/types';
import { findEditForPiece, listEditVersions } from '../studio/edits';
import { rerenderLatest } from '../studio/render';
import { getWorkspace } from '../services/pieces';
import { baseOptions, resolveModel } from './options';
import { FIX_SKILLS, skillOptions } from './plugin';
import { fixSystemPrompt } from './prompt';
import { buildTools, FIX_TOOLS, toolLabel } from './tools';
import { recordUsage } from './usage';
import { claudeFamily, countToolCall, countUse } from '../toolbox/uses';
import { isUsageError, markClaudeLimited } from '../ai/route';

/** Chats currently running, so they can be stopped and not run twice. */
const running = new Map<string, AbortController>();

export const isRunning = (threadId: string) => running.has(threadId);

export function stopChat(threadId: string) {
  running.get(threadId)?.abort();
}

/** A video's own chat: its latest, started on first use. */
export function pieceThread(piece: { id: string; workspaceId: string; title: string }) {
  const found = db.select().from(schema.chatThreads).where(eq(schema.chatThreads.pieceId, piece.id)).orderBy(desc(schema.chatThreads.updatedAt)).get();
  if (found) return found;
  const id = newId();
  db.insert(schema.chatThreads).values({ id, workspaceId: piece.workspaceId, pieceId: piece.id, title: piece.title.slice(0, 100) }).run();
  return db.select().from(schema.chatThreads).where(eq(schema.chatThreads.id, id)).get()!;
}

export async function runChat(input: {
  threadId: string;
  text: string;
  contextPieceId?: string | null;
  model?: string | null;
  /** A clip in Review isn't rendered again when Claude changes it (the check before a render fixing it renders it after checking the fix). */
  noRerender?: boolean;
  onEvent: (event: ChatStreamEvent) => void;
}) {
  const thread = db.select().from(schema.chatThreads).where(eq(schema.chatThreads.id, input.threadId)).get();
  if (!thread) throw notFound('Chat not found');
  if (running.has(thread.id)) throw new HttpError(409, 'Claude is still answering in this chat.');

  const ws = getWorkspace(thread.workspaceId);
  // A video's own chat is always about that video.
  const pieceId = thread.pieceId ?? input.contextPieceId;
  const piece = pieceId ? db.select().from(schema.pieces).where(eq(schema.pieces.id, pieceId)).get() : undefined;
  const contextPiece = piece && piece.workspaceId === ws.id ? piece : undefined;
  if (!contextPiece) throw new HttpError(400, 'Claude fixes one video at a time.');
  const model = resolveModel(input.model ?? thread.model);

  const userId = newId();
  db.insert(schema.chatMessages)
    .values({ id: userId, threadId: thread.id, role: 'user', parts: [{ type: 'text', text: input.text }], contextPieceId: contextPiece?.id ?? null })
    .run();
  const assistantId = newId();
  const parts: ChatPart[] = [];
  db.insert(schema.chatMessages).values({ id: assistantId, threadId: thread.id, role: 'assistant', parts, model }).run();
  db.update(schema.chatThreads)
    .set({ title: thread.title === 'New chat' && !thread.pieceId ? input.text.replace(/\s+/g, ' ').slice(0, 60) : thread.title, model, updatedAt: now() })
    .where(eq(schema.chatThreads.id, thread.id))
    .run();
  emit({ type: 'changed', entity: 'threads', workspaceId: ws.id, id: thread.id });

  countUse('model', `claude-${claudeFamily(model)}`);
  const persist = () => db.update(schema.chatMessages).set({ parts }).where(eq(schema.chatMessages.id, assistantId)).run();
  const abort = new AbortController();
  running.set(thread.id, abort);
  input.onEvent({ type: 'start', messageId: assistantId, model });

  // A video in Review shows what the creator approves: when this turn changed its edit, render it again.
  const editHead = () => {
    const edit = contextPiece ? findEditForPiece(contextPiece.id) : undefined;
    return edit ? { edit, version: listEditVersions(edit.id)[0] } : undefined;
  };
  const headBefore = editHead()?.version?.id;

  // The agent only fixes one video's edit before its render (studio/quality.ts): just the tools, skills and prompt for
  // that, and a new session each time (the lessons carry what lasts), so no call carries an earlier fix's turns.
  const { server, toolNames } = buildTools(ws.id, FIX_TOOLS);
  const { tools: skillTools, ...skills } = skillOptions(FIX_SKILLS);
  const systemPrompt = fixSystemPrompt(ws, contextPiece);

  const attempt = () =>
    query({
      prompt: input.text,
      options: {
        ...baseOptions(),
        ...skills,
        model,
        systemPrompt,
        tools: skillTools,
        mcpServers: { studio: server },
        allowedTools: toolNames,
        // Anything outside the allow-list is refused rather than prompting nobody.
        permissionPrompts: 'none',
        includePartialMessages: true,
        maxTurns: 40,
        abortController: abort,
      },
    });

  // Streamed text arrives as deltas; remember which messages streamed so full copies aren't added twice.
  const streamedMessages = new Set<string>();
  let refused = false;
  let currentText: Extract<ChatPart, { type: 'text' }> | null = null;

  const handle = (m: SDKMessage) => {
    switch (m.type) {
      case 'system':
        if (m.subtype === 'init' && m.session_id !== thread.sdkSessionId) {
          db.update(schema.chatThreads).set({ sdkSessionId: m.session_id }).where(eq(schema.chatThreads.id, thread.id)).run();
          thread.sdkSessionId = m.session_id;
        }
        break;
      case 'stream_event': {
        if (m.parent_tool_use_id) break;
        const ev = m.event;
        if (ev.type === 'message_start') streamedMessages.add(ev.message.id);
        else if (ev.type === 'content_block_start' && ev.content_block.type === 'text') currentText = null;
        else if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') {
          if (!currentText) {
            currentText = { type: 'text', text: '' };
            parts.push(currentText);
          }
          currentText.text += ev.delta.text;
          input.onEvent({ type: 'text', text: ev.delta.text });
        }
        break;
      }
      case 'assistant': {
        if (m.parent_tool_use_id) break;
        for (const block of m.message.content) {
          if (block.type === 'text' && !streamedMessages.has(m.message.id) && block.text) {
            parts.push({ type: 'text', text: block.text });
            input.onEvent({ type: 'text', text: block.text });
          } else if (block.type === 'tool_use' || block.type === 'server_tool_use') {
            const label = toolLabel(block.name, (block.input ?? {}) as Record<string, unknown>);
            countToolCall(block.name, (block.input ?? {}) as Record<string, unknown>);
            parts.push({ type: 'tool', id: block.id, name: block.name, label, status: 'running' });
            currentText = null;
            input.onEvent({ type: 'tool_start', id: block.id, name: block.name, label });
          }
        }
        persist();
        break;
      }
      case 'user': {
        if (m.parent_tool_use_id || typeof m.message.content === 'string') break;
        for (const block of m.message.content) {
          if (block.type !== 'tool_result') continue;
          const part = parts.find((p) => p.type === 'tool' && p.id === block.tool_use_id) as Extract<ChatPart, { type: 'tool' }> | undefined;
          if (!part) continue;
          const isError = !!block.is_error;
          part.status = isError ? 'error' : 'done';
          if (isError) {
            const text = typeof block.content === 'string' ? block.content : (block.content ?? []).map((c) => (c.type === 'text' ? c.text : '')).join(' ');
            part.detail = text.slice(0, 300);
          }
          input.onEvent({ type: 'tool_end', id: part.id, ok: !isError, detail: part.detail });
        }
        persist();
        break;
      }
      case 'rate_limit_event':
        input.onEvent({ type: 'usage', usage: recordUsage(m.rate_limit_info) });
        if (m.rate_limit_info.status === 'rejected') refused = true;
        break;
      case 'result':
        if (m.subtype !== 'success') {
          const message = m.errors?.join('; ') || m.subtype;
          if (isUsageError(message)) refused = true;
          parts.push({ type: 'text', text: `\n\n_Claude stopped: ${message}_` });
          input.onEvent({ type: 'error', message });
        }
        break;
    }
  };

  const rerenderForReview = () => {
    if (!contextPiece || abort.signal.aborted || input.noRerender) return;
    const now_ = editHead();
    if (!now_?.version || now_.version.id === headBefore || now_.version.author !== 'claude') return;
    const stage = db.select({ stage: schema.pieces.stage }).from(schema.pieces).where(eq(schema.pieces.id, contextPiece.id)).get()?.stage;
    if (!stage || !inReview(stage)) return;
    rerenderLatest(now_.edit.id, 'claude');
  };

  try {
    for await (const m of attempt()) handle(m);
    // Claude said no for usage: background work waits for it to come back.
    if (refused) markClaudeLimited();
  } catch (err) {
    if (abort.signal.aborted) {
      parts.push({ type: 'text', text: '\n\n_Stopped._' });
    } else {
      const message = describeError(err);
      parts.push({ type: 'text', text: `\n\n_Something went wrong: ${message}_` });
      input.onEvent({ type: 'error', message });
    }
  } finally {
    for (const p of parts) if (p.type === 'tool' && p.status === 'running') p.status = abort.signal.aborted ? 'error' : 'done';
    persist();
    running.delete(thread.id);
    rerenderForReview();
    db.update(schema.chatThreads).set({ updatedAt: now() }).where(eq(schema.chatThreads.id, thread.id)).run();
    emit({ type: 'changed', entity: 'threads', workspaceId: ws.id, id: thread.id });
    input.onEvent({ type: 'done', messageId: assistantId });
  }
}

function describeError(err: unknown) {
  const text = err instanceof Error ? err.message : String(err);
  if (/not logged in|login|authenticat|oauth/i.test(text)) return 'Claude isn’t signed in on this computer. Run `claude` in a terminal and use /login.';
  if (/rate limit|usage limit|429/i.test(text)) return 'You’ve hit your Claude usage limit for now. It resets soon — check Settings for the time.';
  return text.slice(0, 500);
}
