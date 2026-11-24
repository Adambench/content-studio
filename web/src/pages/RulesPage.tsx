import { LockIcon, PlusIcon, XIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { keys, queryClient, usePages, useRules } from '@/lib/queries';
import type { Rule, RuleSource } from '@shared/types';

const SOURCES: { id: RuleSource; label: string }[] = [
  { id: 'halal', label: 'Halal' },
  { id: 'lesson', label: 'My lessons' },
  { id: 'style', label: 'Page styles' },
  { id: 'market', label: 'What works now' },
  { id: 'base', label: 'Fundamentals' },
];

const refresh = () => queryClient.invalidateQueries({ queryKey: keys.rules });

function RuleRow({ rule }: { rule: Rule }) {
  const [open, setOpen] = useState(false);
  const pages = usePages().data ?? [];
  const page = pages.find((p) => p.id === rule.pageId);
  const toggle = async (on: boolean) => {
    await api(`/api/rules/${rule.id}`, { method: 'PATCH', body: { status: on ? 'on' : 'off' } });
    await refresh();
  };
  const remove = async () => {
    await api(`/api/rules/${rule.id}`, { method: 'DELETE' });
    await refresh();
  };
  const saveBody = async (body: string) => {
    if (body.trim() && body !== rule.body) {
      await api(`/api/rules/${rule.id}`, { method: 'PATCH', body: { body } });
      await refresh();
    }
  };
  return (
    <div className={`rounded-lg border p-3 ${rule.status === 'off' ? 'opacity-50' : ''}`}>
      <div className="flex items-start gap-3">
        <button onClick={() => setOpen((o) => !o)} className="min-w-0 flex-1 text-left">
          <div className="text-sm">
            {rule.title}
            {rule.taught > 1 && <span className="ml-2 text-xs text-muted-foreground">×{rule.taught}</span>}
          </div>
          {!open && <div className="truncate text-xs text-muted-foreground">{page ? `${page.name} · ` : ''}{rule.body}</div>}
        </button>
        {rule.locked ? <LockIcon className="mt-0.5 size-3.5 text-muted-foreground" /> : <Switch checked={rule.status === 'on'} onCheckedChange={(on) => void toggle(on)} />}
      </div>
      {open &&
        (rule.locked ? (
          <p className="mt-2 text-sm whitespace-pre-wrap text-muted-foreground">{rule.body}</p>
        ) : (
          <div className="mt-2 flex flex-col gap-2">
            <Textarea defaultValue={rule.body} onBlur={(e) => void saveBody(e.target.value)} className="min-h-24 text-sm" />
            {rule.source !== 'base' && (
              <Button variant="ghost" size="xs" className="self-end text-muted-foreground" onClick={() => void remove()}>
                <XIcon /> Delete
              </Button>
            )}
          </div>
        ))}
    </div>
  );
}

function AddRule({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const add = async () => {
    if (!title.trim() || !body.trim()) return;
    await api('/api/rules', { body: { title: title.trim(), body: body.trim(), source: 'lesson' } });
    await refresh();
    onDone();
  };
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <Input autoFocus placeholder="The rule in a few words" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Textarea placeholder="What to do, so no video makes the mistake again" value={body} onChange={(e) => setBody(e.target.value)} className="min-h-20" />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => void add()}>
          Add
        </Button>
      </div>
    </div>
  );
}

export function RulesPage() {
  const rules = useRules().data ?? [];
  const [source, setSource] = useState<RuleSource>('lesson');
  const [adding, setAdding] = useState(false);
  const shown = rules.filter((r) => r.source === source);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4 md:p-8">
        <div className="flex flex-wrap items-center gap-1">
          {SOURCES.map((s) => (
            <button key={s.id} onClick={() => setSource(s.id)} className={`rounded-lg px-3 py-1.5 text-sm ${source === s.id ? 'bg-secondary' : 'text-muted-foreground hover:text-foreground'}`}>
              {s.label} <span className="ml-1 text-xs text-muted-foreground">{rules.filter((r) => r.source === s.id).length || ''}</span>
            </button>
          ))}
          <div className="flex-1" />
          {source === 'lesson' && !adding && (
            <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
              <PlusIcon /> Lesson
            </Button>
          )}
        </div>
        {adding && <AddRule onDone={() => setAdding(false)} />}
        {shown.length === 0 && !adding && <p className="p-6 text-center text-sm text-muted-foreground">None yet.</p>}
        {shown.map((r) => (
          <RuleRow key={r.id} rule={r} />
        ))}
      </div>
    </div>
  );
}
