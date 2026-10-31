import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Check, Clock, Download, ExternalLink, FastForward, Plus, Radar, Search, Square, Star, Trash2, Undo2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  FIND_KIND_LABELS,
  INSTALL_PLACES,
  parseRepo,
  SKILL_HOME_INFO,
  TOOL_KIND_INFO,
  TOOL_KINDS,
  type FindFilter,
  type FindStatus,
  type InstalledTool,
  type InstallPlace,
  type InstallPreview,
  type InstallRun,
  type ScoutRun,
  type SkillHome,
  type ToolFind,
  type ToolKind,
} from '@shared/toolbox';
import { PageHeader } from '@/components/PageHeader';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, errorMessage } from '@/lib/api';
import { compact, shortAgo, shortWhen, timeAgo } from '@/lib/format';
import { openExternal } from '@/lib/native';
import { keys, queryClient, useToolbox } from '@/lib/queries';
import { cn } from '@/lib/utils';

const refresh = () => queryClient.invalidateQueries({ queryKey: keys.toolbox });

async function call(path: string, opts: Parameters<typeof api>[1] = { body: {} }) {
  try {
    await api(path, opts);
    await refresh();
    return true;
  } catch (err) {
    toast.error(errorMessage(err));
    return false;
  }
}

/** Everything the videos are made with (and how often each is used), and what the weekly scout found. */
export function ToolboxPage() {
  const toolbox = useToolbox();
  const [tab, setTab] = useState<'finds' | 'installed'>('finds');
  // The repo the install dialog is open for ('' = ask for one).
  const [installing, setInstalling] = useState<string | null>(null);
  const data = toolbox.data;
  const waiting = data?.scout?.status === 'waiting';
  const busy = waiting || data?.scout?.status === 'running';
  const fresh = data?.finds.filter((f) => filterOf(f) === 'new').length ?? 0;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Toolbox"
        description="What the videos are made with, and what the weekly scout found"
        actions={
          <Button size="sm" variant="outline" onClick={() => call('/toolbox/scout')} disabled={busy || !data}>
            {waiting ? <Clock /> : busy ? <Spinner /> : <Radar />} {waiting ? 'Waiting…' : busy ? 'Scouting…' : 'Scout now'}
          </Button>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-4xl p-4 md:p-6">
          {!data ? (
            <div className="space-y-3">
              <Skeleton className="h-9 w-56" />
              <Skeleton className="h-24" />
              <Skeleton className="h-24" />
            </div>
          ) : (
            <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
              <TabsList>
                <TabsTrigger value="finds">
                  Finds{fresh ? <Badge className="ml-1 h-4 px-1.5 text-[10px] tabular-nums">{fresh}</Badge> : null}
                </TabsTrigger>
                <TabsTrigger value="installed">Installed</TabsTrigger>
              </TabsList>
              <TabsContent value="finds" className="mt-4">
                <Finds finds={data.finds} scout={data.scout} nextAt={data.nextScoutAt} onInstall={setInstalling} />
              </TabsContent>
              <TabsContent value="installed" className="mt-4">
                <Installed items={data.installed} onInstall={() => setInstalling('')} />
              </TabsContent>
            </Tabs>
          )}
        </div>
      </div>
      <InstallDialog repo={installing} installs={data?.installs ?? []} onClose={() => setInstalling(null)} />
    </div>
  );
}

// ---------- the scout ----------

