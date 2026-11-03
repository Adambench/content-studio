import { ArrowLeft, NotebookPen, Plus, Search, Sparkles, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { noteSnippet, noteTitle, wordCount, type NotebookNote } from '@shared/notebook';
import { useWorkspaceContext } from '@/components/WorkspaceLayout';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { api, errorMessage } from '@/lib/api';
import { shortAgo, timeAgo } from '@/lib/format';
import { keys, queryClient, useNotebook } from '@/lib/queries';
import { openClaude } from '@/lib/ui-state';
import { cn } from '@/lib/utils';

type Status = 'saved' | 'saving' | 'error';

/** Put a saved note at the top of the page's list, the way the server orders it (last written first). */
function keep(wid: string, note: NotebookNote) {
  queryClient.setQueryData<NotebookNote[]>(keys.notebook(wid), (old) => [note, ...(old ?? []).filter((n) => n.id !== note.id)]);
}

/**
 * One note: a page of plain text that saves itself as it's typed (and when you leave it). A new note is only kept
 * once something's written in it; one emptied out goes when you leave it.
 */
function NoteEditor({ wid, id, note, autoFocus, onBack, onGone }: { wid: string; id: string; note: NotebookNote | undefined; autoFocus: boolean; onBack?: () => void; onGone: () => void }) {
  const [text, setText] = useState(note?.body ?? '');
  const [status, setStatus] = useState<Status>('saved');
  const textRef = useRef(text);
  const lastSaved = useRef(text);
  const exists = useRef(!!note);
  const gone = useRef(false);
  const inflight = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    while (inflight.current) await inflight.current;
    const body = textRef.current;
    if (gone.current || body === lastSaved.current || (!exists.current && !body.trim())) {
      if (!gone.current && textRef.current === lastSaved.current) setStatus('saved');
      return;
    }
    setStatus('saving');
    const p = api<NotebookNote>(`/workspaces/${wid}/notebook/${id}`, { method: 'PUT', body: { body } })
      .then((saved) => {
        lastSaved.current = body;
        exists.current = true;
        keep(wid, saved);
        setStatus(textRef.current === body ? 'saved' : 'saving');
      })
      .catch(() => setStatus('error'))
      .finally(() => {
        inflight.current = null;
      });
    inflight.current = p;
    await p;
  }, [wid, id]);

  // Saved when you leave it: another note, another page, the window hidden or closed.
  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && void flush();
    const onUnload = () => void flush();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', onUnload);
      if (gone.current) return;
      if (exists.current && !textRef.current.trim()) {
        gone.current = true;
        void api(`/notebook/${id}`, { method: 'DELETE' })
          .catch(() => {})
          .finally(() => void queryClient.invalidateQueries({ queryKey: keys.notebook(wid) }));
      } else void flush();
    };
  }, [flush, id, wid]);

  // Written on another device meanwhile: shown here, unless there's typing here it hasn't saved yet.
  const serverBody = note?.body;
  useEffect(() => {
    if (serverBody === undefined || serverBody === lastSaved.current || textRef.current !== lastSaved.current) return;
    lastSaved.current = serverBody;
    textRef.current = serverBody;
    exists.current = true;
    setText(serverBody);
  }, [serverBody]);

  const change = (v: string) => {
    setText(v);
    textRef.current = v;
    setStatus('saving');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 700);
  };

  const remove = async () => {
    await flush();
    gone.current = true;
    if (!exists.current) return onGone();
    try {
      await api(`/notebook/${id}`, { method: 'DELETE' });
    } catch (err) {
      gone.current = false;
      return void toast.error(errorMessage(err));
    }
    queryClient.setQueryData<NotebookNote[]>(keys.notebook(wid), (old) => old?.filter((n) => n.id !== id));
    onGone();
    toast('Note deleted', {
      action: {
        label: 'Undo',
        onClick: () =>
          void api<NotebookNote>(`/notebook/${id}/restore`, { method: 'POST' })
            .then((n) => keep(wid, n))
            .catch((err) => toast.error(errorMessage(err))),
      },
    });
  };

  const title = noteTitle(text);
  const words = wordCount(text);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-1 border-b px-2 md:px-4">
        {onBack && (
          <Button variant="ghost" size="icon-sm" onClick={onBack} aria-label="All notes">
            <ArrowLeft />
          </Button>
        )}
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" aria-live="polite">
          {status === 'error' ? (
            <button type="button" onClick={() => void flush()} className="text-destructive hover:underline">
              Not saved · try again
            </button>
          ) : status === 'saving' ? (
            'Saving…'
          ) : exists.current && note ? (
            `Saved · ${timeAgo(note.updatedAt)}`
          ) : (
            ''
          )}
          {words > 0 && <span className="ml-2 tabular-nums">{words === 1 ? '1 word' : `${words.toLocaleString()} words`}</span>}
        </span>
        <Button variant="ghost" size="sm" disabled={!title} onClick={() => void flush().then(() => openClaude(`About my note “${title}”: `))}>
          <Sparkles className="text-brand" /> <span className="hidden sm:inline">Ask Claude</span>
        </Button>
        <Button variant="ghost" size="icon-sm" disabled={!text.trim() && !exists.current} onClick={() => void remove()} aria-label="Delete this note">
          <Trash2 />
        </Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto" onClick={(e) => e.target === e.currentTarget && e.currentTarget.querySelector('textarea')?.focus()}>
        <textarea
          value={text}
          onChange={(e) => change(e.target.value)}
          onBlur={() => void flush()}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
              e.preventDefault();
              void flush();
            }
          }}
          autoFocus={autoFocus}
          spellCheck
          placeholder="Write anything. The first line is the title."
          aria-label={title || 'New note'}
          className="mx-auto block field-sizing-content min-h-[70vh] w-full max-w-2xl resize-none bg-transparent px-5 py-6 text-base leading-7 outline-none placeholder:text-muted-foreground/70 md:px-8 md:py-10 md:text-[15px]"
        />
      </div>
    </div>
  );
}

