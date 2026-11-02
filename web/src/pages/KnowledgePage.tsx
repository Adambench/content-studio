import { BookOpen, Check, Heart, Lock, MoreHorizontal, Pencil, Plus, RotateCcw, Search, Sparkles, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { KNOWLEDGE_SOURCE_LABELS, KNOWLEDGE_TOPIC_INFO, KNOWLEDGE_TOPICS, RULE_BODY_MAX, RULE_TITLE_MAX, type KnowledgeRule, type KnowledgeTopic } from '@shared/knowledge';
import { useSearchParams } from 'react-router';
import { Inspiration } from '@/components/knowledge/Inspiration';
import { Markdown } from '@/components/Markdown';
import { PageHeader } from '@/components/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { api, errorMessage } from '@/lib/api';
import { keys, queryClient, useKnowledge } from '@/lib/queries';
import { cn } from '@/lib/utils';

const refresh = () => queryClient.invalidateQueries({ queryKey: keys.knowledge });

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

/**
 * Knowledge: first the videos that moved me, read for how they're built and marked for what each page takes from them
 * (its style); then the playbook underneath, as rules I can read, change and add to. Every prompt uses both.
 */
export function KnowledgePage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'playbook' ? 'playbook' : 'inspiration';
  return (
    <div className="flex h-full flex-col">
      <PageHeader title="Knowledge" description="Videos that moved you become each page’s style; the playbook is the rules underneath" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Tabs
          value={tab}
          onValueChange={(v) =>
            setParams(
              (p) => {
                if (v === 'playbook') p.set('tab', 'playbook');
                else p.delete('tab');
                return p;
              },
              { replace: true },
            )
          }
          className="mx-auto max-w-5xl gap-4 p-4 md:p-6"
        >
          <TabsList>
            <TabsTrigger value="inspiration">
              <Heart /> Inspiration
            </TabsTrigger>
            <TabsTrigger value="playbook">
              <BookOpen /> Playbook
            </TabsTrigger>
          </TabsList>
          <TabsContent value="inspiration">
            <Inspiration />
          </TabsContent>
          <TabsContent value="playbook">
            <Playbook />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

/** The playbook as rules: read them, change them, add to them. Every prompt uses what's on here. */
function Playbook() {
  const knowledge = useKnowledge();
  const [topic, setTopic] = useState<KnowledgeTopic>('content-model');
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const rules = knowledge.data ?? [];
  const suggested = rules.filter((r) => r.status === 'proposed');
  const q = query.trim().toLowerCase();
  const shown = useMemo(
    () => (q ? rules.filter((r) => r.status !== 'proposed' && `${r.title}\n${r.body}`.toLowerCase().includes(q)) : rules.filter((r) => r.topic === topic && r.status !== 'proposed')),
    [rules, q, topic],
  );
  const count = (t: KnowledgeTopic) => rules.filter((r) => r.topic === t && r.status === 'active').length;

  return (
    <div className="flex flex-col gap-4 md:flex-row md:gap-6">
      <nav className="flex gap-1 overflow-x-auto [scrollbar-width:none] md:w-52 md:shrink-0 md:flex-col md:overflow-visible" aria-label="Topics">
        {KNOWLEDGE_TOPICS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => {
              setTopic(t);
              setQuery('');
            }}
            className={cn(
              'flex shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors hover:bg-accent',
              t === topic && !q ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground',
            )}
          >
            {KNOWLEDGE_TOPIC_INFO[t].label}
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">{count(t) || ''}</span>
          </button>
        ))}
      </nav>

      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search every rule" className="pl-8" aria-label="Search every rule" />
          </div>
          <Button onClick={() => setAdding(true)} disabled={!!q}>
            <Plus /> Add a rule
          </Button>
        </div>

        {suggested.length > 0 && !q && (
          <section id="suggested" className="scroll-mt-4 space-y-2">
            <h2 className="flex items-center gap-1.5 text-sm font-medium">
              <Sparkles className="size-4 text-brand" /> Suggested
            </h2>
            {suggested.map((r) => (
              <SuggestedRule key={r.id} rule={r} />
            ))}
          </section>
        )}

        {!q && (
          <div>
            <h2 className="text-sm font-medium">{KNOWLEDGE_TOPIC_INFO[topic].label}</h2>
            <p className="text-xs text-muted-foreground">{KNOWLEDGE_TOPIC_INFO[topic].hint}</p>
          </div>
        )}

        {adding && !q && <NewRule topic={topic} onDone={() => setAdding(false)} />}

        {!knowledge.data ? (
          <div className="space-y-3">
            <Skeleton className="h-28 rounded-lg" />
            <Skeleton className="h-28 rounded-lg" />
          </div>
        ) : shown.length ? (
          <ul className="space-y-3">
            {shown.map((r) => (
              <RuleCard key={r.id} rule={r} showTopic={!!q} />
            ))}
          </ul>
        ) : (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BookOpen />
              </EmptyMedia>
              <EmptyTitle>{q ? 'Nothing matches' : 'No rules here yet'}</EmptyTitle>
              <EmptyDescription>{q ? 'Try another word.' : 'Add what you know works: every prompt about this topic will use it.'}</EmptyDescription>
            </EmptyHeader>
            {!q && (
              <Button size="sm" onClick={() => setAdding(true)}>
                <Plus /> Add a rule
              </Button>
            )}
          </Empty>
        )}
      </div>
    </div>
  );
}

