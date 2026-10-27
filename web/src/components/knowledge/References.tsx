import { CircleAlert, ExternalLink, Film, Loader2, MoreHorizontal, RefreshCw, Ruler, Sparkles, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { BEAT_LABELS, type OwnMeasures, type ReferenceVideo } from '@shared/references';
import { PlatformIcon } from '@/components/publish/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { api, errorMessage, fileUrl } from '@/lib/api';
import { clock, compact } from '@/lib/format';
import { openExternal } from '@/lib/native';
import { keys, queryClient, useOwnMeasures, useReferences, useWorkspaces } from '@/lib/queries';
import { cn } from '@/lib/utils';

const EVERY = 'every';
const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: keys.references }), queryClient.invalidateQueries({ queryKey: keys.knowledge })]);

async function act<T>(fn: () => Promise<T>) {
  try {
    const out = await fn();
    await refresh();
    return out;
  } catch (err) {
    toast.error(errorMessage(err));
    return undefined;
  }
}

const pct = (n: number | null | undefined) => (n === null || n === undefined ? '–' : `${Math.round(n * 100)} %`);
const sec = (n: number | null | undefined) => (n === null || n === undefined ? '–' : `${n} s`);

/** Videos measured to learn from: paste a link, it's measured, Claude reads it and drafts lessons for my OK. */
export function References({ highlight, onShowSuggested }: { highlight: string | null; onShowSuggested: () => void }) {
  const references = useReferences();
  const workspaces = useWorkspaces();
  const [url, setUrl] = useState('');
  const [scope, setScope] = useState(EVERY);
  const [busy, setBusy] = useState(false);
  const own = useOwnMeasures(scope === EVERY ? null : scope);
  const list = references.data ?? [];

  async function submit() {
    setBusy(true);
    const r = await act(() => api<ReferenceVideo>('/references', { body: { url, workspaceId: scope === EVERY ? null : scope } }));
    setBusy(false);
    if (!r) return;
    setUrl('');
    toast(r.status === 'done' ? 'Already measured: it’s in the list' : 'Measuring it: a few minutes');
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-medium">References</h2>
        <p className="text-xs text-muted-foreground">
          A short that works, measured: what changes on screen and when, the sounds on those changes, the pace, the first 3 s. Claude marks its beats and drafts lessons for you to approve.
        </p>
      </div>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) void submit();
        }}
      >
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="A YouTube Short, TikTok or Reel link" aria-label="Video link" className="sm:flex-1" />
        <div className="flex gap-2">
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger className="min-w-0 flex-1 sm:w-40" aria-label="Lessons for">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={EVERY}>For every page</SelectItem>
              {(workspaces.data ?? []).map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  For {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button type="submit" disabled={busy || !url.trim()}>
            {busy ? <Spinner /> : <Ruler />} Measure
          </Button>
        </div>
      </form>

      {!references.data ? (
        <Skeleton className="h-40 rounded-lg" />
      ) : list.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Film />
            </EmptyMedia>
            <EmptyTitle>No references yet</EmptyTitle>
            <EmptyDescription>Paste a link to a short you’d like your videos to learn from. Its music, if any, is never copied.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="space-y-3">
          {list.map((r) => (
            <ReferenceCard key={r.id} reference={r} own={own.data ?? null} pageName={workspaces.data?.find((w) => w.id === r.workspaceId)?.name ?? null} highlight={r.id === highlight} onShowSuggested={onShowSuggested} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ReferenceCard({ reference: r, own, pageName, highlight, onShowSuggested }: { reference: ReferenceVideo; own: OwnMeasures | null; pageName: string | null; highlight: boolean; onShowSuggested: () => void }) {
  const [open, setOpen] = useState(highlight);
  const m = r.measures;
  const running = r.status === 'queued' || r.status === 'measuring' || r.status === 'drafting';
  const waiting = r.lessons.filter((l) => l.status === 'proposed').length;
  const portrait = m ? m.height >= m.width : true;
  // A steady beat is music; a bed under the voice may be music or ambience.
  const music = !m ? null : m.beat !== null ? 'Music: never copied' : m.background === 'bed' ? 'Maybe music: never copied' : null;

  async function remove() {
    if (await act(() => api(`/references/${r.id}`, { method: 'DELETE' }))) toast(`Deleted the reference${r.lessons.some((l) => l.status === 'active') ? ' (its approved lessons stay)' : ''}`);
  }

  return (
    <li id={`reference-${r.id}`} className={cn('scroll-mt-4 rounded-lg border bg-card p-3', highlight && 'border-brand/60')}>
      <div className="flex gap-3">
        <div className={cn('shrink-0 overflow-hidden rounded-md bg-muted', portrait ? 'h-28 w-16 sm:h-32 sm:w-18' : 'h-16 w-28')}>
          {r.hasFrames && <img src={fileUrl(`/references/${r.id}/first.jpg`)} alt="" className="size-full object-cover" />}
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-start gap-2">
            <PlatformIcon platform={r.platform} className="mt-0.5" />
            <h3 className="line-clamp-2 min-w-0 flex-1 text-sm font-medium">{r.title || r.url}</h3>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="ghost" className="-my-1" aria-label="More">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => openExternal(r.url)}>
                  <ExternalLink /> Open the post
                </DropdownMenuItem>
                {m && !running && (
                  <DropdownMenuItem onClick={() => act(() => api(`/references/${r.id}/redraft`, { body: {} }))}>
                    <RefreshCw /> Read it again{waiting ? ' (new lessons replace the waiting ones)' : ''}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem variant="destructive" onClick={remove}>
                  <Trash2 /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <p className="text-xs text-muted-foreground">{[r.channel, r.views !== null ? `${compact(r.views)} views` : null, m ? clock(m.seconds) : null, pageName ? `for ${pageName}` : 'for every page'].filter(Boolean).join(' · ')}</p>
          {running ? (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin text-brand" /> {r.step || 'Waiting its turn'}
            </p>
          ) : r.status === 'error' ? (
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-xs text-destructive">{r.error}</p>
              <Button size="xs" variant="outline" onClick={() => act(() => api(`/references/${r.id}/retry`, { body: {} }))}>
                <RefreshCw /> Try again
              </Button>
            </div>
          ) : (
            r.read && <p className="line-clamp-3 text-sm text-muted-foreground">{r.read.summary}</p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {music && (
              <Badge variant="outline" className="border-amber-400/40 text-amber-300">
                {music}
              </Badge>
            )}
            {m?.soundsFrom === 'pauses' && <Badge variant="outline">Sounds counted between words only</Badge>}
            {waiting > 0 && (
              <Badge asChild variant="secondary" className="cursor-pointer">
                <button type="button" onClick={onShowSuggested}>
                  <Sparkles /> {waiting} lesson{waiting === 1 ? '' : 's'} to approve
                </button>
              </Badge>
            )}
          </div>
        </div>
      </div>

      {m && (
        <>
          <Numbers m={m} own={own} />
          <Strip reference={r} />
          <Button size="sm" variant="ghost" className="mt-1 -ml-2 text-muted-foreground" onClick={() => setOpen((o) => !o)}>
            {open ? 'Less' : 'More: the beats, the frames, what’s said'}
          </Button>
          {open && <Details reference={r} />}
        </>
      )}
    </li>
  );
}

/** The measured numbers, with my own latest edits' beside them where they're measured the same way. */
function Numbers({ m, own }: { m: NonNullable<ReferenceVideo['measures']>; own: OwnMeasures | null }) {
  const mine = own && own.videos > 0 ? own : null;
  const tiles: [string, string, string | null][] = [
    ['Changes per 10 s', String(m.changesPer10), mine ? `yours ${mine.changesPer10 ?? '–'}` : null],
    ['Longest still', sec(m.longestStill.seconds), mine ? `yours ${sec(mine.longestStill)}` : null],
    ['Sound on changes', pct(m.soundOnChange), mine ? `yours ${pct(mine.soundOnChange)}` : null],
    ['First word', sec(m.firstWordAt), mine ? `yours ${sec(mine.firstWordAt)}` : null],
    ['Cuts a second', String(m.cutsPerSecond), null],
    ['Sounds per 10 s', m.soundsFrom === 'none' ? '–' : String(m.soundsPer10), null],
    ['Moving', pct(m.moving), null],
    ['Words a second', m.wordsPerSecond === null ? '–' : String(m.wordsPerSecond), null],
  ];
  return (
    <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
      {tiles.map(([label, value, yours]) => (
        <div key={label} className="rounded-md border px-2.5 py-2">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-base font-semibold tabular-nums">{value}</p>
          {yours && <p className="text-xs text-muted-foreground tabular-nums">{yours}</p>}
        </div>
      ))}
    </div>
  );
}

/** The video as a strip: how much moves (the shape), each change (a tick), each sound (a dot), the payoff. */
function Strip({ reference: r }: { reference: ReferenceVideo }) {
  const m = r.measures!;
  const at = (t: number) => `${Math.min(100, Math.max(0, (t / m.seconds) * 100))}%`;
  const n = m.motion.length;
  const shape = n ? `0,40 ${m.motion.map((v, i) => `${((i + 0.5) / n) * 1000},${40 - v * 36}`).join(' ')} 1000,40` : '';
  const payoffAt = r.read?.payoffAt ?? null;
  return (
    <div className="mt-3 space-y-1">
      <div className="relative h-20 overflow-hidden rounded-md border bg-muted/30">
        <svg viewBox="0 0 1000 40" preserveAspectRatio="none" className="absolute inset-x-0 top-0 h-1/2 w-full" aria-hidden>
          <polygon points={shape} className="fill-brand/25 stroke-brand/60" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        </svg>
        {m.changes.map((t) => (
          <span key={`c${t}`} className={cn('absolute top-[44%] h-[22%] w-0.5 -translate-x-1/2 rounded-full', m.cuts.some((c) => Math.abs(c - t) < 0.05) ? 'bg-foreground' : 'bg-brand')} style={{ left: at(t) }} />
        ))}
        {m.sounds.map((t) => (
          <span key={`s${t}`} className="absolute top-[72%] size-1.5 -translate-x-1/2 rounded-full bg-amber-400" style={{ left: at(t) }} />
        ))}
        {payoffAt !== null && (
          <span className="absolute inset-y-0 border-l border-dashed border-emerald-400" style={{ left: at(payoffAt) }}>
            <span className={cn('absolute top-0.5 text-[10px] text-emerald-400', payoffAt > m.seconds * 0.8 ? 'right-1' : 'left-1')}>Payoff</span>
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="h-2 w-3 rounded-sm bg-brand/40" /> Motion
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-0.5 rounded-full bg-brand" /> Change
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2.5 w-0.5 rounded-full bg-foreground" /> Cut
        </span>
        <span className="flex items-center gap-1">
          <span className="size-1.5 rounded-full bg-amber-400" /> Sound
        </span>
        <span className="ml-auto tabular-nums">{clock(m.seconds)}</span>
      </div>
    </div>
  );
}

function Details({ reference: r }: { reference: ReferenceVideo }) {
  const read = r.read;
  const m = r.measures!;
  return (
    <div className="mt-2 space-y-4 border-t pt-3">
      {read && (
        <>
          <section className="space-y-2">
            <h4 className="text-sm font-medium">The hook</h4>
            <div className="grid gap-3 sm:grid-cols-3">
              <Fact label="Seen">{read.hook.picture || '–'}</Fact>
              <Fact label="Said">{read.hook.words || '–'}</Fact>
              <Fact label="On screen">{read.hook.text || '–'}</Fact>
            </div>
            <p className="text-sm text-muted-foreground">{read.hook.why}</p>
            <p className="text-xs text-muted-foreground tabular-nums">
              First 3 s: {m.hook.changes} change{m.hook.changes === 1 ? '' : 's'}
              {m.hook.firstChangeAt !== null ? ` (first at ${m.hook.firstChangeAt} s)` : ''}, {m.hook.sounds} sound{m.hook.sounds === 1 ? '' : 's'}
              {m.firstWords ? ` · “${m.firstWords}”` : ''}
            </p>
          </section>
          <section className="space-y-1">
            <h4 className="text-sm font-medium">Promise → payoff</h4>
            <p className="text-sm">{read.promise || '–'}</p>
            <p className="text-sm text-muted-foreground">{read.payoff ? `Paid ${read.payoffAt !== null ? `at ${read.payoffAt} s` : ''}: ${read.payoff}` : 'Never paid off.'}</p>
          </section>
          {read.beats.length > 0 && (
            <section className="space-y-1.5">
              <h4 className="text-sm font-medium">Beats</h4>
              <ol className="space-y-1">
                {read.beats.map((b, i) => (
                  <li key={i} className="flex gap-3 text-sm">
                    <span className="w-10 shrink-0 text-muted-foreground tabular-nums">{b.at} s</span>
                    <span className="w-24 shrink-0 text-muted-foreground">{BEAT_LABELS[b.kind]}</span>
                    <span className="min-w-0">{b.what}</span>
                  </li>
                ))}
              </ol>
            </section>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <Fact label="Motion">{read.motion}</Fact>
            <Fact label="Sound">{read.sound}</Fact>
          </div>
          {read.cautions.length > 0 && (
            <section className="flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2.5 text-sm">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-400" />
              <ul className="space-y-0.5">
                {read.cautions.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
      {r.hasFrames && (
        <section className="space-y-1.5">
          <h4 className="text-sm font-medium">12 frames across it</h4>
          <img src={fileUrl(`/references/${r.id}/sheet.jpg`)} alt="Twelve frames from the start to the end" className="w-full max-w-xl rounded-md border" loading="lazy" />
        </section>
      )}
      {r.lessons.length > 0 && (
        <section className="space-y-1">
          <h4 className="text-sm font-medium">Lessons drafted</h4>
          <ul className="space-y-0.5 text-sm">
            {r.lessons.map((l) => (
              <li key={l.id} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">{l.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{l.status === 'proposed' ? 'Waiting for you' : l.status === 'active' ? 'Approved' : 'Off'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {r.lines.length > 0 && (
        <section className="space-y-1">
          <h4 className="text-sm font-medium">What’s said</h4>
          <ol className="max-h-60 space-y-0.5 overflow-y-auto text-sm">
            {r.lines.map((l, i) => (
              <li key={i} className="flex gap-3">
                <span className="w-10 shrink-0 text-muted-foreground tabular-nums">{l.at} s</span>
                <span className="min-w-0 text-muted-foreground">{l.text}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-sm">{children}</div>
    </div>
  );
}
