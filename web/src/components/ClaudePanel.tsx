import { ArrowUp, ChevronDown, FileText, MessageSquarePlus, Square, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CLAUDE_MODELS, type ChatPart, type ChatStreamEvent } from '@shared/types';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { api, apiFetch, errorMessage } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { keys, queryClient, useMessages, useSettings, useThreads } from '@/lib/queries';
import type { Thread } from '@/lib/types';
import { activeThread, composerPrefill, useStore } from '@/lib/ui-state';
import { cn } from '@/lib/utils';
import { AssistantParts } from './ChatParts';
import { UsageMeter } from './UsageMeter';

type Pending = { text: string; parts: ChatPart[]; threadId: string };

const SUGGESTIONS = {
  piece: ['Write 3 hook options as alternatives', 'Draft captions for every platform', 'Watch the footage and tell me what works', 'Tighten the script to 30 seconds'],
  video: ['Pick the best takes from the transcript', 'Cut the pauses and add the hook as on-screen text', 'Reframe the shots on the speaker', 'Suggest b-roll and where it goes'],
  general: ['What should I post this week?', 'Research what’s trending in my niche', 'Turn my newest ideas into scripts', 'Review my board and suggest priorities'],
};

export function ClaudePanel({ wid, piece, onClose }: { wid: string; piece?: { id: string; title: string; view?: 'video' }; onClose?: () => void }) {
  const threads = useThreads(wid);
  const settings = useSettings();
  const activeMap = useStore(activeThread);
  const list = threads.data ?? [];
  const threadId = activeMap[wid] && list.some((t) => t.id === activeMap[wid]) ? activeMap[wid] : list[0]?.id ?? null;
  const thread = list.find((t) => t.id === threadId);
  const messages = useMessages(threadId);

  const [model, setModel] = useState<string>('');
  const effectiveModel = model || thread?.model || settings.data?.defaultModel || 'sonnet';
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const prefill = useStore(composerPrefill);

  useEffect(() => setModel(''), [threadId]);

  useEffect(() => {
    if (!prefill) return;
    setInput(prefill.text);
    composerPrefill.set(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [prefill]);

  const shown = messages.data?.messages ?? [];
  const busy = !!pending || !!messages.data?.thread.running;

  // Keep the newest message in view while Claude writes.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown.length, pending?.parts, pending?.text]);

  const selectThread = (id: string | null) => activeThread.set((m) => ({ ...m, [wid]: id ?? '' }));

  async function newChat() {
    selectThread(null);
    const t = await api<Thread>(`/workspaces/${wid}/threads`, { body: { model: model || undefined } });
    await queryClient.invalidateQueries({ queryKey: keys.threads(wid) });
    selectThread(t.id);
    inputRef.current?.focus();
  }

  async function deleteThread(id: string) {
    await api(`/threads/${id}`, { method: 'DELETE' });
    if (id === threadId) selectThread(null);
    queryClient.invalidateQueries({ queryKey: keys.threads(wid) });
  }

  async function send(text: string) {
    text = text.trim();
    if (!text || busy) return;
    setError('');
    setInput('');
    let id = threadId;
    try {
      if (!id) {
        const t = await api<Thread>(`/workspaces/${wid}/threads`, { body: { model: effectiveModel } });
        id = t.id;
        selectThread(id);
      }
      setPending({ text, parts: [], threadId: id });
      const res = await apiFetch(`/threads/${id}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, contextPieceId: piece?.id ?? null, contextView: piece?.view ?? null, model: effectiveModel }),
      });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? `Request failed (${res.status})`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? '';
        for (const chunk of chunks) {
          const line = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (line) applyEvent(JSON.parse(line.slice(6)) as ChatStreamEvent);
        }
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      if (id) await queryClient.invalidateQueries({ queryKey: keys.messages(id) });
      queryClient.invalidateQueries({ queryKey: keys.threads(wid) });
      setPending(null);
    }
  }

  function applyEvent(ev: ChatStreamEvent) {
    if (ev.type === 'usage') {
      queryClient.setQueryData(keys.settings, (s: object | undefined) => (s ? { ...s, claudeUsage: ev.usage } : s));
      return;
    }
    if (ev.type === 'error') setError(ev.message);
    setPending((p) => {
      if (!p) return p;
      const parts = [...p.parts];
      if (ev.type === 'text') {
        const last = parts[parts.length - 1];
        if (last?.type === 'text') parts[parts.length - 1] = { ...last, text: last.text + ev.text };
        else parts.push({ type: 'text', text: ev.text });
      } else if (ev.type === 'tool_start') {
        parts.push({ type: 'tool', id: ev.id, name: ev.name, label: ev.label, status: 'running' });
      } else if (ev.type === 'tool_end') {
        const i = parts.findIndex((x) => x.type === 'tool' && x.id === ev.id);
        if (i >= 0) parts[i] = { ...(parts[i] as Extract<ChatPart, { type: 'tool' }>), status: ev.ok ? 'done' : 'error', detail: ev.detail };
      } else return p;
      return { ...p, parts };
    });
  }

  async function stop() {
    if (threadId) await api(`/threads/${threadId}/stop`, { body: {} }).catch(() => {});
  }

  async function changeModel(m: string) {
    setModel(m);
    if (threadId) await api(`/threads/${threadId}`, { method: 'PATCH', body: { model: m } }).catch(() => {});
  }

  const suggestions = piece ? (piece.view === 'video' ? SUGGESTIONS.video : SUGGESTIONS.piece) : SUGGESTIONS.general;
  const empty = !shown.length && !pending;
  const modelLabel = useMemo(() => CLAUDE_MODELS.find((m) => m.id === effectiveModel)?.label ?? effectiveModel, [effectiveModel]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex h-12 shrink-0 items-center gap-1 border-b px-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="min-w-0 shrink justify-start gap-1 font-medium">
              <span className="truncate">{thread?.title ?? 'New chat'}</span>
              <ChevronDown className="text-muted-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuItem onSelect={newChat}>
              <MessageSquarePlus /> New chat
            </DropdownMenuItem>
            {list.length > 0 && <DropdownMenuSeparator />}
            {list.length > 0 && <DropdownMenuLabel className="text-xs text-muted-foreground">Recent</DropdownMenuLabel>}
            {list.slice(0, 20).map((t) => (
              <DropdownMenuItem key={t.id} onSelect={() => selectThread(t.id)} className={cn('group', t.id === threadId && 'bg-accent')}>
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                <span className="text-xs text-muted-foreground group-hover:hidden">{timeAgo(t.updatedAt)}</span>
                <button
                  type="button"
                  aria-label="Delete chat"
                  className="hidden text-muted-foreground hover:text-destructive group-hover:block"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    deleteThread(t.id);
                  }}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" onClick={newChat} aria-label="New chat" title="New chat">
            <MessageSquarePlus />
          </Button>
          {onClose && (
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close Claude">
              <X />
            </Button>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {empty ? (
          <div className="flex h-full flex-col justify-end gap-4 pb-2">
            <div className="space-y-1">
              <p className="text-sm font-medium">{piece ? `Working on “${piece.title}”` : 'How can I help?'}</p>
              <p className="text-sm text-muted-foreground">I can read your board, footage and transcripts, write drafts as new versions, and research online.</p>
            </div>
            <div className="flex flex-col gap-1.5">
              {suggestions.map((s) => (
                <button key={s} type="button" onClick={() => send(s)} className="rounded-lg border px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {shown.map((m) =>
              m.role === 'user' ? (
                <UserBubble key={m.id} text={m.parts.map((p) => (p.type === 'text' ? p.text : '')).join('')} />
              ) : (
                <AssistantParts key={m.id} parts={m.parts} streaming={!pending && messages.data?.thread.running && m.id === shown[shown.length - 1]?.id} />
              ),
            )}
            {pending && pending.threadId === threadId && (
              <>
                <UserBubble text={pending.text} />
                <AssistantParts parts={pending.parts} streaming />
              </>
            )}
          </div>
        )}
      </div>

      <div className="pb-safe shrink-0 border-t p-3">
        {error && (
          <p className="mb-2 rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs text-destructive" role="alert">
            {error}
          </p>
        )}
        <form
          className="rounded-xl border bg-card focus-within:border-ring/60"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          {piece && (
            <div className="flex items-center gap-1.5 px-3 pt-2 text-xs text-muted-foreground">
              <FileText className="size-3" />
              <span className="truncate">{piece.title}</span>
            </div>
          )}
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send(input);
              }
            }}
            placeholder={piece ? 'Ask about this piece…' : 'Ask Claude…'}
            rows={2}
            className="max-h-48 min-h-0 resize-none border-0 bg-transparent px-3 py-2 shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <div className="flex items-center gap-2 px-2 pb-2">
            <Select value={effectiveModel} onValueChange={changeModel}>
              <SelectTrigger size="sm" className="h-7 w-auto gap-1 border-0 bg-transparent px-2 text-xs text-muted-foreground shadow-none dark:bg-transparent" aria-label="Model">
                <SelectValue>{modelLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {CLAUDE_MODELS.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    <span className="flex flex-col">
                      <span>{m.label}</span>
                      <span className="text-xs text-muted-foreground">{m.hint}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="ml-auto flex items-center gap-2">
              {busy ? (
                <Button type="button" size="icon-sm" variant="secondary" onClick={stop} aria-label="Stop">
                  {pending ? <Square className="size-3 fill-current" /> : <Spinner />}
                </Button>
              ) : (
                <Button type="submit" size="icon-sm" disabled={!input.trim()} aria-label="Send">
                  <ArrowUp />
                </Button>
              )}
            </div>
          </div>
        </form>
        <UsageMeter className="mt-1 px-1 lg:hidden" />
      </div>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-secondary px-3.5 py-2 text-sm whitespace-pre-wrap">{text}</div>
    </div>
  );
}
