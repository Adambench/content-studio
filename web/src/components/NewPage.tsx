// A new page: what it is, what I already have (a kit, past posts, samples, links) and how far Claude builds. Claude
// sets it up in the page's own studio, like a video: its questions, a board of slides to leave notes on, Approve.

import { useQueryClient } from '@tanstack/react-query';
import { ArrowUp, Paperclip } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import type { Page, PageMode } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import { Studio, type QueuedFile } from '@/lib/native';
import { keys } from '@/lib/queries';
import { uploadFiles } from '@/lib/uploads';
import { cn } from '@/lib/utils';

const MODES: { id: PageMode; label: string; hint: string }[] = [
  { id: 'mine', label: 'What I give', hint: 'Claude keeps your name, look and voice, and only fills the gaps.' },
  { id: 'mix', label: 'Mix', hint: 'Claude keeps what you give and builds the rest.' },
  { id: 'fresh', label: 'Scratch', hint: 'Claude builds all of it; what you give is only inspiration.' },
];

/** The New page dialog, from anywhere: the sidebar, the box's page menu, Ctrl K. */
export const openNewPage = () => window.dispatchEvent(new Event('cs:new-page'));

export function NewPageDialog() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener('cs:new-page', on);
    return () => window.removeEventListener('cs:new-page', on);
  }, []);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>New page</DialogTitle>
          <DialogDescription>Give what you have. Claude builds the rest with you.</DialogDescription>
        </DialogHeader>
        <NewPageForm onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

export function NewPageForm({ onDone }: { onDone?: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [about, setAbout] = useState('');
  const [mode, setMode] = useState<PageMode>('mix');
  const [files, setFiles] = useState<File[]>([]);
  // On the phone, files go through the background queue (it keeps going with the screen off).
  const [picked, setPicked] = useState<QueuedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const names = [...files.map((f) => f.name), ...picked.map((f) => f.name)];
  const ready = !!(name.trim() || about.trim() || names.length);

  const attach = async () => {
    if (!Studio) return input.current?.click();
    const { files: more } = await Studio.pickFiles({ accept: ['*/*'] });
    setPicked([...picked, ...more]);
  };
  const remove = (k: number) => (k < files.length ? setFiles(files.filter((_, j) => j !== k)) : setPicked(picked.filter((_, j) => j !== k - files.length)));

  const start = async () => {
    if (!ready || busy) return;
    setBusy(true);
    try {
      // Claude starts once every file is in (the server counts them), with what I said and how far to build.
      const page = await api<Page>('/api/pages', { body: { name: name.trim() || undefined, about: about.trim(), mode, files: names.length, go: true } });
      if (files.length) uploadFiles(page.setupId!, files);
      if (picked.length) await Studio?.enqueueFiles({ workspaceId: page.id, pieceId: page.setupId!, source: 'upload', files: picked });
      void qc.invalidateQueries({ queryKey: keys.pages });
      void qc.invalidateQueries({ queryKey: keys.videos });
      onDone?.();
      navigate(`/v/${page.setupId}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="flex flex-col gap-3"
      onDragOver={(e) => e.dataTransfer.types.includes('Files') && e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        setFiles([...files, ...e.dataTransfer.files]);
      }}
    >
      <input value={name} onChange={(e) => setName(e.currentTarget.value)} placeholder="Name, or leave it to Claude" aria-label="The page's name" className="rounded-lg border bg-card px-3 py-2 text-sm outline-none focus:border-foreground/25" />
      <textarea
        value={about}
        onChange={(e) => setAbout(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void start();
        }}
        rows={5}
        placeholder="What's it about, who's it for, how should it feel? Your account, pages you like (links), anything you know."
        aria-label="What the page is"
        className="resize-none rounded-lg border bg-card px-3 py-2 text-sm leading-relaxed outline-none placeholder:text-muted-foreground focus:border-foreground/25"
      />
      <button type="button" onClick={() => void attach()} className="flex items-center justify-center gap-2 rounded-lg border border-dashed px-3 py-3 text-sm text-muted-foreground hover:border-foreground/30 hover:text-foreground">
        <Paperclip className="size-4" /> Logo, kit, fonts, past posts, screenshots, samples
      </button>
      <input ref={input} type="file" multiple hidden onChange={(e) => setFiles([...files, ...(e.currentTarget.files ?? [])])} />
      {names.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {names.map((n, k) => (
            <button key={k} type="button" onClick={() => remove(k)} className="rounded-md border px-2 py-0.5 font-mono text-xs text-muted-foreground hover:line-through" title="Remove">
              {n}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <div className="flex rounded-lg border p-0.5" role="radiogroup" aria-label="Start from">
          {MODES.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} onClick={() => setMode(m.id)} className={cn('flex-1 rounded-md px-2 py-1.5 text-sm', mode === m.id ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground')}>
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{MODES.find((m) => m.id === mode)!.hint}</p>
      </div>
      <Button onClick={() => void start()} disabled={!ready || busy} className="self-end">
        Set it up <ArrowUp />
      </Button>
    </div>
  );
}
