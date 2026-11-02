import { Check, CircleAlert, ExternalLink, Film, Loader2, MoreHorizontal, Pencil, Plus, RefreshCw, Sparkles, StickyNote, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ASPECT_LABELS, type Ingredient, type IngredientMark, type PageStyle, type ReferenceVideo } from '@shared/references';
import { Markdown } from '@/components/Markdown';
import { PlatformIcon } from '@/components/publish/common';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { api, errorMessage, fileUrl } from '@/lib/api';
import { clock, compact, timeAgo } from '@/lib/format';
import { openExternal } from '@/lib/native';
import { keys, queryClient, useReferences, useStyle, useWorkspaces } from '@/lib/queries';
import type { Workspace } from '@/lib/types';
import { cn } from '@/lib/utils';

const EVERY = 'every';
const refresh = () => Promise.all([queryClient.invalidateQueries({ queryKey: keys.references }), queryClient.invalidateQueries({ queryKey: ['style'] })]);

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

/** A change to one reference, shown at once and saved. */
async function patchReference(id: string, body: { note?: string; workspaceId?: string | null; ingredients?: { id: string; mark?: IngredientMark; note?: string }[] }) {
  queryClient.setQueryData<ReferenceVideo[]>(keys.references, (list) =>
    list?.map((r) => {
      if (r.id !== id) return r;
      const changes = new Map((body.ingredients ?? []).map((g) => [g.id, g]));
      return {
        ...r,
        ...(body.note !== undefined && { note: body.note }),
        ...(body.workspaceId !== undefined && { workspaceId: body.workspaceId }),
        ingredients: r.ingredients.map((g) => ({ ...g, ...changes.get(g.id) })),
      };
    }),
  );
  await act(() => api(`/references/${id}`, { method: 'PATCH', body }));
}

/**
 * Inspiration: the videos that moved me, for each page. Each is read for how it's built and why it works, as
 * ingredients I mark *want* or *not for me*; the page's style is written from those marks and every prompt for the
 * page follows it.
 */
