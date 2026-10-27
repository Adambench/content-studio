import { AlertTriangle, Check, Copy, ExternalLink, Radar, Search, Star, Undo2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { FIND_KIND_LABELS, TOOL_KIND_INFO, TOOL_KINDS, type FindStatus, type InstalledTool, type ScoutRun, type ToolFind, type ToolKind } from '@shared/toolbox';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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

/** Everything the videos are made with (and how often each is used), and what the weekly scout found. */
export function ToolboxPage() {
  const toolbox = useToolbox();
  const [tab, setTab] = useState<'finds' | 'installed'>('finds');
  const data = toolbox.data;
  const running = data?.scout?.status === 'running';
  const fresh = data?.finds.filter((f) => f.status === 'new').length ?? 0;

  async function scout() {
    try {
      await api('/toolbox/scout', { body: {} });
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Toolbox"
        description="What the videos are made with, and what the weekly scout found"
        actions={
          <Button size="sm" variant="outline" onClick={scout} disabled={running || !data}>
            {running ? <Spinner /> : <Radar />} {running ? 'Scouting…' : 'Scout now'}
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
                <Finds finds={data.finds} scout={data.scout} nextAt={data.nextScoutAt} />
              </TabsContent>
              <TabsContent value="installed" className="mt-4">
                <Installed items={data.installed} />
              </TabsContent>
            </Tabs>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- finds ----------

const FIND_FILTERS: { value: FindStatus; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'wanted', label: 'Wanted' },
  { value: 'dismissed', label: 'Not for me' },
];

function Finds({ finds, scout, nextAt }: { finds: ToolFind[]; scout: ScoutRun | null; nextAt: number | null }) {
  const [filter, setFilter] = useState<FindStatus>('new');
  const shown = finds.filter((f) => f.status === filter).sort((a, b) => b.score - a.score || b.foundAt - a.foundAt);
  const count = (s: FindStatus) => finds.filter((f) => f.status === s).length;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border px-3 py-2.5 text-sm">
        {!scout ? (
          <p className="text-muted-foreground">The scout looks once a week at new GitHub repos (skills, MCP servers, motion and video tools) and trending Hugging Face models, and Claude says what each would add and its risks. It never installs anything. It runs by itself; <em>Scout now</em> runs it today.</p>
        ) : scout.status === 'running' ? (
          <p className="flex items-center gap-2">
            <Spinner /> Looking at GitHub and Hugging Face (about a minute), then Claude judges what it found…
          </p>
        ) : (
          <div className="space-y-1">
            <p>
              {scout.status === 'failed' ? 'The last run failed' : `Last looked ${timeAgo(scout.finishedAt ?? scout.startedAt)}`}
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
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {FIND_FILTERS.map((f) => (
          <Button key={f.value} size="sm" variant={filter === f.value ? 'secondary' : 'ghost'} onClick={() => setFilter(f.value)}>
            {f.label}
            <span className="text-xs tabular-nums text-muted-foreground">{count(f.value) || ''}</span>
          </Button>
        ))}
      </div>
      {filter === 'wanted' && shown.length > 0 && (
        <p className="text-xs text-muted-foreground">Installing is your call, outside the app: run the command, or ask Claude Code to add what's here (it checks the licence and drops any music advice first).</p>
      )}

      {shown.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Radar />
            </EmptyMedia>
            <EmptyTitle>{filter === 'new' ? 'Nothing new' : filter === 'wanted' ? 'Nothing wanted yet' : 'Nothing set aside'}</EmptyTitle>
            <EmptyDescription>{filter === 'new' ? 'New finds land here after each weekly run.' : filter === 'wanted' ? 'Mark a find “Want it” to keep it here.' : 'Finds you said no to.'}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="space-y-3">
          {shown.map((f) => (
            <FindCard key={f.id} find={f} />
          ))}
        </ul>
      )}
    </div>
  );
}

const scoreTone = (s: number) => (s >= 8 ? 'text-emerald-400' : s >= 6 ? 'text-amber-400' : 'text-muted-foreground');

function FindCard({ find }: { find: ToolFind }) {
  const [busy, setBusy] = useState(false);
  async function set(status: FindStatus) {
    setBusy(true);
    try {
      await api(`/toolbox/finds/${find.id}`, { method: 'PATCH', body: { status } });
      await refresh();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
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
      {find.install && (
        <div className="flex items-center gap-1 rounded-md bg-muted px-2 py-1">
          <code className="min-w-0 flex-1 truncate font-mono text-xs">{find.install}</code>
          <Button size="icon-sm" variant="ghost" aria-label="Copy the command" onClick={() => navigator.clipboard.writeText(find.install).then(() => toast.success('Copied'))}>
            <Copy />
          </Button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {find.status === 'new' ? (
          <>
            <Button size="sm" variant="secondary" onClick={() => set('wanted')} disabled={busy}>
              <Check /> Want it
            </Button>
            <Button size="sm" variant="ghost" onClick={() => set('dismissed')} disabled={busy}>
              <X /> Not for me
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => set('new')} disabled={busy}>
            <Undo2 /> Back to new
          </Button>
        )}
      </div>
    </li>
  );
}

// ---------- installed ----------

/** Rows shown before *Show all* in a long section. */
const SHORT = 8;

function Installed({ items }: { items: InstalledTool[] }) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<ToolKind | 'all'>('all');
  const q = query.trim().toLowerCase();
  const matches = useMemo(
    () => items.filter((t) => (kind === 'all' || t.kind === kind) && (!q || `${t.label ?? ''} ${t.name} ${t.about} ${t.licence ?? ''} ${t.where ?? ''}`.toLowerCase().includes(q))),
    [items, kind, q],
  );
  const missing = items.filter((t) => t.status === 'missing').length;

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
        return rows.length ? <Section key={k} kind={k} rows={rows} open={!!q || kind === k} /> : null;
      })}
      {matches.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Nothing matches.</p>}
    </div>
  );
}

function Section({ kind, rows, open }: { kind: ToolKind; rows: InstalledTool[]; open: boolean }) {
  const [all, setAll] = useState(false);
  // Most used first, then by name; what can't be used now goes last.
  const sorted = [...rows].sort((a, b) => Number(a.status === 'missing') - Number(b.status === 'missing') || (b.uses ?? 0) - (a.uses ?? 0) || (a.label ?? a.name).localeCompare(b.label ?? b.name));
  const shown = all || open ? sorted : sorted.slice(0, SHORT);
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
      <ul className="divide-y rounded-lg border">
        {shown.map((t) => (
          <ToolRow key={`${t.kind}:${t.name}`} tool={t} />
        ))}
      </ul>
      {sorted.length > shown.length && (
        <Button size="sm" variant="ghost" onClick={() => setAll(true)}>
          Show all {sorted.length}
        </Button>
      )}
    </section>
  );
}

function ToolRow({ tool }: { tool: InstalledTool }) {
  return (
    <li className={cn('flex items-start gap-3 px-3 py-2', tool.status !== 'ready' && 'text-muted-foreground')}>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className={cn('text-sm font-medium', tool.status === 'ready' && 'text-foreground')}>{tool.label ?? tool.name}</span>
          {tool.version && <span className="max-w-40 truncate font-mono text-xs text-muted-foreground">{tool.version}</span>}
          {tool.status === 'missing' && <Badge variant="outline" className="border-amber-400/40 text-amber-400">Not set up</Badge>}
          {tool.status === 'off' && <Badge variant="outline">{tool.kind === 'skill' ? 'Not in the chat' : 'Not used'}</Badge>}
          {tool.licence && <span className="text-xs text-muted-foreground">{tool.licence}</span>}
        </div>
        {tool.about && <p className="line-clamp-2 text-xs text-muted-foreground">{tool.about}</p>}
        {(tool.note || tool.where) && <p className="truncate text-xs text-muted-foreground/80">{[tool.note, tool.status === 'ready' ? tool.where : ''].filter(Boolean).join(' · ')}</p>}
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
