import { Crosshair } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Media } from '@/lib/types';
import { cn } from '@/lib/utils';

/** 0:03.2 — seconds with a tenth, for trimming. */
export function preciseClock(seconds: number) {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest.toFixed(1).padStart(4, '0')}`;
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-baseline justify-between gap-2">
        <Label className="text-xs">{label}</Label>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

export function SliderField({
  label,
  value,
  min,
  max,
  step = 0.01,
  format = (v) => v.toFixed(2),
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={label} hint={format(value)}>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={([v]) => onChange(v)} aria-label={label} />
    </Field>
  );
}

/** A seconds field that commits on blur or Enter, with an optional "use the playhead" button. */
export function SecondsField({ label, value, onChange, onPlayhead, min = 0, max }: { label: string; value: number; onChange: (v: number) => void; onPlayhead?: () => void; min?: number; max?: number }) {
  const [text, setText] = useState(value.toFixed(2));
  useEffect(() => setText(value.toFixed(2)), [value]);
  const commit = () => {
    const v = Number(text);
    if (!Number.isFinite(v)) return setText(value.toFixed(2));
    const clamped = Math.min(max ?? Infinity, Math.max(min, v));
    if (Math.abs(clamped - value) > 0.0005) onChange(clamped);
    else setText(value.toFixed(2));
  };
  return (
    <Field label={label}>
      <div className="flex gap-1">
        <Input
          value={text}
          inputMode="decimal"
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          className="h-8 tabular-nums"
          aria-label={`${label} (seconds)`}
        />
        {onPlayhead && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" size="icon-sm" variant="outline" onClick={onPlayhead} aria-label={`Set ${label.toLowerCase()} to the playhead`}>
                <Crosshair />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Set to the playhead</TooltipContent>
          </Tooltip>
        )}
      </div>
    </Field>
  );
}

const NONE = '__none__';

export function MediaSelect({ value, onChange, options, placeholder = 'None', noneLabel = 'None', className }: { value: string | null; onChange: (id: string | null) => void; options: Media[]; placeholder?: string; noneLabel?: string; className?: string }) {
  return (
    <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? null : v)}>
      <SelectTrigger size="sm" className={cn('w-full', className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NONE}>{noneLabel}</SelectItem>
        {options.map((m) => (
          <SelectItem key={m.id} value={m.id}>
            {m.originalName}
          </SelectItem>
        ))}
        {value && !options.some((m) => m.id === value) && <SelectItem value={value}>Missing file</SelectItem>}
      </SelectContent>
    </Select>
  );
}

export function ChoiceSelect<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger size="sm" className="w-full" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <label className="flex h-8 cursor-pointer items-center gap-2 rounded-md border px-2 text-sm">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="size-5 cursor-pointer rounded border-0 bg-transparent p-0" />
        <span className="font-mono text-xs text-muted-foreground uppercase">{value}</span>
      </label>
    </Field>
  );
}

export function PanelEmpty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">{children}</p>;
}