export function Inspiration() {
  const workspaces = useWorkspaces();
  const references = useReferences();
  const pages = workspaces.data ?? [];
  const all = references.data ?? [];
  const [pick, setPick] = useState<string | null>(null);
  const countFor = (wid: string) => all.filter((r) => r.workspaceId === wid).length;
  // Opens on the page with the most references.
  const wid = pick ?? [...pages].sort((a, b) => countFor(b.id) - countFor(a.id))[0]?.id ?? null;
  const page = pages.find((w) => w.id === wid) ?? null;
  const list = all.filter((r) => r.workspaceId === wid || r.workspaceId === null);

  if (!workspaces.data || !references.data) return <Skeleton className="h-60 rounded-lg" />;
  if (!page) return null;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1.5" aria-label="Page">
        {pages.map((w) => (
          <Button key={w.id} size="sm" variant={w.id === wid ? 'secondary' : 'ghost'} className={cn(w.id !== wid && 'text-muted-foreground')} onClick={() => setPick(w.id)}>
            {w.name}
            {countFor(w.id) > 0 && <span className="text-xs tabular-nums text-muted-foreground">{countFor(w.id)}</span>}
          </Button>
        ))}
      </div>

      <StyleCard page={page} references={list} />
      <AddVideo page={page} />

      {list.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Film />
            </EmptyMedia>
            <EmptyTitle>No videos for {page.name} yet</EmptyTitle>
            <EmptyDescription>Paste a video that moved you. It’s read for how it’s built: the idea, the story, the visuals and their quality, the voice, the pace, the feel. Then you keep what you want from it.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="space-y-4">
          {list.map((r) => (
            <ReferenceCard key={r.id} reference={r} pages={pages} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** The page's style, written from what I marked; I can write it again or change its words. */
function StyleCard({ page, references }: { page: Workspace; references: ReferenceVideo[] }) {
  const style = useStyle(page.id);
  const s: PageStyle | undefined = style.data;
  const [editing, setEditing] = useState(false);
  const [full, setFull] = useState(false);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const read = references.filter((r) => r.status === 'done' && r.ingredients.length);
  const marked = read.reduce((n, r) => n + r.ingredients.filter((g) => g.mark).length, 0);
  const building = s?.status === 'building';

  async function build() {
    setBusy(true);
    await act(() => api(`/styles/${page.id}/build`, { body: {} }));
    setBusy(false);
  }
  async function save() {
    setBusy(true);
    const ok = await act(() => api(`/styles/${page.id}`, { method: 'PUT', body: { body } }));
    setBusy(false);
    if (ok) setEditing(false);
  }

  const status = !s
    ? ''
    : s.body
      ? [`Written from ${s.references} video${s.references === 1 ? '' : 's'}${s.builtAt ? ` ${timeAgo(s.builtAt)}` : ''}`, s.edited && 'changed by you', s.stale && 'your marks changed since'].filter(Boolean).join(' · ')
      : read.length
        ? `${marked ? `${marked} marked so far. ` : ''}Mark what you want on the videos below, then write it.`
        : 'Add a video that moved you: the style is written from what you mark on it.';

  return (
    <section className="space-y-3 rounded-lg border border-brand/30 bg-brand-soft p-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-1.5 text-sm font-medium">
            <Sparkles className="size-4 text-brand" /> {page.name}’s style
          </h2>
          <p className="text-xs text-muted-foreground">{building ? 'Writing it from your marks…' : status}</p>
        </div>
        {!editing && (
          <div className="flex gap-2">
            {s?.body && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setBody(s.body);
                  setEditing(true);
                }}
              >
                <Pencil /> Edit
              </Button>
            )}
            <Button size="sm" variant={s?.body && !s.stale ? 'outline' : 'default'} onClick={build} disabled={busy || building || !read.length}>
              {building ? <Spinner /> : <Sparkles />} {s?.body ? 'Write it again' : 'Write it from my marks'}
            </Button>
          </div>
        )}
      </div>
      {s?.status === 'error' && <p className="text-xs text-destructive">{s.error}</p>}
      {editing ? (
        <div className="space-y-2">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} className="min-h-72 font-mono text-xs" aria-label="The style" />
          <div className="flex gap-2">
            <Button size="sm" onClick={save} disabled={busy}>
              <Check /> Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        s?.body && (
          <>
            <div className={cn(!full && 'max-h-64 overflow-hidden [mask-image:linear-gradient(to_bottom,black_65%,transparent)]')}>
              <Markdown className="text-sm">{s.body}</Markdown>
            </div>
            <Button size="sm" variant="ghost" className="-ml-2 text-muted-foreground" onClick={() => setFull((v) => !v)}>
              {full ? 'Less' : 'Show the whole style'}
            </Button>
          </>
        )
      )}
    </section>
  );
}

function AddVideo({ page }: { page: Workspace }) {
  const [url, setUrl] = useState('');
  const [scope, setScope] = useState<string>('page');
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    const r = await act(() => api<ReferenceVideo>('/references', { body: { url, workspaceId: scope === EVERY ? null : page.id } }));
    setBusy(false);
    if (!r) return;
    setUrl('');
    toast(r.status === 'done' ? 'It’s already here' : 'Reading it: a few minutes');
  }
  return (
    <form
      className="flex flex-col gap-2 sm:flex-row"
      onSubmit={(e) => {
        e.preventDefault();
        if (url.trim()) void submit();
      }}
    >
      <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="A video that moved you: Reel, TikTok or YouTube link" aria-label="Video link" className="sm:flex-1" />
      <div className="flex gap-2">
        <Select value={scope} onValueChange={setScope}>
          <SelectTrigger className="min-w-0 flex-1 sm:w-44" aria-label="For">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="page">For {page.name}</SelectItem>
            <SelectItem value={EVERY}>For every page</SelectItem>
          </SelectContent>
        </Select>
        <Button type="submit" disabled={busy || !url.trim()}>
          {busy ? <Spinner /> : <Plus />} Add
        </Button>
      </div>
    </form>
  );
}

