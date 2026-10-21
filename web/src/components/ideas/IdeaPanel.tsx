import { ArrowRight, ChevronDown, Clapperboard, ExternalLink, FileText, Layers, Lightbulb, Maximize2, MoreHorizontal, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { ASSIST_INFO, ASSISTS, labelColor, normalizeLabel, type AssistKind, type IdeaDetail, type IdeaNode } from '@shared/ideas';
import { PlatformIcon } from '@/components/publish/common';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { WorkspaceDot } from '@/components/WorkspaceDot';
import { api, errorMessage, mediaFileUrl, mediaThumbUrl } from '@/lib/api';
import { COLOR_SOFT } from '@/lib/colors';
import { compact, timeAgo } from '@/lib/format';
import { openExternal } from '@/lib/native';
import { keys, queryClient, useIdea, useWorkspaces } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { hostOf, StatusChip } from './IdeaCard';
import { addChildren, cardTitle, childrenOf, episodeOf, removeCard, updateCard, type Tree } from './model';

type Props = {
  wid: string;
  tree: Tree;
  id: string;
  onClose: () => void;
  onSelect: (id: string) => void;
  onDive: (id: string) => void;
  /** Open the "move to another page" menu straight away (from the phone's "Change page"). */
  moveFirst?: boolean;
};

/** Text that saves itself as I type (and when I leave it), and only takes the server's copy when I'm not typing. */
function AutoText({ value, onSave, placeholder, className, minRows = 3 }: { value: string; onSave: (v: string) => void; placeholder: string; className?: string; minRows?: number }) {
  const [text, setText] = useState(value);
  const focused = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const last = useRef(value);
  useEffect(() => {
    if (!focused.current && value !== last.current) {
      setText(value);
      last.current = value;
    }
  }, [value]);
  const flush = (v: string) => {
    window.clearTimeout(timer.current);
    if (v !== last.current) {
      last.current = v;
      onSave(v);
    }
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <textarea
      value={text}
      rows={minRows}
      placeholder={placeholder}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        flush(text);
      }}
      onChange={(e) => {
        const v = e.target.value;
        setText(v);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => flush(v), 700);
      }}
      className={cn('field-sizing-content block w-full resize-none bg-transparent text-sm leading-relaxed outline-none placeholder:text-muted-foreground', className)}
    />
  );
}

