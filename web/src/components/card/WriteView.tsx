import { Paperclip } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { COLUMN_LABELS, COLUMN_STAGE, WRITING_COLUMNS, type BoardColumn, type WritingColumn } from '@shared/board';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { api, errorMessage, uploadFiles } from '@/lib/api';
import { duration } from '@/lib/format';
import { isApp, pickAndUpload } from '@/lib/native';
import { keys, queryClient } from '@/lib/queries';
import type { PieceDetail } from '@/lib/types';
import { cn } from '@/lib/utils';
import { renameCard, useDraft } from './useDraft';

/** A textarea that grows with its text, so the document reads as one page. */
function Grow({ value, onChange, placeholder, className }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      spellCheck
      className={cn('w-full resize-none overflow-hidden bg-transparent outline-none placeholder:text-muted-foreground/60', className)}
    />
  );
}

/** One of the two headings: I can rename them, they stay "Script" and "Notes" by default. */
function Heading({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Heading"
      className="w-full bg-transparent text-[13px] font-semibold tracking-widest text-muted-foreground uppercase outline-none"
    />
  );
}

type Help = { kind: 'hooks' | 'directions'; items: string[] | null };

/** Hooks and Directions: Claude's answers beside the document; a click takes one, with Undo. */
function useHelp(pieceId: string) {
  const [help, setHelp] = useState<Help | null>(null);
  async function ask(kind: Help['kind']) {
    setHelp({ kind, items: null });
    try {
      const res = await api<{ hooks?: string[]; directions?: string[] }>(`/pieces/${pieceId}/${kind === 'hooks' ? 'hooks' : 'script-directions'}`, { method: 'POST' });
      setHelp({ kind, items: (kind === 'hooks' ? res.hooks : res.directions) ?? [] });
    } catch (err) {
      setHelp(null);
      toast.error(errorMessage(err));
    }
  }
  return { help, ask, close: () => setHelp(null) };
}

function HelpList({ help, onTake }: { help: Help; onTake: (s: string) => void }) {
  if (!help.items)
    return (
      <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
        <Spinner /> Thinking…
      </div>
    );
  return (
    <div className="flex flex-col gap-2">
      {help.items.map((s) => (
        <button key={s} type="button" onClick={() => onTake(s)} className="rounded-lg border bg-card px-3.5 py-3 text-left text-[15px] leading-snug hover:bg-muted/60">
          {s}
        </button>
      ))}
    </div>
  );
}

const FOOTAGE = new Set(['upload', 'share', 'capture']);

/**
 * A card I'm writing: its title, where it is, one document (Script, then Notes under it), Hooks and Directions beside
 * it, and the footage I sent for it.
 */
