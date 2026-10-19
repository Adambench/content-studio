import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { GenKind } from '@shared/generate';
import { GEN_BACKEND_LABELS, type GenBackend, type HostedModel } from '@shared/hosted';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { api, errorMessage } from '@/lib/api';
import { keys, queryClient, useAiSettings } from '@/lib/queries';

const KINDS: { kind: GenKind; label: string }[] = [
  { kind: 'image', label: 'Pictures' },
  { kind: 'video', label: 'Clips' },
];

const usd = (v: number) => `$${v < 1 ? v.toFixed(3) : v.toFixed(2)}`;

/** Settings → Models: generate pictures and clips on kie.ai instead of the home PCs, under a daily cap. */
export function HostedGeneration() {
  const h = useAiSettings().data?.hosted;
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await api('/ai', { method: 'PATCH', body });
      queryClient.invalidateQueries({ queryKey: keys.ai });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function check() {
    setBusy(true);
    try {
      queryClient.setQueryData(keys.ai, await api('/ai?fresh=1'));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!h) return null;
  const s = h.settings;
  const model = (kind: GenKind, m: Partial<HostedModel>) => patch({ hosted: { models: { [kind]: m } } });

  return (
    <div className="space-y-3">
      <div className="space-y-0.5">
        <p className="text-sm font-medium">Hosted generation (kie.ai)</p>
        <p className="text-xs text-muted-foreground">
          Pictures and clips made by kie.ai at full quality (720p+ clips, scaled to 1080×1920) instead of on a home PC. The same people-and-animals check applies, and retries are paid for. Your key stays on this computer.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-48 flex-1 space-y-2">
          <Label htmlFor="kie-key">API key {h.hasKey && <span className="text-xs text-emerald-400">(saved)</span>}</Label>
          <Input id="kie-key" type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} placeholder={h.hasKey ? 'Paste a new key to replace it' : 'Paste your kie.ai key'} />
        </div>
        <Button
          size="sm"
          disabled={busy || !key.trim()}
          onClick={async () => {
            await patch({ hostedKey: key.trim() });
            setKey('');
          }}
        >
          Save key
        </Button>
        {h.hasKey && (
          <>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => patch({ hostedKey: '' })}>
              Remove
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={check}>
              {busy ? <Spinner /> : <RefreshCw />} Check credits
            </Button>
          </>
        )}
      </div>
      {h.creditsLeft !== null && <p className="text-xs text-muted-foreground">{h.creditsLeft.toLocaleString()} credits left at kie.ai (about {usd(h.creditsLeft * s.usdPerCredit)}).</p>}
      {h.error && <p className="text-xs text-amber-400">{h.error}</p>}

      <div className="grid gap-4 sm:grid-cols-2">
        {KINDS.map(({ kind, label }) => (
          <div key={kind} className="space-y-2">
            <Label>{label} run on</Label>
            <Select value={s.backend[kind]} onValueChange={(v) => patch({ hosted: { backend: { [kind]: v } } })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(GEN_BACKEND_LABELS) as GenBackend[]).map((b) => (
                  <SelectItem key={b} value={b}>
                    {GEN_BACKEND_LABELS[b]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">About {usd(h.priceUsd[kind])} each.</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <NumberField label="Daily cap ($)" value={s.dailyCapUsd} step={1} onSave={(v) => patch({ hosted: { dailyCapUsd: v } })} />
        <p className="self-end text-xs text-muted-foreground">
          Spent today: <span className="text-foreground">{usd(h.spentTodayUsd)}</span> of {usd(s.dailyCapUsd)}. Past the cap, new ones go to a home PC or wait for tomorrow.
        </p>
      </div>

      <details className="rounded-lg border px-3 py-2 text-xs">
        <summary className="cursor-pointer text-sm">Models and prices</summary>
        <div className="mt-3 space-y-3">
          <p className="text-muted-foreground">Prices are kie.ai credits; the defaults are from its public price list: check them against your dashboard.</p>
          <NumberField label="Dollars per credit" value={s.usdPerCredit} step={0.001} onSave={(v) => patch({ hosted: { usdPerCredit: v } })} />
          {KINDS.map(({ kind, label }) => (
            <div key={kind} className="grid gap-3 sm:grid-cols-4">
              <TextField label={`${label}: model`} value={s.models[kind].id} onSave={(v) => model(kind, { id: v })} />
              <TextField label="Size" value={s.models[kind].resolution} onSave={(v) => model(kind, { resolution: v })} />
              <NumberField label={kind === 'video' ? 'Credits per second' : 'Credits each'} value={s.models[kind].credits} step={1} onSave={(v) => model(kind, { credits: v })} />
              {kind === 'video' && <NumberField label="Seconds" value={s.models.video.seconds} step={1} onSave={(v) => model(kind, { seconds: v })} />}
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

function TextField({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v.trim() && v !== value && onSave(v.trim())} />
    </div>
  );
}

function NumberField({ label, value, step, onSave }: { label: string; value: number; step: number; onSave: (v: number) => void }) {
  const [v, setV] = useState(String(value));
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input
        type="number"
        min={0}
        step={step}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          const n = Number(v);
          if (Number.isFinite(n) && n >= 0 && n !== value) onSave(n);
        }}
      />
    </div>
  );
}