function NoteList({ notes, openId, draft, query, onQuery, onOpen, onNew }: { notes: NotebookNote[]; openId: string | null; draft: boolean; query: string; onQuery: (q: string) => void; onOpen: (id: string) => void; onNew: () => void }) {
  const q = query.trim().toLowerCase();
  const shown = q ? notes.filter((n) => n.body.toLowerCase().includes(q)) : notes;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <h1 className="flex-1 text-sm font-semibold">Notes</h1>
        <Button size="sm" onClick={onNew}>
          <Plus /> New
        </Button>
      </header>
      {notes.length > 3 && (
        <div className="relative border-b px-3 py-2">
          <Search className="pointer-events-none absolute top-1/2 left-5.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && onQuery('')}
            placeholder="Find in notes"
            aria-label="Find in notes"
            className="h-8 w-full rounded-lg border bg-transparent pr-2 pl-8 text-sm outline-none focus-visible:border-ring"
          />
        </div>
      )}
      <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {draft && (
          <li>
            <div className="rounded-md bg-accent px-2.5 py-2 text-sm text-muted-foreground">New note</div>
          </li>
        )}
        {shown.map((n) => (
          <li key={n.id}>
            <button type="button" onClick={() => onOpen(n.id)} className={cn('w-full rounded-md px-2.5 py-2 text-left hover:bg-accent/60', n.id === openId && 'bg-accent hover:bg-accent')} aria-current={n.id === openId || undefined}>
              <span className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{noteTitle(n.body) || 'Untitled'}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">{shortAgo(n.updatedAt)}</span>
              </span>
              <span className="line-clamp-2 text-xs text-muted-foreground">{noteSnippet(n.body) || ' '}</span>
            </button>
          </li>
        ))}
        {!notes.length && !draft && <li className="px-3 py-8 text-center text-sm text-muted-foreground">Nothing written yet.</li>}
        {!!notes.length && q && !shown.length && <li className="px-3 py-8 text-center text-sm text-muted-foreground">No note has “{query.trim()}”.</li>}
      </ul>
    </div>
  );
}

/**
 * Notes: free writing for the page, no cards and no structure (Ideas is the canvas). A list of notes beside the one
 * being written (on a phone, the list, then the note), each saved as it's typed. Claude reads them when asked
 * (get_notebook), never changes them.
 */
export function NotesPage() {
  const { workspace } = useWorkspaceContext();
  const wid = workspace.id;
  const notebook = useNotebook(wid);
  const wide = useMediaQuery('(min-width: 768px)');
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  // Notes started here this visit, so a new one opens with the cursor in it.
  const fresh = useRef(new Set<string>());
  const notes = useMemo(() => (notebook.data ?? []).filter((n) => n.body.trim() || n.id === params.get('n')), [notebook.data, params]);
  const openId = params.get('n');
  const open = openId ? notes.find((n) => n.id === openId) : undefined;

  const show = useCallback(
    (id: string | null, push = true) =>
      setParams(
        (p) => {
          const q = new URLSearchParams(p);
          if (id) q.set('n', id);
          else q.delete('n');
          return q;
        },
        { replace: !push },
      ),
    [setParams],
  );
  const newNote = useCallback(
    (push = true) => {
      const id = crypto.randomUUID();
      fresh.current.add(id);
      show(id, push);
    },
    [show],
  );

  // Something to write in straight away: on a computer the last note written (or a new one); on a phone with no
  // notes, a new one.
  useEffect(() => {
    if (openId || !notebook.data) return;
    if (wide) {
      const last = notebook.data.find((n) => n.body.trim());
      if (last) show(last.id, false);
      else newNote(false);
    } else if (!notebook.data.some((n) => n.body.trim())) newNote(false);
  }, [openId, notebook.data, wide, show, newNote]);

  if (notebook.isLoading) {
    return (
      <div className="grid h-full place-items-center">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    );
  }
  if (notebook.isError) return <p className="p-6 text-sm text-muted-foreground">Couldn’t load the notes: {errorMessage(notebook.error)}</p>;

  const editor = openId ? (
    <NoteEditor
      key={openId}
      wid={wid}
      id={openId}
      note={open}
      autoFocus={fresh.current.has(openId) || !open?.body.trim()}
      onBack={wide ? undefined : () => show(null)}
      onGone={() => {
        if (!wide) return show(null);
        const next = notes.find((n) => n.id !== openId && n.body.trim());
        if (next) show(next.id, false);
        else newNote(false);
      }}
    />
  ) : null;
  const list = <NoteList notes={notes} openId={openId} draft={!!openId && !open} query={query} onQuery={setQuery} onOpen={(id) => show(id, !wide)} onNew={() => newNote(!wide)} />;

  if (!wide) return <div className="h-full min-h-0">{editor ?? list}</div>;
  return (
    <div className="flex h-full min-h-0">
      <aside className="w-64 shrink-0 border-r lg:w-72" aria-label="Your notes">
        {list}
      </aside>
      <div className="min-w-0 flex-1">
        {editor ?? (
          <div className="grid h-full place-items-center text-muted-foreground">
            <NotebookPen className="size-6" />
          </div>
        )}
      </div>
    </div>
  );
}
