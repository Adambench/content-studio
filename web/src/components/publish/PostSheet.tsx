import { useQuery } from '@tanstack/react-query';
import { Copy, ExternalLink, RotateCcw, Send, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { copyFromDraft, PUBLISH_LIMITS, type PostCopy } from '@shared/publish';
import { PostStats } from '@/components/analytics/PostStats';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { api, errorMessage, mediaThumbUrl } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { keys, queryClient, usePiece } from '@/lib/queries';
import type { Post } from '@/lib/types';
import { cn } from '@/lib/utils';
import { AccountAvatar, accountName, formatWhen, fromInputs, isInbox, platformLabel, StatusIcon, statusText, toInputs } from './common';

const editable = (p: Post) => p.status === 'scheduled' || p.status === 'failed' || p.status === 'missed';

/** One post's details: what happened (or will), and changing, retrying or removing it. */
export function PostSheet({ postId, wid, onClose }: { postId: string | null; wid: string; onClose: () => void }) {
  const isDesktop = useIsDesktop();
  const post = useQuery({ queryKey: keys.post(postId ?? ''), queryFn: () => api<Post>(`/posts/${postId}`), enabled: !!postId, retry: false });
  return (
    <Sheet open={!!postId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side={isDesktop ? 'right' : 'bottom'} className={cn('gap-0 overflow-y-auto p-0', isDesktop ? 'sm:max-w-md' : 'max-h-[90dvh] rounded-t-2xl')}>
        {post.data ? (
          <Details key={post.data.id} post={post.data} wid={wid} onClose={onClose} />
        ) : (
          <SheetHeader>
            <SheetTitle>{post.isError ? 'Post not found' : 'Loading…'}</SheetTitle>
            <SheetDescription>{post.isError ? 'It may have been removed.' : ''}</SheetDescription>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Details({ post, wid, onClose }: { post: Post; wid: string; onClose: () => void }) {
  const piece = usePiece(post.pieceId);
  const [copy, setCopy] = useState<PostCopy>(post.copy);
  const start = toInputs(post.scheduledAt);
  const [date, setDate] = useState(start.date);
  const [time, setTime] = useState(start.time);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => setCopy(post.copy), [post.copy]);
  useEffect(() => {
    const s = toInputs(post.scheduledAt);
    setDate(s.date);
    setTime(s.time);
  }, [post.scheduledAt]);

  const canEdit = editable(post);
  const copyDirty = JSON.stringify(copy) !== JSON.stringify(post.copy);
  const at = fromInputs(date, time);
  const timeDirty = Math.abs(at - post.scheduledAt) >= 60_000;
  const branch = piece.data?.branches.find((b) => b.id === piece.data?.activeBranchId);
  const latest = branch ? copyFromDraft(post.platform, branch.working, post.format) : null;
  const draftMoved = canEdit && latest && JSON.stringify(latest) !== JSON.stringify(post.copy);
  const p = post.platform;
  const titled = p === 'youtube' || (p === 'tiktok' && post.format === 'photo');

  async function act(label: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(label);
    try {
      await fn();
      queryClient.invalidateQueries({ queryKey: ['posts', wid] });
      queryClient.invalidateQueries({ queryKey: keys.post(post.id) });
      queryClient.invalidateQueries({ queryKey: keys.piecePosts(post.pieceId) });
      if (done) toast.success(done);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const save = () =>
    act('save', () => api(`/posts/${post.id}`, { method: 'PATCH', body: { ...(copyDirty && { copy }), ...(timeDirty && { scheduledAt: at }) } }), timeDirty ? `Moved to ${formatWhen(at)}` : 'Saved');

  return (
    <>
      <SheetHeader className="space-y-3 border-b p-4">
        <div className="flex items-center gap-3 pr-8">
          <AccountAvatar account={post.account} platform={p} className="size-9" />
          <div className="min-w-0">
            <SheetTitle className="truncate">{accountName(post.account, post.accountLabel)}</SheetTitle>
            <SheetDescription>{platformLabel(p)}</SheetDescription>
          </div>
        </div>
        <Link to={`/w/${wid}/p/${post.pieceId}`} onClick={onClose} className="flex items-center gap-3 rounded-lg border p-2 hover:bg-accent/40">
          {post.thumbMediaId ? <img src={mediaThumbUrl(post.thumbMediaId)} alt="" className="h-14 w-10 rounded object-cover" /> : <div className="h-14 w-10 rounded bg-muted" />}
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{post.pieceTitle}</p>
            <p className="text-xs text-muted-foreground">
              {post.format === 'photo' ? (post.mediaIds.length > 1 ? `Carousel of ${post.mediaIds.length} photos` : 'Photo') : 'Video'}
            </p>
          </div>
        </Link>
      </SheetHeader>

      <div className="space-y-5 p-4">
        <div className={cn('space-y-1.5 rounded-lg p-3', post.status === 'failed' ? 'bg-destructive/10' : post.status === 'missed' ? 'bg-amber-400/10' : 'bg-muted/50')}>
          <p className="flex items-center gap-2 text-sm font-medium">
            <StatusIcon post={post} className="size-4" />
            {statusText(post)}
            <span className="ml-auto text-xs font-normal text-muted-foreground">
              {post.status === 'published' && post.publishedAt ? timeAgo(post.publishedAt) : formatWhen(post.scheduledAt)}
            </span>
          </p>
          {post.status === 'missed' && <p className="text-sm text-muted-foreground">Its time passed while this computer was off or asleep, so it waited for you. Post it now or pick a new time.</p>}
          {post.error && <p className="text-sm break-words text-destructive">{post.error}</p>}
          {post.stage && <p className="text-sm text-muted-foreground">{post.stage}</p>}
          {post.status === 'publishing' && post.attempts > 1 && <p className="text-xs text-muted-foreground">Attempt {post.attempts} of 5.</p>}
          <div className="flex flex-wrap gap-2 pt-1">
            {post.url && (
              <Button size="sm" variant="outline" asChild>
                <a href={post.url} target="_blank" rel="noreferrer">
                  <ExternalLink /> Open on {platformLabel(p)}
                </a>
              </Button>
            )}
            {isInbox(post) && post.format === 'video' && (
              <Button size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(post.copy.caption).then(() => toast.success('Caption copied — paste it in TikTok'))}>
                <Copy /> Copy caption
              </Button>
            )}
            {post.status === 'publishing' && post.stage.startsWith('Will try again') && (
              <Button size="sm" variant="outline" onClick={() => act('stop', () => api(`/posts/${post.id}/stop`, { body: {} }), 'Stopped')} disabled={!!busy}>
                {busy === 'stop' && <Spinner />} Stop trying
              </Button>
            )}
            {canEdit && post.accountId && (
              <Button size="sm" onClick={() => act('now', () => api(`/posts/${post.id}/publish-now`, { body: {} }), 'Posting now')} disabled={!!busy || copyDirty}>
                {busy === 'now' ? <Spinner /> : post.status === 'failed' ? <RotateCcw /> : <Send />}
                {post.status === 'failed' ? 'Try again' : 'Post now'}
              </Button>
            )}
          </div>
        </div>

        {post.status === 'published' && <PostStats post={post} />}

        {canEdit ? (
          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="sheet-date" className="text-xs">
                  Date
                </Label>
                <Input id="sheet-date" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="h-8 w-40" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sheet-time" className="text-xs">
                  Time
                </Label>
                <Input id="sheet-time" type="time" value={time} onChange={(e) => e.target.value && setTime(e.target.value)} className="h-8 w-32" />
              </div>
            </div>
            {draftMoved && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-brand/30 bg-brand-soft px-3 py-2 text-xs">
                <span className="mr-auto">The piece’s {platformLabel(p)} copy has changed since this was scheduled.</span>
                <Button size="xs" variant="secondary" onClick={() => setCopy(latest!)}>
                  Use the new copy
                </Button>
              </div>
            )}
            {titled && <Field label="Title" value={copy.title} limit={p === 'youtube' ? PUBLISH_LIMITS.youtube.title : PUBLISH_LIMITS.tiktok.photoTitle} onChange={(v) => setCopy({ ...copy, title: v })} single />}
            <Field label={titled ? 'Description' : 'Caption'} value={copy.caption} onChange={(v) => setCopy({ ...copy, caption: v })} />
            {p === 'youtube' && <Field label="Tags" value={copy.tags} onChange={(v) => setCopy({ ...copy, tags: v })} single />}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={save} disabled={!!busy || (!copyDirty && !timeDirty) || at < Date.now() - 60_000}>
                {busy === 'save' && <Spinner />} {post.status === 'scheduled' || !timeDirty ? 'Save changes' : 'Reschedule'}
              </Button>
              {(copyDirty || timeDirty) && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setCopy(post.copy);
                    setDate(start.date);
                    setTime(start.time);
                  }}
                >
                  Undo
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            {titled && <p className="text-sm font-medium">{post.copy.title}</p>}
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">{post.copy.caption || <span className="italic">No caption</span>}</p>
          </div>
        )}

        {post.status !== 'publishing' && (
          <div className="border-t pt-4">
            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setConfirm(true)}>
              <Trash2 /> {post.status === 'published' ? 'Remove from the calendar' : 'Unschedule'}
            </Button>
          </div>
        )}
      </div>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{post.status === 'published' ? 'Remove it from the calendar?' : 'Unschedule this post?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {post.status === 'published' ? `It stays on ${platformLabel(p)} — this only removes it (and its stats) from Content Studio.` : `It won’t go out to ${accountName(post.account, post.accountLabel)}. The piece and its other posts aren’t affected.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                act('delete', async () => {
                  await api(`/posts/${post.id}`, { method: 'DELETE' });
                  onClose();
                })
              }
            >
              {post.status === 'published' ? 'Remove' : 'Unschedule'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Field({ label, value, onChange, single, limit }: { label: string; value: string; onChange: (v: string) => void; single?: boolean; limit?: number }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        {limit && <span className={cn('text-xs text-muted-foreground tabular-nums', value.length > limit && 'text-destructive')}>{value.length}/{limit}</span>}
      </div>
      {single ? <Input value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} /> : <Textarea value={value} onChange={(e) => onChange(e.target.value)} rows={4} aria-label={label} />}
    </div>
  );
}
