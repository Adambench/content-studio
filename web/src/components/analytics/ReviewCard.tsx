import { Check, ChevronDown, Clock, Lightbulb, Plus, RotateCcw, Sparkles, Trophy, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { PUBLISH_PLATFORM_LABELS, PUBLISH_PLATFORMS, type QueueSlot } from '@shared/publish';
import { TextDiff } from '@/components/DiffView';
import { Markdown } from '@/components/Markdown';
import { DAY_NAMES, PlatformIcon } from '@/components/publish/common';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Spinner } from '@/components/ui/spinner';
import { api, errorMessage } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { keys, queryClient, useReviews, useSettings } from '@/lib/queries';
import type { Review } from '@/lib/types';
import { cn } from '@/lib/utils';

/** An account as the review names it ("TikTok @handle"): the platform's mark and the handle. */
function AccountTag({ label, className }: { label: string; className?: string }) {
  const platform = PUBLISH_PLATFORMS.find((p) => label.startsWith(`${PUBLISH_PLATFORM_LABELS[p]} `));
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      {platform && <PlatformIcon platform={platform} className="size-3" />}
      {platform ? label.slice(PUBLISH_PLATFORM_LABELS[platform].length + 1) : label}
    </span>
  );
}

const clockTime = (time: string) => new Date(2000, 0, 1, ...(time.split(':').map(Number) as [number, number])).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/** "18:00 every day", "12:30 Mon, Wed, Fri". */
function slotText(s: QueueSlot) {
  const time = clockTime(s.time);
  const days = s.days.length === 7 ? 'every day' : [...s.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => DAY_NAMES[d]).join(', ');
  return `${time} ${days}`;
}

