import { Check, CircleAlert, CloudOff, Fingerprint, RefreshCw, RotateCw, Upload, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { errorMessage } from '@/lib/api';
import { bytes } from '@/lib/format';
import { checkServer, compatibility, locked, Studio, uploads, type UploadItem } from '@/lib/native';
import { queryClient, useBoardData, useWorkspaces } from '@/lib/queries';
import { serverReachable, useStore } from '@/lib/ui-state';
import { cn } from '@/lib/utils';

// Pieces of the Android app's UI around the pages: connection and version banners, the uploads sheet, the lock.

/** "Can't reach your computer" and "update the app / Content Studio" — under the header. */
export function AppBanners() {
  const reachable = useStore(serverReachable);
  const compat = useStore(compatibility);
  const [checking, setChecking] = useState(false);

  async function retry() {
    setChecking(true);
    const health = await checkServer();
    setChecking(false);
    if (health) queryClient.invalidateQueries();
  }

  // While it's unreachable, look again every 15 seconds.
  useEffect(() => {
    if (reachable) return;
    const timer = setInterval(() => void retry(), 15_000);
    return () => clearInterval(timer);
  }, [reachable]);

  if (!reachable)
    return (
      <div className="flex items-center gap-2 border-b bg-muted/60 px-3 py-2 text-xs" role="status">
        <CloudOff className="size-4 shrink-0 text-muted-foreground" />
        <span className="mr-auto">Can’t reach your computer. What you write and send waits on this phone and goes when it’s back.</span>
        <Button size="sm" variant="ghost" className="h-7 shrink-0" onClick={retry} disabled={checking}>
          {checking ? <Spinner /> : <RefreshCw />} Retry
        </Button>
      </div>
    );
  if (compat.state !== 'ok')
    return (
      <div className="flex items-start gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs" role="status">
        <CircleAlert className="mt-px size-4 shrink-0 text-amber-400" />
        <span>
          {compat.state === 'app-old'
            ? 'This app is older than Content Studio on your computer, so some things may not work. Update it in Obtainium.'
            : `Content Studio on your computer (${compat.server?.version}) is older than this app (${__APP_VERSION__}). Update it there.`}
        </span>
      </div>
    );
  return null;
}

/** The background uploads (and queued captures) on this phone: a header button while there are any, and its sheet. */
export function UploadsButton({ className }: { className?: string }) {
  const items = useStore(uploads);
  const [open, setOpen] = useState(false);
  const active = items.filter((u) => u.state === 'waiting' || u.state === 'uploading');
  const failed = items.some((u) => u.state === 'failed');
  if (!items.length) return null;
  const total = active.reduce((n, u) => n + u.size, 0);
  const sent = active.reduce((n, u) => n + u.sent, 0);
  const pct = total ? Math.round((sent / total) * 100) : 0;
  return (
    <>
      <Button variant="ghost" size="icon" className={cn('relative', className)} onClick={() => setOpen(true)} aria-label={active.length ? `Uploading, ${pct}%` : 'Uploads'}>
        {failed ? <CircleAlert className="text-destructive" /> : <Upload className={cn(!active.length && 'text-muted-foreground')} />}
        {active.length > 0 && (
          <svg viewBox="0 0 36 36" className="absolute inset-1 -rotate-90" aria-hidden>
            <circle cx="18" cy="18" r="16" fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="2.5" />
            <circle cx="18" cy="18" r="16" fill="none" stroke="var(--brand)" strokeWidth="2.5" strokeDasharray={`${(pct / 100) * 100.5} 100.5`} strokeLinecap="round" />
          </svg>
        )}
      </Button>
      <UploadsSheet open={open} onOpenChange={setOpen} items={items} />
    </>
  );
}

function UploadsSheet({ open, onOpenChange, items }: { open: boolean; onOpenChange: (o: boolean) => void; items: UploadItem[] }) {
  const { data: workspaces = [] } = useWorkspaces();
  const board = useBoardData();
  const name = (u: UploadItem) => board.data?.items.find((i) => i.id === u.pieceId)?.title ?? workspaces.find((w) => w.id === u.workspaceId)?.name;
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[80dvh] gap-0 pb-safe">
        <SheetHeader>
          <SheetTitle>Uploads</SheetTitle>
          <SheetDescription>They carry on in the background, and wait for a connection to your computer.</SheetDescription>
        </SheetHeader>
        <ul className="min-h-0 flex-1 divide-y overflow-y-auto px-4">
          {items.map((u) => (
            <UploadRow key={u.id} u={u} sentTo={name(u)} />
          ))}
        </ul>
        {items.some((u) => u.state === 'done') && (
          <div className="border-t p-3">
            <Button variant="ghost" size="sm" onClick={act(() => Studio.clearFinished())}>
              Clear finished
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Covers the app until a fingerprint (or the screen lock) unlocks it, when the lock is on (Settings → This phone). */
export function LockScreen() {
  const isLocked = useStore(locked);
  const [error, setError] = useState('');

  async function unlock() {
    setError('');
    try {
      const { ok } = await Studio.unlock({ title: 'Unlock Content Studio' });
      if (ok) locked.set(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  useEffect(() => {
    if (isLocked) void unlock();
  }, [isLocked]);

  if (!isLocked) return null;
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-background px-6">
      <div className="space-y-4 text-center">
        <img src="/icon.svg" alt="" className="mx-auto size-14" />
        <p className="text-sm text-muted-foreground">Content Studio is locked.</p>
        <Button onClick={unlock}>
          <Fingerprint /> Unlock
        </Button>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}

const act = (fn: () => Promise<void>) => () => void fn().catch((err) => console.warn(errorMessage(err)));

/** One upload: its name, where it's at (with a bar while sending), retry and cancel. */
function UploadRow({ u, sentTo }: { u: UploadItem; sentTo?: string }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{u.kind === 'text' ? `Idea: ${u.name}` : u.kind === 'saved' ? `Saved: ${u.name}` : u.name}</p>
        <p className={cn('truncate text-xs text-muted-foreground', u.state === 'failed' && 'text-destructive')}>
          {u.state === 'failed'
            ? u.error
            : u.state === 'done'
              ? `Sent${sentTo ? ` to ${sentTo}` : ''}`
              : u.state === 'uploading' && u.kind === 'file'
                ? `${bytes(u.sent)} of ${bytes(u.size)}`
                : 'Waiting for your computer'}
        </p>
        {u.state === 'uploading' && u.size > 0 && (
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-brand transition-[width]" style={{ width: `${(u.sent / u.size) * 100}%` }} />
          </div>
        )}
      </div>
      {u.state === 'done' && <Check className="size-4 text-muted-foreground" />}
      {u.state === 'failed' && (
        <Button size="icon-sm" variant="ghost" aria-label="Try again" onClick={act(() => Studio.retryUpload({ id: u.id }))}>
          <RotateCw />
        </Button>
      )}
      {u.state !== 'uploading' && (
        <Button size="icon-sm" variant="ghost" aria-label={u.state === 'done' ? 'Remove from list' : 'Cancel'} onClick={act(() => Studio.removeUpload({ id: u.id }))}>
          <X />
        </Button>
      )}
    </li>
  );
}

/** This phone's uploads into one video. */
export function usePieceUploads(pieceId: string) {
  return useStore(uploads).filter((u) => u.pieceId === pieceId);
}

/** Where a video's uploads are at, in a word: null when none are sending or stuck. */
export function uploadSummary(items: UploadItem[]): { text: string; failed: boolean; fraction: number } | null {
  const failed = items.filter((u) => u.state === 'failed').length;
  const active = items.filter((u) => u.state === 'waiting' || u.state === 'uploading');
  if (failed) return { text: `${failed} not sent`, failed: true, fraction: 0 };
  if (!active.length) return null;
  const size = active.reduce((n, u) => n + u.size, 0);
  const sent = active.reduce((n, u) => n + u.sent, 0);
  const fraction = size ? sent / size : 0;
  if (!active.some((u) => u.state === 'uploading')) return { text: 'Waiting', failed: false, fraction };
  return { text: `Sending ${Math.round(fraction * 100)}%`, failed: false, fraction };
}

/** The clips this phone is still sending to a video (or couldn't), live, under its Footage. */
export function PieceUploads({ items }: { items: UploadItem[] }) {
  if (!items.length) return null;
  return (
    <ul className="divide-y">
      {items.map((u) => (
        <UploadRow key={u.id} u={u} />
      ))}
    </ul>
  );
}
