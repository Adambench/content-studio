import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { keys, queryClient, usePages } from '@/lib/queries';
import type { Level, Page, PageSettings } from '@shared/types';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1.5 md:grid-cols-[180px_1fr] md:gap-6">
      <div className="pt-2 text-sm">
        {label}
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      <div>{children}</div>
    </label>
  );
}

function Choice<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg border p-0.5">
      {options.map(([v, label]) => (
        <button key={v} type="button" onClick={() => onChange(v)} className={`rounded-md px-3 py-1 text-sm ${value === v ? 'bg-secondary' : 'text-muted-foreground hover:text-foreground'}`}>
          {label}
        </button>
      ))}
    </div>
  );
}

const LEVELS: [Level, string][] = [
  ['off', 'Off'],
  ['light', 'Light'],
  ['full', 'Full'],
];

export function PageSettingsPage() {
  const { pageId } = useParams();
  const navigate = useNavigate();
  const page = usePages().data?.find((p) => p.id === pageId);
  const [draft, setDraft] = useState<Page | null>(null);
  useEffect(() => setDraft(page ?? null), [page]);
  if (!draft) return null;

  const save = async (patch: { name?: string; color?: string; settings?: Partial<PageSettings> }) => {
    const next = { ...draft, ...patch, settings: { ...draft.settings, ...patch.settings } };
    setDraft(next);
    await api(`/api/pages/${draft.id}`, { method: 'PATCH', body: patch });
    await queryClient.invalidateQueries({ queryKey: keys.pages });
  };
  const s = draft.settings;
  const text = (key: 'niche' | 'voice' | 'style', placeholder: string) => (
    <Textarea
      defaultValue={s[key]}
      placeholder={placeholder}
      onBlur={(e) => e.target.value !== s[key] && void save({ settings: { [key]: e.target.value } })}
      className="min-h-20"
    />
  );

  const remove = async () => {
    await api(`/api/pages/${draft.id}`, { method: 'DELETE' });
    await queryClient.invalidateQueries({ queryKey: keys.pages });
    toast(`${draft.name} deleted`);
    navigate('/');
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4 md:p-8">
        <h1 className="text-lg font-semibold">{draft.name}</h1>
        <p className="-mt-4 text-sm text-muted-foreground">Where Claude starts on this page. Any card can do otherwise.</p>
        <Field label="Name">
          <Input defaultValue={draft.name} onBlur={(e) => e.target.value.trim() && e.target.value !== draft.name && void save({ name: e.target.value.trim() })} />
        </Field>
        <Field label="Colour">
          <input type="color" value={draft.color} onChange={(e) => void save({ color: e.target.value })} className="h-9 w-16 cursor-pointer rounded-md border bg-transparent" />
        </Field>
        <Field label="Niche" hint="Who it's for, what it's about">
          {text('niche', 'Muslim entrepreneurship, building an agency from zero…')}
        </Field>
        <Field label="Voice" hint="How it talks">
          {text('voice', 'Calm, direct, a bit funny. Short sentences…')}
        </Field>
        <Field label="Style" hint="How it looks and moves">
          {text('style', 'Raw, cut tight, clean captions, my screens as proof…')}
        </Field>
        <Field label="Captions">
          <Choice
            value={s.captions}
            options={[
              ['two-words', '2 words'],
              ['word', 'Word'],
              ['line', 'Line'],
              ['off', 'Off'],
            ]}
            onChange={(captions) => void save({ settings: { captions } })}
          />
        </Field>
        <Field label="Sound effects">
          <Choice value={s.sfx} options={LEVELS} onChange={(sfx) => void save({ settings: { sfx } })} />
        </Field>
        <Field label="Ambience" hint="Rain, wind, a room: never music">
          <Choice value={s.ambience} options={LEVELS} onChange={(ambience) => void save({ settings: { ambience } })} />
        </Field>
        <Field label="Make by itself" hint="When a card's files are in">
          <div className="pt-1.5">
            <Switch checked={s.autoMake} onCheckedChange={(autoMake) => void save({ settings: { autoMake } })} />
          </div>
        </Field>
        <div className="mt-6 border-t pt-6">
          <Button variant="destructive" size="sm" onClick={() => void remove()}>
            Delete page
          </Button>
        </div>
      </div>
    </div>
  );
}