function ScoutStatus({ scout, nextAt }: { scout: ScoutRun | null; nextAt: number | null }) {
  if (!scout)
    return (
      <p className="text-muted-foreground">
        The scout looks once a week at new GitHub repos (skills, MCP servers, motion and video tools) and trending Hugging Face models, and Claude says what each would add and its risks. It never installs anything. It runs by itself; <em>Scout now</em> runs it
        today.
      </p>
    );
  if (scout.status === 'waiting' || scout.status === 'running') {
    const waiting = scout.status === 'waiting';
    return (
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1 space-y-0.5">
          <p className="flex items-center gap-2">
            {waiting ? <Clock className="size-4 shrink-0 text-amber-400" /> : <Spinner />}
            <span>{scout.step ?? (waiting ? 'Waiting for Claude’s usage to come down' : 'Scouting')}</span>
          </p>
          <p className="text-xs text-muted-foreground">
            {waiting
              ? 'It starts by itself then. Run now starts it anyway; Stop drops this run.'
              : scout.judging
                ? 'Almost done: the finds land below.'
                : `${scout.looked ? `${scout.looked} found so far. ` : ''}Finish now stops searching and has Claude judge what it has.`}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {!scout.judging && (
            <Button size="sm" variant="secondary" onClick={() => call('/toolbox/scout/finish')}>
              <FastForward /> {waiting ? 'Run now' : 'Finish now'}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => call('/toolbox/scout/stop')}>
            <Square /> Stop
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <p>
        {scout.status === 'failed' ? 'The last run failed' : scout.status === 'stopped' ? `Stopped ${timeAgo(scout.finishedAt ?? scout.startedAt)}` : `Last looked ${timeAgo(scout.finishedAt ?? scout.startedAt)}`}
        {scout.status === 'done' && (
          <span className="text-muted-foreground">
            {' '}
            · {scout.looked} new to judge, {scout.found} worth a look
          </span>
        )}
        {nextAt && <span className="text-muted-foreground"> · next {nextAt <= Date.now() ? 'soon' : shortWhen(nextAt)}</span>}
      </p>
      {scout.error && <p className="text-xs text-muted-foreground">{scout.error}</p>}
    </div>
  );
}

// ---------- finds ----------

const FIND_FILTERS: { value: FindFilter; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'wanted', label: 'Wanted' },
  { value: 'installed', label: 'Installed' },
  { value: 'dismissed', label: 'Not for me' },
];

const filterOf = (f: ToolFind): FindFilter => (f.installed.length ? 'installed' : f.status);
const homesOf = (f: ToolFind) => [...new Set(f.installed.map((i) => i.home))];

function Finds({ finds, scout, nextAt, onInstall }: { finds: ToolFind[]; scout: ScoutRun | null; nextAt: number | null; onInstall: (repo: string) => void }) {
  const [filter, setFilter] = useState<FindFilter>('new');
  const shown = finds.filter((f) => filterOf(f) === filter).sort((a, b) => b.score - a.score || b.foundAt - a.foundAt);
  const count = (s: FindFilter) => finds.filter((f) => filterOf(f) === s).length;
  const empty: Record<FindFilter, [string, string]> = {
    new: ['Nothing new', 'New finds land here after each weekly run.'],
    wanted: ['Nothing wanted yet', 'Mark a find “Want it” to keep it here.'],
    installed: ['Nothing installed yet', 'Skills you install from a find show here.'],
    dismissed: ['Nothing set aside', 'Finds you said no to.'],
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border px-3 py-2.5 text-sm">
        <ScoutStatus scout={scout} nextAt={nextAt} />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {FIND_FILTERS.map((f) => (
          <Button key={f.value} size="sm" variant={filter === f.value ? 'secondary' : 'ghost'} onClick={() => setFilter(f.value)}>
            {f.label}
            <span className="text-xs tabular-nums text-muted-foreground">{count(f.value) || ''}</span>
          </Button>
        ))}
      </div>

      {shown.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Radar />
            </EmptyMedia>
            <EmptyTitle>{empty[filter][0]}</EmptyTitle>
            <EmptyDescription>{empty[filter][1]}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="space-y-3">
          {shown.map((f) => (
            <FindCard key={f.id} find={f} onInstall={() => onInstall(f.name)} />
          ))}
        </ul>
      )}
    </div>
  );
}

const scoreTone = (s: number) => (s >= 8 ? 'text-emerald-400' : s >= 6 ? 'text-amber-400' : 'text-muted-foreground');

