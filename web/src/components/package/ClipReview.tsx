import { AlertTriangle, BadgeDollarSign, CalendarClock, Check, CheckCircle2, Copy, Loader2, MessageSquareText, Pencil, RotateCcw, TvMinimalPlay, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { MOMENT_KIND_LABELS, REJECT_REASONS, clock, type ReviewClip, type RuleResult } from '@shared/clipping';
import { PUBLISH_PLATFORM_LABELS, TIKTOK_PRIVACY_LABELS, type PublishPlatform, type TikTokPrivacy } from '@shared/publish';
import { RULE_KIND_LABELS } from '@shared/campaigns';
import { FLOW_STEPS, type ApprovePlan, type FlowStep } from '@shared/dashboard';
import { reviewState } from '@shared/review';
import { REVIEW_STAGE, inReview } from '@shared/types';
import { PlatformIcon, StatusIcon, accountName, statusText } from '@/components/publish/common';
import { useWorkspaceContext } from '@/components/WorkspaceLayout';
import { WorkspaceDot } from '@/components/WorkspaceDot';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Kbd } from '@/components/ui/kbd';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { api, errorMessage, mediaFileUrl, mediaThumbUrl } from '@/lib/api';
import { copyFixLine, flowStep, whenText } from '@/lib/dashboard';
import { compact } from '@/lib/format';
import { keys, queryClient, useApprovePlan, useNotes, usePiecePosts } from '@/lib/queries';
import type { PieceDetail } from '@/lib/types';
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
export function ClipPlayer({ clip, empty, videoRef, show }: { clip: Pick<ReviewClip, 'render' | 'rendering'>; empty?: React.ReactNode; videoRef?: React.Ref<HTMLVideoElement>; show?: { mediaId: string; hasThumb: boolean } }) {
  const shown = show ?? clip.render;
  if (shown)
    return (
      <video
        ref={videoRef}
        key={shown.mediaId}
        src={mediaFileUrl(shown.mediaId)}
        poster={shown.hasThumb ? mediaThumbUrl(shown.mediaId) : undefined}
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

/** The loop as five steps, the current one lit: always fits, however narrow the column. */
function FlowBar({ step }: { step: FlowStep }) {
  const at = FLOW_STEPS.findIndex((s) => s.id === step);
  return (
    <ol className="grid grid-cols-5 gap-1" aria-label="Where this video is">
      {FLOW_STEPS.map((s, i) => (
        <li key={s.id} aria-current={i === at ? 'step' : undefined} className="min-w-0 space-y-1">
          <div className={cn('h-1 rounded-full', i === at ? 'bg-brand' : i < at ? 'bg-muted-foreground/50' : 'bg-muted')} />
          <p className={cn('truncate text-[10px] leading-tight', i === at ? 'font-medium text-brand' : i < at ? 'text-muted-foreground' : 'text-muted-foreground/50')}>{s.label}</p>
        </li>
      ))}
    </ol>
  );
}

/** Where approving puts it: each account and when. */
function PlanLine({ plan }: { plan: ApprovePlan | undefined }) {
  if (!plan) return <p className="text-xs text-muted-foreground">Working out when it goes out…</p>;
  const ok = plan.targets.filter((t) => t.at !== null && !t.problem);
  const bad = plan.targets.filter((t) => t.at === null || t.problem);
  return (
    <div className="space-y-1 text-xs">
      {ok.length > 0 && (
        <ul className="space-y-0.5">
          {ok.map((t) => (
            <li key={t.accountId} className="flex items-center gap-1.5">
              <PlatformIcon platform={t.platform} className="size-3.5" />
              <span className="min-w-0 truncate">{t.label}</span>
              <span className="text-muted-foreground">·</span>
              <span className="font-medium">{whenText(t.at!)}</span>
            </li>
          ))}
        </ul>
      )}
      {bad.map((t) => (
        <p key={t.accountId} className="flex items-start gap-1.5 text-amber-300">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {t.label}: {t.problem ?? 'no free time'}
        </p>
      ))}
      {!plan.targets.length && <p className="text-muted-foreground">No account connected for this page yet: approving puts it in Ready.</p>}
      {plan.error && <p className="text-amber-300">{plan.error}</p>}
      {plan.missingPlatforms.length > 0 && plan.targets.length > 0 && <p className="text-muted-foreground">No account on {plan.missingPlatforms.map((p) => PUBLISH_PLATFORM_LABELS[p]).join(', ')}.</p>}
      {ok.length > 0 && <p className="text-muted-foreground">At its account’s next good time: at most 2 a day, 3 h apart, right away when a posting time just went by.</p>}
    </div>
  );
}

/**
 * The video's one decision card: where it is in the loop (my review → Claude's fixes → approved → scheduled →
 * posted), what to do now and the button for it. Under it what to check before saying yes (the moment, flags,
 * campaign rules) and the captions.
 */
export function ClipReview({ clip, piece, onDone, onSchedule }: { clip: ReviewClip; piece: Pick<PieceDetail, 'id' | 'workspaceId' | 'reviewedMediaId'>; onDone: () => void; onSchedule: () => void }) {
  const navigate = useNavigate();
  const { workspace } = useWorkspaceContext();
  const notes = useNotes(clip.pieceId);
  const posts = usePiecePosts(clip.pieceId);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [privacy, setPrivacy] = useState<TikTokPrivacy | ''>('');
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  useEffect(() => {
    setTicked(new Set());
    setPrivacy('');
  }, [clip.pieceId]);

  const m = clip.moment;
  const list = notes.data ?? [];
  const open = list.filter((n) => n.status === 'open').length;
  const fixed = list.filter((n) => n.status === 'fixed').length;
  const out = clip.stage === 'scheduled' || clip.stage === 'posted';
  const rendering = !!clip.rendering && (clip.rendering.status === 'queued' || clip.rendering.status === 'running');
  const state = reviewState({ renderId: clip.render?.mediaId ?? null, reviewedMediaId: piece.reviewedMediaId, open, comments: list.length, out });
  const step = flowStep({ stage: clip.stage, state, rendering });
  const plan = useApprovePlan(clip.pieceId, step === 'review' || step === 'approved');
  const manual = clip.rules.filter((r) => r.status === 'manual');
  const failing = clip.rules.filter((r) => r.status === 'fail');
  const unticked = manual.filter((r) => !ticked.has(r.rule.text)).length;
  const directTikTok = clip.accounts.some((a) => a.platform === 'tiktok' && a.tiktokMode === 'direct' && !a.reconnect);
  const platforms = Object.keys(clip.copy) as PublishPlatform[];
  const canApprove = !!clip.render && !open && !failing.length && !unticked && (!directTikTok || !!privacy) && !busy;
  const rejectable = inReview(clip.stage);
  const at = m ? `${clock(m.start)}–${clock(m.end)}` : null;
  const sourceLink = m && clip.source?.link ? (/youtube\.com\/watch/.test(clip.source.link) ? `${clip.source.link}&t=${Math.floor(m.start)}s` : clip.source.link) : null;
  // Undo puts it back in Review (or the column before Ready on boards without one).
  const stageIds = workspace.stages.map((s) => s.id);
  const backTo = stageIds.includes(REVIEW_STAGE) ? REVIEW_STAGE : (stageIds[Math.max(0, stageIds.indexOf('ready') - 1)] ?? stageIds[0]);
  const waiting = (posts.data ?? []).filter((p) => p.status === 'scheduled' || p.status === 'failed' || p.status === 'missed');
  const going = (posts.data ?? []).some((p) => p.status === 'publishing' || p.status === 'published');

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: keys.review });
    queryClient.invalidateQueries({ queryKey: keys.piece(clip.pieceId) });
    queryClient.invalidateQueries({ queryKey: keys.piecePosts(clip.pieceId) });
    queryClient.invalidateQueries({ queryKey: keys.today });
  };

  async function undo(stage: string) {
    try {
      await api(`/review/${clip.pieceId}/undo`, { body: { stage } });
      refresh();
      toast('Back in your review', { action: { label: 'Open', onClick: () => navigate(`/w/${clip.workspace.id}/p/${clip.pieceId}`) } });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  async function approve(next = true) {
    setBusy(true);
    try {
      const res = await api<{ from: string; scheduled: { platform: PublishPlatform; label: string; at: number }[]; note: string | null }>(`/review/${clip.pieceId}/approve`, { body: privacy ? { tiktokPrivacy: privacy } : {} });
      const undoAction = { label: 'Undo', onClick: () => void undo(res.from) };
      if (res.scheduled.length) toast.success('Approved and scheduled', { description: res.scheduled.map((p) => `${p.label}: ${whenText(p.at)}`).join(' · '), action: undoAction, duration: 10_000 });
      else toast(res.note ?? 'Approved', { action: undoAction, duration: 10_000 });
      refresh();
      if (next) onDone();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const checks = (
    <>
      {m?.music?.verdict === 'unverified' && <Note>There was sound behind the voice and only the voice is kept, but the speech never pauses long enough to check it’s gone: listen for any music left.</Note>}
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
      {failing.length > 0 && <Note tone="red">A rule fails: fix it (edit the captions or the video), then approve.</Note>}
      {directTikTok && (
        <div className="space-y-1.5">
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
    </>
  );

  return (
    <div className="space-y-5">
      <div className="space-y-3">
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
          {clip.renderVersion && <span className="tabular-nums">v{clip.renderVersion}</span>}
        </p>
        <FlowBar step={step} />
      </div>

      {step === 'review' && (
        <div className="space-y-4">
          <div className="space-y-1">
            <p className="flex items-center gap-2 text-base font-medium">
              {state === 'recheck' ? <RotateCcw className="size-4 text-brand" /> : <TvMinimalPlay className="size-4 text-sky-400" />}
              {state === 'recheck' ? 'Your turn: Claude changed it, watch it again' : clip.render ? 'Your turn: watch it' : 'Waiting for its render'}
            </p>
            <p className="text-sm text-muted-foreground">
              {state === 'recheck' && fixed > 0 && `Claude answered ${fixed} comment${fixed === 1 ? '' : 's'} (under the video). `}
              Something to change? Pause and write it in the box under the video (or press <Kbd>C</Kbd>): it goes to Claude and comes back here. All good? Approve it.
            </p>
          </div>
          <div className="space-y-2 rounded-lg border bg-background/40 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="lg" onClick={() => approve()} disabled={!canApprove} className="flex-1 sm:flex-none">
                {busy ? <Spinner /> : <Check />} Approve & schedule
              </Button>
              {rejectable && (
                <Button size="lg" variant="outline" onClick={() => setRejecting(true)} className="flex-1 sm:flex-none">
                  <X /> Reject
                </Button>
              )}
            </div>
            {unticked > 0 && <p className="text-xs text-amber-300">To approve, tick the campaign {unticked === 1 ? 'rule' : `${unticked} rules`} below once you’ve checked {unticked === 1 ? 'it' : 'them'} by eye.</p>}
            {open > 0 && <p className="text-xs text-amber-300">Close or delete the open comments first.</p>}
            {directTikTok && !privacy && <p className="text-xs text-muted-foreground">Choose who can see it on TikTok to approve.</p>}
            <PlanLine plan={plan.data} />
            {rejectable && <p className="text-xs text-muted-foreground">Reject only when the clip can’t be saved: {m ? 'it’s deleted and the next picks avoid it' : 'it goes back a column'}.</p>}
          </div>
          {checks}
        </div>
      )}

      {step === 'claude' && (
        <div className="space-y-3 rounded-lg border border-amber-400/30 bg-amber-400/5 p-3">
          {rendering && !open ? (
            <p className="flex items-center gap-2 text-base font-medium">
              <Loader2 className="size-4 animate-spin text-brand" /> Claude’s changes are rendering
              {clip.rendering?.status === 'running' && <span className="text-sm font-normal text-muted-foreground tabular-nums">{Math.round(clip.rendering.progress * 100)}%</span>}
            </p>
          ) : (
            <p className="flex items-center gap-2 text-base font-medium">
              <MessageSquareText className="size-4 text-amber-400" /> With Claude: {open} comment{open === 1 ? '' : 's'} to fix
            </p>
          )}
          <p className="text-sm text-muted-foreground">
            {rendering && !open
              ? 'It comes back to you as “Check again” once the new version is ready.'
              : 'In Claude Code, say “fix my comments”. Claude fixes them, renders a new version and it comes back to you as “Check again”.'}
          </p>
          {open > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="secondary" onClick={copyFixLine}>
                <Copy /> Copy “fix my comments”
              </Button>
              <span className="text-xs text-muted-foreground">Changed your mind on one? Close it in the list, then approve.</span>
            </div>
          )}
        </div>
      )}

      {step === 'approved' && (
        <div className="space-y-3 rounded-lg border border-emerald-400/30 bg-emerald-400/5 p-3">
          <p className="flex items-center gap-2 text-base font-medium">
            <CalendarClock className="size-4 text-emerald-400" /> Approved, not scheduled yet
          </p>
          <PlanLine plan={plan.data} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => approve(false)} disabled={busy || !plan.data?.targets.some((t) => t.at !== null && !t.problem)}>
              {busy ? <Spinner /> : <CalendarClock />} Schedule at the next good time
            </Button>
            <Button size="sm" variant="outline" onClick={onSchedule}>
              Pick a time
            </Button>
            <Button size="sm" variant="ghost" onClick={() => undo(backTo)}>
              Back to review
            </Button>
          </div>
        </div>
      )}

      {(step === 'scheduled' || step === 'posted') && (
        <div className="space-y-2 rounded-lg border bg-background/40 p-3">
          <p className="flex items-center gap-2 text-base font-medium">
            {step === 'posted' ? <CheckCircle2 className="size-4 text-emerald-400" /> : <CalendarClock className="size-4 text-brand" />}
            {step === 'posted' ? 'Posted' : 'Scheduled'}
          </p>
          <ul className="space-y-1 text-sm">
            {(posts.data ?? []).map((p) => (
              <li key={p.id} className="flex items-center gap-1.5">
                <PlatformIcon platform={p.platform} className="size-3.5" />
                <span className="min-w-0 truncate">{accountName(p.account, p.accountLabel)}</span>
                <span className="text-muted-foreground">·</span>
                <StatusIcon post={p} className="size-3" />
                <span className="text-muted-foreground">{p.status === 'scheduled' ? whenText(p.scheduledAt) : p.status === 'published' && p.stats?.views != null ? `${compact(p.stats.views)} views` : statusText(p)}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            {step === 'scheduled' && (
              <Button size="sm" variant="outline" onClick={() => document.getElementById('posts')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                Change time
              </Button>
            )}
            {step === 'scheduled' && !going && waiting.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => undo(backTo)}>
                Undo approval
              </Button>
            )}
          </div>
        </div>
      )}

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
          {m.music?.verdict === 'removed' && <p className="text-xs text-muted-foreground">Background music was removed: only the voice is kept.</p>}
        </div>
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
      <RejectDialog clip={clip} open={rejecting} onOpenChange={setRejecting} onDone={onDone} />
    </div>
  );
}