function Labels({ wid, node, all }: { wid: string; node: IdeaNode; all: string[] }) {
  const [text, setText] = useState('');
  const add = (raw: string) => {
    const l = normalizeLabel(raw);
    setText('');
    if (l && !node.labels.includes(l)) void updateCard(wid, node.id, { labels: [...node.labels, l] }, { undo: true });
  };
  const suggestions = all.filter((l) => !node.labels.includes(l) && (!text || l.startsWith(normalizeLabel(text))));
  return (
    <div className="flex flex-wrap items-center gap-1">
      {node.labels.map((l) => (
        <span key={l} className={cn('inline-flex h-6 items-center gap-0.5 rounded-md pr-0.5 pl-2 text-xs', COLOR_SOFT[labelColor(l)])}>
          {l}
          <button type="button" onClick={() => void updateCard(wid, node.id, { labels: node.labels.filter((x) => x !== l) }, { undo: true })} className="rounded p-0.5 opacity-70 hover:opacity-100" aria-label={`Remove ${l}`}>
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add(text);
          } else if (e.key === 'Backspace' && !text && node.labels.length) void updateCard(wid, node.id, { labels: node.labels.slice(0, -1) });
        }}
        onBlur={() => text && add(text)}
        placeholder={node.labels.length ? '+ label' : 'Add a label (hook, story, ramadan…)'}
        className="h-6 min-w-24 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
        aria-label="Add a label"
      />
      {text && suggestions.length > 0 && (
        <div className="flex w-full flex-wrap gap-1">
          {suggestions.slice(0, 6).map((s) => (
            <button key={s} type="button" onMouseDown={(e) => (e.preventDefault(), add(s))} className={cn('h-6 rounded-md px-2 text-xs', COLOR_SOFT[labelColor(s)])}>
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Section({ title, children, className, action }: { title: string; children: React.ReactNode; className?: string; action?: React.ReactNode }) {
  return (
    <section className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A saved post: what it is, how it did, what's said, and the breakdown on my click. */
function PostBlock({ node, detail }: { node: IdeaNode; detail: IdeaDetail | undefined }) {
  const [words, setWords] = useState(false);
  const [asking, setAsking] = useState(false);
  const p = node.post;
  const status = p?.analysisStatus ?? 'none';
  const breakdown = async () => {
    setAsking(true);
    try {
      await api(`/ideas/${node.id}/breakdown`, { method: 'POST' });
      void queryClient.invalidateQueries({ queryKey: keys.idea(node.id) });
      void queryClient.invalidateQueries({ queryKey: keys.ideas(node.workspaceId) });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setAsking(false);
    }
  };
  const a = detail?.analysis;
  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <button type="button" onClick={() => node.url && openExternal(node.url)} className="relative h-36 w-24 shrink-0 overflow-hidden rounded-lg bg-muted" aria-label="Open the post">
          {node.hasThumb && node.mediaId && <img src={mediaThumbUrl(node.mediaId)} alt="" className="size-full object-cover" />}
          <ExternalLink className="absolute right-1.5 bottom-1.5 size-3.5 text-white drop-shadow" />
        </button>
        <div className="min-w-0 flex-1 space-y-1.5 text-sm">
          <div className="flex items-center gap-1.5">
            {p && <PlatformIcon platform={p.platform} />}
            <span className="truncate font-medium">{p?.channel || hostOf(node.url)}</span>
            {p?.fetching && <Spinner className="size-3.5" />}
          </div>
          {p?.views !== null && p?.views !== undefined && (
            <p className="text-muted-foreground">
              <span className="text-foreground tabular-nums">{compact(p.views)}</span> views
              {p.score !== null && (
                <>
                  {' · '}
                  <span className={cn('font-semibold tabular-nums', p.score >= 3 ? 'text-emerald-400' : 'text-foreground')}>{p.score >= 10 ? Math.round(p.score) : p.score.toFixed(1)}×</span> their usual
                </>
              )}
            </p>
          )}
          {p?.postedAt && <p className="text-xs text-muted-foreground">Posted {timeAgo(p.postedAt)}</p>}
          {p?.title && <p className="line-clamp-4 text-xs text-muted-foreground">{p.title}</p>}
          <Button size="sm" variant="outline" className="mt-1" onClick={() => node.url && openExternal(node.url)}>
            <ExternalLink /> Open
          </Button>
        </div>
      </div>
      {detail?.transcript && (
        <div className="rounded-lg border">
          <button type="button" onClick={() => setWords(!words)} className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground">
            What’s said <ChevronDown className={cn('size-3.5 transition-transform', words && 'rotate-180')} />
          </button>
          {words ? <p className="px-3 pb-3 text-sm leading-relaxed whitespace-pre-wrap">{detail.transcript}</p> : <p className="line-clamp-2 px-3 pb-2.5 text-sm text-muted-foreground">{detail.transcript}</p>}
        </div>
      )}
      {node.post && (
        <Section title="Why it works">
          {status === 'done' && a ? (
            <div className="space-y-3 text-sm">
              <p>{a.whyItWorks}</p>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-xs font-medium text-muted-foreground">The hook</p>
                <p className="mt-1">{a.hook.why}</p>
                {a.hook.onScreen && <p className="mt-1 text-xs text-muted-foreground">On screen: {a.hook.onScreen}</p>}
              </div>
              {a.structure.length > 0 && (
                <ol className="space-y-1">
                  {a.structure.map((s, i) => (
                    <li key={i} className="flex gap-2 text-sm">
                      <span className="w-10 shrink-0 text-xs text-muted-foreground tabular-nums">{s.at}</span>
                      {s.what}
                    </li>
                  ))}
                </ol>
              )}
              {a.takeaways.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">For your page</p>
                  <ul className="mt-1 list-disc space-y-1 pl-4">
                    {a.takeaways.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                </div>
              )}
              {a.cautions.length > 0 && <p className="text-xs text-amber-300">Careful: {a.cautions.join(' · ')}</p>}
              <p className="text-xs text-muted-foreground">
                {a.metrics.seconds ?? '?'} s · {a.metrics.cutsPerSecond ?? '?'} cuts/s · {a.metrics.wordsPerSecond ?? '?'} words/s
              </p>
            </div>
          ) : status === 'queued' || status === 'running' ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner /> Claude is watching it…
            </p>
          ) : (
            <div className="space-y-2">
              {status === 'error' && detail?.analysisError && <p className="text-xs text-destructive">{detail.analysisError}</p>}
              <Button size="sm" variant="secondary" onClick={breakdown} disabled={asking}>
                {asking ? <Spinner /> : <Sparkles className="text-brand" />} Break it down
              </Button>
              <p className="text-xs text-muted-foreground">The hook, the beats and the edit, and what your page can borrow. One Claude look with frames.</p>
            </div>
          )}
        </Section>
      )}
    </div>
  );
}

function AssistBlock({ wid, node, tree }: { wid: string; node: IdeaNode; tree: Tree }) {
  const [asking, setAsking] = useState<AssistKind | null>(null);
  const a = node.assist;
  const ask = async (kind: AssistKind) => {
    setAsking(kind);
    try {
      await api(`/ideas/${node.id}/assist`, { body: { kind } });
      void queryClient.invalidateQueries({ queryKey: keys.ideas(wid) });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setAsking(null);
    }
  };
  const dismiss = () => {
    queryClient.setQueryData<IdeaNode[]>(keys.ideas(wid), (old) => old?.map((n) => (n.id === node.id ? { ...n, assist: null } : n)));
    void api(`/ideas/${node.id}/assist`, { method: 'DELETE' }).catch(() => {});
  };
  const addNote = (text: string) => void updateCard(wid, node.id, { body: node.body.trim() ? `${node.body.trimEnd()}\n\n${text}` : text }, { undo: true });
  const kinds = ASSISTS.filter((k) => k !== 'episodes' || node.kind === 'series');
  const running = a?.status === 'running';
  const has = new Set(childrenOf(tree, node.id).map((c) => c.title.toLowerCase()));
  return (
    <Section title="Claude">
      <div className="flex flex-wrap gap-1.5">
        {kinds.map((k) => (
          <Button key={k} size="sm" variant={a?.kind === k ? 'secondary' : 'outline'} onClick={() => void ask(k)} disabled={running || !!asking} title={ASSIST_INFO[k].hint}>
            {asking === k || (running && a?.kind === k) ? <Spinner /> : <Sparkles className="text-brand" />} {ASSIST_INFO[k].label}
          </Button>
        ))}
      </div>
      {running && <p className="text-xs text-muted-foreground">Claude is thinking… (it waits if your usage is high)</p>}
      {a?.status === 'error' && <p className="text-xs text-destructive">{a.error || 'Claude couldn’t answer.'}</p>}
      {a?.status === 'done' && (
        <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
          {a.summary && <p className="text-sm">{a.summary}</p>}
          <ul className="space-y-2">
            {a.items.map((it, i) => {
              const added = has.has(it.title.toLowerCase());
              return (
                <li key={i} className="rounded-md bg-background/60 p-2.5">
                  <p className="text-sm font-medium">{it.title}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{it.detail}</p>
                  <div className="mt-1.5 flex gap-1">
                    <Button size="xs" variant="ghost" disabled={added} onClick={() => void addChildren(wid, node.id, [{ title: it.title, body: it.detail }], 'claude')}>
                      <Plus /> {added ? 'Added' : node.kind === 'series' && a.kind === 'episodes' ? 'Add episode' : 'Sub-idea'}
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => addNote(`${it.title}: ${it.detail}`)}>
                      <FileText /> To notes
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="flex justify-between gap-2 pt-1">
            <Button size="sm" variant="secondary" onClick={() => void addChildren(wid, node.id, a.items.filter((it) => !has.has(it.title.toLowerCase())).map((it) => ({ title: it.title, body: it.detail })), 'claude')}>
              <Plus /> Add all as sub-ideas
            </Button>
            <Button size="sm" variant="ghost" onClick={dismiss}>
              Dismiss
            </Button>
          </div>
        </div>
      )}
    </Section>
  );
}

/** Lock in: the idea as a video on the board (this page or another personal or business page). */
function LockIn({ wid, node }: { wid: string; node: IdeaNode }) {
  const navigate = useNavigate();
  const { data: workspaces = [] } = useWorkspaces();
  const pages = workspaces.filter((w) => w.kind !== 'clipping');
  const [target, setTarget] = useState(wid);
  const [busy, setBusy] = useState(false);
  if (node.piece) {
    const p = node.piece;
    return (
      <div className="flex items-center gap-2">
        <Clapperboard className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="truncate">It’s a video{p.workspaceId !== wid ? ` on ${workspaces.find((w) => w.id === p.workspaceId)?.name ?? 'another page'}` : ''}</p>
          <StatusChip node={node} className="mt-0.5" />
        </div>
        <Button size="sm" onClick={() => navigate(`/w/${p.workspaceId}/p/${p.id}`)}>
          Open <ArrowRight />
        </Button>
      </div>
    );
  }
  const lock = async () => {
    setBusy(true);
    try {
      const r = await api<{ pieceId: string; workspaceId: string }>(`/ideas/${node.id}/lock`, { body: { workspaceId: target } });
      void queryClient.invalidateQueries({ queryKey: keys.ideas(wid) });
      toast.success('It’s on the board', { description: 'Claude is adding hooks, the angle and an outline to its draft.', action: { label: 'Open', onClick: () => navigate(`/w/${r.workspaceId}/p/${r.pieceId}`) } });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex items-center gap-2">
      {pages.length > 1 && (
        <Select value={target} onValueChange={setTarget}>
          <SelectTrigger size="sm" className="w-36 shrink-0" aria-label="Which page">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {pages.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                <WorkspaceDot color={w.color} /> {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Button className="flex-1" onClick={lock} disabled={busy}>
        {busy ? <Spinner /> : <Clapperboard />} Make it a video
      </Button>
    </div>
  );
}

export function IdeaPanel({ wid, tree, id, onClose, onSelect, onDive, moveFirst }: Props) {
  const node = tree.byId.get(id);
  const detail = useIdea(node?.kind === 'link' ? id : null);
  const { data: workspaces = [] } = useWorkspaces();
  const [tab, setTab] = useState<'notes' | 'script'>('notes');
  const [menu, setMenu] = useState(!!moveFirst);
  if (!node) return null;
  const kids = childrenOf(tree, node.id);
  const refs = kids.filter((k) => k.kind === 'link' || k.kind === 'image');
  const subs = kids.filter((k) => k.kind === 'idea' || k.kind === 'series');
  const ep = episodeOf(tree, node);
  const series = ep ? tree.byId.get(node.parentId!) : null;
  const others = workspaces.filter((w) => w.id !== wid && w.kind !== 'clipping');
  const move = async (to: string) => {
    try {
      await api(`/ideas/${node.id}/move`, { body: { workspaceId: to } });
      void queryClient.invalidateQueries({ queryKey: ['ideas'] });
      onClose();
      toast.success(`Moved to ${workspaces.find((w) => w.id === to)?.name ?? 'the other page'}`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  };
  const writing = node.kind === 'idea' || node.kind === 'series';

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex items-center gap-1 border-b px-3 py-2">
        {writing ? (
          <div className="flex rounded-md border p-0.5 text-xs">
            {(['idea', 'series'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => node.kind !== k && void updateCard(wid, node.id, { kind: k }, { undo: true })}
                className={cn('flex h-6 items-center gap-1 rounded px-2', node.kind === k ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground')}
              >
                {k === 'idea' ? <Lightbulb className="size-3" /> : <Layers className="size-3" />} {k === 'idea' ? 'Idea' : 'Series'}
              </button>
            ))}
          </div>
        ) : (
          <span className="px-1 text-xs font-medium text-muted-foreground">{node.kind === 'link' ? 'Saved post' : node.kind === 'image' ? 'Picture' : 'Saved'}</span>
        )}
        {series && (
          <button type="button" onClick={() => onSelect(series.id)} className="ml-1 truncate text-xs text-muted-foreground hover:text-foreground">
            {cardTitle(series)} · Ep {ep}
          </button>
        )}
        <div className="ml-auto flex items-center">
          {node.kind !== 'saved' && (
            <Button variant="ghost" size="icon-sm" onClick={() => onDive(node.id)} aria-label="Open as its own canvas" title="Open as its own canvas (Shift+Enter)">
              <Maximize2 />
            </Button>
          )}
          {node.kind !== 'saved' && (
            <DropdownMenu open={menu} onOpenChange={setMenu}>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="More">
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {others.length > 0 &&
                  (others.length === 1 ? (
                    <DropdownMenuItem onSelect={() => void move(others[0].id)}>
                      <WorkspaceDot color={others[0].color} /> Move to {others[0].name}
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger>Move to another page</DropdownMenuSubTrigger>
                      <DropdownMenuSubContent>
                        <DropdownMenuLabel>Move it (and what’s under it) to</DropdownMenuLabel>
                        {others.map((w) => (
                          <DropdownMenuItem key={w.id} onSelect={() => void move(w.id)}>
                            <WorkspaceDot color={w.color} /> {w.name}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  ))}
                {others.length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => {
                    void removeCard(wid, node.id);
                    onClose();
                  }}
                >
                  <Trash2 /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close">
            <X />
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {node.kind === 'saved' ? (
          <div className="space-y-2 text-sm text-muted-foreground">
            <p className="text-base font-semibold text-foreground">Saved</p>
            <p>What you share to Content Studio from your phone (TikToks, Reels, Shorts, screenshots, notes) lands here, and so do ideas you save from Research.</p>
            <p>Drag one onto an idea to keep it as what inspired it; Claude reads it when it fleshes the idea out.</p>
          </div>
        ) : (
          <>
            {node.kind === 'image' && node.mediaId && (
              <a href={mediaFileUrl(node.mediaId)} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border">
                <img src={mediaFileUrl(node.mediaId)} alt={node.title || 'Picture'} className="max-h-96 w-full object-contain" />
              </a>
            )}
            <AutoText
              key={`title-${node.id}`}
              value={node.title}
              onSave={(v) => void updateCard(wid, node.id, { title: v.replace(/\s+/g, ' ').trim() })}
              placeholder={node.kind === 'link' ? cardTitle(node) || 'Your note on it' : node.kind === 'image' ? 'A caption' : node.kind === 'series' ? 'Name the series' : 'Untitled idea'}
              minRows={1}
              className="text-lg leading-snug font-semibold"
            />
            <Labels wid={wid} node={node} all={tree.labels} />
            {node.kind === 'link' && <PostBlock node={node} detail={detail.data} />}

            {writing && (
              <div className="space-y-2">
                <div className="flex gap-3 border-b text-sm">
                  {(['notes', 'script'] as const).map((t) => (
                    <button key={t} type="button" onClick={() => setTab(t)} className={cn('-mb-px border-b-2 pb-1.5', tab === t ? 'border-brand text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
                      {t === 'notes' ? (node.kind === 'series' ? 'Premise' : 'Notes') : node.kind === 'series' ? 'Format & hook style' : 'Script draft'}
                      {t === 'script' && (node.kind === 'series' ? node.format : node.script) && <span className="ml-1 inline-block size-1.5 rounded-full bg-brand align-middle" />}
                    </button>
                  ))}
                </div>
                {tab === 'notes' ? (
                  <AutoText
                    key={`body-${node.id}`}
                    value={node.body}
                    onSave={(v) => void updateCard(wid, node.id, { body: v })}
                    placeholder={node.kind === 'series' ? 'What the series is about, who it’s for, how each episode works…' : 'Anything: the story, why it matters, half-thoughts, links…'}
                    minRows={8}
                  />
                ) : node.kind === 'series' ? (
                  <AutoText key={`format-${node.id}`} value={node.format} onSave={(v) => void updateCard(wid, node.id, { format: v })} placeholder="How every episode looks and opens: the same hook shape, length, setting…" minRows={6} />
                ) : (
                  <AutoText key={`script-${node.id}`} value={node.script} onSave={(v) => void updateCard(wid, node.id, { script: v })} placeholder="Draft the script whenever you’re ready. It goes with the idea when you make it a video." minRows={10} />
                )}
              </div>
            )}

            {node.kind === 'link' && (
              <Section title="Your note">
                <AutoText key={`note-${node.id}`} value={node.body} onSave={(v) => void updateCard(wid, node.id, { body: v })} placeholder="What to take from it (steal the cold open, the pacing…)" minRows={3} />
              </Section>
            )}

            {refs.length > 0 && (
              <Section title="Inspired by">
                <div className="grid grid-cols-4 gap-2">
                  {refs.map((r) => (
                    <button key={r.id} type="button" onClick={() => onSelect(r.id)} className="aspect-[3/4] overflow-hidden rounded-md border bg-muted text-left" title={cardTitle(r)}>
                      {r.hasThumb && r.mediaId ? <img src={mediaThumbUrl(r.mediaId)} alt="" className="size-full object-cover" /> : <span className="block p-1.5 text-[10px] text-muted-foreground">{cardTitle(r).slice(0, 40)}</span>}
                    </button>
                  ))}
                </div>
              </Section>
            )}

            {subs.length > 0 && (
              <Section
                title={node.kind === 'series' ? `${subs.length} episode${subs.length === 1 ? '' : 's'}` : `${subs.length} sub-idea${subs.length === 1 ? '' : 's'}`}
                action={
                  <Button size="xs" variant="ghost" onClick={() => onDive(node.id)}>
                    <Maximize2 /> Open
                  </Button>
                }
              >
                <ul className="space-y-1">
                  {subs.slice(0, 8).map((s, i) => (
                    <li key={s.id}>
                      <button type="button" onClick={() => onSelect(s.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent/50">
                        {node.kind === 'series' && <span className="w-9 shrink-0 text-xs text-muted-foreground tabular-nums">Ep {i + 1}</span>}
                        <span className="min-w-0 flex-1 truncate">{cardTitle(s) || 'Untitled'}</span>
                        <StatusChip node={s} />
                      </button>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {writing && <AssistBlock wid={wid} node={node} tree={tree} />}
          </>
        )}
      </div>

      {node.kind === 'idea' && (
        <footer className="pb-safe border-t p-3">
          <LockIn wid={wid} node={node} />
        </footer>
      )}
      {node.kind === 'series' && (
        <footer className="pb-safe border-t px-4 py-3 text-xs text-muted-foreground">Each episode becomes its own video: open one and make it a video. They go out in order.</footer>
      )}
    </div>
  );
}