function FindCard({ find, onInstall }: { find: ToolFind; onInstall: () => void }) {
  const [busy, setBusy] = useState(false);
  const homes = homesOf(find);
  async function set(status: FindStatus) {
    setBusy(true);
    await call(`/toolbox/finds/${find.id}`, { method: 'PATCH', body: { status } });
    setBusy(false);
  }
  return (
    <li className="space-y-2 rounded-lg border p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <button type="button" onClick={() => openExternal(find.url)} className="group flex max-w-full items-center gap-1.5 text-left text-sm font-medium">
            <span className="truncate group-hover:underline">{find.name}</span>
            <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <Badge variant="outline">{FIND_KIND_LABELS[find.kind]}</Badge>
            <span>{!find.licence || find.licence === 'NOASSERTION' ? 'unclear licence' : find.licence}</span>
            <span className="flex items-center gap-0.5 tabular-nums">
              <Star className="size-3" /> {compact(find.stars)}
            </span>
            {find.updatedAt && <span>updated {shortAgo(find.updatedAt)}</span>}
          </div>
        </div>
        <span className={cn('text-lg font-semibold tabular-nums', scoreTone(find.score))} aria-label={`${find.score} out of 10`}>
          {find.score}
          <span className="text-xs font-normal text-muted-foreground">/10</span>
        </span>
      </div>
      {find.adds && <p className="text-sm">{find.adds}</p>}
      {find.description && <p className="line-clamp-2 text-xs text-muted-foreground">{find.description}</p>}
      {find.risks.length > 0 && (
        <ul className="space-y-0.5 text-xs text-amber-400">
          {find.risks.map((r) => (
            <li key={r} className="flex gap-1.5">
              <AlertTriangle className="mt-0.5 size-3 shrink-0" /> {r}
            </li>
          ))}
        </ul>
      )}
      {homes.length > 0 && (
        <p className="flex gap-1.5 text-xs text-emerald-400">
          <Check className="mt-px size-3.5 shrink-0" />
          <span>
            Installed in {homes.map((h) => SKILL_HOME_INFO[h].label).join(' and ')}: {[...new Set(find.installed.map((i) => i.skill))].join(', ')}
          </span>
        </p>
      )}
      {find.kind !== 'skill' && find.status === 'wanted' && <p className="text-xs text-muted-foreground">Not a skill: using it takes a change to the app. Ask Claude Code to add it (it checks the licence and drops any music first).</p>}
      <div className="flex flex-wrap gap-2">
        {find.kind === 'skill' && (
          <Button size="sm" variant={homes.length ? 'ghost' : 'default'} onClick={onInstall}>
            <Download /> {homes.length ? 'Install more or update' : 'Install'}
          </Button>
        )}
        {find.status === 'new' ? (
          <>
            {!homes.length && (
              <Button size="sm" variant="secondary" onClick={() => set('wanted')} disabled={busy}>
                <Check /> Want it
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => set('dismissed')} disabled={busy}>
              <X /> Not for me
            </Button>
          </>
        ) : (
          !homes.length && (
            <Button size="sm" variant="ghost" onClick={() => set('new')} disabled={busy}>
              <Undo2 /> Back to new
            </Button>
          )
        )}
      </div>
    </li>
  );
}

// ---------- installing ----------

const size = (b: number) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);

