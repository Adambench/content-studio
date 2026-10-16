import { AlertTriangle, BadgeDollarSign, Check, ChevronLeft, ChevronRight, Clapperboard, ExternalLink, Loader2, Pencil, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { MOMENT_KIND_LABELS, REJECT_REASONS, clock, type ReviewClip, type RuleResult } from '@shared/clipping';
import { PUBLISH_PLATFORM_LABELS, TIKTOK_PRIVACY_LABELS, type PublishPlatform, type TikTokPrivacy } from '@shared/publish';
import { RULE_KIND_LABELS } from '@shared/campaigns';
import { PageHeader } from '@/components/PageHeader';
import { PlatformIcon, formatWhen } from '@/components/publish/common';
import { WorkspaceDot } from '@/components/WorkspaceDot';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { api, errorMessage, mediaFileUrl, mediaThumbUrl } from '@/lib/api';
import { keys, queryClient, useReview } from '@/lib/queries';
import { cn } from '@/lib/utils';

function Note({ children, tone = 'amber' }: { children: React.ReactNode; tone?: 'amber' | 'red' }) {
  return (
    <div className={cn('flex items-start gap-2 rounded-lg border px-3 py-2 text-sm', tone === 'amber' ? 'border-amber-400/30 bg-amber-400/5' : 'border-destructive/40 bg-destructive/5')}>
      <AlertTriangle className={cn('mt-0.5 size-4 shrink-0', tone === 'amber' ? 'text-amber-400' : 'text-destructive')} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Player({ clip }: { clip: ReviewClip }) {
  if (clip.render)
    return (
      <video
        key={clip.render.mediaId}
        src={mediaFileUrl(clip.render.mediaId)}
        poster={clip.render.hasThumb ? mediaThumbUrl(clip.render.mediaId) : undefined}
        controls
        playsInline
        preload="metadata"
        className="size-full bg-black object-contain"
      />
    );
  const r = clip.rendering;
  return (
    <div className="grid size-full place-items-center bg-muted p-6 text-center text-sm text-muted-foreground">
      {r?.status === 'error' ? (
        <div className="space-y-2">
          <p className="text-destructive">The render failed.</p>
          {r.error && <p className="line-clamp-4 text-xs">{r.error}</p>}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <Loader2 className="size-5 animate-spin text-brand" />
          <p>{r ? `${r.stage} · ${Math.round(r.progress * 100)}%` : 'Waiting for its render'}</p>
        </div>
      )}
    </div>
  );
}

function RuleRow({ result, ticked, onTick }: { result: RuleResult; ticked: boolean; onTick: (on: boolean) => void }) {
  const id = `rule-${result.rule.text}`;
  return (
    <li className="flex items-start gap-2.5 py-1.5 text-sm">
      {result.status === 'manual' ? (
        <Checkbox id={id} checked={ticked} onCheckedChange={(v) => onTick(v === true)} className="mt-0.5" />
      ) : result.status === 'pass' ? (
        <Check className="mt-0.5 size-4 shrink-0 text-emerald-400" aria-label="Passes" />
      ) : (
        <X className="mt-0.5 size-4 shrink-0 text-destructive" aria-label="Fails" />
      )}
      <label htmlFor={result.status === 'manual' ? id : undefined} className="min-w-0 flex-1">
        <span className="mr-1.5 text-xs text-muted-foreground">{RULE_KIND_LABELS[result.rule.kind]}</span>
        {result.rule.text}
        {result.detail && <span className={cn('block text-xs', result.status === 'fail' ? 'text-destructive' : 'text-muted-foreground')}>{result.detail}</span>}
      </label>
    </li>
  );
}

function CopyBlock({ platform, text }: { platform: PublishPlatform; text: string }) {
  return (
    <div className="space-y-1">
      <p className="flex items-center gap-1.5 text-xs font-medium">
        <PlatformIcon platform={platform} className="size-3.5" /> {PUBLISH_PLATFORM_LABELS[platform]}
      </p>
      <p className="rounded-md bg-muted/50 px-2.5 py-2 text-xs whitespace-pre-wrap text-muted-foreground">{text.trim() || 'Empty'}</p>
    </div>
  );
}

function RejectDialog({ clip, open, onOpenChange, onDone }: { clip: ReviewClip; open: boolean; onOpenChange: (open: boolean) => void; onDone: () => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  async function reject() {
    setBusy(true);
    try {
      await api(`/review/${clip.pieceId}/reject`, { body: { reason } });
      toast(clip.moment ? 'Rejected: the next picks will avoid it' : 'Sent back a column');
      onOpenChange(false);
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Why not this one?</DialogTitle>
          <DialogDescription>{clip.moment ? 'The clip and its files go. The reason is kept, and Claude reads it the next time it picks moments.' : 'It goes back to the column before Review.'}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-1.5">
          {REJECT_REASONS.map((r) => (
            <Button key={r} type="button" size="sm" variant={reason === r ? 'secondary' : 'outline'} className="h-7 text-xs" onClick={() => setReason(r)}>
              {r}
            </Button>
          ))}
        </div>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Or say it in your words" rows={3} aria-label="Reason" />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Keep it
          </Button>
          <Button variant="destructive" disabled={busy || !reason.trim()} onClick={reject}>
            {busy && <Spinner />} Reject
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ClipDetails({ clip, onDone }: { clip: ReviewClip; onDone: () => void }) {
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [privacy, setPrivacy] = useState<TikTokPrivacy | ''>('');
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  useEffect(() => {
    setTicked(new Set());
    setPrivacy('');
  }, [clip.pieceId]);

  const m = clip.moment;
  const manual = clip.rules.filter((r) => r.status === 'manual');
  const failing = clip.rules.filter((r) => r.status === 'fail');
  const unticked = manual.filter((r) => !ticked.has(r.rule.text)).length;
  const directTikTok = clip.accounts.some((a) => a.platform === 'tiktok' && a.tiktokMode === 'direct' && !a.reconnect);
  const platforms = Object.keys(clip.copy) as PublishPlatform[];
  const canApprove = !!clip.render && !failing.length && !unticked && (!directTikTok || !!privacy) && !busy;
  const at = m ? `${clock(m.start)}–${clock(m.end)}` : null;
  const sourceLink = m && clip.source?.link ? (/youtube\.com\/watch/.test(clip.source.link) ? `${clip.source.link}&t=${Math.floor(m.start)}s` : clip.source.link) : null;

  async function approve() {
    setBusy(true);
    try {
      const out = await api<{ scheduled: { platform: PublishPlatform; label: string; at: number }[]; note: string | null }>(`/review/${clip.pieceId}/approve`, { body: privacy ? { tiktokPrivacy: privacy } : {} });
      if (out.scheduled.length) toast.success('Approved and queued', { description: out.scheduled.map((p) => `${p.label}: ${formatWhen(p.at)}`).join(' · ') });
      else toast(out.note ?? 'Approved');
      queryClient.invalidateQueries({ queryKey: keys.review });
      onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-1.5">
        <h2 className="text-lg leading-snug font-semibold">{clip.title}</h2>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <WorkspaceDot color={clip.workspace.color} className="size-2" />
            {clip.workspace.name}
          </span>
          {clip.campaign && (
            <Link to={`/campaigns/${clip.campaign.id}`} className="inline-flex items-center gap-1 hover:text-foreground">
              <BadgeDollarSign className="size-3.5 text-orange-400" /> {clip.campaign.title}
            </Link>
          )}
          {clip.render?.durationMs && <span className="tabular-nums">{Math.round(clip.render.durationMs / 1000)} s</span>}
        </p>
      </div>

      {m && (
        <div className="space-y-1 text-sm">
          <p>
            <Badge variant="secondary" className="mr-1.5 align-middle">
              {MOMENT_KIND_LABELS[m.kind]} · {m.score}/10
            </Badge>
            {m.why}
          </p>
          {clip.source && (
            <p className="text-xs text-muted-foreground">
              From {sourceLink ? (
                <a href={sourceLink} target="_blank" rel="noreferrer" className="underline hover:text-foreground">
                  {clip.source.title || 'the source'} at {at}
                </a>
              ) : (
                `${clip.source.title || 'the source'} at ${at}`
              )}
            </p>
          )}
        </div>
      )}

      {m?.music?.verdict === 'unverified' && <Note>There was sound behind the voice and only the voice is kept, but the speech never pauses long enough to check it’s gone: listen for any music left.</Note>}
      {m?.music?.verdict === 'removed' && <p className="text-xs text-muted-foreground">Background music was removed: only the voice is kept.</p>}
      {m && m.halalFlags.length > 0 && (
        <Note>
          <p className="font-medium">To check</p>
          <ul className="list-disc pl-4 text-xs">
            {m.halalFlags.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </Note>
      )}
      {m?.frames?.verdict === 'flag' && (
        <Note>
          <p className="font-medium">On screen</p>
          <ul className="list-disc pl-4 text-xs">
            {m.frames.reasons.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </Note>
      )}

      {clip.rules.length > 0 && (
        <section className="space-y-1" aria-label="Campaign rules">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Campaign rules</h3>
            {manual.length > 1 && unticked > 0 && (
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setTicked(new Set(manual.map((r) => r.rule.text)))}>
                Tick all
              </Button>
            )}
          </div>
          <ul className="divide-y">
            {clip.rules.map((r) => (
              <RuleRow
                key={r.rule.text}
                result={r}
                ticked={ticked.has(r.rule.text)}
                onTick={(on) =>
                  setTicked((prev) => {
                    const next = new Set(prev);
                    if (on) next.add(r.rule.text);
                    else next.delete(r.rule.text);
                    return next;
                  })
                }
              />
            ))}
          </ul>
          {m && m.checkByEye.length > 0 && <p className="pt-1 text-xs text-muted-foreground">Claude says to look at: {m.checkByEye.join('; ')}</p>}
        </section>
      )}

      {platforms.length > 0 && (
        <section className="space-y-2" aria-label="Captions">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Captions</h3>
            <Button size="sm" variant="ghost" className="h-7 text-xs" asChild>
              <Link to={`/w/${clip.workspace.id}/p/${clip.pieceId}`}>
                <Pencil /> Edit
              </Link>
            </Button>
          </div>
          {platforms.map((p) => (
            <CopyBlock key={p} platform={p} text={clip.copy[p] ?? ''} />
          ))}
        </section>
      )}

      <section className="space-y-2" aria-label="Where it goes">
        <h3 className="text-sm font-medium">Where it goes</h3>
        {clip.accounts.length ? (
          <ul className="space-y-1 text-sm">
            {clip.accounts.map((a) => (
              <li key={a.id} className="flex items-center gap-2">
                <PlatformIcon platform={a.platform} className="size-3.5" />
                <span className="min-w-0 truncate">{a.label}</span>
                {a.reconnect && <span className="text-xs text-destructive">Reconnect first</span>}
                {a.platform === 'tiktok' && a.tiktokMode === 'inbox' && <span className="text-xs text-muted-foreground">to your TikTok inbox</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No account connected for this yet: approving puts it in Ready.</p>
        )}
        {clip.accounts.length > 0 && <p className="text-xs text-muted-foreground">At each account’s next free queue time.</p>}
        {clip.missingPlatforms.length > 0 && clip.accounts.length > 0 && <p className="text-xs text-muted-foreground">No account on {clip.missingPlatforms.map((p) => PUBLISH_PLATFORM_LABELS[p]).join(', ')}.</p>}
        {directTikTok && (
          <div className="space-y-1.5 pt-1">
            <Label htmlFor="tiktok-privacy">Who can see it on TikTok</Label>
            <Select value={privacy} onValueChange={(v) => setPrivacy(v as TikTokPrivacy)}>
              <SelectTrigger id="tiktok-privacy" className="w-full sm:w-72">
                <SelectValue placeholder="Choose" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(TIKTOK_PRIVACY_LABELS) as TikTokPrivacy[]).map((p) => (
                  <SelectItem key={p} value={p}>
                    {TIKTOK_PRIVACY_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </section>

      {failing.length > 0 && <Note tone="red">A rule fails: fix it (edit the captions or the video), then approve.</Note>}

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0">
        <Button onClick={approve} disabled={!canApprove} className="flex-1 sm:flex-none">
          {busy ? <Spinner /> : <ThumbsUp />} {clip.accounts.some((a) => !a.reconnect) ? 'Approve & queue' : 'Approve'}
        </Button>
        <Button variant="outline" onClick={() => setRejecting(true)} className="flex-1 sm:flex-none">
          <ThumbsDown /> Reject
        </Button>
        <Button variant="ghost" asChild className="max-sm:w-full">
          <Link to={`/w/${clip.workspace.id}/p/${clip.pieceId}/edit`}>
            <Clapperboard /> Open in studio
          </Link>
        </Button>
        {unticked > 0 && <p className="w-full text-xs text-muted-foreground">Tick the {unticked === 1 ? 'rule' : `${unticked} rules`} you checked by eye to approve.</p>}
      </div>
      <RejectDialog clip={clip} open={rejecting} onOpenChange={setRejecting} onDone={onDone} />
    </div>
  );
}

/**
 * The review queue: each clip waiting in a page's Review column, with its render, where it came from and the
 * campaign's rules checked against it. Approving (my click) queues it; rejecting keeps the reason for the next pick.
 */
export function ReviewPage() {
  const review = useReview();
  const [params, setParams] = useSearchParams();
  const clips = review.data ?? [];
  const wanted = params.get('piece');
  const index = Math.max(0, wanted ? clips.findIndex((c) => c.pieceId === wanted) : 0);
  const clip = clips[index];
  const gone = !!wanted && !!review.data && !clips.some((c) => c.pieceId === wanted);
  const touch = useRef<{ x: number; y: number } | null>(null);

  const go = (i: number) => {
    const next = clips[Math.min(clips.length - 1, Math.max(0, i))];
    if (next) setParams({ piece: next.pieceId }, { replace: true });
  };
  // After a decision: the clip that took its place (or the one before, at the end of the queue).
  const afterDecision = () => {
    const next = clips[index + 1] ?? clips[index - 1];
    setParams(next ? { piece: next.pieceId } : {}, { replace: true });
    queryClient.invalidateQueries({ queryKey: keys.review });
    queryClient.invalidateQueries({ queryKey: keys.today });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || document.querySelector('[role="dialog"]')) return;
      if (e.key === 'ArrowRight' || e.key === 'j') go(index + 1);
      if (e.key === 'ArrowLeft' || e.key === 'k') go(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Review"
        description={clips.length ? `${clips.length} clip${clips.length === 1 ? '' : 's'} waiting for your yes or no` : 'Clips land here once they’re rendered'}
        actions={
          clips.length > 1 && (
            <div className="flex items-center gap-1">
              <Button size="icon-sm" variant="ghost" disabled={index === 0} onClick={() => go(index - 1)} aria-label="Previous clip">
                <ChevronLeft />
              </Button>
              <span className="text-xs text-muted-foreground tabular-nums">
                {index + 1} / {clips.length}
              </span>
              <Button size="icon-sm" variant="ghost" disabled={index >= clips.length - 1} onClick={() => go(index + 1)} aria-label="Next clip">
                <ChevronRight />
              </Button>
            </div>
          )
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!review.data ? (
          <div className="mx-auto grid max-w-5xl gap-6 p-4 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] md:p-6">
            <Skeleton className="aspect-[9/16] rounded-xl" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
        ) : !clip ? (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Check />
              </EmptyMedia>
              <EmptyTitle>Nothing to review</EmptyTitle>
              <EmptyDescription>
                Clips made from campaigns’ moments land here once they’re rendered. <Link to="/campaigns">Campaigns</Link>
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
            {gone && <Note>That clip isn’t waiting for review any more.</Note>}
            {clips.length > 1 && (
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Clips waiting">
                {clips.map((c, i) => (
                  <button
                    key={c.pieceId}
                    type="button"
                    role="tab"
                    aria-selected={i === index}
                    aria-label={c.title}
                    onClick={() => go(i)}
                    className={cn('relative aspect-[9/16] w-12 shrink-0 overflow-hidden rounded-md border bg-muted', i === index ? 'ring-2 ring-brand' : 'opacity-70 hover:opacity-100')}
                  >
                    {c.render?.hasThumb ? <img src={mediaThumbUrl(c.render.mediaId)} alt="" loading="lazy" className="size-full object-cover" /> : <Loader2 className="absolute inset-0 m-auto size-3.5 animate-spin text-muted-foreground" />}
                  </button>
                ))}
              </div>
            )}
            <div className="grid gap-6 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
              <div
                className="mx-auto aspect-[9/16] max-h-[70vh] w-full max-w-[22rem] overflow-hidden rounded-xl border bg-black md:sticky md:top-0"
                onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
                onTouchEnd={(e) => {
                  const start = touch.current;
                  touch.current = null;
                  if (!start) return;
                  const dx = e.changedTouches[0].clientX - start.x;
                  const dy = e.changedTouches[0].clientY - start.y;
                  // A sideways swipe moves through the queue; it never approves or rejects.
                  if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(index + (dx < 0 ? 1 : -1));
                }}
              >
                <Player clip={clip} />
              </div>
              <ClipDetails clip={clip} onDone={afterDecision} />
            </div>
            {clip.campaign?.link && (
              <p className="text-xs text-muted-foreground">
                <a href={clip.campaign.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-foreground">
                  <ExternalLink className="size-3" /> The campaign on Content Rewards
                </a>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
