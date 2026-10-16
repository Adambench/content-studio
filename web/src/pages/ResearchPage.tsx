import { CircleAlert, Copy, ExternalLink, FileVideo, Lightbulb, Loader2, Microscope, Plus, RefreshCw, Telescope, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import type { ResearchBrief, ResearchItem, ResearchOverview } from '@shared/research';
import { PageHeader } from '@/components/PageHeader';
import { PlatformIcon } from '@/components/publish/common';
import { WatchListCard } from '@/components/research/WatchList';
import { useWorkspaceContext } from '@/components/WorkspaceLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { api, errorMessage } from '@/lib/api';
import { compact, timeAgo } from '@/lib/format';
import { openExternal } from '@/lib/native';
import { keys, queryClient, useResearch } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { FinderPanel } from '@/components/FinderPanel';

const refresh = (wid: string) => queryClient.invalidateQueries({ queryKey: keys.research(wid) });

function ItemIcon({ item, className }: { item: Pick<ResearchItem, 'platform'>; className?: string }) {
  return item.platform === 'file' ? <FileVideo className={cn('size-4 shrink-0 text-muted-foreground', className)} /> : <PlatformIcon platform={item.platform} className={className} />;
}

const times = (score: number | null) => (score === null ? '' : `${score >= 10 ? Math.round(score) : score.toFixed(1)}×`);

async function analyse(wid: string, body: { url: string } | { mediaId: string }) {
  const item = await api<ResearchItem>(`/workspaces/${wid}/research/analyse`, { body });
  refresh(wid);
  return item;
}

function BriefCard({ wid, brief, overview, onOpen }: { wid: string; brief: ResearchBrief; overview: ResearchOverview; onOpen: (id: string) => void }) {
  const b = brief.body!;
  const [adding, setAdding] = useState<number | null>(null);
  const byId = new Map(overview.outliers.map((o) => [o.id, o]));

  async function addIdea(i: number) {
    setAdding(i);
    try {
      await api(`/research/briefs/${brief.id}/ideas/${i}`, { body: {} });
      refresh(wid);
      toast.success('Added to the board');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setAdding(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-start gap-2 leading-snug">
          <Telescope className="mt-0.5 size-4 shrink-0 text-brand" /> {b.headline}
        </CardTitle>
        <CardDescription>
          {new Date(`${brief.day}T12:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' })}
          {brief.sweep && ` · ${brief.sweep}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {b.patterns.length > 0 && (
          <section className="space-y-2" aria-label="What's working">
            <h3 className="text-xs font-medium text-muted-foreground">What’s working</h3>
            <ul className="space-y-3">
              {b.patterns.map((p) => (
                <li key={p.pattern} className="space-y-1">
                  <p className="text-sm font-medium">{p.pattern}</p>
                  <p className="text-sm text-muted-foreground">{p.why}</p>
                  {p.examples.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {p.examples.map((id) => {
                        const o = byId.get(id);
                        if (!o) return null;
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => onOpen(o.id)}
                            className="inline-flex max-w-full items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs text-muted-foreground hover:border-foreground/30 hover:text-foreground"
                          >
                            <ItemIcon item={o} className="size-3" />
                            <span className="truncate">{o.channel}</span>
                            <span className="text-foreground tabular-nums">{times(o.score)}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        {b.topics.length > 0 && (
          <section className="space-y-2" aria-label="Topics">
            <h3 className="text-xs font-medium text-muted-foreground">Topics pulling views</h3>
            <div className="flex flex-wrap gap-1.5">
              {b.topics.map((t) => (
                <Badge key={t} variant="secondary" className="font-normal">
                  {t}
                </Badge>
              ))}
            </div>
          </section>
        )}
        {b.forClips && (
          <section className="space-y-1" aria-label="Moments to look for">
            <h3 className="text-xs font-medium text-muted-foreground">Moments to look for in sources</h3>
            <p className="text-sm">{b.forClips}</p>
          </section>
        )}
        {b.ideas.length > 0 && (
          <section className="space-y-2" aria-label="Ideas">
            <h3 className="text-xs font-medium text-muted-foreground">Ideas for this page</h3>
            <ul className="space-y-2">
              {b.ideas.map((idea, i) => (
                <li key={idea.title} className="flex flex-wrap items-start gap-3 rounded-lg border p-3">
                  <Lightbulb className="mt-0.5 size-4 shrink-0 text-amber-400" />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="text-sm font-medium">{idea.title}</p>
                    <p className="text-sm">“{idea.hook}”</p>
                    <p className="text-xs text-muted-foreground">{idea.why}</p>
                  </div>
                  {idea.pieceId ? (
                    <Button size="sm" variant="ghost" asChild>
                      <Link to={`/w/${wid}/p/${idea.pieceId}`}>Open card</Link>
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" disabled={adding === i} onClick={() => addIdea(i)}>
                      {adding === i ? <Spinner /> : <Plus />} Add to board
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        {b.hooks.length > 0 && (
          <section className="space-y-2" aria-label="Hooks">
            <h3 className="text-xs font-medium text-muted-foreground">Hooks shaped for this page</h3>
            <ul className="space-y-1">
              {b.hooks.map((h) => (
                <li key={h} className="group flex items-start gap-2 text-sm">
                  <span className="min-w-0 flex-1">“{h}”</span>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="-my-1 shrink-0 opacity-60 group-hover:opacity-100"
                    aria-label="Copy hook"
                    onClick={() => navigator.clipboard.writeText(h).then(() => toast.success('Copied'))}
                  >
                    <Copy />
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </CardContent>
    </Card>
  );
}

function OutlierRow({ o, wid, onOpen }: { o: ResearchItem; wid: string; onOpen: () => void }) {
  const [busy, setBusy] = useState(false);
  const analysing = o.analysisStatus === 'queued' || o.analysisStatus === 'running';
  return (
    <li className="flex items-start gap-3 p-3">
      <ItemIcon item={o} className="mt-0.5" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="line-clamp-2 text-sm">{o.title || o.hook || o.url}</p>
        {o.hook && o.title && <p className="line-clamp-2 text-xs text-muted-foreground">Says: “{o.hook}”</p>}
        <p className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
          <span>{o.channel}</span>
          {o.views !== null && <span>{compact(o.views)} views</span>}
          {o.postedAt && <span>{timeAgo(o.postedAt)}</span>}
          {o.keyword && <span>“{o.keyword}”</span>}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-sm font-semibold text-emerald-400 tabular-nums" title={`${o.channelMedian !== null ? compact(o.channelMedian) : '?'} views is usual for the account`}>
          {times(o.score)}
        </span>
        <div className="flex items-center gap-0.5">
          <Button size="icon-sm" variant="ghost" aria-label="Open the post" title="Open the post" onClick={() => openExternal(o.url)}>
            <ExternalLink />
          </Button>
          {o.analysisStatus === 'done' ? (
            <Button size="sm" variant="ghost" onClick={onOpen}>
              <Microscope /> Analysis
            </Button>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || analysing}
              onClick={async () => {
                setBusy(true);
                try {
                  await analyse(wid, { url: o.url });
                  toast('Analysing it: a few minutes');
                } catch (err) {
                  toast.error(errorMessage(err));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy || analysing ? <Spinner /> : <Microscope />} {analysing ? 'Analysing' : 'Analyse'}
            </Button>
          )}
        </div>
      </div>
    </li>
  );
}

function AnalyseCard({ wid, items, onOpen }: { wid: string; items: ResearchItem[]; onOpen: (id: string) => void }) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      const item = await analyse(wid, { url });
      setUrl('');
      if (item.analysisStatus === 'done') onOpen(item.id);
      else toast('Analysing it: a few minutes');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Analyse a video</CardTitle>
        <CardDescription>A Short, TikTok or Reel that did well: its hook, structure and edit, explained, and what this page can borrow. Your own videos have Analyse too.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) void submit();
          }}
        >
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.tiktok.com/@…/video/…" aria-label="Video link" className="h-9" />
          <Button type="submit" disabled={busy || !url.trim()}>
            {busy ? <Spinner /> : <Microscope />} Analyse
          </Button>
        </form>
        {items.length > 0 && (
          <ul className="divide-y rounded-lg border">
            {items.map((a) => (
              <li key={a.id}>
                <button type="button" disabled={a.analysisStatus !== 'done'} onClick={() => onOpen(a.id)} className="flex w-full items-start gap-3 p-3 text-left enabled:hover:bg-muted/40">
                  <ItemIcon item={a} className="mt-0.5" />
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-1 text-sm">{a.title || a.url}</span>
                    <span className={cn('line-clamp-2 text-xs', a.analysisStatus === 'error' ? 'text-destructive' : 'text-muted-foreground')}>
                      {a.analysisStatus === 'done'
                        ? a.analysis?.whyItWorks
                        : a.analysisStatus === 'error'
                          ? a.analysisError
                          : a.analysisError || (a.analysisStatus === 'running' ? 'Analysing…' : 'Waiting its turn')}
                    </span>
                  </span>
                  {(a.analysisStatus === 'queued' || a.analysisStatus === 'running') && <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-brand" />}
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
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

function AnalysisDialog({ item, wid, onClose }: { item: ResearchItem | null; wid: string; onClose: () => void }) {
  const a = item?.analysis;
  return (
    <Dialog open={!!item} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        {item && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-start gap-2 pr-6 leading-snug">
                <ItemIcon item={item} className="mt-0.5" /> <span className="line-clamp-2">{item.title || item.url}</span>
              </DialogTitle>
              <DialogDescription>
                {[item.channel, item.views !== null ? `${compact(item.views)} views` : null, item.score ? `${times(item.score)} usual` : null].filter(Boolean).join(' · ')}
              </DialogDescription>
            </DialogHeader>
            {!a ? (
              <p className="text-sm text-muted-foreground">{item.analysisStatus === 'error' ? item.analysisError : 'Not analysed yet.'}</p>
            ) : (
              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    ['Length', a.metrics.seconds !== null ? `${Math.round(a.metrics.seconds)} s` : '–'],
                    ['Cuts', a.metrics.cuts !== null ? String(a.metrics.cuts) : '–'],
                    ['Cuts a second', a.metrics.cutsPerSecond !== null ? a.metrics.cutsPerSecond.toFixed(2) : '–'],
                    ['Words a second', a.metrics.wordsPerSecond !== null ? a.metrics.wordsPerSecond.toFixed(1) : '–'],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-lg border p-2.5">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="text-base font-semibold tabular-nums">{value}</p>
                    </div>
                  ))}
                </div>
                <section className="space-y-2">
                  <h3 className="text-sm font-medium">The hook</h3>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Fact label="Said">{a.hook.spoken || '–'}</Fact>
                    <Fact label="On screen">{a.hook.onScreen || '–'}</Fact>
                    <Fact label="Seen">{a.hook.visual || '–'}</Fact>
                  </div>
                  <p className="text-sm text-muted-foreground">{a.hook.why}</p>
                </section>
                {a.structure.length > 0 && (
                  <section className="space-y-2">
                    <h3 className="text-sm font-medium">How it’s built</h3>
                    <ol className="space-y-1.5">
                      {a.structure.map((s, i) => (
                        <li key={i} className="flex gap-3 text-sm">
                          <span className="w-10 shrink-0 text-muted-foreground tabular-nums">{s.at}</span>
                          <span>{s.what}</span>
                        </li>
                      ))}
                    </ol>
                  </section>
                )}
                <section className="space-y-2">
                  <h3 className="text-sm font-medium">The edit</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Fact label="Pace">{a.edit.pace}</Fact>
                    <Fact label="Captions">{a.edit.captions}</Fact>
                    <Fact label="Visuals">{a.edit.visuals}</Fact>
                    <Fact label="Sound">{a.edit.sound}</Fact>
                  </div>
                </section>
                <section className="space-y-1">
                  <h3 className="text-sm font-medium">Why it works</h3>
                  <p className="text-sm">{a.whyItWorks}</p>
                </section>
                {a.takeaways.length > 0 && (
                  <section className="space-y-1">
                    <h3 className="text-sm font-medium">For this page</h3>
                    <ul className="list-disc space-y-1 pl-5 text-sm">
                      {a.takeaways.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  </section>
                )}
                {a.cautions.length > 0 && (
                  <section className="flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2.5 text-sm">
                    <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-400" />
                    <ul className="space-y-0.5">
                      {a.cautions.map((c) => (
                        <li key={c}>{c}</li>
                      ))}
                    </ul>
                  </section>
                )}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {item.platform !== 'file' && (
                <Button size="sm" variant="outline" onClick={() => openExternal(item.url)}>
                  <ExternalLink /> Open the post
                </Button>
              )}
              {(item.source === 'link' || item.source === 'library') && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground"
                  onClick={async () => {
                    try {
                      await api(`/research/items/${item.id}`, { method: 'DELETE' });
                      refresh(wid);
                      onClose();
                    } catch (err) {
                      toast.error(errorMessage(err));
                    }
                  }}
                >
                  <Trash2 /> Remove
                </Button>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** A page's research: today's brief from what's over-performing in the accounts it watches, the outliers, analyses. */
export function ResearchPage() {
  const { workspace } = useWorkspaceContext();
  const wid = workspace.id;
  const research = useResearch(wid);
  const [params, setParams] = useSearchParams();
  const [running, setRunning] = useState(false);
  const d = research.data;
  const openId = params.get('item');
  const open = (id: string | null) => setParams(id ? { item: id } : {}, { replace: !id });
  const openItem = d ? ([...d.outliers, ...d.analyses].find((i) => i.id === openId) ?? null) : null;
  const watching = d ? d.settings.keywords.length + d.settings.youtube.length + d.settings.tiktok.length + d.settings.instagram.length : 0;

  async function runNow() {
    setRunning(true);
    try {
      queryClient.setQueryData(keys.research(wid), await api<ResearchOverview>(`/workspaces/${wid}/research/run`, { body: {} }));
      toast('Looking at what’s working…', { description: 'A few minutes: each account is read, then the brief is written.' });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={workspace.kind === 'clipping' ? 'Find' : 'Ideas'}
        description={`What’s working in ${workspace.niche ? workspace.niche.replace(/\.$/, '') : 'the niche'}${workspace.kind === 'clipping' ? '' : ', and ideas from it'}`}
        actions={
          d &&
          watching > 0 && (
            <Button size="sm" variant="outline" onClick={runNow} disabled={running || d.running}>
              <RefreshCw className={cn((running || d.running) && 'animate-spin')} /> {d.running ? 'Researching…' : 'Run now'}
            </Button>
          )
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
          {workspace.kind === 'clipping' && <FinderPanel wid={wid} />}
          {!d ? (
            <>
              <Skeleton className="h-48 rounded-xl" />
              <Skeleton className="h-32 rounded-xl" />
            </>
          ) : (
            <>
              {!workspace.modules.includes('research') && (
                <p className="flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2.5 text-sm">
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-400" />
                  The Research brief module is off for this page, so nothing runs each morning. Switch it on in the page’s settings.
                </p>
              )}
              {d.error && (
                <p className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm">
                  <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" /> The last run didn’t finish: {d.error}
                </p>
              )}
              {d.running && !d.brief && (
                <p className="flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm">
                  <Loader2 className="size-4 animate-spin text-brand" /> Reading the accounts this page watches, then writing the brief…
                </p>
              )}
              {d.brief?.body ? (
                <BriefCard wid={wid} brief={d.brief} overview={d} onOpen={open} />
              ) : (
                !d.running &&
                watching > 0 && <p className="rounded-lg border border-dashed px-3 py-2.5 text-sm text-muted-foreground">The first brief comes tomorrow morning, or now with Run now.</p>
              )}
              <AnalyseCard wid={wid} items={d.analyses} onOpen={open} />
              {d.outliers.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle>Outliers</CardTitle>
                    <CardDescription>Posts that got 3× or more their account’s usual views, seen in the last three weeks, best first.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ul className="divide-y rounded-lg border">
                      {d.outliers.map((o) => (
                        <OutlierRow key={o.id} o={o} wid={wid} onOpen={() => open(o.id)} />
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
              <WatchListCard wid={wid} settings={d.settings} niche={workspace.niche} />
            </>
          )}
        </div>
      </div>
      <AnalysisDialog item={openItem} wid={wid} onClose={() => open(null)} />
    </div>
  );
}
