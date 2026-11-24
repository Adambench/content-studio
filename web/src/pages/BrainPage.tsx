// What Claude follows: lessons (from my notes, on or off), the halal rules (locked), each brand's CLAUDE.md, what
// works now in the market, and the skills. All plain files on ai-server; Claude and I edit the same ones.

import { Lock } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Brain, Lesson } from '@shared/types';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { useBrain, useBrainActions, useUpdateBrand } from '@/lib/queries';
import { cn } from '@/lib/utils';

const TABS = [
  ['lessons', 'Lessons'],
  ['halal', 'Halal'],
  ['brands', 'Brands'],
  ['market', 'What works now'],
  ['skills', 'Skills'],
] as const;

export function BrainPage() {
  const brain = useBrain();
  const [tab, setTab] = useState<(typeof TABS)[number][0]>('lessons');
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6 md:px-8">
        <div>
          <h1 className="text-xl font-semibold">Brain</h1>
          <p className="text-sm text-muted-foreground">What Claude follows when it makes. Your notes become lessons here.</p>
        </div>
        <div className="flex flex-wrap gap-1.5" role="tablist">
          {TABS.map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn('rounded-full border px-3 py-1 text-sm', tab === k ? 'border-foreground bg-foreground text-background' : 'text-muted-foreground')}>
              {l}
            </button>
          ))}
        </div>
        {!brain.data ? <Spinner /> : tab === 'lessons' ? <Lessons brain={brain.data} /> : tab === 'halal' ? <Halal brain={brain.data} /> : tab === 'brands' ? <Brands brain={brain.data} /> : tab === 'market' ? <Market brain={brain.data} /> : <Skills brain={brain.data} />}
      </div>
    </div>
  );
}

function LessonList({ scope, lessons }: { scope: string; lessons: Lesson[] }) {
  const act = useBrainActions();
  const [text, setText] = useState('');
  return (
    <div className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card">
      {lessons.map((l) => (
        <label key={l.line} className="flex items-start gap-3 px-4 py-2.5 text-sm">
          <span className={cn('flex-1', !l.on && 'text-muted-foreground line-through')}>{l.text}</span>
          <Switch checked={l.on} onCheckedChange={(on) => act.toggle.mutate({ scope, line: l.line, on })} aria-label={l.on ? 'Turn this lesson off' : 'Turn this lesson on'} />
        </label>
      ))}
      <input
        value={text}
        onChange={(e) => setText(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && text.trim()) {
            act.add.mutate({ scope, text: text.trim() });
            setText('');
          }
        }}
        placeholder="Add a lesson, then Enter"
        aria-label="New lesson"
        className="bg-transparent px-4 py-2.5 text-sm outline-none"
      />
    </div>
  );
}

function Lessons({ brain }: { brain: Brain }) {
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Every brand</h2>
        <LessonList scope="all" lessons={brain.lessons} />
      </section>
      {brain.brands.map((b) => (
        <section key={b.brandId} className="flex flex-col gap-2">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <span className="size-2 rounded-full" style={{ background: b.color }} />
            {b.name}
          </h2>
          <LessonList scope={b.brandId} lessons={b.lessons} />
        </section>
      ))}
    </div>
  );
}

function Halal({ brain }: { brain: Brain }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col divide-y overflow-hidden rounded-xl border bg-card">
        {brain.halal.map((h) => (
          <div key={h} className="flex items-start gap-3 px-4 py-2.5 text-sm">
            <Lock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" /> {h}
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Locked: written into ~/studio/CLAUDE.md on every start, and checked on every render.</p>
    </div>
  );
}

function Brands({ brain }: { brain: Brain }) {
  return (
    <div className="flex flex-col gap-6">
      {brain.brands.map((b) => (
        <BrandFile key={b.brandId} b={b} />
      ))}
    </div>
  );
}

function BrandFile({ b }: { b: Brain['brands'][number] }) {
  const act = useBrainActions();
  const rename = useUpdateBrand();
  const [text, setText] = useState(b.text);
  useEffect(() => setText(b.text), [b.text]);
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <input type="color" value={b.color} onChange={(e) => rename.mutate({ id: b.brandId, color: e.currentTarget.value })} aria-label={`${b.name}'s colour`} className="size-6 cursor-pointer rounded border-0 bg-transparent p-0" />
        <input defaultValue={b.name} onBlur={(e) => e.currentTarget.value.trim() && e.currentTarget.value !== b.name && rename.mutate({ id: b.brandId, name: e.currentTarget.value.trim() })} aria-label="Brand name" className="flex-1 bg-transparent text-sm font-semibold outline-none" />
        <span className="hidden font-mono text-[11px] text-muted-foreground md:inline">{b.file}</span>
      </div>
      <textarea value={text} onChange={(e) => setText(e.currentTarget.value)} rows={12} aria-label={`${b.name}'s CLAUDE.md`} className="rounded-xl border bg-card p-3 font-mono text-xs leading-relaxed outline-none focus:border-foreground/25" />
      {text !== b.text && (
        <Button size="sm" className="self-end" onClick={() => act.writeBrand.mutate({ brandId: b.brandId, text })}>
          Save
        </Button>
      )}
    </section>
  );
}

function Market({ brain }: { brain: Brain }) {
  if (!brain.market.trim()) return <p className="text-sm text-muted-foreground">Nothing yet. The market scan (what goes viral in each niche) comes with the market engine.</p>;
  return <pre className="rounded-xl border bg-card p-4 text-sm leading-relaxed whitespace-pre-wrap">{brain.market}</pre>;
}

function Skills({ brain }: { brain: Brain }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-2 sm:grid-cols-2">
        {brain.skills.map((s) => (
          <div key={s.name} className="rounded-xl border bg-card px-3 py-2">
            <div className="font-mono text-sm">/{s.name}</div>
            <div className="line-clamp-2 text-xs text-muted-foreground">{s.description}</div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Claude picks them by itself; type / in a video to ask for one.</p>
    </div>
  );
}