export function WriteView({ piece, column, series, phone = false }: { piece: PieceDetail; column: BoardColumn; series: { name: string; episode: number } | null; phone?: boolean }) {
  const { draft, change, ready } = useDraft(piece);
  const [title, setTitle] = useState(piece.title);
  const { help, ask, close } = useHelp(piece.id);
  const [uploading, setUploading] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => setTitle(piece.title), [piece.title]);

  const labels = draft.labels ?? { script: 'Script', notes: 'Notes' };
  const footage = piece.media.filter((m) => FOOTAGE.has(m.source));

  function takeHook(hook: string) {
    const before = draft.script;
    const lines = before.split('\n');
    const first = lines.findIndex((l) => l.trim());
    if (first < 0) lines.unshift(hook);
    else lines[first] = hook;
    change({ ...draft, script: lines.join('\n') });
    toast('Hook swapped', { action: { label: 'Undo', onClick: () => change((d) => ({ ...d, script: before })) } });
    close();
  }

  function takeDirection(direction: string) {
    const before = draft.notes;
    change({ ...draft, notes: before.trim() ? `${before.replace(/\s+$/, '')}\n${direction}` : direction });
    toast('Added under Notes', { action: { label: 'Undo', onClick: () => change((d) => ({ ...d, notes: before })) } });
    close();
  }

  async function moveTo(c: WritingColumn) {
    try {
      await api(`/pieces/${piece.id}`, { method: 'PATCH', body: { stage: COLUMN_STAGE[c] } });
      void queryClient.invalidateQueries({ queryKey: keys.boardAll });
      void queryClient.invalidateQueries({ queryKey: keys.piece(piece.id) });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function addFootage(files: File[]) {
    if (!files.length) return;
    setUploading(true);
    try {
      await uploadFiles(`/workspaces/${piece.workspaceId}/media?pieceId=${piece.id}`, files);
      void queryClient.invalidateQueries({ queryKey: keys.piece(piece.id) });
      void queryClient.invalidateQueries({ queryKey: keys.boardAll });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  async function pickOnPhone() {
    try {
      const n = await pickAndUpload({ workspaceId: piece.workspaceId, pieceId: piece.id }, ['video/*', 'audio/*']);
      if (n) toast.success(`${n} clip${n === 1 ? '' : 's'} uploading`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const helpButtons = (
    <>
      <Button variant="outline" className="h-10 px-4 text-[15px]" disabled={!draft.script.trim() || help?.items === null} onClick={() => ask('hooks')}>
        Hooks
      </Button>
      <Button variant="outline" className="h-10 px-4 text-[15px]" disabled={help?.items === null} onClick={() => ask('directions')}>
        Directions
      </Button>
    </>
  );

  const doc = (
    <div className="space-y-2">
      <Heading value={labels.script} onChange={(v) => change({ ...draft, labels: { ...labels, script: v } })} />
      <Grow value={draft.script} onChange={(v) => change({ ...draft, script: v })} placeholder="What you say" className={cn('leading-relaxed', phone ? 'text-[17px]' : 'text-lg')} />
      <div className="pt-6">
        <Heading value={labels.notes} onChange={(v) => change({ ...draft, labels: { ...labels, notes: v } })} />
      </div>
      <Grow value={draft.notes} onChange={(v) => change({ ...draft, notes: v })} placeholder="The effects you want" className={cn('leading-relaxed', phone ? 'text-[17px]' : 'text-lg')} />
    </div>
  );

  const footageList = (
    <section className="space-y-3 border-t pt-5">
      <div className="flex items-center gap-3">
        <h2 className="text-[13px] font-semibold tracking-widest text-muted-foreground uppercase">Footage</h2>
        {isApp ? (
          <Button variant="ghost" size="sm" onClick={pickOnPhone}>
            <Paperclip /> Add
          </Button>
        ) : (
          <>
            <Button variant="ghost" size="sm" disabled={uploading} onClick={() => file.current?.click()}>
              {uploading ? <Spinner /> : <Paperclip />} Add
            </Button>
            <input
              ref={file}
              type="file"
              accept="video/*,audio/*"
              multiple
              hidden
              onChange={(e) => {
                void addFootage([...(e.target.files ?? [])]);
                e.target.value = '';
              }}
            />
          </>
        )}
      </div>
      {footage.length ? (
        <ul className="flex flex-wrap gap-2">
          {footage.map((m) => (
            <li key={m.id} className="rounded-md bg-muted px-3 py-1.5 text-sm text-muted-foreground">
              {m.originalName}
              {m.durationMs ? <span className="ml-2 tabular-nums">{duration(m.durationMs)}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[15px] text-muted-foreground">None yet</p>
      )}
    </section>
  );

  const header = (
    <>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => title.trim() !== piece.title && void renameCard(piece.id, title)}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        aria-label="Title"
        className={cn('w-full bg-transparent font-semibold tracking-tight outline-none', phone ? 'text-2xl' : 'text-3xl')}
      />
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={column}
          onChange={(e) => void moveTo(e.target.value as WritingColumn)}
          aria-label="Column"
          className="h-9 rounded-lg border bg-card px-2.5 text-sm"
        >
          {WRITING_COLUMNS.map((c) => (
            <option key={c} value={c}>
              {COLUMN_LABELS[c]}
            </option>
          ))}
        </select>
        {series && (
          <span className="text-sm text-muted-foreground">
            {series.name} · Ep {series.episode}
          </span>
        )}
      </div>
    </>
  );

  if (!ready) return <p className="p-8 text-muted-foreground">This card has no draft.</p>;

  if (phone)
    return (
      <div className="flex h-full flex-col">
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pt-2 pb-8">
          <div className="space-y-3">{header}</div>
          {doc}
          {footageList}
        </div>
        <div className="pb-safe flex gap-2 border-t bg-sidebar px-4 pt-2.5">
          <div className="flex w-full gap-2 pb-2.5 [&>button]:flex-1">{helpButtons}</div>
        </div>
        <Sheet open={!!help} onOpenChange={(o) => !o && close()}>
          <SheetContent side="bottom" className="pb-safe max-h-[80dvh] gap-0">
            <SheetHeader>
              <SheetTitle>{help?.kind === 'hooks' ? 'Hooks' : 'Directions'}</SheetTitle>
            </SheetHeader>
            <div className="overflow-y-auto px-4 pb-4">{help && <HelpList help={help} onTake={help.kind === 'hooks' ? takeHook : takeDirection} />}</div>
          </SheetContent>
        </Sheet>
      </div>
    );

  return (
    <div className="grid grid-cols-[minmax(0,48rem)_22rem] gap-14 px-12 pt-5 pb-20">
      <div className="space-y-8">
        <div className="space-y-4">{header}</div>
        {doc}
        {footageList}
      </div>
      <aside className="space-y-4 pt-24">
        <div className="flex gap-2">{helpButtons}</div>
        {help && <HelpList help={help} onTake={help.kind === 'hooks' ? takeHook : takeDirection} />}
      </aside>
    </div>
  );
}
