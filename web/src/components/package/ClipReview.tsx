import { AlertTriangle, BadgeDollarSign, Check, Loader2, Pencil, ThumbsDown, ThumbsUp, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { MOMENT_KIND_LABELS, REJECT_REASONS, clock, type ReviewClip, type RuleResult } from '@shared/clipping';
import { PUBLISH_PLATFORM_LABELS, TIKTOK_PRIVACY_LABELS, type PublishPlatform, type TikTokPrivacy } from '@shared/publish';
import { RULE_KIND_LABELS } from '@shared/campaigns';
import { PlatformIcon, formatWhen } from '@/components/publish/common';
import { WorkspaceDot } from '@/components/WorkspaceDot';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { api, errorMessage, mediaFileUrl, mediaThumbUrl } from '@/lib/api';
import { keys, queryClient } from '@/lib/queries';
import { cn } from '@/lib/utils';

function Note({ children, tone = 'amber' }: { children: React.ReactNode; tone?: 'amber' | 'red' }) {
  return (
    <div className={cn('flex items-start gap-2 rounded-lg border px-3 py-2 text-sm', tone === 'amber' ? 'border-amber-400/30 bg-amber-400/5' : 'border-destructive/40 bg-destructive/5')}>
      <AlertTriangle className={cn('mt-0.5 size-4 shrink-0', tone === 'amber' ? 'text-amber-400' : 'text-destructive')} />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** The latest finished video, or how its render is going. */
export function ClipPlayer({ clip, empty }: { clip: Pick<ReviewClip, 'render' | 'rendering'>; empty?: React.ReactNode }) {
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
  if (!r && empty) return <>{empty}</>;
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

/** A clip's (or campaign video's) review: where it came from, the checks, the campaign's rules, where it goes, approve or reject. */
export function ClipReview({ clip, onDone }: { clip: ReviewClip; onDone: () => void }) {
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
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => document.getElementById('platform-copy')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
              <Pencil /> Edit
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
        {unticked > 0 && <p className="w-full text-xs text-muted-foreground">Tick the {unticked === 1 ? 'rule' : `${unticked} rules`} you checked by eye to approve.</p>}
      </div>
      <RejectDialog clip={clip} open={rejecting} onOpenChange={setRejecting} onDone={onDone} />
    </div>
  );
}