function ReferenceCard({ reference: r, pages }: { reference: ReferenceVideo; pages: Workspace[] }) {
  const [more, setMore] = useState(false);
  const m = r.measures;
  const running = r.status === 'queued' || r.status === 'measuring' || r.status === 'drafting';
  const portrait = m ? m.height >= m.width : true;
  const pageName = pages.find((w) => w.id === r.workspaceId)?.name ?? null;
  const wanted = r.ingredients.filter((g) => g.mark === 'want').length;
  const skipped = r.ingredients.filter((g) => g.mark === 'skip').length;
  const open = r.ingredients.length - wanted - skipped;

  async function remove() {
    if (await act(() => api(`/references/${r.id}`, { method: 'DELETE' }))) toast('Deleted');
  }

  return (
    <li id={`reference-${r.id}`} className="scroll-mt-4 space-y-3 rounded-lg border bg-card p-3 sm:p-4">
      <div className="flex gap-3">
        <button type="button" onClick={() => openExternal(r.url)} className={cn('shrink-0 overflow-hidden rounded-md bg-muted', portrait ? 'h-32 w-18 sm:h-40 sm:w-22' : 'h-18 w-32')} aria-label="Open the post">
          {r.hasFrames && <img src={fileUrl(`/references/${r.id}/first.jpg`)} alt="" className="size-full object-cover" />}
        </button>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex items-start gap-2">
            <PlatformIcon platform={r.platform} className="mt-0.5" />
            <h3 className="line-clamp-2 min-w-0 flex-1 text-sm font-medium">{r.channel ? `@${r.channel}` : r.title || r.url}</h3>
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
                    <RefreshCw /> Read it again (your marks stay)
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Inspiration for</DropdownMenuLabel>
                {pages.map((w) => (
                  <DropdownMenuItem key={w.id} disabled={r.workspaceId === w.id} onClick={() => patchReference(r.id, { workspaceId: w.id })}>
                    {r.workspaceId === w.id && <Check />} {w.name}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem disabled={r.workspaceId === null} onClick={() => patchReference(r.id, { workspaceId: null })}>
                  {r.workspaceId === null && <Check />} Every page
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={remove}>
                  <Trash2 /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <p className="text-xs text-muted-foreground">{[r.views !== null ? `${compact(r.views)} views` : null, m ? clock(m.seconds) : null, pageName ? `for ${pageName}` : 'for every page'].filter(Boolean).join(' · ')}</p>
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
          ) : r.read ? (
            <>
              <p className="text-sm">{r.read.why}</p>
              <p className="text-xs text-muted-foreground">{r.read.summary}</p>
            </>
          ) : (
            m && (
              <Button size="xs" variant="outline" onClick={() => act(() => api(`/references/${r.id}/redraft`, { body: {} }))}>
                <RefreshCw /> Read it for its ingredients
              </Button>
            )
          )}
        </div>
      </div>

      <NoteField value={r.note} onSave={(note) => patchReference(r.id, { note })} />

      {r.ingredients.length > 0 && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h4 className="text-sm font-medium">What it’s made of</h4>
            <p className="text-xs text-muted-foreground">{[wanted && `${wanted} wanted`, skipped && `${skipped} not for me`, open && `${open} to mark`].filter(Boolean).join(' · ')}</p>
          </div>
          <ul className="divide-y rounded-md border">
            {r.ingredients.map((g) => (
              <IngredientRow key={g.id} ingredient={g} onChange={(c) => patchReference(r.id, { ingredients: [{ id: g.id, ...c }] })} />
            ))}
          </ul>
        </section>
      )}

      {r.read && r.read.shape.length > 0 && (
        <section className="space-y-1.5">
          <h4 className="text-sm font-medium">How it’s built</h4>
          <ol className="space-y-1">
            {r.read.shape.map((x, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="w-10 shrink-0 text-muted-foreground tabular-nums">{clock(x.at)}</span>
                <span className="min-w-0">{x.what}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {r.read && r.read.cautions.length > 0 && (
        <section className="flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2.5 text-sm">
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-400" />
          <ul className="space-y-0.5">
            {r.read.cautions.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </section>
      )}

      {m && (
        <>
          <Button size="sm" variant="ghost" className="-ml-2 text-muted-foreground" onClick={() => setMore((o) => !o)}>
            {more ? 'Less' : 'More: the numbers, the frames, what’s said'}
          </Button>
          {more && <Details reference={r} />}
        </>
      )}
    </li>
  );
}

/** What moved me, in my words: the strongest signal for the page's style. */
function NoteField({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <Textarea
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text.trim() !== value.trim() && onSave(text.trim())}
      placeholder="What moved you? (the style weighs this most)"
      aria-label="What moved you"
      className="min-h-0 text-sm"
      rows={2}
    />
  );
}

/** One ingredient: what it is, how this video does it, and my mark. */
function IngredientRow({ ingredient: g, onChange }: { ingredient: Ingredient; onChange: (c: { mark?: IngredientMark; note?: string }) => void }) {
  const [noting, setNoting] = useState(false);
  const [note, setNote] = useState(g.note);
  useEffect(() => setNote(g.note), [g.note]);
  const set = (mark: IngredientMark) => onChange({ mark: g.mark === mark ? null : mark });
  return (
    <li className={cn('flex flex-col gap-2 p-2.5 sm:flex-row sm:items-start sm:gap-3', g.mark === 'want' && 'bg-emerald-500/5', g.mark === 'skip' && 'opacity-60')}>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Badge variant="outline" className="text-[11px] font-normal">
            {ASPECT_LABELS[g.aspect]}
          </Badge>
          <span className={cn('text-sm font-medium', g.mark === 'skip' && 'line-through')}>{g.name}</span>
          {g.at !== null && <span className="text-xs text-muted-foreground tabular-nums">{clock(g.at)}</span>}
        </div>
        <p className="text-sm text-muted-foreground">{g.what}</p>
        {g.why && <p className="text-xs text-muted-foreground">{g.why}</p>}
        {noting ? (
          <Input
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => {
              setNoting(false);
              if (note.trim() !== g.note) onChange({ note: note.trim() });
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
            placeholder="Your note: what to keep, what to change"
            className="mt-1 h-8 text-sm"
            aria-label="Your note"
          />
        ) : (
          g.note && (
            <button type="button" className="mt-0.5 flex items-center gap-1 text-left text-xs text-brand hover:underline" onClick={() => setNoting(true)}>
              <StickyNote className="size-3.5 shrink-0" /> {g.note}
            </button>
          )
        )}
      </div>
      <div className="flex shrink-0 gap-1.5">
        <Button
          size="sm"
          variant={g.mark === 'want' ? 'default' : 'outline'}
          aria-pressed={g.mark === 'want'}
          className={cn(g.mark === 'want' && 'bg-emerald-600 text-white hover:bg-emerald-600/90 dark:bg-emerald-600 dark:hover:bg-emerald-600/90')}
          onClick={() => set('want')}
        >
          <Check /> Want
        </Button>
        <Button size="sm" variant={g.mark === 'skip' ? 'secondary' : 'outline'} aria-pressed={g.mark === 'skip'} onClick={() => set('skip')}>
          <X /> Not for me
        </Button>
        {!noting && !g.note && (
          <Button size="icon-sm" variant="ghost" aria-label="Add a note" title="Add a note" onClick={() => setNoting(true)}>
            <StickyNote />
          </Button>
        )}
      </div>
    </li>
  );
}

const pct = (n: number | null | undefined) => (n === null || n === undefined ? '–' : `${Math.round(n * 100)} %`);
const sec = (n: number | null | undefined) => (n === null || n === undefined ? '–' : `${n} s`);

/** The measured numbers, the frames and what's said: there when I want them, out of the way otherwise. */
function Details({ reference: r }: { reference: ReferenceVideo }) {
  const m = r.measures!;
  const tiles: [string, string][] = [
    ['Changes per 10 s', String(m.changesPer10)],
    ['Longest still', sec(m.longestStill.seconds)],
    ['Cuts a second', String(m.cutsPerSecond)],
    ['Moving', pct(m.moving)],
    ['Words a second', m.wordsPerSecond === null ? '–' : String(m.wordsPerSecond)],
    ['First word', sec(m.firstWordAt)],
    ['Sounds per 10 s', m.soundsFrom === 'none' ? '–' : String(m.soundsPer10)],
    ['Sound on changes', pct(m.soundOnChange)],
  ];
  return (
    <div className="space-y-4 border-t pt-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map(([label, value]) => (
          <div key={label} className="rounded-md border px-2.5 py-2">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className="text-base font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>
      <Strip reference={r} />
      {r.hasFrames && (
        <section className="space-y-1.5">
          <h4 className="text-sm font-medium">12 frames across it</h4>
          <img src={fileUrl(`/references/${r.id}/sheet.jpg`)} alt="Twelve frames from the start to the end" className="w-full max-w-xl rounded-md border" loading="lazy" />
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

/** The video as a strip: how much moves (the shape), each change (a tick), each sound (a dot). */
function Strip({ reference: r }: { reference: ReferenceVideo }) {
  const m = r.measures!;
  const at = (t: number) => `${Math.min(100, Math.max(0, (t / m.seconds) * 100))}%`;
  const n = m.motion.length;
  const shape = n ? `0,40 ${m.motion.map((v, i) => `${((i + 0.5) / n) * 1000},${40 - v * 36}`).join(' ')} 1000,40` : '';
  return (
    <div className="space-y-1">
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