const period = (r: Review) => `${new Date(r.periodStart).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${new Date(r.periodEnd).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;

/** Claude's weekly look at the results: what worked, what to try, queue times and voice memory changes. */
export function ReviewCard({ wid }: { wid: string }) {
  const reviews = useReviews(wid);
  const settings = useSettings();
  const [picked, setPicked] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const list = reviews.data ?? [];
  const review = list.find((r) => r.id === picked) ?? list[0];
  const running = list.some((r) => r.status === 'running');
  const schedule = settings.data?.weeklyReview;

  async function reviewNow() {
    setStarting(true);
    try {
      await api(`/workspaces/${wid}/reviews`, { body: {} });
      setPicked(null);
      await queryClient.invalidateQueries({ queryKey: keys.reviews(wid) });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setStarting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1 space-y-1.5">
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-brand" /> Weekly review
            </CardTitle>
            <CardDescription>
              {review && review.status !== 'running'
                ? `${period(review)} · ${review.trigger === 'weekly' ? 'ran by itself' : 'you asked'} ${timeAgo(review.finishedAt ?? review.createdAt)}`
                : schedule?.enabled
                  ? `Claude looks at your results every ${new Date(2000, 0, 2 + schedule.day).toLocaleDateString(undefined, { weekday: 'long' })} at ${clockTime(schedule.time)} and suggests what to do next.`
                  : 'Claude looks at your results and suggests what to do next.'}
            </CardDescription>
          </div>
          <div className="flex items-center gap-1">
            {list.length > 1 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="ghost">
                    Earlier <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-w-80">
                  {list.map((r) => (
                    <DropdownMenuItem key={r.id} onSelect={() => setPicked(r.id)} className="flex-col items-start gap-0">
                      <span className="text-xs text-muted-foreground">{period(r)}</span>
                      <span className="line-clamp-2">{r.body?.headline ?? (r.status === 'running' ? 'Running…' : 'Didn’t finish')}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button size="sm" variant="outline" onClick={reviewNow} disabled={running || starting}>
              {starting ? <Spinner /> : <RotateCcw />} Review now
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {reviews.isPending ? (
          <Spinner className="text-muted-foreground" />
        ) : !review ? (
          <p className="text-sm text-muted-foreground">
            No review yet. Once posts have gone out and their numbers are in, Claude reviews the week: what worked and why, ideas that build on it, better queue times, and what it learned
            for your voice memory.
            {schedule && !schedule.enabled && ' Weekly reviews are off (Settings → Weekly review).'}
          </p>
        ) : review.status === 'running' ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Spinner /> Claude is going through this week’s numbers…
          </p>
        ) : review.status === 'error' ? (
          <p className="text-sm text-destructive">The review didn’t finish: {review.error}</p>
        ) : (
          review.body && <ReviewBodyView review={review} wid={wid} />
        )}
      </CardContent>
    </Card>
  );
}

function ReviewBodyView({ review, wid }: { review: Review; wid: string }) {
  const b = review.body!;
  const [busy, setBusy] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(false);

  async function act(key: string, path: string, done: string) {
    setBusy(key);
    try {
      await api(path, { body: {} });
      await queryClient.invalidateQueries({ queryKey: keys.reviews(wid) });
      toast.success(done);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <p className="font-medium text-pretty">{b.headline}</p>
        <Markdown className="text-muted-foreground [&_strong]:text-foreground">{b.summary}</Markdown>
      </div>

      {b.wins.length > 0 && (
        <Section icon={Trophy} title="What worked">
          <ul className="space-y-2">
            {b.wins.map((w, i) => (
              <li key={i} className="text-sm">
                {w.pieceId ? (
                  <Link to={`/w/${wid}/p/${w.pieceId}`} className="font-medium hover:underline">
                    {w.title}
                  </Link>
                ) : (
                  <span className="font-medium">{w.title}</span>
                )}
                {w.account && <AccountTag label={w.account} className="ml-1.5 align-middle text-xs text-muted-foreground" />}
                <p className="text-muted-foreground">{w.why}</p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {b.lessons.length > 0 && (
        <Section icon={Check} title="For next week">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {b.lessons.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </Section>
      )}

      {b.slots.length > 0 && (
        <Section icon={Clock} title="Queue times">
          {b.slots.map((s, i) => (
            <div key={i} className="space-y-2 rounded-lg border p-3">
              <AccountTag label={s.account} className="text-sm font-medium" />
              <p className="text-sm">{s.slots.map(slotText).join(' · ')}</p>
              <p className="text-xs text-muted-foreground">{s.reason}</p>
              {s.appliedAt ? (
                <p className="flex items-center gap-1 text-xs text-emerald-400">
                  <Check className="size-3.5" /> In use since {timeAgo(s.appliedAt)}
                </p>
              ) : (
                <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => act(`slot${i}`, `/reviews/${review.id}/slots/${i}/apply`, 'Queue times updated')}>
                  {busy === `slot${i}` && <Spinner />} Use these times
                </Button>
              )}
            </div>
          ))}
        </Section>
      )}

      {b.ideas.length > 0 && (
        <Section icon={Lightbulb} title="Ideas to try">
          <div className="grid gap-2 sm:grid-cols-2">
            {b.ideas.map((idea, i) => (
              <div key={i} className="flex flex-col gap-1.5 rounded-lg border p-3">
                <p className="text-sm font-medium">{idea.title}</p>
                <p className="text-sm">“{idea.hook}”</p>
                <p className="flex-1 text-xs text-muted-foreground">{idea.why}</p>
                {idea.pieceId ? (
                  <Button size="sm" variant="ghost" className="self-start" asChild>
                    <Link to={`/w/${wid}/p/${idea.pieceId}`}>
                      <Check /> On the board
                    </Link>
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" className="self-start" disabled={!!busy} onClick={() => act(`idea${i}`, `/reviews/${review.id}/ideas/${i}`, 'Added to the board')}>
                    {busy === `idea${i}` ? <Spinner /> : <Plus />} Add to board
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {review.voiceChanged && (
        <Section icon={Sparkles} title="Voice memory">
          <p className={cn('text-sm', b.voiceUndone && 'text-muted-foreground line-through')}>{b.voiceNote}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={() => setShowDiff((v) => !v)} aria-expanded={showDiff}>
              {showDiff ? 'Hide changes' : 'Show changes'}
            </Button>
            {!b.voiceUndone && (
              <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => act('undo', `/reviews/${review.id}/undo-voice`, 'Voice memory put back')}>
                {busy === 'undo' ? <Spinner /> : <Undo2 />} Undo
              </Button>
            )}
          </div>
          {showDiff && <TextDiff before={review.voiceBefore ?? ''} after={review.voiceAfter ?? ''} />}
        </Section>
      )}
    </div>
  );
}

function Section({ icon: Icon, title, children }: { icon: typeof Check; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 border-t pt-4">
      <h3 className="flex items-center gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        <Icon className="size-3.5" /> {title}
      </h3>
      {children}
    </section>
  );
}
