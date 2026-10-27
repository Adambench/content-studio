import { Crosshair, Flag, Gauge, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { editDuration, STORY_TEXT_MAX, type EditStory } from '@shared/edit';
import { QUALITY_BAR, QUALITY_INFO, qualityText, type QualityItem } from '@shared/quality';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { api, errorMessage } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { keys, queryClient } from '@/lib/queries';
import { sendToVideoChat } from '@/lib/ui-state';
import { cn } from '@/lib/utils';
import { useStudio } from './context';
import { Field, preciseClock } from './controls';

const tone = (score: number, of: number) => (score / of >= 0.75 ? 'text-emerald-400' : score / of >= 0.5 ? 'text-amber-400' : 'text-destructive');
const bar = (score: number, of: number) => (score / of >= 0.75 ? 'bg-emerald-400' : score / of >= 0.5 ? 'bg-amber-400' : 'bg-destructive');

/** The content model (promise → payoff) and the quality score the edit gets before it renders. */
export function QualityPanel() {
  const { edit, piece, spec, update, serverAction, time, seek } = useStudio();
  const [checking, setChecking] = useState(false);
  const story = spec.story;
  const set = (patch: Partial<EditStory>) => update((s) => ({ ...s, story: { ...s.story, ...patch } }));
  const total = editDuration(spec);
  const report = edit.quality;
  const head = edit.versions[0]?.number;

  async function check() {
    setChecking(true);
    try {
      await serverAction(() => api(`/edits/${edit.id}/check`, { body: {} }));
      queryClient.invalidateQueries({ queryKey: keys.edit(edit.pieceId) });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div>
          <h3 className="text-sm font-medium">Story</h3>
          <p className="text-xs text-muted-foreground">The hook makes a promise, the video builds toward it, the payoff keeps it near the end.</p>
        </div>
        <Field label="Promise" hint="what the first 3 s promise">
          <Textarea rows={2} maxLength={STORY_TEXT_MAX} value={story.promise} placeholder="The one setting that doubled my views" onChange={(e) => set({ promise: e.target.value })} />
        </Field>
        <Field label="Payoff" hint="what they get for staying">
          <Textarea rows={2} maxLength={STORY_TEXT_MAX} value={story.payoff} placeholder="The setting, shown on screen, and the before/after numbers" onChange={(e) => set({ payoff: e.target.value })} />
        </Field>
        <Field label="Paid at" hint={story.payoffAt !== null && total > 0 ? `${Math.round((story.payoffAt / total) * 100)}% in` : 'second half, near the end'}>
          <div className="flex gap-2">
            <Input
              type="number"
              min={0}
              max={total}
              step={0.1}
              className="w-24 tabular-nums"
              value={story.payoffAt ?? ''}
              placeholder="—"
              onChange={(e) => set({ payoffAt: e.target.value === '' ? null : Math.max(0, Math.min(total, Number(e.target.value))) })}
            />
            <Button size="sm" variant="outline" onClick={() => set({ payoffAt: Math.round(time * 10) / 10 })}>
              <Crosshair /> Paid here ({preciseClock(time)})
            </Button>
            {story.payoffAt !== null && (
              <Button size="icon-sm" variant="ghost" aria-label="Go to the payoff" onClick={() => seek(story.payoffAt!)}>
                <Flag />
              </Button>
            )}
          </div>
        </Field>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h3 className="mr-auto text-sm font-medium">Quality</h3>
          <Button size="sm" variant="outline" onClick={check} disabled={checking || !spec.clips.length}>
            {checking ? <Spinner /> : <Gauge />} {report ? 'Check again' : 'Check'}
          </Button>
        </div>
        {!report ? (
          <p className="text-xs text-muted-foreground">Every render is checked first: below {QUALITY_BAR}/100 Claude fixes the edit before it renders. Check now to see the score and what to fix.</p>
        ) : (
          <>
            <div className="flex items-end gap-3">
              <span className={cn('text-4xl font-semibold tabular-nums', tone(report.score, 100))}>{report.score}</span>
              <div className="min-w-0 pb-1 text-xs text-muted-foreground">
                <p>
                  out of 100 · bar {report.bar} · v{report.versionNumber}
                  {head && head > report.versionNumber ? ` (the edit is at v${head} now)` : ''}
                </p>
                <p>
                  {timeAgo(report.at)}
                  {report.afterFix ? ' · after Claude’s fix' : ''}
                  {!report.judged ? ' · measured only' : ''}
                </p>
              </div>
            </div>
            {report.summary && <p className="text-sm">{report.summary}</p>}
            <ul className="space-y-3">
              {report.items.map((i) => (
                <Criterion key={i.criterion} item={i} />
              ))}
            </ul>
            {piece && report.items.some((i) => i.fix) && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => sendToVideoChat(piece.id, `Fix what the quality check found, then tell me in a line what you changed. Don't render.\n\n${qualityText(report)}`)}
              >
                <Sparkles className="text-brand" /> Fix it with Claude
              </Button>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function Criterion({ item }: { item: QualityItem }) {
  const [open, setOpen] = useState(item.score < 8);
  const info = QUALITY_INFO[item.criterion];
  return (
    <li className="space-y-1.5">
      <button type="button" className="flex w-full items-center gap-2 text-left text-sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="font-medium">{info.label}</span>
        {item.judged && <Sparkles className="size-3 text-brand" aria-label="Judged by Claude" />}
        <span className={cn('ml-auto tabular-nums', tone(item.score, 10))}>{item.score}/10</span>
      </button>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div className={cn('h-full rounded-full', bar(item.score, 10))} style={{ width: `${Math.max(3, item.score * 10)}%` }} />
      </div>
      {open && (
        <div className="space-y-1 text-xs">
          <p className="text-muted-foreground">{item.measured}</p>
          <p>{item.why}</p>
          {item.fix && <p className="rounded-md border border-dashed px-2 py-1.5">{item.fix}</p>}
        </div>
      )}
    </li>
  );
}

/** The last score in the editor's header; opens the Quality tab. */
export function QualityBadge({ score, onClick }: { score: number; onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick} className={cn('tabular-nums', tone(score, 100))} aria-label={`Quality ${score} out of 100`}>
      <Gauge /> {score}
    </Button>
  );
}