/** Pick a repo's skills and where they go, then watch them install. `repo` '' asks for a link first; null = closed. */
function InstallDialog({ repo: given, installs, onClose }: { repo: string | null; installs: InstallRun[]; onClose: () => void }) {
  const [typed, setTyped] = useState('');
  const [repo, setRepo] = useState<string | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [places, setPlaces] = useState<Set<InstallPlace>>(new Set());
  const open = given !== null;

  useEffect(() => {
    if (!open) return;
    setRepo(given || null);
    setTyped('');
    setRunId(null);
  }, [open, given]);

  // Not under keys.toolbox: live updates would read GitHub again on every install step.
  const preview = useQuery({
    queryKey: ['toolbox-preview', repo],
    queryFn: () => api<InstallPreview>(`/toolbox/skills/preview?repo=${encodeURIComponent(repo!)}`),
    enabled: open && !!repo,
    staleTime: 5 * 60_000,
    retry: false,
  });
  const skills = preview.data?.skills;

  // What's not installed anywhere yet is ticked; where it goes follows what the ticked skills are.
  useEffect(() => {
    if (!skills) return;
    const fresh = skills.filter((s) => !s.homes.length);
    setPicked(new Set(fresh.map((s) => s.name)));
    setPlaces(suggestPlaces(fresh.length ? fresh : skills));
  }, [skills]);

  const run = installs.find((r) => r.id === runId);
  const chosen = skills?.filter((s) => picked.has(s.name)) ?? [];
  const suggested = suggestPlaces(chosen.length ? chosen : (skills ?? []));

  async function install() {
    if (!repo) return;
    try {
      const started = await api<InstallRun>('/toolbox/skills/install', { body: { repo, skills: [...picked], places: INSTALL_PLACES.filter((p) => places.has(p)) } });
      setRunId(started.id);
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  const toggle = <T,>(set: Set<T>, value: T, on: boolean) => {
    const next = new Set(set);
    if (on) next.add(value);
    else next.delete(value);
    return next;
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{repo ? `Install from ${repo}` : 'Install a skill'}</DialogTitle>
          <DialogDescription>Straight from GitHub, in a few seconds. Sound and video files are left out (they could hold music), and any music advice in a skill never applies.</DialogDescription>
        </DialogHeader>

        {!repo ? (
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const r = parseRepo(typed);
              if (r) setRepo(r);
              else toast.error('Paste a GitHub link, or owner/name.');
            }}
          >
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="github.com/owner/repo" aria-label="GitHub repo" autoFocus />
            <Button type="submit" disabled={!typed.trim()}>
              Look
            </Button>
          </form>
        ) : run ? (
          <InstallProgress run={run} />
        ) : preview.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-5 w-48" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : preview.error ? (
          <p className="text-sm text-destructive">{errorMessage(preview.error)}</p>
        ) : (
          preview.data && (
            <div className="space-y-4 text-sm">
              <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <span>{preview.data.licence && preview.data.licence !== 'NOASSERTION' ? preview.data.licence : 'unclear licence'}</span>
                {preview.data.licenceRisk && (
                  <span className="flex items-center gap-1 text-amber-400">
                    <AlertTriangle className="size-3" /> {preview.data.licenceRisk}
                  </span>
                )}
              </p>

              <section className="space-y-1.5">
                <h3 className="text-xs font-medium text-muted-foreground">Skills</h3>
                <ul className="max-h-64 divide-y overflow-y-auto rounded-lg border">
                  {preview.data.skills.map((s) => {
                    const id = `skill-${s.name}`;
                    return (
                      <li key={s.name} className="flex items-start gap-2.5 px-3 py-2">
                        <Checkbox id={id} checked={picked.has(s.name)} onCheckedChange={(v) => setPicked((p) => toggle(p, s.name, v === true))} className="mt-0.5" />
                        <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer space-y-0.5">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span className="font-medium">{s.name}</span>
                            <span className="text-xs tabular-nums text-muted-foreground">
                              {s.files} {s.files === 1 ? 'file' : 'files'}, {size(s.bytes)}
                              {s.leftOut ? ` (${s.leftOut} left out)` : ''}
                            </span>
                            {s.runsCommands && <Badge variant="outline">Runs commands</Badge>}
                            {s.homes.map((h) => (
                              <Badge key={h} variant="outline" className="border-emerald-400/40 text-emerald-400">
                                {h === 'built-in' ? 'Built in' : `In ${SKILL_HOME_INFO[h].label}`}
                              </Badge>
                            ))}
                          </span>
                          {s.about && <span className="line-clamp-2 block text-xs text-muted-foreground">{s.about}</span>}
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </section>

              <section className="space-y-1.5">
                <h3 className="text-xs font-medium text-muted-foreground">Where</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {INSTALL_PLACES.map((place) => {
                    const id = `place-${place}`;
                    return (
                      <label key={place} htmlFor={id} className={cn('flex cursor-pointer gap-2.5 rounded-lg border p-3', places.has(place) && 'border-primary/60 bg-primary/5')}>
                        <Checkbox id={id} checked={places.has(place)} onCheckedChange={(v) => setPlaces((p) => toggle(p, place, v === true))} className="mt-0.5" />
                        <span className="space-y-1">
                          <span className="flex flex-wrap items-center gap-1.5 font-medium">
                            {SKILL_HOME_INFO[place].label}
                            {suggested.has(place) && <Badge className="h-4 px-1.5 text-[10px]">Recommended</Badge>}
                          </span>
                          <span className="block text-xs text-muted-foreground">{SKILL_HOME_INFO[place].hint}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                {!picked.size && preview.data.skills.every((s) => s.homes.length) && <p className="text-xs text-muted-foreground">All its skills are installed already: tick one to update it, or to put it in the other place too.</p>}
                {chosen.some((s) => s.runsCommands) && <p className="text-xs text-muted-foreground">A skill that runs commands only fully works in Claude Code: in Content Studio, Claude reads its know-how but can’t run its scripts.</p>}
                {chosen.some((s) => s.homes.includes('built-in')) && places.has('app') && <p className="text-xs text-muted-foreground">Built-in skills stay as they are in the app: only Claude Code gets the repo’s copy.</p>}
              </section>
            </div>
          )
        )}

        <DialogFooter>
          {run ? (
            <Button onClick={onClose} disabled={run.status === 'running'}>
              {run.status === 'running' ? <Spinner /> : null} {run.status === 'running' ? 'Installing…' : 'Done'}
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              {repo && preview.data && (
                <Button onClick={install} disabled={!picked.size || !places.size}>
                  <Download /> Install {picked.size ? `${picked.size} ${picked.size === 1 ? 'skill' : 'skills'}` : ''}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Know-how goes in the app; a skill that runs its own commands goes to Claude Code, which can run them. */
function suggestPlaces(skills: { runsCommands: boolean }[]) {
  const out = new Set<InstallPlace>();
  if (!skills.length || skills.some((s) => !s.runsCommands)) out.add('app');
  if (skills.some((s) => s.runsCommands)) out.add('claude-code');
  return out;
}

function InstallProgress({ run }: { run: InstallRun }) {
  const pct = run.total ? Math.round((run.done / run.total) * 100) : run.status === 'running' ? 5 : 100;
  return (
    <div className="space-y-3 text-sm">
      <p className="flex items-center gap-2">
        {run.status === 'running' ? <Spinner /> : run.status === 'done' ? <Check className="size-4 text-emerald-400" /> : <X className="size-4 text-destructive" />}
        {run.status === 'failed' ? 'It didn’t install' : run.step}
      </p>
      {run.status !== 'failed' && (
        <div className="space-y-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div className={cn('h-full rounded-full transition-all', run.status === 'done' ? 'bg-emerald-400' : 'bg-primary')} style={{ width: `${pct}%` }} />
          </div>
          {run.total > 0 && (
            <p className="text-xs tabular-nums text-muted-foreground">
              {run.done} of {run.total} files
            </p>
          )}
        </div>
      )}
      {run.error && <p className="text-destructive">{run.error}</p>}
      {run.notes.length > 0 && (
        <ul className="space-y-0.5 text-xs text-muted-foreground">
          {run.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {run.status === 'done' && run.places.includes('app') && <p className="text-xs text-muted-foreground">The chat uses it from your next message.</p>}
      {run.status === 'done' && run.places.includes('claude-code') && <p className="text-xs text-muted-foreground">Claude Code picks it up in its next session.</p>}
    </div>
  );
}

// ---------- installed ----------

/** Rows shown before *Show all* in a long section. */
const SHORT = 8;

function Installed({ items, onInstall }: { items: InstalledTool[]; onInstall: () => void }) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<ToolKind | 'all'>('all');
  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () => items.filter((t) => (kind === 'all' || t.kind === kind) && (!q || `${t.label ?? ''} ${t.name} ${t.about} ${t.licence ?? ''} ${t.where ?? ''}`.toLowerCase().includes(q))),
    [items, kind, q],
  );
  const missing = items.filter((t) => t.status === 'missing').length;
  // Skills the app's chat has, so a Claude Code one can be offered to it.
  const inApp = useMemo(() => new Set(items.filter((t) => t.kind === 'skill' && t.home !== 'claude-code').map((t) => t.name)), [items]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search names, licences, what they do" className="pl-8" aria-label="Search" />
        </div>
        <div className="flex gap-1 overflow-x-auto [scrollbar-width:none]">
          {(['all', ...TOOL_KINDS] as const).map((k) => (
            <Button key={k} size="sm" variant={kind === k ? 'secondary' : 'ghost'} className="shrink-0" onClick={() => setKind(k)}>
              {k === 'all' ? 'All' : TOOL_KIND_INFO[k].label}
            </Button>
          ))}
        </div>
      </div>
      {missing > 0 && kind === 'all' && !q && <p className="text-xs text-muted-foreground">{missing} not set up on this computer yet: each says how.</p>}
      {TOOL_KINDS.filter((k) => kind === 'all' || k === kind).map((k) => {
        const rows = matches.filter((t) => t.kind === k);
        if (k === 'skill' && !q) return <Skills key={k} rows={rows} open={kind === k} inApp={inApp} onInstall={onInstall} />;
        return rows.length ? <Section key={k} kind={k} rows={rows} open={!!q || kind === k} inApp={inApp} /> : null;
      })}
      {matches.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Nothing matches.</p>}
    </div>
  );
}

const SKILL_GROUPS: { home: SkillHome; title: string; hint: string; none: string }[] = [
  { home: 'app', title: 'Added to Content Studio', hint: 'Installed from here: the app’s chat uses them.', none: 'None yet. Install a skill to give the app’s Claude more know-how.' },
  { home: 'built-in', title: 'Built in', hint: 'Ship with the app (the repo’s .claude/skills).', none: '' },
  { home: 'claude-code', title: 'Claude Code', hint: 'In ~/.claude/skills: Claude Code uses them in a terminal, in every folder. The app doesn’t load them.', none: '' },
];

/** Skills by where they live, so it's plain which ones the app's chat has. */
function Skills({ rows, open, inApp, onInstall }: { rows: InstalledTool[]; open: boolean; inApp: Set<string>; onInstall: () => void }) {
  const used = rows.filter((r) => (r.uses ?? 0) > 0).length;
  return (
    <section className="space-y-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="flex items-baseline gap-2 text-sm font-medium">
            {TOOL_KIND_INFO.skill.label}
            <span className="text-xs font-normal tabular-nums text-muted-foreground">
              {rows.length} · {used} used
            </span>
          </h2>
          <p className="text-xs text-muted-foreground">Know-how Claude reads. Install puts a skill in Content Studio, Claude Code, or both.</p>
        </div>
        <Button size="sm" variant="outline" className="shrink-0" onClick={onInstall}>
          <Download /> Install a skill
        </Button>
      </div>
      {SKILL_GROUPS.map((g) => {
        const group = rows.filter((r) => r.home === g.home);
        if (!group.length && !g.none) return null;
        return (
          <div key={g.home} className="space-y-1.5">
            <h3 className="flex items-baseline gap-2 text-xs font-medium">
              {g.title}
              <span className="font-normal tabular-nums text-muted-foreground">{group.length}</span>
            </h3>
            <p className="text-xs text-muted-foreground">{group.length ? g.hint : g.none}</p>
            {group.length > 0 && <Rows rows={group} open={open || group.length <= SHORT} inApp={inApp} />}
          </div>
        );
      })}
    </section>
  );
}

function Section({ kind, rows, open, inApp }: { kind: ToolKind; rows: InstalledTool[]; open: boolean; inApp: Set<string> }) {
  const counted = rows.some((r) => r.uses !== null);
  const used = rows.filter((r) => (r.uses ?? 0) > 0).length;
  return (
    <section className="space-y-2">
      <div>
        <h2 className="flex items-baseline gap-2 text-sm font-medium">
          {TOOL_KIND_INFO[kind].label}
          <span className="text-xs font-normal tabular-nums text-muted-foreground">
            {rows.length}
            {counted ? ` · ${used} used` : ''}
          </span>
        </h2>
        <p className="text-xs text-muted-foreground">{TOOL_KIND_INFO[kind].hint}</p>
      </div>
      <Rows rows={rows} open={open} inApp={inApp} />
    </section>
  );
}

function Rows({ rows, open, inApp }: { rows: InstalledTool[]; open: boolean; inApp: Set<string> }) {
  const [all, setAll] = useState(false);
  // Most used first, then by name; what can't be used now goes last.
  const sorted = [...rows].sort((a, b) => Number(a.status === 'missing') - Number(b.status === 'missing') || (b.uses ?? 0) - (a.uses ?? 0) || (a.label ?? a.name).localeCompare(b.label ?? b.name));
  const shown = all || open ? sorted : sorted.slice(0, SHORT);
  return (
    <>
      {shown.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {shown.map((t) => (
            <ToolRow key={`${t.kind}:${t.home ?? ''}:${t.name}`} tool={t} inApp={inApp.has(t.name)} />
          ))}
        </ul>
      )}
      {sorted.length > shown.length && (
        <Button size="sm" variant="ghost" onClick={() => setAll(true)}>
          Show all {sorted.length}
        </Button>
      )}
    </>
  );
}

function ToolRow({ tool, inApp }: { tool: InstalledTool; inApp: boolean }) {
  const offBadge = tool.home === 'claude-code' ? 'Not in the app' : tool.kind === 'skill' ? 'Not in the chat' : 'Not used';
  return (
    <li className={cn('flex items-start gap-3 px-3 py-2', tool.status !== 'ready' && 'text-muted-foreground')}>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className={cn('text-sm font-medium', tool.status === 'ready' && 'text-foreground')}>{tool.label ?? tool.name}</span>
          {tool.version && <span className="max-w-40 truncate font-mono text-xs text-muted-foreground">{tool.version}</span>}
          {tool.status === 'missing' && (
            <Badge variant="outline" className="border-amber-400/40 text-amber-400">
              Not set up
            </Badge>
          )}
          {tool.status === 'off' && <Badge variant="outline">{offBadge}</Badge>}
          {tool.licence && <span className="text-xs text-muted-foreground">{tool.licence}</span>}
        </div>
        {tool.about && <p className="line-clamp-2 text-xs text-muted-foreground">{tool.about}</p>}
        {(tool.note || tool.where) && <p className="truncate text-xs text-muted-foreground/80">{[tool.note, tool.status === 'ready' ? tool.where : ''].filter(Boolean).join(' · ')}</p>}
        {tool.home && tool.home !== 'built-in' && <SkillActions tool={tool} inApp={inApp} />}
      </div>
      {tool.uses !== null && (
        <div className="shrink-0 text-right text-xs tabular-nums">
          <p className={tool.uses ? 'text-foreground' : 'text-muted-foreground'}>{tool.uses ? `${compact(tool.uses)}×` : 'unused'}</p>
          {tool.lastUsedAt && <p className="text-muted-foreground">{shortAgo(tool.lastUsedAt)}</p>}
        </div>
      )}
      {tool.source ? (
        <Button size="icon-sm" variant="ghost" className="shrink-0" aria-label={`Open where ${tool.label ?? tool.name} comes from`} onClick={() => openExternal(tool.source!)}>
          <ExternalLink />
        </Button>
      ) : (
        <span className="size-7 shrink-0" aria-hidden />
      )}
    </li>
  );
}

/** An added or Claude Code skill: copy it into the app, or remove it. */
function SkillActions({ tool, inApp }: { tool: InstalledTool; inApp: boolean }) {
  const [busy, setBusy] = useState(false);
  const home = tool.home as Exclude<SkillHome, 'built-in'>;
  async function addToApp() {
    setBusy(true);
    try {
      const { leftOut } = await api<{ leftOut: number }>(`/toolbox/skills/${encodeURIComponent(tool.name)}/add-to-app`, { body: {} });
      toast.success(`${tool.name} is in Content Studio${leftOut ? ` (${leftOut} sound or video files left out)` : ''}`);
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap gap-1 pt-1">
      {home === 'claude-code' && !inApp && (
        <Button size="xs" variant="secondary" onClick={addToApp} disabled={busy}>
          <Plus /> Use in Content Studio too
        </Button>
      )}
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="xs" variant="ghost" disabled={busy}>
            <Trash2 /> Remove
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {tool.name} from {SKILL_HOME_INFO[home].label}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {home === 'app' ? 'The app’s chat stops using it. You can install it again from the Toolbox.' : 'Its folder in ~/.claude/skills is deleted: Claude Code stops using it in every project.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => call(`/toolbox/skills/${home}/${encodeURIComponent(tool.name)}`, { method: 'DELETE' })}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