function RuleEditor({ title: t0, body: b0, onSave, onCancel, saveLabel = 'Save' }: { title: string; body: string; onSave: (v: { title: string; body: string }) => Promise<unknown>; onCancel: () => void; saveLabel?: string }) {
  const [title, setTitle] = useState(t0);
  const [body, setBody] = useState(b0);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!title.trim()) return;
    setBusy(true);
    await onSave({ title, body });
    setBusy(false);
  };
  return (
    <div
      className="space-y-2"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void save();
      }}
    >
      <Input autoFocus value={title} maxLength={RULE_TITLE_MAX} onChange={(e) => setTitle(e.target.value)} placeholder="The rule in a few words" aria-label="Title" />
      <Textarea value={body} maxLength={RULE_BODY_MAX} onChange={(e) => setBody(e.target.value)} rows={Math.min(18, Math.max(4, body.split('\n').length + 1))} placeholder="How to apply it, with an example (Markdown works)" aria-label="Rule" className="font-mono text-xs" />
      <div className="flex gap-2">
        <Button size="sm" onClick={save} disabled={busy || !title.trim()}>
          <Check /> {saveLabel}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <span className="ml-auto self-center text-xs text-muted-foreground">Ctrl+Enter saves</span>
      </div>
    </div>
  );
}

function NewRule({ topic, onDone }: { topic: KnowledgeTopic; onDone: () => void }) {
  return (
    <div className="rounded-lg border border-dashed p-3">
      <RuleEditor
        title=""
        body=""
        saveLabel="Add"
        onCancel={onDone}
        onSave={async (v) => {
          if (await act(() => api('/knowledge', { body: { topic, ...v } }))) onDone();
        }}
      />
    </div>
  );
}

function RuleCard({ rule, showTopic }: { rule: KnowledgeRule; showTopic: boolean }) {
  const [editing, setEditing] = useState(false);
  const off = rule.status === 'off';

  async function remove() {
    const r = await act(() => api<{ rule: KnowledgeRule | null }>(`/knowledge/${rule.id}`, { method: 'DELETE' }));
    if (!r) return;
    toast(r.rule ? `Turned off “${rule.title}” (it’s from the playbook)` : `Deleted “${rule.title}”`, {
      action: { label: 'Undo', onClick: () => void act(() => api('/knowledge/restore', { body: rule })) },
    });
  }

  return (
    <li className={cn('rounded-lg border bg-card p-3', off && 'opacity-60')}>
      {editing ? (
        <RuleEditor
          title={rule.title}
          body={rule.body}
          onCancel={() => setEditing(false)}
          onSave={async (v) => {
            if (await act(() => api(`/knowledge/${rule.id}`, { method: 'PATCH', body: v }))) setEditing(false);
          }}
        />
      ) : (
        <>
          <div className="flex items-start gap-2">
            <h3 className="min-w-0 flex-1 text-sm font-medium">{rule.title}</h3>
            {showTopic && <Badge variant="outline">{KNOWLEDGE_TOPIC_INFO[rule.topic].label}</Badge>}
            <Badge variant="secondary">{rule.edited ? 'Changed by you' : KNOWLEDGE_SOURCE_LABELS[rule.source]}</Badge>
            {rule.locked ? (
              <Lock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="The halal rules can’t be changed" />
            ) : (
              <>
                <Switch
                  checked={!off}
                  onCheckedChange={(on) => act(() => api(`/knowledge/${rule.id}`, { method: 'PATCH', body: { status: on ? 'active' : 'off' } }))}
                  aria-label={off ? 'Turn on' : 'Turn off'}
                />
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon-sm" variant="ghost" className="-my-1" aria-label="More">
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setEditing(true)}>
                      <Pencil /> Edit
                    </DropdownMenuItem>
                    {rule.edited && (
                      <DropdownMenuItem onClick={() => act(() => api(`/knowledge/${rule.id}/reset`, { body: {} }))}>
                        <RotateCcw /> Back to the playbook’s words
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem variant="destructive" onClick={remove}>
                      <Trash2 /> {rule.source === 'playbook' ? 'Remove (turns it off)' : 'Delete'}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
          {/* Double-click the text to edit it, as well as the menu's Edit. */}
          <div className="mt-2" onDoubleClick={() => !rule.locked && setEditing(true)}>
            {rule.body ? <Markdown className="text-muted-foreground [&_strong]:text-foreground">{rule.body}</Markdown> : <p className="text-sm text-muted-foreground italic">No details.</p>}
          </div>
        </>
      )}
    </li>
  );
}

function SuggestedRule({ rule }: { rule: KnowledgeRule }) {
  const [editing, setEditing] = useState(false);
  const approve = (v?: { title: string; body: string }) => act(() => api(`/knowledge/${rule.id}`, { method: 'PATCH', body: { ...v, status: 'active' } }));
  return (
    <div className="rounded-lg border border-brand/40 bg-brand-soft p-3">
      {editing ? (
        <RuleEditor title={rule.title} body={rule.body} saveLabel="Approve" onCancel={() => setEditing(false)} onSave={approve} />
      ) : (
        <>
          <div className="flex items-start gap-2">
            <h3 className="min-w-0 flex-1 text-sm font-medium">{rule.title}</h3>
            <Badge variant="outline">{KNOWLEDGE_TOPIC_INFO[rule.topic].label}</Badge>
          </div>
          <Markdown className="mt-2 text-muted-foreground">{rule.body}</Markdown>
          {rule.note && <p className="mt-2 text-xs text-muted-foreground">Why: {rule.note}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => approve()}>
              <Check /> Approve
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              <Pencil /> Edit, then approve
            </Button>
            <Button size="sm" variant="ghost" onClick={() => act(() => api(`/knowledge/${rule.id}`, { method: 'DELETE' }))}>
              <X /> Dismiss
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
